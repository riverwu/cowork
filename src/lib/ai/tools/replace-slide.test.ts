import { beforeEach, describe, expect, it, vi } from "vitest";
import { replaceSlideTool } from "./replace-slide";
import { resetAllSlideMl2AuthoringState, resetSlideWritesAfterRender } from "./slideml2-authoring-state";

vi.mock("@/lib/tauri", () => ({
  slideml2ReadDeck: vi.fn(),
  slideml2ReplaceSlide: vi.fn(),
}));

import { slideml2ReadDeck, slideml2ReplaceSlide } from "@/lib/tauri";

const mockRead = slideml2ReadDeck as unknown as ReturnType<typeof vi.fn>;
const mockReplace = slideml2ReplaceSlide as unknown as ReturnType<typeof vi.fn>;

function deckPath(): string {
  return `/tmp/${Math.random().toString(36).slice(2)}.json`;
}

beforeEach(() => {
  mockRead.mockReset();
  mockReplace.mockReset();
  resetAllSlideMl2AuthoringState();
});

describe("replace_slide duplicate target notice", () => {
  it("allows replacing the same slide position twice and returns a warning", async () => {
    const path = deckPath();
    mockRead
      .mockResolvedValueOnce({ slides: [] })
      .mockResolvedValueOnce({ slides: [{ id: "cover" }] });
    mockReplace
      .mockResolvedValueOnce({ ok: true, insertedAt: 0, slideCount: 1 })
      .mockResolvedValueOnce({ ok: true, slideCount: 1 });

    const first = await replaceSlideTool.execute({
      deckPath: path,
      slideId: 0,
      slide: { id: "cover", children: [] },
    });
    expect(String(first)).toMatch(/inserted at index 0/);

    const second = await replaceSlideTool.execute({
      deckPath: path,
      slideId: 0,
      slide: { id: "cover-v2", children: [] },
    });

    expect(String(second)).toMatch(/Slide replaced/);
    expect(String(second)).toMatch(/was replaced again before a render validation/);
    expect(mockReplace).toHaveBeenCalledTimes(2);
  });

  it("allows the same slide position again after validate_render resets the edit window", async () => {
    const path = deckPath();
    mockRead.mockResolvedValue({ slides: [{ id: "cover" }] });
    mockReplace.mockResolvedValue({ ok: true, slideCount: 1 });

    await replaceSlideTool.execute({
      deckPath: path,
      slideId: 0,
      slide: { id: "cover", children: [] },
    });
    resetSlideWritesAfterRender(path);
    const second = await replaceSlideTool.execute({
      deckPath: path,
      slideId: 0,
      slide: { id: "cover", children: [] },
    });

    expect(String(second)).toMatch(/Slide replaced/);
    expect(mockReplace).toHaveBeenCalledTimes(2);
  });
});
