import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { chipColorResolver, contentRect, gridCols } from "../render/primitives.js";
import { INLINE_ICONS, parseInline, type InlineIconName } from "../render/markdown-inline.js";

/**
 * One central tagline with three (or four) supporting points underneath.
 * Each point has an optional icon (from the inline-icon enum), a short
 * heading, and an optional 1-line elaboration. Use for "3 reasons why",
 * "core principles", "what you'll learn".
 */
export const slots: Record<string, SlotSchema> = {
  headline: { type: "text",       maxChars: 80 },
  points:   { type: "bullets",    min: 2, max: 4, itemMaxChars: 200 },
};

interface PointRaw {
  icon?: string;          // one of INLINE_ICONS keys
  title?: string;
  description?: string;
}

const keyPoint: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const headline = ctx.slot<string>("headline") ?? "";
  const rawPoints = (ctx.slot<unknown[]>("points") ?? []) as Array<PointRaw | string>;
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const monoFont = ctx.font("mono");

  // Headline at top — large, centred.
  out.push({
    type: "text",
    id: ctx.id(),
    xfrm: { x: ctx.cm(2), y: ctx.cm(2.4), cx: ctx.deck.width - ctx.cm(4), cy: ctx.cm(3) },
    valign: "middle",
    paragraphs: [{
      align: "center",
      runs: parseInline(headline, {
        sizeHalfPt: 64,
        color: ctx.color("text-strong"),
        fontFace,
        monoFont,
        cjk: ctx.cjk,
        resolveChipColor: chipColorResolver(ctx),
      }).map((r) => ({ ...r, bold: r.bold ?? true })),
    }],
  });

  // Accent rule under the headline.
  out.push({
    type: "shape",
    id: ctx.id(),
    preset: "rect",
    xfrm: { x: ctx.centerH(ctx.cm(3)), y: ctx.cm(5.6), cx: ctx.cm(3), cy: ctx.cm(0.1) },
    fill: { type: "solid", color: ctx.color("brand-primary") },
  });

  // Points row — equal grid columns starting below the rule.
  const body = contentRect(ctx, { top: ctx.cm(7), bottom: ctx.cm(2) });
  const cols = gridCols(ctx, body, rawPoints.length, { gap: ctx.cm(0.8) });

  rawPoints.forEach((raw, idx) => {
    const p: PointRaw = typeof raw === "string" ? { title: raw } : raw;
    const col = cols[idx]!;
    const iconName = (p.icon && p.icon in INLINE_ICONS) ? p.icon as InlineIconName : undefined;
    const glyph = iconName ? INLINE_ICONS[iconName] : "";

    if (glyph) {
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: col.x, y: col.y, cx: col.width, cy: ctx.cm(1.6) },
        valign: "middle",
        paragraphs: [{
          align: "center",
          runs: [{ text: glyph, sizeHalfPt: 64, color: ctx.color("brand-primary"), bold: true, fontFace }],
        }],
      });
    }
    const titleY = col.y + (glyph ? ctx.cm(2.0) : ctx.cm(0.4));
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: col.x, y: titleY, cx: col.width, cy: ctx.cm(1.0) },
      valign: "middle",
      paragraphs: [{
        align: "center",
        runs: [{
          text: p.title ?? "",
          sizeHalfPt: 28,
          color: ctx.color("text-strong"),
          bold: true,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
    if (p.description) {
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: col.x, y: titleY + ctx.cm(1.1), cx: col.width, cy: col.height - (titleY + ctx.cm(1.1) - col.y) },
        valign: "top",
        paragraphs: [{
          align: "center",
          lineSpacingHalfPt: 48,
          runs: parseInline(p.description, {
            sizeHalfPt: 20,
            color: ctx.color("text-muted"),
            fontFace,
            monoFont,
            cjk: ctx.cjk,
            resolveChipColor: chipColorResolver(ctx),
          }),
        }],
      });
    }
  });

  return out;
};

export default keyPoint;
