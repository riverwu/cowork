import type { RichTextRun } from "./types.js";

/**
 * Markdown-inline → RichTextRun[] parser. Conservative: only fires when the
 * input string contains a recognized marker. Otherwise returns null so the
 * caller can keep emitting a single plain run (no behavior change).
 *
 * Recognized syntax (subset of CommonMark inline):
 *   **bold**         → bold run
 *   *italic*         → italic run            (single-* only when balanced; word-internal "*" is ignored)
 *   __underline__    → underline run         (CommonMark would call this bold; we re-purpose because PPT slides need underline)
 *   ~~strike~~       → strikethrough run
 *   ==highlight==    → highlight run         (theme-default warning tint)
 *   `code`           → code run (font:"mono")
 *   $math$           → {kind:"math",latex} inline Office Math
 *   $$math$$         → {kind:"math",latex} display-style math run
 *   {{key:text}}     → emphasis:"key" run    — also supports muted/danger/success/accent/info/warning/lead/strong/subtle
 *   {{num:42%}}      → emphasis:"key" run with size:"lg" — agents reach for this to make a number visually pop
 *   [text](url)      → hyperlink run
 *
 * Escapes:
 *   \*  \_  \=  \`  \$  \[ \{   — backslash defeats the next marker char.
 *
 * Multi-mark interaction: marks nest left-to-right but don't mix; the parser
 * handles ***bold-italic*** by recognizing the longer marker first. Unbalanced
 * markers fall back to literal text (the user sees what they typed).
 */

interface ParseResult {
  runs: RichTextRun[];
  /** True when at least one inline marker was recognized and applied. */
  matched: boolean;
}

const NAMED_EMPHASIS = new Set([
  "lead", "key", "strong", "muted", "subtle", "accent", "danger", "warning", "success", "info",
]);

export function hasMarkdownMarkers(input: string): boolean {
  if (typeof input !== "string" || !input) return false;
  // Quick scan — avoid parser overhead when nothing looks marked.
  return /(\*\*|__|~~|==|`|\{\{[a-z]+:|\[[^\]]+\]\(|(?:^|[^\w*])\*[^\s*])/.test(input) || hasMarkdownMath(input);
}

export function parseMarkdownInline(input: string): ParseResult {
  if (typeof input !== "string" || !input) return { runs: [{ text: "" }], matched: false };
  if (!hasMarkdownMarkers(input)) return { runs: [{ text: input }], matched: false };

  const runs: RichTextRun[] = [];
  let buffer = "";
  let matched = false;

  const flushBuffer = (extra?: Partial<RichTextRun>) => {
    if (!buffer && !extra) return;
    if (!buffer) return;
    runs.push({ text: buffer, ...(extra || {}) });
    buffer = "";
  };

  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    // Backslash escapes the next character.
    if (ch === "\\" && i + 1 < input.length) {
      buffer += input[i + 1];
      i += 2;
      continue;
    }
    // Three-asterisk bold-italic (***foo***) — match before ** and *.
    if (ch === "*" && input.slice(i, i + 3) === "***") {
      const close = input.indexOf("***", i + 3);
      if (close > i + 3) {
        flushBuffer();
        runs.push({ text: input.slice(i + 3, close), marks: ["bold", "italic"] });
        matched = true;
        i = close + 3;
        continue;
      }
    }
    if (ch === "*" && input.slice(i, i + 2) === "**") {
      const close = input.indexOf("**", i + 2);
      if (close > i + 2) {
        flushBuffer();
        runs.push({ text: input.slice(i + 2, close), marks: ["bold"] });
        matched = true;
        i = close + 2;
        continue;
      }
    }
    if (ch === "_" && input.slice(i, i + 2) === "__") {
      const close = input.indexOf("__", i + 2);
      if (close > i + 2) {
        flushBuffer();
        runs.push({ text: input.slice(i + 2, close), marks: ["underline"] });
        matched = true;
        i = close + 2;
        continue;
      }
    }
    if (ch === "~" && input.slice(i, i + 2) === "~~") {
      const close = input.indexOf("~~", i + 2);
      if (close > i + 2) {
        flushBuffer();
        runs.push({ text: input.slice(i + 2, close), marks: ["strikethrough"] });
        matched = true;
        i = close + 2;
        continue;
      }
    }
    if (ch === "=" && input.slice(i, i + 2) === "==") {
      const close = input.indexOf("==", i + 2);
      if (close > i + 2) {
        flushBuffer();
        runs.push({ text: input.slice(i + 2, close), highlight: "warning.tint" });
        matched = true;
        i = close + 2;
        continue;
      }
    }
    if (ch === "`") {
      const close = input.indexOf("`", i + 1);
      if (close > i + 1) {
        flushBuffer();
        runs.push({ text: input.slice(i + 1, close), font: "mono", marks: ["code"] });
        matched = true;
        i = close + 1;
        continue;
      }
    }
    if (ch === "$") {
      const math = readMarkdownMath(input, i);
      if (math) {
        flushBuffer();
        runs.push({ kind: "math", latex: math.latex, display: math.display } as RichTextRun);
        matched = true;
        i = math.end;
        continue;
      }
    }
    // Single-asterisk italic — only when not adjacent to whitespace on the
    // outside (CommonMark's emphasis rules, simplified). Avoids matching "5*3".
    if (ch === "*") {
      const prev = i > 0 ? input[i - 1] : "";
      // Find the next un-escaped, balanced single "*"
      let close = -1;
      for (let j = i + 1; j < input.length; j++) {
        if (input[j] === "\\") { j++; continue; }
        if (input[j] === "*" && input[j + 1] !== "*") { close = j; break; }
      }
      if (close > i + 1) {
        const inside = input.slice(i + 1, close);
        // Reject if inside is empty / whitespace-only / surrounding whitespace pattern would break CommonMark.
        if (inside.trim() && !/^[\s]/.test(inside) && !/[\s]$/.test(inside) && !/[A-Za-z0-9]/.test(prev || "")) {
          flushBuffer();
          runs.push({ text: inside, marks: ["italic"] });
          matched = true;
          i = close + 1;
          continue;
        }
      }
    }
    // {{name:content}} named-emphasis form.
    if (ch === "{" && input[i + 1] === "{") {
      const close = input.indexOf("}}", i + 2);
      if (close > i + 2) {
        const inner = input.slice(i + 2, close);
        const colon = inner.indexOf(":");
        if (colon > 0) {
          const name = inner.slice(0, colon).trim().toLowerCase();
          const text = inner.slice(colon + 1);
          if (NAMED_EMPHASIS.has(name)) {
            flushBuffer();
            runs.push({ text, emphasis: name as RichTextRun["emphasis"] });
            matched = true;
            i = close + 2;
            continue;
          }
          if (name === "num") {
            // {{num:25%}} — common shorthand for "make this number pop"
            flushBuffer();
            runs.push({ text, emphasis: "key", size: "lg" });
            matched = true;
            i = close + 2;
            continue;
          }
        }
      }
    }
    // [text](href) hyperlinks.
    if (ch === "[") {
      const closeBracket = findUnescaped(input, "]", i + 1);
      if (closeBracket > i + 1 && input[closeBracket + 1] === "(") {
        const closeParen = findUnescaped(input, ")", closeBracket + 2);
        if (closeParen > closeBracket + 2) {
          const linkText = input.slice(i + 1, closeBracket);
          const href = input.slice(closeBracket + 2, closeParen).trim();
          if (linkText && href) {
            flushBuffer();
            runs.push({ text: linkText, link: href, marks: ["underline"] });
            matched = true;
            i = closeParen + 1;
            continue;
          }
        }
      }
    }
    buffer += ch;
    i++;
  }
  flushBuffer();
  // If literally nothing matched but the input had marker-shaped chars,
  // collapse all buffered text into a single run so we still satisfy the
  // RichTextRun[] contract.
  if (runs.length === 0) runs.push({ text: input });
  return { runs, matched };
}

