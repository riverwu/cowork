import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { contentRect, slideTitle } from "../render/primitives.js";

/**
 * Process flow — N steps in an explicit pipeline, each drawn as a
 * chevron pointing right (or down). Distinct from `timeline` (which is
 * dots-on-rail with date/event semantics) and `key-point` (which is
 * unordered supporting points). Use this when the slide is conveying
 * "A → B → C" causality or stages of execution.
 *
 * Each step: `{ title, description? }` (synonyms: text|label|heading
 * for title, body|detail|caption for description). Chevrons inherit
 * the brand-primary color with a subtle alpha step so the eye follows
 * left-to-right.
 *
 * `direction: horizontal` (default) lays steps in a row; `vertical`
 * stacks them. 3–6 steps fit comfortably in horizontal; vertical can
 * carry 4–7.
 */
export const slots: Record<string, SlotSchema> = {
  title:     { type: "text",    maxChars: 42, optional: true },
  steps:     { type: "bullets", min: 2, max: 8, itemMaxChars: 168 },
  direction: { type: "enum",    values: ["horizontal", "vertical"], default: "horizontal", optional: true },
};

interface StepRaw {
  title?: string;
  text?: string;
  label?: string;
  heading?: string;
  description?: string;
  body?: string;
  detail?: string;
  caption?: string;
}

interface Step { title: string; description: string }

function normalize(raw: unknown, idx: number): Step {
  if (typeof raw === "string") return { title: raw, description: "" };
  const o = (raw ?? {}) as StepRaw;
  return {
    title: o.title ?? o.text ?? o.label ?? o.heading ?? `Step ${idx + 1}`,
    description: o.description ?? o.body ?? o.detail ?? o.caption ?? "",
  };
}

