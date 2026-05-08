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

describe("replace_slide argument recovery", () => {
  it("tells the agent to retry replace_slide instead of mutating deck JSON after malformed string input", async () => {
    const result = await replaceSlideTool.execute({
      deckPath: deckPath(),
      slideId: 0,
      slide: "{\"id\":\"s\",\"children\":[]}]}",
    });

    expect(String(result)).toContain("slide must be a JSON object");
    expect(String(result)).toContain("object literal");
    expect(String(result)).toContain("Do not write the deck JSON");
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("auto-parses a valid JSON-stringified slide but asks for object literals next time", async () => {
    const path = deckPath();
    mockRead.mockResolvedValue({ slides: [] });
    mockReplace.mockResolvedValue({ ok: true, insertedAt: 0, slideCount: 1 });

    const result = await replaceSlideTool.execute({
      deckPath: path,
      slideId: 0,
      slide: "{\"id\":\"cover\",\"children\":[]}",
    });

    expect(String(result)).toContain("auto-parsed");
    expect(mockReplace).toHaveBeenCalledWith(path, 0, { id: "cover", children: [] });
  });
});

describe("replace_slide duplicate target notice", () => {
  it("tracks per-slide-validated writes and defers full render until all slides are added", async () => {
    const path = deckPath();
    mockRead
      .mockResolvedValueOnce({ slides: [] })
      .mockResolvedValueOnce({ slides: [{ id: "cover" }] });
    mockReplace
      .mockResolvedValueOnce({ ok: true, insertedAt: 0, slideCount: 1 })
      .mockResolvedValueOnce({ ok: true, insertedAt: 1, slideCount: 2 });

    await replaceSlideTool.execute({
      deckPath: path,
      slideId: 0,
      slide: { id: "cover", children: [] },
    });
    const second = await replaceSlideTool.execute({
      deckPath: path,
      slideId: 1,
      slide: { id: "summary", children: [] },
    });

    expect(String(second)).toContain("pending final full-deck render");
    expect(String(second)).toContain("After all slides are added");
    expect(String(second)).toContain("validate_render({deckPath, render:true}) once");
  });

  it("does not record a slide write when native per-slide validation rejects the candidate", async () => {
    const path = deckPath();
    mockRead
      .mockResolvedValueOnce({ slides: [] })
      .mockResolvedValueOnce({ slides: [] });
    mockReplace
      .mockResolvedValueOnce({
        ok: false,
        error: "Slide render validation failed with 1 blocking diagnostic(s). Deck file was not modified.",
        validation: { ok: true, errors: [] },
        diagnostics: {
          count: 1,
          summary: { SQUASHED: 1 },
          blockingCount: 1,
          blocking: [{ code: "SQUASHED", severity: "error", nodeId: "s.card", message: "Too small" }],
          qualityCount: 0,
          quality: [],
        },
      })
      .mockResolvedValueOnce({ ok: true, insertedAt: 0, slideCount: 1, validation: { ok: true, errors: [] }, diagnostics: { count: 0, summary: {}, blockingCount: 0, blocking: [], qualityCount: 0, quality: [] } });

    const rejected = await replaceSlideTool.execute({
      deckPath: path,
      slideId: 0,
      slide: { id: "bad", children: [] },
    });
    const accepted = await replaceSlideTool.execute({
      deckPath: path,
      slideId: 0,
      slide: { id: "good", children: [] },
    });

    expect(String(rejected)).toContain("deck file was not modified");
    expect(String(rejected)).toContain("renderBlocking=1");
    expect(String(accepted)).toContain("1 SlideML2 slide write(s) are pending final full-deck render");
  });

  it("returns concrete schema error details when native validation rejects the candidate", async () => {
    const path = deckPath();
    mockRead.mockResolvedValue({ slides: [] });
    mockReplace.mockResolvedValue({
      ok: false,
      error: "Candidate deck validation failed with 1 error(s).",
      validation: {
        ok: false,
        errors: [
          {
            code: "UNKNOWN_THEME_TEXT_FIELD",
            path: "deck.themeOverride.text.eyebrow.tracking",
            message: "deck.themeOverride.text.eyebrow.tracking is not a supported text style field, so it would be ignored.",
            suggestedFix: "Use letterSpacing.",
          },
        ],
      },
    });

    const rejected = await replaceSlideTool.execute({
      deckPath: path,
      slideId: 0,
      slide: { id: "cover", children: [] },
    });

    expect(String(rejected)).toContain("schemaErrorsDetail");
    expect(String(rejected)).toContain("UNKNOWN_THEME_TEXT_FIELD");
    expect(String(rejected)).toContain("deck.themeOverride.text.eyebrow.tracking");
    expect(String(rejected)).toContain("Use letterSpacing");
  });

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

describe("replace_slide semantic layout warning", () => {
  it("nudges manually positioned text-heavy slides toward semantic components", async () => {
    const path = deckPath();
    mockRead.mockResolvedValue({ slides: [] });
    mockReplace.mockResolvedValue({ ok: true, insertedAt: 0, slideCount: 1 });

    const result = await replaceSlideTool.execute({
      deckPath: path,
      slideId: 0,
      slide: {
        id: "manual",
        children: [
          { type: "text", text: "收入增长 42%", at: [1, 2, 5, 1] },
          { type: "text", text: "利润率提升", at: [1, 3, 5, 1] },
          { type: "text", text: "市场份额", at: [1, 4, 5, 1] },
          { type: "text", text: "KPI 结论", at: [1, 5, 5, 1] },
        ],
      },
    });

    expect(String(result)).toContain("Semantic layout warning");
    expect(String(result)).toContain("bar-list");
    expect(String(result)).toContain("describe_schema");
  });
});
