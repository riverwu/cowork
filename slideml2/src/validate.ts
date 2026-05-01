import { describeComponents, getComponentName, isComponentName, isComponentTypedNode } from "./component-registry.js";
// Single source of truth for the layout/container primitive types. Adding a
// new layout primitive (e.g. another decorative wrapper) only requires
// updating this set.
const LAYOUT_CONTAINERS = new Set(["stack", "grid", "split", "panel", "card", "band", "frame", "inset"]);
import { buildTheme, textStyle } from "./theme.js";
import { inferTextKind } from "./text-normalizer.js";
import type { DomNode, RenderedDeck, Slideml2SourceDeck, SlideV2 } from "./types.js";
import { measureDeck } from "./render.js";
import { sourceSlideToRendered, sourceToRenderedDeck } from "./source-deck.js";

const RAW_HEX_RE = /^[0-9A-Fa-f]{6}$/;

export interface ValidationIssue {
  level: "error" | "warning" | "info";
  code: string;
  slideId?: string;
  path?: string;
  nodeName?: string;
  message: string;
  details?: Record<string, unknown>;
  suggestedFix?: string;
}

export interface ValidationReport {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  info: ValidationIssue[];
}

export function validateSlide(slide: SlideV2, deck?: Pick<Slideml2SourceDeck, "deck">): ValidationReport {
  const issues: ValidationIssue[] = [];
  if (!slide || typeof slide !== "object") {
    issues.push(issue("error", "INVALID_SLIDE", "Slide must be an object."));
    return report(issues);
  }
  if (!slide.id) issues.push(issue("error", "MISSING_SLIDE_ID", "Slide id is required.", { suggestedFix: "Add a stable slide.id." }));
  if (!Array.isArray(slide.children)) issues.push(issue("error", "MISSING_CHILDREN", "Slide children must be an array.", { slideId: slide.id }));
  slide.children?.forEach((node, index) => validateNode(node, `children[${index}]`, slide.id, issues));
  // Generic rule: a slide may carry exactly ONE hero title. Either set
  // `slide.title` (which the renderer auto-places in the title rect), OR
  // place a `deck-title` / `slide-title` styled text / `section-break`
  // component in the body — never both, otherwise the two render on top
  // of each other.
  const bodyHasHeroTitle = Array.isArray(slide.children) && containsTitleNode(slide.children);
  if (typeof slide.title === "string" && slide.title.trim() && bodyHasHeroTitle) {
    issues.push(issue("error", "DUPLICATE_HERO_TITLE", "slide.title is set AND the body already carries a hero title (section-break / deck-title / slide-title text). Only one — drop slide.title for cover/section pages, or remove the body title for ordinary pages.", {
      slideId: slide.id,
      suggestedFix: "If this is a cover or chapter divider, set slide.title to empty and let the body's section-break or deck-title text be the headline. Otherwise drop the body title text.",
    }));
  }
  // Skip the layout pass when the structure is broken; layout solver assumes
  // well-formed nodes (typed, with ids, recognized component types).
  // Surfacing the schema errors first gives the agent an actionable fix.
  if (issues.some((item) => item.level === "error")) return report(issues);
  try {
    const rendered: RenderedDeck = {
      deck: { size: "16x9", theme: deck?.deck.theme || "default", brand: deck?.deck.brand || {} },
      slides: [sourceSlideToRendered(slide)],
    };
    validateLayout(rendered, issues);
  } catch (error) {
    issues.push(issue("error", "LAYOUT_VALIDATION_CRASH", `Layout validator crashed: ${error instanceof Error ? error.message : String(error)}`, {
      slideId: slide.id,
      suggestedFix: "Re-author the slide with explicit ids and a registered component type for every node.",
    }));
  }
  return report(issues);
}

