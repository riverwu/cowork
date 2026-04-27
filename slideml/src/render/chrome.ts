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
import { CHROME_REGISTRY } from "../chrome/_registry.js";
import type { LoadedTheme } from "../theme/types.js";
import type { ShapeList } from "../emitter/types.js";

/** Extra fields available to chrome modules beyond a normal LayoutContext. */
export interface ChromeContext extends LayoutContext {
  /** 1-based slide index. */
  slideIndex: number;
  /** Total slides in the deck. */
  slideCount: number;
  /** Resolved header band content (left/center/right). Empty when no header. */
  header: { left?: string; center?: string; right?: string };
  /** Resolved footer band content. Empty when no footer. */
  footer: { left?: string; center?: string; right?: string };
  /**
   * Name of the section this slide belongs to — derived from the most
   * recent `section-divider` slide's `title`. Used by `section-marker`
   * chrome.
   */
  sectionName?: string;
  /**
   * Per-module override params from the slide's `chrome.override` block.
   * The chrome module decides which fields it honours (e.g. page-footer
   * reads `{ left, center, right }`; brand-bar reads `{ color }`).
   */
  overrides: Record<string, unknown>;
}

export type ChromeFn = (ctx: ChromeContext) => ShapeList;

/**
 * Map of chrome module name → which `flags` key gates it. Modules NOT in
 * this map ignore flags (always run when listed in the theme manifest).
 */
const CHROME_FLAG_KEYS: Record<string, keyof ChromeFlags> = {
  "page-header": "header",
  "page-footer": "footer",
  "brand-bar":   "brandBar",
  "page-number": "pageNumber",
};

export interface ChromeFlags {
  header: boolean;
  footer: boolean;
  brandBar: boolean;
  pageNumber: boolean;
}

/**
 * Compose chrome decorations onto an existing shape list.
 * Returns a NEW shape list with chrome appended. Mutating-free.
 *
 * Chrome resolution order:
 *   1. Start with the theme's declared chrome list (manifest.chrome[]).
 *   2. Subtract any names in `disable[]` (or whose legacy flag is false).
 *   3. Add any names in `enable[]` that aren't already in the list.
 *   4. For each remaining name, look it up in the theme's chrome map
 *      (loaded modules); if missing, also try the global registry —
 *      lets enable[] reach modules the theme didn't pre-declare.
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
  header?: { left?: string; center?: string; right?: string };
  footer?: { left?: string; center?: string; right?: string };
  flags: ChromeFlags;
  enable?: readonly string[];
  disable?: readonly string[];
  overrides?: Record<string, Record<string, unknown>>;
  sectionName?: string;
}): ShapeList {
  const themeChrome = opts.theme.manifest.chrome ?? [];
  const disable = new Set(opts.disable ?? []);
  // 1+2: start from theme list minus disabled (and minus legacy-flag-false).
  const ordered: string[] = [];
  for (const name of themeChrome) {
    if (disable.has(name)) continue;
    const flagKey = CHROME_FLAG_KEYS[name];
    if (flagKey && !opts.flags[flagKey]) continue;
    ordered.push(name);
  }
  // 3: add enable[] entries not already in the list.
  for (const name of opts.enable ?? []) {
    if (!ordered.includes(name) && !disable.has(name)) ordered.push(name);
  }
  if (ordered.length === 0) return opts.shapes;

  const out: ShapeList = [...opts.shapes];
  let nextId = opts.startId;

  for (const name of ordered) {
    // Theme-loaded chrome takes precedence; fall back to the global
    // registry so enable[] can reach modules the theme didn't declare.
    let fn: ChromeFn | undefined = opts.theme.chrome?.get(name) as ChromeFn | undefined;
    if (!fn) {
      const reg = CHROME_REGISTRY.get(name);
      if (reg) fn = reg;
    }
    if (!fn) continue;

    const baseCtx = buildLayoutContext({
      theme: opts.theme,
      deck: opts.deck,
      slots: {},
      language: opts.language,
      startId: nextId,
    });

    // Per-module override merging — page-footer / page-header pick up
    // `{ left, center, right }` from `overrides[name]`, replacing the
    // band entirely when keys are present.
    const moduleOverride = opts.overrides?.[name] ?? {};
    let header = opts.header ?? {};
    let footer = opts.footer ?? {};
    if (name === "page-header" && hasBandKey(moduleOverride)) header = pickBand(moduleOverride);
    if (name === "page-footer" && hasBandKey(moduleOverride)) footer = pickBand(moduleOverride);

    const ctx: ChromeContext = Object.assign(baseCtx, {
      slideIndex: opts.slideIndex,
      slideCount: opts.slideCount,
      header,
      footer,
      sectionName: opts.sectionName,
      overrides: moduleOverride,
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

function hasBandKey(o: Record<string, unknown>): boolean {
  return typeof o.left === "string" || typeof o.center === "string" || typeof o.right === "string";
}
function pickBand(o: Record<string, unknown>): { left?: string; center?: string; right?: string } {
  return {
    ...(typeof o.left   === "string" ? { left:   o.left   as string } : {}),
    ...(typeof o.center === "string" ? { center: o.center as string } : {}),
    ...(typeof o.right  === "string" ? { right:  o.right  as string } : {}),
  };
}
