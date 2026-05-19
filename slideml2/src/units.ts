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

export function ptToCm(n: number): number {
  return n * EMU_PER_PT / EMU_PER_CM;
}

/**
 * Parse author-facing layout dimensions into centimeters.
 *
 * SlideML2's canonical layout unit is cm, but agents commonly emit CSS/PPT-like
 * strings such as "12px", "8pt", "0.4cm", or numeric strings. Bare string
 * numbers above normal slide-layout ranges are treated as px because "12" is
 * far more often CSS padding than a deliberate 12cm inset.
 */
export function parseLayoutDimensionCm(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return undefined;
  const value = raw.trim().replace(/,/g, "");
  if (!value) return undefined;
  const match = value.match(/^(-?\d+(?:\.\d+)?)(?:\s*(cm|mm|in|pt|px))?$/i);
  if (!match) return undefined;
  const amount = Number.parseFloat(match[1] || "");
  if (!Number.isFinite(amount)) return undefined;
  const unit = (match[2] || "").toLowerCase();
  if (unit === "cm") return amount;
  if (unit === "mm") return amount / 10;
  if (unit === "in") return amount * 2.54;
  if (unit === "pt") return amount * 2.54 / 72;
  if (unit === "px") return amount * 2.54 / 96;
  return amount > 3 && amount <= 96 ? amount * 2.54 / 96 : amount;
}

/**
 * Normalize visual stroke thickness to cm for the renderer.
 *
 * Contract:
 * - layout dimensions remain cm (`x/y/w/h`, `gap`, `padding`, `fixedHeight`).
 * - text `fontSize` remains pt.
 * - stroke-like fields (`lineWidth`, `borderWidth`, divider/rule `thickness`)
 *   are authored as point sizes in normal prose. For backwards compatibility,
 *   existing tiny numeric values <= 0.3 are kept as cm because old decks used
 *   `0.02` / `0.05` for hairlines. Values above 0.3 are too large for a
 *   visible line in cm, so they are interpreted as pt.
 */
export function normalizeStrokeCm(raw: unknown, fallbackCm: number, options: { minCm?: number; maxCm?: number } = {}): number {
  const minCm = options.minCm ?? 0.005;
  const maxCm = options.maxCm ?? 0.18;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return clampNumber(fallbackCm, minCm, maxCm);
  }
  const cmValue = raw > 0.3 ? ptToCm(raw) : raw;
  return clampNumber(cmValue, minCm, maxCm);
}

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

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
