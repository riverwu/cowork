/**
 * LayoutContext — what a layout/component module receives.
 *
 * Layouts are pure functions: `(ctx) => ShapeList`. They never touch raw
 * EMU; they call `cm()`, `pt()`, `inch()`, `token()`, `font()`, and the
 * positioning helpers (`centerH`, `gridCol`, etc.) so the language stays
 * coordinate-free at the call site.
 *
 * Each render call creates a fresh context. Shape IDs are auto-issued
 * starting from 2 (id 1 is reserved by OOXML for the slide's nvGrpSpPr).
 */

import { cm as cmFn, inch as inchFn, pt as ptFn } from "../units.js";
import { primaryFontFace, type FontHint } from "../fonts.js";
import type { LoadedTheme, RequiredTokens, TokenValue } from "../theme/types.js";
import type { ShapeList } from "../emitter/types.js";

export interface DeckGeometry {
  /** Total slide width in EMU. */
  width: number;
  /** Total slide height in EMU. */
  height: number;
}

/** A column descriptor returned by `gridCol`. */
export interface GridCell {
  x: number;
  width: number;
}

export interface LayoutContext {
  /** EMU helpers. Layouts use these instead of raw numbers. */
  cm: (n: number) => number;
  pt: (n: number) => number;
  inch: (n: number) => number;

  /** Resolve a theme token by name. Throws on unknown tokens. */
  token: (name: keyof RequiredTokens | string) => TokenValue;

  /** Convenience: get a token value as a HexColor (asserts type). */
  color: (name: keyof RequiredTokens | string) => string;

  /**
   * Resolve a font face. `font("cjk")` / `font("latin")` / `font("mono")`
   * returns the FIRST family in the relevant fallback chain — OOXML's
   * `typeface=` attribute takes a single name, not a stack.
   */
  font: (hint: "latin" | "cjk" | "mono") => string;

  /** Slide geometry in EMU. */
  deck: DeckGeometry;

  /** Looks up a slot value. Throws if the slot wasn't provided AND wasn't
   *  marked optional; returns `undefined` for optional missing slots. */
  slot: <T = unknown>(name: string) => T | undefined;

  /** True when the slot was provided (regardless of value). */
  hasSlot: (name: string) => boolean;

  /** Issue a fresh shape ID. */
  id: () => number;

  /**
   * Center an element of `width` horizontally on the slide.
   * Returns the EMU x-coordinate.
   */
  centerH: (width: number) => number;

  /**
   * Center an element of `height` vertically on the slide.
   * Returns the EMU y-coordinate.
   */
  centerV: (height: number) => number;

  /**
   * `gridCol(index, totalCols, options)` — one column of an N-column grid
   * inside a band that spans the slide width with edge margins.
   *
   * - `index` is 0-based.
   * - `gap` is inter-column spacing in EMU; default `cm(1)`.
   * - `marginX` is left/right edge inset; default `cm(2)`.
   */
  gridCol: (
    index: number,
    totalCols: number,
    options?: { gap?: number; marginX?: number },
  ) => GridCell;

  /** Run-language hint: "cjk" if the deck language is a CJK locale. */
  cjk: boolean;

  /**
   * Theme-level style flags from `manifest.style`. Primitives consult
   * these to apply theme-driven design defaults (e.g. whether to draw
   * an accent rule under titles).
   */
  style: {
    titleAccentRule: boolean;
  };
}

export interface BuildContextOptions {
  theme: LoadedTheme;
  deck: DeckGeometry;
  slots: Record<string, unknown>;
  /** Optional language; falls back to `en-US` if absent. */
  language?: string;
  /** Initial id counter (defaults to 2 — id 1 is reserved by the slide group). */
  startId?: number;
}

/**
 * Build a fresh `LayoutContext`. Used by the renderer once per slide and
 * once per component invocation (components share the slide's id pool).
 */
export function buildLayoutContext(opts: BuildContextOptions): LayoutContext {
  const { theme, deck, slots, language, startId = 2 } = opts;
  const tokens = theme.manifest.tokens;
  let nextId = startId;

  const isCjk = !!language && /^(zh|ja|ko)/i.test(language);

  return {
    cm: cmFn,
    pt: ptFn,
    inch: inchFn,

    token(name) {
      if (!(name in tokens)) {
        throw new Error(
          `LayoutContext.token("${String(name)}"): unknown token. Theme "${theme.manifest.name}" defines: ${Object.keys(tokens).join(", ")}`,
        );
      }
      return tokens[name as string]!;
    },

    color(name) {
      const v = this.token(name);
      if (typeof v !== "string") {
        throw new Error(`LayoutContext.color("${String(name)}"): token is not a color string`);
      }
      return v;
    },

    font(hint) {
      // The layout asks for a semantic role; we return the right face based
      // on whether the deck is CJK. Latin layouts ignore `cjk`; CJK content
      // shapes should call `font("cjk")` explicitly.
      if (hint === "mono") return primaryFontFace("mono");
      if (hint === "cjk") return resolveFontFromToken(tokens["font-cjk"], "cjk-zh" as FontHint);
      return resolveFontFromToken(tokens["font-latin"], "latin");
    },

    deck,

    slot(name) {
      return slots[name] as never;
    },

    hasSlot(name) {
      return Object.prototype.hasOwnProperty.call(slots, name) && slots[name] !== undefined && slots[name] !== null;
    },

    id() {
      const v = nextId;
      nextId++;
      return v;
    },

    centerH(width) {
      return Math.round((deck.width - width) / 2);
    },

    centerV(height) {
      return Math.round((deck.height - height) / 2);
    },

    gridCol(index, totalCols, options) {
      const gap = options?.gap ?? cmFn(1);
      const marginX = options?.marginX ?? cmFn(2);
      const usable = deck.width - 2 * marginX;
      const totalGap = gap * Math.max(0, totalCols - 1);
      const colWidth = Math.floor((usable - totalGap) / totalCols);
      const x = marginX + index * (colWidth + gap);
      return { x, width: colWidth };
    },

    cjk: isCjk,

    style: {
      titleAccentRule: theme.manifest.style?.titleAccentRule ?? true,
    },
  };
}

function resolveFontFromToken(value: TokenValue | undefined, fallbackHint: FontHint): string {
  if (Array.isArray(value) && value.length > 0) return value[0]!;
  return primaryFontFace(fallbackHint);
}

/** A layout module's default export — the render function shape. */
export type LayoutFn = (ctx: LayoutContext) => ShapeList;
