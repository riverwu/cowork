/**
 * Length values and unit conversion.
 *
 * SlideML's internal coordinate model is EMU (English Metric Units) — the
 * unit OOXML uses natively. Theme/layout authors and external callers can
 * pass values in cm / in / pt / EMU; everything is normalized to EMU at
 * parse time.
 *
 * Conversion constants are taken from the OOXML spec and match PptxGenJS's
 * `EMU_PER_INCH = 914400`. They're stable across the format's history.
 */

export const EMU_PER_INCH = 914_400;
export const EMU_PER_CM = 360_000;
export const EMU_PER_PT = 12_700;

/**
 * A length the user can supply. Numbers are interpreted as raw EMU. Strings
 * carry an explicit unit suffix.
 */
export type Length = number | `${number}${"emu" | "cm" | "in" | "pt"}`;

const LENGTH_PATTERN = /^(-?\d+(?:\.\d+)?)\s*(emu|cm|in|pt)$/i;

/** Parse a Length to EMU. Throws on malformed input. */
export function toEmu(value: Length): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid length: ${value}`);
    }
    return Math.round(value);
  }
  const match = LENGTH_PATTERN.exec(value);
  if (!match) {
    throw new Error(
      `Invalid length: "${value}". Expected a number (EMU) or a string ` +
        `like "6cm", "0.4in", "24pt", "914400emu".`,
    );
  }
  const n = Number(match[1]);
  const unit = match[2]!.toLowerCase() as "emu" | "cm" | "in" | "pt";
  switch (unit) {
    case "emu": return Math.round(n);
    case "cm":  return Math.round(n * EMU_PER_CM);
    case "in":  return Math.round(n * EMU_PER_INCH);
    case "pt":  return Math.round(n * EMU_PER_PT);
  }
}

/** EMU helpers — call sites become readable: `cm(6)`, `inch(0.4)`. */
export const cm = (n: number): number => Math.round(n * EMU_PER_CM);
export const inch = (n: number): number => Math.round(n * EMU_PER_INCH);
export const pt = (n: number): number => Math.round(n * EMU_PER_PT);

/** Convert EMU back to cm — used by tests and debug tooling, not by the renderer. */
export function emuToCm(emu: number): number {
  return emu / EMU_PER_CM;
}

/**
 * Slide dimensions for the four supported `deck.size` values, in EMU.
 * Mirrors the table in SPEC.md.
 */
export const SLIDE_SIZES = {
  "16x9":  { width: inch(10),     height: inch(5.625) },
  "16x10": { width: inch(10),     height: inch(6.25) },
  "4x3":   { width: inch(10),     height: inch(7.5) },
  "wide":  { width: inch(13.333), height: inch(7.5) },
} as const satisfies Record<string, { width: number; height: number }>;

export type DeckSize = keyof typeof SLIDE_SIZES;
