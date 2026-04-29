import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList, Paragraph, TextRun } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { contentRect, imageOrPlaceholder, slideTitle, type ImageRefValue } from "../render/primitives.js";
import { parseInline } from "../render/markdown-inline.js";

export const slots: Record<string, SlotSchema> = {
  title:      { type: "text", maxChars: 64 },
  subtitle:   { type: "text", maxChars: 96, optional: true },
  body:       { type: "article-blocks", maxChars: 12000 },
  columns:    { type: "enum", values: ["auto", "1", "2"], default: "auto", optional: true },
  mode:       { type: "enum", values: ["passage", "essay", "handout"], default: "passage", optional: true },
  pageMarker: { type: "enum", values: ["auto", "none"], default: "auto", optional: true },
};

type ArticleBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "quote"; text: string }
  | { type: "note"; text: string }
  | { type: "code"; text: string; language?: string }
  | { type: "list"; items: string[] }
  | { type: "image"; image: ImageRefValue; caption?: string; heightCm?: number };

interface TextStyle {
  sizeHalfPt: number;
  lineSpacingHalfPt: number;
  spaceAfterHalfPt: number;
  color: string;
  bold?: boolean;
  italic?: boolean;
  mono?: boolean;
  indentLevel?: number;
  bullet?: boolean;
}

type FlowItem =
  | { kind: "line"; runs: TextRun[]; style: TextStyle; blockEnd?: boolean }
  | { kind: "image"; image: ImageRefValue; caption?: string; height: number };

const PAGE_GAP_CM = 0.8;
const BODY_MARGIN_X_CM = 2;
const BODY_BOTTOM_SAFE_CM = 2.05;
const TITLE_Y_CM = 0.95;
const SUBTITLE_Y_CM = 2.35;
const FIRST_PAGE_TOP_CM = 2.75;
const FIRST_PAGE_WITH_SUBTITLE_TOP_CM = 3.25;
const CONTINUATION_TOP_CM = 2.65;
const MIN_FINAL_PAGE_LINES = 6;

const articleFlow: LayoutFn = (ctx: LayoutContext): ShapeList[] => {
  const title = ctx.slot<string>("title") ?? "";
  const subtitle = ctx.slot<string>("subtitle");
  const body = ctx.slot<unknown>("body");
  const mode = ctx.slot<string>("mode") ?? "passage";
  const blocks = normalizeBlocks(body);
  const cols = resolveColumns(ctx, blocks);

  const pages = paginate(ctx, blocks, cols, mode, !!subtitle);
  return pages.map((page, pageIndex) => renderArticlePage(ctx, {
    title,
    subtitle,
    page,
    pageIndex,
    pageCount: pages.length,
    columns: cols,
    mode,
    showMarker: (ctx.slot<string>("pageMarker") ?? "auto") !== "none",
  }));
};

export default articleFlow;

function normalizeBlocks(value: unknown): ArticleBlock[] {
  if (typeof value === "string") {
    return value.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
      .map((text) => ({ type: "paragraph", text }));
  }
  if (!Array.isArray(value)) return [];
  const out: ArticleBlock[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      out.push(...normalizeBlocks(item));
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const rawType = String(o.type ?? o.kind ?? "paragraph");
    const type = rawType === "h2" ? "heading" : rawType === "callout" ? "note" : rawType;
    if ((type === "paragraph" || type === "heading" || type === "quote" || type === "note" || type === "code") && typeof o.text === "string") {
      out.push({ type, text: o.text, ...(typeof o.language === "string" ? { language: o.language } : {}) } as ArticleBlock);
    } else if (type === "list" && Array.isArray(o.items)) {
      out.push({ type: "list", items: o.items.filter((v): v is string => typeof v === "string") });
    } else if (type === "image") {
      const image = imageRefOf(o.image ?? o);
      if (image) {
        out.push({
          type: "image",
          image,
          ...(typeof o.caption === "string" ? { caption: o.caption } : {}),
          ...(typeof o.heightCm === "number" ? { heightCm: o.heightCm } : {}),
        });
      }
    }
  }
  return out;
}

