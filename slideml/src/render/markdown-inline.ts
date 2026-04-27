/**
 * markdown-inline → typed text runs.
 *
 * SlideML's `markdown-inline` slot supports a small fixed subset of Markdown:
 *
 *   **bold**         → bold run
 *   *italic*         → italic run
 *   `inline code`    → mono run
 *
 * Nothing else: no links, no headers, no lists, no tables, no images.
 * Anything that isn't one of those three constructs is plain text.
 *
 * Layouts call `parseInline(text, base)` and splice the returned runs into
 * a paragraph. Bold and italic do NOT nest; the first matching token wins.
 * The parser is line-based; it does not consume newlines as paragraph
 * breaks (that's the layout's job — see `text-block` for paragraph splits).
 */

import type { TextRun } from "../emitter/types.js";

export interface BaseRunStyle {
  sizeHalfPt?: number;
  color?: string;
  fontFace?: string;
  cjk?: boolean;
}

interface Token {
  kind: "text" | "bold" | "italic" | "code";
  value: string;
}

const TOKEN_RE = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;

/** Tokenize a single line of inline-markdown into typed segments. */
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
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < input.length) {
    tokens.push({ kind: "text", value: input.slice(lastIndex) });
  }
  if (tokens.length === 0) tokens.push({ kind: "text", value: "" });
  return tokens;
}

/**
 * Parse a markdown-inline string into a list of styled `TextRun`s suitable
 * for splicing into a paragraph. Each run inherits `base` styling and
 * overlays bold/italic/mono per token.
 */
export function parseInline(text: string, base: BaseRunStyle): TextRun[] {
  const runs: TextRun[] = [];
  const tokens = tokenize(text);
  for (const tok of tokens) {
    if (!tok.value) continue;
    const run: TextRun = {
      text: tok.value,
      sizeHalfPt: base.sizeHalfPt,
      color: base.color,
      fontFace: base.fontFace,
      cjk: base.cjk,
    };
    if (tok.kind === "bold") run.bold = true;
    if (tok.kind === "italic") run.italic = true;
    if (tok.kind === "code") run.mono = true;
    runs.push(run);
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
