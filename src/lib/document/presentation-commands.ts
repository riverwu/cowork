import type { Box } from "./presentation-model";
import type { ElementIR, LayoutIssue, LayoutRelation, PresentationDLIR, SlideDLIR } from "./presentation-dlir";

export type PresentationCommand =
  | ReplaceTextCommand
  | MoveElementCommand
  | ResizeElementCommand
  | SetTextStyleCommand
  | BatchCommand;

export interface ReplaceTextCommand {
  type: "replace_text";
  slideId: string;
  elementId: string;
  text: string;
}

export interface MoveElementCommand {
  type: "move_element";
  slideId: string;
  elementId: string;
  dx: number;
  dy: number;
}

export interface ResizeElementCommand {
  type: "resize_element";
  slideId: string;
  elementId: string;
  bbox: Box;
}

export interface SetTextStyleCommand {
  type: "set_text_style";
  slideId: string;
  elementId: string;
  style: {
    fontSize?: number | null;
    color?: string | null;
    bold?: boolean;
  };
}

export interface BatchCommand {
  type: "batch";
  label: string;
  commands: PresentationCommand[];
}

export interface CommandResult {
  document: PresentationDLIR;
  inverse: PresentationCommand;
  description: string;
}

export function applyPresentationCommand(document: PresentationDLIR, command: PresentationCommand): CommandResult {
  if (command.type === "batch") return applyBatchCommand(document, command);

  const slide = findSlide(document, command.slideId);
  const element = slide.elements.find((candidate) => candidate.id === command.elementId);
  if (!element) throw new Error(`Element not found: ${command.elementId}`);

  const inverse = invertCommand(command, element);
  const next = updateElement(document, command.slideId, command.elementId, (target) => applyElementCommand(target, command));

  return {
    document: next,
    inverse,
    description: describeCommand(command, element),
  };
}

export function inferPresentationCommandFromInstruction(document: PresentationDLIR, instruction: string): PresentationCommand | null {
  const normalized = instruction.trim();
  if (!normalized) return null;

  const titleText = normalized.match(/(?:标题|title)\s*(?:改为|改成|修改为|设为|设置为|replace(?:\s+with)?)\s*[：:"]?(.+?)["。.]?$/i)?.[1]?.trim();
  if (titleText) {
    const target = findFirstElementByRole(document, "title");
    if (target) {
      return {
        type: "replace_text",
        slideId: target.slideId,
        elementId: target.element.id,
        text: stripWrappingQuotes(titleText),
      };
    }
  }

  const compactText = normalized.match(/(?:精简|缩短|压缩).*(?:标题|title)/i);
  if (compactText) {
    const target = findFirstElementByRole(document, "title");
    if (target?.element.text) {
      return {
        type: "replace_text",
        slideId: target.slideId,
        elementId: target.element.id,
        text: summarizeTitle(target.element.text),
      };
    }
  }

  return null;
}

function applyBatchCommand(document: PresentationDLIR, command: BatchCommand): CommandResult {
  let current = document;
  const inverses: PresentationCommand[] = [];
  const descriptions: string[] = [];

  for (const child of command.commands) {
    const result = applyPresentationCommand(current, child);
    current = result.document;
    inverses.unshift(result.inverse);
    descriptions.push(result.description);
  }

  return {
    document: current,
    inverse: { type: "batch", label: `Undo ${command.label}`, commands: inverses },
    description: command.label || descriptions.join("; "),
  };
}

function applyElementCommand(element: ElementIR, command: Exclude<PresentationCommand, BatchCommand>): ElementIR {
  if (command.type === "replace_text") {
    ensureTextElement(element, command.type);
    return { ...element, text: command.text, textSummary: summarizeText(command.text) };
  }
  if (command.type === "move_element") {
    return {
      ...element,
      bbox: {
        ...element.bbox,
        x: round(element.bbox.x + command.dx),
        y: round(element.bbox.y + command.dy),
      },
    };
  }
  if (command.type === "resize_element") {
    return { ...element, bbox: normalizeBox(command.bbox) };
  }

  ensureTextElement(element, command.type);
  return {
    ...element,
    style: {
      ...(element.style || {}),
      ...command.style,
    },
  };
}

