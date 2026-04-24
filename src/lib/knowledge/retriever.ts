import { listSearchableDocuments } from "@/lib/db";
import { readFileText, ripgrepSearch, type GrepMatch } from "@/lib/tauri";

export interface RetrievalResult {
  content: string;
  documentId: string;
  score: number;
  metadata: Record<string, unknown> | null;
}

interface SearchableDocument {
  id: string;
  filename: string;
  filePath: string | null;
  sourceName: string;
  sourcePath: string | null;
  entitySummary: string | null;
  extractedTextPath: string | null;
  errorMessage?: string | null;
}

interface SearchPlan {
  terms: string[];
  mustTerms: string[];
  shouldTerms: string[];
  phraseTerms: string[];
  notTerms: string[];
  importantTerms: string[];
  strategy: string;
  fields: string[];
}

export interface KnowledgeSearchPlan {
  must?: string[];
  should?: string[];
  phrases?: string[];
  not?: string[];
  fields?: string[];
  strategy?: "broad_or_then_rank" | "must_and_should" | "phrase_first" | "metadata_first";
  fallbacks?: Array<Omit<KnowledgeSearchPlan, "fallbacks">>;
}

interface DocumentHit {
  lines: string[];
  matchedTerms: string[];
}

/** Retrieve relevant documents with local keyword/catalog search.
 *
 * This intentionally does not call embedding APIs. It expands a natural
 * language target into concrete search variants, scores file/catalog metadata
 * first, then extracted text, and returns local snippets.
 */
export async function retrieveRelevant(
  query: string | KnowledgeSearchPlan,
  topK = 5,
): Promise<RetrievalResult[]> {
  const plan = typeof query === "string" ? buildSearchPlan(query) : buildSearchPlanFromStructured(query);
  if (plan.terms.length === 0) return [];

  const docs = await listSearchableDocuments();
  const rgHits = await tryRipgrepRecall(docs, plan, Math.max(topK * 30, 100));
  const scored = rgHits
    ? scoreWithRecall(docs, plan, rgHits)
    : await scoreWithFullScan(docs, plan);

  if (scored.length === 0 && typeof query !== "string" && Array.isArray(query.fallbacks)) {
    for (const fallback of query.fallbacks.slice(0, 3)) {
      const fallbackResults = await retrieveRelevant({ ...query, ...fallback, fallbacks: [] }, topK);
      if (fallbackResults.length > 0) return fallbackResults;
    }
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK);
}

function scoreWithRecall(
  docs: SearchableDocument[],
  plan: SearchPlan,
  hitsByDocument: Map<string, DocumentHit>,
): RetrievalResult[] {
  const scored: RetrievalResult[] = [];
  for (const doc of docs) {
    const metadataScore = scoreMetadata(doc, plan);
    const hit = hitsByDocument.get(doc.id);
    const matchedTerms = Array.from(new Set([
      ...metadataScore.matchedTerms,
      ...(hit?.matchedTerms || []),
    ]));

    if (!passesPlan(plan, matchedTerms)) continue;

    let rawScore = metadataScore.rawScore;
    if (hit) {
      rawScore += Math.min(hit.lines.length, 12) * 2;
      rawScore += Math.min(new Set(hit.matchedTerms).size, 12) * 3;
    }
    rawScore += plan.phraseTerms.filter((term) => matchedTerms.includes(term)).length * 6;
    rawScore += plan.mustTerms.filter((term) => matchedTerms.includes(term)).length * 5;

    if (rawScore <= 0) continue;

    scored.push(resultFromScore(doc, plan, rawScore, matchedTerms, metadataScore.metadataMatchedTerms, hit?.lines.join("\n")));
  }
  return scored;
}

async function scoreWithFullScan(docs: SearchableDocument[], plan: SearchPlan): Promise<RetrievalResult[]> {
  const scored: RetrievalResult[] = [];
  for (const doc of docs) {
    const result = await scoreDocumentFullScan(doc, plan);
    if (result) scored.push(result);
  }
  return scored;
}

