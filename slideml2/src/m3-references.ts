import type { DomNode, FootnoteSpec, ReferenceSpec, Slideml2SourceDeck } from "./types.js";

type CitationStyle = "numeric" | "author-year" | "short";

interface ReferenceState {
  references: Map<string, ReferenceSpec>;
  footnotes: Map<string, FootnoteSpec>;
  citationOrder: string[];
  footnoteOrder: string[];
}

const RICH_INLINE_KINDS = new Set(["text", "math", "cite", "footnoteRef", "icon", "token"]);

export function resolveScientificReferences(source: Slideml2SourceDeck): Slideml2SourceDeck {
  const state = buildReferenceState(source);
  for (const slide of source.slides || []) {
    for (const child of slide.children || []) collectInlineRefs(child, state);
  }
  return {
    ...source,
    slides: (source.slides || []).map((slide) => ({
      ...slide,
      children: (slide.children || []).map((node) => transformReferenceNode(node, state)),
    })),
  };
}

export function bibliographyItems(source: Slideml2SourceDeck, style: CitationStyle = "numeric", includeAll = false): Array<{ id: string; label: string; text: string }> {
  const state = buildReferenceState(source);
  for (const slide of source.slides || []) {
    for (const child of slide.children || []) collectInlineRefs(child, state);
  }
  return bibliographyItemsFromState(state, style, includeAll);
}

export function citationLabel(ref: ReferenceSpec | undefined, index: number, style: CitationStyle = "numeric"): string {
  if (!ref) return "[?]";
  if (style === "author-year") {
    const author = firstAuthorName(ref) || ref.id;
    const year = ref.year !== undefined && ref.year !== null ? String(ref.year) : "n.d.";
    return `(${author}, ${year})`;
  }
  if (style === "short") {
    const author = firstAuthorName(ref) || ref.id;
    const year = ref.year !== undefined && ref.year !== null ? ` ${String(ref.year)}` : "";
    return `[${author}${year}]`;
  }
  return `[${index > 0 ? index : "?"}]`;
}

export function formatReference(ref: ReferenceSpec, index: number, style: CitationStyle = "numeric"): string {
  if (typeof ref.citation === "string" && ref.citation.trim()) return ref.citation.trim();
  const authors = authorsText(ref);
  const year = ref.year !== undefined && ref.year !== null ? String(ref.year) : "";
  const title = typeof ref.title === "string" ? ref.title.trim() : "";
  const venue = typeof ref.venue === "string" ? ref.venue.trim() : "";
  const doi = typeof ref.doi === "string" && ref.doi.trim() ? `doi:${ref.doi.trim()}` : "";
  const url = typeof ref.url === "string" ? ref.url.trim() : "";
  const head = style === "numeric" ? `[${index}] ` : "";
  return `${head}${[authors, year ? `(${year})` : "", title, venue, doi || url].filter(Boolean).join(". ")}`;
}

function buildReferenceState(source: Slideml2SourceDeck): ReferenceState {
  const references = new Map<string, ReferenceSpec>();
  const footnotes = new Map<string, FootnoteSpec>();
  for (const ref of source.deck?.references || []) {
    if (ref && typeof ref.id === "string" && ref.id.trim()) references.set(ref.id, ref);
  }
  for (const note of source.deck?.footnotes || []) {
    if (note && typeof note.id === "string" && note.id.trim()) footnotes.set(note.id, note);
  }
  return { references, footnotes, citationOrder: [], footnoteOrder: [] };
}

function collectInlineRefs(value: unknown, state: ReferenceState): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectInlineRefs(item, state);
    return;
  }
  const rec = value as Record<string, unknown>;
  if (rec.kind === "cite" && typeof rec.refId === "string") pushUnique(state.citationOrder, rec.refId);
  if (rec.kind === "footnoteRef" && typeof rec.footnoteId === "string") pushUnique(state.footnoteOrder, rec.footnoteId);
  if (Array.isArray(rec.footnoteRefs)) {
    for (const id of rec.footnoteRefs) if (typeof id === "string") pushUnique(state.footnoteOrder, id);
  }
  for (const child of Object.values(rec)) collectInlineRefs(child, state);
}

