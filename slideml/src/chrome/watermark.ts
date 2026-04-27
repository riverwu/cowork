/**
 * `watermark` chrome — bottom-right faint brand text. Used for
 * confidentiality markings ("DRAFT", "CONFIDENTIAL") or quiet brand
 * stamps. Overrides: `{ text, color, alpha, position, sizeHalfPt }`.
 *
 * `position`: "top-left" | "top-right" | "bottom-left" | "bottom-right" |
 *   "center". Default "bottom-right".
 *
 * Renders nothing when no `text` is supplied (theme can register the
 * module without committing to specific text — agents fill it per slide).
 */

import type { ChromeContext } from "../render/chrome.js";
import type { ShapeList } from "../emitter/types.js";

const watermark = (ctx: ChromeContext): ShapeList => {
  const o = ctx.overrides as {
    text?: unknown; color?: unknown; alpha?: unknown;
    position?: unknown; sizeHalfPt?: unknown;
  };
  const text = typeof o.text === "string" ? o.text : undefined;
  if (!text) return [];
  const colorRaw = typeof o.color === "string" ? o.color : "text-muted";
  const color = /^[0-9A-Fa-f]{6}$/.test(colorRaw) ? colorRaw : ctx.color(colorRaw);
  const sizeHalfPt = typeof o.sizeHalfPt === "number" ? o.sizeHalfPt : 18;
  const position = typeof o.position === "string" ? o.position : "bottom-right";
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const w = ctx.cm(8);
  const h = ctx.cm(0.7);
  const margin = ctx.cm(0.6);
  let x = ctx.deck.width - w - margin;
  let y = ctx.deck.height - h - margin;
  let align: "left" | "center" | "right" = "right";
  if (position === "top-left") {
    x = margin; y = margin; align = "left";
  } else if (position === "top-right") {
    y = margin; align = "right";
  } else if (position === "bottom-left") {
    x = margin; align = "left";
  } else if (position === "center") {
    x = ctx.centerH(w); y = ctx.centerV(h); align = "center";
  }
  return [{
    type: "text",
    id: ctx.id(),
    xfrm: { x, y, cx: w, cy: h },
    valign: "middle",
    paragraphs: [{
      align,
      runs: [{
        text: text.toUpperCase(),
        sizeHalfPt,
        color,
        bold: true,
        cjk: ctx.cjk,
        fontFace,
      }],
    }],
  }];
};

export default watermark;