async function scoreDocumentFullScan(doc: SearchableDocument, plan: SearchPlan): Promise<RetrievalResult | null> {
  const filename = doc.filename.toLowerCase();
  const compactFilename = compactText(doc.filename);
  const catalog = `${doc.sourceName}\n${doc.entitySummary || ""}`.toLowerCase();
  const compactCatalog = compactText(`${doc.sourceName}\n${doc.entitySummary || ""}`);
  const content = await readExtractedText(doc);
  const contentLower = content.toLowerCase();
  const compactContent = compactText(content);

  let rawScore = 0;
  const matchedTerms: string[] = [];
  const metadataMatchedTerms: string[] = [];
  for (const term of plan.terms) {
    const lower = term.toLowerCase();
    if (!lower) continue;
    const compact = compactText(lower);
    let termScore = 0;

    if (filename.includes(lower) || compactFilename.includes(compact)) {
      termScore += 12;
      metadataMatchedTerms.push(term);
    }
    if (catalog.includes(lower) || compactCatalog.includes(compact)) {
      termScore += 7;
      metadataMatchedTerms.push(term);
    }

    const contentHits = Math.max(
      countOccurrences(contentLower, lower),
      compact ? countOccurrences(compactContent, compact) : 0,
    );
    termScore += Math.min(contentHits, 8);

    if (termScore > 0) matchedTerms.push(term);
    rawScore += termScore;
  }

  const importantMatches = plan.importantTerms.filter((term) => {
    const compact = compactText(term);
    return matchedTerms.some((matched) => matched === term)
      || filename.includes(term.toLowerCase())
      || compactFilename.includes(compact)
      || compactCatalog.includes(compact);
  });

  if (!passesPlan(plan, matchedTerms)) return null;

  if (metadataMatchedTerms.length >= 2) rawScore += metadataMatchedTerms.length * 4;
  if (importantMatches.length >= 2) rawScore += importantMatches.length * 6;
  if (importantMatches.length === plan.importantTerms.length && importantMatches.length > 0) rawScore += 10;
  rawScore += plan.phraseTerms.filter((term) => matchedTerms.includes(term)).length * 6;
  rawScore += plan.mustTerms.filter((term) => matchedTerms.includes(term)).length * 5;

  if (rawScore <= 0) {
    return null;
  }

  return resultFromScore(doc, plan, rawScore, matchedTerms, metadataMatchedTerms, bestSnippet(content, plan.terms));
}

function resultFromScore(
  doc: SearchableDocument,
  plan: SearchPlan,
  rawScore: number,
  matchedTerms: string[],
  metadataMatchedTerms: string[],
  snippet?: string,
): RetrievalResult {
  const scoreDenominator = Math.max(24, plan.importantTerms.length * 14);

  return {
    content: snippet || doc.entitySummary || doc.filename,
    documentId: doc.id,
    score: Math.min(rawScore / scoreDenominator, 1),
    metadata: {
      filename: doc.filename,
      filePath: doc.filePath,
      sourceName: doc.sourceName,
      sourcePath: doc.sourcePath,
      retrieval: "target-keyword",
      searchStrategy: plan.strategy,
      matchedTerms: Array.from(new Set(matchedTerms)).slice(0, 12),
      metadataMatchedTerms: Array.from(new Set(metadataMatchedTerms)).slice(0, 12),
      mustTerms: plan.mustTerms,
      shouldTerms: plan.shouldTerms,
      phraseTerms: plan.phraseTerms,
      importantTerms: plan.importantTerms,
      warning: doc.errorMessage || undefined,
    },
  };
}

