import { describe, expect, it, vi, beforeEach } from "vitest";
import { insertSlideTool } from "./insert-slide";
import { deleteSlideTool } from "./delete-slide";

vi.mock("@/lib/tauri", () => ({
  slideml2ReadDeck: vi.fn(),
  slideml2PatchDeck: vi.fn(),
}));

import { slideml2ReadDeck, slideml2PatchDeck } from "@/lib/tauri";

const mockRead = slideml2ReadDeck as unknown as ReturnType<typeof vi.fn>;
const mockPatch = slideml2PatchDeck as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockRead.mockReset();
  mockPatch.mockReset();
});

describe("insert_slide (9gusb7)", () => {
  it("inserts at a specific index using JSON Patch op:add", async () => {
    mockRead.mockResolvedValue({ slides: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    mockPatch.mockResolvedValue({ ok: true, summary: { slideCount: 4 } });
    const result = await insertSlideTool.execute({
      deckPath: `/tmp/${Math.random().toString(36).slice(2)}.json`,
      index: 1,
      slide: { id: "newSlide", children: [] },
    });
    expect(mockPatch).toHaveBeenCalledTimes(1);
    const callArgs = mockPatch.mock.calls[0]!;
    expect(callArgs[1]).toEqual([{ op: "add", path: "/slides/1", value: { id: "newSlide", children: [] } }]);
    expect(String(result)).toMatch(/inserted at index 1/);
  });

  it("appends when index === slideCount (uses /slides/-)", async () => {
    mockRead.mockResolvedValue({ slides: [{ id: "a" }, { id: "b" }] });
    mockPatch.mockResolvedValue({ ok: true, summary: { slideCount: 3 } });
    await insertSlideTool.execute({
      deckPath: `/tmp/${Math.random().toString(36).slice(2)}.json`,
      index: 2,
      slide: { id: "appended" },
    });
    const callArgs = mockPatch.mock.calls[0]!;
    expect(callArgs[1]).toEqual([{ op: "add", path: "/slides/-", value: { id: "appended" } }]);
  });

  it("treats `index:\"end\"` as append", async () => {
    mockRead.mockResolvedValue({ slides: [{ id: "a" }] });
    mockPatch.mockResolvedValue({ ok: true, summary: { slideCount: 2 } });
    await insertSlideTool.execute({
      deckPath: `/tmp/${Math.random().toString(36).slice(2)}.json`,
      index: "end",
      slide: { id: "appended" },
    });
    const callArgs = mockPatch.mock.calls[0]!;
    expect(callArgs[1][0].path).toBe("/slides/-");
  });

  it("appends when index is omitted entirely", async () => {
    mockRead.mockResolvedValue({ slides: [{ id: "a" }] });
    mockPatch.mockResolvedValue({ ok: true, summary: { slideCount: 2 } });
    await insertSlideTool.execute({
      deckPath: `/tmp/${Math.random().toString(36).slice(2)}.json`,
      slide: { id: "appended" },
    });
    expect(mockPatch.mock.calls[0]![1][0].path).toBe("/slides/-");
  });

  it("rejects out-of-range index", async () => {
    mockRead.mockResolvedValue({ slides: [{ id: "a" }, { id: "b" }] });
    const result = await insertSlideTool.execute({
      deckPath: `/tmp/${Math.random().toString(36).slice(2)}.json`,
      index: 10,
      slide: { id: "x" },
    });
    expect(String(result)).toMatch(/out of range/);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("auto-parses a stringified slide JSON", async () => {
    mockRead.mockResolvedValue({ slides: [] });
    mockPatch.mockResolvedValue({ ok: true, summary: { slideCount: 1 } });
    await insertSlideTool.execute({
      deckPath: `/tmp/${Math.random().toString(36).slice(2)}.json`,
      slide: '{"id":"x","children":[]}',
    });
    const callArgs = mockPatch.mock.calls[0]![1];
    expect(callArgs[0].value).toEqual({ id: "x", children: [] });
  });
});

describe("delete_slide (9gusb7)", () => {
  it("deletes by string id", async () => {
    mockRead.mockResolvedValue({ slides: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    mockPatch.mockResolvedValue({ ok: true, summary: { slideCount: 2 } });
    const result = await deleteSlideTool.execute({
      deckPath: `/tmp/${Math.random().toString(36).slice(2)}.json`,
      slideId: "b",
    });
    expect(mockPatch.mock.calls[0]![1]).toEqual([{ op: "remove", path: "/slides/1" }]);
    expect(String(result)).toMatch(/deleted/i);
    expect(String(result)).toMatch(/index 1/);
  });

  it("deletes by 0-based index", async () => {
    mockRead.mockResolvedValue({ slides: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    mockPatch.mockResolvedValue({ ok: true, summary: { slideCount: 2 } });
    await deleteSlideTool.execute({
      deckPath: `/tmp/${Math.random().toString(36).slice(2)}.json`,
      slideId: 0,
    });
    expect(mockPatch.mock.calls[0]![1]).toEqual([{ op: "remove", path: "/slides/0" }]);
  });

  it("deletes by numeric string", async () => {
    mockRead.mockResolvedValue({ slides: [{ id: "a" }, { id: "b" }] });
    mockPatch.mockResolvedValue({ ok: true, summary: { slideCount: 1 } });
    await deleteSlideTool.execute({
      deckPath: `/tmp/${Math.random().toString(36).slice(2)}.json`,
      slideId: "1",
    });
    expect(mockPatch.mock.calls[0]![1]).toEqual([{ op: "remove", path: "/slides/1" }]);
  });

  it("rejects unknown slide id with helpful sample", async () => {
    mockRead.mockResolvedValue({ slides: [{ id: "alpha" }, { id: "beta" }] });
    const result = await deleteSlideTool.execute({
      deckPath: `/tmp/${Math.random().toString(36).slice(2)}.json`,
      slideId: "ghost",
    });
    expect(String(result)).toMatch(/not found/);
    expect(String(result)).toMatch(/alpha|beta/);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("rejects out-of-range index", async () => {
    mockRead.mockResolvedValue({ slides: [{ id: "a" }] });
    const result = await deleteSlideTool.execute({
      deckPath: `/tmp/${Math.random().toString(36).slice(2)}.json`,
      slideId: 5,
    });
    expect(String(result)).toMatch(/out of range/);
  });
});