function invertCommand(command: Exclude<PresentationCommand, BatchCommand>, element: ElementIR): PresentationCommand {
  if (command.type === "replace_text") {
    return { ...command, text: element.text || "" };
  }
  if (command.type === "move_element") {
    return { ...command, dx: -command.dx, dy: -command.dy };
  }
  if (command.type === "resize_element") {
    return { ...command, bbox: element.bbox };
  }
  return {
    ...command,
    style: {
      fontSize: textStyleValue(element, "fontSize"),
      color: textStyleValue(element, "color"),
      bold: textStyleValue(element, "bold"),
    },
  };
}

function updateElement(
  document: PresentationDLIR,
  slideId: string,
  elementId: string,
  update: (element: ElementIR) => ElementIR,
): PresentationDLIR {
  const slides = document.slides.map((slide) => {
    if (slide.id !== slideId) return slide;
    const elements = slide.elements.map((element) => element.id === elementId ? update(element) : element);
    return normalizeSlide({ ...slide, elements }, document.pageSize.w, document.pageSize.h);
  });
  return { ...document, slides };
}

function normalizeSlide(slide: SlideDLIR, pageWidth: number, pageHeight: number): SlideDLIR {
  return {
    ...slide,
    title: slide.elements.find((element) => element.role === "title" && element.text)?.text || slide.title,
    summary: summarizeSlide(slide.elements),
    readingOrder: [...slide.elements]
      .sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)
      .map((element) => element.id),
    alignmentGraph: detectAlignment(slide.elements),
    issues: detectIssues(slide.elements, pageWidth, pageHeight),
  };
}

function findSlide(document: PresentationDLIR, slideId: string): SlideDLIR {
  const slide = document.slides.find((candidate) => candidate.id === slideId);
  if (!slide) throw new Error(`Slide not found: ${slideId}`);
  return slide;
}

function findFirstElementByRole(document: PresentationDLIR, role: ElementIR["role"]): { slideId: string; element: ElementIR } | null {
  for (const slide of document.slides) {
    const element = slide.elements.find((candidate) => candidate.role === role);
    if (element) return { slideId: slide.id, element };
  }
  return null;
}

function ensureTextElement(element: ElementIR, operation: string): void {
  if (element.type !== "text") throw new Error(`${operation} requires a text element: ${element.id}`);
}

function textStyleValue<T extends "fontSize" | "color" | "bold">(element: ElementIR, key: T): SetTextStyleCommand["style"][T] {
  const style = element.style || {};
  return key in style ? (style as SetTextStyleCommand["style"])[key] : undefined;
}

function describeCommand(command: Exclude<PresentationCommand, BatchCommand>, element: ElementIR): string {
  if (command.type === "replace_text") return `替换文本：${element.id}`;
  if (command.type === "move_element") return `移动元素：${element.id}`;
  if (command.type === "resize_element") return `调整尺寸：${element.id}`;
  return `设置文字样式：${element.id}`;
}

function summarizeSlide(elements: ElementIR[]): string {
  const text = elements
    .filter((element) => element.text)
    .map((element) => element.text)
    .join(" ")
    .trim();
  if (text) return summarizeText(text, 180);
  return elements.length > 0 ? `${elements.length} visual elements` : "Empty slide";
}

function summarizeText(text: string, max = 120): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}

function summarizeTitle(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= 24) return normalized;
  return normalized.slice(0, 24).replace(/[，,、；;:：\s]+$/g, "");
}

function stripWrappingQuotes(text: string): string {
  return text.replace(/^["'“”‘’]+|["'“”‘’。]+$/g, "").trim();
}

function normalizeBox(box: Box): Box {
  return {
    x: round(box.x),
    y: round(box.y),
    w: Math.max(0.05, round(box.w)),
    h: Math.max(0.05, round(box.h)),
  };
}

function round(value: number): number {
  return Number(value.toFixed(4));
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
