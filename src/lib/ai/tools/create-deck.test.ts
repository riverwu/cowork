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

  it("rejects malformed themeOverride JSON instead of creating an unthemed deck", async () => {
    const result = await createDeckTool.execute({
      deckPath: "/tmp/x.json",
      themeOverride: '{"colors": {malformed',
    });
    expect(mock).not.toHaveBeenCalled();
    expect(String(result)).toMatch(/^Error: themeOverride string was not valid JSON/);
  });
});
