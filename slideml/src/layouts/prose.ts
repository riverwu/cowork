import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { contentRect, richText, slideTitle } from "../render/primitives.js";

/**
 * Prose page — one heading + a long text-block. Use for memo-style
 * slides, white-paper internal pages, board minutes, essays.
 *
 * `columns` (1 or 2) picks single-column (default — generous reading
 * margins) or two-column flow (magazine / journal). 2-column doubles
 * the effective char budget. There is NO density slot — render-time
 * autoFit handles spillover within readable limits.
 *
 * `body` accepts the typed-paragraph form so authors can mix plain
 * paragraphs with `{ kind: "quote"|"note"|"callout"|"h2", text }` items.
 * Text supports the inline-markdown vocabulary (bold/italic/code/chips/icons).
 */
export const slots: Record<string, SlotSchema> = {
  title:    { type: "text",       maxChars: 56,  optional: true },
  subtitle: { type: "text",       maxChars: 84, optional: true },
  // Single max budget, sized to the densest readable preset × autoFit
  // headroom (~1.4×). Latin half-column ~1000, CJK ~630; prose's full
  // width × 1.5 multiplier and `columns:2` × 3.0 multiplier are applied
  // by the validator. 3600 is the absolute cap for prose+columns:2 CJK.
  body:     { type: "text-block", maxChars: 2520 },
  columns:  { type: "enum",       values: ["1", "2"], default: "1", optional: true },
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
    // Italic CJK falls back to a slanted serif on macOS / LibreOffice,
    // producing a faint calligraphic / watermark look. CJK subtitles
    // stay upright; emphasis comes from font weight + brand-primary
    // accent color over the body's text-strong.
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: ctx.cm(2), y: topY, cx: ctx.deck.width - ctx.cm(4), cy: ctx.cm(0.9) },
      valign: "top",
      autoFit: "shrink",
      paragraphs: [{
        align: "left",
        runs: [{
          text: subtitle,
          sizeHalfPt: 24,
          color: ctx.color("brand-primary"),
          bold: true,
          italic: ctx.cjk ? false : true,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
    topY += ctx.cm(1.0);
  }

  // 1-column gets generous side margins (line length reading-friendly);
  // 2-column uses tighter margins to maximize column width.
  const cols = ctx.slot<string>("columns") === "2" ? 2 : 1;
  const margin = cols === 2
    ? ctx.cm(2)
    : Math.max(ctx.cm(2.4), Math.floor(ctx.deck.width * 0.16));
  const bodyRect = contentRect(ctx, { top: topY, marginX: margin, bottom: ctx.cm(1.6) });
  out.push(...richText(ctx, bodyRect, body, {
    color: "text-strong",
    columns: cols,
    columnGap: cols === 2 ? ctx.cm(1.0) : undefined,
    // autoFit absorbs +40% over the natural budget; validator's
    // SLOT_OVERFLOW catches anything that would blow past that.
    autoFit: "shrink",
  }));

  return out;
};

export default prose;
