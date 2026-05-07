import { describeComponents, getComponentName, isComponentName, isComponentTypedNode } from "./component-registry.js";
// Single source of truth for the layout/container primitive types. Adding a
// new layout primitive (e.g. another decorative wrapper) only requires
// updating this set.
const LAYOUT_CONTAINERS = new Set(["stack", "grid", "split", "panel", "card", "band", "frame", "inset", "fragment"]);
import { buildTheme, textStyle } from "./theme.js";
import { inferTextKind } from "./text-normalizer.js";
import type { DomNode, RenderedDeck, Slideml2SourceDeck, SlideV2 } from "./types.js";
import { measureDeck } from "./render.js";
import { sourceSlideToRendered, sourceToRenderedDeck } from "./source-deck.js";

const RAW_HEX_RE = /^[0-9A-Fa-f]{6}$/;
const THEME_OVERRIDE_KEYS = new Set(["colors", "text", "component", "tone", "layout", "fonts", "chart", "chrome", "imageGrowWeight", "sizeScale", "guidance"]);
const THEME_TEXT_STYLE_KEYS = new Set(["fontSize", "weight", "fontWeight", "color", "lineHeight", "margin", "letterSpacing", "fontFamily", "fontFeatures", "uppercase", "italic"]);
const THEME_COMPONENT_STYLE_KEYS = new Set(["fill", "line", "accent", "padding", "radius", "cornerRadius", "elevation"]);
const THEME_LAYOUT_KEYS = new Set(["slideWidthCm", "slideHeightCm", "pageMarginX", "titleTop", "titleHeight", "contentTop", "contentBottom", "defaultGap", "columnGap", "cardPadding"]);
const THEME_CHROME_KEYS = new Set(["brandMark", "pageNumber", "footerText", "footerLine", "footerHeight", "footerPadding"]);
const THEME_FONT_KEYS = new Set(["latin", "cjk", "mono"]);
const THEME_SCRIPT_FONT_KEYS = new Set(["display", "text"]);

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
      suggestedFix: "Re-author the slide with explicit ids and documented SlideML2 node types selected from the active SKILL.md.",
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
  validateDeckChrome(deck, issues);
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
  addRepeatedCardAuthoringDiagnostics(deck, issues);
  if (!issues.some((item) => item.level === "error")) {
    try {
      validateLayout(sourceToRenderedDeck(deck), issues);
    } catch (error) {
      issues.push(issue("error", "LAYOUT_VALIDATION_CRASH", `Layout validator crashed: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
  return report(dedupeIssues(issues));
}

function addRepeatedCardAuthoringDiagnostics(deck: Slideml2SourceDeck, issues: ValidationIssue[]): void {
  const perSlide = deck.slides.map((slide) => ({
    slide,
    count: countNodesOfType(slide.children || [], "insight-card"),
    equalCardGrids: countEqualCardGrids(slide.children || []),
  }));
  const total = perSlide.reduce((sum, item) => sum + item.count, 0);
  if (total >= 10) {
    const repeatedSlides = perSlide.filter((item) => item.count >= 3);
    if (repeatedSlides.length >= 3) {
      issues.push(issue(
        "warning",
        "REPEATED_CARD_LAYOUT",
        `Deck uses ${total} insight-card components across ${repeatedSlides.length} card-heavy slides; the deck may feel repetitive even though it renders successfully.`,
        {
          slideId: repeatedSlides[0]?.slide.id,
          details: {
            totalInsightCards: total,
            cardHeavySlides: repeatedSlides.map((item) => ({ slideId: item.slide.id, count: item.count })),
          },
          suggestedFix: "Replace repeated 2x2 insight-card grids with semantic layouts such as executive-summary, hero-and-support, chart-with-rail, snapshot-callouts, explanation-block, comparison-list, fact-list, timeline, process-flow, comparison-card, takeaway-list, table-card, chart-card, stat-comparison, or evidence-layout based on the slide's job.",
        },
      ));
    }
  }
  const equalGridSlides = perSlide.filter((item) => item.equalCardGrids > 0);
  const equalGridTotal = equalGridSlides.reduce((sum, item) => sum + item.equalCardGrids, 0);
  if (equalGridSlides.length >= 4 && equalGridTotal >= 4) {
    issues.push(issue(
      "warning",
      "REPEATED_EQUAL_GRID_LAYOUT",
      `Deck uses ${equalGridTotal} equal card-like grids across ${equalGridSlides.length} slides; the deck may read as a sequence of interchangeable cards.`,
      {
        slideId: equalGridSlides[0]?.slide.id,
        details: {
          equalCardGridSlides: equalGridSlides.map((item) => ({ slideId: item.slide.id, grids: item.equalCardGrids })),
        },
        suggestedFix: "Vary the page archetype: use hero-and-support for one lead idea plus satellites, chart-with-rail/evidence-layout for proof pages, snapshot-callouts for screenshot walkthroughs, process-flow/timeline for sequence, and comparison-list/table for comparisons.",
      },
    ));
  }
}

function countNodesOfType(nodes: DomNode[], type: string): number {
  let count = 0;
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    if (node.type === type || (node.type === "component" && node.component === type)) count++;
    if (Array.isArray(node.children)) count += countNodesOfType(node.children as DomNode[], type);
  }
  return count;
}

function countEqualCardGrids(nodes: DomNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    if (node.type === "grid" && isEqualCardGrid(node)) count++;
    if (Array.isArray(node.children)) count += countEqualCardGrids(node.children as DomNode[]);
  }
  return count;
}

function isEqualCardGrid(node: DomNode): boolean {
  const children = Array.isArray(node.children) ? node.children as DomNode[] : [];
  if (children.length < 3) return false;
  const columns = typeof node.columns === "number" ? node.columns : 2;
  if (columns < 2 || columns > 4) return false;
  if (children.some((child) => typeof child.colSpan === "number" && child.colSpan > 1)) return false;
  const cardLike = children.filter(isCardLikeNode).length;
  return cardLike >= Math.min(children.length, 3);
}

function isCardLikeNode(node: DomNode): boolean {
  const type = node.type === "component" && typeof node.component === "string" ? node.component : node.type;
  return typeof type === "string" && new Set([
    "card",
    "panel",
    "insight-card",
    "comparison-card",
    "feature-card",
    "step-card",
    "definition-card",
    "metric-card",
    "pricing-card",
    "profile-card",
  ]).has(type);
}

// Style tokens an LLM may write as a node `type` even though the canonical
// shape is {type:"text", style:"<token>"}. Components h1/h2/lead/label/quote
// already exist as distinct components, so they are NOT in this set.
const STYLE_TOKENS_OFTEN_USED_AS_TYPE = new Set([
  "h3", "h4", "h5", "h6",
  "body", "caption", "footnote",
  "metric-value", "metric-label", "card-title", "section-title",
  "paragraph", "bullet", "bullet-compact", "quote-source",
  "title",
]);

const TOKEN_SHAPED_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9.-]*)+$/;

function validateNode(node: DomNode, path: string, slideId: string, issues: ValidationIssue[], parent?: DomNode): void {
  if (!node || typeof node !== "object") {
    issues.push(issue("error", "INVALID_NODE", `${path} must be a node object.`, { slideId, path }));
    return;
  }
  if (!node.id) issues.push(issue("error", "MISSING_NODE_ID", `${path}.id is required.`, { slideId, path, suggestedFix: "Give the node a stable semantic id." }));
  if (!node.type) {
    issues.push(issue("error", "MISSING_NODE_TYPE", `${path}.type is required.`, {
      slideId,
      path,
      nodeName: typeof node.id === "string" ? node.id : undefined,
      suggestedFix: "Add a type field — e.g. {type:\"text\", text:\"...\"} for body copy, {type:\"stack\"} for a flow group.",
    }));
    // Skip the rest of validation for this node — without a type the
    // downstream branches all fall through to UNKNOWN_NODE_TYPE on
    // String(undefined), which the rm8s07 log showed as a confusing pair of
    // errors per node. Children are still walked.
    node.children?.forEach((child, index) => validateNode(child, `${path}.children[${index}]`, slideId, issues, node));
    return;
  }
  // `name` and `props` are reserved on raw primitives, but components frequently
  // use `name` as a documented schema field (profile-card.name). Only flag the
  // legacy shape on non-component nodes.
  if (!isComponentTypedNode(node)) {
    if ("name" in node) issues.push(issue("error", "LEGACY_NODE_NAME", `${path}.name is not supported; use id as the stable node identity.`, { slideId, path, nodeName: node.id, suggestedFix: "Remove name and put the stable identifier in id." }));
    if ("props" in node) issues.push(issue("error", "LEGACY_NODE_PROPS", `${path}.props is not supported; node fields must be flat.`, { slideId, path, nodeName: node.id, suggestedFix: "Move every props field onto the node itself." }));
  }
  if ("fontFace" in node) {
    issues.push(issue("error", "RAW_TEXT_FORMATTING", `${path} uses raw text formatting; use semantic style/size/theme tokens instead.`, {
      slideId,
      path,
      nodeName: node.id,
      suggestedFix: "Remove fontFace from the node. Use fontFamily:'display'|'text'|'mono' or deck.themeOverride.fonts.",
    }));
  }
  if ("fontSize" in node && (typeof node.fontSize !== "number" || !Number.isFinite(node.fontSize) || node.fontSize < 7)) {
    issues.push(issue("error", "INVALID_NODE_FONT_SIZE", `${path}.fontSize must be a readable point size >= 7.`, {
      slideId,
      path,
      nodeName: node.id,
      suggestedFix: "Use a numeric fontSize >= 7, or use semantic size:'sm'|'md'|'lg' for safer scaling.",
    }));
  }
  if (node.type === "text" && typeof node.color === "string" && RAW_HEX_RE.test(node.color)) {
    issues.push(issue("error", "RAW_TEXT_HEX_COLOR", `${path}.color uses a raw hex value. This rule applies ONLY to text nodes' color; band/card/shape fill may still use raw hex. Use a token such as text.primary, text.inverse, brand.primary, or a themeOverride.colors key for text colors.`, {
      slideId,
      path,
      nodeName: node.id,
      suggestedFix: "Replace text.color hex with a theme color token. Hex on band/card/shape.fill is allowed — do not move the hex value to fill if the intent is to color text.",
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
    if (typeof node.type === "string" && STYLE_TOKENS_OFTEN_USED_AS_TYPE.has(node.type)) {
      issues.push(issue("error", "STYLE_AS_TYPE", `${path}.type "${node.type}" is a text style token, not a node type. Use {type:"text", style:"${node.type}", text:"..."} instead.`, {
        slideId,
        path,
        nodeName: node.id,
        suggestedFix: `Replace ${path}.type with "text" and add style:"${node.type}".`,
      }));
    } else {
      const nodeType = String(node.type);
      const customSuggestion = unknownTypeSuggestion(nodeType);
      issues.push(issue("error", "UNKNOWN_NODE_TYPE", `${path}.type "${nodeType}" is not supported.`, {
        slideId,
        path,
        nodeName: node.id,
        suggestedFix: customSuggestion || "Use a documented SlideML2 node type selected from the active SKILL.md; keep node fields flat.",
      }));
    }
  }
  node.children?.forEach((child, index) => validateNode(child, `${path}.children[${index}]`, slideId, issues, node));
}

/**
 * Map common typos / not-yet-implemented type names that LLMs reach for to
 * the canonical replacement. Returns a guidance string the agent can act on
 * directly, or null when no suggestion is known.
 */
function unknownTypeSuggestion(nodeType: string): string | null {
  switch (nodeType) {
    case "overlay":
    case "scrim":
      return "There is no \"overlay\" node type. For a translucent layer over a background image use a band with a fill+alpha color (e.g. fill:\"rgba(0,0,0,0.55)\"). To set a slide-level background image use slide.background:{src:\"/path/to/image.png\"} or slide.backgroundImage:\"/path\".";
    case "background":
    case "bg":
      return "Set the slide background via slide.background (a token like \"brand.primary\", a hex, {type:\"solid\", color:\"brand.primary\"}, a gradient string/{fill:\"linear-gradient(...)\"}, or {src:\"/path\"} for a background image), not as a child node.";
    case "container":
    case "div":
    case "box":
      return "Use \"stack\" (vertical/horizontal flow), \"grid\" (matrix), \"card\" (chrome-bearing surface), \"panel\", or \"band\" depending on the visual intent.";
    case "row":
      return "Use {type:\"stack\", direction:\"horizontal\"} for a row.";
    case "column":
    case "col":
      return "Use {type:\"stack\", direction:\"vertical\"} for a column, or {type:\"grid\", columns:N} for a multi-column matrix.";
    case "spacer-flex":
    case "flex":
      return "Use {type:\"spacer\"} for empty space. Children with layoutWeight already participate in flex distribution.";
    case "section":
      return "Use \"section-break\" for a chapter divider, or \"band\"+\"text\" for a colored section header.";
    default:
      return null;
  }
}

function validateThemeOverride(deck: Slideml2SourceDeck, issues: ValidationIssue[]): void {
  const override = deck.deck?.themeOverride;
  if (!override || typeof override !== "object") return;
  validateThemeOverrideTopLevel(override as Record<string, unknown>, issues);
  validateThemeColorsShape(deck, issues);
  validateThemeLayout(deck, override as Record<string, unknown>, issues);
  validateThemeComponentStyles(override as Record<string, unknown>, issues);
  validateThemeFonts(override as Record<string, unknown>, issues);
  validateThemeChrome(override as Record<string, unknown>, issues);
  const text = override.text;
  if (!text || typeof text !== "object") return;
  for (const [styleName, style] of Object.entries(text)) {
    if (!style || typeof style !== "object") continue;
    const path = `deck.themeOverride.text.${styleName}`;
    for (const key of Object.keys(style)) {
      if (!THEME_TEXT_STYLE_KEYS.has(key)) {
        issues.push(issue("error", "UNKNOWN_THEME_TEXT_FIELD", `${path}.${key} is not a supported text style field, so it would be ignored.`, {
          path: `${path}.${key}`,
          suggestedFix: "Use supported fields: fontSize, weight/fontWeight, color, lineHeight, margin, letterSpacing, fontFamily, fontFeatures, uppercase, italic.",
        }));
      }
    }
    if (typeof style.fontSize === "number" && style.fontSize < 7) {
      issues.push(issue("error", "THEME_FONT_TOO_SMALL", `${path}.fontSize is ${style.fontSize}pt, which is too small for PPTX output.`, {
        path,
        suggestedFix: "Use at least 7pt for footnotes/captions and 9pt+ for normal content.",
      }));
    }
    const weight = style.weight ?? (style as Record<string, unknown>).fontWeight;
    if (weight !== undefined && weight !== "normal" && weight !== "bold" && !(typeof weight === "number" && weight >= 100 && weight <= 900)) {
      issues.push(issue("error", "INVALID_THEME_TEXT_WEIGHT", `${path}.weight/fontWeight must be 'normal', 'bold', or a numeric 100..900 weight.`, {
        path,
        suggestedFix: "Use weight:'bold' (or fontWeight:'bold') for emphasis, a numeric CSS weight, or omit it for normal text.",
      }));
    }
    const fontFamily = (style as Record<string, unknown>).fontFamily;
    if (fontFamily !== undefined && fontFamily !== "display" && fontFamily !== "text" && fontFamily !== "mono") {
      issues.push(issue("error", "INVALID_THEME_FONT_FAMILY", `${path}.fontFamily must be display, text, or mono.`, {
        path: `${path}.fontFamily`,
        suggestedFix: "Use fontFamily:'display' for titles, 'text' for body, or 'mono' for code/data identifiers.",
      }));
    }
  }
}

function validateDeckChrome(deck: Slideml2SourceDeck, issues: ValidationIssue[]): void {
  const chrome = deck.deck?.chrome;
  if (!chrome || typeof chrome !== "object" || Array.isArray(chrome)) return;
  const allowed = new Set(["brandMark", "pageNumber", "footerText"]);
  for (const [key, value] of Object.entries(chrome as Record<string, unknown>)) {
    const path = `deck.chrome.${key}`;
    if (!allowed.has(key)) {
      issues.push(issue("error", "UNKNOWN_DECK_CHROME_FIELD", `${path} is not a supported deck chrome field, so it would be ignored.`, {
        path,
        suggestedFix: "Use deck.chrome.brandMark, deck.chrome.pageNumber, deck.chrome.footerText, or use deck.themeOverride.chrome for footerLine/footerHeight/footerPadding.",
      }));
      continue;
    }
    if (key === "pageNumber" && typeof value !== "boolean") {
      issues.push(issue("error", "INVALID_DECK_CHROME_VALUE", `${path} must be boolean.`, { path, suggestedFix: "Use pageNumber:true or false." }));
    }
    if (key === "brandMark" && value !== "none" && value !== "top-right" && value !== "bottom-right") {
      issues.push(issue("error", "INVALID_DECK_CHROME_VALUE", `${path} must be none, top-right, or bottom-right.`, { path, suggestedFix: "Use brandMark:'none'|'top-right'|'bottom-right'." }));
    }
    if (key === "footerText" && typeof value !== "string") {
      issues.push(issue("error", "INVALID_DECK_CHROME_VALUE", `${path} must be a string.`, { path, suggestedFix: "Use footerText:'Internal use' or omit it." }));
    }
  }
}

function validateThemeOverrideTopLevel(override: Record<string, unknown>, issues: ValidationIssue[]): void {
  for (const key of Object.keys(override)) {
    if (!THEME_OVERRIDE_KEYS.has(key)) {
      issues.push(issue("error", "UNKNOWN_THEME_OVERRIDE_FIELD", `deck.themeOverride.${key} is not a supported themeOverride field, so it would be ignored.`, {
        path: `deck.themeOverride.${key}`,
        suggestedFix: "Use one of: colors, text, component, tone, layout, fonts, chart, chrome, imageGrowWeight, sizeScale, guidance.",
      }));
    }
  }
}

function validateThemeLayout(deck: Slideml2SourceDeck, override: Record<string, unknown>, issues: ValidationIssue[]): void {
  const layout = override.layout;
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) return;
  for (const [key, value] of Object.entries(layout as Record<string, unknown>)) {
    const path = `deck.themeOverride.layout.${key}`;
    if (!THEME_LAYOUT_KEYS.has(key)) {
      issues.push(issue("error", "UNKNOWN_THEME_LAYOUT_FIELD", `${path} is not a supported layout field, so it would not affect rendering.`, {
        path,
        suggestedFix: "Use effective layout fields: pageMarginX, titleTop, titleHeight, contentTop, contentBottom, defaultGap, columnGap, cardPadding, slideWidthCm, slideHeightCm. There is no pageMarginY.",
      }));
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push(issue("error", "INVALID_THEME_LAYOUT_VALUE", `${path} must be a finite number.`, {
        path,
        suggestedFix: "Use centimeters for layout geometry, e.g. contentTop:2.6 or contentBottom:0.9.",
      }));
    }
  }
  const theme = buildTheme(deck.deck?.brand || {}, deck.deck?.theme || "default", override);
  const minContentTop = theme.layout.titleTop + theme.layout.titleHeight + 0.25;
  if (theme.layout.contentTop < minContentTop) {
    issues.push(issue("error", "THEME_LAYOUT_TITLE_OVERLAP", `deck.themeOverride.layout.contentTop (${theme.layout.contentTop.toFixed(2)}cm) starts inside the title zone; titleTop + titleHeight + 0.25cm = ${minContentTop.toFixed(2)}cm.`, {
      path: "deck.themeOverride.layout.contentTop",
      suggestedFix: `Set contentTop to at least ${minContentTop.toFixed(2)}cm, or lower titleTop/titleHeight. Do not use pageMarginY for vertical rhythm.`,
    }));
  }
  const chrome = (override.chrome && typeof override.chrome === "object" && !Array.isArray(override.chrome))
    ? override.chrome as Record<string, unknown>
    : {};
  const deckChrome = deck.deck?.chrome || {};
  const hasFooterChrome = chrome.pageNumber === true
    || deckChrome.pageNumber === true
    || typeof chrome.footerText === "string"
    || typeof deckChrome.footerText === "string";
  const footerHeightRaw = typeof chrome.footerHeight === "number" && Number.isFinite(chrome.footerHeight)
    ? chrome.footerHeight
    : theme.chrome.footerHeight;
  const minContentBottom = footerHeightRaw + 0.2;
  if (hasFooterChrome && theme.layout.contentBottom < minContentBottom) {
    issues.push(issue("error", "THEME_LAYOUT_FOOTER_OVERLAP", `deck.themeOverride.layout.contentBottom (${theme.layout.contentBottom.toFixed(2)}cm) leaves too little space for footer chrome.`, {
      path: "deck.themeOverride.layout.contentBottom",
      suggestedFix: `Set contentBottom to at least ${minContentBottom.toFixed(2)}cm when chrome.pageNumber or footerText is enabled.`,
    }));
  }
}

function validateThemeComponentStyles(override: Record<string, unknown>, issues: ValidationIssue[]): void {
  const component = override.component;
  if (!component || typeof component !== "object" || Array.isArray(component)) return;
  for (const [componentName, rawStyle] of Object.entries(component as Record<string, unknown>)) {
    if (!rawStyle || typeof rawStyle !== "object" || Array.isArray(rawStyle)) continue;
    const style = rawStyle as Record<string, unknown>;
    for (const key of Object.keys(style)) {
      if (!THEME_COMPONENT_STYLE_KEYS.has(key)) {
        const path = `deck.themeOverride.component.${componentName}.${key}`;
        issues.push(issue("error", "UNKNOWN_THEME_COMPONENT_FIELD", `${path} is not a supported component style field, so it would be ignored.`, {
          path,
          suggestedFix: "Use supported component style fields: fill, line, accent, padding, radius/cornerRadius, elevation.",
        }));
      }
    }
  }
}

function validateThemeFonts(override: Record<string, unknown>, issues: ValidationIssue[]): void {
  const fonts = override.fonts;
  if (!fonts || typeof fonts !== "object" || Array.isArray(fonts)) return;
  for (const [key, value] of Object.entries(fonts as Record<string, unknown>)) {
    const path = `deck.themeOverride.fonts.${key}`;
    if (!THEME_FONT_KEYS.has(key)) {
      issues.push(issue("error", "UNKNOWN_THEME_FONT_FIELD", `${path} is not a supported font field, so it would be ignored.`, {
        path,
        suggestedFix: "Use fonts.latin, fonts.cjk, and fonts.mono.",
      }));
      continue;
    }
    if (key === "mono") {
      validateFontArray(value, path, issues);
      continue;
    }
    if (Array.isArray(value)) {
      validateFontArray(value, path, issues);
      continue;
    }
    if (!value || typeof value !== "object") {
      issues.push(issue("error", "INVALID_THEME_FONT_VALUE", `${path} must be a string array or {display?: string[], text?: string[]}.`, {
        path,
        suggestedFix: "Use e.g. fonts.latin:{display:['Helvetica Neue'], text:['Arial']}.",
      }));
      continue;
    }
    for (const [role, chain] of Object.entries(value as Record<string, unknown>)) {
      const rolePath = `${path}.${role}`;
      if (!THEME_SCRIPT_FONT_KEYS.has(role)) {
        issues.push(issue("error", "UNKNOWN_THEME_FONT_ROLE", `${rolePath} is not a supported font role, so it would be ignored.`, {
          path: rolePath,
          suggestedFix: "Use display and/or text.",
        }));
        continue;
      }
      validateFontArray(chain, rolePath, issues);
    }
  }
}

function validateFontArray(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    issues.push(issue("error", "INVALID_THEME_FONT_VALUE", `${path} must be a non-empty string array of font face names.`, {
      path,
      suggestedFix: "Use installed font face names, e.g. ['Arial'] or ['Hiragino Sans W3']. SlideML2 emits the first face into PPTX and does not embed fonts.",
    }));
  }
}

