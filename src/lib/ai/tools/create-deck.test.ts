import { describe, expect, it, vi, beforeEach } from "vitest";
import { createDeckTool } from "./create-deck";

vi.mock("@/lib/tauri", () => ({
  slideml2CreateDeck: vi.fn(),
}));

import { slideml2CreateDeck } from "@/lib/tauri";

const mock = slideml2CreateDeck as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mock.mockReset();
  mock.mockResolvedValue({ deckPath: "/tmp/x.json" });
});

describe("createDeckTool argument coercion (288ryd regression)", () => {
  it("tells agents to save the markdown deck plan before create_deck", () => {
    expect(createDeckTool.definition.description).toContain("deck_plan.md");
    expect(createDeckTool.definition.description).toContain("write_file");
    expect(createDeckTool.definition.description).toContain("slide-by-slide component plan");
    expect(createDeckTool.definition.description).toContain("exact icon/image/chart placements");
  });

  it("documents M1 deck size, validation, layout areas, and surface fields", () => {
    expect(createDeckTool.definition.description).toContain("16x10");
    expect(createDeckTool.definition.description).toContain("areas");
    expect(createDeckTool.definition.description).toContain("fillOpacity");
    expect(createDeckTool.definition.description).toContain("strict");
    expect(createDeckTool.definition.parameters.properties).toHaveProperty("size");
    expect(createDeckTool.definition.parameters.properties).toHaveProperty("validation");
    expect(createDeckTool.definition.parameters.properties).toHaveProperty("master");
    expect(createDeckTool.definition.parameters.properties).toHaveProperty("dataSources");
    expect(createDeckTool.definition.parameters.properties).toHaveProperty("references");
    expect(createDeckTool.definition.parameters.properties).toHaveProperty("footnotes");
    expect(createDeckTool.definition.description).toContain("file-csv");
    expect(createDeckTool.definition.description).toContain("bibliography");
    expect(createDeckTool.definition.description).toContain("placeholders");
  });

  it("auto-parses themeOverride when it arrives as a JSON-encoded string", async () => {
    const result = await createDeckTool.execute({
      deckPath: "/tmp/x.json",
      themeOverride: '{"colors":{"brand":{"primary":"C41E3A"}},"layout":{"defaultGap":0.3}}',
    });
    const callArg = mock.mock.calls[0]![1] as { themeOverride?: { colors?: Record<string, unknown> } };
    expect(callArg.themeOverride).toMatchObject({
      colors: { brand: { primary: "C41E3A" } },
      layout: { defaultGap: 0.3 },
    });
    expect(String(result)).toMatch(/auto-parsed/i);
  });

  it("preserves a themeOverride object literal as-is (no parsing)", async () => {
    const override = { colors: { "brand.primary": "C41E3A" } };
    await createDeckTool.execute({ deckPath: "/tmp/x.json", themeOverride: override });
    const callArg = mock.mock.calls[0]![1] as { themeOverride?: unknown };
    expect(callArg.themeOverride).toBe(override);
  });

  it("converts numeric theme text tracking to letterSpacing before creating the deck", async () => {
    const result = await createDeckTool.execute({
      deckPath: "/tmp/x.json",
      themeOverride: {
        text: {
          eyebrow: { fontSize: 10, tracking: 2 },
        },
      },
    });

    const callArg = mock.mock.calls[0]![1] as { themeOverride?: { text?: Record<string, Record<string, unknown>> } };
    expect(callArg.themeOverride?.text?.eyebrow).toMatchObject({ fontSize: 10, letterSpacing: 2 });
    expect(callArg.themeOverride?.text?.eyebrow).not.toHaveProperty("tracking");
    expect(String(result)).toContain("converted to letterSpacing");
  });

  it("converts boolean theme text bold to fontWeight before creating the deck", async () => {
    const result = await createDeckTool.execute({
      deckPath: "/tmp/x.json",
      themeOverride: {
        text: {
          "slide-title": { fontSize: 32, bold: true },
        },
      },
    });

    const callArg = mock.mock.calls[0]![1] as { themeOverride?: { text?: Record<string, Record<string, unknown>> } };
    expect(callArg.themeOverride?.text?.["slide-title"]).toMatchObject({ fontSize: 32, fontWeight: "bold" });
    expect(callArg.themeOverride?.text?.["slide-title"]).not.toHaveProperty("bold");
    expect(String(result)).toContain("converted to fontWeight");
  });

  it("rejects unsupported theme text fields before creating a bad deck", async () => {
    const result = await createDeckTool.execute({
      deckPath: "/tmp/x.json",
      themeOverride: {
        text: {
          eyebrow: { fontSize: 10, tracking: "wide" },
        },
      },
    });

    expect(mock).not.toHaveBeenCalled();
    expect(String(result)).toContain("themeOverride.text.eyebrow.tracking");
    expect(String(result)).toContain("letterSpacing");
  });

  it("rejects a non-JSON themeOverride string instead of silently dropping it", async () => {
    const result = await createDeckTool.execute({
      deckPath: "/tmp/x.json",
      themeOverride: "not-a-json-string",
    });
    expect(mock).not.toHaveBeenCalled();
    expect(String(result)).toMatch(/^Error: themeOverride arrived as a non-JSON string/);
  });

  it("auto-parses brand when it arrives as a JSON-encoded string", async () => {
    const result = await createDeckTool.execute({
      deckPath: "/tmp/x.json",
      brand: '{"name":"Test","primary":"C41E3A"}',
    });
    const callArg = mock.mock.calls[0]![1] as { brand?: { name?: string } };
    expect(callArg.brand).toMatchObject({ name: "Test", primary: "C41E3A" });
    expect(String(result)).toMatch(/auto-parsed/i);
  });

  it("passes size and validation through to the native deck creator", async () => {
    await createDeckTool.execute({
      deckPath: "/tmp/x.json",
      size: "4x3",
      validation: { mode: "strict", requireAlt: true, requireSources: true },
    });
    const callArg = mock.mock.calls[0]![1] as { size?: string; validation?: Record<string, unknown> };
    expect(callArg.size).toBe("4x3");
    expect(callArg.validation).toMatchObject({ mode: "strict", requireAlt: true, requireSources: true });
  });

  it("passes master placeholders through to the native deck creator", async () => {
    await createDeckTool.execute({
      deckPath: "/tmp/x.json",
      master: {
        layout: "analysis",
        placeholders: [{ type: "title", x: 1, y: 0.6, w: 14, h: 1 }],
      },
    });
    const callArg = mock.mock.calls[0]![1] as { master?: Record<string, unknown> };
    expect(callArg.master).toEqual({
      layout: "analysis",
      placeholders: [{ type: "title", x: 1, y: 0.6, w: 14, h: 1 }],
    });
  });

  it("passes dataSources through to the native deck creator", async () => {
    await createDeckTool.execute({
      deckPath: "/tmp/x.json",
      dataSources: { sales: { type: "file-csv", path: "data/sales.csv" } },
    });
    const callArg = mock.mock.calls[0]![1] as { dataSources?: Record<string, unknown> };
    expect(callArg.dataSources).toEqual({ sales: { type: "file-csv", path: "data/sales.csv" } });
  });

  it("passes references and footnotes through to the native deck creator", async () => {
    await createDeckTool.execute({
      deckPath: "/tmp/x.json",
      references: [{ id: "smith2024", title: "Study", authors: ["Smith"], year: 2024 }],
      footnotes: [{ id: "n1", text: "Anonymized sample." }],
    });
    const callArg = mock.mock.calls[0]![1] as { references?: unknown[]; footnotes?: unknown[] };
    expect(callArg.references).toEqual([{ id: "smith2024", title: "Study", authors: ["Smith"], year: 2024 }]);
    expect(callArg.footnotes).toEqual([{ id: "n1", text: "Anonymized sample." }]);
  });

  it("does not report success when native createDeck rejects validation and writes no file", async () => {
    mock.mockResolvedValueOnce({
      deckPath: "/tmp/x.json",
      ok: false,
      error: "Deck creation rejected by validation with 1 error(s).",
      validation: {
        errors: [{
          code: "THEME_LAYOUT_FOOTER_OVERLAP",
          path: "deck.themeOverride.layout.contentBottom",
          message: "contentBottom enters the footer chrome zone.",
          suggestedFix: "Set contentBottom lower than the footer top.",
        }],
      },
    });

    const result = await createDeckTool.execute({ deckPath: "/tmp/x.json" });

    expect(String(result)).toMatch(/^Error: create_deck failed; deck file was not written/);
    expect(String(result)).toContain("THEME_LAYOUT_FOOTER_OVERLAP");
    expect(String(result)).toContain("Do not use write_file");
    expect(String(result)).not.toContain("Deck created at");
  });

  it("rejects unsupported deck sizes before creating a bad deck", async () => {
    const result = await createDeckTool.execute({ deckPath: "/tmp/x.json", size: "square" });
    expect(mock).not.toHaveBeenCalled();
    expect(String(result)).toContain("size must be one of");
  });

  it("rejects malformed themeOverride JSON instead of creating an unthemed deck", async () => {
    const result = await createDeckTool.execute({
      deckPath: "/tmp/x.json",
      themeOverride: '{"colors": {malformed',
    });
    expect(mock).not.toHaveBeenCalled();
    expect(String(result)).toMatch(/^Error: themeOverride string was not valid JSON/);
  });
});
