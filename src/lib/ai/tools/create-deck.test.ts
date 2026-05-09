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