function imageRefOf(value: unknown): ImageRefValue | undefined {
  if (typeof value === "string" && value) return { src: value };
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const o = value as Record<string, unknown>;
  const src = typeof o.src === "string" ? o.src : typeof o.url === "string" ? o.url : undefined;
  if (!src) return undefined;
  return {
    src,
    ...(typeof o.alt === "string" ? { alt: o.alt } : {}),
    ...(o.fit === "contain" || o.fit === "cover" || o.fit === "fill" ? { fit: o.fit } : {}),
  };
}

function resolveColumns(ctx: LayoutContext, blocks: ArticleBlock[]): number {
  const requested = ctx.slot<string>("columns") ?? "auto";
  if (requested === "1") return 1;
  if (requested === "2") return 2;
  const chars = blocks.reduce((sum, block) => sum + blockTextLength(block), 0);
  const paras = blocks.filter((b) => b.type !== "image").length;
  const threshold = ctx.cjk ? 520 : 850;
  return chars > threshold || paras > 7 ? 2 : 1;
}

function blockTextLength(block: ArticleBlock): number {
  if (block.type === "list") return block.items.reduce((n, s) => n + [...s].length, 0);
  if (block.type === "image") return block.caption ? [...block.caption].length : 0;
  return [...block.text].length;
}

function paginate(ctx: LayoutContext, blocks: ArticleBlock[], columns: number, mode: string, hasSubtitle: boolean): FlowItem[][] {
  const rect = articleBodyRect(ctx, 0, columns, hasSubtitle);
  const colGap = ctx.cm(PAGE_GAP_CM);
  const colWidth = Math.floor((rect.width - colGap * (columns - 1)) / columns);
  const items = blocks.flatMap((block) => flowItemsForBlock(ctx, block, colWidth, mode));
  const pages: FlowItem[][] = [];
  let current: FlowItem[] = [];
  let pageIndex = 0;
  let col = 0;
  let usedInCol = 0;
  let colHeight = articleBodyRect(ctx, pageIndex, columns, hasSubtitle).height;

  const startNextPage = () => {
    if (current.length > 0) pages.push(current);
    current = [];
    pageIndex += 1;
    col = 0;
    usedInCol = 0;
    colHeight = articleBodyRect(ctx, pageIndex, columns, hasSubtitle).height;
  };

  for (const item of items) {
    const h = itemHeight(ctx, item);
    if (usedInCol > 0 && usedInCol + h > colHeight) {
      if (col < columns - 1) {
        col += 1;
        usedInCol = 0;
      } else {
        startNextPage();
      }
    }

    if (current.length === 0 && h > colHeight && item.kind === "image") {
      pages.push([item]);
      pageIndex += 1;
      col = 0;
      usedInCol = 0;
      colHeight = articleBodyRect(ctx, pageIndex, columns, hasSubtitle).height;
      continue;
    }

    current.push(item);
    usedInCol += h;
  }
  if (current.length > 0 || pages.length === 0) pages.push(current);
  return rebalanceFinalWidowPage(ctx, pages, columns);
}

function rebalanceFinalWidowPage(ctx: LayoutContext, pages: FlowItem[][], columns: number): FlowItem[][] {
  if (pages.length < 2) return pages;
  const last = pages[pages.length - 1]!;
  const previous = pages[pages.length - 2]!;
  const lastLines = textLineCount(last);
  if (lastLines === 0 || lastLines >= MIN_FINAL_PAGE_LINES) return pages;

  const wanted = MIN_FINAL_PAGE_LINES - lastLines;
  let movable = Math.min(wanted, Math.max(0, textLineCount(previous) - columns * 2));
  if (movable <= 0) return pages;

  const moved: FlowItem[] = [];
  while (movable > 0 && previous.length > 0) {
    const item = previous.pop()!;
    moved.unshift(item);
    if (item.kind === "line") movable -= 1;
  }
  if (moved.length > 0) last.unshift(...moved);
  return pages;
}

function textLineCount(items: FlowItem[]): number {
  return items.reduce((sum, item) => sum + (item.kind === "line" ? 1 : 0), 0);
}

