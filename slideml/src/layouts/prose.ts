import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { contentRect, richText, slideTitle } from "../render/primitives.js";

/**
 * Single-column prose page — one heading + a long text-block. Use for
 * memo-style slides, white-paper internal pages, board minutes, essays.
 *
 * `body` accepts the typed-paragraph form so authors can mix plain
 * paragraphs with `{ kind: "quote"|"note"|"callout"|"h2", text }` items.
 * Text supports the inline-markdown vocabulary (bold/italic/code/chips/icons).
 */
export const slots: Record<string, SlotSchema> = {
  title:    { type: "text",       maxChars: 80,  optional: true },
  subtitle: { type: "text",       maxChars: 120, optional: true },
  // Single-column prose at full slide width — about 1.5× the per-column
  // budget. Loose ~270/450, normal ~540/810, dense ~1080/1620, micro ~1800/2700.
  body:     { type: "text-block", maxChars: 2400 },
  density:  { type: "enum",       values: ["loose", "normal", "dense", "micro"], default: "normal", optional: true },
};

const prose: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const subtitle = ctx.slot<string>("subtitle");
  const body = ctx.slot<unknown>("body");
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  let topY = ctx.cm(2);
  if (title) {
    out.push(...slideTitle(ctx, title));
    topY = ctx.cm(4.4);
  }
  if (subtitle) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: ctx.cm(2), y: topY, cx: ctx.deck.width - ctx.cm(4), cy: ctx.cm(0.9) },
      valign: "top",
      paragraphs: [{
        align: "left",
        runs: [{
          text: subtitle,
          sizeHalfPt: 24,
          color: ctx.color("text-muted"),
          italic: true,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
    topY += ctx.cm(1.0);
  }

  // Single-column body. Generous margins keep line length reading-friendly.
  const margin = Math.max(ctx.cm(2.4), Math.floor(ctx.deck.width * 0.16));
  const bodyRect = contentRect(ctx, { top: topY, marginX: margin, bottom: ctx.cm(1.6) });
  out.push(...richText(ctx, bodyRect, body, {
    color: "text-strong",
    density: ctx.slot<string>("density"),
  }));

  return out;
};

export default prose;
