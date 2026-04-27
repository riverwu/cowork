import { describe, expect, it } from "vitest";
import {
  EMU_PER_CM,
  EMU_PER_INCH,
  EMU_PER_PT,
  SLIDE_SIZES,
  cm,
  emuToCm,
  inch,
  pt,
  toEmu,
} from "./units.js";

describe("units — constants", () => {
  it("matches the OOXML EMU/inch ratio", () => {
    expect(EMU_PER_INCH).toBe(914_400);
    expect(EMU_PER_CM).toBe(360_000);
    expect(EMU_PER_PT).toBe(12_700);
  });
});

describe("units — toEmu", () => {
  it("treats raw numbers as EMU", () => {
    expect(toEmu(914_400)).toBe(914_400);
    expect(toEmu(0)).toBe(0);
  });

  it("parses cm strings", () => {
    expect(toEmu("1cm")).toBe(360_000);
    expect(toEmu("2.5cm")).toBe(900_000);
    expect(toEmu("0cm")).toBe(0);
  });

  it("parses inch strings", () => {
    expect(toEmu("1in")).toBe(914_400);
    expect(toEmu("0.5in")).toBe(457_200);
  });

  it("parses pt strings", () => {
    expect(toEmu("12pt")).toBe(152_400);
    expect(toEmu("1pt")).toBe(12_700);
  });

  it("parses raw EMU strings", () => {
    expect(toEmu("914400emu")).toBe(914_400);
  });

  it("is case-insensitive on the unit", () => {
    expect(toEmu("1CM")).toBe(360_000);
    expect(toEmu("1In")).toBe(914_400);
  });

  it("accepts whitespace between number and unit", () => {
    expect(toEmu("1 cm")).toBe(360_000);
  });

  it("rejects malformed input", () => {
    expect(() => toEmu("six cm" as never)).toThrow(/Invalid length/);
    expect(() => toEmu("1 furlong" as never)).toThrow(/Invalid length/);
    expect(() => toEmu("" as never)).toThrow(/Invalid length/);
  });

  it("rejects non-finite numbers", () => {
    expect(() => toEmu(Number.NaN)).toThrow(/Invalid length/);
    expect(() => toEmu(Number.POSITIVE_INFINITY)).toThrow(/Invalid length/);
  });

  it("rounds non-integer EMU values", () => {
    expect(toEmu("0.001in")).toBe(914);
  });
});

describe("units — helpers", () => {
  it("cm/inch/pt produce integer EMU", () => {
    expect(cm(1)).toBe(EMU_PER_CM);
    expect(inch(1)).toBe(EMU_PER_INCH);
    expect(pt(1)).toBe(EMU_PER_PT);
  });

  it("emuToCm round-trips integers", () => {
    expect(emuToCm(cm(7))).toBe(7);
    expect(emuToCm(cm(2.5))).toBe(2.5);
  });
});

describe("units — slide sizes", () => {
  it("matches SPEC.md dimensions for 16x9", () => {
    expect(SLIDE_SIZES["16x9"].width).toBe(9_144_000);
    expect(SLIDE_SIZES["16x9"].height).toBe(5_143_500);
  });

  it("matches SPEC.md dimensions for wide", () => {
    expect(SLIDE_SIZES["wide"].width).toBe(inch(13.333));
    expect(SLIDE_SIZES["wide"].height).toBe(inch(7.5));
  });

  it("knows the four supported sizes", () => {
    expect(Object.keys(SLIDE_SIZES).sort()).toEqual(["16x10", "16x9", "4x3", "wide"]);
  });
});