function flowItemsForBlock(ctx: LayoutContext, block: ArticleBlock, colWidth: number, mode: string): FlowItem[] {
  if (block.type === "image") {
    const h = ctx.cm(block.heightCm ?? (mode === "handout" ? 4.0 : 5.2));
    return [{ kind: "image", image: block.image, caption: block.caption, height: h }];
  }
  if (block.type === "list") {
    return block.items.flatMap((item, i) => linesForText(ctx, item, styleFor(ctx, "list", mode), colWidth, i === block.items.length - 1));
  }
  return linesForText(ctx, block.text, styleFor(ctx, block.type, mode), colWidth, true);
}

function styleFor(ctx: LayoutContext, type: ArticleBlock["type"] | "list", mode: string): TextStyle {
  const bodySize = mode === "handout" ? 16 : 20;
  const bodyLine = mode === "handout" ? 30 : 32;
  const bodyAfter = mode === "essay" ? 10 : 7;
  const base: TextStyle = {
    sizeHalfPt: bodySize,
    lineSpacingHalfPt: bodyLine,
    spaceAfterHalfPt: bodyAfter,
    color: ctx.color("text-strong"),
  };
  if (type === "heading") return { ...base, sizeHalfPt: bodySize + 6, lineSpacingHalfPt: bodyLine + 8, spaceAfterHalfPt: 8, bold: true };
  if (type === "quote") return { ...base, italic: !ctx.cjk, color: ctx.color("brand-primary"), indentLevel: 1 };
  if (type === "note") return { ...base, sizeHalfPt: Math.max(14, bodySize - 2), lineSpacingHalfPt: bodyLine - 4, color: ctx.color("text-muted"), italic: !ctx.cjk };
  if (type === "code") return { ...base, sizeHalfPt: 14, lineSpacingHalfPt: 30, color: ctx.color("text-strong"), mono: true };
  if (type === "list") return { ...base, bullet: true, spaceAfterHalfPt: 4 };
  return base;
}

function linesForText(ctx: LayoutContext, text: string, style: TextStyle, colWidth: number, blockEnd: boolean): FlowItem[] {
  const cjk = isCjkDominant(text, ctx.cjk);
  const fontFace = style.mono ? ctx.font("mono") : cjk ? ctx.font("cjk") : ctx.font("latin");
  const runs = parseInline(text.replace(/\s+/g, " ").trim(), {
    sizeHalfPt: style.sizeHalfPt,
    color: style.color,
    fontFace,
    monoFont: ctx.font("mono"),
    cjk,
  }).map((r) => ({
    ...r,
    bold: style.bold ? true : r.bold,
    italic: style.italic ? true : r.italic,
    mono: style.mono ? true : r.mono,
  }));
  const lines = wrapRuns(runs, colWidth);
  return lines.map((line, i) => ({ kind: "line", runs: line, style, blockEnd: blockEnd && i === lines.length - 1 }));
}

function wrapRuns(runs: TextRun[], maxWidth: number): TextRun[][] {
  const tokens: TextRun[] = [];
  const widths: number[] = [];
  for (const run of runs) {
    for (const token of splitRunText(run.text)) {
      const next = { ...run, text: token };
      tokens.push(next);
      widths.push(measureText(token, next));
    }
  }
  const lines = optimalWrapTokens(tokens, widths, maxWidth);
  return lines.length > 0 ? lines : [[{ text: "", sizeHalfPt: 18 }]];
}

