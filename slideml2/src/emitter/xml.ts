/**
 * Tiny XML helpers used by every emitter file.
 *
 * Vendored carve-out: PptxGenJS uses similar (longer) helpers in
 * `src/gen-utils.ts`. We rewrote rather than copied because they're
 * trivial — but the pitfalls list (no `#`, no 8-char hex, smart-quote
 * escape) is taken directly from theirs.
 */

const XML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/** Escape characters that have meaning in XML element content / attributes. */
export function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => XML_ESCAPE[c] ?? c);
}

/**
 * Smart quotes are the OOXML editor's classic gotcha (per pptx skill's
 * editing.md). Replace with XML numeric entities so the underlying parser
 * doesn't lose them on round-trip.
 */
const SMART_QUOTES: Record<string, string> = {
  "\u201C": "&#x201C;",
  "\u201D": "&#x201D;",
  "\u2018": "&#x2018;",
  "\u2019": "&#x2019;",
};
export function escapeText(s: string): string {
  // First escape the structural XML chars, then upgrade smart quotes.
  return xmlEscape(s).replace(/[\u201C\u201D\u2018\u2019]/g, (c) => SMART_QUOTES[c] ?? c);
}

/**
 * Validate a hex color per the SlideML contract.
 * - Exactly 6 chars
 * - 0-9 / a-f / A-F only
 * - NO `#` prefix
 * - NO 8-char (alpha-encoded) form
 *
 * Throws a structured-shape error so callers can wrap with slot context.
 */
export function assertHex(color: string, where: string): void {
  if (!/^[0-9A-Fa-f]{6}$/.test(color)) {
    if (color.startsWith("#")) {
      throw new Error(
        `${where}: hex color "${color}" must NOT include a leading "#". Use 6 hex chars only.`,
      );
    }
    if (color.length === 8) {
      throw new Error(
        `${where}: hex color "${color}" looks 8-char (alpha-encoded). Use the 6-char form and pass alpha separately. PowerPoint corrupts files on 8-char hex.`,
      );
    }
    throw new Error(
      `${where}: hex color "${color}" is not a 6-char hex string (0-9 / A-F).`,
    );
  }
}

/** Build a single XML attribute, escaping the value. */
export function attr(name: string, value: string | number | boolean | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? ` ${name}="1"` : "";
  return ` ${name}="${xmlEscape(String(value))}"`;
}

/** Convenience: join attribute strings filtering out empties. */
export function attrs(...parts: string[]): string {
  return parts.join("");
}

/** UTF-8 BOM-less XML declaration. */
export const XML_DECL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;

/** Wrap content in an XML declaration. */
export function withDecl(body: string): string {
  return `${XML_DECL}\n${body}`;
}
