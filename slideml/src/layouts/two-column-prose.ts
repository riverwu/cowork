import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { contentRect, richText, slideTitle } from "../render/primitives.js";

/**
 * Two-column prose — one heading + body text flowed across two columns.
 * Magazine / journal feel. Heavier than `prose` but still text-only;
 * use when you have ~600+ characters that single-column wraps too long.
 *
 * Body accepts typed paragraphs (quote/note/callout/h2) like `prose`.
 * Distribution is by paragraph count (per `richText({ columns: 2 })`).
 */
export const slots: Record<string, SlotSchema> = {
  title:    { type: "text",       maxChars: 80,  optional: true },
  subtitle: { type: "text",       maxChars: 120, optional: true },
  // Two columns × per-column budget; raised ceiling because two columns
  // means double capacity at any given density. See density presets.
  body:     { type: "text-block", maxChars: 3600 },
  density:  { type: "enum",       values: ["loose", "normal", "dense", "micro"], default: "normal", optional: true },
};

const twoColumnProse: LayoutFn = (ctx: LayoutContext): ShapeList => {
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
          sizeHalfPt: 22,
          color: ctx.color("text-muted"),
          italic: true,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
    topY += ctx.cm(1.0);
  }

  const bodyRect = contentRect(ctx, { top: topY, marginX: ctx.cm(2), bottom: ctx.cm(1.6) });
  out.push(...richText(ctx, bodyRect, body, {
    color: "text-strong",
    columns: 2,
    columnGap: ctx.cm(1.0),
    density: ctx.slot<string>("density"),
  }));

  return out;
};

export default twoColumnProse;