function optimalWrapTokens(tokens: TextRun[], widths: number[], maxWidth: number): TextRun[][] {
  const n = tokens.length;
  const prefix = new Array<number>(n + 1).fill(0);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + widths[i]!;

  const nextNonSpace = (i: number): number => {
    while (i < n && isSpaceRun(tokens[i]!)) i += 1;
    return i;
  };
  const prevNonSpace = (i: number): number => {
    while (i >= 0 && isSpaceRun(tokens[i]!)) i -= 1;
    return i;
  };

  const dp = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
  const nextBreak = new Array<number>(n + 1).fill(n);
  dp[n] = 0;

  for (let i0 = n - 1; i0 >= 0; i0--) {
    const i = nextNonSpace(i0);
    if (i >= n) {
      dp[i0] = 0;
      nextBreak[i0] = n;
      continue;
    }
    if (i !== i0) {
      dp[i0] = dp[i]!;
      nextBreak[i0] = nextBreak[i]!;
      continue;
    }

    for (let end = i; end < n; end++) {
      if (isSpaceRun(tokens[end]!)) continue;
      const width = prefix[end + 1]! - prefix[i]!;
      if (width > maxWidth && end > i) break;
      const next = nextNonSpace(end + 1);
      const isLast = next >= n;
      const slack = Math.max(0, maxWidth - Math.min(width, maxWidth));
      const slackRatio = slack / maxWidth;
      const shortLinePenalty = isLast ? 0 : Math.pow(slackRatio * 100, 2);
      const singleTokenPenalty = !isLast && i === end ? 2500 : 0;
      const punctuationPenalty = !isLast && startsWithClosingPunctuation(tokens[next]?.text ?? "") ? 5000 : 0;
      const cost = shortLinePenalty + singleTokenPenalty + punctuationPenalty + dp[next]!;
      if (cost < dp[i]!) {
        dp[i] = cost;
        nextBreak[i] = end + 1;
      }
    }
  }

  const lines: TextRun[][] = [];
  for (let i = nextNonSpace(0); i < n;) {
    const rawEnd = nextBreak[i]!;
    const end = prevNonSpace(rawEnd - 1);
    if (end < i) break;
    lines.push(mergeAdjacentRuns(tokens.slice(i, end + 1)));
    i = nextNonSpace(end + 1);
  }
  return lines;
}

function isSpaceRun(run: TextRun): boolean {
  return run.text.trim() === "";
}

function startsWithClosingPunctuation(text: string): boolean {
  return /^[,.;:!?，。！？；：）\]\}》”’]/.test(text);
}

function mergeAdjacentRuns(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const run of trimLine(runs)) {
    const last = out[out.length - 1];
    if (last && sameRunStyle(last, run)) {
      last.text += run.text;
    } else {
      out.push({ ...run });
    }
  }
  return out;
}

function sameRunStyle(a: TextRun, b: TextRun): boolean {
  return a.bold === b.bold &&
    a.italic === b.italic &&
    a.mono === b.mono &&
    a.underline === b.underline &&
    a.sizeHalfPt === b.sizeHalfPt &&
    a.color === b.color &&
    a.fontFace === b.fontFace &&
    a.cjk === b.cjk &&
    a.hyperlink === b.hyperlink;
}

function splitRunText(text: string): string[] {
  const out: string[] = [];
  let word = "";
  for (const ch of text) {
    if (/\s/.test(ch)) {
      if (word) out.push(word);
      out.push(" ");
      word = "";
    } else if (isCjkChar(ch) || isPunctuation(ch)) {
      if (word) out.push(word);
      out.push(ch);
      word = "";
    } else {
      word += ch;
    }
  }
  if (word) out.push(word);
  return out;
}

function trimLine(runs: TextRun[]): TextRun[] {
  const copy = runs.map((r) => ({ ...r }));
  while (copy.length > 0 && copy[0]!.text.trim() === "") copy.shift();
  while (copy.length > 0 && copy[copy.length - 1]!.text.trim() === "") copy.pop();
  return copy.length > 0 ? copy : runs;
}

function measureText(text: string, run: TextRun): number {
  const fontPt = (run.sizeHalfPt ?? 18) / 2;
  let units = 0;
  for (const ch of text) {
    if (ch === " ") units += 0.32;
    else if (isCjkChar(ch)) units += 1.0;
    else if (isPunctuation(ch)) units += 0.45;
    else if (/[A-Z0-9]/.test(ch)) units += 0.62;
    else units += 0.54;
  }
  const styleFactor = run.bold ? 1.06 : 1;
  return Math.ceil(units * fontPt * 12700 * styleFactor);
}

function isCjkChar(ch: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/.test(ch);
}

