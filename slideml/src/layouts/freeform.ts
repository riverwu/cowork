import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { chipColorResolver } from "../render/primitives.js";
import { parseInline } from "../render/markdown-inline.js";

/**
 * Escape-hatch layout — the agent supplies a list of shapes directly,
 * with positions in PERCENTAGES of slide width/height instead of EMU.
 * Used when no other layout fits (one-off diagrams, custom dashboards,
 * bespoke compositions). Schema is deliberately conservative:
 *
 *   { kind: "text",  x, y, w, h, text, size?, color?, align?, bold?, italic? }
 *   { kind: "rect",  x, y, w, h, fill?, border?, cornerRadius? }
 *   { kind: "ellipse", x, y, w, h, fill?, border? }
 *   { kind: "line",  x, y, w, h, color?, weight? }
 *   { kind: "image", x, y, w, h, src, shape?, border?, overlay?, ... }
 *
 * Coordinates are in [0..1] fractions of the slide. Origin top-left.
 *
 * The slot is `bullets` so it accepts an array; per-element shape is
 * polymorphic and validated at render time. Colours can be theme tokens
 * (`brand-primary`) or 6-char hex.
 */
export const slots: Record<string, SlotSchema> = {
  title:  { type: "text",    maxChars: 80, optional: true },
  shapes: { type: "bullets", min: 1, max: 40, itemMaxChars: 1200 },
};

interface FF {
  kind?: string;
  x?: number; y?: number; w?: number; h?: number;
  text?: string; size?: number; color?: string; align?: string;
  bold?: boolean; italic?: boolean;
  fill?: string; border?: string; weight?: number; cornerRadius?: number;
  src?: string;
  shape?: string;
  overlay?: { color?: string; alpha?: number };
}

const freeform: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const shapes = (ctx.slot<unknown[]>("shapes") ?? []) as Array<FF | string>;
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const monoFont = ctx.font("mono");
  const resolveChipColor = chipColorResolver(ctx);

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
  }

  const resolveColor = (raw: string | undefined, fallback: string): string => {
    const v = raw ?? fallback;
    return /^[0-9A-Fa-f]{6}$/.test(v) ? v : ctx.color(v);
  };
  const px = (frac: number | undefined) => Math.round((frac ?? 0) * ctx.deck.width);
  const py = (frac: number | undefined) => Math.round((frac ?? 0) * ctx.deck.height);

  for (const raw of shapes) {
    if (typeof raw === "string") continue;
    const f = raw;
    const x = px(f.x);
    const y = py(f.y);
    const cx = px(f.w);
    const cy = py(f.h);
    if (f.kind === "text") {
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x, y, cx, cy },
        valign: "top",
        paragraphs: [{
          align: (f.align === "center" || f.align === "right") ? f.align : "left",
          runs: parseInline(f.text ?? "", {
            sizeHalfPt: typeof f.size === "number" ? f.size * 2 : 28,
            color: resolveColor(f.color, "text-strong"),
            fontFace,
            monoFont,
            cjk: ctx.cjk,
            resolveChipColor,
          }).map((r) => ({
            ...r,
            bold: f.bold ? true : r.bold,
            italic: f.italic ? true : r.italic,
          })),
        }],
      });
    } else if (f.kind === "rect" || f.kind === "ellipse") {
      out.push({
        type: "shape",
        id: ctx.id(),
        preset: f.kind === "ellipse" ? "ellipse" : "rect",
        xfrm: { x, y, cx, cy },
        fill: f.fill ? { type: "solid", color: resolveColor(f.fill, "brand-primary") } : { type: "none" },
        line: f.border
          ? { color: resolveColor(f.border, "divider"), width: ctx.pt(typeof f.weight === "number" ? f.weight : 1) }
          : { color: "FFFFFF", width: 0 },
        ...(f.kind === "rect" && typeof f.cornerRadius === "number" ? { cornerRadius: f.cornerRadius } : {}),
      });
    } else if (f.kind === "roundRect") {
      out.push({
        type: "shape",
        id: ctx.id(),
        preset: "roundRect",
        xfrm: { x, y, cx, cy },
        fill: f.fill ? { type: "solid", color: resolveColor(f.fill, "brand-primary") } : { type: "none" },
        line: f.border ? { color: resolveColor(f.border, "divider"), width: ctx.pt(typeof f.weight === "number" ? f.weight : 1) } : { color: "FFFFFF", width: 0 },
        cornerRadius: typeof f.cornerRadius === "number" ? f.cornerRadius : 0.05,
      });
    } else if (f.kind === "line") {
      out.push({
        type: "shape",
        id: ctx.id(),
        preset: "line",
        xfrm: { x, y, cx, cy },
        line: { color: resolveColor(f.color, "divider"), width: ctx.pt(typeof f.weight === "number" ? f.weight : 1) },
      });
    } else if (f.kind === "image" && typeof f.src === "string") {
      out.push({
        type: "image",
        id: ctx.id(),
        xfrm: { x, y, cx, cy },
        src: f.src,
        ...(f.shape === "circle" || f.shape === "rounded" ? { clip: f.shape } : {}),
        ...(f.border ? { border: { color: resolveColor(f.border, "divider"), width: ctx.pt(typeof f.weight === "number" ? f.weight : 1) } } : {}),
        ...(f.overlay && typeof f.overlay.color === "string"
          ? { overlay: { color: resolveColor(f.overlay.color, "brand-primary"), alpha: typeof f.overlay.alpha === "number" ? f.overlay.alpha : 0.5 } }
          : {}),
      });
    }
  }
  return out;
};

export default freeform;
