import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { contentRect, slideTitle } from "../render/primitives.js";

/**
 * Conversion / sales funnel — N stages narrowing top-down. Each stage
 * carries a label and an optional numeric value (count/percent) and an
 * optional sublabel (conversion rate to next, drop-off, etc).
 *
 * Visual: stacked horizontal bars, top widest, narrowing toward the
 * bottom — stage width is proportional to its index (uniform taper),
 * not to the value, so the funnel reads as a funnel even when the
 * upstream→downstream ratios are extreme. Value & sublabel render in a
 * fixed right-side annotation column so the bars themselves stay clean.
 *
 * Use for: marketing funnel (impressions→clicks→sign-ups→trials→paid),
 * sales pipeline stages, recruitment funnel, retention cohorts.
 *
 * Use `pricing-table` instead for tier comparison; `timeline` for
 * sequential events; `process-flow` for non-narrowing step sequences.
 */
export const slots: Record<string, SlotSchema> = {
  title:  { type: "text",    maxChars: 42, optional: true },
  stages: { type: "bullets", min: 3, max: 6, itemMaxChars: 84 },
};

interface StageRaw {
  label?: string;
  text?: string;
  name?: string;
  title?: string;
  value?: string | number;
  sublabel?: string;
  caption?: string;
  detail?: string;
}

interface Stage {
  label: string;
  value: string;
  sublabel: string;
}

function normalize(raw: unknown, idx: number): Stage {
  if (typeof raw === "string") return { label: raw, value: "", sublabel: "" };
  const o = (raw ?? {}) as StageRaw;
  return {
    label: o.label ?? o.text ?? o.name ?? o.title ?? `Stage ${idx + 1}`,
    value: o.value !== undefined ? String(o.value) : "",
    sublabel: o.sublabel ?? o.caption ?? o.detail ?? "",
  };
}

const funnel: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const stages = (ctx.slot<unknown[]>("stages") ?? []).map(normalize);
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  if (title) out.push(...slideTitle(ctx, title));

  // Reserve a right-side annotation column for value + sublabel so bar
  // text stays centered and unforced. annotationW must comfortably hold
  // a typical "1,234,567 (12.3%)" + sublabel like "→ 12% to next".
  const top = title ? ctx.cm(4.4) : ctx.cm(2);
  const body = contentRect(ctx, { top, marginX: ctx.cm(2), bottom: ctx.cm(1.6) });
  const anyAnnotation = stages.some((s) => s.value || s.sublabel);
  const annotationW = anyAnnotation ? ctx.cm(6.5) : 0;
  const funnelW = body.width - annotationW - (anyAnnotation ? ctx.cm(0.4) : 0);

  const n = stages.length;
  const gap = ctx.cm(0.18);
  const barH = Math.floor((body.height - gap * (n - 1)) / Math.max(1, n));

  // Width taper: top bar = full funnelW; bottom bar = ~38% of funnelW;
  // linear interpolation in between. Centered horizontally.
  const minRatio = 0.38;
  const widthFor = (idx: number) =>
    n === 1 ? funnelW : Math.floor(funnelW * (1 - (1 - minRatio) * (idx / (n - 1))));

  // Theme-aware bar fill: blend brand-primary at top → brand-deep at
  // bottom would require palette mixing; instead use brand-primary for
  // the top half and brand-deep for the bottom half (two-tone funnel
  // reads as "wider = more, narrower = fewer" without color tricks).
  // Each bar gets a slight alpha step from 1.0 → 0.55 so the bottom
  // stages visually de-emphasise.
  const barColor = ctx.color("brand-primary");

  stages.forEach((stage, idx) => {
    const w = widthFor(idx);
    const x = body.x + Math.floor((funnelW - w) / 2);
    const y = body.y + idx * (barH + gap);
    const alpha = 1 - (idx / Math.max(1, n - 1)) * 0.45;
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "rect",
      xfrm: { x, y, cx: w, cy: barH },
      fill: { type: "solid", color: barColor, alpha },
      line: { color: barColor, width: 0 },
    });
    // Label inside the bar — white text reads on the brand-primary fill
    // at any alpha ≥ 0.45.
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x, y, cx: w, cy: barH },
      valign: "middle",
      autoFit: "shrink",
      paragraphs: [{
        align: "center",
        runs: [{
          text: stage.label,
          sizeHalfPt: 26,
          color: "FFFFFF",
          bold: true,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
    // Right-side annotation column: value (large, brand-primary) +
    // sublabel (small, muted) per row. Aligns to the same row as its
    // bar so the eye tracks horizontally.
    if (anyAnnotation) {
      const annX = body.x + funnelW + ctx.cm(0.4);
      if (stage.value) {
        out.push({
          type: "text",
          id: ctx.id(),
          xfrm: { x: annX, y, cx: annotationW, cy: stage.sublabel ? Math.floor(barH / 2) : barH },
          valign: stage.sublabel ? "bottom" : "middle",
          autoFit: "shrink",
          paragraphs: [{
            align: "left",
            runs: [{
              text: stage.value,
              sizeHalfPt: 30,
              color: ctx.color("brand-primary"),
              bold: true,
              cjk: ctx.cjk,
              fontFace,
            }],
          }],
        });
      }
      if (stage.sublabel) {
        out.push({
          type: "text",
          id: ctx.id(),
          xfrm: { x: annX, y: y + Math.floor(barH / 2), cx: annotationW, cy: Math.floor(barH / 2) },
          valign: "top",
          autoFit: "shrink",
          paragraphs: [{
            align: "left",
            runs: [{
              text: stage.sublabel,
              sizeHalfPt: 18,
              color: ctx.color("text-muted"),
              cjk: ctx.cjk,
              fontFace,
            }],
          }],
        });
      }
    }
  });

  return out;
};

export default funnel;