function scoreMetadata(doc: SearchableDocument, plan: SearchPlan): {
  rawScore: number;
  matchedTerms: string[];
  metadataMatchedTerms: string[];
} {
  const filename = doc.filename.toLowerCase();
  const compactFilename = compactText(doc.filename);
  const catalog = `${doc.sourceName}\n${doc.entitySummary || ""}`.toLowerCase();
  const compactCatalog = compactText(`${doc.sourceName}\n${doc.entitySummary || ""}`);
  let rawScore = 0;
  const matchedTerms: string[] = [];
  const metadataMatchedTerms: string[] = [];

  for (const term of plan.terms) {
    const lower = term.toLowerCase();
    const compact = compactText(lower);
    let termScore = 0;
    if (filename.includes(lower) || compactFilename.includes(compact)) termScore += 12;
    if (catalog.includes(lower) || compactCatalog.includes(compact)) termScore += 7;
    if (termScore > 0) {
      matchedTerms.push(term);
      metadataMatchedTerms.push(term);
      rawScore += termScore;
    }
  }

  if (metadataMatchedTerms.length >= 2) rawScore += metadataMatchedTerms.length * 4;
  return { rawScore, matchedTerms, metadataMatchedTerms };
}

function passesPlan(plan: SearchPlan, matchedTerms: string[]): boolean {
  const matched = new Set(matchedTerms);
  if (plan.notTerms.some((term) => matched.has(term))) return false;
  if (plan.mustTerms.length > 0 && !plan.mustTerms.every((term) => matched.has(term))) return false;
  const positiveTerms = [...plan.shouldTerms, ...plan.phraseTerms, ...plan.mustTerms];
  return positiveTerms.length === 0 || positiveTerms.some((term) => matched.has(term));
}

async function tryRipgrepRecall(
  docs: SearchableDocument[],
  plan: SearchPlan,
  maxResults: number,
): Promise<Map<string, DocumentHit> | null> {
  const searchableTerms = Array.from(new Set([
    ...plan.phraseTerms,
    ...plan.mustTerms,
    ...plan.shouldTerms,
    ...plan.notTerms,
  ].filter(isUsefulTerm))).slice(0, 80);
  if (searchableTerms.length === 0) return new Map();

  const pattern = searchableTerms.map(escapeRegex).join("|");
  const docsByTextPath = new Map<string, SearchableDocument>();
  for (const doc of docs) {
    if (doc.extractedTextPath) docsByTextPath.set(normalizePath(doc.extractedTextPath), doc);
  }

  const cacheDirs = Array.from(new Set(
    docs
      .map((doc) => doc.extractedTextPath ? dirname(doc.extractedTextPath) : null)
      .filter((dir): dir is string => Boolean(dir)),
  ));
  if (cacheDirs.length === 0) return new Map();

  const hits = new Map<string, DocumentHit>();
  try {
    for (const dir of cacheDirs) {
      const matches = await ripgrepSearch(dir, pattern, Math.ceil(maxResults / cacheDirs.length));
      addRipgrepMatches(hits, docsByTextPath, matches, searchableTerms);
    }
    return hits;
  } catch {
    return null;
  }
}

function addRipgrepMatches(
  hits: Map<string, DocumentHit>,
  docsByTextPath: Map<string, SearchableDocument>,
  matches: GrepMatch[],
  terms: string[],
): void {
  for (const match of matches) {
    const doc = docsByTextPath.get(normalizePath(match.path));
    if (!doc) continue;
    const hit = hits.get(doc.id) || { lines: [], matchedTerms: [] };
    if (hit.lines.length < 8) hit.lines.push(`line ${match.line_number}: ${match.line}`);
    hit.matchedTerms.push(...termsMatchingText(match.line, terms));
    hits.set(doc.id, hit);
  }
}

function termsMatchingText(text: string, terms: string[]): string[] {
  const lower = text.toLowerCase();
  const compact = compactText(text);
  return terms.filter((term) => {
    const lowerTerm = term.toLowerCase();
    const compactTerm = compactText(term);
    return lower.includes(lowerTerm) || (compactTerm.length > 0 && compact.includes(compactTerm));
  });
}

