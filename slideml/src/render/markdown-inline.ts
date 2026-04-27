/**
 * markdown-inline → typed text runs.
 *
 * SlideML's `markdown-inline` slot supports a small fixed subset of Markdown
 * plus two SlideML-only inline constructs (chips and icons):
 *
 *   **bold**             → bold run
 *   *italic*             → italic run
 *   `inline code`        → mono run
 *   {up:+12% YoY}        → ▲ +12% YoY    (semantic chip — coloured by theme)
 *   {down:-3pp}          → ▼ -3pp
 *   {flat:—}             → → —
 *   {ok:done}            → ✓ done
 *   {warn:risk}          → ⚠ risk
 *   {bad:miss}           → ✗ miss
 *   {highlight:critical} → ● critical
 *   :check:              → ✓                (icon — strict 12-name enum)
 *
 * Anything else is plain text. Bold and italic do NOT nest; the first
 * matching token wins. The parser is line-based; it does not consume
 * newlines as paragraph breaks (that's the layout's job — see
 * `parseInlineParagraphs` for blank-line splitting).
 */

import type { TextRun } from "../emitter/types.js";

/**
 * Strict 12-icon enum for `:icon-name:` tokens. Names map to BMP-only
 * Unicode glyphs (no emoji) so PowerPoint/LibreOffice render them with the
 * deck's regular font without falling back to a system emoji typeface.
 *
 * Adding a new icon? Pick a glyph that renders in PingFang SC + Arial.
 */
export const INLINE_ICONS = {
  "check":      "\u2713", // ✓
  "x":          "\u2717", // ✗
  "star":       "\u2605", // ★
  "arrow-up":   "\u2191", // ↑
  "arrow-down": "\u2193", // ↓
  "dot":        "\u25CF", // ●
  "warning":    "\u26A0", // ⚠
  "info":       "\u24D8", // ⓘ
  "clock":      "\u23F1", // ⏱
  "users":      "\u263B", // ☻ — small social affordance; avoids emoji
  "chart":      "\u25B0", // ▰ — solid block-chart hint
  "code":       "\u2329\u232A", // 〈〉
} as const;
export type InlineIconName = keyof typeof INLINE_ICONS;
export const INLINE_ICON_NAMES = Object.keys(INLINE_ICONS) as readonly InlineIconName[];

/** Chip kinds the parser recognises in `{kind:value}` tokens. */
export const CHIP_KINDS = ["up", "down", "flat", "ok", "warn", "bad", "highlight"] as const;
export type ChipKind = (typeof CHIP_KINDS)[number];

/** Default glyph rendered before each chip's value (themes can override). */
const CHIP_GLYPH: Record<ChipKind, string> = {
  up:        "\u25B2", // ▲
  down:      "\u25BC", // ▼
  flat:      "\u2192", // →
  ok:        "\u2713", // ✓
  warn:      "\u26A0", // ⚠
  bad:       "\u2717", // ✗
  highlight: "\u25CF", // ●
};

export interface BaseRunStyle {
  sizeHalfPt?: number;
  color?: string;
  fontFace?: string;
  /** Mono font face used for `` `code` `` runs and (optionally) icons. */
  monoFont?: string;
  cjk?: boolean;
  /**
   * Theme-aware chip color resolver. Layouts pass a function that maps a
   * chip kind to a hex color; when undefined the chip renders in `color`.
   * See `chipColorResolver(ctx)` in primitives.ts for the standard mapping.
   */
  resolveChipColor?: (kind: ChipKind) => string | undefined;
}

interface Token {
  kind: "text" | "bold" | "italic" | "code" | "chip" | "icon";
  value: string;
  chipKind?: ChipKind;
  iconGlyph?: string;
}

