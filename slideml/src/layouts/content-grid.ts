import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { card, chipColorResolver, chipGlyphResolver, contentRect, slideTitle } from "../render/primitives.js";
import { parseInline } from "../render/markdown-inline.js";

/**
 * `content-grid` — N text cards (3-8) auto-arranged into a responsive
 * grid. Each card carries `{ title, body }` (synonyms accepted). Use
 * for "六大框架定位", "five core capabilities", "eight design principles"
 * — the very common pattern of "I have 6-ish small content blocks
 * that need title + 1-2 sentences each."
 *
 * Distinct from:
 *   - `key-point` — visual hierarchy is "tagline + 2-4 supporting
 *     points with icons"; loses meaning past 4.
 *   - `dashboard` — polymorphic regions (KPI/chart/table/text/...);
 *     overkill when every cell is just text.
 *   - `team-grid` — same shape but cells carry photos.
 *
 * Layout shape (matches dashboard's auto-grid):
 *   3 → 1×3     4 → 2×2     5,6 → 2×3     7,8 → 2×4
 *
 * Cards inherit theme `surface` (cornerRadius/elevation/accentStripe).
 */
export const slots: Record<string, SlotSchema> = {
  title: { type: "text",    maxChars: 42, optional: true },
  items: { type: "bullets", min: 3, max: 8, itemMaxChars: 280 },
};

interface CardRaw {
  // Title line — agents reach for varying field names; accept the
  // canonical pair `{title, body}` plus common synonyms.
  title?: string;
  text?: string;
  heading?: string;
  label?: string;
  name?: string;
  // Body / description.
  body?: string;
  description?: string;
  detail?: string;
  caption?: string;
  // Optional inline icon name — same enum as inline `:icon:` markdown.
  icon?: string;
}

interface CardItem { title: string; body: string }

function normalize(raw: unknown, idx: number): CardItem {
  if (typeof raw === "string") return { title: raw, body: "" };
  const o = (raw ?? {}) as CardRaw;
  return {
    title: o.title ?? o.text ?? o.heading ?? o.label ?? o.name ?? `Item ${idx + 1}`,
    body: o.body ?? o.description ?? o.detail ?? o.caption ?? "",
  };
}

function gridShape(n: number): { rows: number; cols: number } {
  switch (n) {
    case 3: return { rows: 1, cols: 3 };
    case 4: return { rows: 2, cols: 2 };
    case 5:
    case 6: return { rows: 2, cols: 3 };
    case 7:
    case 8: return { rows: 2, cols: 4 };
    default: return { rows: 2, cols: 3 };
  }
}

const contentGrid: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const items = (ctx.slot<unknown[]>("items") ?? []).map(normalize).slice(0, 8);
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const monoFont = ctx.font("mono");
  const resolveChipColor = chipColorResolver(ctx);
  const resolveChipGlyph = chipGlyphResolver(ctx);

  if (title) out.push(...slideTitle(ctx, title));

  const top = title ? ctx.cm(4.4) : ctx.cm(2);
  const body = contentRect(ctx, { top, marginX: ctx.cm(2), bottom: ctx.cm(1.6) });
  const gap = ctx.cm(0.5);
  const { rows, cols } = gridShape(Math.max(3, items.length));
  const cellW = Math.floor((body.width - gap * (cols - 1)) / cols);
  const cellH = Math.floor((body.height - gap * (rows - 1)) / rows);
  const inset = ctx.cm(0.5);
  // Heading & body sizes scale modestly with cell count: 3-4 cells get
  // larger type than 7-8 cells so density doesn't crowd the cards.
  const titleSize = items.length <= 4 ? 26 : items.length <= 6 ? 24 : 22;
  const bodySize  = items.length <= 4 ? 20 : items.length <= 6 ? 18 : 16;

  items.forEach((item, idx) => {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const x = body.x + c * (cellW + gap);
    const y = body.y + r * (cellH + gap);

    // Card backing inherits theme surface (radius, elevation, stripe).
    out.push(...card(ctx, { x, y, width: cellW, height: cellH }));

    // Title line — bold, brand-primary for visual scan.
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: x + inset, y: y + inset, cx: cellW - inset * 2, cy: ctx.cm(0.9) },
      valign: "top",
      autoFit: "shrink",
      paragraphs: [{
        align: "left",
        runs: [{
          text: item.title,
          sizeHalfPt: titleSize,
          color: ctx.color("text-strong"),
          bold: true,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });

    // Body — markdown-inline so chips / code spans / icons all render.
    if (item.body) {
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: {
          x: x + inset,
          y: y + inset + ctx.cm(1.0),
          cx: cellW - inset * 2,
          cy: cellH - (inset * 2 + ctx.cm(1.0)),
        },
        valign: "top",
        autoFit: "shrink",
        paragraphs: [{
          align: "left",
          lineSpacingHalfPt: items.length <= 4 ? 44 : 36,
          runs: parseInline(item.body, {
            sizeHalfPt: bodySize,
            color: ctx.color("text-muted"),
            fontFace,
            monoFont,
            cjk: ctx.cjk,
            resolveChipColor,
            resolveChipGlyph,
          }),
        }],
      });
    }
  });

  return out;
};

export default contentGrid;