async function readExtractedText(doc: SearchableDocument): Promise<string> {
  if (doc.extractedTextPath) {
    try {
      return await readFileText(doc.extractedTextPath);
    } catch {
      return "";
    }
  }
  return "";
}

export function expandQueryTerms(query: string): string[] {
  return buildSearchPlan(query).terms;
}

function buildSearchPlan(query: string): SearchPlan {
  const normalized = query
    .replace(/[^\p{L}\p{N}_\-\u4e00-\u9fff]+/gu, " ")
    .trim();
  const words = normalized.split(/\s+/).filter((term) => term.length >= 2);
  const mixedRuns = Array.from(normalized.matchAll(/[\p{L}\p{N}_\-\u4e00-\u9fff]{2,}/gu)).map((m) => m[0]);
  const cjkRuns = Array.from(query.matchAll(/[\u4e00-\u9fff]{2,}/g)).map((m) => m[0]);
  const cjkBigrams = cjkRuns.flatMap((run) => {
    const parts: string[] = [];
    for (let i = 0; i < run.length - 1; i++) parts.push(run.slice(i, i + 2));
    return parts;
  });
  const mixedNgrams = mixedRuns.flatMap((run) => ngrams(run, 2, 4));
  const semanticTerms = expandSemanticTerms([...words, ...mixedRuns, ...cjkRuns, ...cjkBigrams, ...mixedNgrams]);
  const terms = Array.from(new Set(semanticTerms.map(cleanTerm).filter(isUsefulTerm))).slice(0, 80);
  const importantTerms = pickImportantTerms(terms);
  return {
    terms,
    mustTerms: [],
    shouldTerms: terms,
    phraseTerms: [],
    notTerms: [],
    importantTerms,
    strategy: "broad_or_then_rank",
    fields: ["filename", "metadata", "content_snapshot"],
  };
}

function buildSearchPlanFromStructured(input: KnowledgeSearchPlan): SearchPlan {
  const mustTerms = normalizeStructuredTerms(input.must || [], true);
  const shouldTerms = normalizeStructuredTerms(input.should || [], true);
  const phraseTerms = normalizeStructuredTerms(input.phrases || [], false);
  const notTerms = normalizeStructuredTerms(input.not || [], true);
  const expandedShould = Array.from(new Set(expandSemanticTerms(shouldTerms).map(cleanTerm).filter(isUsefulTerm)));
  const expandedMust = Array.from(new Set(expandSemanticTerms(mustTerms).map(cleanTerm).filter(isUsefulTerm)));
  const expandedPhrases = Array.from(new Set(expandSemanticTerms(phraseTerms).map(cleanTerm).filter(isUsefulTerm)));
  const terms = Array.from(new Set([
    ...expandedPhrases,
    ...expandedMust,
    ...expandedShould,
    ...notTerms,
  ])).slice(0, 100);
  const importantTerms = pickImportantTerms([...expandedPhrases, ...expandedMust, ...expandedShould]);
  return {
    terms,
    mustTerms: expandedMust,
    shouldTerms: expandedShould.length > 0 ? expandedShould : terms.filter((term) => !notTerms.includes(term)),
    phraseTerms: expandedPhrases,
    notTerms,
    importantTerms,
    strategy: input.strategy || (expandedMust.length > 0 ? "must_and_should" : "broad_or_then_rank"),
    fields: input.fields || ["filename", "metadata", "content_snapshot"],
  };
}

function normalizeStructuredTerms(terms: string[], splitWhitespace: boolean): string[] {
  return Array.from(new Set(terms.flatMap((term) => {
    const cleaned = cleanTerm(term);
    if (!cleaned) return [];
    if (!splitWhitespace) return isUsefulTerm(cleaned) ? [cleaned] : [];
    return cleaned.split(/\s+/).map(cleanTerm).filter(isUsefulTerm);
  })));
}