// One mega-regex: each alternative captures the inner payload(s).
//   1 = bold/italic/code OR chip OR icon (whole match)
//   2 = bold inner
//   3 = italic inner
//   4 = code inner
//   5 = chip kind
//   6 = chip value
//   7 = icon name
const TOKEN_RE =
  /(\*\*([^*]+?)\*\*|\*([^*\s][^*]*?)\*|`([^`]+?)`|\{(up|down|flat|ok|warn|bad|highlight):([^}]+)\}|:([a-z][a-z0-9-]{0,31}):)/g;

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(input)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: "text", value: input.slice(lastIndex, match.index) });
    }
    if (match[2] !== undefined) {
      tokens.push({ kind: "bold", value: match[2] });
    } else if (match[3] !== undefined) {
      tokens.push({ kind: "italic", value: match[3] });
    } else if (match[4] !== undefined) {
      tokens.push({ kind: "code", value: match[4] });
    } else if (match[5] !== undefined && match[6] !== undefined) {
      tokens.push({ kind: "chip", value: match[6], chipKind: match[5] as ChipKind });
    } else if (match[7] !== undefined) {
      const glyph = (INLINE_ICONS as Record<string, string>)[match[7]];
      if (glyph) {
        tokens.push({ kind: "icon", value: match[7], iconGlyph: glyph });
      } else {
        // Unknown icon — emit literally so authors notice the typo in the
        // rendered slide instead of silently swallowing the token.
        tokens.push({ kind: "text", value: match[0] });
      }
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < input.length) {
    tokens.push({ kind: "text", value: input.slice(lastIndex) });
  }
  if (tokens.length === 0) tokens.push({ kind: "text", value: "" });
  return tokens;
}

function plainRun(text: string, base: BaseRunStyle): TextRun {
  return {
    text,
    sizeHalfPt: base.sizeHalfPt,
    color: base.color,
    fontFace: base.fontFace,
    cjk: base.cjk,
  };
}

/**
 * Parse a markdown-inline string into a list of styled `TextRun`s suitable
 * for splicing into a paragraph. Each run inherits `base` styling and
 * overlays bold/italic/mono/chip-color per token.
 */
export function parseInline(text: string, base: BaseRunStyle): TextRun[] {
  const runs: TextRun[] = [];
  for (const tok of tokenize(text)) {
    if (tok.kind === "text") {
      if (!tok.value) continue;
      runs.push(plainRun(tok.value, base));
    } else if (tok.kind === "bold") {
      runs.push({ ...plainRun(tok.value, base), bold: true });
    } else if (tok.kind === "italic") {
      runs.push({ ...plainRun(tok.value, base), italic: true });
    } else if (tok.kind === "code") {
      runs.push({
        text: tok.value,
        sizeHalfPt: base.sizeHalfPt,
        color: base.color,
        fontFace: base.monoFont ?? base.fontFace,
        cjk: base.cjk,
        mono: true,
      });
    } else if (tok.kind === "chip") {
      const kind = tok.chipKind!;
      const color = base.resolveChipColor?.(kind) ?? base.color;
      const glyph = CHIP_GLYPH[kind];
      runs.push({
        text: glyph + " ",
        sizeHalfPt: base.sizeHalfPt,
        color,
        fontFace: base.fontFace,
        bold: true,
      });
      runs.push({
        text: tok.value,
        sizeHalfPt: base.sizeHalfPt,
        color,
        fontFace: base.fontFace,
        cjk: base.cjk,
        bold: true,
      });
    } else if (tok.kind === "icon") {
      runs.push({
        text: tok.iconGlyph!,
        sizeHalfPt: base.sizeHalfPt,
        color: base.color,
        fontFace: base.fontFace,
      });
    }
  }
  return runs;
}

/**
 * Convenience: parse a multi-line `text-block` (each blank-line-separated
 * paragraph becomes its own run array). Returns one `TextRun[]` per
 * paragraph; layouts wrap each in an `<a:p>` element.
 */
export function parseInlineParagraphs(text: string, base: BaseRunStyle): TextRun[][] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => parseInline(p, base));
}
