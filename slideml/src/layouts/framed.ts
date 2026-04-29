import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { renderRegion, type Region } from "../render/regions.js";

/**
 * Five-region layout with optional edge bands.
 *
 *   ┌───────────── header ─────────────┐
 *   ├─────┬─────────────────────┬──────┤
 *   │ L   │      center         │  R   │
 *   │ E   │                     │  E   │
 *   │ D   │                     │  D   │
 *   ├─────┴─────────────────────┴──────┤
 *   └───────────── footer ─────────────┘
 *
 * Use when a single slide needs MORE than the standard chrome — e.g. a
 * persistent context strip on the left, a callout strip on the right,
 * or a footer with extra metadata that the global page-footer chrome
 * can't carry.
 *
 * Each edge slot is a polymorphic `region` (one of 8 kinds:
 * kpi/chart/table/text/bullets/image/code/quote). `center` is required;
 * the four edges are optional and the center expands to fill any
 * unused edge space.
 */
export const slots: Record<string, SlotSchema> = {
  title:     { type: "text",   maxChars: 35, optional: true },
  header:    { type: "region", optional: true },
  footer:    { type: "region", optional: true },
  leftEdge:  { type: "region", optional: true },
  rightEdge: { type: "region", optional: true },
  center:    { type: "region" },
};

const framed: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const header = ctx.slot<Region>("header");
  const footer = ctx.slot<Region>("footer");
  const leftEdge = ctx.slot<Region>("leftEdge");
  const rightEdge = ctx.slot<Region>("rightEdge");
  const center = ctx.slot<Region>("center");
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  // Optional small title band — does not eat into the header region.
  let topY = ctx.cm(0);
  if (title) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: ctx.cm(2), y: ctx.cm(0.6), cx: ctx.deck.width - ctx.cm(4), cy: ctx.cm(1.0) },
      valign: "middle",
      paragraphs: [{
        align: "left",
        runs: [{
          text: title,
          sizeHalfPt: 28,
          color: ctx.color("text-strong"),
          bold: true,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
    topY = ctx.cm(1.6);
  }

  // Edge band sizes — calibrated for visual weight, not raw symmetry.
  const headerH = header ? ctx.cm(2.0) : 0;
  const footerH = footer ? ctx.cm(1.6) : 0;
  const leftW   = leftEdge ? ctx.cm(4.5) : 0;
  const rightW  = rightEdge ? ctx.cm(4.5) : 0;
  const inset = ctx.cm(0.4);

  if (header) {
    out.push(...renderRegion(ctx, {
      x: ctx.cm(0.8),
      y: topY + inset,
      width: ctx.deck.width - ctx.cm(1.6),
      height: headerH,
    }, header));
  }
  if (footer) {
    out.push(...renderRegion(ctx, {
      x: ctx.cm(0.8),
      y: ctx.deck.height - footerH - ctx.cm(0.8),
      width: ctx.deck.width - ctx.cm(1.6),
      height: footerH,
    }, footer));
  }
  if (leftEdge) {
    out.push(...renderRegion(ctx, {
      x: ctx.cm(0.8),
      y: topY + headerH + (header ? inset * 2 : inset),
      width: leftW,
      height: ctx.deck.height - topY - headerH - footerH - inset * 2 - ctx.cm(0.8),
    }, leftEdge));
  }
  if (rightEdge) {
    out.push(...renderRegion(ctx, {
      x: ctx.deck.width - rightW - ctx.cm(0.8),
      y: topY + headerH + (header ? inset * 2 : inset),
      width: rightW,
      height: ctx.deck.height - topY - headerH - footerH - inset * 2 - ctx.cm(0.8),
    }, rightEdge));
  }
  if (center) {
    const centerX = ctx.cm(0.8) + leftW + (leftEdge ? inset : 0);
    const centerY = topY + headerH + (header ? inset * 2 : inset);
    const centerW = ctx.deck.width - ctx.cm(1.6) - leftW - rightW - (leftEdge ? inset : 0) - (rightEdge ? inset : 0);
    const centerH = ctx.deck.height - topY - headerH - footerH - inset * 2 - ctx.cm(0.8);
    out.push(...renderRegion(ctx, { x: centerX, y: centerY, width: centerW, height: centerH }, center));
  }

  return out;
};

export default framed;