function expandSemanticTerms(terms: string[]): string[] {
  const expanded = [...terms];
  for (const term of terms) {
    expanded.push(...expandMonthTerms(term));
    if (term.includes("经营")) expanded.push("经营", "经营分析", "经营会", "经营情况", "分析");
    if (term.includes("情况")) expanded.push("情况", "分析", "表现");
    if (term.includes("利润")) expanded.push("利润", "毛利", "净利", "盈利");
    if (term.includes("收入")) expanded.push("收入", "营收", "销售额");
    if (term.includes("硬件")) expanded.push("硬件");
  }
  return expanded;
}

function expandMonthTerms(term: string): string[] {
  const expanded: string[] = [];
  const arabic = term.match(/(\d{1,2})月份?/);
  if (arabic) {
    expanded.push(`${Number(arabic[1])}月`, `${Number(arabic[1])}月份`);
  }
  const chineseMonths: Record<string, string> = {
    一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6",
    七: "7", 八: "8", 九: "9", 十: "10", 十一: "11", 十二: "12",
  };
  for (const [zh, num] of Object.entries(chineseMonths)) {
    if (term.includes(`${zh}月`)) expanded.push(`${num}月`, `${num}月份`, `${zh}月`);
    if (term.includes(`${zh}月份`)) expanded.push(`${num}月`, `${num}月份`, `${zh}月份`);
  }
  return expanded;
}

function ngrams(input: string, min: number, max: number): string[] {
  const chars = Array.from(input);
  const parts: string[] = [];
  for (let size = min; size <= max; size++) {
    for (let i = 0; i <= chars.length - size; i++) {
      parts.push(chars.slice(i, i + size).join(""));
    }
  }
  return parts;
}

function cleanTerm(term: string): string {
  return term.trim().replace(/^[-_]+|[-_]+$/g, "");
}

function isUsefulTerm(term: string): boolean {
  if (term.length < 2) return false;
  const stopTerms = new Set([
    "怎么样", "如何", "什么", "哪些", "一下", "这个", "那个", "一个",
    "情况", "月份", "怎么", "请问", "是否", "以及", "相关",
  ]);
  return !stopTerms.has(term);
}

function pickImportantTerms(terms: string[]): string[] {
  const important = terms.filter((term) => {
    if (/^\d{1,2}月/.test(term)) return true;
    if (/^[\u4e00-\u9fff]{2,6}$/.test(term) && !["分析", "表现", "经营情况"].includes(term)) return true;
    if (/^[a-zA-Z0-9_-]{3,}$/.test(term)) return true;
    return false;
  });
  return Array.from(new Set(important)).slice(0, 8);
}

function compactText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, "");
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : ".";
}

function normalizePath(path: string): string {
  return path.replace(/\/+/g, "/");
}

function bestSnippet(content: string, terms: string[]): string {
  if (!content.trim()) return "";
  const lower = content.toLowerCase();
  let bestIndex = -1;
  for (const term of terms) {
    const index = lower.indexOf(term.toLowerCase());
    if (index !== -1 && (bestIndex === -1 || index < bestIndex)) bestIndex = index;
  }
  if (bestIndex === -1) return content.trim().slice(0, 700);

  const start = Math.max(0, bestIndex - 250);
  const end = Math.min(content.length, bestIndex + 650);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < content.length ? "..." : "";
  return `${prefix}${content.slice(start, end).trim()}${suffix}`;
}

/** Build a knowledge context string from retrieval results.
 *  This gets injected into the system prompt. */
export function buildKnowledgeContext(results: RetrievalResult[]): string {
  if (results.length === 0) {
    return "";
  }

  const sections = results.map((r, i) => {
    const source = r.metadata?.filename ? ` (from ${r.metadata.filename})` : "";
    return `[Reference ${i + 1}${source}]\n${r.content}`;
  });

  return (
    "The following are relevant excerpts from the user's local knowledge base, found by keyword/catalog search. " +
    "Use them as context when helpful, and mention which documents you referenced.\n\n" +
    sections.join("\n\n---\n\n")
  );
}
