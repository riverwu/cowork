import { describe, expect, it, vi, beforeEach } from "vitest";
import { patchDeckTool } from "./patch-deck";
import { resetAllSlideMl2AuthoringState } from "./slideml2-authoring-state";

vi.mock("@/lib/tauri", () => ({
  slideml2PatchDeck: vi.fn(),
  slideml2ReadDeck: vi.fn(),
}));

import { slideml2PatchDeck, slideml2ReadDeck } from "@/lib/tauri";

const mockPatch = slideml2PatchDeck as unknown as ReturnType<typeof vi.fn>;
const mockRead = slideml2ReadDeck as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockPatch.mockReset();
  mockRead.mockReset();
  resetAllSlideMl2AuthoringState();
  mockPatch.mockResolvedValue({ ok: true, summary: { slideCount: 5 } });
  // Default deck for read: 5 slides with ids cover, intro, body1, body2, end
  mockRead.mockResolvedValue({
    deck: { themeOverride: { colors: {} } },
    slides: [
      { id: "cover" },
      { id: "intro" },
      { id: "body1" },
      { id: "body2" },
      { id: "end" },
    ],
  });
});

describe("patch_deck v2 — set group", () => {
  it("set on a leaf path emits an add op", async () => {
    await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      set: { "/deck/themeOverride/colors/brand.primary": "7C3AED" },
    });
    expect(mockPatch).toHaveBeenCalledTimes(1);
    expect(mockPatch.mock.calls[0]![1]).toEqual([
      { op: "add", path: "/deck/themeOverride/colors/brand.primary", value: "7C3AED" },
    ]);
  });

  it("set on an existing array index emits a replace op (in-place)", async () => {
    await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      set: { "/slides/2": { id: "renamed-body1", title: "New" } },
    });
    expect(mockPatch.mock.calls[0]![1]).toEqual([
      { op: "replace", path: "/slides/2", value: { id: "renamed-body1", title: "New" } },
    ]);
  });

  it("set on /arr/- emits an add op (append)", async () => {
    await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      set: { "/slides/-": { id: "appended" } },
    });
    expect(mockPatch.mock.calls[0]![1]).toEqual([
      { op: "add", path: "/slides/-", value: { id: "appended" } },
    ]);
  });

  it("set on out-of-range array index is rejected", async () => {
    const result = await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      set: { "/slides/99": { id: "x" } },
    });
    expect(String(result)).toMatch(/out of range/i);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("set creates intermediate object keys (soft-add via add op)", async () => {
    await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      set: {
        "/deck/themeOverride/text/slide-title/fontSize": 36,
        "/deck/themeOverride/text/paragraph/lineHeight": 1.6,
      },
    });
    const ops = mockPatch.mock.calls[0]![1];
    expect(ops).toHaveLength(2);
    for (const op of ops) expect(op.op).toBe("add");
  });

  it("set with multiple paths emits one op per path", async () => {
    await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      set: {
        "/deck/themeOverride/colors/brand.primary": "7C3AED",
        "/deck/themeOverride/colors/background": "FFFFFF",
        "/slides/3/title": "New Title",
      },
    });
    const ops = mockPatch.mock.calls[0]![1];
    expect(ops).toHaveLength(3);
  });
});

describe("patch_deck v2 — unset group", () => {
  it("unset emits remove ops", async () => {
    await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      unset: ["/slides/3", "/deck/themeOverride/component/badge"],
    });
    expect(mockPatch.mock.calls[0]![1]).toEqual([
      { op: "remove", path: "/slides/3" },
      { op: "remove", path: "/deck/themeOverride/component/badge" },
    ]);
  });

  it("unset rejects non-string array entries", async () => {
    const result = await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      unset: ["/slides/3", { wrong: 1 }] as unknown as string[],
    });
    expect(String(result)).toMatch(/array entries must be strings/i);
    expect(mockPatch).not.toHaveBeenCalled();
  });
});

describe("patch_deck v2 — insert group", () => {
  it("warns against bulk slide authoring and defers full render until final QA", async () => {
    const result = await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      insert: {
        "/slides/-": { id: "s1" },
        "/slides/1": { id: "s2" },
        "/slides/2": { id: "s3" },
      },
    });

    expect(String(result)).toContain("Bulk slide patch touched 3 slide targets");
    expect(String(result)).toContain("replace_slide one page at a time");
    expect(String(result)).toContain("pending final full-deck render");
    expect(String(result)).toContain("After all slides are added");
  });

  it("insert with /slides/N emits add op (splice)", async () => {
    await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      insert: { "/slides/2": { id: "newSlide" } },
    });
    expect(mockPatch.mock.calls[0]![1]).toEqual([
      { op: "add", path: "/slides/2", value: { id: "newSlide" } },
    ]);
  });

  it("insert with /slides/- emits add op (append)", async () => {
    await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      insert: { "/slides/-": { id: "appended" } },
    });
    expect(mockPatch.mock.calls[0]![1]).toEqual([
      { op: "add", path: "/slides/-", value: { id: "appended" } },
    ]);
  });

  it("insert with after:<id> resolves to the index just after that slide", async () => {
    // Deck has cover at index 0, so after:cover → index 1
    await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      insert: { "/slides/after:cover": { id: "afterCover" } },
    });
    expect(mockPatch.mock.calls[0]![1]).toEqual([
      { op: "add", path: "/slides/1", value: { id: "afterCover" } },
    ]);
  });

  it("insert with before:<id> resolves to the index of that slide", async () => {
    // Deck has body2 at index 3, so before:body2 → index 3
    await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      insert: { "/slides/before:body2": { id: "beforeBody2" } },
    });
    expect(mockPatch.mock.calls[0]![1]).toEqual([
      { op: "add", path: "/slides/3", value: { id: "beforeBody2" } },
    ]);
  });

  it("insert with unknown semantic id reports the available ids", async () => {
    const result = await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      insert: { "/slides/after:ghost": { id: "x" } },
    });
    expect(String(result)).toMatch(/no element with id="ghost"/);
    expect(String(result)).toMatch(/cover|intro|body1|body2|end/);
    expect(mockPatch).not.toHaveBeenCalled();
  });
});

