import { describeComponents, getComponentName, isComponentName, isComponentTypedNode, normalizeComponentEnumValue, type PropDefinition } from "./component-registry.js";
import {
  DECK_SIZE_VALUES,
  DATA_AGGREGATE_OP_VALUES,
  DATA_BIND_FIELDS,
  DATA_COLUMN_ALIGN_VALUES,
  DATA_COLUMN_TYPE_VALUES,
  DATA_ENCODING_FIELDS,
  DATA_SOURCE_TYPE_VALUES,
  isDeckSize,
  normalizeValidationMode,
  THEME_CHROME_FIELD_SET,
  THEME_COMPONENT_STYLE_FIELD_SET,
  THEME_FONT_FIELD_SET,
  THEME_LAYOUT_FIELD_SET,
  THEME_OVERRIDE_FIELD_SET,
  THEME_SCRIPT_FONT_FIELD_SET,
  THEME_TEXT_STYLE_FIELD_SET,
  VALIDATION_MODE_VALUES,
} from "./schema.js";
// Single source of truth for the layout/container primitive types. Adding a
// new layout primitive (e.g. another decorative wrapper) only requires
// updating this set.
const LAYOUT_CONTAINERS = new Set(["stack", "grid", "split", "panel", "card", "band", "frame", "inset", "fragment"]);
import { buildTheme, parseCssColor, textStyle } from "./theme.js";
import { resolveDataSourceRowsById, type DataBindingOptions } from "./data-binding.js";
import { inferTextKind } from "./text-normalizer.js";
import type { DeckValidationSpec, DomNode, RenderedDeck, RenderedSlide, Slideml2SourceDeck, SlideV2, ThemeLayoutArea, ThemeOverride } from "./types.js";
import { measureDeck } from "./render.js";
import { normalizeSlide, sourceSlideToRendered, sourceToRenderedDeck } from "./source-deck.js";
import { emuToCm, SLIDE_SIZES } from "./units.js";
import { unsupportedLatexCommands } from "./latex-omml.js";
import { meaningfulSourceOverlap, rectContains, rectFromAbsoluteRectSpec, rectFromNodePlacement } from "./layout/geometry.js";
import { SOURCE_VALIDATION_CODE } from "./diagnostic-codes.js";
import { describeInvalidSlideTransition } from "./transition.js";

const RAW_HEX_RE = /^[0-9A-Fa-f]{6}$/;
const RESERVED_LAYOUT_AREAS = new Set(["content", "full"]);
const THEME_FONT_WEIGHT_NAMES = new Set([
  "thin",
  "hairline",
  "extralight",
  "ultralight",
  "light",
  "normal",
  "regular",
  "book",
  "medium",
  "semibold",
  "demibold",
  "bold",
  "extrabold",
  "ultrabold",
  "heavy",
  "black",
  "super",
]);
const SOURCE_DECK_FIELD_SET = new Set(["slideml2", "deck", "slides"]);
const DECK_FIELD_SET = new Set(["size", "theme", "themeOverride", "brand", "chrome", "validation", "master", "dataSources", "references", "footnotes", "metadata"]);
const REQUIRED_CHILD_CONTAINERS = new Set(["stack", "grid", "split", "fragment"]);

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

interface EffectiveValidationOptions {
  mode: "strict" | "standard" | "experimental";
  allowUnknownComponents: boolean;
  maxTextLength?: number;
  requireAlt: boolean;
  requireSources: boolean;
}

function validationOptions(spec?: DeckValidationSpec): EffectiveValidationOptions {
  const mode = normalizeValidationMode(spec?.mode);
  return {
    mode,
    allowUnknownComponents: spec?.allowUnknownComponents === true || mode === "experimental",
    maxTextLength: typeof spec?.maxTextLength === "number" && Number.isFinite(spec.maxTextLength) && spec.maxTextLength > 0 ? spec.maxTextLength : undefined,
    requireAlt: spec?.requireAlt === true || mode === "strict",
    requireSources: spec?.requireSources === true || mode === "strict",
  };
}