function isCjkDominant(text: string, deckIsCjk: boolean): boolean {
  if (!deckIsCjk) return false;
  let cjk = 0;
  let latin = 0;
  for (const ch of text) {
    if (isCjkChar(ch)) cjk += 1;
    else if (/[A-Za-z]/.test(ch)) latin += 1;
  }
  return cjk > 0 && cjk >= latin * 0.35;
}

function isPunctuation(ch: string): boolean {
  return /[，。！？；：、,.!?;:()[\]（）《》“”‘’"'—-]/.test(ch);
}

function itemHeight(ctx: LayoutContext, item: FlowItem): number {
  if (item.kind === "image") return item.height + (item.caption ? ctx.cm(0.7) : 0) + ctx.cm(0.25);
  return ctx.pt(item.style.lineSpacingHalfPt / 2) + (item.blockEnd ? ctx.pt(item.style.spaceAfterHalfPt / 2) : 0);
}

function renderArticlePage(ctx: LayoutContext, opts: {
  title: string;
  subtitle?: string;
  page: FlowItem[];
  pageIndex: number;
  pageCount: number;
  columns: number;
  mode: string;
  showMarker: boolean;
}): ShapeList {
  const out: ShapeList = [];
  const titleSuffix = opts.pageCount > 1 ? ` (${opts.pageIndex + 1}/${opts.pageCount})` : "";
  out.push(...slideTitle(ctx, `${opts.title}${titleSuffix}`, {
    sizeHalfPt: opts.pageIndex === 0 ? 38 : 32,
    y: ctx.cm(TITLE_Y_CM),
    rule: false,
  }));
  if (opts.subtitle && opts.pageIndex === 0) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: ctx.cm(2), y: ctx.cm(SUBTITLE_Y_CM), cx: ctx.deck.width - ctx.cm(4), cy: ctx.cm(0.5) },
      valign: "middle",
      paragraphs: [{ align: "left", runs: [{ text: opts.subtitle, sizeHalfPt: 18, color: ctx.color("text-muted"), cjk: ctx.cjk, fontFace: ctx.cjk ? ctx.font("cjk") : ctx.font("latin") }] }],
    });
  }
  const rect = articleBodyRect(ctx, opts.pageIndex, opts.columns, !!opts.subtitle);
  const gap = ctx.cm(PAGE_GAP_CM);
  const colW = Math.floor((rect.width - gap * (opts.columns - 1)) / opts.columns);
  const colH = rect.height;
  const columnItems = splitPageIntoColumns(ctx, opts.page, opts.columns, colH);

  const flushLines = (col: number, lineBuffer: Array<{ item: Extract<FlowItem, { kind: "line" }>; y: number }>) => {
    if (lineBuffer.length === 0) return;
    const firstY = lineBuffer[0]!.y;
    const last = lineBuffer[lineBuffer.length - 1]!;
    const height = last.y - firstY + itemHeight(ctx, last.item);
    out.push(textShapeForLines(ctx, {
      x: rect.x + col * (colW + gap),
      y: firstY,
      width: colW,
      height,
    }, lineBuffer.map((l) => l.item)));
  };

  columnItems.forEach((items, col) => {
    let y = rect.y;
    let lineBuffer: Array<{ item: Extract<FlowItem, { kind: "line" }>; y: number }> = [];
    for (const item of items) {
      const h = itemHeight(ctx, item);
      if (item.kind === "line") {
        lineBuffer.push({ item, y });
        y += h;
      } else {
        flushLines(col, lineBuffer);
        lineBuffer = [];
        const x = rect.x + col * (colW + gap);
        out.push(...imageOrPlaceholder(ctx, { x, y, width: colW, height: item.height }, { ...item.image, fit: item.image.fit ?? "contain" }));
        y += item.height;
        if (item.caption) {
          out.push({
            type: "text",
            id: ctx.id(),
            xfrm: { x, y: y + ctx.cm(0.05), cx: colW, cy: ctx.cm(0.55) },
            paragraphs: [{ align: "center", runs: [{ text: item.caption, sizeHalfPt: 14, color: ctx.color("text-muted"), cjk: ctx.cjk, fontFace: ctx.cjk ? ctx.font("cjk") : ctx.font("latin") }] }],
          });
          y += ctx.cm(0.65);
        }
        y += ctx.cm(0.25);
      }
    }
    flushLines(col, lineBuffer);
  });

  if (opts.showMarker && opts.pageCount > 1) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: ctx.deck.width - ctx.cm(3.2), y: ctx.deck.height - ctx.cm(1.0), cx: ctx.cm(1.6), cy: ctx.cm(0.45) },
      valign: "middle",
      paragraphs: [{ align: "right", runs: [{ text: `${opts.pageIndex + 1}/${opts.pageCount}`, sizeHalfPt: 14, color: ctx.color("text-muted"), fontFace: ctx.font("latin") }] }],
    });
  }
  return out;
}