function findUnescaped(input: string, ch: string, from: number): number {
  for (let j = from; j < input.length; j++) {
    if (input[j] === "\\") { j++; continue; }
    if (input[j] === ch) return j;
  }
  return -1;
}

function hasMarkdownMath(input: string): boolean {
  for (let i = 0; i < input.length; i++) {
    if (input[i] === "\\") {
      i++;
      continue;
    }
    if (input[i] === "$" && readMarkdownMath(input, i)) return true;
  }
  return false;
}

function readMarkdownMath(input: string, start: number): { latex: string; display: boolean; end: number } | null {
  if (input[start] !== "$") return null;
  if (start > 0 && input[start - 1] === "\\") return null;
  const display = input[start + 1] === "$";
  const marker = display ? "$$" : "$";
  const bodyStart = start + marker.length;
  const first = input[bodyStart];
  if (!first || /\s/.test(first) || (!display && /[\d$]/.test(first))) return null;
  for (let i = bodyStart; i < input.length; i++) {
    if (input[i] === "\\") {
      i++;
      continue;
    }
    if (display) {
      if (input[i] === "$" && input[i + 1] === "$") {
        const latex = input.slice(bodyStart, i);
        if (!latex.trim() || /\s$/.test(latex)) return null;
        return { latex, display, end: i + 2 };
      }
    } else if (input[i] === "$") {
      const latex = input.slice(bodyStart, i);
      if (!latex.trim() || /\s$/.test(latex)) return null;
      return { latex, display, end: i + 1 };
    }
  }
  return null;
}

/**
 * Number-aware emphasis: when a text style is data-flavored (metric-value,
 * hero), bold the numeric portion and reduce surrounding label text.
 * Splits on the first contiguous run of digits / decimal points / common unit
 * suffixes (%, +, $/¥/€). Returns null when nothing number-like is present
 * so the caller keeps the original single run.
 */
export function splitNumericRun(text: string): RichTextRun[] | null {
  if (typeof text !== "string" || !text) return null;
  const match = text.match(/(^[¥$€+\-]?[\d,.]+(?:%|‰|k|m|b|x|×|倍|万|亿)?)([\s\S]*)$/i);
  if (!match) return null;
  const number = match[1];
  const rest = match[2];
  if (!number) return null;
  if (!rest) return null;
  // Only split when the rest part contains visible non-digit characters so we
  // don't pointlessly split "100" into ["100", ""].
  if (!/\S/.test(rest)) return null;
  return [
    { text: number, weight: "bold" },
    { text: rest, emphasis: "muted", size: "sm" },
  ];
}
