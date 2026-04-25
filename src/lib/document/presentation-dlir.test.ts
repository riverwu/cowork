import { describe, expect, it } from "vitest";
import { buildPresentationDLIR, buildSlideDLIR } from "./presentation-dlir";
import type { PresentationModel, SlideModel } from "./presentation-model";

describe("buildPresentationDLIR", () => {
  it("builds a compact layout representation with roles, reading order, and edit ops", () => {
    const dlir = buildPresentationDLIR(samplePresentation());

    expect(dlir).toMatchObject({
      docType: "presentation",
      title: "Product Plan",
      pageSize: { w: 10, h: 5.625, unit: "in" },
    });
    expect(dlir.slides).toHaveLength(1);

    const slide = dlir.slides[0];
    expect(slide.summary).toContain("Launch Plan");
    expect(slide.readingOrder).toEqual(["title", "body", "image"]);
    expect(slide.elements.find((element) => element.id === "title")).toMatchObject({
      role: "title",
      type: "text",
      importance: 0.95,
      editableOps: expect.arrayContaining(["replace_text", "fit_text"]),
    });
    expect(slide.elements.find((element) => element.id === "image")).toMatchObject({
      role: "image",
      editableOps: expect.arrayContaining(["replace_image", "crop_image"]),
    });
    expect(slide.alignmentGraph).toContainEqual({
      type: "same_left",
      elements: ["title", "body"],
    });
  });

  it("reports empty, off-canvas, and overlapping layout issues", () => {
    expect(buildSlideDLIR(emptySlide(), 10, 5.625).issues).toContainEqual({
      type: "empty_slide",
      severity: "medium",
      elementIds: [],
      message: "Slide has no visible elements.",
    });

    const slide = buildSlideDLIR(problemSlide(), 10, 5.625);
    expect(slide.issues.some((issue) => issue.type === "off_canvas" && issue.elementIds.includes("outside"))).toBe(true);
    expect(slide.issues.some((issue) => issue.type === "overlap" && issue.elementIds.includes("a") && issue.elementIds.includes("b"))).toBe(true);
  });
});

function samplePresentation(): PresentationModel {
  return {
    id: "deck",
    title: "Product Plan",
    size: { width: 10, height: 5.625, unit: "in" },
    media: [],
    slides: [
      {
        id: "slide_1",
        index: 1,
        title: "Launch Plan",
        sourceRef: { packagePath: "ppt/slides/slide1.xml" },
        elements: [
          {
            id: "title",
            type: "text",
            name: "Title",
            text: "Launch Plan",
            placeholder: "title",
            bbox: { x: 0.5, y: 0.4, w: 4, h: 0.6 },
            style: { fontSize: 32, color: "#111111", bold: true },
            sourceRef: { packagePath: "ppt/slides/slide1.xml" },
          },
          {
            id: "body",
            type: "text",
            name: "Body",
            text: "Three focused milestones",
            placeholder: null,
            bbox: { x: 0.5, y: 1.3, w: 4, h: 1 },
            style: { fontSize: 16, color: "#333333", bold: false },
            sourceRef: { packagePath: "ppt/slides/slide1.xml" },
          },
          {
            id: "image",
            type: "image",
            name: "Hero",
            relationshipId: "rId1",
            mediaPath: "ppt/media/image1.png",
            bbox: { x: 5.4, y: 2.6, w: 3, h: 2 },
            sourceRef: { packagePath: "ppt/slides/slide1.xml" },
          },
        ],
      },
    ],
  };
}

function emptySlide(): SlideModel {
  return {
    id: "empty",
    index: 1,
    title: null,
    elements: [],
    sourceRef: { packagePath: "ppt/slides/slide1.xml" },
  };
}

function problemSlide(): SlideModel {
  return {
    id: "problem",
    index: 2,
    title: null,
    sourceRef: { packagePath: "ppt/slides/slide2.xml" },
    elements: [
      {
        id: "a",
        type: "shape",
        name: "A",
        shapeType: "rect",
        fill: { type: "solid", color: "#FFFFFF" },
        line: null,
        bbox: { x: 1, y: 1, w: 2, h: 2 },
        sourceRef: { packagePath: "ppt/slides/slide2.xml" },
      },
      {
        id: "b",
        type: "shape",
        name: "B",
        shapeType: "rect",
        fill: { type: "solid", color: "#FFFFFF" },
        line: null,
        bbox: { x: 2, y: 2, w: 2, h: 2 },
        sourceRef: { packagePath: "ppt/slides/slide2.xml" },
      },
      {
        id: "outside",
        type: "text",
        name: "Outside",
        text: "Too far",
        placeholder: null,
        bbox: { x: 9.5, y: 5, w: 2, h: 1 },
        style: { fontSize: 12, color: null, bold: false },
        sourceRef: { packagePath: "ppt/slides/slide2.xml" },
      },
    ],
  };
}