function splitPageIntoColumns(ctx: LayoutContext, items: FlowItem[], columns: number, colHeight: number): FlowItem[][] {
  const out = Array.from({ length: columns }, () => [] as FlowItem[]);
  if (columns <= 1 || items.length === 0) {
    out[0] = items;
    return out;
  }

  const heights = items.map((item) => itemHeight(ctx, item));
  const suffix = new Array<number>(items.length + 1).fill(0);
  for (let i = items.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1]! + heights[i]!;

  let col = 0;
  let used = 0;
  let target = Math.min(colHeight, Math.ceil(suffix[0]! / columns));
  for (let i = 0; i < items.length; i++) {
    const h = heights[i]!;
    const canMove = col < columns - 1 && suffix[i]! <= (columns - col - 1) * colHeight;
    if (used > 0 && canMove && (used + h > colHeight || used + h > target)) {
      col += 1;
      used = 0;
      target = Math.min(colHeight, Math.ceil(suffix[i]! / (columns - col)));
    }
    out[col]!.push(items[i]!);
    used += h;
  }
  return out;
}

function textShapeForLines(ctx: LayoutContext, rect: { x: number; y: number; width: number; height: number }, lines: Extract<FlowItem, { kind: "line" }>[]) {
  const paragraphs: Paragraph[] = lines.map((line) => ({
    align: paragraphAlignForLine(line),
    runs: line.style.bullet
      ? [{ text: `${ctx.style.bullets?.glyph ?? "•"}  `, sizeHalfPt: line.style.sizeHalfPt, color: ctx.color(ctx.style.bullets?.color ?? "brand-primary"), fontFace: ctx.cjk ? ctx.font("cjk") : ctx.font("latin"), bold: true }, ...line.runs]
      : line.runs,
    lineSpacingHalfPt: line.style.lineSpacingHalfPt,
    spaceAfterHalfPt: line.blockEnd ? line.style.spaceAfterHalfPt : undefined,
    indentLevel: line.style.indentLevel,
  }));
  return {
    type: "text" as const,
    id: ctx.id(),
    xfrm: { x: rect.x, y: rect.y, cx: rect.width, cy: rect.height },
    valign: "top" as const,
    margin: { l: 0, r: 0, t: 0, b: 0 },
    paragraphs,
  };
}

function paragraphAlignForLine(line: Extract<FlowItem, { kind: "line" }>): Paragraph["align"] {
  if (line.blockEnd || line.style.bullet || line.style.mono) return "left";
  return line.runs.some((run) => run.text.trim().includes(" ")) ? "justify" : "left";
}

function articleBodyTop(ctx: LayoutContext, pageIndex: number, hasSubtitle: boolean): number {
  if (pageIndex === 0) return ctx.cm(hasSubtitle ? FIRST_PAGE_WITH_SUBTITLE_TOP_CM : FIRST_PAGE_TOP_CM);
  return ctx.cm(CONTINUATION_TOP_CM);
}

function articleBodyRect(ctx: LayoutContext, pageIndex: number, _columns: number, hasSubtitle: boolean) {
  return contentRect(ctx, {
    top: articleBodyTop(ctx, pageIndex, hasSubtitle),
    marginX: ctx.cm(BODY_MARGIN_X_CM),
    bottom: ctx.cm(BODY_BOTTOM_SAFE_CM),
  });
}
