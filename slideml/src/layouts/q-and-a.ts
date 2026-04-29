import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { Paragraph, ShapeList, TextRun } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { chipColorResolver, contentRect, slideTitle } from "../render/primitives.js";
import { parseInline, type ChipKind } from "../render/markdown-inline.js";

/**
 * Question list — N prompt + response/detail pairs. Defaults to neutral
 * labels so authors can emit exam questions, answer choices, prompts, FAQ
 * entries, and review notes without injected Q/A text.
 */
export const slots: Record<string, SlotSchema> = {
  title:  { type: "text",    maxChars: 42, optional: true },
  labels: { type: "enum", values: ["none", "qa"], default: "none", optional: true },
  items:  { type: "bullets", min: 1, max: 5, itemMaxChars: 280 },
};

interface QuestionItem {
  q?: string;
  question?: string;
  label?: string;
  prompt?: string;
  detail?: string;
  a?: string;
  answer?: string;
  response?: string;
  explanation?: string;
}

interface NormalizedQuestion {
  q: string;
  a: string;
}

const QUESTION_LINE_CM = 0.50;
const ANSWER_LINE_CM = 0.45;
const QUESTION_INSET_CM = 0.10;
const ANSWER_INSET_CM = 0.12;
const PAIR_GAP_CM = 0.28;
const MIN_SCALE = 0.86;

const questionList: LayoutFn = (ctx: LayoutContext): ShapeList | ShapeList[] => {
  const rawItems = (ctx.slot<unknown[]>("items") ?? []) as Array<QuestionItem | string>;
  const items = rawItems.map(normalizeQuestionItem).filter((item) => item.q || item.a);
  const pages = paginateQuestions(ctx, items);
  const rendered = pages.map((pageItems, pageIndex) => renderQuestionPage(ctx, pageItems, pageIndex, pages.length));
  return rendered.length === 1 ? rendered[0]! : rendered;
};

export default questionList;

function renderQuestionPage(ctx: LayoutContext, items: NormalizedQuestion[], pageIndex: number, pageCount: number): ShapeList {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const labels = ctx.slot<string>("labels") ?? "none";
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const monoFont = ctx.font("mono");
  const resolveChipColor = chipColorResolver(ctx);

  if (title) {
    const continuation = pageCount > 1 && pageIndex > 0 ? ` (${pageIndex + 1}/${pageCount})` : "";
    out.push(...slideTitle(ctx, `${title}${continuation}`));
  }

  const body = questionBodyRect(ctx, !!title);
  const naturalH = pageHeightCm(ctx, items);
  const bodyHcm = body.height / 360000; // EMU → cm
  const scale = Math.max(MIN_SCALE, Math.min(1, bodyHcm / Math.max(1, naturalH)));
  const Q_LINE_H = ctx.cm(QUESTION_LINE_CM * scale);
  const Q_INSET = ctx.cm(QUESTION_INSET_CM * scale);
  const A_LINE_H = ctx.cm(ANSWER_LINE_CM * scale);
  const A_INSET = ctx.cm(ANSWER_INSET_CM * scale);
  const PAIR_GAP = ctx.cm(PAIR_GAP_CM * scale);
  const qLineSpacingHalfPt = Math.max(26, Math.round(30 * scale));
  const lineSpacingHalfPt = Math.max(24, Math.round(28 * scale));
  const qSize = Math.max(20, Math.round(22 * scale));
  const aSize = Math.max(18, Math.round(20 * scale));

  let yCursor = body.y;

  items.forEach(({ q, a }, idx) => {
    const qLines = lineCountFor(q);
    const aLines = lineCountFor(a);
    const qH = Q_LINE_H * qLines + Q_INSET;
    const aH = aLines > 0 ? A_LINE_H * aLines + A_INSET : 0;
    const y = yCursor;
    const qPrefix = labels === "qa" ? "Q. " : "";
    const aPrefix = labels === "qa" ? "A. " : "";
    const qParagraphs = textParagraphs(q, {
      prefix: qPrefix,
      prefixColor: ctx.color("brand-primary"),
      prefixItalic: false,
      sizeHalfPt: qSize,
      color: ctx.color("text-strong"),
      bold: true,
      fontFace,
      monoFont,
      cjk: ctx.cjk,
      lineSpacingHalfPt: qLineSpacingHalfPt,
      resolveChipColor,
    });

    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: body.x, y, cx: body.width, cy: qH },
      valign: "top",
      autoFit: "shrink",
      paragraphs: qParagraphs,
    });
    if (a) {
      const answerIndent = labels === "qa" ? ctx.cm(0.6) : ctx.cm(0.35);
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: body.x + answerIndent, y: y + qH, cx: body.width - answerIndent, cy: aH },
        valign: "top",
        autoFit: "shrink",
        paragraphs: textParagraphs(a, {
          prefix: aPrefix,
          prefixColor: ctx.color("text-muted"),
          prefixItalic: true,
          sizeHalfPt: aSize,
          color: ctx.color("text-strong"),
          bold: false,
          fontFace,
          monoFont,
          cjk: ctx.cjk,
          lineSpacingHalfPt,
          resolveChipColor,
        }),
      });
    }

    yCursor += qH + aH + (idx < items.length - 1 ? PAIR_GAP : 0);
  });

  return out;
}

