import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { bulletsBlock, contentRect, gridCols, slideTitle } from "../render/primitives.js";

/**
 * Three-tier pricing table — Free / Pro / Enterprise pattern. Each tier
 * carries a name, price, optional period, optional `recommended` flag
 * (highlights the card), and a list of features.
 */
export const slots: Record<string, SlotSchema> = {
  title: { type: "text",    maxChars: 35, optional: true },
  tiers: { type: "bullets", min: 2, max: 4, itemMaxChars: 140 },
};

interface TierRaw {
  name?: string;
  price?: string;
  period?: string;        // "/mo", "billed annually"…
  features?: string[];
  cta?: string;
  recommended?: boolean;
}

const pricingTable: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const tiers = (ctx.slot<unknown[]>("tiers") ?? []) as Array<TierRaw | string>;
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  if (title) out.push(...slideTitle(ctx, title));

  const top = title ? ctx.cm(4.4) : ctx.cm(2);
  const body = contentRect(ctx, { top });
  const cols = gridCols(ctx, body, tiers.length, { gap: ctx.cm(0.6) });

  tiers.forEach((raw, idx) => {
    const t: TierRaw = typeof raw === "string" ? { name: raw } : raw;
    const col = cols[idx]!;
    const recommended = !!t.recommended;
    // Card backing — recommended tier gets a brand fill; others are bg-card.
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "roundRect",
      xfrm: { x: col.x, y: col.y, cx: col.width, cy: col.height },
      fill: { type: "solid", color: recommended ? ctx.color("brand-deep") : ctx.color("bg-card") },
      line: { color: recommended ? ctx.color("brand-primary") : ctx.color("divider"), width: ctx.pt(recommended ? 1.5 : 0.5) },
      cornerRadius: 0.04,
    });
    if (recommended) {
      // Ribbon at top.
      out.push({
        type: "shape",
        id: ctx.id(),
        preset: "rect",
        xfrm: { x: col.x, y: col.y, cx: col.width, cy: ctx.cm(0.7) },
        fill: { type: "solid", color: ctx.color("brand-primary") },
      });
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: col.x, y: col.y, cx: col.width, cy: ctx.cm(0.7) },
        valign: "middle",
        paragraphs: [{
          align: "center",
          runs: [{
            text: (t.cta?.toUpperCase()) ?? "RECOMMENDED",
            sizeHalfPt: 18,
            color: "FFFFFF",
            bold: true,
            fontFace,
          }],
        }],
      });
    }
    const ribbonOffset = recommended ? ctx.cm(0.9) : 0;
    const inset = ctx.cm(0.7);
    const titleColor = recommended ? "FFFFFF" : ctx.color("text-strong");
    const priceColor = recommended ? ctx.color("brand-primary") : ctx.color("brand-primary");
    const subColor = recommended ? "E2E8F0" : ctx.color("text-muted");
    let cursorY = col.y + inset + ribbonOffset;

    // Tier name
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: col.x + inset, y: cursorY, cx: col.width - inset * 2, cy: ctx.cm(1) },
      valign: "middle",
      autoFit: "shrink",
      paragraphs: [{
        align: "center",
        runs: [{ text: t.name ?? "", sizeHalfPt: 28, color: titleColor, bold: true, cjk: ctx.cjk, fontFace }],
      }],
    });
    cursorY += ctx.cm(1.2);
    // Price
    if (t.price) {
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: col.x + inset, y: cursorY, cx: col.width - inset * 2, cy: ctx.cm(2.0) },
        valign: "middle",
        autoFit: "shrink",
        paragraphs: [{
          align: "center",
          runs: [
            { text: t.price, sizeHalfPt: 80, color: priceColor, bold: true, cjk: ctx.cjk, fontFace },
            ...(t.period ? [{ text: ` ${t.period}`, sizeHalfPt: 22, color: subColor, cjk: ctx.cjk, fontFace }] : []),
          ],
        }],
      });
      cursorY += ctx.cm(2.4);
    }
    // Divider
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "rect",
      xfrm: { x: col.x + inset, y: cursorY, cx: col.width - inset * 2, cy: ctx.cm(0.04) },
      fill: { type: "solid", color: recommended ? ctx.color("brand-primary") : ctx.color("divider") },
    });
    cursorY += ctx.cm(0.4);
    // Features — bullets primitive expects a token name. For the
    // recommended (dark-fill) tier we render features manually so we
    // can use a literal hex foreground that contrasts with the dark fill.
    if (t.features && t.features.length > 0) {
      if (recommended) {
        const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
        out.push({
          type: "text",
          id: ctx.id(),
          xfrm: {
            x: col.x + inset,
            y: cursorY,
            cx: col.width - inset * 2,
            cy: col.height - (cursorY - col.y) - inset,
          },
          valign: "top",
          autoFit: "shrink",
          paragraphs: t.features.map((f) => ({
            align: "left",
            lineSpacingHalfPt: 56,
            spaceAfterHalfPt: 16,
            runs: [
              { text: "—  ", sizeHalfPt: 20, color: ctx.color("brand-primary"), bold: true, fontFace },
              { text: String(f), sizeHalfPt: 20, color: "F5F8FF", cjk: ctx.cjk, fontFace },
            ],
          })),
        });
      } else {
        out.push(...bulletsBlock(ctx, {
          x: col.x + inset,
          y: cursorY,
          width: col.width - inset * 2,
          height: col.height - (cursorY - col.y) - inset,
        }, t.features, { sizeHalfPt: 20 }));
      }
    }
  });

  return out;
};

export default pricingTable;