describe("patch_deck v2 — move group", () => {
  it("move emits a move op", async () => {
    await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      move: { "/slides/4": "/slides/0" },
    });
    expect(mockPatch.mock.calls[0]![1]).toEqual([
      { op: "move", from: "/slides/4", path: "/slides/0" },
    ]);
  });

  it("move accepts after:<id> as destination", async () => {
    await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      move: { "/slides/4": "/slides/after:cover" },
    });
    expect(mockPatch.mock.calls[0]![1]).toEqual([
      { op: "move", from: "/slides/4", path: "/slides/1" },
    ]);
  });
});

describe("patch_deck v2 — copy group", () => {
  it("copy emits a copy op", async () => {
    await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      copy: { "/slides/0": "/slides/-" },
    });
    expect(mockPatch.mock.calls[0]![1]).toEqual([
      { op: "copy", from: "/slides/0", path: "/slides/-" },
    ]);
  });
});

describe("patch_deck v2 — operation order", () => {
  it("emits ops in the order: unset → set → insert → move → copy", async () => {
    await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      copy: { "/slides/0": "/slides/-" },
      move: { "/slides/4": "/slides/0" },
      insert: { "/slides/-": { id: "z" } },
      set: { "/deck/themeOverride/colors/brand.primary": "7C3AED" },
      unset: ["/slides/2"],
    });
    const ops = mockPatch.mock.calls[0]![1];
    expect(ops.map((o: { op: string }) => o.op)).toEqual([
      "remove", "add", "add", "move", "copy",
    ]);
  });
});

describe("patch_deck v2 — legacy array form rejection", () => {
  it("rejects {patch: [...]} and includes the auto-translation", async () => {
    const result = await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      patch: [{ op: "replace", path: "/deck/themeOverride/colors/brand.primary", value: "7C3AED" }],
    } as unknown as Record<string, unknown>);
    expect(String(result)).toMatch(/legacy.*array form has been removed/i);
    expect(String(result)).toMatch(/Your call translates to:/);
    expect(String(result)).toMatch(/"set"/);
    expect(String(result)).toMatch(/brand\.primary/);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("rejects stringified legacy array form (the 9gusb7 / 91shuw failure mode)", async () => {
    const stringified = '[{"op":"replace","path":"/deck/themeOverride/colors/brand.primary","value":"7C3AED"}]';
    const result = await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      patch: stringified,
    } as unknown as Record<string, unknown>);
    expect(String(result)).toMatch(/legacy.*array form has been removed/i);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("rejects malformed legacy patch with brace-imbalance hint not embedded (we redirect to new shape)", async () => {
    const malformed = '[{"op":"replace","path":"/deck/themeOverride","value":{}}}}]';
    const result = await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      patch: malformed,
    } as unknown as Record<string, unknown>);
    expect(String(result)).toMatch(/legacy.*removed|set\/unset\/insert/i);
    expect(mockPatch).not.toHaveBeenCalled();
  });
});

describe("patch_deck v2 — string-coercion rescue per group", () => {
  it("auto-parses set passed as a JSON-encoded string", async () => {
    await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      set: '{"/deck/themeOverride/colors/brand.primary":"7C3AED"}',
    });
    expect(mockPatch.mock.calls[0]![1]).toEqual([
      { op: "add", path: "/deck/themeOverride/colors/brand.primary", value: "7C3AED" },
    ]);
  });

  it("malformed set string returns a parse-error with brace-balance hint", async () => {
    const malformed = '{"/path":"value"}}}';
    const result = await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      set: malformed,
    });
    expect(String(result)).toMatch(/not valid JSON/i);
    expect(String(result)).toMatch(/Brace.*check/);
    expect(mockPatch).not.toHaveBeenCalled();
  });
});

describe("patch_deck v2 — empty input handling", () => {
  it("returns helpful error when no group is supplied", async () => {
    const result = await patchDeckTool.execute({ deckPath: "/tmp/x.json" });
    expect(String(result)).toMatch(/at least one of \{set, unset, insert, move, copy\}/);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("returns helpful error when groups are present but all empty", async () => {
    const result = await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      set: {},
      unset: [],
    });
    expect(String(result)).toMatch(/no operations after parsing/);
    expect(mockPatch).not.toHaveBeenCalled();
  });
});

describe("patch_deck v2 — path validation", () => {
  it("rejects empty path strings", async () => {
    const result = await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      set: { "": "value" },
    });
    expect(String(result)).toMatch(/empty path/);
  });

  it("rejects path that does not start with /", async () => {
    const result = await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      set: { "deck/themeOverride/colors/brand.primary": "7C3AED" },
    });
    expect(String(result)).toMatch(/must start with "\/"/);
  });

  it("validates every path; one bad path rolls back the whole call", async () => {
    const result = await patchDeckTool.execute({
      deckPath: "/tmp/x.json",
      set: {
        "/valid/path": 1,
        "no-leading-slash": 2,
      },
    });
    expect(String(result)).toMatch(/Patch rejected/);
    expect(mockPatch).not.toHaveBeenCalled();
  });
});
