import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { formatOrdinal, slideTitle } from "../render/primitives.js";

export const slots: Record<string, SlotSchema> = {
  title: { type: "text",    maxChars: 21, optional: true },
  // Items can be plain strings ("第一章") OR `{text, detail?}` objects
  // where `detail` renders as a small muted sub-line under the main row
  // (good for "壹 · 何为中原" + "地理概念与范围界定" style agendas).
  items: { type: "bullets", min: 2, max: 8, itemMaxChars: 42 },
};

interface AgendaItem {
  // Item label (the main text on the row). Canonical: `text`. Agents
  // also reach for `title|label|name|heading` (very common when their
  // mental model is "agenda entries are titled sections"). `num` is
  // tolerated and ignored — agenda renders its own auto-numbers.
  text?: string;
  title?: string;
  label?: string;
  name?: string;
  heading?: string;
  num?: string;
  // Sub-line under the main row.
  detail?: string;
  description?: string;
  body?: string;
  caption?: string;
  subtitle?: string;
}

function normalizeAgendaItem(raw: unknown): { text: string; detail?: string } {
  if (typeof raw === "string") return { text: raw };
  if (raw && typeof raw === "object") {
    const o = raw as AgendaItem;
    return {
      text: o.text ?? o.title ?? o.label ?? o.name ?? o.heading ?? "",
      detail: o.detail ?? o.description ?? o.body ?? o.caption ?? o.subtitle,
    };
  }
  return { text: String(raw) };
}

const agenda: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title") ?? (ctx.cjk ? "目录" : "Agenda");
  const rawItems = ctx.slot<unknown[]>("items") ?? [];
  const items = rawItems.map(normalizeAgendaItem);
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  out.push(...slideTitle(ctx, title));

  // Numbered list — large numerals in cyan, item text in muted strong.
  // Row height grows when any item carries a detail sub-line.
  const itemTop = ctx.cm(4.2);
  const hasDetails = items.some((i) => i.detail);
  const lineHeight = hasDetails ? ctx.cm(1.5) : ctx.cm(1.0);
  items.forEach((item, idx) => {
    const y = itemTop + idx * lineHeight;
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: ctx.cm(2), y, cx: ctx.cm(1.6), cy: lineHeight },
      valign: hasDetails ? "top" : "middle",
      margin: hasDetails ? { t: ctx.cm(0.1), l: 0, r: 0, b: 0 } : undefined,
      paragraphs: [{
        align: "right",
        runs: [{
          text: formatOrdinal(ctx, idx + 1),
          sizeHalfPt: 36,
          color: ctx.color("brand-primary"),
          bold: true,
          fontFace: ctx.font("latin"),
        }],
      }],
    });
    const paragraphs = [
      {
        align: "left" as const,
        runs: [{ text: item.text, sizeHalfPt: 28, color: ctx.color("text-strong"), cjk: ctx.cjk, fontFace }],
      },
      ...(item.detail ? [{
        align: "left" as const,
        runs: [{ text: item.detail, sizeHalfPt: 18, color: ctx.color("text-muted"), cjk: ctx.cjk, fontFace }],
      }] : []),
    ];
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: ctx.cm(4.2), y, cx: ctx.deck.width - ctx.cm(6.2), cy: lineHeight },
      valign: hasDetails ? "top" : "middle",
      autoFit: "shrink",
      paragraphs,
    });
  });

  return out;
};

export default agenda;
