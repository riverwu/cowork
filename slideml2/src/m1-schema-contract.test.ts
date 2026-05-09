import { describe, expect, it } from "vitest";
import { describeDeck } from "./deck-disclosure.js";
import { describeNodeType } from "./node-types.js";
import {
  DECK_SIZE_VALUES,
  THEME_COMPONENT_STYLE_FIELDS,
  THEME_LAYOUT_FIELDS,
  VALIDATION_MODE_VALUES,
} from "./schema.js";
import { validateDeck } from "./validate.js";
import type { Slideml2SourceDeck } from "./types.js";

function baseDeck(overrides: Partial<Slideml2SourceDeck["deck"]> = {}, children = [{ id: "s.body", type: "text", text: "ok" }]): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: {
      size: "16x9",
      theme: "default",
      brand: { primary: "2563EB" },
      ...overrides,
    },
    slides: [{ id: "s", children }],
  };
}

describe("M1 schema contract", () => {
  it("supports all declared deck sizes in validation", () => {
    for (const size of DECK_SIZE_VALUES) {
      const report = validateDeck(baseDeck({ size }));
      expect(report.errors.map((e) => e.code), size).not.toContain("INVALID_DECK_SIZE");
    }
  });

  it("keeps theme layout and component style field allowlists in sync with validation", () => {
    const layout = Object.fromEntries(THEME_LAYOUT_FIELDS.map((field) => {
      if (field === "areas") return [field, { leftRail: { x: 1, y: 2.2, w: 4, h: 9 }, main: { left: 5.5, top: 2.2, right: 12.7, bottom: 12.9 } }];
      const values: Record<string, number> = {
        slideWidthCm: 25.4,
        slideHeightCm: 14.288,
        pageMarginX: 1,
        titleTop: 0.55,
        titleHeight: 1.1,
        contentTop: 2.1,
        contentBottom: 13.1,
        defaultGap: 0.35,
        columnGap: 0.6,
        cardPadding: 0.55,
      };
      return [field, values[field]];
    }));
    const componentStyle = Object.fromEntries(THEME_COMPONENT_STYLE_FIELDS.map((field) => {
      const values: Record<string, unknown> = {
        fill: "surface",
        fillOpacity: 0.92,
        line: "divider",
        lineOpacity: 0.65,
        lineWidth: 1,
        lineDash: "dash",
        borderColor: "divider",
        borderWidth: 1,
        borderStyle: "dot",
        padding: 0.55,
        cornerRadius: 0.12,
        elevation: "raised",
        shadow: { color: "brand.primary", alpha: 0.24, blur: 76200, dy: 38100 },
        gradient: { angle: 90, stops: [{ color: "surface" }, { color: "brand.tint" }] },
        accent: "brand.primary",
        accentColor: "brand.primary",
        accentWidth: 0.16,
      };
      return [field, values[field]];
    }));

    const report = validateDeck(baseDeck({
      themeOverride: {
        layout,
        component: { card: componentStyle },
      },
    }));

    const unknownThemeErrors = report.errors.filter((issue) => issue.code.startsWith("UNKNOWN_THEME_"));
    expect(unknownThemeErrors).toEqual([]);
  });

  it("exposes named areas and validation policy through disclosure", () => {
    expect(describeNodeType("stack")!.fieldsDetailed.area.valueType).toBe("string");
    expect(describeNodeType("grid")!.fieldsDetailed.area.valueType).toBe("string");

    const deckInfo = describeDeck();
    expect(deckInfo.size.supported).toEqual(expect.arrayContaining(["16x9", "16x10", "4x3", "wide"]));
    expect(deckInfo.validation.fields.mode.enum).toEqual([...VALIDATION_MODE_VALUES]);
  });

  it("experimental mode downgrades unknown node types to warnings", () => {
    const report = validateDeck(baseDeck(
      { validation: { mode: "experimental" } },
      [{ id: "s.future", type: "future-widget", label: "draft" }],
    ));

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings.map((w) => w.code)).toContain("UNKNOWN_NODE_TYPE");
  });

  it("strict mode requires image alt text and chart/table source metadata", () => {
    const report = validateDeck(baseDeck(
      { validation: { mode: "strict" } },
      [
        { id: "s.image", type: "image", src: "data:image/svg+xml;base64,PHN2Zy8+", fixedHeight: 2 },
        { id: "s.chart", type: "chart", labels: ["A"], series: [{ name: "A", values: [1] }], fixedHeight: 4 },
      ],
    ));

    const codes = report.errors.map((e) => e.code);
    expect(codes).toContain("MISSING_IMAGE_ALT");
    expect(codes).toContain("MISSING_DATA_SOURCE");
  });
});
