import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { slideTitle } from "../render/primitives.js";

export const slots: Record<string, SlotSchema> = {
  title:     { type: "text",    maxChars: 50, optional: true },
  steps:     { type: "bullets", min: 3, max: 5, itemMaxChars: 80 },
  // Layout direction. "horizontal" (default) renders the rail across the
  // slide; "vertical" stacks steps top-to-bottom — better for steps with
  // longer descriptions or when the title is on the side.
  direction: { type: "enum",    values: ["horizontal", "vertical"], default: "horizontal", optional: true },
};

interface StepObject { title?: string; label?: string; text?: string; description?: string }

const processTimeline: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const stepsRaw = ctx.slot<unknown[]>("steps") ?? [];
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  // steps may be strings ("Discover") or objects ({ title, description? }).
  const steps = stepsRaw.map((s, idx) => {
    if (typeof s === "string") return { title: s, description: "" };
    const obj = s as StepObject;
    return {
      title: obj.title ?? obj.label ?? `Step ${idx + 1}`,
      description: obj.description ?? obj.text ?? "",
    };
  });

  if (title) out.push(...slideTitle(ctx, title));

  const direction = ctx.slot<string>("direction") ?? "horizontal";
  if (direction === "vertical") {
    // Vertical: stack steps top-to-bottom, dot + title + description in a row.
    const top = title ? ctx.cm(4.4) : ctx.cm(1.6);
    const bottom = ctx.cm(1.6);
    const dotSize = ctx.cm(0.7);
    const dotX = ctx.cm(3.0);
    const labelX = dotX + ctx.cm(1.2);
    const labelW = ctx.deck.width - labelX - ctx.cm(2);
    const usableH = ctx.deck.height - top - bottom;
    const rowH = Math.floor(usableH / Math.max(1, steps.length));
    // Vertical rail.
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "rect",
      xfrm: { x: dotX + dotSize / 2 - ctx.pt(1), y: top, cx: ctx.pt(2), cy: usableH },
      fill: { type: "solid", color: ctx.color("divider") },
    });
    steps.forEach((step, idx) => {
      const y = top + idx * rowH;
      out.push({
        type: "shape",
        id: ctx.id(),
        preset: "ellipse",
        xfrm: { x: dotX, y: y + ctx.cm(0.2), cx: dotSize, cy: dotSize },
        fill: { type: "solid", color: ctx.color("brand-primary") },
      });
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: labelX, y, cx: labelW, cy: ctx.cm(1.0) },
        valign: "top",
        paragraphs: [{
          align: "left",
          runs: [{ text: step.title, sizeHalfPt: 28, color: ctx.color("text-strong"), bold: true, cjk: ctx.cjk, fontFace }],
        }],
      });
      if (step.description) {
        out.push({
          type: "text",
          id: ctx.id(),
          xfrm: { x: labelX, y: y + ctx.cm(1.0), cx: labelW, cy: rowH - ctx.cm(1.0) },
          valign: "top",
          paragraphs: [{
            align: "left",
            lineSpacingHalfPt: 46,
            runs: [{ text: step.description, sizeHalfPt: 22, color: ctx.color("text-muted"), cjk: ctx.cjk, fontFace }],
          }],
        });
      }
    });
    return out;
  }

  // Horizontal (default).
  const railY = ctx.cm(7.4);
  const railLeft = ctx.cm(2.5);
  const railRight = ctx.deck.width - ctx.cm(2.5);
  const railWidth = railRight - railLeft;
  const dotSize = ctx.cm(0.8);

  // Connecting rail.
  out.push({
    type: "shape",
    id: ctx.id(),
    preset: "rect",
    xfrm: { x: railLeft, y: railY + dotSize / 2 - ctx.pt(1), cx: railWidth, cy: ctx.pt(2) },
    fill: { type: "solid", color: ctx.color("divider") },
  });

  steps.forEach((step, idx) => {
    const x = railLeft + (railWidth * idx) / Math.max(1, steps.length - 1) - dotSize / 2;
    const labelX = x + dotSize / 2 - ctx.cm(2.4);
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "ellipse",
      xfrm: { x, y: railY, cx: dotSize, cy: dotSize },
      fill: { type: "solid", color: ctx.color("brand-primary") },
    });
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: labelX, y: railY - ctx.cm(2.6), cx: ctx.cm(4.8), cy: ctx.cm(1.0) },
      valign: "middle",
      paragraphs: [{
        align: "center",
        runs: [{ text: step.title, sizeHalfPt: 28, color: ctx.color("text-strong"), bold: true, cjk: ctx.cjk, fontFace }],
      }],
    });
    if (step.description) {
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: labelX, y: railY + dotSize + ctx.cm(0.4), cx: ctx.cm(4.8), cy: ctx.cm(2.0) },
        valign: "top",
        paragraphs: [{
          align: "center",
          lineSpacingHalfPt: 48,
          runs: [{ text: step.description, sizeHalfPt: 22, color: ctx.color("text-muted"), cjk: ctx.cjk, fontFace }],
        }],
      });
    }
  });

  return out;
};

export default processTimeline;