function questionBodyRect(ctx: LayoutContext, hasTitle: boolean) {
  return contentRect(ctx, { top: hasTitle ? ctx.cm(2.55) : ctx.cm(1.6), marginX: ctx.cm(2), bottom: ctx.cm(1.35) });
}

function paginateQuestions(ctx: LayoutContext, items: NormalizedQuestion[]): NormalizedQuestion[][] {
  const body = questionBodyRect(ctx, !!ctx.slot<string>("title"));
  const bodyHcm = body.height / 360000;
  const pages: NormalizedQuestion[][] = [];
  let current: NormalizedQuestion[] = [];
  let used = 0;

  for (const item of items) {
    const h = itemHeightCm(item, current.length > 0);
    if (current.length > 0 && used + h > bodyHcm) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(item);
    used += itemHeightCm(item, current.length > 1);
  }
  if (current.length > 0 || pages.length === 0) pages.push(current);
  return pages;
}

function pageHeightCm(ctx: LayoutContext, items: NormalizedQuestion[]): number {
  void ctx;
  return items.reduce((sum, item, idx) => sum + itemHeightCm(item, idx > 0), 0);
}

function itemHeightCm(item: NormalizedQuestion, includeGap: boolean): number {
  const qLines = lineCountFor(item.q);
  const aLines = lineCountFor(item.a);
  return (includeGap ? PAIR_GAP_CM : 0)
    + qLines * QUESTION_LINE_CM + QUESTION_INSET_CM
    + (aLines > 0 ? aLines * ANSWER_LINE_CM + ANSWER_INSET_CM : 0);
}

function lineCountFor(text: string): number {
  if (!text) return 0;
  return text.split("\n").reduce((sum, line) => {
    const trimmed = line.trim();
    const len = [...trimmed].length;
    if (len === 0) return sum + 0.45;
    const charsPerLine = isCjkDominant(trimmed) ? 36 : 92;
    return sum + Math.max(1, Math.ceil(len / charsPerLine));
  }, 0);
}

function isCjkDominant(text: string): boolean {
  let cjk = 0;
  let latin = 0;
  for (const ch of text) {
    if (/[\u3400-\u9FFF\uF900-\uFAFF]/u.test(ch)) cjk += 1;
    else if (/[A-Za-z0-9]/.test(ch)) latin += 1;
  }
  return cjk > latin;
}

function normalizeQuestionItem(raw: QuestionItem | string): { q: string; a: string } {
  if (typeof raw === "string") return { q: raw, a: "" };

  const qParts = [
    raw.label,
    raw.q ?? raw.question ?? raw.prompt,
    raw.detail,
  ].filter(isNonEmptyString);
  const aParts = [
    raw.a ?? raw.answer ?? raw.response,
    raw.explanation,
  ].filter(isNonEmptyString);

  return {
    q: qParts.join("\n"),
    a: aParts.join("\n"),
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function textParagraphs(
  text: string,
  opts: {
    prefix: string;
    prefixColor: string;
    prefixItalic: boolean;
    sizeHalfPt: number;
    color: string;
    bold: boolean;
    fontFace: string;
    monoFont: string;
    cjk: boolean;
    lineSpacingHalfPt: number;
    resolveChipColor: (kind: ChipKind) => string | undefined;
  },
): Paragraph[] {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    const runs: TextRun[] = [];
    if (i === 0 && opts.prefix) {
      runs.push({
        text: opts.prefix,
        sizeHalfPt: opts.sizeHalfPt,
        color: opts.prefixColor,
        italic: opts.prefixItalic,
        bold: !opts.prefixItalic,
        fontFace: opts.fontFace,
      });
    }
    runs.push(...parseInline(line, {
      sizeHalfPt: opts.sizeHalfPt,
      color: opts.color,
      fontFace: opts.fontFace,
      monoFont: opts.monoFont,
      cjk: opts.cjk,
      resolveChipColor: opts.resolveChipColor,
    }).map((r) => ({ ...r, bold: opts.bold ? (r.bold ?? true) : r.bold })));
    return {
      align: "left" as const,
      lineSpacingHalfPt: opts.lineSpacingHalfPt,
      runs,
    };
  });
}
