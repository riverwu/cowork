import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { chipColorResolver, contentRect, slideTitle } from "../render/primitives.js";
import { parseInline } from "../render/markdown-inline.js";

/**
 * Step / event sequence with a connecting rail and dots. Replaces the
 * older process-timeline (horizontal step diagram) and timeline-text
 * (vertical narrative timeline with date column) by collapsing both
 * into one renderer with a `direction` enum.
 *
 * Items per step / event: `{ when?, title, description? }` (or a bare
 * string treated as the title). The optional `when` field renders in a
 * left date column in vertical mode and is ignored in horizontal mode
 * (use a short title instead — horizontal labels are tight).
 */
export const slots: Record<string, SlotSchema> = {
  title:     { type: "text",    maxChars: 42, optional: true },
  items:     { type: "bullets", min: 2, max: 6, itemMaxChars: 224 },
  direction: { type: "enum",    values: ["horizontal", "vertical"], default: "horizontal", optional: true },
};

interface RawItem {
  when?: string;        // synonym: date
  date?: string;
  title?: string;       // synonyms: heading, label, text
  heading?: string;
  label?: string;
  text?: string;
  description?: string; // synonyms: body, detail, caption, text (when paired with label)
  body?: string;
  detail?: string;
  caption?: string;
}

interface Item {
  when: string;
  title: string;
  description: string;
}

/**
 * Reduce the polymorphic input to {when, title, description}.
 *
 * Critical disambiguation: agents very commonly emit `{ label, text }`
 * for timeline items, intending `label` = the prominent marker (date or
 * step name) and `text` = the descriptive body. Without special-casing,
 * `text` would be picked into title's fallback chain (after label) but
 * never reach description, leaving only labels rendered. The rule:
 *   - If BOTH `label` and `text` are present → label is title/marker,
 *     text is description.
 *   - If only one is present, it's the title (current behaviour).
 * Same logic extends `detail` and `caption` to description's chain.
 */
function normalize(raw: unknown, idx: number): Item {
  if (typeof raw === "string") return { when: "", title: raw, description: "" };
  const o = (raw ?? {}) as RawItem;
  const labelPlusText = typeof o.label === "string" && typeof o.text === "string";
  return {
    when: o.when ?? o.date ?? "",
    title: o.title ?? o.heading ?? o.label ?? o.text ?? `Step ${idx + 1}`,
    description: o.description ?? o.body ?? o.detail ?? o.caption
      ?? (labelPlusText ? o.text : "")
      ?? "",
  };
}

const timeline: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const items = (ctx.slot<unknown[]>("items") ?? []).map(normalize);
  const direction = ctx.slot<string>("direction") ?? "horizontal";
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const monoFont = ctx.font("mono");
  const resolveChipColor = chipColorResolver(ctx);

  if (title) out.push(...slideTitle(ctx, title));

  if (direction === "vertical") {
    // Narrative timeline (former timeline-text). Optional date column
    // on the left when any item has `when`.
    const top = title ? ctx.cm(4.4) : ctx.cm(2);
    const body = contentRect(ctx, { top, marginX: ctx.cm(2), bottom: ctx.cm(1.6) });
    const hasWhen = items.some((it) => it.when);
    const dateColW = hasWhen ? ctx.cm(3.2) : ctx.cm(0);
    const dateGap = hasWhen ? ctx.cm(0.8) : ctx.cm(0);
    const railX = body.x + dateColW + (hasWhen ? ctx.cm(0.2) : ctx.cm(0.2));
    const contentX = railX + ctx.cm(0.6);
    const contentW = body.width - (contentX - body.x);
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "rect",
      xfrm: { x: railX, y: body.y, cx: ctx.cm(0.06), cy: body.height },
      fill: { type: "solid", color: ctx.color("divider") },
    });
    const rowH = Math.floor(body.height / Math.max(1, items.length));
    items.forEach((ev, idx) => {
      const y = body.y + idx * rowH;
      if (hasWhen) {
        out.push({
          type: "text",
          id: ctx.id(),
          xfrm: { x: body.x, y, cx: dateColW, cy: ctx.cm(1.0) },
          valign: "top",
          paragraphs: [{
            align: "right",
            runs: [{ text: ev.when, sizeHalfPt: 22, color: ctx.color("brand-primary"), bold: true, fontFace: ctx.font("latin") }],
          }],
        });
      }
      out.push({
        type: "shape",
        id: ctx.id(),
        preset: "ellipse",
        xfrm: { x: railX - ctx.cm(0.13), y: y + ctx.cm(0.18), cx: ctx.cm(0.32), cy: ctx.cm(0.32) },
        fill: { type: "solid", color: ctx.color("brand-primary") },
      });
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: contentX, y, cx: contentW, cy: ctx.cm(1.0) },
        valign: "top",
        autoFit: "shrink",
        paragraphs: [{
          align: "left",
          runs: parseInline(ev.title, { sizeHalfPt: 24, color: ctx.color("text-strong"), fontFace, monoFont, cjk: ctx.cjk, resolveChipColor })
            .map((r) => ({ ...r, bold: r.bold ?? true })),
        }],
      });
      if (ev.description) {
        out.push({
          type: "text",
          id: ctx.id(),
          xfrm: { x: contentX, y: y + ctx.cm(0.95), cx: contentW, cy: rowH - ctx.cm(0.95) },
          valign: "top",
          autoFit: "shrink",
          paragraphs: [{
            align: "left",
            lineSpacingHalfPt: 46,
            runs: parseInline(ev.description, { sizeHalfPt: 20, color: ctx.color("text-muted"), fontFace, monoFont, cjk: ctx.cjk, resolveChipColor }),
          }],
        });
      }
      void dateGap; // keep symbol referenced for clarity
    });
    return out;
  }

  // Horizontal (default). Process-style: dots on a single rail with
  // labels above and optional descriptions below.
  const railY = ctx.cm(7.4);
  const railLeft = ctx.cm(2.5);
  const railRight = ctx.deck.width - ctx.cm(2.5);
  const railWidth = railRight - railLeft;
  const dotSize = ctx.cm(0.8);

  out.push({
    type: "shape",
    id: ctx.id(),
    preset: "rect",
    xfrm: { x: railLeft, y: railY + dotSize / 2 - ctx.pt(1), cx: railWidth, cy: ctx.pt(2) },
    fill: { type: "solid", color: ctx.color("divider") },
  });

  items.forEach((step, idx) => {
    const x = railLeft + (railWidth * idx) / Math.max(1, items.length - 1) - dotSize / 2;
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
      autoFit: "shrink",
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
        autoFit: "shrink",
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

export default timeline;