function validateThemeChrome(override: Record<string, unknown>, issues: ValidationIssue[]): void {
  const chrome = override.chrome;
  if (!chrome || typeof chrome !== "object" || Array.isArray(chrome)) return;
  for (const [key, value] of Object.entries(chrome as Record<string, unknown>)) {
    const path = `deck.themeOverride.chrome.${key}`;
    if (!THEME_CHROME_KEYS.has(key)) {
      issues.push(issue("error", "UNKNOWN_THEME_CHROME_FIELD", `${path} is not a supported chrome field, so it would be ignored.`, {
        path,
        suggestedFix: "Use brandMark, pageNumber, footerText, footerLine, footerHeight, or footerPadding.",
      }));
      continue;
    }
    if ((key === "pageNumber" || key === "footerLine") && typeof value !== "boolean") {
      issues.push(issue("error", "INVALID_THEME_CHROME_VALUE", `${path} must be boolean.`, { path, suggestedFix: `Use ${key}: true or false.` }));
    }
    if ((key === "footerHeight" || key === "footerPadding") && (typeof value !== "number" || !Number.isFinite(value))) {
      issues.push(issue("error", "INVALID_THEME_CHROME_VALUE", `${path} must be a finite number.`, { path, suggestedFix: "Use centimeters, e.g. footerHeight:0.55." }));
    }
    if (key === "brandMark" && value !== "none" && value !== "top-right" && value !== "bottom-right") {
      issues.push(issue("error", "INVALID_THEME_CHROME_VALUE", `${path} must be none, top-right, or bottom-right.`, { path, suggestedFix: "Use brandMark:'none'|'top-right'|'bottom-right'." }));
    }
    if (key === "footerText" && typeof value !== "string") {
      issues.push(issue("error", "INVALID_THEME_CHROME_VALUE", `${path} must be a string.`, { path, suggestedFix: "Use footerText:'Internal use' or omit it." }));
    }
  }
}

