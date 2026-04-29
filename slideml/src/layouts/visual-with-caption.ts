import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { bestTextOn, bodyTopAfterTitle, chipColorResolver, richText, slideTitle } from "../render/primitives.js";
import { parseInline } from "../render/markdown-inline.js";
import { coerceVisual, renderVisual } from "../render/visual.js";

/**
 * Visual + bottom text annotation. The `style` slot picks the visual
 * treatment of the bottom block:
 *   - "caption" (default): italic muted text, optional uppercase credit.
 *     Editorial / documentary feel — descriptions, attributions.
 *   - "takeaway": branded brand-deep panel with brand-primary border and
 *     bold inverse text. Presentation feel — conclusions, key insights.
 *
 * The top slot is `visual` — accepts image | chart | table | svg via the
 * tagged Visual union (or legacy un-tagged image-ref / chart-spec / table
 * shapes). This single layout replaces:
 *   - image-with-caption (image + italic caption)        — style=caption
 *   - image-with-takeaway (image + brand panel)          — style=takeaway
 *   - chart-with-takeaway (chart + brand panel)          — visual.kind=chart
 *
 * Back-compat: legacy `image` slot still accepted as an alias for
 * `visual` (coerced via coerceVisual).
 */
export const slots: Record<string, SlotSchema> = {
  title:   { type: "text",       maxChars: 42, optional: true },
  visual:  { type: "visual",     optional: true },
  image:   { type: "image-ref",  optional: true },  // back-compat alias for visual
  caption: { type: "text-block", maxChars: 224 },
  credit:  { type: "text",       maxChars: 56, optional: true },
  style:   { type: "enum",       values: ["caption", "takeaway"], default: "caption", optional: true },
};

const visualWithCaption: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const visual = coerceVisual(ctx.slot<unknown>("visual") ?? ctx.slot<unknown>("image"));
  const caption = ctx.slot<unknown>("caption");
  const credit = ctx.slot<string>("credit");
  const style = (ctx.slot<string>("style") ?? "caption") as "caption" | "takeaway";
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  if (title) out.push(...slideTitle(ctx, title));

  // Visual is horizontally centered on the slide. Width is wider for
  // chart/table (data needs space for axes/columns) and narrower for
  // image (typical photo aspect tolerates a 62% column).
  const visualW = visual && (visual.kind === "chart" || visual.kind === "table")
    ? Math.floor(ctx.deck.width - ctx.cm(4))
    : Math.floor(ctx.deck.width * 0.62);
  const visualX = ctx.centerH(visualW);
  const visualY = title ? bodyTopAfterTitle(ctx, title) : ctx.cm(1.8);
  // Bottom block height differs by style: takeaway is a tighter panel,
  // caption gets more vertical room for multi-line italic text.
  const bottomH = style === "takeaway" ? ctx.cm(2.0) : ctx.cm(2.6);
  const creditH = credit && style === "caption" ? ctx.cm(0.9) : 0;
  const visualH = ctx.deck.height - visualY - bottomH - creditH - ctx.cm(1.2);
  if (visual) {
    out.push(...renderVisual(ctx, { x: visualX, y: visualY, width: visualW, height: visualH }, visual));
  }

  const bottomY = visualY + visualH + ctx.cm(0.5);
  if (style === "takeaway" && caption) {
    // Branded callout panel — single shape carrying fill + border + text.
    const panelColor = ctx.color("brand-deep");
    const takeawayTextColor = bestTextOn(ctx, panelColor);
    const text = typeof caption === "string" ? caption : String(caption);
    const runs = parseInline(text, {
      sizeHalfPt: 26,
      color: takeawayTextColor,
      fontFace,
      monoFont: ctx.font("mono"),
      cjk: ctx.cjk,
      resolveChipColor: chipColorResolver(ctx),
    }).map((r) => ({ ...r, bold: r.bold ?? true }));
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: visualX, y: bottomY, cx: visualW, cy: bottomH },
      valign: "middle",
      autoFit: "shrink",
      cornerRadius: 0.05,
      fill: { type: "solid", color: panelColor },
      line: { color: ctx.color("brand-primary"), width: ctx.pt(1) },
      margin: { l: ctx.cm(0.6), r: ctx.cm(0.6), t: ctx.cm(0.3), b: ctx.cm(0.3) },
      paragraphs: [{ align: "left", runs }],
    });
  } else {
    // Italic editorial caption.
    out.push(...richText(ctx, {
      x: visualX,
      y: bottomY,
      width: visualW,
      height: bottomH,
    }, caption, {
      sizeHalfPt: 22,
      italic: true,
      color: "text-strong",
      lineSpacingHalfPt: 50,
      align: "center",
      autoFit: "shrink",
    }));

    if (credit) {
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: visualX, y: ctx.deck.height - ctx.cm(1.4), cx: visualW, cy: ctx.cm(0.7) },
        valign: "top",
        paragraphs: [{
          align: "center",
          runs: [{
            text: credit.toUpperCase(),
            sizeHalfPt: 14,
            color: ctx.color("text-muted"),
            fontFace,
            cjk: ctx.cjk,
          }],
        }],
      });
    }
  }

  return out;
};

export default visualWithCaption;
