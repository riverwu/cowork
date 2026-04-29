/**
 * `dashboard` — flexible grid where each cell hosts a polymorphic region
 * (kpi/chart/table/text/bullets/image/code/quote/sparkline/progress).
 *
 * Two equivalent input forms — pick whichever fits the agent's mental
 * model:
 *
 *   1. **Named slots** (legacy 2x2): `tl / tr / bl / br`. Backwards-
 *      compatible. Capacity max 4.
 *
 *   2. **`cells: [...]` array** (preferred for 5+ cells): 2-8 region
 *      objects. Auto-arranged based on count:
 *           2 → 1×2     5 → 2×3 (last row 2)
 *           3 → 1×3     6 → 2×3
 *           4 → 2×2     7 → 2×4 (last row 3)
 *                       8 → 2×4
 *      The previous "I have 6 things to show" pain point — agents
 *      either tried to cram into 4 named slots and dropped 2, or
 *      switched to the wrong layout. cells[] removes the choice.
 *
 * For single-purpose slides, prefer focused layouts (stat-grid-3,
 * data-table). For "list of N text cards" use `content-grid`.
 */

import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { contentRect, slideTitle } from "../render/primitives.js";
import { computeRegionTopInset, renderRegion, type Region } from "../render/regions.js";

export const slots: Record<string, SlotSchema> = {
  title: { type: "text",   maxChars: 35, optional: true },
  // Named-slot form — original 2×2 contract. Optional now that cells[]
  // is supported; validator only requires either form.
  tl:    { type: "region", optional: true },
  tr:    { type: "region", optional: true },
  bl:    { type: "region", optional: true },
  br:    { type: "region", optional: true },
  // Flexible-grid form — 2-8 region cells laid out automatically. When set,
  // takes precedence over tl/tr/bl/br.
  cells: { type: "region-list", min: 2, max: 8, optional: true },
};

/**
 * Pick a (rows, cols) shape for N cells that keeps cells reasonably
 * square at 16:9. Bias toward filling rows left-to-right; the last row
 * may be partial. Anchored to industry-standard slide-grid conventions.
 */
function gridShape(n: number): { rows: number; cols: number } {
  switch (n) {
    case 2: return { rows: 1, cols: 2 };
    case 3: return { rows: 1, cols: 3 };
    case 4: return { rows: 2, cols: 2 };
    case 5:
    case 6: return { rows: 2, cols: 3 };
    case 7:
    case 8: return { rows: 2, cols: 4 };
    default: return { rows: 2, cols: 2 };
  }
}

const dashboard: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");

  let bodyTop = ctx.cm(2);
  if (title) {
    out.push(...slideTitle(ctx, title));
    bodyTop = ctx.cm(4.4);
  }

  const body = contentRect(ctx, { top: bodyTop, bottom: ctx.cm(2) });
  const cellGap = ctx.cm(0.6);

  // Flexible cells[] form takes precedence when supplied.
  const cellsRaw = ctx.slot<unknown[]>("cells");
  const cells = Array.isArray(cellsRaw)
    ? cellsRaw.filter((c): c is Region => !!c && typeof c === "object")
    : null;

  if (cells && cells.length >= 2) {
    const { rows, cols } = gridShape(Math.min(cells.length, 8));
    const cellW = Math.floor((body.width - cellGap * (cols - 1)) / cols);
    const cellH = Math.floor((body.height - cellGap * (rows - 1)) / rows);
    // Per-row baseline alignment: cells in the same row share their
    // top-inset (max title-row height across the row) so titled and
    // un-titled cells align cleanly.
    for (let r = 0; r < rows; r++) {
      const rowSlice = cells.slice(r * cols, (r + 1) * cols);
      const rowInset = computeRegionTopInset(ctx, rowSlice);
      rowSlice.forEach((region, c) => {
        const x = body.x + c * (cellW + cellGap);
        const y = body.y + r * (cellH + cellGap);
        out.push(...renderRegion(ctx, { x, y, width: cellW, height: cellH }, region, { topInset: rowInset }));
      });
    }
    return out;
  }

  // Legacy 2×2 named-slot form — preserved verbatim for backwards-compat.
  const colW = Math.floor((body.width - cellGap) / 2);
  const rowH = Math.floor((body.height - cellGap) / 2);
  const tl = ctx.slot<Region>("tl");
  const tr = ctx.slot<Region>("tr");
  const bl = ctx.slot<Region>("bl");
  const br = ctx.slot<Region>("br");
  const topRowInset = computeRegionTopInset(ctx, [tl, tr]);
  const bottomRowInset = computeRegionTopInset(ctx, [bl, br]);
  const positions = [
    { region: tl, x: body.x,                  y: body.y,                  w: colW, h: rowH, inset: topRowInset },
    { region: tr, x: body.x + colW + cellGap, y: body.y,                  w: colW, h: rowH, inset: topRowInset },
    { region: bl, x: body.x,                  y: body.y + rowH + cellGap, w: colW, h: rowH, inset: bottomRowInset },
    { region: br, x: body.x + colW + cellGap, y: body.y + rowH + cellGap, w: colW, h: rowH, inset: bottomRowInset },
  ];
  for (const p of positions) {
    if (!p.region) continue;
    out.push(...renderRegion(ctx, { x: p.x, y: p.y, width: p.w, height: p.h }, p.region, { topInset: p.inset }));
  }
  return out;
};

export default dashboard;
