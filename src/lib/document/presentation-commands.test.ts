import { describe, expect, it } from "vitest";
import {
  applyPresentationCommand,
  inferPresentationCommandFromInstruction,
  type PresentationCommand,
} from "./presentation-commands";
import type { PresentationDLIR } from "./presentation-dlir";

describe("presentation commands", () => {
  it("applies text edits and produces an inverse command for undo", () => {
    const original = sampleDLIR();
    const result = applyPresentationCommand(original, {
      type: "replace_text",
      slideId: "slide_1",
      elementId: "title",
      text: "Updated Plan",
    });

    expect(titleText(result.document)).toBe("Updated Plan");
    expect(result.document.slides[0].summary).toContain("Updated Plan");
    expect(result.inverse).toEqual({
      type: "replace_text",
      slideId: "slide_1",
      elementId: "title",
      text: "Launch Plan",
    });

    const undone = applyPresentationCommand(result.document, result.inverse);
    expect(titleText(undone.document)).toBe("Launch Plan");
  });

  it("moves and resizes elements while recalculating layout issues", () => {
    const original = sampleDLIR();
    const moved = applyPresentationCommand(original, {
      type: "move_element",
      slideId: "slide_1",
      elementId: "body",
      dx: 9,
      dy: 0,
    });

    expect(moved.document.slides[0].elements.find((element) => element.id === "body")?.bbox.x).toBe(9.5);
    expect(moved.document.slides[0].issues.some((issue) => issue.type === "off_canvas" && issue.elementIds.includes("body"))).toBe(true);

    const resized = applyPresentationCommand(original, {
      type: "resize_element",
      slideId: "slide_1",
      elementId: "body",
      bbox: { x: 0.5, y: 1.4, w: 2.25, h: 0.8 },
    });
    expect(resized.document.slides[0].elements.find((element) => element.id === "body")?.bbox).toEqual({ x: 0.5, y: 1.4, w: 2.25, h: 0.8 });
  });

  it("applies batch commands and undoes them in reverse order", () => {
    const command: PresentationCommand = {
      type: "batch",
      label: "Retitle and move body",
      commands: [
        { type: "replace_text", slideId: "slide_1", elementId: "title", text: "New Title" },
        { type: "move_element", slideId: "slide_1", elementId: "body", dx: 1, dy: 0.5 },
      ],
    };

    const result = applyPresentationCommand(sampleDLIR(), command);
    expect(titleText(result.document)).toBe("New Title");
    expect(result.document.slides[0].elements.find((element) => element.id === "body")?.bbox).toMatchObject({ x: 1.5, y: 1.9 });

    const undone = applyPresentationCommand(result.document, result.inverse);
    expect(titleText(undone.document)).toBe("Launch Plan");
    expect(undone.document.slides[0].elements.find((element) => element.id === "body")?.bbox).toMatchObject({ x: 0.5, y: 1.4 });
  });

  it("turns simple natural-language title instructions into commands", () => {
    expect(inferPresentationCommandFromInstruction(sampleDLIR(), "把标题改为：增长复盘")).toEqual({
      type: "replace_text",
      slideId: "slide_1",
      elementId: "title",
      text: "增长复盘",
    });
  });
});

function titleText(document: PresentationDLIR): string | undefined {
  return document.slides[0].elements.find((element) => element.id === "title")?.text;
}

function sampleDLIR(): PresentationDLIR {
  return {
    docType: "presentation",
    title: "Deck",
    pageSize: { w: 10, h: 5.625, unit: "in" },
    slides: [
      {
        id: "slide_1",
        index: 1,
        title: "Launch Plan",
        summary: "Launch Plan Three focused milestones",
        readingOrder: ["title", "body"],
        alignmentGraph: [{ type: "same_left", elements: ["title", "body"] }],
        issues: [],
        elements: [
          {
            id: "title",
            type: "text",
            role: "title",
            text: "Launch Plan",
            textSummary: "Launch Plan",
            bbox: { x: 0.5, y: 0.4, w: 4, h: 0.6 },
            importance: 0.95,
            editableOps: ["move", "resize", "delete", "replace_text"],
            sourceRef: { packagePath: "ppt/slides/slide1.xml" },
            style: { fontSize: 32, color: "#111111", bold: true },
          },
          {
            id: "body",
            type: "text",
            role: "body",
            text: "Three focused milestones",
            textSummary: "Three focused milestones",
            bbox: { x: 0.5, y: 1.4, w: 4, h: 0.8 },
            importance: 0.7,
            editableOps: ["move", "resize", "delete", "replace_text"],
            sourceRef: { packagePath: "ppt/slides/slide1.xml" },
            style: { fontSize: 16, color: "#333333", bold: false },
          },
        ],
      },
    ],
  };
}