function transformReferenceNode(node: DomNode, state: ReferenceState): DomNode {
  return transformValue(node, state) as DomNode;
}

function transformValue(value: unknown, state: ReferenceState): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => transformValue(item, state));
  const rec = value as Record<string, unknown>;
  if (isRichInline(rec)) return resolveRichInline(rec, state);

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(rec)) {
    out[key] = transformValue(child, state);
  }
  if (isBibliographyNode(out)) {
    const style = bibliographyStyle(out.style);
    const includeAll = out.includeAll === true;
    out.items = bibliographyItemsFromState(state, style, includeAll);
  }
  if (Array.isArray(out.footnoteRefs) && out.footnoteRefs.some((item) => typeof item === "string")) {
    const refs = out.footnoteRefs.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    if (refs.length) {
      const baseRuns = Array.isArray(out.runs)
        ? out.runs
        : typeof out.text === "string"
          ? [{ kind: "text", text: out.text }]
          : [];
      out.runs = [
        ...baseRuns,
        { kind: "text", text: " " },
        ...refs.map((id) => footnoteRun(id, state)),
      ];
    }
  }
  return out;
}

function resolveRichInline(rec: Record<string, unknown>, state: ReferenceState): Record<string, unknown> {
  if (rec.kind === "cite") {
    const refId = typeof rec.refId === "string" ? rec.refId : "";
    const index = state.citationOrder.indexOf(refId) + 1;
    const style = citationStyle(rec.style);
    const ref = state.references.get(refId);
    return {
      ...rec,
      kind: "text",
      text: citationLabel(ref, index, style),
      baseline: rec.baseline ?? 30,
      size: rec.size ?? "xs",
      link: typeof rec.link === "string" ? rec.link : ref?.url,
    };
  }
  if (rec.kind === "footnoteRef") {
    const id = typeof rec.footnoteId === "string" ? rec.footnoteId : "";
    return footnoteRun(id, state, rec);
  }
  return rec;
}

function footnoteRun(id: string, state: ReferenceState, base: Record<string, unknown> = {}): Record<string, unknown> {
  const index = state.footnoteOrder.indexOf(id) + 1;
  return {
    ...base,
    kind: "text",
    text: `[${index > 0 ? index : "?"}]`,
    baseline: base.baseline ?? 30,
    size: base.size ?? "xs",
  };
}

function bibliographyItemsFromState(state: ReferenceState, style: CitationStyle, includeAll: boolean): Array<{ id: string; label: string; text: string }> {
  const ids = includeAll
    ? Array.from(state.references.keys())
    : state.citationOrder.filter((id) => state.references.has(id));
  return ids.map((id, index) => {
    const ref = state.references.get(id)!;
    const number = index + 1;
    return {
      id,
      label: style === "numeric" ? `[${number}]` : citationLabel(ref, number, style),
      text: formatReference(ref, number, style),
    };
  });
}

function isRichInline(rec: Record<string, unknown>): boolean {
  return typeof rec.kind === "string" && RICH_INLINE_KINDS.has(rec.kind);
}

function isBibliographyNode(rec: Record<string, unknown>): boolean {
  return rec.type === "bibliography" || (rec.type === "component" && rec.component === "bibliography");
}

function citationStyle(value: unknown): CitationStyle {
  return value === "author-year" || value === "short" ? value : "numeric";
}

function bibliographyStyle(value: unknown): CitationStyle {
  return citationStyle(value);
}

function pushUnique(list: string[], value: string): void {
  if (!value || list.includes(value)) return;
  list.push(value);
}

function authorsText(ref: ReferenceSpec): string {
  if (Array.isArray(ref.authors)) return ref.authors.filter(Boolean).join(", ");
  if (typeof ref.authors === "string") return ref.authors.trim();
  return "";
}

function firstAuthorName(ref: ReferenceSpec): string {
  const authors = Array.isArray(ref.authors)
    ? ref.authors
    : typeof ref.authors === "string"
      ? ref.authors.split(/\s*(?:,|;| and )\s*/i)
      : [];
  const first = authors.find((item) => typeof item === "string" && item.trim());
  if (!first) return "";
  const parts = first.trim().split(/\s+/);
  return parts[parts.length - 1] || first.trim();
}
