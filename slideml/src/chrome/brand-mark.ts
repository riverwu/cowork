/**
 * `brand-mark` chrome — optional logo / brand wordmark at a slide edge.
 *
 * Deck-level declaration:
 *   deck:
 *     brand:
 *       name: Acme
 *       logo: /path/to/logo.png
 *       color: brand-primary
 *
 * Per-slide override:
 *   chrome:
 *     override:
 *       brand-mark: { position: bottom-left, showName: false }
 */

import type { ChromeContext } from "../render/chrome.js";
import type { ShapeList } from "../emitter/types.js";

type Position = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type BrandLogo = string | { src: string; alt?: string } | undefined;

const brandMark = (ctx: ChromeContext): ShapeList => {
  const o = ctx.overrides as {
    src?: unknown;
    name?: unknown;
    color?: unknown;
    position?: unknown;
    showName?: unknown;
    widthCm?: unknown;
    heightCm?: unknown;
  };
  const brand = ctx.brand;
  const logoSrc = typeof o.src === "string" ? o.src : brandLogoSrc(brand?.logo);
  const name = typeof o.name === "string" ? o.name : brand?.name;
  const showName = o.showName === false ? false : true;
  if (!logoSrc && (!name || !showName)) return [];

  const colorRaw = typeof o.color === "string" ? o.color : brand?.color ?? "text-muted";
  const color = /^[0-9A-Fa-f]{6}$/.test(colorRaw) ? colorRaw : ctx.color(colorRaw);
  const position = normalizePosition(o.position);
  const markH = ctx.cm(typeof o.heightCm === "number" ? o.heightCm : 0.52);
  const logoW = logoSrc ? ctx.cm(typeof o.widthCm === "number" ? o.widthCm : 1.15) : 0;
  const textW = name && showName ? ctx.cm(Math.min(4.4, Math.max(1.2, name.length * 0.23))) : 0;
  const gap = logoSrc && textW ? ctx.cm(0.18) : 0;
  const totalW = logoW + gap + textW;
  const marginX = ctx.cm(1.0);
  const topY = ctx.cm(0.22);
  const bottomY = ctx.deck.height - ctx.cm(0.76);
  const x = position.endsWith("right") ? ctx.deck.width - marginX - totalW : marginX;
  const y = position.startsWith("bottom") ? bottomY : topY;
  const out: ShapeList = [];

  let cursorX = x;
  if (logoSrc) {
    out.push({
      type: "image",
      id: ctx.id(),
      xfrm: { x: cursorX, y, cx: logoW, cy: markH },
      src: logoSrc,
      altText: typeof brand?.logo === "object" ? brand.logo.alt : "Brand logo",
      fit: "contain",
    });
    cursorX += logoW + gap;
  }

  if (name && showName) {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: cursorX, y, cx: textW, cy: markH },
      valign: "middle",
      paragraphs: [{
        align: position.endsWith("right") ? "right" : "left",
        runs: [{
          text: name,
          sizeHalfPt: 18,
          color,
          fontFace: ctx.font(ctx.cjk ? "cjk" : "latin"),
          cjk: ctx.cjk,
        }],
      }],
    });
  }

  return out;
};

export default brandMark;

function brandLogoSrc(logo: BrandLogo): string | undefined {
  if (typeof logo === "string") return logo;
  if (logo && typeof logo === "object" && "src" in logo && typeof logo.src === "string") return logo.src;
  return undefined;
}

function normalizePosition(value: unknown): Position {
  return value === "top-left" || value === "bottom-left" || value === "bottom-right"
    ? value
    : "top-right";
}
