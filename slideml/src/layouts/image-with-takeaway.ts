import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import {
  bestTextOn,
  bodyTopAfterTitle,
  chipColorResolver,
  imageOrPlaceholder,
  imageRefOf,
  slideTitle,
} from "../render/primitives.js";
import { parseInline } from "../render/markdown-inline.js";

/**
 * Static-image counterpart to `chart-with-takeaway`. Use when you have
 * an image (a rendered chart, diagram, photo, screenshot) — NOT typed
 * chart-spec data — and want to surface a one-line conclusion below it.
 *
 * Same takeaway visual as chart-with-takeaway: a brand-deep callout
 * panel with brand-primary border, white-or-text-strong body text.
 */
export const slots: Record<string, SlotSchema> = {
  title:    { type: "text",            maxChars: 50, optional: true },
  image:    { type: "image-ref" },
  takeaway: { type: "markdown-inline", maxChars: 160, optional: true },
};

const imageWithTakeaway: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const image = imageRefOf(ctx.slot<unknown>("image"));
  const takeaway = ctx.slot<string>("takeaway");
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  if (title) out.push(...slideTitle(ctx, title));

  const imageTop = bodyTopAfterTitle(ctx, title);
  const takeawayHeight = takeaway ? ctx.cm(2.0) : 0;
  const imageHeight =
    ctx.deck.height - imageTop - ctx.cm(2) - takeawayHeight - (takeaway ? ctx.cm(0.4) : 0);

  out.push(...imageOrPlaceholder(ctx, {
    x: ctx.cm(2),
    y: imageTop,
    width: ctx.deck.width - ctx.cm(4),
    height: imageHeight,
  }, image));

  if (takeaway) {
    const pos = {
      x: ctx.cm(2),
      y: imageTop + imageHeight + ctx.cm(0.4),
      cx: ctx.deck.width - ctx.cm(4),
      cy: takeawayHeight,
    };
    const panelColor = ctx.color("brand-deep");
    const takeawayTextColor = bestTextOn(ctx, panelColor);
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "roundRect",
      xfrm: pos,
      fill: { type: "solid", color: panelColor },
      line: { color: ctx.color("brand-primary"), width: ctx.pt(1) },
      cornerRadius: 0.05,
    });
    const takeawayRuns = parseInline(takeaway, {
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
      xfrm: pos,
      valign: "middle",
      margin: { l: ctx.cm(0.6), r: ctx.cm(0.6), t: ctx.cm(0.3), b: ctx.cm(0.3) },
      paragraphs: [{
        align: "left",
        runs: takeawayRuns,
      }],
    });
  }

  return out;
};

export default imageWithTakeaway;