function validateThemeColorsShape(deck: Slideml2SourceDeck, issues: ValidationIssue[]): void {
  const colors = deck.deck?.themeOverride?.colors;
  if (!colors || typeof colors !== "object" || Array.isArray(colors)) return;
  let hasNested = false;
  for (const [key, value] of Object.entries(colors as Record<string, unknown>)) {
    const path = `deck.themeOverride.colors.${key}`;
    if (typeof value === "string") continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      hasNested = true;
      // Drill once to check leaves are strings — diagnose anything else.
      for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
        if (typeof subValue === "string") continue;
        if (subValue && typeof subValue === "object" && !Array.isArray(subValue)) continue;
        issues.push(issue("error", "INVALID_COLOR_VALUE", `${path}.${subKey} must be a hex string or theme token, got ${typeof subValue}.`, {
          path: `${path}.${subKey}`,
          suggestedFix: "Use a 6-char hex (with or without '#') or a theme token like 'brand.primary'.",
        }));
      }
      continue;
    }
    issues.push(issue("error", "INVALID_COLOR_VALUE", `${path} must be a hex string, theme token, or a nested object of colors; got ${typeof value}.`, {
      path,
      suggestedFix: "Use either flat keys like \"brand.primary\":\"8B6914\" or a nested object like brand:{primary:\"8B6914\"}.",
    }));
  }
  if (hasNested) {
    issues.push(issue("info", "THEME_COLORS_NESTED_FLATTENED", "themeOverride.colors uses nested object form; the renderer auto-flattens it.", {
      path: "deck.themeOverride.colors",
      suggestedFix: "Both shapes are accepted: nested {brand:{primary}} and flat {\"brand.primary\":...}. Pick whichever is more readable.",
    }));
  }
}

