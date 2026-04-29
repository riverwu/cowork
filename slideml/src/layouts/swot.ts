import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { bulletsBlock, contentRect, slideTitle } from "../render/primitives.js";

/**
 * SWOT analysis — fixed 4-quadrant Strengths / Weaknesses /
 * Opportunities / Threats framework. Distinct from `matrix-2x2` which
 * is generic axis-labelled quadrants; SWOT has FIXED canonical labels
 * and a fixed color semantic (S+O = positive/green, W+T = negative/red).
 *
 * Each quadrant accepts a bullets list (3–6 short items). The header
 * band shows the canonical label translated to the deck's language
 * (English: Strengths/Weaknesses/Opportunities/Threats; Chinese: 优势
 * /劣势/机会/威胁) — overridable via per-quadrant `title` field if the
 * agent prefers a custom phrasing.
 *
 * Use this for strategic analysis slides. Use `matrix-2x2` for
 * arbitrary 2-axis frameworks (priority×effort, etc).
 */
export const slots: Record<string, SlotSchema> = {
  title:         { type: "text",    maxChars: 42, optional: true },
  strengths:     { type: "bullets", min: 1, max: 6, itemMaxChars: 84 },
  weaknesses:    { type: "bullets", min: 1, max: 6, itemMaxChars: 84 },
  opportunities: { type: "bullets", min: 1, max: 6, itemMaxChars: 84 },
  threats:       { type: "bullets", min: 1, max: 6, itemMaxChars: 84 },
};

// Quadrant labels + icon glyphs are universal; their COLOR is theme-
// coordinated via ctx.semantic(...) so a forest theme can swap to
// varying greens, midnight to muted tones, etc. See ctx.style.semantic
// + ctx.style.chips overrides.
const QUADRANT = {
  strengths:     { en: "Strengths",     cjk: "优势", semantic: "positive", icon: "+" },
  weaknesses:    { en: "Weaknesses",    cjk: "劣势", semantic: "negative", icon: "−" },
  opportunities: { en: "Opportunities", cjk: "机会", semantic: "info",     icon: "↗" },
  threats:       { en: "Threats",       cjk: "威胁", semantic: "warning",  icon: "!" },
} as const;

type QuadKey = keyof typeof QUADRANT;

const swot: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title") ?? (ctx.cjk ? "SWOT 分析" : "SWOT Analysis");
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  out.push(...slideTitle(ctx, title));

  const top = ctx.cm(4.4);
  const body = contentRect(ctx, { top, marginX: ctx.cm(2), bottom: ctx.cm(1.6) });
  const gap = ctx.cm(0.4);
  const cellW = Math.floor((body.width - gap) / 2);
  const cellH = Math.floor((body.height - gap) / 2);
  const headerH = ctx.cm(1.0);

  const order: ReadonlyArray<{ key: QuadKey; row: 0 | 1; col: 0 | 1 }> = [
    { key: "strengths",     row: 0, col: 0 },
    { key: "weaknesses",    row: 0, col: 1 },
    { key: "opportunities", row: 1, col: 0 },
    { key: "threats",       row: 1, col: 1 },
  ];

  for (const { key, row, col } of order) {
    const items = (ctx.slot<unknown[]>(key) ?? []).slice(0, 6);
    const meta = QUADRANT[key];
    const x = body.x + col * (cellW + gap);
    const y = body.y + row * (cellH + gap);
    const semColor = ctx.semantic(meta.semantic as "positive" | "negative" | "info" | "warning");

    // Quadrant card — theme-coordinated bg-card backing with a header
    // band painted in the resolved semantic color (theme-overridable).
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "roundRect",
      xfrm: { x, y, cx: cellW, cy: cellH },
      fill: { type: "solid", color: ctx.color("bg-card") },
      line: { color: ctx.color("divider"), width: ctx.pt(0.5) },
      cornerRadius: ctx.style.surface.cornerRadius,
    });
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "rect",
      xfrm: { x, y, cx: cellW, cy: headerH },
      fill: { type: "solid", color: semColor },
      line: { color: semColor, width: 0 },
    });
    // Header text — semantic icon + canonical label, white on colored band.
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: x + ctx.cm(0.6), y, cx: cellW - ctx.cm(1.2), cy: headerH },
      valign: "middle",
      paragraphs: [{
        align: "left",
        runs: [
          { text: `${meta.icon}  `, sizeHalfPt: 28, color: "FFFFFF", bold: true, fontFace: ctx.font("latin") },
          { text: ctx.cjk ? meta.cjk : meta.en, sizeHalfPt: 26, color: "FFFFFF", bold: true, cjk: ctx.cjk, fontFace },
        ],
      }],
    });
    // Bullets — sit below the header, room for 3-6 short items.
    const inset = ctx.cm(0.5);
    out.push(...bulletsBlock(ctx, {
      x: x + inset,
      y: y + headerH + ctx.cm(0.3),
      width: cellW - inset * 2,
      height: cellH - headerH - ctx.cm(0.6),
    }, items, { sizeHalfPt: 22, lineSpacingHalfPt: 36, spaceAfterHalfPt: 8 }));
  }

  return out;
};

export default swot;
