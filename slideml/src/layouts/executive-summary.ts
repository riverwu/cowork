import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { chipColorResolver, contentRect, slideTitle } from "../render/primitives.js";
import { parseInline } from "../render/markdown-inline.js";

/**
 * TL;DR / executive-summary clipboard. A title + 3–6 entries, each a
 * `{ heading, line }` pair: bold short heading on one line, one
 * descriptive sentence below. Quieter than `key-point` (no icons, no
 * centered hero treatment) — designed for report front-pages, board
 * decision summaries, release notes.
 */
export const slots: Record<string, SlotSchema> = {
  title: { type: "text",    maxChars: 42, optional: true },
  items: { type: "bullets", min: 2, max: 6, itemMaxChars: 168 },
};

interface ItemRaw {
  heading?: string;
  line?: string;
  text?: string;          // accepted alias when both heading and line are merged
}

const executiveSummary: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const rawItems = (ctx.slot<unknown[]>("items") ?? []) as Array<ItemRaw | string>;
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const monoFont = ctx.font("mono");
  const resolveChipColor = chipColorResolver(ctx);

  if (title) out.push(...slideTitle(ctx, title));

  const top = title ? ctx.cm(4.4) : ctx.cm(2);
  const body = contentRect(ctx, { top, marginX: ctx.cm(2.4), bottom: ctx.cm(1.6) });
  // Item gap shrinks with count so each item retains enough vertical
  // room for {heading + line} at readable size. With 5 items at gap
  // 0.5cm, itemH ≈ 1.26cm and the line sub-region collapsed to <0.4cm —
  // autoFit then crushed body text to ~5pt. Smaller gap at higher
  // counts gives the same visual rhythm but keeps body legible.
  const n = Math.max(1, rawItems.length);
  const itemGap = n <= 3 ? ctx.cm(0.6) : n <= 5 ? ctx.cm(0.3) : ctx.cm(0.2);
  const itemH = Math.floor((body.height - itemGap * (n - 1)) / n);
  // Per-count typography: 2-3 items get full hierarchy; 4-6 items
  // tighten to keep both heading + line readable.
  const headingSize = n <= 3 ? 28 : n <= 5 ? 24 : 22;
  const headingCyEmu = n <= 3 ? ctx.cm(0.9) : ctx.cm(0.7);
  const lineSize = n <= 3 ? 22 : n <= 5 ? 20 : 18;
  const lineSpacing = n <= 3 ? 48 : 36;

  rawItems.forEach((raw, idx) => {
    const item: ItemRaw = typeof raw === "string" ? { heading: raw } : raw;
    const y = body.y + idx * (itemH + itemGap);
    // Short accent rule on the left, in brand colour. Earlier numbered
    // index (01/02/03) read as a TOC, but this layout is for end-of-deck
    // summaries where ordering is rhetorical, not navigational.
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "rect",
      xfrm: { x: body.x, y: y + ctx.cm(0.3), cx: ctx.cm(0.9), cy: ctx.cm(0.12) },
      fill: { type: "solid", color: ctx.color("brand-primary") },
    });
    // Heading
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: body.x + ctx.cm(1.4), y, cx: body.width - ctx.cm(1.4), cy: headingCyEmu },
      valign: "top",
      paragraphs: [{
        align: "left",
        runs: parseInline(item.heading ?? item.text ?? "", {
          sizeHalfPt: headingSize,
          color: ctx.color("text-strong"),
          fontFace,
          monoFont,
          cjk: ctx.cjk,
          resolveChipColor,
        }).map((r) => ({ ...r, bold: r.bold ?? true })),
      }],
    });
    // Line / explanation — sized so natural height fits the remaining
    // item height without triggering autoFit shrink. The (lineSize, gap)
    // combo above is calibrated so 1 line of CJK at the cell width has
    // natural height ≈ itemH - headingCy - small slack.
    if (item.line) {
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: body.x + ctx.cm(1.4), y: y + headingCyEmu, cx: body.width - ctx.cm(1.4), cy: itemH - headingCyEmu },
        valign: "top",
        // Zero text-frame margins so the available cy is fully usable
        // (default OOXML margins consume ~0.13cm top + bottom, which is
        // enough to push autoFit into aggressive shrink at high counts).
        margin: { l: 0, t: 0, r: 0, b: 0 },
        autoFit: "shrink",
        paragraphs: [{
          align: "left",
          lineSpacingHalfPt: lineSpacing,
          runs: parseInline(item.line, {
            sizeHalfPt: lineSize,
            color: ctx.color("text-muted"),
            fontFace,
            monoFont,
            cjk: ctx.cjk,
            resolveChipColor,
          }),
        }],
      });
    }
  });

  return out;
};

export default executiveSummary;