function validateComponentNode(node: DomNode, path: string, slideId: string, issues: ValidationIssue[]): void {
  const name = getComponentName(node) || node.component;
  if (!isComponentName(name)) {
    issues.push(issue("error", "UNKNOWN_COMPONENT", `${path} component "${String(name)}" is not registered.`, {
      slideId,
      path,
      nodeName: node.id,
      suggestedFix: "Use a documented component name from the active SKILL.md; keep the node fields flat.",
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
      suggestedFix: "Keep article semantics and provide text or paragraphs.",
    }));
  }
  if (name === "callout" && !node.text && !node.title && !node.body && !node.content && !node.bullets) {
    issues.push(issue("error", "MISSING_REQUIRED_FIELD", "callout requires text, title, body, content, or bullets.", {
      slideId,
      path,
      nodeName: node.id,
      suggestedFix: "Use legacy {type:'callout', text:'...'} or a rich callout with title/body/content/bullets.",
    }));
  }
  for (const [propName, prop] of Object.entries(definition.fields)) {
    if (prop.required && !hasRequiredComponentField(String(name), propName, node)) {
      issues.push(issue("error", "MISSING_REQUIRED_FIELD", `${definition.name} requires ${propName}.`, {
        slideId,
        path,
        nodeName: node.id,
        suggestedFix: `Keep ${definition.name} semantics and provide ${propName}.`,
      }));
    }
    const value = node[propName];
    if (prop.type === "enum" && value !== undefined && value !== null && value !== "" && prop.enum?.length) {
      if (typeof value !== "string" || !prop.enum.includes(value)) {
        issues.push(issue("error", "INVALID_FIELD_USAGE", `${definition.name}.${propName} must be one of: ${prop.enum.join(", ")}. Got ${JSON.stringify(value)}.`, {
          slideId,
          path: `${path}.${propName}`,
          nodeName: node.id,
          suggestedFix: `Use a documented ${propName} value (${prop.enum.join(", ")}), or move custom color intent into a color/fill/accent token field instead of ${propName}.`,
        }));
      }
    }
  }
  // section-break.accent is a *label string* (renders above the title), NOT a
  // color. LLMs frequently misuse it as a color token; flag that so the agent
  // doesn't see "brand.primary" rendered as visible text.
  if (name === "section-break" && typeof node.accent === "string" && TOKEN_SHAPED_RE.test(node.accent)) {
    issues.push(issue("error", "INVALID_FIELD_USAGE", `section-break.accent is a label string rendered above the title, not a color token. The value "${node.accent}" looks like a theme token.`, {
      slideId,
      path,
      nodeName: node.id,
      suggestedFix: "If you wanted an accent color, drop accent and use the title's tone or surface to convey color. If you wanted a small kicker label (e.g. \"PART 01\" or \"前言\"), set accent to the literal text.",
    }));
  }
  if (node.children?.length && !definition.children.allowed) {
    issues.push(issue("error", "COMPONENT_CHILDREN_NOT_ALLOWED", `${definition.name} does not accept children.`, {
      slideId,
      path,
      nodeName: node.id,
      suggestedFix: "Remove child nodes from this component and express the extra content as documented fields or a separate sibling.",
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
  // Recursively validate nested DomNodes that components carry in
  // documented item-array fields (timeline.items[].content, etc.). Without
  // this, an agent passing {type:"timeline", items:[{content:{type:"...",
  // ...}}]} silently slips an unvalidated nested component past the gate
  // and only fails at render time with a non-actionable error.
  if (name === "timeline" && Array.isArray(node.items)) {
    for (let i = 0; i < node.items.length; i++) {
      const it = node.items[i];
      if (!it || typeof it !== "object") continue;
      const content = (it as Record<string, unknown>).content;
      if (content && typeof content === "object" && !Array.isArray(content)) {
        validateNode(content as DomNode, `${path}.items[${i}].content`, slideId, issues, node);
      }
    }
  }
  if (name === "two-column") {
    for (const side of ["left", "right"] as const) {
      const content = (node as Record<string, unknown>)[side];
      if (content && typeof content === "object" && !Array.isArray(content)) {
        validateNode(content as DomNode, `${path}.${side}`, slideId, issues, node);
      } else if (content !== undefined && content !== null && content !== "") {
        issues.push(issue("error", "INVALID_FIELD_USAGE", `two-column.${side} must be a DomNode object.`, {
          slideId,
          path: `${path}.${side}`,
          nodeName: node.id,
          suggestedFix: `Set ${side} to a full node object, e.g. {id:"${slideId}.${side}", type:"text", text:"..."}.`,
        }));
      }
    }
  }
  if (name === "evidence-layout") {
    for (const key of ["evidence", "insight"] as const) {
      const content = (node as Record<string, unknown>)[key];
      if (content && typeof content === "object" && !Array.isArray(content)) validateNode(content as DomNode, `${path}.${key}`, slideId, issues, node);
    }
    if (Array.isArray(node.annotations)) {
      node.annotations.forEach((content, index) => {
        if (content && typeof content === "object" && !Array.isArray(content)) validateNode(content as DomNode, `${path}.annotations[${index}]`, slideId, issues, node);
      });
    }
  }
  if (name === "hero-and-support") {
    const hero = (node as Record<string, unknown>).hero;
    if (hero && typeof hero === "object" && !Array.isArray(hero)) validateNode(hero as DomNode, `${path}.hero`, slideId, issues, node);
    validateDomNodeArrayField(node, "supports", `${path}.supports`, slideId, issues);
    validateDomNodeArrayField(node, "items", `${path}.items`, slideId, issues);
  }
  if (name === "chart-with-rail") {
    for (const key of ["evidence", "rail"] as const) {
      const content = (node as Record<string, unknown>)[key];
      if (content && typeof content === "object" && !Array.isArray(content)) validateNode(content as DomNode, `${path}.${key}`, slideId, issues, node);
    }
  }
}

function validateDomNodeArrayField(node: DomNode, fieldName: string, path: string, slideId: string, issues: ValidationIssue[]): void {
  const value = (node as Record<string, unknown>)[fieldName];
  if (!Array.isArray(value)) return;
  value.forEach((content, index) => {
    if (content && typeof content === "object" && !Array.isArray(content) && typeof (content as Record<string, unknown>).type === "string") {
      validateNode(content as DomNode, `${path}[${index}]`, slideId, issues, node);
    }
  });
}

const REQUIRED_FIELD_ALIASES: Record<string, Record<string, string[]>> = {
  "kpi-grid": { metrics: ["items"] },
  "process-flow": { steps: ["items"] },
  "logo-strip": { logos: ["items", "images"] },
  "chart-card": {
    chartType: ["chart"],
    labels: ["data.labels"],
    series: ["data.series"],
  },
  "table-card": { rows: ["data.rows", "items"] },
  "key-takeaway": { headline: ["title"] },
  "insight-card": { headline: ["title"] },
  "hero-and-support": { supports: ["items"] },
  "snapshot-callouts": { callouts: ["items"] },
  "probe-flow": { steps: ["items"] },
};

function hasRequiredComponentField(componentName: string, propName: string, node: DomNode): boolean {
  const values = [node[propName], ...(REQUIRED_FIELD_ALIASES[componentName]?.[propName] || []).map((path) => valueAtPath(node, path))];
  return values.some((value) => value !== undefined && value !== null && value !== "");
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function containsTitleNode(nodes: DomNode[]): boolean {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    if (node.type === "section-break" || (node.type === "component" && node.component === "section-break")) return true;
    if (node.type === "title-lockup" || (node.type === "component" && node.component === "title-lockup")) return true;
    if (node.type === "deck-title" || node.type === "slide-title" || node.type === "h1") return true;
    if (node.type === "text" && (node.style === "deck-title" || node.style === "slide-title" || node.style === "section-title")) return true;
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
        issues.push(issue("error", "NODE_OUT_OF_BOUNDS", `${node.id} is outside the slide bounds.`, { slideId: slide.slideId, nodeName: node.id, details: { rect: node.rect }, suggestedFix: "Keep the slide semantics but use wider margins, fewer regions, or split dense content into another slide." }));
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