export function validateSlide(slide: SlideV2, deck?: Pick<Slideml2SourceDeck, "deck">): ValidationReport {
  const issues: ValidationIssue[] = [];
  const options = validationOptions(deck?.deck.validation);
  if (!slide || typeof slide !== "object") {
    issues.push(issue("error", "INVALID_SLIDE", "Slide must be an object."));
    return report(issues);
  }
  if (!slide.id) issues.push(issue("error", "MISSING_SLIDE_ID", "Slide id is required.", { suggestedFix: "Add a stable slide.id." }));
  if (!Array.isArray(slide.children)) issues.push(issue("error", "MISSING_CHILDREN", "Slide children must be an array.", { slideId: slide.id }));
  validateSlideTransitionSpec(slide, issues);
  if (Array.isArray(slide.children)) validateSlideAreaReferences(slide, deck, issues);
  if (Array.isArray(slide.children)) validateSlideTitleLabelDuplication(slide, issues);
  slide.children?.forEach((node, index) => validateNode(node, `children[${index}]`, slide.id, issues, undefined, options));
  // Generic rule: a slide may carry exactly ONE visible hero title. `slide.title`
  // may duplicate the visible body hero title as metadata/navigation text; when
  // it differs, the renderer would create two competing hero titles. `h1` is an
  // in-content module heading, so it must not block ordinary slide titles.
  const bodyHeroTitle = Array.isArray(slide.children) ? findBodyHeroTitle(slide.children) : { found: false, titles: [] };
  if (typeof slide.title === "string" && slide.title.trim() && bodyHeroTitle.found && !bodyHeroTitleMatchesSlideTitle(slide.title, bodyHeroTitle.titles)) {
    issues.push(issue("error", "DUPLICATE_HERO_TITLE", "slide.title is set AND the body already carries a hero title (cover-composition / section-break / deck-title / slide-title text). Only one — drop slide.title for cover/section pages, or remove the body title for ordinary pages.", {
      slideId: slide.id,
      suggestedFix: "If this is a cover or chapter divider, either make slide.title match the body hero title exactly so it is treated as metadata, or drop slide.title and let the body's section-break/deck-title text be the headline.",
    }));
  }
  // Skip the layout pass when the structure is broken; layout solver assumes
  // well-formed nodes (typed, with ids, recognized component types).
  // Surfacing the schema errors first gives the agent an actionable fix.
  if (issues.some((item) => item.level === "error")) return report(issues);
  try {
    const rendered: RenderedDeck = {
      deck: {
        size: isDeckSize(deck?.deck.size) ? deck.deck.size : "16x9",
        theme: deck?.deck.theme || "default",
        brand: deck?.deck.brand || {},
        themeOverride: deck?.deck.themeOverride,
      },
      slides: [sourceSlideToRendered(normalizeSlide(slide))],
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

export function validateDeck(deck: Slideml2SourceDeck, options: DataBindingOptions = {}): ValidationReport {
  const issues: ValidationIssue[] = [];
  if (!deck || typeof deck !== "object") {
    issues.push(issue("error", "INVALID_DECK", "Deck must be an object."));
    return report(issues);
  }
  validateSourceDeckFields(deck, issues);
  if (deck.slideml2 !== 2) issues.push(issue("error", "VERSION_MISMATCH", "Deck must declare slideml2: 2."));
  if (!deck.deck || !isDeckSize(deck.deck.size)) issues.push(issue("error", "INVALID_DECK_SIZE", `deck.size must be one of: ${DECK_SIZE_VALUES.join(", ")}.`));
  validateDeckValidationSpec(deck, issues);
  validateThemeOverride(deck, issues);
  validateDeckChrome(deck, issues);
  validateDeckDataSources(deck, issues, options);
  if (!Array.isArray(deck.slides)) {
    issues.push(issue("error", "INVALID_SLIDES", "deck.slides must be an array."));
    return report(issues);
  }
  validateDeckReferences(deck, issues);
  deck.slides.forEach((slide, index) => {
    if (deck.slides.findIndex((item) => item.id === slide.id) !== index) {
      issues.push(issue("error", "DUPLICATE_SLIDE_ID", `Duplicate slide id "${slide.id}".`, { slideId: slide.id, suggestedFix: "Replace the slide with a unique id." }));
    }
    const slideReport = validateSlide(slide, deck);
    issues.push(...slideReport.errors, ...slideReport.warnings, ...slideReport.info);
  });
  validateDataBindings(deck, issues, options);
  addRepeatedCardAuthoringDiagnostics(deck, issues);
  if (!issues.some((item) => item.level === "error")) {
    try {
      validateLayout(sourceToRenderedDeck(deck, options), issues);
    } catch (error) {
      issues.push(issue("error", "LAYOUT_VALIDATION_CRASH", `Layout validator crashed: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
  return report(dedupeIssues(issues));
}

function validateSlideTransitionSpec(slide: SlideV2, issues: ValidationIssue[]): void {
  const message = describeInvalidSlideTransition(slide.transition);
  if (!message) return;
  issues.push(issue("error", SOURCE_VALIDATION_CODE.INVALID_SLIDE_TRANSITION, message, {
    slideId: slide.id,
    path: "transition",
    suggestedFix: "Use transition:{type:'fade'|'push'|'wipe'|'split'|'cover'|'uncover', direction?:'left'|'right'|'up'|'down', durationMs?:350}. Common aliases accepted by render include type:'slideIn' with direction:'push'|'fade'|'wipe', but unrelated values are invalid.",
  }));
}

function validateSourceDeckFields(deck: Slideml2SourceDeck, issues: ValidationIssue[]): void {
  for (const key of Object.keys(deck as unknown as Record<string, unknown>)) {
    if (SOURCE_DECK_FIELD_SET.has(key)) continue;
    issues.push(issue("error", "UNKNOWN_SOURCE_DECK_FIELD", `Root field ${key} is not part of the SlideML2 source deck shape and will be ignored.`, {
      path: key,
      suggestedFix: key === "themeOverride"
        ? "Move this under deck.themeOverride. For patch_deck, use paths such as /deck/themeOverride/layout/contentTop."
        : "Use only root fields slideml2, deck, and slides.",
    }));
  }
  if (!deck.deck || typeof deck.deck !== "object" || Array.isArray(deck.deck)) return;
  for (const key of Object.keys(deck.deck as unknown as Record<string, unknown>)) {
    if (DECK_FIELD_SET.has(key)) continue;
    issues.push(issue("error", "UNKNOWN_DECK_FIELD", `deck.${key} is not a supported deck field and will be ignored.`, {
      path: `deck.${key}`,
      suggestedFix: "Use deck.size, deck.theme, deck.brand, deck.themeOverride, deck.chrome, deck.validation, deck.master, deck.dataSources, deck.references, deck.footnotes, or deck.metadata.",
    }));
  }
}

function validateDeckValidationSpec(deck: Slideml2SourceDeck, issues: ValidationIssue[]): void {
  const spec = deck.deck?.validation;
  if (spec === undefined) return;
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    issues.push(issue("error", "INVALID_DECK_VALIDATION", "deck.validation must be an object.", {
      path: "deck.validation",
      suggestedFix: "Use deck.validation:{mode:'standard'|'strict'|'experimental'} plus optional booleans such as requireAlt.",
    }));
    return;
  }
  const allowed = new Set(["mode", "allowUnknownComponents", "maxTextLength", "requireAlt", "requireSources"]);
  for (const [key, value] of Object.entries(spec as Record<string, unknown>)) {
    const path = `deck.validation.${key}`;
    if (!allowed.has(key)) {
      issues.push(issue("error", "UNKNOWN_DECK_VALIDATION_FIELD", `${path} is not a supported validation field.`, {
        path,
        suggestedFix: "Use mode, allowUnknownComponents, maxTextLength, requireAlt, or requireSources.",
      }));
      continue;
    }
    if (key === "mode" && value !== undefined && !(typeof value === "string" && (VALIDATION_MODE_VALUES as readonly string[]).includes(value))) {
      issues.push(issue("error", "INVALID_DECK_VALIDATION_MODE", `${path} must be one of: ${VALIDATION_MODE_VALUES.join(", ")}.`, {
        path,
        suggestedFix: "Use mode:'standard' for normal delivery, 'strict' for publication/research decks, or 'experimental' while prototyping new components.",
      }));
    }
    if ((key === "allowUnknownComponents" || key === "requireAlt" || key === "requireSources") && value !== undefined && typeof value !== "boolean") {
      issues.push(issue("error", "INVALID_DECK_VALIDATION_VALUE", `${path} must be boolean.`, {
        path,
        suggestedFix: `Use ${key}:true or ${key}:false.`,
      }));
    }
    if (key === "maxTextLength" && value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) {
      issues.push(issue("error", "INVALID_DECK_VALIDATION_VALUE", `${path} must be a positive finite number.`, {
        path,
        suggestedFix: "Use a character cap such as maxTextLength:240, or omit the field.",
      }));
    }
  }
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
  const tableRuns = consecutiveRuns(deck.slides.map((slide) => ({
    slide,
    tableOnly: isSinglePrimaryComponentSlide(slide, "table-card"),
  })), (item) => item.tableOnly);
  const longTableRuns = tableRuns.filter((run) => run.length >= 3);
  for (const longTableRun of longTableRuns) {
    issues.push(issue(
      "warning",
      "REPEATED_TABLE_PAGE_ARCHETYPE",
      `Deck uses ${longTableRun.length} consecutive table-card-only slides; this is an authoring choice, not a renderer fallback, but it may feel repetitive.`,
      {
        slideId: longTableRun[0]?.slide.id,
        details: {
          tableSlides: longTableRun.map((item) => item.slide.id),
        },
        suggestedFix: "Keep table-card for true lookup/reference pages. For guidance, ratings, or conclusions, vary the archetype with chart-with-rail, comparison-list, scorecard, bar-list, takeaway-list, or split panels with semantic lists.",
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

function isSinglePrimaryComponentSlide(slide: SlideV2, type: string): boolean {
  const primaryTypes = (slide.children || [])
    .map((node) => directComponentType(node))
    .filter((componentType): componentType is string => Boolean(componentType));
  return primaryTypes.length === 1 && primaryTypes[0] === type;
}

function directComponentType(node: DomNode): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const componentType = getComponentName(node) || node.type;
  if (componentType === "eyebrow" || componentType === "label" || componentType === "text" || componentType === "spacer" || componentType === "divider") return undefined;
  return String(componentType || "");
}

function consecutiveRuns<T>(items: T[], predicate: (item: T) => boolean): T[][] {
  const runs: T[][] = [];
  let current: T[] = [];
  for (const item of items) {
    if (predicate(item)) current.push(item);
    else if (current.length) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  return runs;
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

function validateSlideAreaReferences(slide: SlideV2, deck: Pick<Slideml2SourceDeck, "deck"> | undefined, issues: ValidationIssue[]): void {
  const knownAreas = new Set(["content", "full"]);
  const canValidateNamedAreas = Boolean(deck?.deck);
  if (deck?.deck) {
    try {
      const theme = buildTheme(deck.deck.brand || {}, deck.deck.theme || "default", withDeckSizeLayout(deck.deck.size, deck.deck.themeOverride));
      for (const name of Object.keys(theme.layout.areas || {})) knownAreas.add(name);
    } catch {
      // Theme validation reports malformed layout separately.
    }
  }
  slide.children?.forEach((node, index) => {
    if (!node || typeof node !== "object") return;
    const path = `children[${index}].area`;
    const area = (node as Record<string, unknown>).area;
    if (area === undefined) return;
    if (typeof area !== "string" || !area.trim()) {
      issues.push(issue("error", "INVALID_LAYOUT_AREA_REFERENCE", `${path} must be "content", "full", or a named deck.themeOverride.layout.areas key.`, {
        slideId: slide.id,
        path,
        nodeName: typeof node.id === "string" ? node.id : undefined,
        suggestedFix: "Use area:'content', area:'full', or define a named rectangle under deck.themeOverride.layout.areas.",
      }));
      return;
    }
    const trimmed = area.trim();
    if (canValidateNamedAreas && !knownAreas.has(trimmed)) {
      issues.push(issue("error", "UNKNOWN_LAYOUT_AREA_REFERENCE", `${path} references unknown layout area "${trimmed}".`, {
        slideId: slide.id,
        path,
        nodeName: typeof node.id === "string" ? node.id : undefined,
        suggestedFix: `Use area:'content' or area:'full', or define deck.themeOverride.layout.areas.${trimmed}. Known areas: ${Array.from(knownAreas).join(", ")}.`,
      }));
    }
    if (hasSlideLevelPlacementOverride(node)) {
      issues.push(issue("warning", "LAYOUT_AREA_OVERRIDDEN_BY_PLACEMENT", `${path} is combined with slide-level overlay placement, so area may not control the final rect.`, {
        slideId: slide.id,
        path,
        nodeName: typeof node.id === "string" ? node.id : undefined,
        suggestedFix: "Use area for reusable regions, or use at/anchor/anchorTo for overlays, but do not combine them on the same top-level node.",
      }));
    }
  });
}

function hasSlideLevelPlacementOverride(node: DomNode): boolean {
  const rec = node as Record<string, unknown>;
  if (typeof rec.anchor === "string" && rec.anchor.trim()) return true;
  if (typeof rec.anchorTo === "string" && rec.anchorTo.trim()) return true;
  return Boolean(rectFromNodePlacement(node));
}

function validateSlideTitleLabelDuplication(slide: SlideV2, issues: ValidationIssue[]): void {
  const title = typeof slide.title === "string" ? normalizeTitleLabel(slide.title) : "";
  if (!title) return;
  slide.children?.forEach((node, index) => {
    if (!node || typeof node !== "object" || node.type !== "text" || typeof node.text !== "string") return;
    const text = normalizeTitleLabel(node.text);
    if (!text || text !== title) return;
    issues.push(issue("error", "DUPLICATE_SLIDE_TITLE_LABEL", `slide.title duplicates top-level text node ${node.id || `children[${index}]`}.`, {
      slideId: slide.id,
      path: `children[${index}].text`,
      nodeName: typeof node.id === "string" ? node.id : undefined,
      suggestedFix: "If this is an editorial/custom layout, omit slide.title and keep the visible custom title/label. If slide.title should be visible, change the small label to a chapter/kicker that does not repeat the title.",
    }));
  });
}

function normalizeTitleLabel(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^[\s#]*(?:slide|page)?\s*\d+[\s:._\-—–|]*/i, "")
    .replace(/^[\s#]*(?:[ivxlcdm]+|[一二三四五六七八九十]+)[\s:._\-—–|]+/i, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

function validateNode(
  node: DomNode,
  path: string,
  slideId: string,
  issues: ValidationIssue[],
  parent?: DomNode,
  options: EffectiveValidationOptions = validationOptions(),
): void {
  if (!node || typeof node !== "object") {
    issues.push(issue("error", "INVALID_NODE", `${path} must be a node object.`, { slideId, path }));
    return;
  }
  if (isTwoColumnRegionShorthand(node, parent, path)) {
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach((child, index) => {
      const childPath = `${path}.children[${index}]`;
      validateNode(withSyntheticNodeIds(child as DomNode, `${slideId}.${path.replace(/[^A-Za-z0-9_.-]+/g, ".")}.${index + 1}`), childPath, slideId, issues, node, options);
    });
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
    node.children?.forEach((child, index) => validateNode(child, `${path}.children[${index}]`, slideId, issues, node, options));
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
  if ("position" in node) {
    issues.push(issue("error", "LEGACY_NODE_POSITION", `${path}.position is not supported; use the canonical placement field for this node.`, {
      slideId,
      path,
      nodeName: node.id,
      suggestedFix: "For slide-level overlays use anchor:'bottom-right' plus width/height/offsetX/offsetY. For brand-mark or big-page-number use corner:'bottom-right'. For decorative-shapes use anchor:'top-right' or anchor:'full'.",
    }));
  }
  const minNodeFontSize = node.type === "code-block" ? 5 : 7;
  if ("fontSize" in node && (typeof node.fontSize !== "number" || !Number.isFinite(node.fontSize) || node.fontSize < minNodeFontSize)) {
    issues.push(issue("error", "INVALID_NODE_FONT_SIZE", `${path}.fontSize must be a readable point size >= ${minNodeFontSize}.`, {
      slideId,
      path,
      nodeName: node.id,
      suggestedFix: node.type === "code-block"
        ? "Use fontSize >= 5 only for dense code listings; otherwise use density:'dense' or columns:2."
        : "Use a numeric fontSize >= 7, or use semantic size:'sm'|'md'|'lg' for safer scaling.",
    }));
  }
  if (node.type === "text" && typeof node.color === "string" && RAW_HEX_RE.test(node.color)) {
    issues.push(issue("warning", "RAW_TEXT_HEX_COLOR", `${path}.color uses a bare hex value. This is allowed, but theme tokens are preferred for reusable text colors so the deck can restyle consistently.`, {
      slideId,
      path,
      nodeName: node.id,
      suggestedFix: "Prefer a token such as text.primary, text.inverse, brand.primary, or a themeOverride.colors key. For a deliberate one-off text color, use #RRGGBB or bare RRGGBB.",
    }));
  }
  if (isComponentTypedNode(node)) validateComponentNode(node, path, slideId, issues, options);
  else if (LAYOUT_CONTAINERS.has(String(node.type))) {
    const childrenRequired = REQUIRED_CHILD_CONTAINERS.has(String(node.type));
    if (!Array.isArray(node.children)) {
      if (childrenRequired) issues.push(issue("error", "MISSING_CONTAINER_CHILDREN", `${path}.children must be an array.`, { slideId, path, nodeName: node.id }));
    } else if (childrenRequired && node.children.length === 0) {
      issues.push(issue("error", "EMPTY_CONTAINER", `${path}.children must include at least one child.`, { slideId, path, nodeName: node.id, suggestedFix: `Add at least one child node inside this ${node.type}.` }));
    } else if (node.type === "split" && node.children.length < 2) issues.push(issue("warning", "SPLIT_NEEDS_TWO", `${path} split with fewer than 2 children behaves like a plain stack.`, { slideId, path, nodeName: node.id, suggestedFix: "Add the second region or use 'stack' instead." }));
    if (node.type === "card") validateCardHeaderFields(node, path, slideId, issues);
  } else if (node.type === "text") {
    if (typeof node.text !== "string" && !Array.isArray(node.content) && typeof node.content !== "string") {
      issues.push(issue("error", "MISSING_TEXT_CONTENT", `${path}.text or .content is required for text.`, { slideId, path, nodeName: node.id }));
    }
    if (!node.style) {
      const inferred = inferTextKind(node, parent);
      issues.push(issue("info", "TEXT_STYLE_INFERRED", `Text style inferred as ${inferred.kind}.`, { slideId, path, nodeName: node.id, details: { confidence: inferred.confidence, reason: inferred.reason } }));
    }
    if (typeof node.text === "string" && looksLikeBulletList(node.text) && !isCodeOrQuoteStyle(node.style)) {
      issues.push(issue("warning", "TEXT_LOOKS_LIKE_BULLETS", `${path}.text contains bullet-shaped runs (•/·/numeric prefixes with line breaks). The renderer can estimate hard line breaks, but this remains one text box: individual bullets cannot be styled, dropped, measured, or repaired independently.`, {
        slideId, path, nodeName: node.id,
        suggestedFix: "Replace with {type:'bullets', items:[...]} (or numbered-list / warning-list) so each line is a semantic item with independent styling and diagnostics.",
      }));
    } else if (typeof node.text === "string" && looksLikeMultilineList(node.text) && !isCodeOrQuoteStyle(node.style)) {
      issues.push(issue("warning", "TEXT_LOOKS_LIKE_MULTILINE_LIST", `${path}.text contains multiple hard-line list items inside one text box. This often passes validation but loses hierarchy and forces autoFit/truncation when placed inside cards.`, {
        slideId, path, nodeName: node.id,
        suggestedFix: "Use bullets/numbered-list/takeaway-list/fact-list/bar-list/comparison-table, or split the items across columns/components instead of embedding newline-separated records in text.",
      }));
    }
  } else if (node.type === "spacer" || node.type === "divider") {
    // Layout-only primitives; fields are optional and renderer supplies defaults.
  } else if (node.type === "bullets") {
    if (!Array.isArray(node.items)) issues.push(issue("error", "INVALID_BULLETS_ITEMS", `${path}.items must be a string array.`, { slideId, path, nodeName: node.id }));
  } else if (node.type === "image") {
    if (typeof node.src !== "string" || !node.src) issues.push(issue("error", "MISSING_IMAGE_SRC", `${path}.src is required for image.`, { slideId, path, nodeName: node.id }));
    if (options.requireAlt && (typeof node.alt !== "string" || !node.alt.trim())) issues.push(issue("error", "MISSING_IMAGE_ALT", `${path}.alt is required by deck.validation.requireAlt/strict mode.`, { slideId, path, nodeName: node.id, suggestedFix: "Add a concise alt string describing the visual evidence or mark this as decorative in a future a11y schema." }));
  } else if (node.type === "table") {
    if (!Array.isArray(node.rows) && !Array.isArray(node.headers) && !hasDataBindSource(node.bind)) issues.push(issue("error", "INVALID_TABLE_DATA", `${path} table needs headers and/or rows, or bind:{source}.`, { slideId, path, nodeName: node.id }));
    if (options.requireSources && !hasSourceMetadata(node)) issues.push(issue("error", "MISSING_DATA_SOURCE", `${path} table requires source metadata by deck.validation.requireSources/strict mode.`, { slideId, path, nodeName: node.id, suggestedFix: "Add source:'...' or caption:'Source: ...' to make the evidence traceable." }));
  } else if (node.type === "chart") {
    if ((!Array.isArray(node.labels) || !Array.isArray(node.series)) && !hasDataBindSource(node.bind)) issues.push(issue("error", "INVALID_CHART_DATA", `${path} chart needs labels and series, or bind:{source}.`, { slideId, path, nodeName: node.id }));
    if (options.requireSources && !hasSourceMetadata(node)) issues.push(issue("error", "MISSING_DATA_SOURCE", `${path} chart requires source metadata by deck.validation.requireSources/strict mode.`, { slideId, path, nodeName: node.id, suggestedFix: "Add source:'...' or caption:'Source: ...' to make the evidence traceable." }));
  } else if (node.type !== "shape") {
    if (typeof node.type === "string" && STYLE_TOKENS_OFTEN_USED_AS_TYPE.has(node.type)) {
      issues.push(issue("warning", "TEXT_STYLE_TYPE_ALIAS_NORMALIZED", `${path}.type "${node.type}" is a text style token. It will be normalized to {type:"text", style:"${node.type}"} before render.`, {
        slideId,
        path,
        nodeName: node.id,
        details: { canonicalType: "text", canonicalStyle: node.type },
        suggestedFix: `For canonical SlideML, replace ${path}.type with "text" and add style:"${node.type}".`,
      }));
    } else {
      const nodeType = String(node.type);
      const customSuggestion = unknownTypeSuggestion(nodeType);
      issues.push(issue(options.allowUnknownComponents ? "warning" : "error", "UNKNOWN_NODE_TYPE", `${path}.type "${nodeType}" is not supported.`, {
        slideId,
        path,
        nodeName: node.id,
        suggestedFix: customSuggestion || "Use a documented SlideML2 node type selected from the active SKILL.md; keep node fields flat.",
      }));
    }
  }
  if (options.maxTextLength && node.type === "text" && typeof node.text === "string" && node.text.length > options.maxTextLength) {
    issues.push(issue("error", "TEXT_TOO_LONG", `${path}.text has ${node.text.length} characters; deck.validation.maxTextLength is ${options.maxTextLength}.`, {
      slideId,
      path,
      nodeName: node.id,
      suggestedFix: "Shorten the text, split it into bullets/paragraphs, or raise deck.validation.maxTextLength for leave-behind decks.",
    }));
  }
  node.children?.forEach((child, index) => validateNode(child, `${path}.children[${index}]`, slideId, issues, node, options));
}

function isTwoColumnRegionShorthand(node: DomNode, parent: DomNode | undefined, path: string): boolean {
  if (!parent || parent.type !== "two-column") return false;
  if (!/\.(left|right)$/.test(path)) return false;
  if (node.type) return false;
  return Array.isArray(node.children);
}

function withSyntheticNodeIds(node: DomNode, fallbackId: string): DomNode {
  if (!node || typeof node !== "object" || Array.isArray(node)) return { id: fallbackId, type: "text", text: "" };
  const id = typeof node.id === "string" && node.id ? node.id : fallbackId;
  const children = Array.isArray(node.children)
    ? node.children.map((child, index) => withSyntheticNodeIds(child as DomNode, `${id}.${index + 1}`))
    : node.children;
  const out: DomNode = { ...node, id, children };
  for (const key of SYNTHETIC_OBJECT_SLOT_KEYS) {
    const value = (node as Record<string, unknown>)[key];
    if (isDomNodeSlot(value)) (out as Record<string, unknown>)[key] = withSyntheticNodeIds(value as DomNode, `${id}.${key}`);
  }
  for (const key of SYNTHETIC_ARRAY_SLOT_KEYS) {
    const value = (node as Record<string, unknown>)[key];
    if (!Array.isArray(value) || key === "children") continue;
    (out as Record<string, unknown>)[key] = value.map((item, index) => isDomNodeSlot(item) ? withSyntheticNodeIds(item as DomNode, `${id}.${key}.${index + 1}`) : item);
  }
  return out;
}

const SYNTHETIC_OBJECT_SLOT_KEYS = ["evidence", "rail", "left", "right", "hero", "insight"] as const;
const SYNTHETIC_ARRAY_SLOT_KEYS = ["children", "annotations", "supports"] as const;

function isDomNodeSlot(value: unknown): value is DomNode {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function componentSlotFallbackId(slideId: string, parent: DomNode, path: string, slotName: string): string {
  const parentId = typeof parent.id === "string" && parent.id.trim() ? parent.id.trim() : path.replace(/[^A-Za-z0-9_.-]+/g, ".");
  const rooted = parentId.startsWith(`${slideId}.`) ? parentId : `${slideId}.${parentId}`;
  return `${rooted}.${slotName}`;
}

function validateComponentSlotNode(
  parent: DomNode,
  slotName: string,
  path: string,
  slideId: string,
  issues: ValidationIssue[],
  options: EffectiveValidationOptions,
): void {
  const content = (parent as Record<string, unknown>)[slotName];
  if (!content || typeof content !== "object" || Array.isArray(content)) return;
  validateNode(withSyntheticNodeIds(content as DomNode, componentSlotFallbackId(slideId, parent, path, slotName)), `${path}.${slotName}`, slideId, issues, parent, options);
}

function hasDataBindSource(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).source === "string" && String((value as Record<string, unknown>).source).trim());
}

function hasSourceMetadata(node: DomNode): boolean {
  const rec = node as Record<string, unknown>;
  if (hasDataBindSource(rec.bind)) return true;
  if (hasProvenanceMetadata(rec.provenance) || hasProvenanceMetadata(rec.dataLineage)) return true;
  for (const key of ["source", "sourceNote", "caption", "citation", "footnote"]) {
    const value = rec[key];
    if (typeof value === "string" && value.trim()) return true;
  }
  const data = rec.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const key of ["source", "sourceNote", "caption", "citation", "footnote"]) {
      const value = (data as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) return true;
    }
  }
  return false;
}

function hasProvenanceMetadata(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  for (const key of ["source", "sourceId", "sourceLabel", "citation", "url", "sourcePath"]) {
    const raw = rec[key];
    if (typeof raw === "string" && raw.trim()) return true;
  }
  return false;
}

function validateCardHeaderFields(node: DomNode, path: string, slideId: string, issues: ValidationIssue[]): void {
  const header = trimmedString(node.header);
  const title = trimmedString(node.title);
  if ("title" in node && node.title != null && typeof node.title !== "string") {
    issues.push(issue("warning", "CARD_TITLE_NOT_STRING", `${path}.title should be a string. Primitive card.title is an alias for header and non-string values are ignored.`, {
      slideId,
      path,
      nodeName: node.id,
      suggestedFix: "Use title:\"...\" or header:\"...\" for the card heading.",
    }));
  }
  if ("header" in node && node.header != null && typeof node.header !== "string") {
    issues.push(issue("warning", "CARD_HEADER_NOT_STRING", `${path}.header should be a string. Non-string card headers are ignored.`, {
      slideId,
      path,
      nodeName: node.id,
      suggestedFix: "Use header:\"...\" or title:\"...\" for the card heading.",
    }));
  }
  if (header && title && header !== title) {
    issues.push(issue("warning", "CARD_TITLE_HEADER_CONFLICT", `${path} sets both card.header and card.title with different text; renderer uses header and ignores title.`, {
      slideId,
      path,
      nodeName: node.id,
      suggestedFix: "Keep one heading field. Prefer title for authoring consistency, or make header and title identical.",
    }));
  }
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
      if (!THEME_TEXT_STYLE_FIELD_SET.has(key)) {
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
    const namedWeight = typeof weight === "string" ? weight.trim().toLowerCase() : undefined;
    const validWeight = weight === undefined
      || (typeof weight === "number" && weight >= 100 && weight <= 900)
      || (namedWeight !== undefined && THEME_FONT_WEIGHT_NAMES.has(namedWeight));
    if (!validWeight) {
      issues.push(issue("error", "INVALID_THEME_TEXT_WEIGHT", `${path}.weight/fontWeight must be a named CSS weight or a numeric 100..900 weight.`, {
        path,
        suggestedFix: "Use weight:'normal'|'medium'|'semibold'|'bold' or a numeric CSS weight such as 500, 600, 700; omit it for normal text.",
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

function validateDeckDataSources(deck: Slideml2SourceDeck, issues: ValidationIssue[], options: DataBindingOptions = {}): void {
  const dataSources = deck.deck?.dataSources;
  if (dataSources === undefined) return;
  if (!dataSources || typeof dataSources !== "object" || Array.isArray(dataSources)) {
    issues.push(issue("error", "INVALID_DATA_SOURCES", "deck.dataSources must be an object keyed by source id.", {
      path: "deck.dataSources",
        suggestedFix: "Use deck.dataSources:{revenue:{type:'inline-json', rows:[...]}} or {csv:{type:'inline-csv', csv:'col,value\\nA,1'}} or {sales:{type:'file-csv', path:'data/sales.csv'}} or a computed source derived from another source.",
    }));
    return;
  }
  for (const [sourceId, raw] of Object.entries(dataSources as Record<string, unknown>)) {
    const path = `deck.dataSources.${sourceId}`;
    if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(sourceId)) {
      issues.push(issue("error", "INVALID_DATA_SOURCE_ID", `${path} must use a stable source id token.`, {
        path,
        suggestedFix: "Use ids like revenue, market.size, experiment_1. Avoid spaces and leading numbers.",
      }));
      continue;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      issues.push(issue("error", "INVALID_DATA_SOURCE", `${path} must be an object.`, {
        path,
        suggestedFix: "Use {type:'inline-json', rows:[...]}, {type:'inline-csv', csv:'...'}, {type:'file-csv', path:'data/file.csv'}, or {type:'computed', source:'base', computed:{...}}."
      }));
      continue;
    }
    const rec = raw as Record<string, unknown>;
    if (rec.type !== undefined && !(typeof rec.type === "string" && (DATA_SOURCE_TYPE_VALUES as readonly string[]).includes(rec.type))) {
      issues.push(issue("error", "INVALID_DATA_SOURCE_TYPE", `${path}.type must be one of: ${DATA_SOURCE_TYPE_VALUES.join(", ")}.`, {
        path: `${path}.type`,
        suggestedFix: "Use inline-json for row objects, inline-csv for embedded comma-separated text, file-csv with a local CSV path, or computed for derived rows.",
      }));
      continue;
    }
    validateComputedDataSourceSpec(sourceId, rec, dataSources as Record<string, unknown>, issues, options);
    try {
      const rows = resolveDataSourceRowsById(dataSources, sourceId, options);
      if (rows.length === 0) {
        issues.push(issue("warning", "EMPTY_DATA_SOURCE", `${path} resolved to zero rows.`, {
          path,
          suggestedFix: "Provide at least one row or remove unused data source.",
        }));
      }
    } catch (error) {
      issues.push(issue("error", "INVALID_DATA_SOURCE", `${path} could not be parsed: ${error instanceof Error ? error.message : String(error)}`, {
        path,
        suggestedFix: "Use inline-json rows as an array of objects, inline-csv with a header row, file-csv with a readable local CSV path, or computed with a valid source and controlled expression objects.",
      }));
    }
  }
}

function validateDeckReferences(deck: Slideml2SourceDeck, issues: ValidationIssue[]): void {
  const refIds = new Set<string>();
  const footnoteIds = new Set<string>();
  const cited = new Set<string>();
  const usedFootnotes = new Set<string>();
  const references = deck.deck?.references;
  if (references !== undefined) {
    if (!Array.isArray(references)) {
      issues.push(issue("error", "INVALID_REFERENCES", "deck.references must be an array.", {
        path: "deck.references",
        suggestedFix: "Use deck.references:[{id:'smith2024',title:'...',authors:['Smith'],year:2024}].",
      }));
    } else {
      references.forEach((raw, index) => {
        const path = `deck.references[${index}]`;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          issues.push(issue("error", "INVALID_REFERENCE", `${path} must be an object.`, { path }));
          return;
        }
        const rec = raw as unknown as Record<string, unknown>;
        const id = typeof rec.id === "string" ? rec.id.trim() : "";
        if (!id) {
          issues.push(issue("error", "MISSING_REFERENCE_ID", `${path}.id is required.`, {
            path,
            suggestedFix: "Give every reference a stable id and cite it with {kind:'cite',refId:'...'} in rich text runs.",
          }));
          return;
        }
        if (refIds.has(id)) {
          issues.push(issue("error", "DUPLICATE_REFERENCE_ID", `Duplicate reference id "${id}".`, {
            path,
            suggestedFix: "Rename one reference id and update matching cite runs.",
          }));
        }
        refIds.add(id);
      });
    }
  }
  const footnotes = deck.deck?.footnotes;
  if (footnotes !== undefined) {
    if (!Array.isArray(footnotes)) {
      issues.push(issue("error", "INVALID_FOOTNOTES", "deck.footnotes must be an array.", {
        path: "deck.footnotes",
        suggestedFix: "Use deck.footnotes:[{id:'n1',text:'...'}] and reference with {kind:'footnoteRef',footnoteId:'n1'}.",
      }));
    } else {
      footnotes.forEach((raw, index) => {
        const path = `deck.footnotes[${index}]`;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          issues.push(issue("error", "INVALID_FOOTNOTE", `${path} must be an object.`, { path }));
          return;
        }
        const rec = raw as unknown as Record<string, unknown>;
        const id = typeof rec.id === "string" ? rec.id.trim() : "";
        if (!id) {
          issues.push(issue("error", "MISSING_FOOTNOTE_ID", `${path}.id is required.`, {
            path,
            suggestedFix: "Give every footnote a stable id and reference it with {kind:'footnoteRef',footnoteId:'...'} or table cell footnoteRefs.",
          }));
          return;
        }
        if (footnoteIds.has(id)) {
          issues.push(issue("error", "DUPLICATE_FOOTNOTE_ID", `Duplicate footnote id "${id}".`, {
            path,
            suggestedFix: "Rename one footnote id and update matching footnoteRef runs.",
          }));
        }
        footnoteIds.add(id);
        if (typeof rec.text !== "string" || !rec.text.trim()) {
          issues.push(issue("error", "MISSING_FOOTNOTE_TEXT", `${path}.text is required.`, {
            path,
            suggestedFix: "Provide the footnote text under deck.footnotes[].text.",
          }));
        }
      });
    }
  }
  deck.slides.forEach((slide, slideIndex) => {
    (slide.children || []).forEach((node, index) => validateScientificRefsInValue(node, `slides[${slideIndex}].children[${index}]`, slide.id, issues, refIds, footnoteIds, cited, usedFootnotes));
  });
  for (const id of refIds) {
    if (!cited.has(id)) {
      issues.push(issue("warning", "UNUSED_REFERENCE", `deck.references id "${id}" is not cited by any rich inline cite run.`, {
        path: "deck.references",
        suggestedFix: "Remove the unused reference, set includeAll:true on bibliography if it is intentional appendix material, or cite it with {kind:'cite',refId:'...'} in a text/table/callout run.",
      }));
    }
  }
}

function validateScientificRefsInValue(
  value: unknown,
  path: string,
  slideId: string,
  issues: ValidationIssue[],
  refIds: Set<string>,
  footnoteIds: Set<string>,
  cited: Set<string>,
  usedFootnotes: Set<string>,
): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateScientificRefsInValue(item, `${path}[${index}]`, slideId, issues, refIds, footnoteIds, cited, usedFootnotes));
    return;
  }
  const rec = value as Record<string, unknown>;
  if (rec.kind === "cite") {
    const refId = typeof rec.refId === "string" ? rec.refId.trim() : "";
    if (!refId) {
      issues.push(issue("error", "MISSING_CITATION_REF_ID", `${path}.refId is required for {kind:'cite'}.`, {
        slideId,
        path,
        suggestedFix: "Set the rich run to {kind:'cite',refId:'reference-id'} and define that id under deck.references.",
      }));
    } else if (!refIds.has(refId)) {
      issues.push(issue("error", "UNKNOWN_REFERENCE_ID", `${path}.refId "${refId}" is not defined in deck.references.`, {
        slideId,
        path,
        suggestedFix: `Add deck.references entry {id:'${refId}',...} or cite an existing reference id.`,
      }));
    } else {
      cited.add(refId);
    }
  }
  if (rec.kind === "footnoteRef") {
    const footnoteId = typeof rec.footnoteId === "string" ? rec.footnoteId.trim() : "";
    validateFootnoteRefId(footnoteId, `${path}.footnoteId`, slideId, issues, footnoteIds, usedFootnotes);
  }
  if (rec.kind === "math" && typeof rec.latex !== "string" && typeof rec.text !== "string") {
    issues.push(issue("error", "MISSING_INLINE_MATH_LATEX", `${path} math inline requires latex or text.`, {
      slideId,
      path,
      suggestedFix: "Use {kind:'math',latex:'E=mc^2'} inside content/runs.",
    }));
  } else if (rec.kind === "math") {
    const latex = typeof rec.latex === "string" ? rec.latex : String(rec.text ?? "");
    const unsupported = unsupportedLatexCommands(latex);
    if (unsupported.length > 0) {
      issues.push(issue("error", "UNSUPPORTED_LATEX_COMMAND", `${path} contains unsupported LaTeX command(s): ${unsupported.join(", ")}.`, {
        slideId,
        path,
        suggestedFix: "Use supported math commands such as \\frac, \\sqrt, \\vec, \\boxed, \\text, Greek symbols, superscripts/subscripts, or split/render the formula as an image.",
      }));
    }
  }
  if (Array.isArray(rec.footnoteRefs)) {
    rec.footnoteRefs.forEach((raw, index) => {
      const footnoteId = typeof raw === "string" ? raw.trim() : "";
      validateFootnoteRefId(footnoteId, `${path}.footnoteRefs[${index}]`, slideId, issues, footnoteIds, usedFootnotes);
    });
  } else if (rec.footnoteRefs !== undefined) {
    issues.push(issue("error", "INVALID_FOOTNOTE_REFS", `${path}.footnoteRefs must be a string array.`, {
      slideId,
      path,
      suggestedFix: "Use footnoteRefs:['note-id'] on table cell objects.",
    }));
  }
  if (rec.type === "code-block") {
    validateCodeBlockExtras(rec, path, slideId, issues);
  }
  if (rec.type === "equation") {
    const latex = typeof rec.latex === "string" ? rec.latex : "";
    const unsupported = unsupportedLatexCommands(latex);
    if (unsupported.length > 0) {
      issues.push(issue("error", "UNSUPPORTED_LATEX_COMMAND", `${path}.latex contains unsupported LaTeX command(s): ${unsupported.join(", ")}.`, {
        slideId,
        path: `${path}.latex`,
        suggestedFix: "Use supported math commands such as \\frac, \\sqrt, \\vec, \\boxed, \\text, Greek symbols, superscripts/subscripts, or split/render the formula as an image.",
      }));
    }
  }
  for (const [key, child] of Object.entries(rec)) {
    if (key === "references" || key === "footnotes") continue;
    validateScientificRefsInValue(child, `${path}.${key}`, slideId, issues, refIds, footnoteIds, cited, usedFootnotes);
  }
}

function validateFootnoteRefId(
  footnoteId: string,
  path: string,
  slideId: string,
  issues: ValidationIssue[],
  footnoteIds: Set<string>,
  used: Set<string>,
): void {
  if (!footnoteId) {
    issues.push(issue("error", "MISSING_FOOTNOTE_REF_ID", `${path} is required for footnote references.`, {
      slideId,
      path,
      suggestedFix: "Reference an existing deck.footnotes id.",
    }));
    return;
  }
  if (!footnoteIds.has(footnoteId)) {
    issues.push(issue("error", "UNKNOWN_FOOTNOTE_ID", `${path} "${footnoteId}" is not defined in deck.footnotes.`, {
      slideId,
      path,
      suggestedFix: `Add deck.footnotes entry {id:'${footnoteId}',text:'...'} or use an existing footnote id.`,
    }));
    return;
  }
  used.add(footnoteId);
}

function validateCodeBlockExtras(rec: Record<string, unknown>, path: string, slideId: string, issues: ValidationIssue[]): void {
  if (rec.highlightLines !== undefined && !Array.isArray(rec.highlightLines)) {
    issues.push(issue("error", "INVALID_CODE_HIGHLIGHT_LINES", `${path}.highlightLines must be an array.`, {
      slideId,
      path: `${path}.highlightLines`,
      suggestedFix: "Use highlightLines:[2,{start:4,end:6}].",
    }));
  }
  if (typeof rec.maxLines === "number" && (!Number.isFinite(rec.maxLines) || rec.maxLines <= 0)) {
    issues.push(issue("error", "INVALID_CODE_MAX_LINES", `${path}.maxLines must be a positive number.`, {
      slideId,
      path: `${path}.maxLines`,
      suggestedFix: "Use a positive maxLines value or omit it.",
    }));
  }
  if (rec.columns !== undefined && (typeof rec.columns !== "number" || !Number.isFinite(rec.columns) || rec.columns < 1 || rec.columns > 3)) {
    issues.push(issue("error", "INVALID_CODE_COLUMNS", `${path}.columns must be 1, 2, or 3.`, {
      slideId,
      path: `${path}.columns`,
      suggestedFix: "Use columns:2 for long code listings, or omit it for a single column.",
    }));
  }
  if (rec.fontSize !== undefined && (typeof rec.fontSize !== "number" || !Number.isFinite(rec.fontSize) || rec.fontSize < 5 || rec.fontSize > 14)) {
    issues.push(issue("error", "INVALID_CODE_FONT_SIZE", `${path}.fontSize must be between 5 and 14 points.`, {
      slideId,
      path: `${path}.fontSize`,
      suggestedFix: "Use fontSize:6.5 or density:'dense'/'tiny' for long code blocks.",
    }));
  }
  if (rec.density !== undefined && rec.density !== "compact" && rec.density !== "dense" && rec.density !== "tiny") {
    issues.push(issue("error", "INVALID_CODE_DENSITY", `${path}.density must be compact, dense, or tiny.`, {
      slideId,
      path: `${path}.density`,
      suggestedFix: "Use density:'dense' or density:'tiny' instead of maxLines when the code should remain visible.",
    }));
  }
}

function validateComputedDataSourceSpec(
  sourceId: string,
  rec: Record<string, unknown>,
  allSources: Record<string, unknown>,
  issues: ValidationIssue[],
  options: DataBindingOptions,
): void {
  const inferredComputed = rec.type === "computed" || typeof rec.source === "string" || isPlainObject(rec.computed) || isPlainObject(rec.columns) || isPlainObject(rec.postComputed) || isPlainObject(rec.view);
  if (!inferredComputed) return;
  const path = `deck.dataSources.${sourceId}`;
  const allowed = new Set(["type", "source", "from", "view", "computed", "columns", "postComputed", "sourceLabel", "citation", "accessedAt"]);
  for (const key of Object.keys(rec)) {
    if (!allowed.has(key)) {
      issues.push(issue("error", "UNKNOWN_DATA_SOURCE_FIELD", `${path}.${key} is not supported for computed data sources.`, {
        path: `${path}.${key}`,
        suggestedFix: "Use type, source, computed/columns, postComputed, view, sourceLabel, citation, or accessedAt.",
      }));
    }
  }
  const baseSource = typeof rec.source === "string" && rec.source.trim()
    ? rec.source.trim()
    : typeof rec.from === "string" && rec.from.trim()
      ? rec.from.trim()
      : "";
  if (!baseSource) {
    issues.push(issue("error", "INVALID_COMPUTED_DATA_SOURCE", `${path}.source is required for computed data sources.`, {
      path: `${path}.source`,
      suggestedFix: "Use {type:'computed', source:'baseSource', computed:{marginPct:{op:'divide', left:'profit', right:'revenue'}}}.",
    }));
    return;
  }
  if (baseSource === sourceId) {
    issues.push(issue("error", "INVALID_COMPUTED_DATA_SOURCE", `${path}.source cannot reference itself.`, {
      path: `${path}.source`,
      suggestedFix: "Reference a separate base source id.",
    }));
    return;
  }
  if (!(baseSource in allSources)) {
    issues.push(issue("error", "UNKNOWN_DATA_BIND_SOURCE", `${path}.source references missing data source "${baseSource}".`, {
      path: `${path}.source`,
      suggestedFix: `Add deck.dataSources.${baseSource} or change the computed source to an existing source id.`,
    }));
    return;
  }
  let baseRows: Record<string, unknown>[] = [];
  try {
    baseRows = resolveDataSourceRowsById(allSources, baseSource, options);
  } catch {
    return;
  }
  const sourceFields = dataFieldSet(baseRows);
  const computed = isPlainObject(rec.computed) ? rec.computed as Record<string, unknown> : isPlainObject(rec.columns) ? rec.columns as Record<string, unknown> : {};
  validateComputedColumnExpressions(computed, sourceFields, baseRows, `${path}.${isPlainObject(rec.computed) ? "computed" : "columns"}`, issues);
  if (isPlainObject(rec.view)) {
    const viewFields = new Set([...sourceFields, ...Object.keys(computed)]);
    validateDataFieldReferences(rec.view as Record<string, unknown>, undefined, [Object.fromEntries(Array.from(viewFields).map((field) => [field, ""]))], `${path}.view`, "", sourceId, issues);
  }
}

function validateComputedColumnExpressions(
  columns: Record<string, unknown>,
  sourceFields: Set<string>,
  rows: Record<string, unknown>[],
  path: string,
  issues: ValidationIssue[],
): void {
  const availableFields = new Set(sourceFields);
  for (const [column, expr] of Object.entries(columns)) {
    const exprPath = `${path}.${column}`;
    if (!column.trim()) {
      issues.push(issue("error", "INVALID_COMPUTED_DATA_SOURCE", `${exprPath} must use a non-empty output field name.`, { path: exprPath }));
      continue;
    }
    validateComputedExpression(expr, availableFields, sourceFields, rows, exprPath, issues);
    availableFields.add(column);
  }
}

function validateComputedExpression(expr: unknown, availableFields: Set<string>, sourceFields: Set<string>, rows: Record<string, unknown>[], path: string, issues: ValidationIssue[]): void {
  if (!isPlainObject(expr)) return;
  const rec = expr as Record<string, unknown>;
  const op = typeof rec.op === "string" ? rec.op : "field";
  const allowed = new Set(["field", "literal", "add", "sum", "subtract", "sub", "multiply", "mul", "divide", "div", "ratio", "percent-change", "percentChange", "negate", "abs", "round", "concat", "coalesce"]);
  if (!allowed.has(op)) {
    issues.push(issue("error", "INVALID_COMPUTED_EXPRESSION", `${path}.op must be a controlled data expression op, not arbitrary code.`, {
      path: `${path}.op`,
      suggestedFix: "Use one of: field, literal, add/sum, subtract, multiply, divide/ratio, percent-change, negate, abs, round, concat, or coalesce.",
    }));
    return;
  }
  for (const [fieldPath, field, numeric] of computedFieldRefs(rec)) {
    checkDataField(field, availableFields, `${path}.${fieldPath}`, "computed", "", undefined, issues);
    if (numeric && sourceFields.has(field) && !fieldLooksNumeric(rows, field)) {
      issues.push(issue("error", "INVALID_DATA_COMPUTED_FIELD_TYPE", `${path}.${fieldPath} references "${field}", but its values are not numeric enough for ${op}.`, {
        path: `${path}.${fieldPath}`,
        suggestedFix: "Use numeric source fields for arithmetic expressions, or use concat/coalesce for text.",
      }));
    }
  }
}

function computedFieldRefs(expr: Record<string, unknown>): Array<[string, string, boolean]> {
  const op = typeof expr.op === "string" ? expr.op : "field";
  const out: Array<[string, string, boolean]> = [];
  const numericOps = new Set(["add", "sum", "subtract", "sub", "multiply", "mul", "divide", "div", "ratio", "percent-change", "percentChange", "negate", "abs", "round"]);
  const numeric = numericOps.has(op);
  const pushOperand = (path: string, value: unknown, forceNumeric = numeric) => {
    if (typeof value === "string" && value.trim() && (forceNumeric || op === "field")) out.push([path, value.trim(), forceNumeric]);
    if (isPlainObject(value) && typeof (value as Record<string, unknown>).field === "string" && String((value as Record<string, unknown>).field).trim()) {
      out.push([`${path}.field`, String((value as Record<string, unknown>).field).trim(), forceNumeric]);
    }
  };
  if (op === "field") pushOperand("field", expr.field, false);
  pushOperand("left", expr.left);
  pushOperand("right", expr.right);
  pushOperand("current", expr.current);
  pushOperand("previous", expr.previous);
  pushOperand("value", expr.value, op === "negate" || op === "abs" || op === "round");
  if (Array.isArray(expr.values)) {
    expr.values.forEach((value, index) => pushOperand(`values[${index}]`, value, op === "concat" || op === "coalesce" ? false : numeric));
  }
  return out;
}

function fieldLooksNumeric(rows: Record<string, unknown>[], field: string): boolean {
  const values = rows.map((row) => row[field]).filter((value) => value !== undefined && value !== null && String(value).trim() !== "");
  if (!values.length) return true;
  const numeric = values.filter((value) => looseNumeric(value)).length;
  return numeric >= Math.max(1, values.length * 0.8);
}

function looseNumeric(value: unknown): boolean {
  if (typeof value === "number" && Number.isFinite(value)) return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim().replace(/,/g, "").replace(/%$/, "");
  return normalized !== "" && Number.isFinite(Number(normalized));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validateDataBindings(deck: Slideml2SourceDeck, issues: ValidationIssue[], options: DataBindingOptions = {}): void {
  const sourceIds = new Set(Object.keys(deck.deck?.dataSources || {}));
  const sourceRows = dataSourceRowsById(deck.deck?.dataSources, options);
  deck.slides.forEach((slide, slideIndex) => {
    slide.children?.forEach((node, nodeIndex) => validateNodeDataBinding(node, `slides[${slideIndex}].children[${nodeIndex}]`, slide.id, sourceIds, sourceRows, issues));
  });
}

function dataSourceRowsById(dataSources: unknown, options: DataBindingOptions = {}): Map<string, Record<string, unknown>[]> {
  const out = new Map<string, Record<string, unknown>[]>();
  if (!dataSources || typeof dataSources !== "object" || Array.isArray(dataSources)) return out;
  for (const [sourceId, raw] of Object.entries(dataSources as Record<string, unknown>)) {
    try {
      out.set(sourceId, resolveDataSourceRowsById(dataSources, sourceId, options));
    } catch {
      // validateDeckDataSources reports the malformed source.
    }
  }
  return out;
}

function validateNodeDataBinding(node: DomNode, path: string, slideId: string, sourceIds: Set<string>, sourceRows: Map<string, Record<string, unknown>[]>, issues: ValidationIssue[]): void {
  if (!node || typeof node !== "object") return;
  const bind = (node as Record<string, unknown>).bind;
  if (bind !== undefined && !isEmptyObject(bind)) validateBindSpec(bind, `${path}.bind`, slideId, node.id, sourceIds, issues);
  const encoding = (node as Record<string, unknown>).encoding;
  if (encoding !== undefined && !isEmptyObject(encoding)) validateEncodingSpec(encoding, `${path}.encoding`, slideId, node.id, issues);
  if (bind && typeof bind === "object" && !Array.isArray(bind) && !isEmptyObject(bind)) {
    const sourceId = typeof (bind as Record<string, unknown>).source === "string" ? String((bind as Record<string, unknown>).source).trim() : "";
    const rows = sourceRows.get(sourceId);
    if (rows && rows.length) validateDataFieldReferences(bind as Record<string, unknown>, encoding, rows, `${path}.bind`, slideId, node.id, issues);
  }
  node.children?.forEach((child, index) => validateNodeDataBinding(child, `${path}.children[${index}]`, slideId, sourceIds, sourceRows, issues));
  if (Array.isArray(node.items)) {
    node.items.forEach((item, index) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const content = (item as Record<string, unknown>).content;
        if (content && typeof content === "object" && !Array.isArray(content)) {
          validateNodeDataBinding(content as DomNode, `${path}.items[${index}].content`, slideId, sourceIds, sourceRows, issues);
        }
      }
    });
  }
}

function isEmptyObject(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length === 0);
}

function validateDataFieldReferences(
  bind: Record<string, unknown>,
  encoding: unknown,
  rows: Record<string, unknown>[],
  path: string,
  slideId: string,
  nodeName: unknown,
  issues: ValidationIssue[],
): void {
  const sourceFields = dataFieldSet(rows);
  if (sourceFields.size === 0) return;
  const groupKeys = dataFieldList(bind.groupBy);
  const aggregationFields = aggregateFieldRefs(bind.aggregate);
  const aggregateOutputs = aggregationFields.map((item) => item.output);
  const prePivotFields = aggregateOutputs.length > 0
    ? new Set([...groupKeys, ...aggregateOutputs])
    : sourceFields;
  for (const field of Object.keys(asPlainObject(bind.filter))) {
    checkDataField(field, sourceFields, `${path}.filter.${field}`, "filter", slideId, nodeName, issues);
  }
  groupKeys.forEach((field, index) => checkDataField(field, sourceFields, `${path}.groupBy${Array.isArray(bind.groupBy) ? `[${index}]` : ""}`, "groupBy", slideId, nodeName, issues));
  for (const aggregation of aggregationFields) {
    if (aggregation.input) {
      checkDataField(aggregation.input, sourceFields, `${path}.aggregate.${aggregation.output}`, "aggregate", slideId, nodeName, issues);
    }
  }
  const pivotRefs = pivotFieldRefs(bind.pivot);
  for (const [key, field] of pivotRefs) {
    checkDataField(field, prePivotFields, `${path}.pivot.${key}`, "pivot", slideId, nodeName, issues);
  }
  const viewFields = bind.pivot && pivotRefs.length > 0
    ? pivotOutputFields(rows, bind.pivot as Record<string, unknown>)
    : prePivotFields;
  const sortField = sortFieldName(bind.sort);
  if (sortField) checkDataField(sortField, viewFields, `${path}.sort`, "sort", slideId, nodeName, issues);
  for (const field of selectFieldList(bind.select)) {
    checkDataField(field, viewFields, `${path}.select`, "select", slideId, nodeName, issues);
  }
  if (encoding && typeof encoding === "object" && !Array.isArray(encoding)) {
    const enc = encoding as Record<string, unknown>;
    for (const [key, field] of encodingFieldRefs(enc)) {
      checkDataField(field, viewFields, `${path.replace(/\.bind$/, ".encoding")}.${key}`, "encoding", slideId, nodeName, issues);
    }
  }
}

function dataFieldSet(rows: Record<string, unknown>[]): Set<string> {
  const fields = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) fields.add(key);
  }
  return fields;
}

function asPlainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function dataFieldList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function aggregateFieldRefs(value: unknown): Array<{ output: string; input?: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const out: Array<{ output: string; input?: string }> = [];
  for (const [output, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!output.trim()) continue;
    if (typeof raw === "string") {
      if (raw !== "count") out.push({ output, input: output });
      else out.push({ output });
      continue;
    }
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const spec = raw as Record<string, unknown>;
      if (spec.op === "count" && spec.field === undefined) {
        out.push({ output });
      } else if (typeof spec.field === "string" && spec.field.trim()) {
        out.push({ output, input: spec.field.trim() });
      } else {
        out.push({ output, input: output });
      }
    }
  }
  return out;
}

function pivotFieldRefs(value: unknown): Array<[string, string]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const rec = value as Record<string, unknown>;
  const out: Array<[string, string]> = [];
  dataFieldList(rec.index).forEach((field, index) => out.push([Array.isArray(rec.index) ? `index[${index}]` : "index", field]));
  if (typeof rec.columns === "string" && rec.columns.trim()) out.push(["columns", rec.columns.trim()]);
  if (typeof rec.values === "string" && rec.values.trim()) out.push(["values", rec.values.trim()]);
  return out;
}

function pivotOutputFields(rows: Record<string, unknown>[], rawPivot: Record<string, unknown>): Set<string> {
  const fields = new Set<string>();
  for (const field of dataFieldList(rawPivot.index)) fields.add(field);
  const columnField = typeof rawPivot.columns === "string" ? rawPivot.columns.trim() : "";
  if (!columnField) return fields;
  for (const row of rows) {
    const label = formatDataFieldValue(row[columnField]);
    if (label) fields.add(label);
  }
  return fields;
}

function formatDataFieldValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
  return String(value);
}

function sortFieldName(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim().replace(/^-/, "");
  if (value && typeof value === "object" && !Array.isArray(value) && typeof (value as { by?: unknown }).by === "string") {
    return String((value as { by: unknown }).by).trim() || undefined;
  }
  return undefined;
}

function selectFieldList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
  if (value && typeof value === "object" && !Array.isArray(value)) return Object.values(value as Record<string, unknown>).map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
  return [];
}

function encodingFieldRefs(encoding: Record<string, unknown>): Array<[string, string]> {
  const refs: Array<[string, string]> = [];
  for (const key of ["x", "series", "label", "value", "delta"] as const) {
    const field = encoding[key];
    if (typeof field === "string" && field.trim()) refs.push([key, field.trim()]);
  }
  if (typeof encoding.y === "string" && encoding.y.trim()) refs.push(["y", encoding.y.trim()]);
  if (Array.isArray(encoding.y)) {
    encoding.y.forEach((field, index) => {
      if (typeof field === "string" && field.trim()) refs.push([`y[${index}]`, field.trim()]);
    });
  }
  if (Array.isArray(encoding.columns)) {
    encoding.columns.forEach((column, index) => {
      if (typeof column === "string" && column.trim()) refs.push([`columns[${index}]`, column.trim()]);
      if (column && typeof column === "object" && !Array.isArray(column) && typeof (column as { key?: unknown }).key === "string" && (column as { key: string }).key.trim()) {
        refs.push([`columns[${index}].key`, (column as { key: string }).key.trim()]);
      }
    });
  }
  if (Array.isArray(encoding.items)) {
    encoding.items.forEach((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return;
      const rec = item as Record<string, unknown>;
      const valueKey = firstNonEmptyString(rec.value, rec.key, rec.field);
      if (valueKey) refs.push([`items[${index}].value`, valueKey]);
      if (typeof rec.labelField === "string" && rec.labelField.trim()) refs.push([`items[${index}].labelField`, rec.labelField.trim()]);
    });
  }
  return refs;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function checkDataField(field: string, fields: Set<string>, path: string, role: string, slideId: string, nodeName: unknown, issues: ValidationIssue[]): void {
  if (!field || fields.has(field)) return;
  issues.push(issue("error", "UNKNOWN_DATA_FIELD", `${path} references missing data field "${field}" for ${role}.`, {
    slideId,
    path,
    nodeName: typeof nodeName === "string" ? nodeName : undefined,
    suggestedFix: `Use one of: ${Array.from(fields).slice(0, 12).join(", ")}.`,
  }));
}

function validateBindSpec(bind: unknown, path: string, slideId: string, nodeName: unknown, sourceIds: Set<string>, issues: ValidationIssue[]): void {
  if (!bind || typeof bind !== "object" || Array.isArray(bind)) {
    issues.push(issue("error", "INVALID_DATA_BIND", `${path} must be an object.`, {
      slideId,
      path,
      nodeName: typeof nodeName === "string" ? nodeName : undefined,
      suggestedFix: "Use bind:{source:'dataSourceId', filter?, sort?, limit?}.",
    }));
    return;
  }
  const rec = bind as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (!(DATA_BIND_FIELDS as readonly string[]).includes(key)) {
      issues.push(issue("error", "UNKNOWN_DATA_BIND_FIELD", `${path}.${key} is not a supported bind field.`, {
        slideId,
        path: `${path}.${key}`,
        nodeName: typeof nodeName === "string" ? nodeName : undefined,
        suggestedFix: "Use source, select, filter, groupBy, aggregate, pivot, sort, or limit.",
      }));
    }
  }
  if (typeof rec.source !== "string" || !rec.source.trim()) {
    issues.push(issue("error", "INVALID_DATA_BIND_SOURCE", `${path}.source must name a deck.dataSources entry.`, {
      slideId,
      path: `${path}.source`,
      nodeName: typeof nodeName === "string" ? nodeName : undefined,
      suggestedFix: "Set bind.source to a data source id defined under deck.dataSources.",
    }));
  } else if (!sourceIds.has(rec.source)) {
    issues.push(issue("error", "UNKNOWN_DATA_BIND_SOURCE", `${path}.source references missing data source "${rec.source}".`, {
      slideId,
      path: `${path}.source`,
      nodeName: typeof nodeName === "string" ? nodeName : undefined,
      suggestedFix: `Add deck.dataSources.${rec.source} or change bind.source to an existing data source id.`,
    }));
  }
  if (rec.filter !== undefined && (!rec.filter || typeof rec.filter !== "object" || Array.isArray(rec.filter))) {
    issues.push(issue("error", "INVALID_DATA_BIND_FILTER", `${path}.filter must be an object.`, { slideId, path: `${path}.filter`, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
  }
  if (rec.groupBy !== undefined && !(typeof rec.groupBy === "string" || (Array.isArray(rec.groupBy) && rec.groupBy.every((item) => typeof item === "string" && item.trim())))) {
    issues.push(issue("error", "INVALID_DATA_BIND_GROUP_BY", `${path}.groupBy must be a field name or an array of field names.`, {
      slideId,
      path: `${path}.groupBy`,
      nodeName: typeof nodeName === "string" ? nodeName : undefined,
      suggestedFix: "Use groupBy:'region' or groupBy:['region','segment'].",
    }));
  }
  if (rec.aggregate !== undefined) validateAggregateSpec(rec.aggregate, `${path}.aggregate`, slideId, nodeName, issues);
  if (rec.pivot !== undefined) validatePivotSpec(rec.pivot, `${path}.pivot`, slideId, nodeName, issues);
  if (rec.pivot !== undefined && (rec.groupBy !== undefined || rec.aggregate !== undefined)) {
    issues.push(issue("error", "INVALID_DATA_BIND_PIVOT", `${path}.pivot cannot be combined with groupBy/aggregate in the same bind view.`, {
      slideId,
      path: `${path}.pivot`,
      nodeName: typeof nodeName === "string" ? nodeName : undefined,
      suggestedFix: "Use pivot's own aggregate field, or create a separate pre-aggregated data source.",
    }));
  }
  if (rec.sort !== undefined && !(typeof rec.sort === "string" || (rec.sort && typeof rec.sort === "object" && !Array.isArray(rec.sort) && typeof (rec.sort as { by?: unknown }).by === "string" && ((rec.sort as { direction?: unknown }).direction === undefined || (rec.sort as { direction?: unknown }).direction === "asc" || (rec.sort as { direction?: unknown }).direction === "desc")))) {
    issues.push(issue("error", "INVALID_DATA_BIND_SORT", `${path}.sort must be a field string, -field string, or {by,direction}.`, {
      slideId,
      path: `${path}.sort`,
      nodeName: typeof nodeName === "string" ? nodeName : undefined,
    }));
  }
  if (rec.limit !== undefined && (typeof rec.limit !== "number" || !Number.isFinite(rec.limit) || rec.limit <= 0)) {
    issues.push(issue("error", "INVALID_DATA_BIND_LIMIT", `${path}.limit must be a positive number.`, { slideId, path: `${path}.limit`, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
  }
}

function validatePivotSpec(pivot: unknown, path: string, slideId: string, nodeName: unknown, issues: ValidationIssue[]): void {
  if (!pivot || typeof pivot !== "object" || Array.isArray(pivot)) {
    issues.push(issue("error", "INVALID_DATA_BIND_PIVOT", `${path} must be an object.`, {
      slideId,
      path,
      nodeName: typeof nodeName === "string" ? nodeName : undefined,
      suggestedFix: "Use pivot:{index:'region', columns:'product', values:'revenue', aggregate:'sum'}.",
    }));
    return;
  }
  const rec = pivot as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (!["index", "columns", "values", "aggregate", "fill"].includes(key)) {
      issues.push(issue("error", "UNKNOWN_DATA_BIND_FIELD", `${path}.${key} is not a supported pivot field.`, {
        slideId,
        path: `${path}.${key}`,
        nodeName: typeof nodeName === "string" ? nodeName : undefined,
        suggestedFix: "Use pivot:{index, columns, values, aggregate?, fill?}.",
      }));
    }
  }
  if (!(typeof rec.index === "string" && rec.index.trim()) && !(Array.isArray(rec.index) && rec.index.every((item) => typeof item === "string" && item.trim()))) {
    issues.push(issue("error", "INVALID_DATA_BIND_PIVOT", `${path}.index must be a field name or field array.`, { slideId, path: `${path}.index`, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
  }
  if (typeof rec.columns !== "string" || !rec.columns.trim()) {
    issues.push(issue("error", "INVALID_DATA_BIND_PIVOT", `${path}.columns must be a field name.`, { slideId, path: `${path}.columns`, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
  }
  if (typeof rec.values !== "string" || !rec.values.trim()) {
    issues.push(issue("error", "INVALID_DATA_BIND_PIVOT", `${path}.values must be a field name.`, { slideId, path: `${path}.values`, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
  }
  if (rec.aggregate !== undefined && !(DATA_AGGREGATE_OP_VALUES as readonly unknown[]).includes(rec.aggregate)) {
    issues.push(issue("error", "INVALID_DATA_BIND_PIVOT", `${path}.aggregate must be one of: ${DATA_AGGREGATE_OP_VALUES.join(", ")}.`, {
      slideId,
      path: `${path}.aggregate`,
      nodeName: typeof nodeName === "string" ? nodeName : undefined,
    }));
  }
  if (rec.fill !== undefined && typeof rec.fill !== "string" && typeof rec.fill !== "number") {
    issues.push(issue("error", "INVALID_DATA_BIND_PIVOT", `${path}.fill must be a string or number.`, { slideId, path: `${path}.fill`, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
  }
}

function validateAggregateSpec(aggregate: unknown, path: string, slideId: string, nodeName: unknown, issues: ValidationIssue[]): void {
  if (!aggregate || typeof aggregate !== "object" || Array.isArray(aggregate)) {
    issues.push(issue("error", "INVALID_DATA_BIND_AGGREGATE", `${path} must be an object keyed by output field.`, {
      slideId,
      path,
      nodeName: typeof nodeName === "string" ? nodeName : undefined,
      suggestedFix: "Use aggregate:{revenue:'sum'} or aggregate:{avgRevenue:{op:'avg', field:'revenue'}}.",
    }));
    return;
  }
  for (const [output, raw] of Object.entries(aggregate as Record<string, unknown>)) {
    const aggregatePath = `${path}.${output}`;
    if (!output.trim()) {
      issues.push(issue("error", "INVALID_DATA_BIND_AGGREGATE", `${aggregatePath} must use a non-empty output field name.`, { slideId, path: aggregatePath, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
      continue;
    }
    if (typeof raw === "string") {
      if (!(DATA_AGGREGATE_OP_VALUES as readonly string[]).includes(raw)) {
        issues.push(issue("error", "INVALID_DATA_AGGREGATE_OP", `${aggregatePath} must use one of: ${DATA_AGGREGATE_OP_VALUES.join(", ")}.`, {
          slideId,
          path: aggregatePath,
          nodeName: typeof nodeName === "string" ? nodeName : undefined,
        }));
      }
      continue;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      issues.push(issue("error", "INVALID_DATA_BIND_AGGREGATE", `${aggregatePath} must be an aggregate op string or {op, field?}.`, { slideId, path: aggregatePath, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
      continue;
    }
    const spec = raw as Record<string, unknown>;
    if (typeof spec.op !== "string" || !(DATA_AGGREGATE_OP_VALUES as readonly string[]).includes(spec.op)) {
      issues.push(issue("error", "INVALID_DATA_AGGREGATE_OP", `${aggregatePath}.op must use one of: ${DATA_AGGREGATE_OP_VALUES.join(", ")}.`, {
        slideId,
        path: `${aggregatePath}.op`,
        nodeName: typeof nodeName === "string" ? nodeName : undefined,
      }));
    }
    if (spec.field !== undefined && (typeof spec.field !== "string" || !spec.field.trim())) {
      issues.push(issue("error", "INVALID_DATA_BIND_AGGREGATE", `${aggregatePath}.field must be a non-empty field name when provided.`, {
        slideId,
        path: `${aggregatePath}.field`,
        nodeName: typeof nodeName === "string" ? nodeName : undefined,
      }));
    }
  }
}

function validateEncodingSpec(encoding: unknown, path: string, slideId: string, nodeName: unknown, issues: ValidationIssue[]): void {
  if (!encoding || typeof encoding !== "object" || Array.isArray(encoding)) {
    issues.push(issue("error", "INVALID_DATA_ENCODING", `${path} must be an object.`, { slideId, path, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
    return;
  }
  for (const key of Object.keys(encoding as Record<string, unknown>)) {
    if (!(DATA_ENCODING_FIELDS as readonly string[]).includes(key)) {
      issues.push(issue("error", "UNKNOWN_DATA_ENCODING_FIELD", `${path}.${key} is not a supported encoding field.`, {
        slideId,
        path: `${path}.${key}`,
        nodeName: typeof nodeName === "string" ? nodeName : undefined,
        suggestedFix: "Use x, y, orientation, series, label, value, delta, columns, seriesName, or seriesOptions.",
      }));
    }
  }
  validateEncodingColumns((encoding as Record<string, unknown>).columns, `${path}.columns`, slideId, nodeName, issues);
  validateEncodingItems((encoding as Record<string, unknown>).items, `${path}.items`, slideId, nodeName, issues);
  validateEncodingSeriesOptions((encoding as Record<string, unknown>).seriesOptions, `${path}.seriesOptions`, slideId, nodeName, issues);
}

function validateEncodingItems(items: unknown, path: string, slideId: string, nodeName: unknown, issues: ValidationIssue[]): void {
  if (items === undefined) return;
  if (!Array.isArray(items)) {
    issues.push(issue("error", "INVALID_DATA_ENCODING_ITEMS", `${path} must be an array of stat item encodings.`, {
      slideId,
      path,
      nodeName: typeof nodeName === "string" ? nodeName : undefined,
      suggestedFix: "Use items:[{label:'Revenue', value:'revenue', type:'currency'}].",
    }));
    return;
  }
  const allowed = new Set(["value", "key", "field", "label", "labelField", "valueLabel", "tone", "type", "format"]);
  items.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      issues.push(issue("error", "INVALID_DATA_ENCODING_ITEMS", `${itemPath} must be {label?, value, type?, format?, tone?}.`, { slideId, path: itemPath, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
      return;
    }
    const rec = item as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
      if (!allowed.has(key)) {
        issues.push(issue("error", "UNKNOWN_DATA_ENCODING_ITEM_FIELD", `${itemPath}.${key} is not a supported stat item encoding field.`, {
          slideId,
          path: `${itemPath}.${key}`,
          nodeName: typeof nodeName === "string" ? nodeName : undefined,
          suggestedFix: "Use value, label, labelField, valueLabel, type, format, or tone.",
        }));
      }
    }
    const valueKey = firstNonEmptyString(rec.value, rec.key, rec.field);
    if (!valueKey) {
      issues.push(issue("error", "INVALID_DATA_ENCODING_ITEMS", `${itemPath}.value must be a non-empty data field name.`, { slideId, path: `${itemPath}.value`, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
    }
    if (rec.label !== undefined && typeof rec.label !== "string") {
      issues.push(issue("error", "INVALID_DATA_ENCODING_ITEMS", `${itemPath}.label must be a string literal.`, { slideId, path: `${itemPath}.label`, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
    }
    if (rec.labelField !== undefined && !(typeof rec.labelField === "string" && rec.labelField.trim())) {
      issues.push(issue("error", "INVALID_DATA_ENCODING_ITEMS", `${itemPath}.labelField must be a non-empty data field name.`, { slideId, path: `${itemPath}.labelField`, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
    }
    if (rec.valueLabel !== undefined && typeof rec.valueLabel !== "string") {
      issues.push(issue("error", "INVALID_DATA_ENCODING_ITEMS", `${itemPath}.valueLabel must be a string.`, { slideId, path: `${itemPath}.valueLabel`, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
    }
    if (rec.type !== undefined && normalizeDataColumnTypeAlias(rec.type) === undefined) {
      issues.push(issue("error", "INVALID_DATA_ENCODING_COLUMN_TYPE", `${itemPath}.type must be one of: ${DATA_COLUMN_TYPE_VALUES.join(", ")}.`, { slideId, path: `${itemPath}.type`, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
    }
    if (rec.tone !== undefined) {
      const normalized = normalizeComponentEnumValue("stat-strip", "tone", rec.tone);
      if (!normalized || !["brand", "positive", "neutral", "warning", "danger"].includes(normalized)) {
        issues.push(issue("error", "INVALID_COMPONENT_ENUM", `${itemPath}.tone must be one of: brand, positive, neutral, warning, danger.`, { slideId, path: `${itemPath}.tone`, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
      }
    }
  });
}

function validateEncodingSeriesOptions(options: unknown, path: string, slideId: string, nodeName: unknown, issues: ValidationIssue[]): void {
  if (options === undefined) return;
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    issues.push(issue("error", "INVALID_DATA_ENCODING_SERIES_OPTIONS", `${path} must be an object keyed by series/field name.`, {
      slideId,
      path,
      nodeName: typeof nodeName === "string" ? nodeName : undefined,
      suggestedFix: "Use seriesOptions:{Revenue:{type:'bar'}, Margin:{type:'line', axis:'secondary'}}.",
    }));
    return;
  }
  for (const [key, raw] of Object.entries(options as Record<string, unknown>)) {
    const itemPath = `${path}.${key}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      issues.push(issue("error", "INVALID_DATA_ENCODING_SERIES_OPTIONS", `${itemPath} must be an object.`, { slideId, path: itemPath, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
      continue;
    }
    const rec = raw as Record<string, unknown>;
    if (rec.type !== undefined && rec.type !== "bar" && rec.type !== "line") {
      issues.push(issue("error", "INVALID_CHART_SERIES_OPTION", `${itemPath}.type must be bar or line.`, { slideId, path: `${itemPath}.type`, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
    }
    if (rec.axis !== undefined && rec.axis !== "primary" && rec.axis !== "secondary") {
      issues.push(issue("error", "INVALID_CHART_SERIES_OPTION", `${itemPath}.axis must be primary or secondary.`, { slideId, path: `${itemPath}.axis`, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
    }
    validateTrendLineOption(rec.trendLine, `${itemPath}.trendLine`, slideId, nodeName, issues);
    validateErrorBarsOption(rec.errorBars, `${itemPath}.errorBars`, slideId, nodeName, issues);
  }
}

function validateTrendLineOption(value: unknown, path: string, slideId: string, nodeName: unknown, issues: ValidationIssue[]): void {
  if (value === undefined || value === true || value === false) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push(issue("error", "INVALID_CHART_TREND_LINE", `${path} must be boolean or {type,order?,label?}.`, { slideId, path, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
    return;
  }
  const rec = value as Record<string, unknown>;
  if (rec.type !== undefined && rec.type !== "linear" && rec.type !== "exp" && rec.type !== "log" && rec.type !== "poly") {
    issues.push(issue("error", "INVALID_CHART_TREND_LINE", `${path}.type must be linear, exp, log, or poly.`, { slideId, path: `${path}.type`, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
  }
  if (rec.order !== undefined && (typeof rec.order !== "number" || !Number.isFinite(rec.order) || rec.order < 2 || rec.order > 6)) {
    issues.push(issue("error", "INVALID_CHART_TREND_LINE", `${path}.order must be a number from 2 to 6 for polynomial trend lines.`, { slideId, path: `${path}.order`, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
  }
}

function validateErrorBarsOption(value: unknown, path: string, slideId: string, nodeName: unknown, issues: ValidationIssue[]): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push(issue("error", "INVALID_CHART_ERROR_BARS", `${path} must be {type?, value?, direction?}.`, { slideId, path, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
    return;
  }
  const rec = value as Record<string, unknown>;
  if (rec.type !== undefined && rec.type !== "fixed" && rec.type !== "percent" && rec.type !== "stdDev" && rec.type !== "stdErr") {
    issues.push(issue("error", "INVALID_CHART_ERROR_BARS", `${path}.type must be fixed, percent, stdDev, or stdErr.`, { slideId, path: `${path}.type`, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
  }
  if (rec.value !== undefined && (typeof rec.value !== "number" || !Number.isFinite(rec.value) || rec.value < 0)) {
    issues.push(issue("error", "INVALID_CHART_ERROR_BARS", `${path}.value must be a non-negative number.`, { slideId, path: `${path}.value`, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
  }
  if (rec.direction !== undefined && rec.direction !== "x" && rec.direction !== "y" && rec.direction !== "both") {
    issues.push(issue("error", "INVALID_CHART_ERROR_BARS", `${path}.direction must be x, y, or both.`, { slideId, path: `${path}.direction`, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
  }
}

function validateEncodingColumns(columns: unknown, path: string, slideId: string, nodeName: unknown, issues: ValidationIssue[]): void {
  if (columns === undefined) return;
  if (!Array.isArray(columns)) {
    issues.push(issue("error", "INVALID_DATA_ENCODING_COLUMNS", `${path} must be an array of field names or column objects.`, {
      slideId,
      path,
      nodeName: typeof nodeName === "string" ? nodeName : undefined,
      suggestedFix: "Use columns:['region','revenue'] or columns:[{key:'revenue', label:'Revenue', type:'currency', align:'right'}]. Column objects may also use field/header/title aliases.",
    }));
    return;
  }
  columns.forEach((column, index) => {
    const columnPath = `${path}[${index}]`;
    if (typeof column === "string" && column.trim()) return;
    if (!column || typeof column !== "object" || Array.isArray(column)) {
      issues.push(issue("error", "INVALID_DATA_ENCODING_COLUMNS", `${columnPath} must be a field string or {key|field,label|header?,type?,format?,align?,width?}.`, { slideId, path: columnPath, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
      return;
    }
    const rec = column as Record<string, unknown>;
    const keyLike = rec.key ?? rec.field ?? rec.name ?? rec.id ?? rec.accessor ?? rec.value;
    if (typeof keyLike !== "string" || !keyLike.trim()) {
      issues.push(issue("error", "INVALID_DATA_ENCODING_COLUMNS", `${columnPath}.key or ${columnPath}.field must be a non-empty field name.`, { slideId, path: `${columnPath}.key`, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
    }
    if (rec.type !== undefined && normalizeDataColumnTypeAlias(rec.type) === undefined) {
      issues.push(issue("error", "INVALID_DATA_ENCODING_COLUMN_TYPE", `${columnPath}.type must be one of: ${DATA_COLUMN_TYPE_VALUES.join(", ")}.`, { slideId, path: `${columnPath}.type`, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
    }
    if (rec.align !== undefined && !(typeof rec.align === "string" && (DATA_COLUMN_ALIGN_VALUES as readonly string[]).includes(rec.align))) {
      issues.push(issue("error", "INVALID_DATA_ENCODING_COLUMN_ALIGN", `${columnPath}.align must be one of: ${DATA_COLUMN_ALIGN_VALUES.join(", ")}.`, { slideId, path: `${columnPath}.align`, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
    }
    if (rec.width !== undefined && (typeof rec.width !== "number" || !Number.isFinite(rec.width) || rec.width <= 0)) {
      issues.push(issue("error", "INVALID_DATA_ENCODING_COLUMN_WIDTH", `${columnPath}.width must be a positive number.`, { slideId, path: `${columnPath}.width`, nodeName: typeof nodeName === "string" ? nodeName : undefined }));
    }
  });
}

function normalizeDataColumnTypeAlias(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if ((DATA_COLUMN_TYPE_VALUES as readonly string[]).includes(normalized)) return normalized;
  if (normalized === "int" || normalized === "integer" || normalized === "decimal" || normalized === "float" || normalized === "numeric") return "number";
  if (normalized === "percentage" || normalized === "pct") return "percent";
  if (normalized === "money") return "currency";
  if (normalized === "datetime") return "date";
  return undefined;
}

function validateThemeOverrideTopLevel(override: Record<string, unknown>, issues: ValidationIssue[]): void {
  for (const key of Object.keys(override)) {
    if (!THEME_OVERRIDE_FIELD_SET.has(key)) {
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
  const safeLayout: ThemeOverride["layout"] = {};
  for (const [key, value] of Object.entries(layout as Record<string, unknown>)) {
    const path = `deck.themeOverride.layout.${key}`;
    if (!THEME_LAYOUT_FIELD_SET.has(key)) {
      issues.push(issue("error", "UNKNOWN_THEME_LAYOUT_FIELD", `${path} is not a supported layout field, so it would not affect rendering.`, {
        path,
        suggestedFix: "Use effective layout fields: pageMarginX, titleTop, titleHeight, contentTop, contentBottom, defaultGap, columnGap, cardPadding, slideWidthCm, slideHeightCm, areas. There is no pageMarginY.",
      }));
      continue;
    }
    if (key === "areas") {
      const areas = validateThemeLayoutAreas(value, path, issues);
      if (areas) safeLayout.areas = areas;
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push(issue("error", "INVALID_THEME_LAYOUT_VALUE", `${path} must be a finite number.`, {
        path,
        suggestedFix: "Use centimeters for layout geometry, e.g. contentTop:2.6 and contentBottom:13.3 on a 16:9 deck.",
      }));
      continue;
    }
    (safeLayout as Record<string, unknown>)[key] = value;
  }
  const safeOverride = withDeckSizeLayout(deck.deck?.size, { ...override, layout: safeLayout } as ThemeOverride);
  const theme = buildTheme(deck.deck?.brand || {}, deck.deck?.theme || "default", safeOverride);
  const contentStartY = theme.layout.contentTop;
  if (theme.layout.contentBottom > theme.layout.slideHeightCm || theme.layout.contentBottom <= 0) {
    issues.push(issue("error", "THEME_LAYOUT_CONTENT_BOTTOM_OUT_OF_RANGE", `deck.themeOverride.layout.contentBottom (${theme.layout.contentBottom.toFixed(2)}cm) must be a y-coordinate inside the slide height (${theme.layout.slideHeightCm.toFixed(2)}cm).`, {
      path: "deck.themeOverride.layout.contentBottom",
      suggestedFix: `Set contentBottom to the content area's bottom y-coordinate, usually ${(theme.layout.slideHeightCm - 1.0).toFixed(2)}cm on a 16:9 deck.`,
    }));
  }
  const contentHeight = theme.layout.contentBottom - contentStartY;
  const minContentHeight = 5.0;
  if (contentHeight < minContentHeight) {
    issues.push(issue("error", "THEME_LAYOUT_CONTENT_AREA_TOO_SMALL", `deck.themeOverride.layout.contentBottom (${theme.layout.contentBottom.toFixed(2)}cm) leaves only ${contentHeight.toFixed(2)}cm of content height.`, {
      path: "deck.themeOverride.layout.contentBottom",
      suggestedFix: `contentBottom is the content area's bottom y-coordinate, not a bottom margin. Use about ${(theme.layout.slideHeightCm - 1.2).toFixed(2)}-${(theme.layout.slideHeightCm - 0.8).toFixed(2)}cm for most 16:9 decks; content height should stay at least ${minContentHeight.toFixed(1)}cm.`,
    }));
  } else {
    const recommendedContentHeight = 8.5;
    if (contentHeight < recommendedContentHeight) {
      issues.push(issue("warning", "THEME_LAYOUT_CONTENT_AREA_TIGHT", `deck.themeOverride.layout leaves only ${contentHeight.toFixed(2)}cm of effective content height; complex components may fail or become overly compact.`, {
        path: "deck.themeOverride.layout",
        suggestedFix: `For content-heavy decks, keep effective content height at least ${recommendedContentHeight.toFixed(1)}cm by lowering contentTop/titleHeight or moving contentBottom closer to the slide bottom.`,
      }));
    }
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
  const maxContentBottom = theme.layout.slideHeightCm - (footerHeightRaw + 0.2);
  if (hasFooterChrome && theme.layout.contentBottom > maxContentBottom) {
    issues.push(issue("error", "THEME_LAYOUT_FOOTER_OVERLAP", `deck.themeOverride.layout.contentBottom (${theme.layout.contentBottom.toFixed(2)}cm) enters the footer chrome zone.`, {
      path: "deck.themeOverride.layout.contentBottom",
      suggestedFix: `Set contentBottom to at most ${maxContentBottom.toFixed(2)}cm when chrome.pageNumber or footerText is enabled.`,
    }));
  }
}

function validateThemeLayoutAreas(value: unknown, path: string, issues: ValidationIssue[]): Record<string, ThemeLayoutArea> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push(issue("error", "INVALID_THEME_LAYOUT_AREAS", `${path} must be an object of named layout rectangles.`, {
      path,
      suggestedFix: "Use areas:{leftRail:{x:1.0,y:2.4,w:4,h:9}, main:{left:5.4,top:2.4,right:12.6,bottom:12.6}}.",
    }));
    return undefined;
  }
  const out: Record<string, ThemeLayoutArea> = {};
  for (const [name, rawArea] of Object.entries(value as Record<string, unknown>)) {
    const areaPath = `${path}.${name}`;
    if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(name)) {
      issues.push(issue("error", "INVALID_THEME_LAYOUT_AREA_NAME", `${areaPath} must use a stable token name.`, {
        path: areaPath,
        suggestedFix: "Use names such as main, leftRail, evidence.panel, or figure1. Avoid spaces and leading numbers.",
      }));
      continue;
    }
    if (RESERVED_LAYOUT_AREAS.has(name)) {
      issues.push(issue("error", "RESERVED_THEME_LAYOUT_AREA_NAME", `${areaPath} redefines a built-in layout area name.`, {
        path: areaPath,
        suggestedFix: `Rename this area. '${name}' is built in; use a specific name such as main, body, contentMain, or ornamentRail.`,
      }));
      continue;
    }
    if (!rawArea || typeof rawArea !== "object" || Array.isArray(rawArea)) {
      issues.push(issue("error", "INVALID_THEME_LAYOUT_AREA", `${areaPath} must be a rectangle object.`, {
        path: areaPath,
        suggestedFix: "Use {x,y,w,h} or {left,top,right,bottom}, all in centimeters.",
      }));
      continue;
    }
    const area = rawArea as Record<string, unknown>;
    const xywh = ["x", "y", "w", "h"].every((key) => isFiniteNumber(area[key]));
    const edges = ["left", "top", "right", "bottom"].every((key) => isFiniteNumber(area[key]));
    if (!xywh && !edges) {
      issues.push(issue("error", "INVALID_THEME_LAYOUT_AREA", `${areaPath} must use either {x,y,w,h} or {left,top,right,bottom}.`, {
        path: areaPath,
        suggestedFix: "Use centimeters, for example {x:1,y:2.4,w:4,h:9} or {left:5.4,top:2.4,right:12.6,bottom:12.6}.",
      }));
      continue;
    }
    if (xywh) {
      const candidate = area as { x: number; y: number; w: number; h: number };
      if (candidate.w <= 0 || candidate.h <= 0) {
        issues.push(issue("error", "INVALID_THEME_LAYOUT_AREA", `${areaPath}.w and .h must be positive.`, {
          path: areaPath,
          suggestedFix: "Give the named area a positive width and height in centimeters.",
        }));
        continue;
      }
      out[name] = { x: candidate.x, y: candidate.y, w: candidate.w, h: candidate.h };
      continue;
    }
    const candidate = area as { left: number; top: number; right: number; bottom: number };
    if (candidate.right <= candidate.left || candidate.bottom <= candidate.top) {
      issues.push(issue("error", "INVALID_THEME_LAYOUT_AREA", `${areaPath}.right/bottom must be greater than left/top.`, {
        path: areaPath,
        suggestedFix: "Use a non-empty rectangle, e.g. {left:1,top:2,right:6,bottom:12}.",
      }));
      continue;
    }
    out[name] = { left: candidate.left, top: candidate.top, right: candidate.right, bottom: candidate.bottom };
  }
  return out;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateThemeComponentStyles(override: Record<string, unknown>, issues: ValidationIssue[]): void {
  const component = override.component;
  if (!component || typeof component !== "object" || Array.isArray(component)) return;
  for (const [componentName, rawStyle] of Object.entries(component as Record<string, unknown>)) {
    if (!rawStyle || typeof rawStyle !== "object" || Array.isArray(rawStyle)) continue;
    const style = rawStyle as Record<string, unknown>;
    for (const key of Object.keys(style)) {
      if (!THEME_COMPONENT_STYLE_FIELD_SET.has(key)) {
        const path = `deck.themeOverride.component.${componentName}.${key}`;
        issues.push(issue("error", "UNKNOWN_THEME_COMPONENT_FIELD", `${path} is not a supported component style field, so it would be ignored.`, {
          path,
          suggestedFix: key === "radius"
            ? "Rename radius to cornerRadius. cornerRadius is a normalized 0..0.5 roundRect fraction, not px/cm."
            : "Use supported component style fields: fill, fillOpacity, line, lineOpacity, lineWidth, lineDash, borderColor, borderWidth, borderStyle, padding, cornerRadius, elevation, shadow, gradient, accent, accentColor, or accentWidth.",
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
    if (!THEME_FONT_FIELD_SET.has(key)) {
      issues.push(issue("error", "UNKNOWN_THEME_FONT_FIELD", `${path} is not a supported font field, so it would be ignored.`, {
        path,
        suggestedFix: "Use fonts.latin, fonts.cjk, and fonts.mono.",
      }));
      continue;
    }
    if (key === "mono") {
      validateFontChain(value, path, issues);
      continue;
    }
    if (typeof value === "string" || Array.isArray(value)) {
      validateFontChain(value, path, issues);
      continue;
    }
    if (!value || typeof value !== "object") {
      issues.push(issue("error", "INVALID_THEME_FONT_VALUE", `${path} must be a font face string, string array, or {display?, text?}.`, {
        path,
        suggestedFix: "Use e.g. fonts.latin:{display:['Helvetica Neue'], text:['Arial']} or fonts.cjk:{display:'Microsoft YaHei', text:'Microsoft YaHei'}.",
      }));
      continue;
    }
    for (const [role, chain] of Object.entries(value as Record<string, unknown>)) {
      const rolePath = `${path}.${role}`;
      if (!THEME_SCRIPT_FONT_FIELD_SET.has(role)) {
        issues.push(issue("error", "UNKNOWN_THEME_FONT_ROLE", `${rolePath} is not a supported font role, so it would be ignored.`, {
          path: rolePath,
          suggestedFix: "Use display and/or text.",
        }));
        continue;
      }
      validateFontChain(chain, rolePath, issues);
    }
  }
}

function validateFontChain(value: unknown, path: string, issues: ValidationIssue[]): void {
  const ok = (typeof value === "string" && value.trim().length > 0)
    || (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim().length > 0));
  if (!ok) {
    issues.push(issue("error", "INVALID_THEME_FONT_VALUE", `${path} must be a non-empty font face string or string array.`, {
      path,
      suggestedFix: "Use installed font face names, e.g. 'Arial' or ['Arial','Helvetica Neue']. SlideML2 emits the first face into PPTX and does not embed fonts.",
    }));
  }
}

function validateThemeChrome(override: Record<string, unknown>, issues: ValidationIssue[]): void {
  const chrome = override.chrome;
  if (!chrome || typeof chrome !== "object" || Array.isArray(chrome)) return;
  for (const [key, value] of Object.entries(chrome as Record<string, unknown>)) {
    const path = `deck.themeOverride.chrome.${key}`;
    if (!THEME_CHROME_FIELD_SET.has(key)) {
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
    if (typeof value === "string") {
      validateThemeColorString(value, path, issues);
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      hasNested = true;
      // Drill once to check leaves are strings — diagnose anything else.
      for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
        if (typeof subValue === "string") {
          validateThemeColorString(subValue, `${path}.${subKey}`, issues);
          continue;
        }
        if (subValue && typeof subValue === "object" && !Array.isArray(subValue)) continue;
        issues.push(issue("error", "INVALID_COLOR_VALUE", `${path}.${subKey} must be a hex string or theme token, got ${typeof subValue}.`, {
          path: `${path}.${subKey}`,
          suggestedFix: "Use a 6-char hex (with or without '#'), a CSS rgb()/rgba()/hsl()/hsla() color, or a theme token like 'brand.primary'. For translucency, rgba() is accepted for fill tokens and alpha is preserved when used by fills.",
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

function validateThemeColorString(value: string, path: string, issues: ValidationIssue[]): void {
  const trimmed = value.trim();
  if (!trimmed) {
    issues.push(issue("error", "INVALID_COLOR_VALUE", `${path} must not be empty.`, {
      path,
      suggestedFix: "Use a 6-char hex, CSS rgb()/rgba()/hsl()/hsla(), or a theme token.",
    }));
    return;
  }
  if (/^(rgba?|hsla?)\s*\(/i.test(trimmed) && !parseCssColor(trimmed)) {
    issues.push(issue("error", "INVALID_COLOR_VALUE", `${path} has an invalid CSS color function.`, {
      path,
      suggestedFix: "Use valid rgb(r,g,b), rgba(r,g,b,a), hsl(h,s%,l%), or hsla(h,s%,l%,a).",
    }));
  }
}

function validateFreeformGroupIntent(node: DomNode, path: string, slideId: string, issues: ValidationIssue[]): void {
  const children = Array.isArray(node.children) ? node.children as DomNode[] : [];
  if (children.length === 0) return;
  const backgroundLike = children.filter(isLikelyFreeformBackgroundChild);
  if (backgroundLike.length === 0) return;
  const allBackgroundLike = backgroundLike.length === children.length;
  if (allBackgroundLike && node.mode !== "background") {
    issues.push(issue("warning", "FREEFORM_BACKGROUND_MODE_INFERRED", `${path} looks like a background layer but does not set mode:"background".`, {
      slideId,
      path,
      nodeName: node.id,
      suggestedFix: "Set mode:'background' on freeform-group, or set each background/scrim child to area:'full' or fillSlide:true with explicit zIndex. The renderer infers this for all-background groups, but explicit mode is clearer and more portable.",
    }));
  }
  backgroundLike.forEach((child, index) => {
    if (node.mode === "background" || allBackgroundLike) return;
    if (hasExplicitBackgroundPlacement(child)) return;
    issues.push(issue("warning", "FREEFORM_BACKGROUND_CHILD_NEEDS_SIZE", `${path}.children[${index}] looks like a background/scrim layer but has no full-slide placement.`, {
      slideId,
      path: `${path}.children[${index}]`,
      nodeName: child.id,
      suggestedFix: "For a full-slide background layer, set the parent freeform-group mode:'background', or set this child to fillSlide:true / area:'full' / at:[0,0,slideW,slideH] / {x,y,w,h}. Otherwise it will use the small anchored default size.",
    }));
  });
}

function isLikelyFreeformBackgroundChild(child: DomNode): boolean {
  if (!child || typeof child !== "object") return false;
  const id = typeof child.id === "string" ? child.id.toLowerCase() : "";
  const type = typeof child.type === "string" ? child.type : "";
  if (child.layer === "behind" || (typeof child.zIndex === "number" && child.zIndex < 0) || child.fillSlide === true || child.area === "full") return true;
  if (type === "image" && /(^|[.:-])(bg|background|hero|cover)([.:-]|$)/.test(id)) return true;
  if (type === "shape" && /(^|[.:-])(scrim|overlay|backdrop|veil|shade)([.:-]|$)/.test(id)) return true;
  return false;
}

function hasExplicitBackgroundPlacement(child: DomNode): boolean {
  if (child.fillSlide === true || child.area === "full") return true;
  if (rectFromAbsoluteRectSpec(child.at) || rectFromNodePlacement(child)) return true;
  if (typeof child.anchor === "string" && (typeof child.width === "number" || typeof child.height === "number")) return true;
  return false;
}

type ComponentFieldTypeError = { expected: string; actual: string; suggestedFix?: string };

function componentFieldTypeError(componentName: string, propName: string, prop: PropDefinition, value: unknown): ComponentFieldTypeError | null {
  if (value === undefined || value === null || value === "") return null;
  if (prop.type === "enum") return null;
  if (propName === "scale" && typeof value === "string" && ["xs", "sm", "small", "md"].includes(value.trim().toLowerCase())) return null;
  switch (prop.type) {
    case "string":
    case "image-ref":
    case "color-ref":
      return typeof value === "string" ? null : { expected: "a string", actual: describeValueType(value) };
    case "number":
      return (typeof value === "number" && Number.isFinite(value)) || isNumericString(value) ? null : { expected: "a finite number", actual: describeValueType(value) };
    case "boolean":
      return typeof value === "boolean" ? null : { expected: "a boolean", actual: describeValueType(value) };
    case "array":
      if (componentName === "two-column" && propName === "ratio" && typeof value === "number" && Number.isFinite(value) && value > 0) return null;
      return Array.isArray(value) ? null : {
        expected: "an array",
        actual: describeValueType(value),
        suggestedFix: componentName === "chart-with-rail" && propName === "ratio"
          ? "Use ratio:[0.72,0.28] for rail-right/rail-left or ratio:[0.68,0.32] for stacked. A scalar ratio is ignored by the renderer."
          : undefined,
      };
    case "object":
      return value && typeof value === "object" && !Array.isArray(value) ? null : { expected: "an object", actual: describeValueType(value) };
    case "table":
    case "chart":
      return null;
  }
}

function validateComponentNode(node: DomNode, path: string, slideId: string, issues: ValidationIssue[], options: EffectiveValidationOptions): void {
  const name = getComponentName(node) || node.component;
  if (!isComponentName(name)) {
    issues.push(issue(options.allowUnknownComponents ? "warning" : "error", "UNKNOWN_COMPONENT", `${path} component "${String(name)}" is not registered.`, {
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
  if (name === "freeform-group") validateFreeformGroupIntent(node, path, slideId, issues);
  if (name === "matrix-2x2") {
    const itemsArr = Array.isArray(node.items) ? node.items : [];
    const ql = node.quadrantLabels && typeof node.quadrantLabels === "object" ? node.quadrantLabels as Record<string, unknown> : null;
    const hasQuadrantLabels = ql ? ["tl", "tr", "bl", "br"].some((key) => typeof ql[key] === "string" && String(ql[key]).trim() !== "") : false;
    if (itemsArr.length === 0 && !hasQuadrantLabels) {
      issues.push(issue("error", "MISSING_REQUIRED_FIELD", "matrix-2x2 requires items or quadrantLabels.", {
        slideId,
        path,
        nodeName: node.id,
        suggestedFix: "Either pass items[] (one entry per data point with x/y enum) or quadrantLabels {tl,tr,bl,br} for a label-only matrix.",
      }));
    }
  }
  if (name === "numbered-list" && Array.isArray(node.items)) {
    node.items.forEach((raw, index) => {
      if (typeof raw === "string") return;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        issues.push(issue("error", "INVALID_FIELD_USAGE", `numbered-list.items[${index}] must be a string or an object with title/text/body fields.`, {
          slideId,
          path: `${path}.items[${index}]`,
          nodeName: node.id,
          suggestedFix: "Use a plain string, or {title:'...', body:'...'} for a structured numbered item.",
        }));
        return;
      }
      const rec = raw as Record<string, unknown>;
      const hasText = ["title", "headline", "label", "name", "text", "body", "detail", "description"].some((key) => typeof rec[key] === "string" && String(rec[key]).trim() !== "");
      if (!hasText) {
        issues.push(issue("error", "INVALID_FIELD_USAGE", `numbered-list.items[${index}] has no renderable title/text/body field.`, {
          slideId,
          path: `${path}.items[${index}]`,
          nodeName: node.id,
          suggestedFix: "Add title/text/body/detail, or replace the item with a string.",
        }));
      }
    });
  }
  for (const [propName, prop] of Object.entries(definition.fields)) {
    if (prop.required) {
      const required = checkRequiredComponentField(String(name), propName, prop, node);
      if (!required.ok) {
        const wrongType = required.reason === "wrong-type";
        issues.push(issue("error", wrongType ? "INVALID_FIELD_USAGE" : "MISSING_REQUIRED_FIELD", wrongType
          ? `${definition.name}.${propName} must be ${required.expected}; got ${required.actual}.`
          : `${definition.name} requires ${propName}.`, {
          slideId,
          path: required.path ? `${path}.${required.path}` : path,
          nodeName: node.id,
          suggestedFix: wrongType
            ? `Keep ${definition.name} semantics and provide ${propName} as ${required.expected}.`
            : `Keep ${definition.name} semantics and provide ${propName}.`,
        }));
      }
    }
    const value = node[propName];
    const typeError = componentFieldTypeError(definition.name, propName, prop, value);
    if (typeError) {
      issues.push(issue("error", "INVALID_FIELD_USAGE", `${definition.name}.${propName} must be ${typeError.expected}; got ${typeError.actual}.`, {
        slideId,
        path: `${path}.${propName}`,
        nodeName: node.id,
        suggestedFix: typeError.suggestedFix || `Keep ${definition.name} semantics and provide ${propName} as ${typeError.expected}.`,
      }));
    }
    if (prop.type === "enum" && value !== undefined && value !== null && value !== "" && prop.enum?.length) {
      const normalized = normalizeComponentEnumValue(definition.name, propName, value);
      const accepted = typeof value === "string" && prop.enum.includes(value)
        || Boolean(normalized && prop.enum.includes(normalized));
      if (!accepted) {
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
        const rec = content as DomNode;
        validateNode({
          ...rec,
          id: typeof rec.id === "string" && rec.id ? rec.id : `${slideId}.${node.id || "timeline"}.${i + 1}.content`,
        } as DomNode, `${path}.items[${i}].content`, slideId, issues, node, options);
      }
    }
  }
  if (name === "two-column") {
    for (const side of ["left", "right"] as const) {
      const content = (node as Record<string, unknown>)[side];
      if (content && typeof content === "object" && !Array.isArray(content)) {
        validateComponentSlotNode(node, side, path, slideId, issues, options);
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
      validateComponentSlotNode(node, key, path, slideId, issues, options);
    }
    if (Array.isArray(node.annotations)) {
      node.annotations.forEach((content, index) => {
        if (content && typeof content === "object" && !Array.isArray(content)) {
          validateNode(withSyntheticNodeIds(content as DomNode, componentSlotFallbackId(slideId, node, path, `annotations.${index + 1}`)), `${path}.annotations[${index}]`, slideId, issues, node, options);
        }
      });
    }
  }
  if (name === "hero-and-support") {
    validateComponentSlotNode(node, "hero", path, slideId, issues, options);
    validateDomNodeArrayField(node, "supports", `${path}.supports`, slideId, issues, options);
    validateDomNodeArrayField(node, "items", `${path}.items`, slideId, issues, options);
  }
  if (name === "chart-with-rail") {
    for (const key of ["evidence", "rail"] as const) {
      validateComponentSlotNode(node, key, path, slideId, issues, options);
    }
  }
  if (options.requireSources && (name === "chart-card" || name === "table-card") && !hasSourceMetadata(node)) {
    issues.push(issue("error", "MISSING_DATA_SOURCE", `${definition.name} requires source metadata by deck.validation.requireSources/strict mode.`, {
      slideId,
      path,
      nodeName: node.id,
      suggestedFix: "Add source:'...' or caption:'Source: ...' to make the chart/table evidence traceable.",
    }));
  }
}

function validateDomNodeArrayField(node: DomNode, fieldName: string, path: string, slideId: string, issues: ValidationIssue[], options: EffectiveValidationOptions): void {
  const value = (node as Record<string, unknown>)[fieldName];
  if (!Array.isArray(value)) return;
  value.forEach((content, index) => {
    if (content && typeof content === "object" && !Array.isArray(content) && typeof (content as Record<string, unknown>).type === "string") {
      validateNode(withSyntheticNodeIds(content as DomNode, componentSlotFallbackId(slideId, node, path, `${fieldName}.${index + 1}`)), `${path}[${index}]`, slideId, issues, node, options);
    }
  });
}

const REQUIRED_FIELD_ALIASES: Record<string, Record<string, string[]>> = {
  "kpi-grid": { metrics: ["items"] },
  "process-flow": { steps: ["items"] },
  "logo-strip": { logos: ["items", "images"] },
  "chart-card": {
    chartType: ["chart"],
    labels: ["data.labels", "bind"],
    series: ["data.series", "bind"],
  },
  "table-card": { rows: ["data.rows", "items", "bind"] },
  "metric-card": { value: ["bind"], label: ["bind"] },
  "hero-stat": { value: ["bind"], label: ["bind"] },
  "stat-strip": { items: ["bind"] },
  "key-takeaway": { headline: ["title"] },
  "insight-card": { headline: ["title"] },
  "hero-and-support": { supports: ["items"] },
  "snapshot-callouts": { callouts: ["items"] },
  "probe-flow": { steps: ["items"] },
};

type RequiredFieldCheck =
  | { ok: true }
  | { ok: false; reason: "missing"; path?: string }
  | { ok: false; reason: "wrong-type"; path: string; expected: string; actual: string };

function checkRequiredComponentField(componentName: string, propName: string, prop: PropDefinition, node: DomNode): RequiredFieldCheck {
  const aliases = REQUIRED_FIELD_ALIASES[componentName]?.[propName] || [];
  const candidates = [{ path: propName, value: node[propName] }, ...aliases.map((path) => ({ path, value: valueAtPath(node, path) }))];
  let firstPresent: { path: string; value: unknown } | undefined;
  for (const candidate of candidates) {
    if (!candidateHasRequiredValue(candidate.value)) continue;
    firstPresent ??= candidate;
    if (candidate.path === "bind" && dataBindingSatisfiesRequired(componentName, propName, candidate.value)) return { ok: true };
    if (requiredValueMatchesType(candidate.value, prop)) return { ok: true };
  }
  if (firstPresent) {
    return {
      ok: false,
      reason: "wrong-type",
      path: firstPresent.path,
      expected: requiredTypeDescription(prop),
      actual: describeValueType(firstPresent.value),
    };
  }
  return { ok: false, reason: "missing" };
}

function dataBindingSatisfiesRequired(componentName: string, propName: string, value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (typeof (value as Record<string, unknown>).source !== "string" || !String((value as Record<string, unknown>).source).trim()) return false;
  const boundRequiredFields: Record<string, Set<string>> = {
    "chart-card": new Set(["labels", "series"]),
    "table-card": new Set(["rows"]),
    "metric-card": new Set(["value", "label"]),
    "hero-stat": new Set(["value", "label"]),
    "stat-strip": new Set(["items"]),
  };
  return boundRequiredFields[componentName]?.has(propName) === true;
}

function candidateHasRequiredValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

function requiredValueMatchesType(value: unknown, prop: PropDefinition): boolean {
  switch (prop.type) {
    case "array":
      return Array.isArray(value) && value.length > 0;
    case "object":
      return Boolean(value && typeof value === "object" && !Array.isArray(value));
    case "number":
      return (typeof value === "number" && Number.isFinite(value)) || isNumericString(value);
    case "boolean":
      return typeof value === "boolean";
    default:
      return candidateHasRequiredValue(value);
  }
}

function requiredTypeDescription(prop: PropDefinition): string {
  if (prop.type === "array") return "a non-empty array";
  if (prop.type === "object") return "an object";
  if (prop.type === "number") return "a finite number";
  if (prop.type === "boolean") return "a boolean";
  return `a non-empty ${prop.type}`;
}

function describeValueType(value: unknown): string {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value === null) return "null";
  return typeof value;
}

function isNumericString(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().replace(/,/g, "");
  if (!normalized) return false;
  const raw = normalized.endsWith("%") ? normalized.slice(0, -1) : normalized;
  return raw.trim() !== "" && Number.isFinite(Number.parseFloat(raw));
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function findBodyHeroTitle(nodes: DomNode[]): { found: boolean; titles: string[] } {
  const titles: string[] = [];
  let found = false;
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const componentName = node.type === "component" && typeof node.component === "string" ? node.component : node.type;
    if (componentName === "section-break" || componentName === "title-lockup" || componentName === "cover-composition") {
      found = true;
      if (typeof node.title === "string" && node.title.trim()) titles.push(node.title);
    } else if (node.type === "deck-title" || node.type === "slide-title") {
      found = true;
      if (typeof node.text === "string" && node.text.trim()) titles.push(node.text);
    } else if (node.type === "text" && (node.style === "deck-title" || node.style === "slide-title" || node.style === "section-title")) {
      found = true;
      if (typeof node.text === "string" && node.text.trim()) titles.push(node.text);
    }
    const inner = (node.children as DomNode[] | undefined) || [];
    if (inner.length) {
      const nested = findBodyHeroTitle(inner);
      found = found || nested.found;
      titles.push(...nested.titles);
    }
  }
  return { found, titles };
}

function bodyHeroTitleMatchesSlideTitle(slideTitle: string, bodyTitles: string[]): boolean {
  const normalizedSlideTitle = normalizeHeroTitle(slideTitle);
  return bodyTitles.length > 0 && bodyTitles.every((title) => normalizeHeroTitle(title) === normalizedSlideTitle);
}

function normalizeHeroTitle(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Detects when a `text` node's content is shaped like a bullet/numbered list.
 * Specifically catches:
 *   • / · / ★ / ▶ / – / - markers followed by a line break and another marker
 *   1./2./3. or 一、二、 numeric prefixes on ≥2 separate lines
 *   3+ runs separated by ；/; (Chinese semicolons used as in-line list separator)
 * Plain prose with one stray newline does NOT trigger.
 */
export function looksLikeBulletList(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const bulletRe = /^[•·★▶▪◆\-–]\s+\S/;
    const numericRe = /^(?:\d+[.、)）]|[一二三四五六七八九十][、.])\s*\S/;
    const bulletCount = lines.filter((line) => bulletRe.test(line)).length;
    const numericCount = lines.filter((line) => numericRe.test(line)).length;
    if (bulletCount >= 2 || numericCount >= 2) return true;
  }
  // Inline numbered runs without newlines, e.g. "1. A 2. B 3. C".
  const inlineNumeric = text.match(/(?:^|\s)\d+[.、)）]\s+\S/g);
  if (inlineNumeric && inlineNumeric.length >= 3) return true;
  // Inline semicolon-separated runs, e.g. "私有化中台；跨平台中间件；开源出海"
  const semiParts = text.split(/[；;]\s*/).filter((part) => part.trim().length > 1);
  if (semiParts.length >= 3) return true;
  return false;
}

export function looksLikeMultilineList(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 3) return false;
  const avgLen = lines.reduce((sum, line) => sum + line.length, 0) / lines.length;
  const listLikePunctuation = lines.filter((line) => /[：:—–-]|[★⭐✗✓]|\s[/$¥$]?\d/.test(line)).length;
  return avgLen >= 8 && listLikePunctuation >= Math.max(2, Math.ceil(lines.length * 0.4));
}

function isCodeOrQuoteStyle(style: unknown): boolean {
  if (typeof style !== "string") return false;
  return style === "code" || style === "quote" || style === "monospace" || style === "preformatted";
}

function hasArticleText(node: DomNode): boolean {
  if (typeof node.text === "string" && node.text.trim()) return true;
  return Array.isArray(node.paragraphs) && node.paragraphs.some((item) => typeof item === "string" && item.trim());
}

function validateLayout(deck: RenderedDeck, issues: ValidationIssue[]): void {
  const theme = buildTheme(deck.deck.brand, deck.deck.theme, withDeckSizeLayout(deck.deck.size, deck.deck.themeOverride));
  const measuredSlides = measureDeck(deck);
  for (const [index, slide] of measuredSlides.entries()) {
    const renderedSlide = deck.slides[index];
    const domById = renderedSlide ? collectDomNodesById(renderedSlide.dom) : new Map<string, DomNode>();
    if (renderedSlide) validateTopLevelPlacementOverlaps(renderedSlide, slide, issues);
    for (const node of slide.nodes) {
      if (node.rect.x < -0.01 || node.rect.y < -0.01 || node.rect.x + node.rect.w > theme.layout.slideWidthCm + 0.01 || node.rect.y + node.rect.h > theme.layout.slideHeightCm + 0.01) {
        issues.push(issue("error", SOURCE_VALIDATION_CODE.NODE_OUT_OF_BOUNDS, `${node.id} is outside the slide bounds.`, { slideId: slide.slideId, nodeName: node.id, details: { rect: node.rect }, suggestedFix: "Keep the slide semantics but use wider margins, fewer regions, or split dense content into another slide." }));
      }
      if ((node.type === "text" || node.type === "bullets") && node.rect.h < 0.25) {
        issues.push(issue("warning", SOURCE_VALIDATION_CODE.TEXT_BOX_TOO_SHORT, `${node.id} has very little vertical space.`, { slideId: slide.slideId, nodeName: node.id, details: { rect: node.rect }, suggestedFix: "Increase parent grid/stack height or reduce sibling count." }));
      }
      const domNode = domById.get(node.id);
      if (domNode && isLikelyPartialHeightBackgroundImage(domNode, node.rect, theme.layout.slideWidthCm, theme.layout.slideHeightCm)) {
        issues.push(issue("warning", SOURCE_VALIDATION_CODE.BACKGROUND_IMAGE_PARTIAL_HEIGHT, `${node.id} starts at the slide top and looks like a background/rail image, but its height (${node.rect.h.toFixed(2)}cm) does not reach the slide height (${theme.layout.slideHeightCm.toFixed(2)}cm).`, {
          slideId: slide.slideId,
          nodeName: node.id,
          details: { rect: node.rect, slideHeightCm: theme.layout.slideHeightCm },
          suggestedFix: `If this image is meant to run to the bottom edge, set its height to ${theme.layout.slideHeightCm.toFixed(2)}cm (for example at:[0,0,w,${theme.layout.slideHeightCm.toFixed(2)}]) or use slide.background for full-bleed imagery. If it is a content image, inset it from the slide edge and avoid layer:'behind'.`,
        }));
      }
    }
  }
}

function collectDomNodesById(root: DomNode): Map<string, DomNode> {
  const map = new Map<string, DomNode>();
  const visit = (node: DomNode): void => {
    if (typeof node.id === "string" && node.id) map.set(node.id, node);
    for (const child of node.children || []) visit(child);
  };
  visit(root);
  return map;
}

function isLikelyPartialHeightBackgroundImage(node: DomNode, rect: { x: number; y: number; w: number; h: number }, slideWidthCm: number, slideHeightCm: number): boolean {
  if (node.type !== "image") return false;
  const rec = node as Record<string, unknown>;
  const topAligned = Math.abs(rect.y) <= 0.03;
  if (!topAligned) return false;
  const nearlyFullHeight = rect.h >= slideHeightCm * 0.72;
  const leavesVisibleBottomGap = rect.h < slideHeightCm - 0.25;
  if (!nearlyFullHeight || !leavesVisibleBottomGap) return false;
  const touchesLeftOrRightEdge = Math.abs(rect.x) <= 0.03 || rect.x + rect.w >= slideWidthCm - 0.03;
  const looksLikeBackground = rec.layer === "behind" || typeof node.id === "string" && /(^|[.:-])(bg|background|hero|cover|rail)([.:-]|$)/i.test(node.id);
  return touchesLeftOrRightEdge && looksLikeBackground;
}

function validateTopLevelPlacementOverlaps(
  renderedSlide: RenderedSlide,
  measuredSlide: ReturnType<typeof measureDeck>[number],
  issues: ValidationIssue[],
): void {
  const children = renderedSlide.dom.children || [];
  const rectById = new Map(measuredSlide.nodes.map((node) => [node.id, node.visualRect || node.inkRect || node.rect]));
  const regionItems = children
    .filter((child) => isTopLevelRegionChild(child))
    .map((child) => ({ id: child.id, rect: rectById.get(child.id) }))
    .filter((item): item is { id: string; rect: { x: number; y: number; w: number; h: number } } => Boolean(item.rect));
  const positionedItems = [
    ...children
      .filter((child) => isSignificantPositionedChild(child))
      .map((child) => ({ id: child.id, rect: rectById.get(child.id) })),
    ...topLevelExpandedOverlayItems(children, measuredSlide.nodes),
  ].filter((item): item is { id: string; rect: { x: number; y: number; w: number; h: number } } => Boolean(item.rect));
  const emitted = new Set<string>();
  for (const positioned of positionedItems) {
    const positionedRect = positioned.rect;
    for (const region of regionItems) {
      if (region.id === positioned.id) continue;
      const regionRect = region.rect;
      if (!regionRect) continue;
      const overlap = meaningfulSourceOverlap(positionedRect, regionRect);
      if (!overlap) continue;
      const overlapRatio = overlap.ratioOfA;
      const key = `${positioned.id}|${region.id}`;
      if (emitted.has(key)) continue;
      emitted.add(key);
      issues.push(issue("error", SOURCE_VALIDATION_CODE.TOP_LEVEL_LAYOUT_OVERLAP, `Top-level positioned node ${positioned.id} overlaps region node ${region.id}.`, {
        slideId: measuredSlide.slideId,
        nodeName: positioned.id,
        details: { positionedRect, regionRect, overlap: overlap.rect, overlapRatio, overlapAreaCm2: overlap.areaCm2 },
        suggestedFix: "Do not place at/anchor/anchorTo hero content over area:'content' or a named area. Move the region, put the items inside one stack/grid/split, or mark truly decorative layers as behind/negative zIndex.",
      }));
    }
  }
}

function topLevelExpandedOverlayItems(
  children: DomNode[],
  measuredNodes: ReturnType<typeof measureDeck>[number]["nodes"],
): Array<{ id: string; rect?: { x: number; y: number; w: number; h: number } }> {
  const directIds = new Set(children.map((child) => child.id).filter((id): id is string => typeof id === "string" && Boolean(id)));
  const items: Array<{ id: string; rect?: { x: number; y: number; w: number; h: number } }> = [];
  for (const child of children) {
    if (child.type === "freeform-group") continue;
    if (!child.id || directIds.has(`${child.id}.root`) || isTopLevelRegionChild(child) || isSignificantPositionedChild(child)) continue;
    const prefix = `${child.id}.`;
    for (const node of measuredNodes) {
      if (!node.id.startsWith(prefix)) continue;
      const suffix = node.id.slice(prefix.length);
      if (!suffix || suffix.includes(".")) continue;
      const rect = node.visualRect || node.inkRect || node.rect;
      if (!isSignificantMeasuredOverlayNode(node.id, node.type, rect)) continue;
      items.push({ id: node.id, rect });
    }
  }
  return items.filter((item) => !items.some((other) =>
    other.id !== item.id
    && other.rect
    && item.rect
    && rectContains(other.rect, item.rect)
    && other.rect.w * other.rect.h > item.rect.w * item.rect.h * 1.15,
  )).filter((item) => !isDecorativeMeasuredOverlayItem(item.id, measuredNodes.find((node) => node.id === item.id)?.type || "", item.rect));
}

function isSignificantMeasuredOverlayNode(id: string, type: string, rect: { w: number; h: number }): boolean {
  if (type === "shape" && rect.h <= 0.08) return false;
  return rect.w >= 0.5 && rect.h >= 0.18;
}

function isDecorativeMeasuredOverlayItem(id: string, type: string, rect?: { w: number; h: number }): boolean {
  const pseudoNode = { id, type } as DomNode;
  if (isDecorativeTopLevelPositionedChild(pseudoNode)) return true;
  return Boolean(rect && isDecorativeExpandedOverlayNode(id, type, rect));
}

function isTopLevelRegionChild(node: DomNode): boolean {
  return typeof node.area === "string" && node.area.trim().length > 0 && !hasSlideLevelPlacementOverride(node);
}

function isSignificantPositionedChild(node: DomNode): boolean {
  const rec = node as Record<string, unknown>;
  if (node.layer === "behind" || node.layer === "above") return false;
  if (typeof rec.zIndex === "number" && Number.isFinite(rec.zIndex) && rec.zIndex < 0) return false;
  if (isDecorativeTopLevelPositionedChild(node)) return false;
  const absoluteRect = rectFromNodePlacement(node);
  if (absoluteRect) {
    if (node.type === "shape" && absoluteRect.h <= 0.08) return false;
    return true;
  }
  if (typeof rec.anchor === "string" && rec.anchor.trim()) return true;
  if (typeof rec.anchorTo === "string" && rec.anchorTo.trim()) return true;
  return false;
}

function isDecorativeTopLevelPositionedChild(node: DomNode): boolean {
  if (node.type === "decoration-grid" || node.type === "decorative-shapes" || node.type === "watermark" || node.type === "pointer-arrow") return true;
  const id = typeof node.id === "string" ? node.id.toLowerCase() : "";
  if (id.includes(".decor") || id.includes("decoration") || id.includes("watermark") || id.includes("brand-mark") || id.endsWith(".scrim") || id.endsWith(".backdrop")) return true;
  return false;
}

function isDecorativeExpandedOverlayNode(id: string, type: string, rect: { w: number; h: number }): boolean {
  const lower = id.toLowerCase();
  if (type !== "image" && type !== "shape") return false;
  if (lower.endsWith(".scrim") || lower.endsWith(".backdrop")) return true;
  // cover-composition and similar full-bleed components expand their background
  // image as a sibling of the content region. A large `.visual` child is the
  // background layer, not a placed evidence object that should collide with
  // area:'content'.
  return lower.endsWith(".visual") && rect.w >= 10 && rect.h >= 6 && rect.w * rect.h >= 80;
}

function withDeckSizeLayout(sizeValue: unknown, override?: ThemeOverride): ThemeOverride | undefined {
  if (!isDeckSize(sizeValue)) return override;
  const dims = SLIDE_SIZES[sizeValue];
  return {
    ...(override || {}),
    layout: {
      ...(override?.layout || {}),
      slideWidthCm: override?.layout?.slideWidthCm ?? emuToCm(dims.width),
      slideHeightCm: override?.layout?.slideHeightCm ?? emuToCm(dims.height),
    },
  };
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
    const key = JSON.stringify([item.level, item.code, item.slideId, item.path, item.nodeName, item.message]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
