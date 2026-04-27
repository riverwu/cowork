/**
 * Chrome compositor.
 *
 * Chrome decorations are slide-master-style adornments applied to every
 * slide unless that slide opts out (`chrome: none`). They run AFTER the
 * layout produces its shapes, sharing the same id pool.
 *
 * A chrome module looks like:
 *
 *   export default function pageNumber(ctx: ChromeContext): ShapeList {
 *     return [...]
 *   }
 *
 * Chrome modules don't take slot values — they only see the layout context
 * and the slide's index/total within the deck.
 */

import { buildLayoutContext, type LayoutContext } from "./layout-context.js";
import type { LoadedTheme } from "../theme/types.js";
import type { ShapeList } from "../emitter/types.js";

/** Extra fields available to chrome modules beyond a normal LayoutContext. */
export interface ChromeContext extends LayoutContext {
  /** 1-based slide index. */
  slideIndex: number;
  /** Total slides in the deck. */
  slideCount: number;
}

export type ChromeFn = (ctx: ChromeContext) => ShapeList;

/**
 * Compose chrome decorations onto an existing shape list.
 * Returns a NEW shape list with chrome appended. Mutating-free.
 */
export function applyChrome(opts: {
  shapes: ShapeList;
  theme: LoadedTheme;
  deck: { width: number; height: number };
  slideIndex: number;
  slideCount: number;
  language?: string;
  /** Highest id used by the layout shapes — chrome continues from id+1. */
  startId: number;
}): ShapeList {
  const chromeNames = opts.theme.manifest.chrome ?? [];
  if (chromeNames.length === 0) return opts.shapes;

  const out: ShapeList = [...opts.shapes];
  let nextId = opts.startId;

  for (const name of chromeNames) {
    const fn = opts.theme.chrome?.get(name);
    if (!fn) continue; // chrome listed in manifest but not loaded — silently skip; loader warned

    const baseCtx = buildLayoutContext({
      theme: opts.theme,
      deck: opts.deck,
      slots: {},
      language: opts.language,
      startId: nextId,
    });

    const ctx: ChromeContext = Object.assign(baseCtx, {
      slideIndex: opts.slideIndex,
      slideCount: opts.slideCount,
    });

    const produced = (fn as ChromeFn)(ctx);
    out.push(...produced);
    // Walk produced shapes to bump nextId past the highest id used.
    for (const s of produced) {
      if (s.id >= nextId) nextId = s.id + 1;
    }
  }

  return out;
}