const processFlow: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const steps = (ctx.slot<unknown[]>("steps") ?? []).map(normalize);
  const direction = ctx.slot<string>("direction") ?? "horizontal";
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  if (title) out.push(...slideTitle(ctx, title));

  const top = title ? ctx.cm(4.4) : ctx.cm(2);
  const body = contentRect(ctx, { top, marginX: ctx.cm(1.5), bottom: ctx.cm(1.6) });
  const accent = ctx.color("brand-primary");

  if (direction === "vertical") {
    // Vertical stack: roundRect step block on the LEFT carrying number
    // + title with text-frame-friendly geometry, a small chevron-down
    // arrow as inter-step connector, and a description column on the
    // RIGHT. Earlier `arrow-down` preset for the whole step worked
    // visually but the down-arrow's `prstGeom` body is mostly the
    // triangular head — text had nowhere to sit and autoFit shrank
    // everything to ~5pt. Splitting block + arrow keeps text in a
    // clean rectangular region.
    // Connector arrow geometry scales DOWN with step count so per-step
    // block stays tall enough to render the number + title at readable
    // size. Without this, n=7 collapsed step blocks to ~0.4cm and the
    // number "1" overflowed the block.
    const n = steps.length;
    const arrowH    = n <= 4 ? ctx.cm(0.6)  : n <= 6 ? ctx.cm(0.4) : ctx.cm(0.3);
    const arrowGap  = n <= 4 ? ctx.cm(0.15) : n <= 6 ? ctx.cm(0.1) : ctx.cm(0.06);
    const totalArrows = (n - 1) * (arrowH + arrowGap * 2);
    const stepH = Math.floor((body.height - totalArrows) / Math.max(1, n));
    const blockW = ctx.cm(7);
    const arrowW = n <= 4 ? ctx.cm(1.6) : ctx.cm(1.0);
    const descX = body.x + blockW + ctx.cm(0.8);
    const descW = body.width - blockW - ctx.cm(0.8);
    // Number + title font sizes scale with step count too.
    const numSize    = n <= 4 ? 56 : n <= 6 ? 40 : 32;
    const titleSize  = n <= 4 ? 32 : n <= 6 ? 24 : 20;
    const descSize   = n <= 4 ? 22 : n <= 6 ? 18 : 16;
    const numColW    = n <= 4 ? ctx.cm(1.6) : ctx.cm(1.2);
    const titleColX  = n <= 4 ? ctx.cm(2.2) : ctx.cm(1.8);

    let cursorY = body.y;
    steps.forEach((step, idx) => {
      const alpha = 1 - (idx / Math.max(1, n - 1)) * 0.4;
      // Step block — roundRect with number+title centered.
      out.push({
        type: "shape",
        id: ctx.id(),
        preset: "roundRect",
        xfrm: { x: body.x, y: cursorY, cx: blockW, cy: stepH },
        fill: { type: "solid", color: accent, alpha },
        line: { color: accent, width: 0 },
        cornerRadius: 0.06,
      });
      // Number — large, on the left of the block.
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: body.x + ctx.cm(0.4), y: cursorY, cx: numColW, cy: stepH },
        valign: "middle",
        autoFit: "shrink",
        paragraphs: [{
          align: "center",
          runs: [{ text: `${idx + 1}`, sizeHalfPt: numSize, color: "FFFFFF", bold: true, fontFace: ctx.font("latin") }],
        }],
      });
      // Title — to the right of the number, vertically centered.
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: body.x + titleColX, y: cursorY, cx: blockW - titleColX - ctx.cm(0.4), cy: stepH },
        valign: "middle",
        autoFit: "shrink",
        paragraphs: [{
          align: "left",
          runs: [{ text: step.title, sizeHalfPt: titleSize, color: "FFFFFF", bold: true, cjk: ctx.cjk, fontFace }],
        }],
      });
      // Description on the right, vertically centered alongside block.
      if (step.description) {
        out.push({
          type: "text",
          id: ctx.id(),
          xfrm: { x: descX, y: cursorY, cx: descW, cy: stepH },
          valign: "middle",
          autoFit: "shrink",
          paragraphs: [{
            align: "left",
            lineSpacingHalfPt: n <= 4 ? 44 : 36,
            runs: [{
              text: step.description,
              sizeHalfPt: descSize,
              color: ctx.color("text-strong"),
              cjk: ctx.cjk,
              fontFace,
            }],
          }],
        });
      }
      cursorY += stepH;
      // Connector arrow between steps (not after the last).
      if (idx < n - 1) {
        cursorY += arrowGap;
        out.push({
          type: "shape",
          id: ctx.id(),
          preset: "arrow-down",
          xfrm: { x: body.x + Math.floor((blockW - arrowW) / 2), y: cursorY, cx: arrowW, cy: arrowH },
          fill: { type: "solid", color: accent, alpha: 0.5 },
          line: { color: accent, width: 0 },
        });
        cursorY += arrowH + arrowGap;
      }
    });
    return out;
  }

  // Horizontal default. Chevrons in a row, each with title inside and
  // (optional) description hanging below. Font sizes step down with
  // count so a 7-8 step row stays readable without autoFit crushing.
  const n = steps.length;
  // 2-4 steps: comfortable spacing; 5-6: tighter; 7-8: minimal overlap so
  // chevron arrowheads don't bite into the next chevron's text.
  const overlap = n >= 7 ? ctx.cm(0.18) : n >= 5 ? ctx.cm(0.24) : ctx.cm(0.3);
  const totalGap = -overlap * (n - 1);
  const chevronH = ctx.cm(2.8);
  const chevronW = Math.floor((body.width - totalGap) / n);
  const chevronY = body.y + Math.floor((body.height - chevronH) / 2 - ctx.cm(1.0));
  const descY = chevronY + chevronH + ctx.cm(0.5);
  const descH = ctx.cm(3);
  const anyDesc = steps.some((s) => s.description);
  // Type scale by count — keeps visual density acceptable.
  const numSize   = n <= 4 ? 24 : n <= 6 ? 20 : 18;
  const titleSize = n <= 4 ? 22 : n <= 6 ? 20 : 16;
  const descSize  = n <= 4 ? 18 : n <= 6 ? 16 : 14;

  steps.forEach((step, idx) => {
    const x = body.x + idx * (chevronW - overlap);
    const alpha = 1 - (idx / Math.max(1, n - 1)) * 0.4;
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "chevron",
      xfrm: { x, y: chevronY, cx: chevronW, cy: chevronH },
      fill: { type: "solid", color: accent, alpha },
      line: { color: accent, width: 0 },
    });
    // Step number above title, both inside the chevron.
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: x + ctx.cm(0.4), y: chevronY, cx: chevronW - ctx.cm(1.2), cy: chevronH },
      valign: "middle",
      autoFit: "shrink",
      paragraphs: [
        { align: "center", runs: [{ text: `${idx + 1}`, sizeHalfPt: numSize, color: "FFFFFF", bold: true, fontFace: ctx.font("latin") }] },
        { align: "center", runs: [{ text: step.title, sizeHalfPt: titleSize, color: "FFFFFF", bold: true, cjk: ctx.cjk, fontFace }] },
      ],
    });
    if (anyDesc && step.description) {
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: x + ctx.cm(0.2), y: descY, cx: chevronW - ctx.cm(0.4), cy: descH },
        valign: "top",
        autoFit: "shrink",
        paragraphs: [{
          align: "center",
          lineSpacingHalfPt: 42,
          runs: [{
            text: step.description,
            sizeHalfPt: descSize,
            color: ctx.color("text-muted"),
            cjk: ctx.cjk,
            fontFace,
          }],
        }],
      });
    }
  });

  return out;
};

export default processFlow;