export function validateDeck(deck: Slideml2SourceDeck): ValidationReport {
  const issues: ValidationIssue[] = [];
  if (!deck || typeof deck !== "object") {
    issues.push(issue("error", "INVALID_DECK", "Deck must be an object."));
    return report(issues);
  }
  if (deck.slideml2 !== 2) issues.push(issue("error", "VERSION_MISMATCH", "Deck must declare slideml2: 2."));
  if (!deck.deck || deck.deck.size !== "16x9") issues.push(issue("error", "INVALID_DECK_SIZE", "Only deck.size='16x9' is supported in MVP."));
  validateThemeOverride(deck, issues);
  if (!Array.isArray(deck.slides)) {
    issues.push(issue("error", "INVALID_SLIDES", "deck.slides must be an array."));
    return report(issues);
  }
  deck.slides.forEach((slide, index) => {
    if (deck.slides.findIndex((item) => item.id === slide.id) !== index) {
      issues.push(issue("error", "DUPLICATE_SLIDE_ID", `Duplicate slide id "${slide.id}".`, { slideId: slide.id, suggestedFix: "Replace the slide with a unique id." }));
    }
    const slideReport = validateSlide(slide, deck);
    issues.push(...slideReport.errors, ...slideReport.warnings, ...slideReport.info);
  });
  if (!issues.some((item) => item.level === "error")) {
    try {
      validateLayout(sourceToRenderedDeck(deck), issues);
    } catch (error) {
      issues.push(issue("error", "LAYOUT_VALIDATION_CRASH", `Layout validator crashed: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
  return report(dedupeIssues(issues));
}

function validateNode(node: DomNode, path: string, slideId: string, issues: ValidationIssue[], parent?: DomNode): void {
  if (!node || typeof node !== "object") {
    issues.push(issue("error", "INVALID_NODE", `${path} must be a node object.`, { slideId, path }));
    return;
  }
  if (!node.id) issues.push(issue("error", "MISSING_NODE_ID", `${path}.id is required.`, { slideId, path, suggestedFix: "Give the node a stable semantic id." }));
  if (!node.type) issues.push(issue("error", "MISSING_NODE_TYPE", `${path}.type is required.`, { slideId, path }));
  if ("name" in node) issues.push(issue("error", "LEGACY_NODE_NAME", `${path}.name is not supported; use id as the stable node identity.`, { slideId, path, nodeName: node.id, suggestedFix: "Remove name and put the stable identifier in id." }));
  if ("props" in node) issues.push(issue("error", "LEGACY_NODE_PROPS", `${path}.props is not supported; node fields must be flat.`, { slideId, path, nodeName: node.id, suggestedFix: "Move every props field onto the node itself." }));
  if ("fontSize" in node || "fontFace" in node) {
    issues.push(issue("error", "RAW_TEXT_FORMATTING", `${path} uses raw text formatting; use semantic style/size/theme tokens instead.`, {
      slideId,
      path,
      nodeName: node.id,
      suggestedFix: "Remove fontSize/fontFace from the node. Use style, size, weight, and deck.themeOverride.text.",
    }));
  }
  if (node.type === "text" && typeof node.color === "string" && RAW_HEX_RE.test(node.color)) {
    issues.push(issue("error", "RAW_TEXT_HEX_COLOR", `${path}.color uses a raw hex value; text nodes must use theme color tokens.`, {
      slideId,
      path,
      nodeName: node.id,
      suggestedFix: "Replace the raw hex with a token such as text.primary, text.inverse, brand.primary, or a themeOverride color key.",
    }));
  }
  if (isComponentTypedNode(node)) validateComponentNode(node, path, slideId, issues);
  else if (LAYOUT_CONTAINERS.has(String(node.type))) {
    if (!Array.isArray(node.children)) issues.push(issue("error", "MISSING_CONTAINER_CHILDREN", `${path}.children must be an array.`, { slideId, path, nodeName: node.id }));
    else if (node.children.length === 0) issues.push(issue("error", "EMPTY_CONTAINER", `${path}.children must include at least one child.`, { slideId, path, nodeName: node.id, suggestedFix: `Add at least one child node inside this ${node.type}.` }));
    else if (node.type === "split" && node.children.length < 2) issues.push(issue("warning", "SPLIT_NEEDS_TWO", `${path} split with fewer than 2 children behaves like a plain stack.`, { slideId, path, nodeName: node.id, suggestedFix: "Add the second region or use 'stack' instead." }));
  } else if (node.type === "text") {
    if (typeof node.text !== "string" && !Array.isArray(node.content) && typeof node.content !== "string") {
      issues.push(issue("error", "MISSING_TEXT_CONTENT", `${path}.text or .content is required for text.`, { slideId, path, nodeName: node.id }));
    }
    if (!node.style) {
      const inferred = inferTextKind(node, parent);
      issues.push(issue("info", "TEXT_STYLE_INFERRED", `Text style inferred as ${inferred.kind}.`, { slideId, path, nodeName: node.id, details: { confidence: inferred.confidence, reason: inferred.reason } }));
    }
  } else if (node.type === "spacer" || node.type === "divider") {
    // Layout-only primitives; fields are optional and renderer supplies defaults.
  } else if (node.type === "bullets") {
    if (!Array.isArray(node.items)) issues.push(issue("error", "INVALID_BULLETS_ITEMS", `${path}.items must be a string array.`, { slideId, path, nodeName: node.id }));
  } else if (node.type === "image") {
    if (typeof node.src !== "string" || !node.src) issues.push(issue("error", "MISSING_IMAGE_SRC", `${path}.src is required for image.`, { slideId, path, nodeName: node.id }));
  } else if (node.type === "table") {
    if (!Array.isArray(node.rows) && !Array.isArray(node.headers)) issues.push(issue("error", "INVALID_TABLE_DATA", `${path} table needs headers and/or rows.`, { slideId, path, nodeName: node.id }));
  } else if (node.type === "chart") {
    if (!Array.isArray(node.labels) || !Array.isArray(node.series)) issues.push(issue("error", "INVALID_CHART_DATA", `${path} chart needs labels and series.`, { slideId, path, nodeName: node.id }));
  } else if (node.type !== "shape") {
    issues.push(issue("error", "UNKNOWN_NODE_TYPE", `${path}.type "${node.type}" is not supported.`, { slideId, path, nodeName: node.id, suggestedFix: "Use a primitive (stack, grid, spacer, divider, text, bullets, image, table, chart, shape) or a registered component name (slide-title, h1, callout, metric-card, ...)." }));
  }
  node.children?.forEach((child, index) => validateNode(child, `${path}.children[${index}]`, slideId, issues, node));
}

function validateThemeOverride(deck: Slideml2SourceDeck, issues: ValidationIssue[]): void {
  const text = deck.deck?.themeOverride?.text;
  if (!text || typeof text !== "object") return;
  for (const [styleName, style] of Object.entries(text)) {
    if (!style || typeof style !== "object") continue;
    const path = `deck.themeOverride.text.${styleName}`;
    if (typeof style.fontSize === "number" && style.fontSize < 7) {
      issues.push(issue("error", "THEME_FONT_TOO_SMALL", `${path}.fontSize is ${style.fontSize}pt, which is too small for PPTX output.`, {
        path,
        suggestedFix: "Use at least 7pt for footnotes/captions and 9pt+ for normal content.",
      }));
    }
    if (style.weight !== undefined && style.weight !== "normal" && style.weight !== "bold") {
      issues.push(issue("error", "INVALID_THEME_TEXT_WEIGHT", `${path}.weight must be 'normal' or 'bold'.`, {
        path,
        suggestedFix: "Use weight:'bold' for emphasis, or omit weight for normal text.",
      }));
    }
  }
}

function validateComponentNode(node: DomNode, path: string, slideId: string, issues: ValidationIssue[]): void {
  const name = getComponentName(node) || node.component;
  if (!isComponentName(name)) {
    issues.push(issue("error", "UNKNOWN_COMPONENT", `${path} component "${String(name)}" is not registered.`, {
      slideId,
      path,
      nodeName: node.id,
      suggestedFix: "Call listComponents/describeComponents and replace this slide with a registered component.",
    }));
    return;
  }
  const definition = describeComponents([name]).found[name];
  if (!definition) return;
  if (name === "article" && !hasArticleText(node)) {
    issues.push(issue("error", "MISSING_ARTICLE_CONTENT", "article requires text or paragraphs.", {
      slideId,
      path,
      nodeName: node.id,
      suggestedFix: "Replace this slide with article including text or paragraphs.",
    }));
  }
  for (const [propName, prop] of Object.entries(definition.fields)) {
    if (prop.required && (node[propName] === undefined || node[propName] === null || node[propName] === "")) {
      issues.push(issue("error", "MISSING_REQUIRED_FIELD", `${definition.name} requires ${propName}.`, {
        slideId,
        path,
        nodeName: node.id,
        suggestedFix: `Replace this slide with ${definition.name} including ${propName}.`,
      }));
    }
  }
  if (node.children?.length && !definition.children.allowed) {
    issues.push(issue("error", "COMPONENT_CHILDREN_NOT_ALLOWED", `${definition.name} does not accept children.`, {
      slideId,
      path,
      nodeName: node.id,
      suggestedFix: "Move the child nodes to a stack/grid sibling, or replace the whole slide.",
    }));
  }
  if (definition.children.required && (!Array.isArray(node.children) || node.children.length === 0)) {
    issues.push(issue("error", "EMPTY_CONTAINER_COMPONENT", `${definition.name} requires non-empty children.`, {
      slideId,
      path,
      nodeName: node.id,
      suggestedFix: `Add child components inside ${definition.name}, or replace this slide with meaningful content.`,
    }));
  }
}

function containsTitleNode(nodes: DomNode[]): boolean {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    if (node.type === "section-break" || (node.type === "component" && node.component === "section-break")) return true;
    if (node.type === "deck-title" || node.type === "slide-title") return true;
    if (node.type === "text" && (node.style === "deck-title" || node.style === "slide-title")) return true;
    const inner = (node.children as DomNode[] | undefined) || [];
    if (inner.length && containsTitleNode(inner)) return true;
  }
  return false;
}

function hasArticleText(node: DomNode): boolean {
  if (typeof node.text === "string" && node.text.trim()) return true;
  return Array.isArray(node.paragraphs) && node.paragraphs.some((item) => typeof item === "string" && item.trim());
}

function validateLayout(deck: RenderedDeck, issues: ValidationIssue[]): void {
  const theme = buildTheme(deck.deck.brand, deck.deck.theme, deck.deck.themeOverride);
  for (const slide of measureDeck(deck)) {
    for (const node of slide.nodes) {
      if (node.rect.x < -0.01 || node.rect.y < -0.01 || node.rect.x + node.rect.w > theme.layout.slideWidthCm + 0.01 || node.rect.y + node.rect.h > theme.layout.slideHeightCm + 0.01) {
        issues.push(issue("error", "NODE_OUT_OF_BOUNDS", `${node.id} is outside the slide bounds.`, { slideId: slide.slideId, nodeName: node.id, details: { rect: node.rect }, suggestedFix: "Replace this slide with wider margins or fewer regions." }));
      }
      if ((node.type === "text" || node.type === "bullets") && node.rect.h < 0.25) {
        issues.push(issue("warning", "TEXT_BOX_TOO_SHORT", `${node.id} has very little vertical space.`, { slideId: slide.slideId, nodeName: node.id, details: { rect: node.rect }, suggestedFix: "Increase parent grid/stack height or reduce sibling count." }));
      }
    }
  }
}

function issue(level: ValidationIssue["level"], code: string, message: string, extra: Partial<ValidationIssue> = {}): ValidationIssue {
  return { level, code, message, ...extra };
}

function report(issues: ValidationIssue[]): ValidationReport {
  const errors = issues.filter((item) => item.level === "error");
  const warnings = issues.filter((item) => item.level === "warning");
  const info = issues.filter((item) => item.level === "info");
  return { ok: errors.length === 0, errors, warnings, info };
}

function dedupeIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter((item) => {
    const key = `${item.level}:${item.code}:${item.slideId}:${item.path}:${item.nodeName}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
