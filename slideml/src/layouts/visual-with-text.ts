import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import {
  bodyTopAfterTitle,
  bulletsBlock,
  card,
  contentRect,
  gridCols,
  richText,
  slideTitle,
} from "../render/primitives.js";
import { coerceVisual, renderVisual } from "../render/visual.js";

/**
 * Visual + sibling text column. ONE layout that replaces three older
 * variants (image-split-text, two-col-text-image, bullet-with-image),
 * picking the visual treatment via enum slots:
 *
 *   - `visual`       — image | chart | table | svg
 *   - `textKind`     — "prose" (richText) | "bullets" (list) — default prose
 *   - `position`     — "left" | "right" (visual side)        — default right
 *   - `imageStyle`   — "card" (rounded inset) | "bleed" (edge-to-edge full
 *                      half) — only meaningful when visual.kind = image;
 *                      chart/table/svg ignore it. Default card.
 *   - `ratio`        — text:visual column-width ratio (50-50 etc).
 *
 * Old → new mapping for agents migrating decks:
 *   - two-col-text-image → visual-with-text (defaults work)
 *   - image-split-text   → visual-with-text + imageStyle: bleed
 *   - bullet-with-image  → visual-with-text + textKind: bullets
 *
 * For the same layout WITHOUT a sibling visual column, the agent should
 * just use `prose` (single full-width column).
 */
export const slots: Record<string, SlotSchema> = {
  title:      { type: "text",       maxChars: 42, optional: true },
  visual:     { type: "visual",     optional: true },
  // Back-compat alias — older decks still use `image`.
  image:      { type: "image-ref",  optional: true },
  // Pick which side carries text. `text` (prose) OR `bullets` provides
  // the content; supply exactly one.
  textKind:   { type: "enum", values: ["prose", "bullets"], default: "prose", optional: true },
  text:       { type: "text-block", maxChars: 1050, optional: true },
  bullets:    { type: "bullets",    min: 2, max: 7, itemMaxChars: 98, optional: true },
  position:   { type: "enum", values: ["left", "right"], default: "right", optional: true },
  imageStyle: { type: "enum", values: ["card", "bleed"], default: "card", optional: true },
  ratio:      { type: "enum", values: ["50-50", "60-40", "40-60", "67-33", "33-67"], default: "50-50", optional: true },
};

const RATIO_WEIGHTS: Record<string, [number, number]> = {
  "50-50": [1, 1],
  "60-40": [3, 2],   // text 60, visual 40
  "40-60": [2, 3],
  "67-33": [2, 1],
  "33-67": [1, 2],
};

const visualWithText: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const visual = coerceVisual(ctx.slot<unknown>("visual") ?? ctx.slot<unknown>("image"));
  const textKind = (ctx.slot<string>("textKind") ?? "prose") as "prose" | "bullets";
  const visualOnLeft = (ctx.slot<string>("position") ?? "right") === "left";
  const imageStyle = (ctx.slot<string>("imageStyle") ?? "card") as "card" | "bleed";
  const ratioKey = ctx.slot<string>("ratio") ?? "50-50";
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  // BLEED mode: image-only edge-to-edge half (replaces image-split-text).
  // Title floats inside the text half. Card insets are skipped. Only
  // honored when visual.kind = image; chart/table/svg fall back to card.
  const useBleed = imageStyle === "bleed" && visual?.kind === "image";

  if (useBleed) {
    const halfW = Math.floor(ctx.deck.width / 2);
    const visX = visualOnLeft ? 0 : halfW;
    const txtX = visualOnLeft ? halfW : 0;
    if (visual) {
      out.push(...renderVisual(ctx, { x: visX, y: 0, width: halfW, height: ctx.deck.height }, visual));
    }
    const pad = ctx.cm(1.6);
    let textY = ctx.cm(2.2);
    if (title) {
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: txtX + pad, y: textY, cx: halfW - pad * 2, cy: ctx.cm(2) },
        valign: "top",
        paragraphs: [{
          align: "left",
          runs: [{ text: title, sizeHalfPt: 48, color: ctx.color("text-strong"), bold: true, cjk: ctx.cjk, fontFace }],
        }],
      });
      textY = ctx.cm(5.0);
    }
    const textRect = {
      x: txtX + pad,
      y: textY,
      width: halfW - pad * 2,
      height: ctx.deck.height - textY - ctx.cm(2),
    };
    if (textKind === "bullets") {
      const bullets = ctx.slot<unknown[]>("bullets") ?? [];
      out.push(...bulletsBlock(ctx, textRect, bullets));
    } else {
      out.push(...richText(ctx, textRect, ctx.slot<unknown>("text"), {
        color: "text-strong",
        autoFit: "shrink",
      }));
    }
    return out;
  }

  // CARD mode (default): title at top, body row split with inset card on
  // the visual side and prose/bullets on the other.
  if (title) out.push(...slideTitle(ctx, title));

  const body = contentRect(ctx, { top: bodyTopAfterTitle(ctx, title) });
  const [textW, visW] = RATIO_WEIGHTS[ratioKey] ?? RATIO_WEIGHTS["50-50"]!;
  const colWeights: [number, number] = visualOnLeft ? [visW, textW] : [textW, visW];

  // No visual? Text takes the full body width (replaces bullet-with-image
  // sans image, and a "prose" column when the agent forgets the visual).
  if (!visual) {
    if (textKind === "bullets") {
      const bullets = ctx.slot<unknown[]>("bullets") ?? [];
      out.push(...bulletsBlock(ctx, body, bullets));
    } else {
      out.push(...richText(ctx, body, ctx.slot<unknown>("text"), {
        color: "text-strong", autoFit: "shrink",
      }));
    }
    return out;
  }

  const [colA, colB] = gridCols(ctx, body, 2, { weights: colWeights });
  const textCol = visualOnLeft ? colB! : colA!;
  const visualCol = visualOnLeft ? colA! : colB!;

  if (textKind === "bullets") {
    const bullets = ctx.slot<unknown[]>("bullets") ?? [];
    out.push(...bulletsBlock(ctx, textCol, bullets));
  } else {
    out.push(...richText(ctx, textCol, ctx.slot<unknown>("text"), {
      autoFit: "shrink",
    }));
  }

  // Image gets a card backing with insets; chart/table/svg render
  // edge-to-edge inside the cell since they carry their own visual
  // weight (axes, gridlines, table borders).
  if (visual.kind === "image") {
    out.push(...card(ctx, visualCol));
    out.push(...renderVisual(ctx, {
      x: visualCol.x + ctx.cm(0.4),
      y: visualCol.y + ctx.cm(0.4),
      width: visualCol.width - ctx.cm(0.8),
      height: visualCol.height - ctx.cm(0.8),
    }, visual));
  } else {
    out.push(...renderVisual(ctx, {
      x: visualCol.x,
      y: visualCol.y,
      width: visualCol.width,
      height: visualCol.height,
    }, visual));
  }

  return out;
};

export default visualWithText;
