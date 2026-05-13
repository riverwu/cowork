import { describe, expect, it } from "vitest";
import { describeDeck } from "./deck-disclosure.js";
import { describeNodeType } from "./node-types.js";
import {
  DECK_SIZE_VALUES,
  THEME_COMPONENT_STYLE_FIELDS,
  THEME_LAYOUT_FIELDS,
  VALIDATION_MODE_VALUES,
} from "./schema.js";
import { sourceSlideToRendered } from "./source-deck.js";
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

  it("rejects root-level themeOverride from an incorrect patch_deck path", () => {
    const report = validateDeck({
      ...baseDeck(),
      themeOverride: { layout: { contentTop: 2.7 } },
    } as unknown as Slideml2SourceDeck);

    const sourceField = report.errors.find((issue) => issue.code === "UNKNOWN_SOURCE_DECK_FIELD");
    expect(sourceField?.path).toBe("themeOverride");
    expect(sourceField?.suggestedFix).toContain("/deck/themeOverride/layout/contentTop");
  });

  it("rejects top-level area references that are not content, full, or defined named areas", () => {
    const report = validateDeck(baseDeck(
      {
        themeOverride: {
          layout: {
            areas: {
              leftRail: { x: 1, y: 2.4, w: 4, h: 8 },
            },
          },
        },
      },
      [
        { id: "s.left", type: "stack", area: "leftRail", children: [{ id: "s.left.text", type: "text", text: "Defined named area." }] },
        { id: "s.bad", type: "stack", area: "missingRail", children: [{ id: "s.bad.text", type: "text", text: "Missing named area." }] },
      ],
    ));

    expect(report.errors.map((issue) => issue.code)).toContain("UNKNOWN_LAYOUT_AREA_REFERENCE");
    expect(report.errors.find((issue) => issue.code === "UNKNOWN_LAYOUT_AREA_REFERENCE")?.path).toBe("children[1].area");
  });

  it("rejects theme areas that redefine built-in area names", () => {
    const report = validateDeck(baseDeck({
      themeOverride: {
        layout: {
          areas: {
            content: { x: 1, y: 1.4, w: 16, h: 10 },
            full: { left: 0, top: 0, right: 25.4, bottom: 14.288 },
          },
        },
      },
    }));

    const codes = report.errors.map((issue) => issue.code);
    expect(codes.filter((code) => code === "RESERVED_THEME_LAYOUT_AREA_NAME")).toHaveLength(2);
  });

  it("accepts named CSS theme text weights used by agents", () => {
    const report = validateDeck(baseDeck({
      themeOverride: {
        text: {
          "section-title": { fontSize: 20, fontWeight: "semibold" },
          "card-title": { fontSize: 14, weight: "medium" },
          "table-header": { fontSize: 11, fontWeight: 600 },
        },
      },
    }));

    expect(report.errors.map((issue) => issue.code)).not.toContain("INVALID_THEME_TEXT_WEIGHT");
  });

  it("accepts single font-face strings in theme font chains", () => {
    const report = validateDeck(baseDeck({
      themeOverride: {
        fonts: {
          latin: { display: "Arial", text: "Arial" },
          cjk: { display: "Microsoft YaHei", text: "Microsoft YaHei" },
          mono: "Consolas",
        },
      },
    }));

    expect(report.errors.map((issue) => issue.code)).not.toContain("INVALID_THEME_FONT_VALUE");
  });

  it("accepts omitted ids inside component slot nodes that render with deterministic fallback ids", () => {
    const report = validateDeck(baseDeck({}, [
      {
        id: "s.evidence",
        type: "chart-with-rail",
        evidence: {
          type: "chart-card",
          chartType: "doughnut",
          title: "HC split",
          labels: ["Sales", "R&D"],
          series: [{ name: "HC", values: [150, 55] }],
        },
        rail: {
          type: "stack",
          children: [
            { type: "metric-card", value: "150", label: "Sales" },
            { type: "callout", title: "Readout", text: "Sales dominates the mix." },
          ],
        },
      },
    ]));

    expect(report.errors.map((issue) => `${issue.code}:${issue.path}`)).not.toContain("MISSING_NODE_ID:children[0].evidence");
    expect(report.errors.map((issue) => issue.code)).not.toContain("MISSING_NODE_ID");
  });

  it("rejects component field types that would otherwise be silently ignored", () => {
    const report = validateDeck(baseDeck({}, [
      {
        id: "s.evidence",
        type: "chart-with-rail",
        ratio: 0.72,
        evidence: {
          type: "chart-card",
          chartType: "bar",
          labels: ["A", "B"],
          series: [{ name: "Series", values: [1, 2] }],
        },
        rail: { type: "callout", title: "Readout", text: "Use an array ratio." },
      },
    ]));

    const ratioError = report.errors.find((issue) => issue.path === "children[0].ratio");
    expect(ratioError?.code).toBe("INVALID_FIELD_USAGE");
    expect(ratioError?.suggestedFix).toContain("ratio:[0.72,0.28]");
  });

  it("allows contentTop to enter the default title zone for full-page layouts", () => {
    const report = validateDeck(baseDeck({
      themeOverride: {
        layout: {
          titleTop: 0.85,
          titleHeight: 1.45,
          contentTop: 1.2,
          contentBottom: 13.2,
        },
      },
    }));

    expect(report.errors.map((issue) => issue.code)).not.toContain("THEME_LAYOUT_TITLE_OVERLAP");
  });

  it("does not auto-create a content region for poster slides with only absolute content and decorative wrappers", () => {
    const deck = baseDeck(
      {
        themeOverride: {
          layout: {
            contentTop: 0,
            contentBottom: 13.2,
          },
        },
      },
      [
        {
          id: "s.decor",
          type: "stack",
          children: [
            { id: "s.decor.left", type: "image", src: "data:image/svg+xml;base64,PHN2Zy8+", at: [0, 0, 3.2, 14.29], layer: "behind", fit: "fill" },
          ],
        },
        { id: "s.eyebrow", type: "text", text: "Methodology", style: "label", at: [3.8, 3.1, 4, 0.5] },
        { id: "s.headline", type: "text", text: "Survey + experiment", style: "section-title", at: [3.8, 3.6, 18, 0.7] },
      ],
    );

    const rendered = sourceSlideToRendered(deck.slides[0]!);
    expect(rendered.dom.children.map((child) => child.id)).not.toContain("s.content");
    const report = validateDeck(deck);
    expect(report.errors.map((issue) => issue.code)).not.toContain("TOP_LEVEL_LAYOUT_OVERLAP");
  });

  it("rejects duplicate visible title labels when slide.title already renders", () => {
    const deck = baseDeck({}, [
      { id: "s.label", type: "text", text: "01  Research Question", at: [1.8, 2.4, 8, 0.4] },
      { id: "s.body", type: "text", text: "Body." },
    ]);
    deck.slides[0]!.title = "Research Question";

    const report = validateDeck(deck);

    expect(report.errors.map((issue) => issue.code)).toContain("DUPLICATE_SLIDE_TITLE_LABEL");
  });

  it("rejects absolute top-level text that overlaps a content area region", () => {
    const report = validateDeck(baseDeck(
      {
        themeOverride: {
          layout: {
            contentTop: 2.3,
            contentBottom: 13.2,
          },
        },
      },
      [
        { id: "s.content", type: "grid", area: "content", columns: 2, children: [
          { id: "s.a", type: "text", text: "A" },
          { id: "s.b", type: "text", text: "B" },
        ] },
        { id: "s.note", type: "text", text: "This absolute note would sit on top of the content grid.", at: [1.8, 7.8, 21.6, 1.2] },
      ],
    ));

    expect(report.errors.map((issue) => issue.code)).toContain("TOP_LEVEL_LAYOUT_OVERLAP");
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
