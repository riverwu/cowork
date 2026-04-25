import type { Box, FillStyle, ImageCrop, LineStyle, PresentationModel, ShapeEffects, ShapeTransform, SlideElement, SlideModel, TableRow, TableStyle, TextLayout, TextStyle } from "./presentation-model";

export interface PresentationDLIR {
  docType: "presentation";
  title: string;
  pageSize: { w: number; h: number; unit: "in" };
  slides: SlideDLIR[];
}

export interface SlideDLIR {
  id: string;
  index: number;
  title: string | null;
  background?: { color?: string | null };
  summary: string;
  elements: ElementIR[];
  readingOrder: string[];
  alignmentGraph: LayoutRelation[];
  issues: LayoutIssue[];
}

export interface ElementIR {
  id: string;
  type: SlideElement["type"];
  role: "title" | "body" | "image" | "shape" | "decorative" | "unknown";
  text?: string;
  textSummary?: string;
  bbox: Box;
  importance: number;
  editableOps: string[];
  sourceRef: SlideElement["sourceRef"];
  inherited?: boolean;
  layout?: TextLayout;
  style?: TextStyle | ShapeStyleIR | ImageStyleIR | TableStyleIR;
}

export interface ShapeStyleIR {
  fill: FillStyle | null | undefined;
  line: LineStyle | null | undefined;
  effects: ShapeEffects | null | undefined;
  transform: ShapeTransform | null | undefined;
  shapeType: string;
}

export interface ImageStyleIR {
  mediaPath: string | null;
  dataUri?: string | null;
  crop?: ImageCrop | null;
  opacity?: number | null;
  transform?: ShapeTransform | null;
}

export interface TableStyleIR {
  columns: number[];
  rows: TableRow[];
  tableStyle?: TableStyle | null;
}

export interface LayoutRelation {
  type: "same_left" | "same_top" | "same_width";
  elements: string[];
}

export interface LayoutIssue {
  type: "overlap" | "off_canvas" | "empty_slide";
  severity: "low" | "medium" | "high";
  elementIds: string[];
  message: string;
}

export function buildPresentationDLIR(model: PresentationModel): PresentationDLIR {
  return {
    docType: "presentation",
    title: model.title,
    pageSize: { w: model.size.width, h: model.size.height, unit: "in" },
    slides: model.slides.map((slide) => buildSlideDLIR(slide, model.size.width, model.size.height)),
  };
}

export function buildSlideDLIR(slide: SlideModel, pageWidth: number, pageHeight: number): SlideDLIR {
  const elements = slide.elements.map((element) => elementToIR(element, slide));
  const readingOrder = [...elements]
    .sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)
    .map((element) => element.id);

  return {
    id: slide.id,
    index: slide.index,
    title: slide.title,
    background: slide.background,
    summary: summarizeSlide(slide, elements),
    elements,
    readingOrder,
    alignmentGraph: detectAlignment(elements),
    issues: detectIssues(elements, pageWidth, pageHeight),
  };
}

function elementToIR(element: SlideElement, slide: SlideModel): ElementIR {
  const role = inferRole(element, slide);
  return {
    id: element.id,
    type: element.type,
    role,
    text: element.type === "text" ? element.text : undefined,
    textSummary: element.type === "text" ? summarizeText(element.text) : element.type === "table" ? summarizeTable(element.rows) : undefined,
    bbox: element.bbox,
    importance: importanceForRole(role),
    editableOps: editableOpsForElement(element),
    sourceRef: element.sourceRef,
    inherited: element.inherited,
    layout: element.type === "text" ? element.layout : undefined,
    style: element.type === "text"
      ? element.style
      : element.type === "shape"
        ? { fill: element.fill, line: element.line, effects: element.effects, transform: element.transform, shapeType: element.shapeType }
        : element.type === "image"
          ? { mediaPath: element.mediaPath, dataUri: element.dataUri, crop: element.crop, opacity: element.opacity, transform: element.transform }
          : { columns: element.columns, rows: element.rows, tableStyle: element.style },
  };
}

function inferRole(element: SlideElement, slide: SlideModel): ElementIR["role"] {
  if (element.type === "image") return "image";
  if (element.type === "table") return "body";
  if (element.type === "shape") return element.bbox.w * element.bbox.h < 0.2 ? "decorative" : "shape";
  if (["title", "ctrTitle"].includes(element.placeholder || "")) return "title";
  if (slide.title && element.text === slide.title) return "title";
  if (element.bbox.y < 1.2 && element.bbox.h <= 1.2) return "title";
  return "body";
}

function editableOpsForElement(element: SlideElement): string[] {
  const ops = ["move", "resize", "delete"];
  if (element.type === "text") return [...ops, "replace_text", "set_text_style", "fit_text"];
  if (element.type === "image") return [...ops, "replace_image", "crop_image"];
  if (element.type === "table") return [...ops, "edit_table_cell", "set_table_style"];
  return [...ops, "set_fill", "set_line"];
}

function importanceForRole(role: ElementIR["role"]): number {
  if (role === "title") return 0.95;
  if (role === "body") return 0.7;
  if (role === "image") return 0.65;
  if (role === "shape") return 0.45;
  if (role === "decorative") return 0.2;
  return 0.3;
}

function summarizeSlide(slide: SlideModel, elements: ElementIR[]): string {
  const text = elements
    .filter((element) => element.text)
    .map((element) => element.text)
    .join(" ")
    .trim();
  if (text) return summarizeText(text, 180);
  return slide.elements.length > 0 ? `${slide.elements.length} visual elements` : "Empty slide";
}

function summarizeText(text: string, max = 120): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function summarizeTable(rows: TableRow[], max = 140): string {
  const normalized = rows
    .flatMap((row) => row.cells.map((cell) => cell.text))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function detectAlignment(elements: ElementIR[]): LayoutRelation[] {
  return [
    ...groupSame(elements, "same_left", (element) => element.bbox.x),
    ...groupSame(elements, "same_top", (element) => element.bbox.y),
    ...groupSame(elements, "same_width", (element) => element.bbox.w),
  ];
}

function groupSame(
  elements: ElementIR[],
  type: LayoutRelation["type"],
  value: (element: ElementIR) => number,
): LayoutRelation[] {
  const buckets = new Map<string, string[]>();
  for (const element of elements) {
    const key = value(element).toFixed(1);
    const ids = buckets.get(key) || [];
    ids.push(element.id);
    buckets.set(key, ids);
  }
  return [...buckets.values()]
    .filter((ids) => ids.length >= 2)
    .map((ids) => ({ type, elements: ids }));
}

function detectIssues(elements: ElementIR[], pageWidth: number, pageHeight: number): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  if (elements.length === 0) {
    issues.push({ type: "empty_slide", severity: "medium", elementIds: [], message: "Slide has no visible elements." });
  }

  for (const element of elements) {
    if (
      element.bbox.x < 0
      || element.bbox.y < 0
      || element.bbox.x + element.bbox.w > pageWidth
      || element.bbox.y + element.bbox.h > pageHeight
    ) {
      issues.push({
        type: "off_canvas",
        severity: "high",
        elementIds: [element.id],
        message: `${element.id} is outside the slide canvas.`,
      });
    }
  }

  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      if (overlapArea(elements[i].bbox, elements[j].bbox) > 0.05) {
        issues.push({
          type: "overlap",
          severity: "medium",
          elementIds: [elements[i].id, elements[j].id],
          message: `${elements[i].id} overlaps ${elements[j].id}.`,
        });
      }
    }
  }
  return issues;
}

function overlapArea(a: Box, b: Box): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}
