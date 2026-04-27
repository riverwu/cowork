/**
 * `section-marker` chrome — small text in the top-left showing the current
 * section name. Section name comes from the most recent `section-divider`
 * slide's title (computed by the orchestrator and passed via
 * `ctx.sectionName`).
 *
 * Overrides: `{ color, prefix }`. Prefix defaults to "—".
 * Renders nothing on slides before the first section divider.
 */

import type { ChromeContext } from "../render/chrome.js";
import type { ShapeList } from "../emitter/types.js";

const sectionMarker = (ctx: ChromeContext): ShapeList => {
  const name = ctx.sectionName;
  if (!name) return [];
  const o = ctx.overrides as { color?: unknown; prefix?: unknown };
  const colorRaw = typeof o.color === "string" ? o.color : "text-muted";
  const color = /^[0-9A-Fa-f]{6}$/.test(colorRaw) ? colorRaw : ctx.color(colorRaw);
  const prefix = typeof o.prefix === "string" ? o.prefix : "\u2014";
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  return [{
    type: "text",
    id: ctx.id(),
    xfrm: { x: ctx.cm(1.0), y: ctx.cm(0.25), cx: ctx.cm(14), cy: ctx.cm(0.6) },
    valign: "middle",
    paragraphs: [{
      align: "left",
      runs: [{
        text: `${prefix} ${name}`,
        sizeHalfPt: 16,
        color,
        cjk: ctx.cjk,
        fontFace,
        italic: true,
      }],
    }],
  }];
};

export default sectionMarker;
