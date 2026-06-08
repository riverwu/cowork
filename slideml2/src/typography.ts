/**
 * Typography refinement utilities · M6.P0a
 *
 * DESIGN.md §4.3 / §6.1 calls for editorial typography in body text:
 *   - smart quotes (curly “ ” ‘ ’)
 *   - em-dash (—) for parenthetical breaks (`--`)
 *   - en-dash (–) for ranges (` - ` between digits / word boundaries)
 *
 * These are idempotent transforms — text that already uses curly quotes or
 * em-dashes is left unchanged. The functions are pure utilities; integration
 * sites apply them at the text-content boundary in the upgraded components.
 */

/**
 * Replace ASCII straight quotes with curly equivalents using a simple state
 * machine. Already-curly quotes are passed through.
 *
 * Rules:
 *   - A `"` at a word boundary opens / closes a double quote based on parity.
 *   - A `'` between letters is an apostrophe (’); at a boundary, it acts like
 *     a single quote.
 *
 * This is deliberately conservative — we don't try to handle every edge case
 * (nested quotes, locale-specific marks). Authors who want non-Latin smart
 * quotes (CJK 「」『』) can pass those through unchanged.
 */
export function smartQuotes(input: string): string {
  if (!input) return input;
  let out = "";
  let openDouble = true;
  let openSingle = true;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    const prev = i > 0 ? input[i - 1]! : "";
    const next = i + 1 < input.length ? input[i + 1]! : "";
    if (ch === '"') {
      // Toggle based on whether previous char is whitespace / start-of-string.
      if (openDouble || /\s|[\(\[\{]/.test(prev) || prev === "") {
        out += "“"; // “
        openDouble = false;
      } else {
        out += "”"; // ”
        openDouble = true;
      }
    } else if (ch === "'") {
      // Apostrophe inside a word.
      if (/[A-Za-z]/.test(prev) && /[A-Za-z]/.test(next)) {
        out += "’"; // ’
      } else if (openSingle || /\s|[\(\[\{]/.test(prev) || prev === "") {
        out += "‘"; // ‘
        openSingle = false;
      } else {
        out += "’"; // ’
        openSingle = true;
      }
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Replace `--` with em-dash (—) and ` - ` between word boundaries with
 * en-dash (–). Conservative: only when surrounded by spaces or digits.
 */
export function smartDashes(input: string): string {
  if (!input) return input;
  // `--` → em-dash
  let out = input.replace(/--/g, "—");
  // ` - ` between alphanumerics or digits → en-dash (range)
  out = out.replace(/(\w)\s-\s(\w)/g, "$1 – $2");
  return out;
}

/**
 * Apply all editorial typography transforms in sequence.
 */
export function refineTypography(input: string): string {
  if (!input) return input;
  return smartDashes(smartQuotes(input));
}
