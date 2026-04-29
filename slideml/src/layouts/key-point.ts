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
  headline: { type: "text",       maxChars: 56 },
  points:   { type: "bullets",    min: 2, max: 4, itemMaxChars: 140 },
};

interface PointRaw {
  icon?: string;          // one of INLINE_ICONS keys
  // Title / description field names: agents reach for various spellings.
  // Canonical pair is `title` + `description`, but accept synonyms so the
  // points actually render regardless of which form the agent picked:
  //   title    | text   | heading  | label   → title (top line, bold)
  //   description | detail | body | caption → description (sub line, muted)
  title?: string;
  text?: string;
  heading?: string;
  label?: string;
  description?: string;
  detail?: string;
  body?: string;
  caption?: string;
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

  // Resolve every point's icon once. Cross-column alignment requires
  // the icon-row to be reserved for ALL columns when ANY column has an
  // icon — otherwise points without icons start their title higher and
  // visually misalign with iconed siblings. Compute the uniform titleY
  // offset before rendering any point.
  const resolvedPoints = rawPoints.map((raw) => {
    const p: PointRaw = typeof raw === "string" ? { title: raw } : raw;
    const iconName = (p.icon && p.icon in INLINE_ICONS) ? p.icon as InlineIconName : undefined;
    return {
      titleText: p.title ?? p.text ?? p.heading ?? p.label ?? "",
      descriptionText: p.description ?? p.detail ?? p.body ?? p.caption,
      glyph: iconName ? INLINE_ICONS[iconName] : "",
    };
  });
  const anyHasIcon = resolvedPoints.some((rp) => rp.glyph);
  const iconRowH = ctx.cm(1.6);

  resolvedPoints.forEach(({ titleText, descriptionText, glyph }, idx) => {
    const col = cols[idx]!;

    // Reserve the icon row uniformly. If this point has a glyph render
    // it; if not, leave the same vertical space empty so the title /
    // description below align with iconed siblings.
    if (anyHasIcon && glyph) {
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: col.x, y: col.y, cx: col.width, cy: iconRowH },
        valign: "middle",
        paragraphs: [{
          align: "center",
          runs: [{ text: glyph, sizeHalfPt: 64, color: ctx.color("brand-primary"), bold: true, fontFace }],
        }],
      });
    }
    // titleY: reserve icon row when ANY point in this slide has an
    // icon, regardless of whether this particular column does. Past
    // logic offset only for columns with their own glyph, producing
    // the misalignment the user reported (lightning/target missing →
    // those columns shifted up).
    const titleY = col.y + (anyHasIcon ? ctx.cm(2.0) : ctx.cm(0.4));
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: col.x, y: titleY, cx: col.width, cy: ctx.cm(1.0) },
      valign: "middle",
      autoFit: "shrink",
      paragraphs: [{
        align: "center",
        runs: [{
          text: titleText,
          sizeHalfPt: 28,
          color: ctx.color("text-strong"),
          bold: true,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
    if (descriptionText) {
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: col.x, y: titleY + ctx.cm(1.1), cx: col.width, cy: col.height - (titleY + ctx.cm(1.1) - col.y) },
        valign: "top",
        autoFit: "shrink",
        paragraphs: [{
          align: "center",
          lineSpacingHalfPt: 48,
          runs: parseInline(descriptionText, {
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
