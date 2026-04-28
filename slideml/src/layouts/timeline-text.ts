import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { chipColorResolver, contentRect, slideTitle } from "../render/primitives.js";
import { parseInline } from "../render/markdown-inline.js";

/**
 * Narrative vertical timeline. N entries, each `{ when, title, body? }` —
 * the date column on the left, content on the right, a faint vertical
 * rail tying them together. Different from `process-timeline` which is
 * a horizontal step diagram for short labels.
 */
export const slots: Record<string, SlotSchema> = {
  title:  { type: "text",    maxChars: 60, optional: true },
  events: { type: "bullets", min: 2, max: 6, itemMaxChars: 320 },
};

interface Event {
  when?: string;
  date?: string;
  title?: string;
  heading?: string;
  body?: string;
  description?: string;
}

const timelineText: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const events = (ctx.slot<unknown[]>("events") ?? []) as Array<Event | string>;
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const monoFont = ctx.font("mono");
  const resolveChipColor = chipColorResolver(ctx);

  if (title) out.push(...slideTitle(ctx, title));

  const top = title ? ctx.cm(4.4) : ctx.cm(2);
  const body = contentRect(ctx, { top, marginX: ctx.cm(2), bottom: ctx.cm(1.6) });
  const dateColW = ctx.cm(3.2);
  const contentX = body.x + dateColW + ctx.cm(0.8);
  const contentW = body.width - dateColW - ctx.cm(0.8);
  const railX = body.x + dateColW + ctx.cm(0.2);

  // Vertical rail down the entire body height.
  out.push({
    type: "shape",
    id: ctx.id(),
    preset: "rect",
    xfrm: { x: railX, y: body.y, cx: ctx.cm(0.06), cy: body.height },
    fill: { type: "solid", color: ctx.color("divider") },
  });

  const rowH = Math.floor(body.height / Math.max(1, events.length));

  events.forEach((raw, idx) => {
    const ev: Event = typeof raw === "string" ? { title: raw } : raw;
    const when = ev.when ?? ev.date ?? "";
    const heading = ev.title ?? ev.heading ?? "";
    const description = ev.body ?? ev.description;
    const y = body.y + idx * rowH;
    // Date marker
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: body.x, y, cx: dateColW, cy: ctx.cm(1.0) },
      valign: "top",
      paragraphs: [{
        align: "right",
        runs: [{
          text: when,
          sizeHalfPt: 22,
          color: ctx.color("brand-primary"),
          bold: true,
          fontFace: ctx.font("latin"),
        }],
      }],
    });
    // Dot on the rail
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "ellipse",
      xfrm: {
        x: railX - ctx.cm(0.13),
        y: y + ctx.cm(0.18),
        cx: ctx.cm(0.32),
        cy: ctx.cm(0.32),
      },
      fill: { type: "solid", color: ctx.color("brand-primary") },
    });
    // Heading
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: contentX, y, cx: contentW, cy: ctx.cm(1.0) },
      valign: "top",
      paragraphs: [{
        align: "left",
        runs: parseInline(heading, {
          sizeHalfPt: 24,
          color: ctx.color("text-strong"),
          fontFace,
          monoFont,
          cjk: ctx.cjk,
          resolveChipColor,
        }).map((r) => ({ ...r, bold: r.bold ?? true })),
      }],
    });
    // Body
    if (description) {
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: contentX, y: y + ctx.cm(0.95), cx: contentW, cy: rowH - ctx.cm(0.95) },
        valign: "top",
        paragraphs: [{
          align: "left",
          lineSpacingHalfPt: 46,
          runs: parseInline(description, {
            sizeHalfPt: 20,
            color: ctx.color("text-muted"),
            fontFace,
            monoFont,
            cjk: ctx.cjk,
            resolveChipColor,
          }),
        }],
      });
    }
  });

  return out;
};

export default timelineText;
