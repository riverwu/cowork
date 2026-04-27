/**
 * Font fallback chains.
 *
 * Themes reference fonts by named token (`font-latin`, `font-cjk`, `font-mono`)
 * but the chains themselves are domain knowledge that belongs in slideml so
 * every theme gets sensible defaults without re-deriving them. Themes can
 * still override per-token in their `theme.json`.
 *
 * No OS detection — a font stack is an ordered list of family names; the
 * viewer (PowerPoint / Keynote / LibreOffice) resolves to whatever it has.
 * For CJK we list the standard Win/macOS/Linux options so at least one is
 * present on every common platform.
 */

export type FontHint = "latin" | "cjk-zh" | "cjk-zh-tw" | "cjk-ja" | "cjk-ko" | "mono";

export const FONT_STACKS: Readonly<Record<FontHint, readonly string[]>> = {
  latin: [
    "Inter",
    "Helvetica Neue",
    "Helvetica",
    "Arial",
    "sans-serif",
  ],
  "cjk-zh": [
    "PingFang SC",        // macOS/iOS
    "Microsoft YaHei",    // Windows
    "Source Han Sans CN", // Adobe / cross-platform
    "Noto Sans SC",       // Google / cross-platform
    "SimHei",             // legacy Windows fallback
    "sans-serif",
  ],
  "cjk-zh-tw": [
    "PingFang TC",
    "Microsoft JhengHei",
    "Source Han Sans TC",
    "Noto Sans TC",
    "sans-serif",
  ],
  "cjk-ja": [
    "Hiragino Sans",
    "Yu Gothic",
    "Meiryo",
    "Source Han Sans JP",
    "Noto Sans JP",
    "sans-serif",
  ],
  "cjk-ko": [
    "Apple SD Gothic Neo",
    "Malgun Gothic",
    "Source Han Sans KR",
    "Noto Sans KR",
    "sans-serif",
  ],
  mono: [
    "JetBrains Mono",
    "Menlo",
    "Consolas",
    "Source Code Pro",
    "monospace",
  ],
};

/** Return the fallback chain for a hint as a fresh array. */
export function fontStackFor(hint: FontHint): string[] {
  return [...FONT_STACKS[hint]];
}

/**
 * Map a BCP-47 language tag (or `deck.language`) to the right CJK hint.
 * Returns `null` for languages that should use the latin chain.
 */
export function cjkHintForLanguage(language: string | undefined): FontHint | null {
  if (!language) return null;
  const normalized = language.toLowerCase();
  if (normalized === "zh-tw" || normalized === "zh-hant" || normalized.startsWith("zh-tw")) {
    return "cjk-zh-tw";
  }
  if (normalized.startsWith("zh")) return "cjk-zh";
  if (normalized.startsWith("ja")) return "cjk-ja";
  if (normalized.startsWith("ko")) return "cjk-ko";
  return null;
}

/**
 * Pick the primary font face for a given language. Themes use this when they
 * need to set a single `fontFace` rather than a full fallback chain (e.g.
 * when emitting OOXML which only takes one face per run).
 *
 * The first family in the resolved stack is the primary; viewers fall back
 * automatically if it's missing.
 */
export function primaryFontFace(hint: FontHint): string {
  const stack = FONT_STACKS[hint];
  return stack[0]!;
}
