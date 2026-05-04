import {
  arrowLink, badge, barList, bigPageNumber, bracket, bulletList, calloutMarker, checklist,
  comparisonCard, comparisonTable, cornerMark, ctaButton, decorationGrid, donutSummary,
  featureCard, flowArrow, funnel, gauge, glossary, heatmap, heroStat, iconText, insightCallout,
  keyTakeaway, kpiGrid, legend, logoStrip, matrix2x2, metricCard, numberedGrid, numberedList,
  outline, pricingCard, processFlow, profileCard, prosCons, progressBar, qAndA, quizCard,
  quoteBlock, rangePlot, scaleBar, scorecard, sectionBreak, statComparison, statFlow, statStrip,
  stepCard, swotMatrix, tagList, takeawayList, timelineAxisBar, timelineBlock, trendLine,
  watermark,
} from "./components.js";
import { listNodeTypes } from "./node-types.js";
import type { DomNode, NodeType } from "./types.js";

export type ComponentName =
  | "deck-title"
  | "slide-title"
  | "h1"
  | "h2"
  | "lead"
  | "text"
  | "article"
  | "source-note"
  | "label"
  | "code"
  | "metric-card"
  | "callout"
  | "comparison-card"
  | "step-card"
  | "definition-card"
  | "numbered-list"
  | "quote"
  | "icon-text"
  | "timeline"
  | "profile-card"
  | "kpi-grid"
  | "section-break"
  | "swot-matrix"
  | "cta"
  | "feature-card"
  | "checklist"
  | "progress-bar"
  | "pros-cons"
  | "process-flow"
  | "logo-strip"
  | "pricing-card"
  | "stat-comparison"
  | "hero-stat"
  | "bar-list"
  | "tag-list"
  | "key-takeaway"
  | "numbered-grid"
  | "stat-strip"
  | "legend"
  | "badge"
  | "title-lockup"
  | "eyebrow"
  | "accent-rule"
  | "annotation"
  | "side-rail"
  | "axis-ruler"
  | "flow-arrow"
  | "image-card"
  | "chart-card"
  | "table-card"
  | "insight-card"
  | "quiz-card"
  | "q-and-a"
  | "takeaway-list"
  | "outline"
  | "glossary"
  | "comparison-table"
  // Data-expression components
  | "scorecard"
  | "funnel"
  | "gauge"
  | "heatmap"
  | "matrix-2x2"
  | "trend-line"
  | "stat-flow"
  | "donut-summary"
  | "range-plot"
  // Decoration components
  | "callout-marker"
  | "decoration-grid"
  | "corner-mark"
  | "bracket"
  | "arrow-link"
  | "watermark"
  | "big-page-number"
  | "timeline-axis-bar"
  | "scale-bar"
  | "two-column";

export interface PropDefinition {
  type: "string" | "number" | "boolean" | "enum" | "array" | "object" | "image-ref" | "table" | "chart";
  required?: boolean;
  semantic?: string;
  enum?: string[];
  values?: string[];
  description: string;
  max?: number;
  min?: number;
}

export interface ComponentDefinition {
  name: ComponentName;
  category: "content" | "collection" | "chrome";
  purpose: string;
  fields: Record<string, PropDefinition>;
  children: { allowed: boolean };
  layoutBehavior: {
    intrinsicSize: "text" | "card" | "media" | "collection" | "fill";
    canGrow: boolean;
    preferredParent?: "stack" | "grid";
  };
  renderBehavior: {
    expandsTo: string;
    themeTokens: string[];
  };
  examples: unknown[];
}

export interface ComponentSummary {
  name: string;
  purpose: string;
}

export type ComponentKind = "primitive" | "semantic";

export interface ComponentClassification {
  primitives: ComponentSummary[];
  semantics: ComponentSummary[];
}

export function classifyComponents(): ComponentClassification {
  const primitives = primitiveComponentDescriptions().map(({ name, purpose }) => ({ name, purpose }));
  const semantics = COMPONENT_DEFINITIONS.map(({ name, purpose }) => ({ name, purpose }));
  return { primitives, semantics };
}

export function isPrimitiveComponentName(name: string): boolean {
  return primitiveComponentType(name) !== null;
}

export interface ComponentDescription {
  name: string;
  purpose: string;
  fields: Record<string, PropDefinition>;
  children: { allowed: boolean; accepts?: string[]; required?: boolean };
  examples: unknown[];
  category?: ComponentDefinition["category"];
  layoutBehavior?: ComponentDefinition["layoutBehavior"];
  renderBehavior?: ComponentDefinition["renderBehavior"];
}

const PRIMITIVE_COMPONENT_TYPES = ["stack", "grid", "split", "spacer", "divider", "bullets", "image", "table", "chart", "shape", "panel", "card", "band", "frame", "inset"] as const satisfies readonly NodeType[];
type PrimitiveComponentType = typeof PRIMITIVE_COMPONENT_TYPES[number];

export const COMPONENT_DEFINITIONS: ComponentDefinition[] = [
  textComponent("deck-title", "Deck-level title for covers and section openers. Use when the title itself is the dominant semantic object, not for normal slide headings.", "deck-title"),
  textComponent("slide-title", "Canonical title slot for ordinary content slides. It names the slide's one job and is usually generated from slide.title.", "slide-title"),
  textComponent("h1", "Primary in-content heading for a major module or section inside the slide body.", "section-title"),
  textComponent("h2", "Secondary heading for a local group, card, panel, or evidence module.", "card-title"),
  textComponent("lead", "Short thesis, framing sentence, or transition line that tells the viewer how to read the slide.", "lead"),
  textComponent("text", "Plain body copy for residual explanation when no stronger semantic component fits. Prefer callout, quote, key-takeaway, bullets, or data components when possible.", "paragraph"),
  articleComponent(),
  textComponent("source-note", "Quiet source, citation, caveat, or disclaimer. Use for provenance and constraints, not for live-read content.", "footnote"),
  textComponent("label", "Short metadata label, tag, axis marker, or local caption. Use for naming parts of a visual, not for body prose.", "label", {
    variant: { type: "enum", enum: ["plain", "badge", "tag"], description: "Optional visual variant." },
    tone: { type: "enum", enum: ["neutral", "brand", "positive", "warning", "danger"], description: "Optional semantic tone." },
  }),
  textComponent("code", "Preformatted code or command excerpt where syntax and monospace alignment are the content.", "code", {
    title: { type: "string", description: "Optional code block title." },
    language: { type: "string", description: "Optional language label." },
    caption: { type: "string", description: "Optional code caption." },
  }),
  component("metric-card", "Single compact KPI: one short numeric value plus label, usually as part of a grid or comparison. Do not use for prose, product names, or step text.", {
    value: { type: "string", required: true, semantic: "metric-value", description: "Short numeric or ranked value." },
    label: { type: "string", required: true, semantic: "metric-label", description: "Short metric label." },
    unit: { type: "string", description: "Optional unit appended to value." },
    trend: { type: "enum", enum: ["up", "down", "flat"], description: "Optional trend intent." },
  }, "stack(text.metric-value, text.metric-label)", "grid"),
  component("callout", "One highlighted insight, warning, recommendation, or rule of thumb. Use when a sentence needs emphasis but is not the final conclusion.", {
    text: { type: "string", required: true, semantic: "callout", description: "One concise insight." },
    tone: { type: "enum", enum: ["neutral", "brand", "positive", "warning", "danger"], description: "Semantic tone." },
  }, "text.callout with styled surface", "stack"),
  component("comparison-card", "One peer item in a comparison set: option, product, persona, scenario, or competitor with parallel points.", {
    title: { type: "string", required: true, semantic: "card-title", description: "Object title." },
    subtitle: { type: "string", semantic: "label", description: "Optional subtitle." },
    points: { type: "array", semantic: "bullet", max: 6, description: "Short supporting points (max 6)." },
    items: { type: "array", semantic: "bullet", max: 6, description: "Alias for points (max 6)." },
  }, "stack(text.card-title, bullets)", "grid"),
  component("step-card", "One discrete step or stage with a title and short detail. Use inside a larger sequence only when each step needs card-level detail; prefer process-flow for connected pipelines.", {
    step: { type: "string", semantic: "numbered-step", description: "Optional step label." },
    number: { type: "string", semantic: "numbered-step", description: "Alias for step when the source uses a numeric stage marker." },
    title: { type: "string", required: true, semantic: "card-title", description: "Step title." },
    body: { type: "string", semantic: "paragraph", description: "Step body." },
    description: { type: "string", semantic: "paragraph", description: "Alias for body when the source uses description copy." },
    steps: { type: "array", semantic: "bullet", description: "Alias used when a step has multiple short details." },
  }, "stack(text.numbered-step, text.card-title, text.paragraph)", "grid"),
  component("definition-card", "Term plus definition. Use for glossary, concept introduction, vocabulary, or clarifying a named framework element.", {
    term: { type: "string", required: true, semantic: "card-title", description: "Term." },
    definition: { type: "string", required: true, semantic: "paragraph", description: "Definition." },
  }, "stack(text.card-title, text.paragraph)", "grid"),
  component("numbered-list", "Ordered text list where sequence or priority matters but each item is still brief prose. Use numbered-grid when each item should become a designed module.", {
    items: { type: "array", required: true, semantic: "bullet", description: "Ordered list items (string[])." },
    density: { type: "enum", enum: ["comfortable", "compact"], description: "Bullet density." },
  }, "bullets with numbered:true", "stack"),
  component("quote", "Verbatim or voice-like statement with optional attribution. Use when authority, emotion, or wording is the evidence.", {
    text: { type: "string", required: true, semantic: "quote", description: "Quote text (without enclosing quotes; component adds them)." },
    source: { type: "string", description: "Optional source / attribution." },
  }, "stack(text.quote, text.quote-source)", "stack"),
  component("icon-text", "Icon plus short label for compact feature/status/category cues. Use as a small semantic marker, not as a substitute for rich explanation.", {
    icon: { type: "enum", enum: ["rect", "roundRect", "ellipse", "triangle", "rightTriangle", "pentagon", "arrow-right", "arrow-down", "callout", "chevron", "star-5", "parallelogram", "cloud"], required: true, description: "OOXML preset icon shape." },
    text: { type: "string", required: true, semantic: "card-title", description: "Label text." },
    iconColor: { type: "string", description: "Icon line/glyph color token." },
    iconBackground: { type: "string", description: "Icon background fill token." },
    tone: { type: "string", description: "Optional text color token." },
  }, "stack.horizontal(shape, text)", "stack"),
  component("timeline", "Chronological sequence with dates, eras, milestones, or releases. Use when time is the organizing meaning. Each item supports rich content: a sub-headline (title), simple body text (body), OR a full embedded DomNode (content) such as a metric-card, image, insight-card, quote, or a stack of multiple blocks. Pass `content` when the moment deserves more than text — a launch screenshot, a fundraising metric, a key quote.", {
    items: { type: "array", required: true, description: "Array of { time? or date?, title?/label?, body?/description? (text), content? (any DomNode — metric-card, image, insight-card, etc.) }. content takes priority over body when both are supplied. Use vertical direction when items have rich content." },
    direction: { type: "enum", enum: ["horizontal", "vertical"], description: "Layout direction. Defaults to horizontal — safe for short text items. Pass 'vertical' when items have rich content (each row gets ~12cm width vs ~4cm in horizontal)." },
    orientation: { type: "enum", enum: ["horizontal", "vertical"], description: "Alias for direction." },
  }, "grid|stack of timeline-step cards", "stack"),
  component("profile-card", "Person or role profile with photo, name, title, and short bio. Use when identity/ownership is the content.", {
    image: { type: "image-ref", required: true, description: "Photo source path or URL." },
    name: { type: "string", required: true, semantic: "card-title", description: "Person name." },
    role: { type: "string", semantic: "label", description: "Role / title." },
    bio: { type: "string", semantic: "caption", description: "Short biography." },
  }, "stack(image.clip:circle, text.card-title, text.label, text.caption)", "grid"),
  component("kpi-grid", "Set of related headline metrics that should be scanned together. Use for 2-4 KPI peers; prefer chart/bar-list when the relationship is ranking or trend.", {
    metrics: { type: "array", required: true, description: "Array of { value, label, unit?, trend? } objects." },
    items: { type: "array", description: "Alias for metrics. Metric label may also be name/title." },
    columns: { type: "number", description: "Number of columns (default min(4, metrics.length))." },
  }, "grid of metric-card", "stack"),
  component("section-break", "Full-slide chapter marker or cover-like transition. Use to reset the audience's mental context, not for ordinary content slides.", {
    title: { type: "string", required: true, semantic: "deck-title", description: "Section title (large)." },
    subtitle: { type: "string", semantic: "lead", description: "Optional subtitle." },
    accent: { type: "string", semantic: "label", description: "Optional small uppercase eyebrow LABEL TEXT above the title (e.g. \"PART ONE\"). NOT a color/tone — pass `tone` for color. Tone-keyword strings (brand/primary/neutral/etc.) are ignored to avoid agents writing accent:\"brand\" thinking it sets the color." },
    tone: { type: "enum", enum: ["brand", "neutral", "inverse"], description: "Color tone for the rule + eyebrow accent. Default brand. Use inverse on dark/full-bleed color fields." },
  }, "stack.area:content with hero text", "stack"),
  component("swot-matrix", "Four-quadrant strategic diagnosis: strengths, weaknesses, opportunities, threats. Use only when this exact SWOT semantic frame fits.", {
    strengths: { type: "array", required: true, semantic: "bullet", description: "Strengths bullets." },
    weaknesses: { type: "array", required: true, semantic: "bullet", description: "Weaknesses bullets." },
    opportunities: { type: "array", required: true, semantic: "bullet", description: "Opportunities bullets." },
    threats: { type: "array", required: true, semantic: "bullet", description: "Threats bullets." },
  }, "grid 2x2 of titled bullet quadrants", "stack"),
  component("cta", "Explicit next action, request, or decision button. Use when the slide asks the viewer to do something.", {
    text: { type: "string", required: true, description: "Button label." },
    tone: { type: "enum", enum: ["brand", "neutral", "positive", "warning", "danger"], description: "Button color tone." },
    link: { type: "string", description: "Optional hyperlink target." },
  }, "text on roundRect surface", "stack"),
  component("feature-card", "One feature, capability, benefit, or ingredient of an offer. Use for modular value propositions, not for arbitrary bullet paragraphs.", {
    icon: { type: "enum", enum: ["rect", "roundRect", "ellipse", "triangle", "rightTriangle", "pentagon", "arrow-right", "arrow-down", "callout", "chevron", "star-5", "parallelogram", "cloud"], required: true, description: "Icon shape preset." },
    title: { type: "string", required: true, semantic: "card-title", description: "Feature title." },
    body: { type: "string", semantic: "caption", description: "Optional supporting copy." },
    iconColor: { type: "string", description: "Icon line color (theme token)." },
    iconBackground: { type: "string", description: "Icon fill (theme token)." },
    tone: { type: "string", description: "Title color token." },
  }, "stack(shape, text.card-title, text.caption)", "grid"),
  component("checklist", "Status list with checked/unchecked/warning states. Use for requirements, audit, readiness, QA, or feature parity where completion state matters.", {
    items: { type: "array", required: true, description: "Array of { text, status?: 'checked'|'unchecked'|'warning' }." },
  }, "stack of horizontal text rows with check/cross marks", "stack"),
  component("progress-bar", "Single progress-to-target measure. Use for completion, quota, adoption, or capacity where the percent/ratio is the semantic point.", {
    label: { type: "string", required: true, semantic: "label", description: "Metric label." },
    value: { type: "number", required: true, description: "Value 0..max; numeric strings like '75%' are accepted." },
    max: { type: "number", description: "Upper bound (default 100); numeric strings are accepted." },
    valueLabel: { type: "string", description: "Optional override for the displayed value (default: 'NN%')." },
    tone: { type: "enum", enum: ["brand", "positive", "warning", "danger"], description: "Bar color tone." },
  }, "stack(label-row, horizontal track of two shapes)", "stack"),
  component("pros-cons", "Two-sided trade-off frame. Use when the meaning is explicitly benefits vs drawbacks, not for any two-column layout.", {
    pros: { type: "array", required: true, description: "Pro statements (string[])." },
    cons: { type: "array", required: true, description: "Con statements (string[])." },
    prosTitle: { type: "string", description: "Override 'Pros' label." },
    consTitle: { type: "string", description: "Override 'Cons' label." },
  }, "grid 2 columns of titled checklist", "stack"),
  component("process-flow", "Connected process, workflow, recipe, pipeline, or causal sequence. Use when steps depend on each other or movement through stages is the main idea.", {
    steps: { type: "array", required: true, description: "Array of { title, body? } steps." },
    items: { type: "array", description: "Alias for steps." },
    direction: { type: "enum", enum: ["horizontal", "vertical"], description: "Flow direction (default horizontal)." },
  }, "stack of step blocks separated by arrow shapes", "stack"),
  component("logo-strip", "Set of logos representing customers, partners, integrations, sponsors, or tools. Use when recognition and affiliation are the evidence.", {
    logos: { type: "array", required: true, description: "Array of { src, alt? }." },
    items: { type: "array", description: "Alias for logos." },
    images: { type: "array", description: "Alias for logos." },
    columns: { type: "number", description: "Logos per row (default min(6, count))." },
    caption: { type: "string", description: "Optional caption below the strip." },
  }, "grid of contained images, optional caption below", "stack"),
  component("pricing-card", "One commercial/package tier with price and included features. Use inside a pricing comparison; mark the recommended tier semantically.", {
    plan: { type: "string", required: true, semantic: "card-title", description: "Plan name." },
    price: { type: "string", required: true, semantic: "metric-value", description: "Price (e.g. '$29')." },
    period: { type: "string", description: "Optional billing period (e.g. '/mo')." },
    features: { type: "array", required: true, description: "Feature strings (string[])." },
    tone: { type: "enum", enum: ["neutral", "brand"], description: "Use 'brand' for the highlighted tier." },
    ctaText: { type: "string", description: "Optional CTA label rendered as a button." },
  }, "stack(card-title, price-row, divider, checklist, optional cta)", "grid"),
  component("hero-stat", "Slide-defining number: one very large metric that carries the main message. Use for cover stats, market size, landmark deltas, or decisive proof; one per slide max.", {
    value: { type: "string", required: true, semantic: "metric-value", description: "Short number+unit, e.g. '$12.4M' or '500亿+'." },
    label: { type: "string", required: true, semantic: "card-title", description: "What the number measures." },
    caption: { type: "string", semantic: "caption", description: "Optional supporting context (e.g. '+38% YoY')." },
    tone: { type: "enum", enum: ["brand", "positive", "warning", "danger", "neutral"], description: "Color tone for the value." },
  }, "stack of metric-value(2xl) + card-title + caption", "stack"),
  component("bar-list", "Ranked or sortable categorical numeric comparison. Use when the viewer should see who is bigger/smaller across 4-8 items.", {
    items: { type: "array", required: true, description: "Array of { label/name/title, value/score/percent, max?, valueLabel? }. Numeric strings like '75%' are accepted." },
    tone: { type: "enum", enum: ["brand", "positive", "warning", "danger"], description: "Bar fill color." },
    sort: { type: "enum", enum: ["desc", "asc", "none"], description: "Sort items by value (default 'none' — keep input order)." },
  }, "stack of (label-row + horizontal-track) per item", "stack"),
  component("stat-strip", "Inline row of headline metrics with minimal chrome. Use when 3-6 numbers support one read and card frames would be too heavy.", {
    items: { type: "array", required: true, description: "Array of { value, label, tone? } items. Per-item tone (brand|positive|neutral|warning|danger) sets that cell's value color and overrides the strip default — useful for mixed signals (good/risk/bad in one row)." },
    tone: { type: "enum", enum: ["brand", "positive", "neutral", "warning", "danger"], description: "Default value color tone for cells without their own tone." },
  }, "horizontal stack of (value+label) cells with thin divider rules", "stack"),
  component("legend", "Color/category key for a chart, diagram, map, or coded table. Use when colors or symbols need semantic decoding.", {
    items: { type: "array", required: true, description: "Array of { label, color } items. color is a theme token (palette name, brand.primary, etc.)." },
    direction: { type: "enum", enum: ["horizontal", "vertical"], description: "Orientation." },
    marker: { type: "enum", enum: ["dot", "square", "bar"], description: "Marker shape per item: dot (default), square, or short horizontal bar." },
  }, "stack of (color-dot + label) pairs", "stack"),
  component("badge", "Single short status/category marker such as NEW, RISK, BETA, or DRAFT. Use as metadata on another module; use tag-list for multiple chips.", {
    text: { type: "string", required: true, description: "Short label (≤ 12 chars). Auto uppercased." },
    tone: { type: "enum", enum: ["brand", "positive", "warning", "danger", "neutral"], description: "Fill color tone." },
  }, "filled rounded text pill", "stack"),
  component("title-lockup", "Integrated editorial title group: eyebrow, dominant title, subtitle, and optional rule. Use for covers, section openers, and poster-like slide openings instead of loose text nodes.", {
    title: { type: "string", required: true, semantic: "deck-title", description: "Dominant title." },
    eyebrow: { type: "string", semantic: "label", description: "Optional short kicker above the title." },
    subtitle: { type: "string", semantic: "lead", description: "Optional supporting subtitle." },
    align: { type: "enum", enum: ["left", "center", "right"], description: "Text alignment." },
    tone: { type: "enum", enum: ["inverse", "brand", "neutral"], description: "Color treatment. Use inverse on dark/full-bleed color fields." },
    rule: { type: "boolean", description: "If true, include a short accent rule below the title." },
  }, "stack(eyebrow?, deck-title, accent-rule?, lead?)", "stack"),
  component("eyebrow", "Small kicker that classifies the next headline by topic, chapter, or frame. Use to create editorial hierarchy without badge/card chrome.", {
    text: { type: "string", required: true, semantic: "label", description: "Short section/category label." },
    tone: { type: "enum", enum: ["brand", "neutral", "inverse", "positive", "warning", "danger"], description: "Text color tone. Use inverse on dark color fields." },
    rule: { type: "boolean", description: "If true, append a short accent rule after the label." },
  }, "label text + optional accent rule", "stack"),
  component("accent-rule", "Purposeful visual spine, underline, or separator that anchors a hierarchy. Use when the rule carries structure or pacing, not decoration.", {
    direction: { type: "enum", enum: ["horizontal", "vertical"], description: "Rule orientation." },
    tone: { type: "enum", enum: ["brand", "neutral", "inverse", "positive", "warning", "danger"], description: "Rule color tone. Use inverse on dark color fields." },
    length: { type: "number", description: "Rule length in cm (width for horizontal, height for vertical)." },
    thickness: { type: "number", description: "Rule thickness in cm." },
  }, "shape.rect rule with semantic sizing", "stack"),
  component("annotation", "Compact label plus note attached to a chart, image, diagram, or hero object. Use for local explanation of a visual feature, not body copy.", {
    label: { type: "string", required: true, semantic: "label", description: "Short annotation label." },
    text: { type: "string", semantic: "caption", description: "Optional one-sentence note." },
    tone: { type: "enum", enum: ["brand", "neutral", "inverse", "positive", "warning", "danger"], description: "Accent tone. Use inverse on dark color fields." },
  }, "stack(label, accent-rule, caption)", "stack"),
  containerComponent("side-rail", "Narrow contextual rail for chapter label, lens, constraints, or interpretation beside the main content. Use inside split/grid to create asymmetry and reading frame.", {
    title: { type: "string", semantic: "card-title", description: "Optional rail heading." },
    body: { type: "string", semantic: "caption", description: "Optional rail note." },
    tone: { type: "enum", enum: ["brand", "neutral", "positive", "warning", "danger", "tinted"], description: "Rail accent tone." },
    accent: { type: "enum", enum: ["left", "top"], description: "Accent rule placement." },
  }, "card/panel side rail containing a stack of title/body/children", "grid"),
  component("axis-ruler", "Ordered conceptual scale: eras, maturity stages, spectrum, or progression. Use when position along an axis is the meaning, not just a dated timeline.", {
    items: { type: "array", required: true, description: "Array of { label/title/name, body/text/description?, tone? } items, usually 3-7." },
    direction: { type: "enum", enum: ["horizontal", "vertical"], description: "Axis orientation (default horizontal)." },
    tone: { type: "enum", enum: ["brand", "neutral", "positive", "warning", "danger"], description: "Default marker color." },
  }, "axis line + marker labels", "stack"),
  component("flow-arrow", "Connector showing direction, transition, or causality between two modules. Use for one explicit relationship; use process-flow for multi-step sequences.", {
    label: { type: "string", description: "Optional short label rendered next to the arrow." },
    tone: { type: "enum", enum: ["brand", "positive", "warning", "danger"], description: "Arrow color tone." },
    direction: { type: "enum", enum: ["right", "down"], description: "Arrow direction." },
  }, "arrow shape + optional label", "stack"),
  component("key-takeaway", "The slide's central conclusion or 'so what'. Use when the viewer should leave with one decision, implication, or verdict; one per slide.", {
    headline: { type: "string", required: true, semantic: "section-title", description: "The conclusion in one short sentence." },
    title: { type: "string", semantic: "section-title", description: "Alias for headline." },
    detail: { type: "string", semantic: "lead", description: "Optional supporting sentence." },
    body: { type: "string", semantic: "lead", description: "Alias for detail." },
    tone: { type: "enum", enum: ["brand", "positive", "warning", "danger"], description: "Tone color (default brand)." },
  }, "tinted+bordered panel with accent bar + headline + detail", "stack"),
  component("numbered-grid", "Designed set of ordered priorities, principles, or framework points. Use when each item is a peer module and the number itself communicates order.", {
    items: { type: "array", required: true, description: "Array of { title/label/name, body/description/text? } items." },
    columns: { type: "number", description: "Columns (default min(4, items.length))." },
    tone: { type: "enum", enum: ["brand", "neutral"], description: "Number color tone." },
  }, "grid of (big-number, card-title, caption) cells", "stack"),
  component("tag-list", "Set of short keywords, categories, feature flags, or filters. Use for compact classification; not for sentences or long labels.", {
    items: { type: "array", required: true, description: "Array of strings or { text, tone? } objects." },
    tone: { type: "enum", enum: ["neutral", "brand", "positive", "warning", "danger"], description: "Default tone for tags that don't override." },
  }, "horizontal stack of small filled rounded rects with labels", "stack"),
  component("stat-comparison", "Before/after or current/target numeric change with delta. Use when the transformation is the point and two values must be read together.", {
    beforeLabel: { type: "string", required: true, description: "Label for the before column." },
    beforeValue: { type: "string", required: true, semantic: "metric-value", description: "Before value." },
    afterLabel: { type: "string", required: true, description: "Label for the after column." },
    afterValue: { type: "string", required: true, semantic: "metric-value", description: "After value." },
    trend: { type: "enum", enum: ["up", "down", "flat"], description: "Direction of change." },
    deltaLabel: { type: "string", description: "Optional delta annotation (e.g. '+38%')." },
  }, "grid 3-col (before / arrow / after) with metric-value typography", "stack"),
  component("image-card", "Image as evidence or subject: product shot, screenshot, diagram, photo, or artifact with optional title/caption. Use when the visual must be inspected.", {
    src: { type: "image-ref", required: true, description: "Image source path, URL, or data URL." },
    alt: { type: "string", description: "Accessible image description." },
    title: { type: "string", description: "Optional title above the image." },
    caption: { type: "string", description: "Optional caption below the image." },
    fit: { type: "enum", enum: ["cover", "contain", "fill"], description: "Image fit mode." },
    tone: { type: "enum", enum: ["neutral", "brand", "tinted"], description: "Card surface tone." },
  }, "card(stack(title?, image, caption?))", "grid"),
  component("chart-card", "Titled quantitative evidence module. Use when the chart is a self-contained proof object with interpretation/source, not just a raw plot.", {
    chartType: { type: "enum", enum: ["bar", "stacked-bar", "line", "pie", "doughnut", "area", "combo", "scatter", "waterfall"], required: true, description: "Chart type." },
    chart: { type: "enum", enum: ["bar", "stacked-bar", "line", "pie", "doughnut", "area", "combo", "scatter", "waterfall"], description: "Alias for chartType." },
    labels: { type: "array", required: true, description: "Category labels." },
    series: { type: "array", required: true, description: "Chart series." },
    data: { type: "object", description: "Optional { labels, series } alias bundle." },
    title: { type: "string", description: "Optional card/chart title." },
    caption: { type: "string", description: "Optional source or interpretation note." },
    showLegend: { type: "boolean", description: "Show chart legend." },
    showValues: { type: "boolean", description: "Show values on chart marks." },
    yFormat: { type: "enum", enum: ["int", "decimal", "percent", "wanyuan", "yi"], description: "Y-axis number format." },
    tone: { type: "enum", enum: ["neutral", "brand", "tinted"], description: "Card surface tone." },
  }, "card(stack(title?, chart, caption?))", "grid"),
  component("table-card", "Titled structured comparison or lookup table. Use for financials, feature matrices, risks, guidance, and compact data summaries.", {
    title: { type: "string", description: "Optional table title." },
    headers: { type: "array", description: "Header row labels." },
    columns: { type: "array", description: "Alternative column definitions { header, width? }." },
    rows: { type: "array", required: true, description: "Table rows. Supports cell objects with text/runs/fill/color/bold/align/valign/colspan/rowspan." },
    data: { type: "object", description: "Optional { headers, rows } alias bundle." },
    caption: { type: "string", description: "Optional source note below the table." },
    tone: { type: "enum", enum: ["neutral", "brand", "tinted"], description: "Card surface tone." },
  }, "card(stack(title?, table, caption?))", "stack"),
  component("insight-card", "One modular insight with badge/headline/detail/proof bullets. Use for a curated finding or recommendation, not generic paragraph storage.", {
    badge: { type: "string", description: "Optional short status/category badge." },
    headline: { type: "string", required: true, semantic: "card-title", description: "Main insight." },
    title: { type: "string", semantic: "card-title", description: "Alias for headline." },
    detail: { type: "string", semantic: "paragraph", description: "Supporting sentence." },
    body: { type: "string", semantic: "paragraph", description: "Alias for detail." },
    bullets: { type: "array", semantic: "bullet", description: "Optional supporting bullets." },
    items: { type: "array", semantic: "bullet", description: "Alias for bullets." },
    points: { type: "array", semantic: "bullet", description: "Alias for bullets." },
    tone: { type: "enum", enum: ["neutral", "brand", "positive", "warning", "danger"], description: "Card tone." },
  }, "card(stack(badge?, title, detail?, bullets?))", "grid"),
  component("two-column", "Semantic two-region layout for narrative + visual, evidence + commentary, or before + after. Use when both sides have named roles, not as a generic equal split.", {
    left: { type: "object", required: true, description: "Left DomNode." },
    right: { type: "object", required: true, description: "Right DomNode." },
    ratio: { type: "array", description: "Two numeric weights, default [0.5, 0.5]." },
    gap: { type: "number", description: "Column gap in cm." },
  }, "split.horizontal(left,right)", "stack"),
  component("quiz-card", "Question card: prompt + optional multi-line trailing content + optional correctness highlight + optional explanation. Use for MCQ, short-answer hints, T/F, classroom prompts, or any deck where one question anchors the card. When `correct` is supplied items render with letter chips A..; otherwise items render with bullet dots so the same component works for non-MCQ lists.", {
    question: { type: "string", required: true, description: "The question prompt." },
    items: { type: "array", description: "Optional trailing lines (answer choices, hints, sub-prompts). Each renders as its own row, max 6. Aliases: `options`, `choices`." },
    correct: { type: "string", description: "Optional. Letter (\"A\"|\"B\"|...) or 0-based index of the correct item. Highlights that item in success tone and switches markers to letter chips." },
    explanation: { type: "string", description: "Optional rationale / answer text rendered as a soft paragraph below items." },
    number: { type: "string", description: "Optional question number prefix (e.g. \"Q1\")." },
    questionType: { type: "string", description: "Optional question-type kicker (e.g. \"Inference\", \"Vocabulary\")." },
    tone: { type: "enum", enum: ["brand", "neutral", "tinted"], description: "Card surface tone." },
  }, "card(stack(stem, items:Array<marker+text>?, divider?, explanation?))", "stack"),
  component("takeaway-list", "Multi-item Key Takeaways: 3-5 short conclusions, each with a colored accent bar + bold headline + optional 1-line detail. Right component for a wrap-up / summary slide.", {
    items: { type: "array", required: true, description: "Array of {headline, detail?, tone?}. Per-item tone (brand|positive|warning|danger|neutral) overrides the list default — useful for a 'three findings + one caveat' shape where the caveat is muted (neutral) and the findings are chromatic." },
    tone: { type: "enum", enum: ["brand", "positive", "warning", "danger", "neutral"], description: "Default accent tone for items that don't supply one. 'neutral' renders a divider-gray bar (de-emphasized)." },
  }, "stack(items:Array<bar+stack(headline,detail)>)", "stack"),
  component("outline", "Table of contents / agenda. Vertical list of N chapters, each with optional number + title + optional 1-line body + optional page reference. Use for cover-following TOC slides, talk agendas, chapter indexes. Distinct from numbered-grid (parallel modules in a grid) and timeline (date-ordered events) — outline is for linear reading-order chapters with editorial spacing. Density adapts: 1-5 items show body, 6-9 are compact, 10-12 hide body. Numbering is NEVER auto-generated — pass `number` explicitly per item if you want chapter labels (e.g. \"01\", \"I\", \"Ch 1\"). When at least one item supplies number, a number column is reserved across all rows (blank cells for un-numbered items, so titles stay aligned).", {
    items: { type: "array", required: true, description: "Array of {title:string, number?:string (e.g. \"01\", \"I\", \"Ch 1\"; not auto-generated), body?:string, page?:string|number, tone?:enum[brand|positive|warning|danger]}." },
    showPages: { type: "boolean", description: "Right-align item.page as a page reference (default false)." },
    density: { type: "enum", enum: ["comfortable", "compact", "auto"], description: "Force a density; default auto by item count." },
    tone: { type: "enum", enum: ["brand", "neutral"], description: "Default number color: brand (default) or neutral." },
  }, "stack(items:Array<row(number?, title-stack(title, body?), page?)>)", "stack"),
  component("glossary", "Term + definition list for 6-15 terms in a single coherent layout. Different from definition-card (one card per term) — glossary aligns terms uniformly without competing card chrome. Use for technical glossaries, vocabulary lists, framework concept indexes. Layout: list (single column, default) or two-column.", {
    items: { type: "array", required: true, description: "Array of {term:string, definition:string}." },
    layout: { type: "enum", enum: ["list", "two-column"], description: "Single column (default) or two-column grid." },
  }, "stack-or-grid(items:Array<stack(term, definition)>)", "stack"),
  component("q-and-a", "FAQ / answer-page block. Multiple {question, answer} pairs stacked vertically with Q/A chips. Use for FAQs, interview transcripts, classroom answer pages. Distinct from quiz-card (which is for testing readers with multiple-choice options) — q-and-a is read-only, no options expected.", {
    items: { type: "array", required: true, description: "Array of {q:string, a:string} pairs (max 6 per slide; split into two slides for 7+)." },
    density: { type: "enum", enum: ["comfortable", "compact"], description: "Force a density; default auto by item count." },
  }, "stack(items:Array<row(Q chip, q-text), row(A chip, a-text)>)", "stack"),
  component("comparison-table", "Multi-option comparison matrix: features as rows, options as columns, with one option highlighted as RECOMMENDED. Distinct from table-card (no per-column emphasis) and comparison-card (single-option card). Cell values that look like ✓/✗/yes/no auto-render in success/danger color.", {
    features: { type: "array", required: true, description: "Array of feature names (one per row, max 8)." },
    options: { type: "array", required: true, description: "Array of {name:string, values:string[], recommended?:boolean} (max 4 options). values length should match features length." },
    title: { type: "string", description: "Optional heading rendered above the table." },
  }, "grid(headerRow + featureRows)", "stack"),
  // ---------- DATA components ----------
  component("scorecard", "Status-coded metric grid. Each item carries a label, value, status color (good/warning/danger/neutral), and optional delta with trend arrow. Use for project status, health checks, dashboards. Different from metric-card / kpi-grid which have no health/status semantics.", {
    items: { type: "array", required: true, description: "Array of {label:string, value:string, status?:enum[good|warning|danger|neutral], delta?:string, trend?:enum[up|down|flat]}." },
    columns: { type: "number", description: "Optional column count (default auto)." },
  }, "grid of status-accented metric cards", "stack"),
  component("funnel", "Conversion funnel — sales pipeline, signup → activation → paid funnel, traffic stages. Each stage is a chevron sized by value; drop% vs previous stage shown.", {
    stages: { type: "array", required: true, description: "Array of {label:string, value:number, valueLabel?:string, tone?:enum[brand|positive|warning|danger]} (max 6)." },
    showDrop: { type: "boolean", description: "Show drop% between consecutive stages (default true)." },
  }, "stack of chevron stages with labels", "stack"),
  component("gauge", "Single-value progress dial with threshold-banded track. Use for NPS, CSAT, target completion. Different from progress-bar (no threshold zones) and metric-card (no progress visualization).", {
    value: { type: "number", required: true, description: "Current value." },
    label: { type: "string", required: true, description: "Metric label (e.g. \"NPS\")." },
    max: { type: "number", description: "Max value (default 100)." },
    unit: { type: "string", description: "Optional unit suffix (\"%\", \"pts\")." },
    thresholds: { type: "array", description: "Array of {upTo:number, tone:enum[danger|warning|positive|brand], label?:string} sorted by upTo. Defines the colored zones along the track." },
  }, "stack(value, label, threshold-banded track, pointer)", "stack"),
  component("heatmap", "NxM heatmap (matrix of cells colored by value). Use for time × category, A/B test matrices, activity patterns. Linear color interpolation on a palette. Max 12×12.", {
    xLabels: { type: "array", required: true, description: "Column labels." },
    yLabels: { type: "array", required: true, description: "Row labels." },
    values: { type: "array", required: true, description: "Number matrix [yLabels.length][xLabels.length]." },
    palette: { type: "enum", enum: ["warm", "cool", "diverging"], description: "Color palette (default cool)." },
    showValues: { type: "boolean", description: "Render numeric values inside cells (default auto by size)." },
  }, "grid of colored cells with axis labels", "stack"),
  component("matrix-2x2", "2x2 quadrant matrix with labeled axes and items placed in quadrants. Use for risk-matrix (impact × probability), priority (effort × value), Boston matrix. Different from swot-matrix which has fixed S/W/O/T semantics.", {
    xAxis: { type: "object", required: true, description: "{low:string, high:string} — x-axis labels." },
    yAxis: { type: "object", required: true, description: "{low:string, high:string} — y-axis labels." },
    items: { type: "array", required: true, description: "Array of {label:string, x:enum[low|high], y:enum[low|high], tone?}." },
    quadrantLabels: { type: "object", description: "Optional {tl?:string, tr?:string, bl?:string, br?:string} corner names (e.g. \"Quick Wins\")." },
  }, "stack(yhi-label, 2x2 grid of quadrant cards, ylo-label, x-axis labels)", "stack"),
  component("trend-line", "Mini sparkline / trend visualization (bars whose height reflects values). Use as decoration next to a metric or under a heading. Different from chart-card (full chart with axes/legend) — trend-line is just the shape.", {
    values: { type: "array", required: true, description: "Array of numbers (max 24)." },
    tone: { type: "enum", enum: ["brand", "positive", "warning", "danger"], description: "Bar color tone." },
    height: { type: "number", description: "Height in cm (default 1.0)." },
  }, "horizontal stack of bars", "stack"),
  component("stat-flow", "Horizontal sequence of stat blocks connected by operator/connector text. Use for unit economics derivation (CAC × LTV → margin), formula walkthroughs, KPI cause-effect chains.", {
    steps: { type: "array", required: true, description: "Array of {value:string, label:string, tone?:enum[brand|positive|warning|danger|neutral]} OR {connector:string} entries (max 10). Connectors are operator strings like \"×\", \"÷ 24m\", \"→\"." },
  }, "horizontal stack of value/label blocks + connector text", "stack"),
  component("donut-summary", "Primary-share + remainder legend. Use for \"X% from Y\" stories where one share dominates. Different from chart-card pie (no primary emphasis).", {
    primary: { type: "object", required: true, description: "{label:string, value:number} for the dominant share." },
    others: { type: "array", description: "Array of {label, value} for remaining shares." },
    unit: { type: "string", description: "Optional suffix shown after percentage (\"of revenue\")." },
    tone: { type: "enum", enum: ["brand", "positive", "warning", "danger"], description: "Accent color tone." },
  }, "grid(ring+center-number, legend list)", "stack"),
  component("range-plot", "Horizontal range bars showing min..max (and optional point) per category. Use for salary bands, confidence intervals, price ranges.", {
    items: { type: "array", required: true, description: "Array of {label:string, min:number, max:number, point?:number, unit?:string}." },
    tone: { type: "enum", enum: ["brand", "positive", "warning", "danger"], description: "Bar color tone." },
  }, "stack of label + range-bar + optional pointer", "stack"),
  // ---------- DECORATION components ----------
  component("callout-marker", "Anchored bubble with text — floats over slide content via anchor positioning. Use to point at a region of an image, chart, or hero element. Different from annotation (inline label, no anchor).", {
    text: { type: "string", required: true, description: "The bubble text." },
    anchor: { type: "enum", enum: ["top-left", "top-center", "top-right", "middle-left", "middle-center", "middle-right", "bottom-left", "bottom-center", "bottom-right"], description: "Slide-relative anchor position." },
    tone: { type: "enum", enum: ["brand", "positive", "warning", "danger", "neutral"], description: "Bubble color tone." },
    width: { type: "number", description: "Bubble width in cm (default 4)." },
    height: { type: "number", description: "Bubble height in cm (default 1.2)." },
  }, "anchored text shape with rounded corners", "stack"),
  component("decoration-grid", "Geometric pattern background (dots, diagonals, grid lines). Use for cover slide texture, section-break decoration, empty-area visual interest.", {
    pattern: { type: "enum", enum: ["dots", "diagonal-lines", "grid"], description: "Pattern type (default dots)." },
    density: { type: "enum", enum: ["sparse", "normal", "dense"], description: "Pattern density." },
    tone: { type: "enum", enum: ["muted", "brand"], description: "Color tone — muted (default) or brand-tint." },
    rows: { type: "number", description: "Override row count." },
    columns: { type: "number", description: "Override column count." },
    asBackground: { type: "boolean", description: "Default true: anchors the grid as a slide-spanning overlay (zIndex<0) so it sits behind content without occupying flow. Set false to embed inline (e.g. as a designed band between content blocks)." },
  }, "grid of small shape primitives in a repeating pattern", "stack"),
  component("corner-mark", "Small ribbon/stamp/tag in a slide corner — DRAFT, CONFIDENTIAL, V2.0 style markers. Anchored to corner, doesn't compete with main content.", {
    text: { type: "string", required: true, description: "The marker text." },
    corner: { type: "enum", enum: ["top-left", "top-right", "bottom-left", "bottom-right"], description: "Corner position (default top-right)." },
    tone: { type: "enum", enum: ["brand", "warning", "danger", "neutral"], description: "Color tone (default warning)." },
    style: { type: "enum", enum: ["ribbon", "stamp", "tag"], description: "Visual style (default tag)." },
  }, "anchored corner-positioned label shape", "stack"),
  component("bracket", "Geometric brace/bracket emphasizing a group of elements. Renders a thin shape on one side with optional label.", {
    direction: { type: "enum", enum: ["left", "right", "top", "bottom"], description: "Bracket side (default left)." },
    label: { type: "string", description: "Optional label rendered next to the bracket." },
    tone: { type: "enum", enum: ["brand", "positive", "warning", "danger"], description: "Color tone." },
  }, "stack(line shape + optional label)", "stack"),
  component("arrow-link", "Single directional connector with optional from/to labels and middle text. MVP is inline horizontal/vertical only.", {
    fromLabel: { type: "string", description: "Optional left/top label." },
    toLabel: { type: "string", description: "Optional right/bottom label." },
    label: { type: "string", description: "Optional connector label rendered above the arrow." },
    direction: { type: "enum", enum: ["right", "down"], description: "Arrow direction (default right)." },
    tone: { type: "enum", enum: ["brand", "positive", "warning", "danger"], description: "Arrow color tone." },
  }, "stack of from-label, arrow, to-label", "stack"),
  component("watermark", "Large semi-transparent decorative text overlay (DRAFT, CONFIDENTIAL, SAMPLE). Anchored to slide center.", {
    text: { type: "string", required: true, description: "The watermark text." },
    rotation: { type: "number", description: "Rotation in degrees (default 0)." },
    tone: { type: "enum", enum: ["muted", "danger", "warning", "brand"], description: "Color tone (default muted)." },
  }, "center-anchored uppercase hero text", "stack"),
  component("big-page-number", "Large decorative page number for cover/section slides. Different from chrome.pageNumber (small footer). Use as visual marker on chapter openers.", {
    current: { type: "string", required: true, description: "Current page number (e.g. 5 or \"Ch 5\")." },
    total: { type: "string", description: "Optional total (renders as \"05 / 22\")." },
    position: { type: "enum", enum: ["top-left", "top-right", "bottom-left", "bottom-right"], description: "Corner anchor (default top-right)." },
    tone: { type: "enum", enum: ["brand", "muted"], description: "Color tone." },
  }, "anchored hero-style number", "stack"),
  component("timeline-axis-bar", "Section navigation bar — N section dots with current section highlighted. Use at top of section break slides to communicate progress through deck.", {
    sections: { type: "array", required: true, description: "Array of section name strings (max 8)." },
    current: { type: "number", required: true, description: "0-based index of the active section." },
    tone: { type: "enum", enum: ["brand", "neutral"], description: "Active dot color tone." },
  }, "horizontal stack of dot + label per section", "stack"),
  component("scale-bar", "Horizontal numeric scale with tick marks. Companion to images/charts/diagrams when measurement context matters.", {
    max: { type: "number", required: true, description: "Maximum scale value." },
    min: { type: "number", description: "Minimum (default 0)." },
    unit: { type: "string", description: "Optional unit suffix on labels." },
    ticks: { type: "number", description: "Number of tick marks (default 5, min 2)." },
    tone: { type: "enum", enum: ["brand", "neutral"], description: "Line color tone." },
  }, "stack(ticks, baseline, labels)", "stack"),
];

export function listComponents(): ComponentSummary[] {
  return [
    ...primitiveComponentDescriptions().map(({ name, purpose }) => ({ name, purpose })),
    ...COMPONENT_DEFINITIONS.map(({ name, purpose }) => ({ name, purpose })),
  ];
}

function describeOne(name: string): ComponentDescription | null {
  const primitive = primitiveComponentDescription(name);
  if (primitive) return primitive;
  return COMPONENT_DEFINITIONS.find((item) => item.name === name) || null;
}

export interface DescribeComponentsResult {
  found: Record<string, ComponentDescription>;
  missing: string[];
}

export function describeComponents(names: readonly string[]): DescribeComponentsResult {
  const found: Record<string, ComponentDescription> = {};
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    if (typeof raw !== "string") continue;
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const desc = describeOne(name);
    if (desc) found[name] = desc;
    else missing.push(name);
  }
  return { found, missing };
}

export function isComponentName(name: unknown): name is string {
  return typeof name === "string" && Boolean(describeOne(name));
}

const PRIMITIVE_NODE_TYPES = new Set(["slide", "stack", "grid", "split", "spacer", "divider", "text", "bullets", "image", "table", "chart", "shape", "component", "panel", "card", "band", "frame", "inset"]);

export function getComponentName(node: DomNode): string {
  if (node.type === "component" && typeof node.component === "string") return node.component;
  const t = typeof node.type === "string" ? node.type : "";
  if (t && !PRIMITIVE_NODE_TYPES.has(t) && isComponentName(t)) return t;
  return "";
}

export function isComponentTypedNode(node: DomNode): boolean {
  return getComponentName(node) !== "";
}

export function expandComponent(slideId: string, node: DomNode): DomNode {
  const componentName = getComponentName(node);
  const primitiveType = primitiveComponentType(componentName);
  if (primitiveType) return primitiveComponentNode(slideId, primitiveType, node);
  const name = componentLocalId(slideId, node.id);
  const textStyle = semanticTextStyle(componentName);
  if (textStyle) return withComponentRoot(node, textComponentNode(slideId, name, stringValue(node.text, ""), textStyle, node));
  if (componentName === "metric-card") {
    const unit = stringValue(node.unit, "");
    const trend = node.trend === "up" || node.trend === "down" || node.trend === "flat" ? node.trend : undefined;
    return withComponentRoot(node, metricCard(slideId, name, stringValue(node.value, ""), stringValue(node.label, ""), { unit, trend }));
  }
  if (componentName === "callout") {
    const toneProps = tonePropsFrom(node.tone);
    const expanded = insightCallout(slideId, name, stringValue(node.text, ""));
    return withComponentRoot(node, { ...expanded, ...toneProps });
  }
  if (componentName === "comparison-card") return withComponentRoot(node, comparisonCard(slideId, name, stringValue(node.title, ""), comparisonPoints(node).slice(0, 6)));
  if (componentName === "step-card") {
    return withComponentRoot(node, stepCard(
      slideId,
      name,
      stringValue(node.step, stringValue(node.number, "")),
      stringValue(node.title, stringValue(node.label, "")),
      stringValue(node.body, stringValue(node.description, stringArray(node.steps).join("\n"))),
    ));
  }
  if (componentName === "article") return withComponentRoot(node, articleFallback(slideId, name, node));
  if (componentName === "definition-card") return withComponentRoot(node, definitionCard(slideId, name, stringValue(node.term, ""), stringValue(node.definition, "")));
  if (componentName === "numbered-list") {
    const density = node.density === "compact" ? "compact" : "comfortable";
    return withComponentRoot(node, numberedList(slideId, name, stringArray(node.items), density));
  }
  if (componentName === "quote") {
    return withComponentRoot(node, quoteBlock(slideId, name, stringValue(node.text, ""), stringValue(node.source, "")));
  }
  if (componentName === "icon-text") {
    return withComponentRoot(node, iconText(slideId, name, {
      icon: stringValue(node.icon, "ellipse"),
      text: stringValue(node.text, ""),
      iconColor: stringValue(node.iconColor, ""),
      iconBackground: stringValue(node.iconBackground, ""),
      tone: stringValue(node.tone, ""),
    }));
  }
  if (componentName === "timeline") {
    const items = Array.isArray(node.items) ? node.items.map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      // `content` accepts any DomNode (registered component or
      // primitive). It runs through the same materialize/expand path as
      // any other slide child, so nested components are handled by the
      // renderer recursively.
      const contentRaw = rec.content;
      const content: DomNode | undefined = contentRaw && typeof contentRaw === "object" && !Array.isArray(contentRaw)
        ? contentRaw as DomNode
        : undefined;
      return {
        time: stringValue(rec.time, stringValue(rec.date, "")),
        // title is now optional; when content is present, agents often
        // omit it because the content carries its own headline.
        title: stringValue(rec.title, stringValue(rec.label, "")),
        body: stringValue(rec.body, stringValue(rec.description, "")),
        content,
      };
    }) : [];
    // Timeline defaults to horizontal regardless of item count; vertical
    // timelines pack densely and frequently collide with sibling content
    // (image-cards, leads). Horizontal is the safer default that consistently
    // fits within a slide's content area, and the renderer's autoOrientFlow
    // can flip it back to vertical when the cell is genuinely too narrow.
    const rawDirection = node.direction || node.orientation;
    const direction = rawDirection === "vertical" ? "vertical" : "horizontal";
    return withComponentRoot(node, timelineBlock(slideId, name, { items, direction }));
  }
  if (componentName === "profile-card") {
    return withComponentRoot(node, profileCard(slideId, name, {
      image: stringValue(node.image, stringValue(node.src, "")),
      name: stringValue(node.name, stringValue(node.title, "")),
      role: stringValue(node.role, ""),
      bio: stringValue(node.bio, stringValue(node.body, "")),
    }));
  }
  if (componentName === "kpi-grid") {
    const metrics = arrayValue(node.metrics, node.items).map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const trendRaw = rec.trend;
      const trend: "up" | "down" | "flat" | undefined = trendRaw === "up" || trendRaw === "down" || trendRaw === "flat" ? trendRaw : undefined;
      return {
        name: stringValue(rec.name, ""),
        value: stringValue(rec.value, ""),
        label: stringValue(rec.label, stringValue(rec.name, stringValue(rec.title, ""))),
        unit: stringValue(rec.unit, ""),
        trend,
      };
    });
    const columns = typeof node.columns === "number" ? node.columns : undefined;
    return withComponentRoot(node, kpiGrid(slideId, name, metrics, columns));
  }
  if (componentName === "section-break") {
    const rawTone = node.tone;
    const tone = rawTone === "brand" || rawTone === "neutral" || rawTone === "inverse" ? rawTone : undefined;
    return withComponentRoot(node, sectionBreak(slideId, name, {
      title: stringValue(node.title, ""),
      subtitle: stringValue(node.subtitle, ""),
      accent: stringValue(node.accent, ""),
      tone,
    }));
  }
  if (componentName === "swot-matrix") {
    return withComponentRoot(node, swotMatrix(slideId, name, {
      strengths: stringArray(node.strengths),
      weaknesses: stringArray(node.weaknesses),
      opportunities: stringArray(node.opportunities),
      threats: stringArray(node.threats),
    }));
  }
  if (componentName === "cta") {
    const toneRaw = node.tone;
    const tone = toneRaw === "brand" || toneRaw === "neutral" || toneRaw === "positive" || toneRaw === "warning" || toneRaw === "danger" ? toneRaw : undefined;
    return withComponentRoot(node, ctaButton(slideId, name, {
      text: stringValue(node.text, ""),
      tone,
      link: stringValue(node.link, ""),
    }));
  }
  if (componentName === "feature-card") {
    return withComponentRoot(node, featureCard(slideId, name, {
      icon: stringValue(node.icon, "ellipse"),
      title: stringValue(node.title, ""),
      body: stringValue(node.body, ""),
      iconColor: stringValue(node.iconColor, ""),
      iconBackground: stringValue(node.iconBackground, ""),
      tone: stringValue(node.tone, ""),
    }));
  }
  if (componentName === "checklist") {
    const items = Array.isArray(node.items) ? node.items.map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : { text: String(raw ?? "") };
      const statusRaw = rec.status;
      const status: "checked" | "unchecked" | "warning" =
        statusRaw === "unchecked" ? "unchecked" : statusRaw === "warning" ? "warning" : "checked";
      return { text: stringValue(rec.text, ""), status };
    }).filter((item) => item.text) : [];
    return withComponentRoot(node, checklist(slideId, name, items));
  }
  if (componentName === "progress-bar") {
    const toneRaw = node.tone;
    const tone = toneRaw === "brand" || toneRaw === "positive" || toneRaw === "warning" || toneRaw === "danger" ? toneRaw : undefined;
    return withComponentRoot(node, progressBar(slideId, name, {
      label: stringValue(node.label, ""),
      value: numberValue(node.value, 0),
      max: node.max === undefined ? undefined : numberValue(node.max, undefined),
      valueLabel: stringValue(node.valueLabel, ""),
      tone,
    }));
  }
  if (componentName === "pros-cons") {
    return withComponentRoot(node, prosCons(slideId, name, {
      pros: stringArray(node.pros),
      cons: stringArray(node.cons),
      prosTitle: stringValue(node.prosTitle, ""),
      consTitle: stringValue(node.consTitle, ""),
    }));
  }
  if (componentName === "process-flow") {
    const steps = arrayValue(node.steps, node.items).map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      return { title: stringValue(rec.title, stringValue(rec.label, "")), body: stringValue(rec.body, stringValue(rec.description, "")) };
    }).filter((step) => step.title);
    const direction = node.direction === "vertical" ? "vertical" : "horizontal";
    return withComponentRoot(node, processFlow(slideId, name, { steps, direction }));
  }
  if (componentName === "logo-strip") {
    const logos = arrayValue(node.logos, node.items, node.images).map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : { src: String(raw ?? "") };
      return { src: stringValue(rec.src, ""), alt: stringValue(rec.alt, "") };
    }).filter((logo) => logo.src);
    const columns = typeof node.columns === "number" ? node.columns : undefined;
    return withComponentRoot(node, logoStrip(slideId, name, logos, { columns, caption: stringValue(node.caption, "") }));
  }
  if (componentName === "pricing-card") {
    const toneRaw = node.tone;
    const tone = toneRaw === "brand" ? "brand" : "neutral";
    return withComponentRoot(node, pricingCard(slideId, name, {
      plan: stringValue(node.plan, ""),
      price: stringValue(node.price, ""),
      period: stringValue(node.period, ""),
      features: stringArray(node.features),
      tone,
      ctaText: stringValue(node.ctaText, ""),
    }));
  }
  if (componentName === "hero-stat") {
    const toneRaw = node.tone;
    const tone = toneRaw === "brand" || toneRaw === "positive" || toneRaw === "warning" || toneRaw === "danger" || toneRaw === "neutral" ? toneRaw : undefined;
    return withComponentRoot(node, heroStat(slideId, name, {
      value: stringValue(node.value, ""),
      label: stringValue(node.label, ""),
      caption: stringValue(node.caption, ""),
      tone,
    }));
  }
  if (componentName === "bar-list") {
    const toneRaw = node.tone;
    const tone = toneRaw === "brand" || toneRaw === "positive" || toneRaw === "warning" || toneRaw === "danger" ? toneRaw : undefined;
    const items = Array.isArray(node.items) ? node.items.map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      return {
        label: stringValue(rec.label, stringValue(rec.name, stringValue(rec.title, ""))),
        value: numberValue(rec.value, numberValue(rec.score, numberValue(rec.percent, 0))),
        max: rec.max === undefined ? undefined : numberValue(rec.max, undefined),
        valueLabel: stringValue(rec.valueLabel, ""),
      };
    }).filter((item) => item.label) : [];
    const sortRaw = node.sort;
    const sort = sortRaw === "desc" || sortRaw === "asc" || sortRaw === "none" ? sortRaw : undefined;
    return withComponentRoot(node, barList(slideId, name, { items, tone, sort }));
  }
  if (componentName === "stat-strip") {
    const allowedTones = new Set(["brand", "positive", "neutral", "warning", "danger"]);
    const coerceTone = (v: unknown): "brand" | "positive" | "neutral" | "warning" | "danger" | undefined => {
      const norm = normalizeToneAlias(v);
      return norm && allowedTones.has(norm) ? norm as "brand" | "positive" | "neutral" | "warning" | "danger" : undefined;
    };
    const items = Array.isArray(node.items) ? node.items.map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      return {
        value: stringValue(rec.value, stringValue(rec.metric, "")),
        label: stringValue(rec.label, stringValue(rec.name, stringValue(rec.title, ""))),
        tone: coerceTone(rec.tone),
      };
    }).filter((item) => item.value || item.label) : [];
    const tone = coerceTone(node.tone);
    return withComponentRoot(node, statStrip(slideId, name, { items, tone }));
  }
  if (componentName === "legend") {
    const items = Array.isArray(node.items) ? node.items.map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      return { label: stringValue(rec.label, ""), color: stringValue(rec.color, "brand.primary") };
    }).filter((item) => item.label) : [];
    const direction = node.direction === "vertical" ? "vertical" : "horizontal";
    const marker = node.marker === "square" || node.marker === "bar" || node.marker === "dot" ? node.marker : undefined;
    return withComponentRoot(node, legend(slideId, name, { items, direction, marker }));
  }
  if (componentName === "badge") {
    const toneRaw = node.tone;
    const tone = toneRaw === "brand" || toneRaw === "positive" || toneRaw === "warning" || toneRaw === "danger" || toneRaw === "neutral" ? toneRaw : undefined;
    return withComponentRoot(node, badge(slideId, name, { text: stringValue(node.text, ""), tone }));
  }
  if (componentName === "title-lockup") {
    return withComponentRoot(node, titleLockupNode(slideId, name, node));
  }
  if (componentName === "eyebrow") {
    return withComponentRoot(node, eyebrowNode(slideId, name, node));
  }
  if (componentName === "accent-rule") {
    return withComponentRoot(node, accentRuleNode(slideId, name, node));
  }
  if (componentName === "annotation") {
    return withComponentRoot(node, annotationNode(slideId, name, node));
  }
  if (componentName === "side-rail") {
    return withComponentRoot(node, sideRailNode(slideId, name, node));
  }
  if (componentName === "axis-ruler") {
    return withComponentRoot(node, axisRulerNode(slideId, name, node));
  }
  if (componentName === "flow-arrow") {
    const toneRaw = node.tone;
    const tone = toneRaw === "brand" || toneRaw === "positive" || toneRaw === "warning" || toneRaw === "danger" ? toneRaw : undefined;
    const dir = node.direction === "down" ? "down" : "right";
    return withComponentRoot(node, flowArrow(slideId, name, { label: stringValue(node.label, ""), tone, direction: dir }));
  }
  if (componentName === "key-takeaway") {
    const toneRaw = node.tone;
    const tone = toneRaw === "brand" || toneRaw === "positive" || toneRaw === "warning" || toneRaw === "danger" ? toneRaw : undefined;
    return withComponentRoot(node, keyTakeaway(slideId, name, {
      headline: stringValue(node.headline, stringValue(node.title, "")),
      detail: stringValue(node.detail, stringValue(node.body, stringValue(node.description, ""))),
      tone,
    }));
  }
  if (componentName === "numbered-grid") {
    const items = Array.isArray(node.items) ? node.items.map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : { title: String(raw ?? "") };
      return { title: stringValue(rec.title, stringValue(rec.label, stringValue(rec.name, ""))), body: stringValue(rec.body, stringValue(rec.description, stringValue(rec.text, ""))) };
    }).filter((item) => item.title) : [];
    const cols = typeof node.columns === "number" ? node.columns : undefined;
    const toneRaw = node.tone;
    const tone = toneRaw === "brand" || toneRaw === "neutral" ? toneRaw : undefined;
    return withComponentRoot(node, numberedGrid(slideId, name, { items, columns: cols, tone }));
  }
  if (componentName === "tag-list") {
    const toneRaw = node.tone;
    const tone = toneRaw === "neutral" || toneRaw === "brand" || toneRaw === "positive" || toneRaw === "warning" || toneRaw === "danger" ? toneRaw : undefined;
    const items = Array.isArray(node.items) ? node.items.filter((item): item is string | { text: string; tone?: string } => {
      if (typeof item === "string") return Boolean(item.trim());
      if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") return true;
      return false;
    }) : [];
    return withComponentRoot(node, tagList(slideId, name, { items, tone }));
  }
  if (componentName === "stat-comparison") {
    const trendRaw = node.trend;
    const trend: "up" | "down" | "flat" | undefined = trendRaw === "up" || trendRaw === "down" || trendRaw === "flat" ? trendRaw : undefined;
    return withComponentRoot(node, statComparison(slideId, name, {
      beforeLabel: stringValue(node.beforeLabel, ""),
      beforeValue: stringValue(node.beforeValue, ""),
      afterLabel: stringValue(node.afterLabel, ""),
      afterValue: stringValue(node.afterValue, ""),
      trend,
      deltaLabel: stringValue(node.deltaLabel, ""),
    }));
  }
  if (componentName === "image-card") {
    return withComponentRoot(node, imageCardNode(slideId, name, node));
  }
  if (componentName === "chart-card") {
    return withComponentRoot(node, chartCardNode(slideId, name, node));
  }
  if (componentName === "table-card") {
    return withComponentRoot(node, tableCardNode(slideId, name, node));
  }
  if (componentName === "insight-card") {
    return withComponentRoot(node, insightCardNode(slideId, name, node));
  }
  if (componentName === "scorecard") {
    type ScoreStatus = "good" | "warning" | "danger" | "neutral";
    type ScoreTrend = "up" | "down" | "flat";
    const items: Array<{ label: string; value: string; status?: ScoreStatus; delta?: string; trend?: ScoreTrend }> = Array.isArray(node.items) ? node.items.map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const sRaw = rec.status;
      const status: ScoreStatus | undefined = sRaw === "good" || sRaw === "warning" || sRaw === "danger" || sRaw === "neutral" ? sRaw : undefined;
      const tRaw = rec.trend;
      const trend: ScoreTrend | undefined = tRaw === "up" || tRaw === "down" || tRaw === "flat" ? tRaw : undefined;
      return {
        label: stringValue(rec.label, stringValue(rec.name, "")),
        value: stringValue(rec.value, ""),
        status,
        delta: stringValue(rec.delta, "") || undefined,
        trend,
      };
    }).filter((it) => it.label && it.value) : [];
    const cols = typeof node.columns === "number" ? node.columns : undefined;
    return withComponentRoot(node, scorecard(slideId, name, { items, columns: cols }));
  }
  if (componentName === "funnel") {
    type FunnelTone = "brand" | "positive" | "warning" | "danger";
    const stages: Array<{ label: string; value: number; valueLabel?: string; tone?: FunnelTone }> = Array.isArray(node.stages) ? node.stages.map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const tRaw = rec.tone;
      const tone: FunnelTone | undefined = tRaw === "brand" || tRaw === "positive" || tRaw === "warning" || tRaw === "danger" ? tRaw : undefined;
      return {
        label: stringValue(rec.label, stringValue(rec.name, "")),
        value: typeof rec.value === "number" ? rec.value : Number(rec.value) || 0,
        valueLabel: stringValue(rec.valueLabel, "") || undefined,
        tone,
      };
    }).filter((s) => s.label) : [];
    return withComponentRoot(node, funnel(slideId, name, { stages, showDrop: node.showDrop !== false }));
  }
  if (componentName === "gauge") {
    type GaugeTone = "danger" | "warning" | "positive" | "brand";
    const thresholdsRaw = Array.isArray(node.thresholds) ? node.thresholds : [];
    const thresholds = thresholdsRaw.map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const tRaw = rec.tone;
      const tone: GaugeTone = tRaw === "danger" || tRaw === "warning" || tRaw === "positive" || tRaw === "brand" ? tRaw : "brand";
      return {
        upTo: typeof rec.upTo === "number" ? rec.upTo : Number(rec.upTo) || 0,
        tone,
        label: stringValue(rec.label, "") || undefined,
      };
    });
    return withComponentRoot(node, gauge(slideId, name, {
      value: typeof node.value === "number" ? node.value : Number(node.value) || 0,
      max: typeof node.max === "number" ? node.max : undefined,
      label: stringValue(node.label, ""),
      unit: stringValue(node.unit, "") || undefined,
      thresholds: thresholds.length > 0 ? thresholds : undefined,
    }));
  }
  if (componentName === "heatmap") {
    const xLabels = Array.isArray(node.xLabels) ? node.xLabels.map(String) : [];
    const yLabels = Array.isArray(node.yLabels) ? node.yLabels.map(String) : [];
    const valuesRaw = Array.isArray(node.values) ? node.values : [];
    const values: number[][] = valuesRaw.map((row) => Array.isArray(row) ? row.map((v) => typeof v === "number" ? v : Number(v) || 0) : []);
    const palette = node.palette === "warm" || node.palette === "diverging" || node.palette === "cool" ? node.palette : undefined;
    return withComponentRoot(node, heatmap(slideId, name, {
      xLabels, yLabels, values,
      palette,
      showValues: node.showValues === true ? true : node.showValues === false ? false : undefined,
    }));
  }
  if (componentName === "matrix-2x2") {
    type MatTone = "brand" | "positive" | "warning" | "danger";
    const xAxis = node.xAxis && typeof node.xAxis === "object" ? node.xAxis as { low: string; high: string } : { low: "Low", high: "High" };
    const yAxis = node.yAxis && typeof node.yAxis === "object" ? node.yAxis as { low: string; high: string } : { low: "Low", high: "High" };
    const items: Array<{ label: string; x: "low" | "high"; y: "low" | "high"; tone?: MatTone }> = Array.isArray(node.items) ? node.items.map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const tRaw = rec.tone;
      const tone: MatTone | undefined = tRaw === "brand" || tRaw === "positive" || tRaw === "warning" || tRaw === "danger" ? tRaw : undefined;
      const x: "low" | "high" = rec.x === "high" ? "high" : "low";
      const y: "low" | "high" = rec.y === "high" ? "high" : "low";
      return { label: stringValue(rec.label, ""), x, y, tone };
    }).filter((it) => it.label) : [];
    const ql = node.quadrantLabels && typeof node.quadrantLabels === "object" ? node.quadrantLabels as Record<string, unknown> : {};
    return withComponentRoot(node, matrix2x2(slideId, name, {
      xAxis: { low: stringValue(xAxis.low, "Low"), high: stringValue(xAxis.high, "High") },
      yAxis: { low: stringValue(yAxis.low, "Low"), high: stringValue(yAxis.high, "High") },
      items,
      quadrantLabels: {
        tl: stringValue(ql.tl, "") || undefined,
        tr: stringValue(ql.tr, "") || undefined,
        bl: stringValue(ql.bl, "") || undefined,
        br: stringValue(ql.br, "") || undefined,
      },
    }));
  }
  if (componentName === "trend-line") {
    type TLTone = "brand" | "positive" | "warning" | "danger";
    const tRaw = node.tone;
    const tone: TLTone | undefined = tRaw === "brand" || tRaw === "positive" || tRaw === "warning" || tRaw === "danger" ? tRaw : undefined;
    const values = Array.isArray(node.values) ? node.values.map((v) => typeof v === "number" ? v : Number(v) || 0) : [];
    return withComponentRoot(node, trendLine(slideId, name, {
      values, tone,
      height: typeof node.height === "number" ? node.height : undefined,
    }));
  }
  if (componentName === "stat-flow") {
    type SFTone = "brand" | "positive" | "warning" | "danger" | "neutral";
    const steps = Array.isArray(node.steps) ? node.steps.map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      if (typeof rec.connector === "string" && rec.connector.trim()) return { connector: rec.connector };
      const tRaw = rec.tone;
      const tone: SFTone | undefined = tRaw === "brand" || tRaw === "positive" || tRaw === "warning" || tRaw === "danger" || tRaw === "neutral" ? tRaw : undefined;
      return {
        value: stringValue(rec.value, ""),
        label: stringValue(rec.label, ""),
        tone,
      };
    }).filter((s) => "connector" in s ? !!s.connector : !!s.value) : [];
    return withComponentRoot(node, statFlow(slideId, name, { steps: steps as Array<{ value: string; label: string; tone?: SFTone } | { connector: string }> }));
  }
  if (componentName === "donut-summary") {
    type DSTone = "brand" | "positive" | "warning" | "danger";
    const tRaw = node.tone;
    const tone: DSTone | undefined = tRaw === "brand" || tRaw === "positive" || tRaw === "warning" || tRaw === "danger" ? tRaw : undefined;
    const primaryRaw = node.primary && typeof node.primary === "object" ? node.primary as Record<string, unknown> : { label: "", value: 0 };
    const others = Array.isArray(node.others) ? node.others.map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      return { label: stringValue(rec.label, ""), value: typeof rec.value === "number" ? rec.value : Number(rec.value) || 0 };
    }).filter((o) => o.label) : [];
    return withComponentRoot(node, donutSummary(slideId, name, {
      primary: { label: stringValue(primaryRaw.label, ""), value: typeof primaryRaw.value === "number" ? primaryRaw.value : Number(primaryRaw.value) || 0 },
      others,
      unit: stringValue(node.unit, "") || undefined,
      tone,
    }));
  }
  if (componentName === "range-plot") {
    type RPTone = "brand" | "positive" | "warning" | "danger";
    const tRaw = node.tone;
    const tone: RPTone | undefined = tRaw === "brand" || tRaw === "positive" || tRaw === "warning" || tRaw === "danger" ? tRaw : undefined;
    const items = Array.isArray(node.items) ? node.items.map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      return {
        label: stringValue(rec.label, ""),
        min: typeof rec.min === "number" ? rec.min : Number(rec.min) || 0,
        max: typeof rec.max === "number" ? rec.max : Number(rec.max) || 0,
        point: typeof rec.point === "number" ? rec.point : undefined,
        unit: stringValue(rec.unit, "") || undefined,
      };
    }).filter((it) => it.label) : [];
    return withComponentRoot(node, rangePlot(slideId, name, { items, tone }));
  }
  if (componentName === "callout-marker") {
    type CMTone = "brand" | "positive" | "warning" | "danger" | "neutral";
    const tRaw = node.tone;
    const tone: CMTone | undefined = tRaw === "brand" || tRaw === "positive" || tRaw === "warning" || tRaw === "danger" || tRaw === "neutral" ? tRaw : undefined;
    const aRaw = node.anchor;
    const anchorVals = ["top-left", "top-center", "top-right", "middle-left", "middle-center", "middle-right", "bottom-left", "bottom-center", "bottom-right"];
    const anchor = typeof aRaw === "string" && anchorVals.includes(aRaw) ? aRaw as Parameters<typeof calloutMarker>[2]["anchor"] : undefined;
    return withComponentRoot(node, calloutMarker(slideId, name, {
      text: stringValue(node.text, ""),
      anchor, tone,
      width: typeof node.width === "number" ? node.width : undefined,
      height: typeof node.height === "number" ? node.height : undefined,
    }));
  }
  if (componentName === "decoration-grid") {
    const pat = node.pattern === "diagonal-lines" || node.pattern === "grid" || node.pattern === "dots" ? node.pattern : undefined;
    const den = node.density === "sparse" || node.density === "dense" || node.density === "normal" ? node.density : undefined;
    const tn = node.tone === "brand" || node.tone === "muted" ? node.tone : undefined;
    const asBg = node.asBackground === false ? false : undefined; // only forward explicit false; impl default is true
    return withComponentRoot(node, decorationGrid(slideId, name, {
      pattern: pat, density: den, tone: tn,
      rows: typeof node.rows === "number" ? node.rows : undefined,
      columns: typeof node.columns === "number" ? node.columns : undefined,
      ...(asBg === false ? { asBackground: false } : {}),
    }));
  }
  if (componentName === "corner-mark") {
    const cn = node.corner === "top-left" || node.corner === "top-right" || node.corner === "bottom-left" || node.corner === "bottom-right" ? node.corner : undefined;
    const tn = node.tone === "brand" || node.tone === "warning" || node.tone === "danger" || node.tone === "neutral" ? node.tone : undefined;
    const st = node.style === "ribbon" || node.style === "stamp" || node.style === "tag" ? node.style : undefined;
    return withComponentRoot(node, cornerMark(slideId, name, {
      text: stringValue(node.text, ""),
      corner: cn, tone: tn, style: st,
    }));
  }
  if (componentName === "bracket") {
    const dir = node.direction === "right" || node.direction === "top" || node.direction === "bottom" || node.direction === "left" ? node.direction : undefined;
    const tn = node.tone === "brand" || node.tone === "positive" || node.tone === "warning" || node.tone === "danger" ? node.tone : undefined;
    return withComponentRoot(node, bracket(slideId, name, {
      direction: dir, tone: tn,
      label: stringValue(node.label, "") || undefined,
    }));
  }
  if (componentName === "arrow-link") {
    const dir = node.direction === "down" || node.direction === "right" ? node.direction : undefined;
    const tn = node.tone === "brand" || node.tone === "positive" || node.tone === "warning" || node.tone === "danger" ? node.tone : undefined;
    return withComponentRoot(node, arrowLink(slideId, name, {
      fromLabel: stringValue(node.fromLabel, stringValue(node.from, "")) || undefined,
      toLabel: stringValue(node.toLabel, stringValue(node.to, "")) || undefined,
      label: stringValue(node.label, "") || undefined,
      direction: dir, tone: tn,
    }));
  }
  if (componentName === "watermark") {
    const tn = node.tone === "muted" || node.tone === "danger" || node.tone === "warning" || node.tone === "brand" ? node.tone : undefined;
    return withComponentRoot(node, watermark(slideId, name, {
      text: stringValue(node.text, ""),
      rotation: typeof node.rotation === "number" ? node.rotation : undefined,
      tone: tn,
    }));
  }
  if (componentName === "big-page-number") {
    const pos = node.position === "top-left" || node.position === "top-right" || node.position === "bottom-left" || node.position === "bottom-right" ? node.position : undefined;
    const tn = node.tone === "brand" || node.tone === "muted" ? node.tone : undefined;
    const cur = typeof node.current === "number" || typeof node.current === "string" ? node.current : "";
    const tot = typeof node.total === "number" || typeof node.total === "string" ? node.total : undefined;
    return withComponentRoot(node, bigPageNumber(slideId, name, {
      current: cur, total: tot, position: pos, tone: tn,
    }));
  }
  if (componentName === "timeline-axis-bar") {
    const tn = node.tone === "brand" || node.tone === "neutral" ? node.tone : undefined;
    const sections = Array.isArray(node.sections) ? node.sections.map(String) : [];
    return withComponentRoot(node, timelineAxisBar(slideId, name, {
      sections,
      current: typeof node.current === "number" ? node.current : 0,
      tone: tn,
    }));
  }
  if (componentName === "scale-bar") {
    const tn = node.tone === "brand" || node.tone === "neutral" ? node.tone : undefined;
    return withComponentRoot(node, scaleBar(slideId, name, {
      max: typeof node.max === "number" ? node.max : Number(node.max) || 100,
      min: typeof node.min === "number" ? node.min : undefined,
      unit: stringValue(node.unit, "") || undefined,
      ticks: typeof node.ticks === "number" ? node.ticks : undefined,
      tone: tn,
    }));
  }
  if (componentName === "two-column") {
    const left = node.left && typeof node.left === "object" ? node.left as DomNode : { id: `${slideId}.${name}.left.empty`, type: "spacer" };
    const right = node.right && typeof node.right === "object" ? node.right as DomNode : { id: `${slideId}.${name}.right.empty`, type: "spacer" };
    return withComponentRoot(node, {
      id: `${slideId}.${name}`,
      type: "split",
      direction: "horizontal",
      ratio: Array.isArray(node.ratio) ? node.ratio : [0.5, 0.5],
      gap: typeof node.gap === "number" ? node.gap : 0.7,
      children: [left, right],
    });
  }
  if (componentName === "quiz-card") {
    const itemsRaw = Array.isArray(node.items) ? node.items
      : Array.isArray(node.options) ? node.options
      : Array.isArray(node.choices) ? node.choices
      : [];
    const items = itemsRaw.map((it) => typeof it === "string" ? it : (it && typeof it === "object" && "text" in it ? String((it as { text: unknown }).text) : String(it ?? "")));
    const toneRaw = node.tone;
    const tone = toneRaw === "brand" || toneRaw === "neutral" || toneRaw === "tinted" ? toneRaw : undefined;
    // `correct` accepts a letter ("A"|"B"|...), a 0-based index, or a
    // numeric string. Pass through whichever the agent supplied.
    const correctRaw = node.correct ?? node.answer;
    const correct: string | number | undefined = typeof correctRaw === "number" || typeof correctRaw === "string"
      ? correctRaw
      : undefined;
    return withComponentRoot(node, quizCard(slideId, name, {
      question: stringValue(node.question, stringValue(node.stem, stringValue(node.prompt, stringValue(node.text, "")))),
      items,
      correct,
      explanation: stringValue(node.explanation, stringValue(node.rationale, stringValue(node.answer_text, ""))) || undefined,
      number: stringValue(node.number, stringValue(node.label, "")) || undefined,
      questionType: stringValue(node.questionType, stringValue(node.type_, "")) || undefined,
      tone,
    }));
  }
  if (componentName === "outline") {
    type OutlineTone = "brand" | "positive" | "warning" | "danger";
    const items: Array<{ number?: string; title: string; body?: string; page?: string | number; tone?: OutlineTone }> = Array.isArray(node.items) ? node.items.map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : { title: String(raw ?? "") };
      const toneRaw = rec.tone;
      const tone: OutlineTone | undefined = toneRaw === "brand" || toneRaw === "positive" || toneRaw === "warning" || toneRaw === "danger" ? toneRaw : undefined;
      const pageRaw = rec.page ?? rec.pageNumber;
      const page: string | number | undefined = typeof pageRaw === "number" || typeof pageRaw === "string" ? pageRaw : undefined;
      return {
        number: stringValue(rec.number, stringValue(rec.num, "")) || undefined,
        title: stringValue(rec.title, stringValue(rec.label, stringValue(rec.name, ""))),
        body: stringValue(rec.body, stringValue(rec.description, stringValue(rec.text, ""))) || undefined,
        page,
        tone,
      };
    }).filter((item) => item.title) : [];
    const tone = node.tone === "brand" || node.tone === "neutral" ? node.tone : undefined;
    const density = node.density === "comfortable" || node.density === "compact" || node.density === "auto" ? node.density : undefined;
    return withComponentRoot(node, outline(slideId, name, {
      items,
      showPages: node.showPages === true,
      density,
      tone,
    }));
  }
  if (componentName === "glossary") {
    const items = Array.isArray(node.items) ? node.items.map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : { term: String(raw ?? "") };
      return {
        term: stringValue(rec.term, stringValue(rec.name, stringValue(rec.label, ""))),
        definition: stringValue(rec.definition, stringValue(rec.body, stringValue(rec.description, ""))),
      };
    }).filter((item) => item.term) : [];
    const layout = node.layout === "two-column" ? "two-column" : "list";
    return withComponentRoot(node, glossary(slideId, name, { items, layout }));
  }
  if (componentName === "q-and-a") {
    const items = Array.isArray(node.items) ? node.items.map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : { q: "", a: String(raw ?? "") };
      return {
        q: stringValue(rec.q, stringValue(rec.question, stringValue(rec.prompt, ""))),
        a: stringValue(rec.a, stringValue(rec.answer, stringValue(rec.response, ""))),
      };
    }).filter((item) => item.q && item.a) : [];
    const density = node.density === "comfortable" || node.density === "compact" ? node.density : undefined;
    return withComponentRoot(node, qAndA(slideId, name, { items, density }));
  }
  if (componentName === "comparison-table") {
    const features = Array.isArray(node.features) ? node.features.map(String) : [];
    const opts = Array.isArray(node.options) ? node.options.map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : { name: String(raw ?? "") };
      const values = Array.isArray(rec.values) ? rec.values.map((v) => v === undefined || v === null ? "" : String(v))
        : Array.isArray(rec.row) ? rec.row.map((v) => v === undefined || v === null ? "" : String(v))
        : [];
      return {
        name: stringValue(rec.name, stringValue(rec.label, stringValue(rec.title, ""))),
        values,
        recommended: rec.recommended === true,
      };
    }).filter((opt) => opt.name) : [];
    return withComponentRoot(node, comparisonTable(slideId, name, {
      features,
      options: opts,
      title: stringValue(node.title, "") || undefined,
    }));
  }
  if (componentName === "takeaway-list") {
    type TakeawayTone = "brand" | "positive" | "warning" | "danger" | "neutral";
    const allowed = new Set<string>(["brand", "positive", "warning", "danger", "neutral"]);
    const coerce = (v: unknown): TakeawayTone | undefined => {
      const norm = normalizeToneAlias(v);
      return norm && allowed.has(norm) ? norm as TakeawayTone : undefined;
    };
    const items: Array<{ headline: string; detail?: string; tone?: TakeawayTone }> = Array.isArray(node.items) ? node.items.map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : { headline: String(raw ?? "") };
      return {
        headline: stringValue(rec.headline, stringValue(rec.title, stringValue(rec.text, ""))),
        detail: stringValue(rec.detail, stringValue(rec.body, stringValue(rec.description, ""))) || undefined,
        tone: coerce(rec.tone),
      };
    }).filter((item) => item.headline) : [];
    const tone = coerce(node.tone);
    return withComponentRoot(node, takeawayList(slideId, name, { items, tone }));
  }
  return withComponentRoot(node, { id: node.id, type: "stack", direction: "vertical", children: [] });
}

function primitiveComponentDescriptions(): ComponentDescription[] {
  return PRIMITIVE_COMPONENT_TYPES.map((type) => primitiveComponentDescription(type)).filter((item): item is ComponentDescription => Boolean(item));
}

function primitiveComponentDescription(name: string): ComponentDescription | null {
  const primitiveType = primitiveComponentType(name);
  if (!primitiveType) return null;
  const node = listNodeTypes().find((item) => item.type === primitiveType);
  if (!node) return null;
  return {
    name: primitiveType,
    purpose: node.use,
    fields: primitiveFields(node.fieldsDetailed),
    children: {
      allowed: Boolean(node.acceptsChildren?.length),
      accepts: node.acceptsChildren,
      required: primitiveType === "stack" || primitiveType === "grid",
    },
    examples: [primitiveExample(primitiveType)],
    layoutBehavior: primitiveLayoutBehavior(primitiveType),
    renderBehavior: {
      expandsTo: primitiveType,
      themeTokens: primitiveThemeTokens(primitiveType),
    },
  };
}

function primitiveComponentType(name: string): PrimitiveComponentType | null {
  return (PRIMITIVE_COMPONENT_TYPES as readonly string[]).includes(name) ? name as PrimitiveComponentType : null;
}

function primitiveComponentNode(slideId: string, type: PrimitiveComponentType, node: DomNode): DomNode {
  const { component: _component, ...rest } = node;
  return {
    ...rest,
    id: node.id || `${slideId}.${type}`,
    type,
  };
}

function componentLocalId(slideId: string, id: unknown): string {
  if (typeof id !== "string" || !id) return `auto.${slideId}.node`;
  const prefix = `${slideId}.`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

function withComponentRoot(source: DomNode, expanded: DomNode): DomNode {
  return {
    ...expanded,
    ...layoutProps(source),
    id: source.id || expanded.id,
  };
}

function layoutProps(node: DomNode): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of [
    "area",
    "fixedWidth",
    "fixedHeight",
    "minWidth",
    "minHeight",
    "maxWidth",
    "maxHeight",
    "layoutWeight",
    "optional",
    "anchor",
    "offsetX",
    "offsetY",
    "width",
    "height",
    "zIndex",
    "fill",
    "line",
    "padding",
    "cornerRadius",
    "role",
    "align",
    "valign",
    "justify",
    "colSpan",
    "rowSpan",
    "rotation",
    "flipH",
    "flipV",
    // autoFit / size dial / typography hints flow through component expansion
    // so an agent can set autoFit:"shrink" on slide.title and have it reach
    // the rendered text shape.
    "autoFit",
    "size",
    "weight",
    "letterSpacing",
    "uppercase",
  ]) {
    if (node[key] !== undefined) output[key] = node[key];
  }
  return output;
}

function surfaceTone(tone: unknown): "neutral" | "brand" | "tinted" {
  if (tone === "brand" || tone === "tinted") return tone;
  return "neutral";
}

function cardToneProps(tone: unknown): Record<string, unknown> {
  const normalized = surfaceTone(tone);
  if (normalized === "brand") return { fill: "brand.tint", line: "brand.primary" };
  if (normalized === "tinted") return { fill: "surface.subtle", line: "divider" };
  return { fill: "surface", line: "divider" };
}

function imageCardNode(slideId: string, name: string, node: DomNode): DomNode {
  const title = stringValue(node.title, "");
  const caption = stringValue(node.caption, "");
  return {
    id: `${slideId}.${name}`,
    type: "card",
    role: "image-card",
    padding: 0.45,
    ...cardToneProps(node.tone),
    children: [{
      id: `${slideId}.${name}.stack`,
      type: "stack",
      direction: "vertical",
      gap: 0.25,
      children: [
        ...(title ? [{ id: `${slideId}.${name}.title`, type: "text" as const, text: title, style: "card-title", fixedHeight: 0.65 }] : []),
        {
          id: `${slideId}.${name}.image`,
          type: "image",
          src: stringValue(node.src, ""),
          alt: stringValue(node.alt, title || "image"),
          fit: node.fit === "cover" || node.fit === "fill" ? node.fit : "contain",
          layoutWeight: 1,
        },
        // Caption is optional+autoFit so when the image-card sits in a tight
        // fixedHeight slot the layout solver drops/shrinks the caption rather
        // than triggering FALLBACK_FAILED on the parent.
        ...(caption ? [{ id: `${slideId}.${name}.caption`, type: "text" as const, text: caption, style: "figure-caption", align: "center" as const, minHeight: 0.4, autoFit: "shrink" as const, optional: true }] : []),
      ],
    }],
  };
}

function chartCardNode(slideId: string, name: string, node: DomNode): DomNode {
  const title = stringValue(node.title, "");
  const caption = stringValue(node.caption, "");
  const data = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
  // 96vi8n slide 14: chart-card with only title+chart (no caption) had
  // padding 0.45 + gap 0.25 + title 0.65, eating ~1.4cm of the card's
  // ~8cm height — the chart looked cramped against the title and the
  // card felt empty around it. When the card has no caption, we tighten
  // padding (0.45→0.35) and gap (0.25→0.18) so the chart gets more room.
  const lean = !caption;
  const padding = lean ? 0.35 : 0.45;
  const gap = lean ? 0.18 : 0.25;
  return {
    id: `${slideId}.${name}`,
    type: "card",
    role: "chart-card",
    padding,
    ...cardToneProps(node.tone),
    children: [{
      id: `${slideId}.${name}.stack`,
      type: "stack",
      direction: "vertical",
      gap,
      children: [
        ...(title ? [{ id: `${slideId}.${name}.title`, type: "text" as const, text: title, style: "card-title", fixedHeight: 0.65 }] : []),
        {
          id: `${slideId}.${name}.chart`,
          type: "chart",
          chartType: node.chartType || node.chart,
          labels: arrayValue(node.labels, data.labels),
          series: arrayValue(node.series, data.series),
          showLegend: node.showLegend,
          showValues: node.showValues,
          yFormat: node.yFormat,
          colors: node.colors,
          annotations: node.annotations,
          layoutWeight: 1,
        },
        ...(caption ? [{ id: `${slideId}.${name}.caption`, type: "text" as const, text: caption, style: "source-note", color: "text.muted", fixedHeight: 0.45 }] : []),
      ],
    }],
  };
}

function tableCardNode(slideId: string, name: string, node: DomNode): DomNode {
  const title = stringValue(node.title, "");
  const caption = stringValue(node.caption, "");
  const data = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
  return {
    id: `${slideId}.${name}`,
    type: "card",
    role: "table-card",
    padding: 0.45,
    ...cardToneProps(node.tone),
    children: [{
      id: `${slideId}.${name}.stack`,
      type: "stack",
      direction: "vertical",
      gap: 0.25,
      children: [
        ...(title ? [{ id: `${slideId}.${name}.title`, type: "text" as const, text: title, style: "card-title", fixedHeight: 0.65 }] : []),
        {
          id: `${slideId}.${name}.table`,
          type: "table",
          headers: node.headers || data.headers,
          columns: node.columns,
          rows: node.rows || data.rows || node.items,
          firstRowHeader: node.firstRowHeader,
          colWidths: node.colWidths,
          rowHeights: node.rowHeights,
          borderColor: node.borderColor,
          borderWidth: node.borderWidth,
          layoutWeight: 1,
        },
        ...(caption ? [{ id: `${slideId}.${name}.caption`, type: "text" as const, text: caption, style: "source-note", color: "text.muted", fixedHeight: 0.45 }] : []),
      ],
    }],
  };
}

function insightCardNode(slideId: string, name: string, node: DomNode): DomNode {
  const tone = node.tone === "positive" || node.tone === "warning" || node.tone === "danger" || node.tone === "brand" ? node.tone : "neutral";
  const children: DomNode[] = [];
  const badgeText = stringValue(node.badge, "");
  if (badgeText) {
    // 761q1u fix: when 4 insight-cards are packed into a 2x2 grid, each
    // cell is allocated ~1.5cm — far less than badge(0.7) + headline(0.55)
    // + detail(~1cm). Marking the badge optional lets the fallback ladder
    // drop it when space is tight, instead of FALLBACK_FAILED.
    const b = badge(slideId, `${name}.badge`, { text: badgeText, tone: tone === "neutral" ? "brand" : tone });
    children.push({ ...b, optional: true } as DomNode);
  }
  children.push({ id: `${slideId}.${name}.headline`, type: "text", text: stringValue(node.headline, stringValue(node.title, "")), style: "card-title", color: tone === "neutral" ? "text.primary" : toneToColors(tone).fg, minHeight: 0.55, autoFit: "shrink" });
  const detail = stringValue(node.detail, stringValue(node.body, stringValue(node.description, "")));
  if (detail) children.push({ id: `${slideId}.${name}.detail`, type: "text", text: detail, style: "paragraph", color: "text.primary", autoFit: "shrink", optional: true });
  const bullets = stringArray(node.bullets).length ? stringArray(node.bullets) : stringArray(node.items).length ? stringArray(node.items) : stringArray(node.points);
  if (bullets.length > 0) children.push(bulletList(slideId, `${name}.bullets`, bullets, "compact"));
  return {
    id: `${slideId}.${name}`,
    type: "card",
    role: "insight-card",
    padding: 0.5,
    ...(tone === "neutral" ? cardToneProps("neutral") : tonePropsFrom(tone)),
    children: [{
      id: `${slideId}.${name}.stack`,
      type: "stack",
      direction: "vertical",
      gap: 0.25,
      children,
    }],
  };
}

function primitiveFields(detailed: Record<string, import("./node-types.js").NodeFieldInfo>): Record<string, PropDefinition> {
  return Object.fromEntries(Object.entries(detailed).map(([key, info]) => [
    key,
    {
      type: info.valueType,
      required: info.required,
      description: info.description,
      ...(info.values ? { enum: info.values, values: info.values } : {}),
      ...(info.max !== undefined ? { max: info.max } : {}),
    } satisfies PropDefinition,
  ]));
}

function primitiveExample(type: PrimitiveComponentType): DomNode {
  if (type === "stack") {
    return {
      id: "example.stack",
      type: "stack",
      direction: "vertical",
      gap: 0.4,
      children: [
        { id: "example.stack.text", type: "text", text: "One key message" },
      ],
    };
  }
  if (type === "grid") {
    return {
      id: "example.grid",
      type: "grid",
      columns: 2,
      gap: 0.5,
      children: [
        { id: "example.grid.left", type: "callout", text: "Left insight" },
        { id: "example.grid.right", type: "callout", text: "Right insight" },
      ],
    };
  }
  if (type === "spacer") return { id: "example.spacer", type: "spacer", fixedHeight: 0.5 };
  if (type === "divider") return { id: "example.divider", type: "divider", orientation: "horizontal" };
  if (type === "bullets") return { id: "example.bullets", type: "bullets", items: ["Point one", "Point two"] };
  if (type === "image") return { id: "example.image", type: "image", src: "/absolute/path/image.png", alt: "Image", caption: "Optional caption" };
  if (type === "table") return { id: "example.table", type: "table", headers: ["A", "B"], rows: [["1", "2"]], caption: "Optional caption" };
  if (type === "chart") return { id: "example.chart", type: "chart", chartType: "bar", labels: ["Q1", "Q2"], series: [{ name: "Revenue", values: [1, 2] }] };
  if (type === "panel") return { id: "example.panel", type: "panel", tone: "tinted", children: [{ id: "example.panel.body", type: "text", text: "Grouped content." }] };
  if (type === "card") return { id: "example.card", type: "card", header: "Engagement", accent: "left", children: [{ id: "example.card.body", type: "text", text: "78% retention week one." }] };
  if (type === "band") return { id: "example.band", type: "band", tone: "brand", height: 1.6, children: [{ id: "example.band.text", type: "text", text: "Section: outlook", style: "section-title", color: "brand.primary" }] };
  if (type === "frame") return { id: "example.frame", type: "frame", dash: "dash", children: [{ id: "example.frame.body", type: "text", text: "TBD region" }] };
  if (type === "inset") return { id: "example.inset", type: "inset", padding: 0.5, children: [{ id: "example.inset.body", type: "text", text: "Indented child." }] };
  return { id: "example.shape", type: "shape", preset: "rect", fill: "surface" };
}

function primitiveLayoutBehavior(type: PrimitiveComponentType): ComponentDescription["layoutBehavior"] {
  if (type === "stack" || type === "grid") return { intrinsicSize: "collection", canGrow: true };
  if (type === "image" || type === "chart") return { intrinsicSize: "media", canGrow: true, preferredParent: "grid" };
  if (type === "table") return { intrinsicSize: "collection", canGrow: true, preferredParent: "stack" };
  if (type === "spacer" || type === "divider" || type === "shape") return { intrinsicSize: "fill", canGrow: true };
  if (type === "panel" || type === "card") return { intrinsicSize: "card", canGrow: true, preferredParent: "grid" };
  if (type === "band") return { intrinsicSize: "fill", canGrow: true, preferredParent: "stack" };
  if (type === "frame" || type === "inset") return { intrinsicSize: "card", canGrow: true, preferredParent: "stack" };
  return { intrinsicSize: "text", canGrow: false, preferredParent: "stack" };
}

function primitiveThemeTokens(type: PrimitiveComponentType): string[] {
  if (type === "divider" || type === "shape") return ["surface", "divider", "brand.primary"];
  if (type === "table" || type === "chart") return ["text.primary", "text.muted", "brand.primary", "surface", "divider"];
  return ["text.primary", "text.muted"];
}

function component(name: ComponentName, purpose: string, fields: Record<string, PropDefinition>, expandsTo: string, preferredParent: "stack" | "grid"): ComponentDefinition {
  return {
    name,
    category: "content",
    purpose,
    fields,
    children: { allowed: false },
    layoutBehavior: { intrinsicSize: "card", canGrow: true, preferredParent },
    renderBehavior: { expandsTo, themeTokens: ["surface", "divider", "brand.primary", "text.primary", "text.muted"] },
    examples: [{ type: name, ...Object.fromEntries(Object.entries(fields).filter(([, prop]) => prop.required).map(([key]) => [key, key])) }],
  };
}

function containerComponent(name: ComponentName, purpose: string, fields: Record<string, PropDefinition>, expandsTo: string, preferredParent: "stack" | "grid"): ComponentDefinition {
  return {
    name,
    category: "chrome",
    purpose,
    fields,
    children: { allowed: true },
    layoutBehavior: { intrinsicSize: "card", canGrow: true, preferredParent },
    renderBehavior: { expandsTo, themeTokens: ["surface", "divider", "brand.primary", "text.primary", "text.muted"] },
    examples: [{ type: name, title: "Context", children: [{ id: "example.rail.note", type: "text", text: "Supporting context" }] }],
  };
}

function textComponent(name: ComponentName, purpose: string, style: string, extraFields: Record<string, PropDefinition> = {}): ComponentDefinition {
  return {
    name,
    category: "content",
    purpose,
    fields: {
      text: { type: "string", required: true, description: "Text content." },
      align: { type: "enum", enum: ["left", "center", "right"], description: "Optional alignment." },
      ...extraFields,
    },
    children: { allowed: false },
    layoutBehavior: { intrinsicSize: "text", canGrow: false, preferredParent: "stack" },
    renderBehavior: { expandsTo: `text.${style}`, themeTokens: ["text.primary", "text.muted", "brand.primary"] },
    examples: [{ type: name, text: "Text" }],
  };
}

function articleComponent(): ComponentDefinition {
  return {
    name: "article",
    category: "collection",
    purpose: "Flow one long article across as many slides as needed.",
    fields: {
      title: { type: "string", description: "Optional article title. Falls back to slide title." },
      text: { type: "string", description: "Full article text. Paragraphs may be separated by blank lines." },
      paragraphs: { type: "array", description: "Optional array of paragraph strings." },
      source: { type: "string", description: "Optional source note rendered on the last generated page." },
    },
    children: { allowed: false },
    layoutBehavior: { intrinsicSize: "collection", canGrow: true, preferredParent: "stack" },
    renderBehavior: { expandsTo: "multiple slides with internal text.article nodes", themeTokens: ["text.primary", "text.muted"] },
    examples: [{ type: "article", title: "Reading Passage", paragraphs: ["Paragraph one.", "Paragraph two."], source: "Source note" }],
  };
}

function semanticTextStyle(componentName: string): string {
  if (componentName === "deck-title") return "deck-title";
  if (componentName === "slide-title") return "slide-title";
  if (componentName === "h1") return "section-title";
  if (componentName === "h2") return "card-title";
  if (componentName === "lead") return "lead";
  if (componentName === "text") return "paragraph";
  if (componentName === "source-note") return "footnote";
  if (componentName === "label") return "label";
  if (componentName === "code") return "code";
  return "";
}

function articleFallback(slideId: string, name: string, node: DomNode): DomNode {
  const paragraphs = articleParagraphs(node).slice(0, 3);
  return {
    id: `${slideId}.${name}.fallback`,
    type: "stack",
    direction: "vertical",
    gap: 0.25,
    children: paragraphs.map((text, index) => ({
      id: `${slideId}.${name}.p${index + 1}`,
      type: "text",
      text,
      style: "article",
    })),
  };
}

function articleParagraphs(node: DomNode): string[] {
  if (Array.isArray(node.paragraphs)) return node.paragraphs.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof node.text === "string") return node.text.split(/\n\s*\n/g).map((item) => item.trim()).filter(Boolean);
  return [];
}

function textComponentNode(slideId: string, name: string, text: string, style: string, fields: Record<string, unknown>): DomNode {
  const caption = stringValue(fields.caption, "");
  const title = style === "code" ? stringValue(fields.title, stringValue(fields.language, "")) : "";
  const visualStyle = style === "label" && (fields.variant === "badge" || fields.variant === "tag") ? String(fields.variant) : style;
  const resolvedColor = resolveTextColor(fields.color, fields.tone);
  if (!caption && !title) {
    return {
      id: `${slideId}.${name}`,
      type: "text",
      text,
      style: visualStyle,
      align: fields.align,
      color: resolvedColor,
      fixedHeight: fields.fixedHeight,
      layoutWeight: fields.layoutWeight,
    };
  }
  return {
    id: `${slideId}.${name}`,
    type: "stack",
    direction: "vertical",
    gap: 0.15,
    fixedHeight: fields.fixedHeight,
    layoutWeight: fields.layoutWeight,
    children: [
      ...(title ? [{
        id: `${slideId}.${name}.title`,
        type: "text" as const,
        text: title,
        style: "card-title",
        fixedHeight: 0.5,
      }] : []),
      {
        id: `${slideId}.${name}.text`,
        type: "text",
        text,
        style: visualStyle,
        align: fields.align,
        color: resolvedColor,
        layoutWeight: caption ? 1 : fields.layoutWeight,
      },
      ...(caption ? [{
        id: `${slideId}.${name}.caption`,
        type: "text" as const,
        text: caption,
        style: "code-caption",
        align: fields.align || "left",
        fixedHeight: 0.42,
      }] : []),
    ],
  };
}

function definitionCard(slideId: string, name: string, term: string, definition: string): DomNode {
  return {
    id: `${slideId}.${name}`,
    type: "stack",
    direction: "vertical",
    gap: 0.2,
    role: "definition-card",
    fill: "surface",
    line: "divider",
    padding: 0.35,
    children: [
      { id: `${slideId}.${name}.term`, type: "text", text: term, style: "card-title", color: "brand.primary" },
      { id: `${slideId}.${name}.definition`, type: "text", text: definition, style: "paragraph" },
    ],
  };
}

function accentRuleNode(slideId: string, name: string, node: DomNode): DomNode {
  const direction = node.direction === "vertical" ? "vertical" : "horizontal";
  const tone = toneToColors(node.tone);
  const colorToken = tone.line || "brand.primary";
  const length = typeof node.length === "number" ? node.length : direction === "horizontal" ? 2.2 : 1.4;
  const thickness = typeof node.thickness === "number" ? node.thickness : 0.08;
  return {
    id: `${slideId}.${name}`,
    type: "shape",
    preset: "rect",
    fill: colorToken,
    line: colorToken,
    fixedWidth: direction === "horizontal" ? length : thickness,
    fixedHeight: direction === "horizontal" ? thickness : length,
    align: "start",
  };
}

function titleLockupNode(slideId: string, name: string, node: DomNode): DomNode {
  const align = node.align === "center" || node.align === "right" ? node.align : "left";
  const tone = node.tone === "inverse" ? "inverse" : node.tone === "brand" ? "brand" : "neutral";
  const titleColor = tone === "inverse" ? "text.inverse" : tone === "brand" ? "brand.primary" : "text.primary";
  const secondaryColor = tone === "inverse" ? "text.inverse" : "text.muted";
  const accentTone = tone === "neutral" ? "brand" : tone;
  const children: DomNode[] = [];
  const eyebrowText = stringValue(node.eyebrow, "");
  if (eyebrowText) {
    children.push({
      ...eyebrowNode(slideId, `${name}.eyebrow`, { id: `${slideId}.${name}.eyebrow`, type: "eyebrow", text: eyebrowText, tone: accentTone, rule: false }),
      align,
    });
  }
  children.push({
    id: `${slideId}.${name}.title`,
    type: "text",
    text: stringValue(node.title, ""),
    style: "deck-title",
    color: titleColor,
    align,
    valign: "middle",
    autoFit: "shrink",
    fixedHeight: 2.3,
  });
  if (node.rule === true) {
    children.push({
      ...accentRuleNode(slideId, `${name}.rule`, {
        id: `${slideId}.${name}.rule`,
        type: "accent-rule",
        direction: "horizontal",
        tone: accentTone,
        length: align === "center" ? 2.4 : 3.2,
        thickness: 0.07,
      }),
      align,
    });
  }
  const subtitle = stringValue(node.subtitle, "");
  if (subtitle) {
    children.push({
      id: `${slideId}.${name}.subtitle`,
      type: "text",
      text: subtitle,
      style: "lead",
      color: secondaryColor,
      align,
      valign: "top",
      fixedHeight: 0.9,
    });
  }
  const lockup: DomNode = {
    id: `${slideId}.${name}.inner`,
    type: "stack",
    direction: "vertical",
    gap: 0.28,
    role: "title-lockup",
    align,
    justify: "center",
    children,
  };
  // tone:"inverse" promises white text. Wrap in a brand-fill band so the
  // promise holds independent of the slide background. Otherwise an
  // {tone:"inverse"} on a default light deck silently produces unreadable text.
  if (tone === "inverse") {
    return {
      id: `${slideId}.${name}`,
      type: "band",
      fill: "brand.primary",
      padding: 0.6,
      role: "title-lockup",
      children: [lockup],
    };
  }
  return { ...lockup, id: `${slideId}.${name}` };
}

function eyebrowNode(slideId: string, name: string, node: DomNode): DomNode {
  const tone = toneToColors(node.tone);
  const text: DomNode = {
    id: `${slideId}.${name}.text`,
    type: "text",
    text: stringValue(node.text, ""),
    style: "label",
    size: "sm",
    weight: "bold",
    color: tone.fg || "brand.primary",
    uppercase: true,
    letterSpacing: 120,
    align: "left",
    valign: "middle",
    fixedHeight: 0.46,
  };
  if (node.rule !== true) return { ...text, id: `${slideId}.${name}` };
  return {
    id: `${slideId}.${name}`,
    type: "stack",
    direction: "horizontal",
    gap: 0.25,
    role: "eyebrow",
    align: "start",
    valign: "middle",
    fixedHeight: 0.5,
    children: [
      text,
      { ...accentRuleNode(slideId, `${name}.rule`, { id: `${slideId}.${name}.rule`, type: "accent-rule", direction: "horizontal", tone: node.tone, length: 1.1, thickness: 0.05 }), align: "center" },
    ],
  };
}

function annotationNode(slideId: string, name: string, node: DomNode): DomNode {
  const tone = toneToColors(node.tone);
  const children: DomNode[] = [
    {
      id: `${slideId}.${name}.label`,
      type: "text",
      text: stringValue(node.label, ""),
      style: "label",
      size: "sm",
      weight: "bold",
      color: tone.fg || "brand.primary",
      uppercase: true,
      letterSpacing: 80,
      fixedHeight: 0.45,
    },
    accentRuleNode(slideId, `${name}.rule`, { id: `${slideId}.${name}.rule`, type: "accent-rule", direction: "horizontal", tone: node.tone, length: 1.4, thickness: 0.05 }),
  ];
  const text = stringValue(node.text, "");
  if (text) children.push({ id: `${slideId}.${name}.text`, type: "text", text, style: "caption", color: "text.primary", valign: "top" });
  return {
    id: `${slideId}.${name}`,
    type: "stack",
    direction: "vertical",
    gap: 0.16,
    role: "annotation",
    children,
  };
}

function sideRailNode(slideId: string, name: string, node: DomNode): DomNode {
  const toneRaw = node.tone === "positive" || node.tone === "warning" || node.tone === "danger" || node.tone === "brand" || node.tone === "tinted" ? node.tone : "neutral";
  const tone = toneToColors(toneRaw);
  const title = stringValue(node.title, "");
  const body = stringValue(node.body, "");
  const children: DomNode[] = [
    ...(title ? [{ id: `${slideId}.${name}.title`, type: "text" as const, text: title, style: "card-title", color: tone.fg || "text.primary", minHeight: 0.55, autoFit: "shrink" as const }] : []),
    ...(body ? [{ id: `${slideId}.${name}.body`, type: "text" as const, text: body, style: "caption", color: "text.primary", valign: "top" as const }] : []),
    ...((node.children || []) as DomNode[]),
  ];
  return {
    id: `${slideId}.${name}`,
    type: "card",
    role: "side-rail",
    fill: tone.bg || (toneRaw === "tinted" ? "brand.tint" : "surface"),
    line: tone.line || "divider",
    accent: node.accent === "top" ? "top" : "left",
    accentColor: tone.line || "brand.primary",
    padding: 0.5,
    cornerRadius: 0.08,
    children: [{
      id: `${slideId}.${name}.stack`,
      type: "stack",
      direction: "vertical",
      gap: 0.25,
      children: children.length ? children : [{ id: `${slideId}.${name}.empty`, type: "spacer", fixedHeight: 0.1 }],
    }],
  };
}

function axisRulerNode(slideId: string, name: string, node: DomNode): DomNode {
  const direction = node.direction === "vertical" ? "vertical" : "horizontal";
  const items = Array.isArray(node.items) ? node.items.map((raw) => {
    const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : { label: String(raw ?? "") };
    return {
      label: stringValue(rec.label, stringValue(rec.title, stringValue(rec.name, ""))),
      body: stringValue(rec.body, stringValue(rec.text, stringValue(rec.description, ""))),
      tone: stringValue(rec.tone, stringValue(node.tone, "brand")),
    };
  }).filter((item) => item.label) : [];
  if (direction === "vertical") {
    return {
      id: `${slideId}.${name}`,
      type: "stack",
      direction: "vertical",
      gap: 0.18,
      role: "axis-ruler",
      children: items.map((item, index) => axisRulerItem(slideId, name, item, index, "vertical")),
    };
  }
  return {
    id: `${slideId}.${name}`,
    type: "stack",
    direction: "vertical",
    gap: 0.2,
    role: "axis-ruler",
    children: [
      { id: `${slideId}.${name}.line`, type: "divider", orientation: "horizontal", line: toneToColors(node.tone).line || "brand.primary", thickness: 0.05, fixedHeight: 0.12 },
      {
        id: `${slideId}.${name}.items`,
        type: "grid",
        columns: Math.max(1, items.length),
        gap: 0.35,
        children: items.map((item, index) => axisRulerItem(slideId, name, item, index, "horizontal")),
      },
    ],
  };
}

function axisRulerItem(slideId: string, name: string, item: { label: string; body?: string; tone?: string }, index: number, direction: "horizontal" | "vertical"): DomNode {
  const tone = toneToColors(item.tone);
  const markerColor = tone.line || "brand.primary";
  const marker: DomNode = {
    id: `${slideId}.${name}.${index}.marker`,
    type: "shape",
    preset: "ellipse",
    fill: markerColor,
    line: markerColor,
    fixedWidth: 0.32,
    fixedHeight: 0.32,
    align: direction === "horizontal" ? "center" : "start",
  };
  // umzrkm fix: label color was markerColor (= brand.primary by default).
  // Mid-saturation brand themes failed 4.5:1 contrast on light surfaces.
  // The marker shape carries the brand color visually; the label reads
  // at body weight against the slide bg, so it must use text.primary.
  const label: DomNode = { id: `${slideId}.${name}.${index}.label`, type: "text", text: item.label, style: "label", color: "text.primary", align: direction === "horizontal" ? "center" : "left", fixedHeight: 0.45 };
  const body = item.body ? [{ id: `${slideId}.${name}.${index}.body`, type: "text" as const, text: item.body, style: "caption", color: "text.muted", align: direction === "horizontal" ? "center" as const : "left" as const, valign: "top" as const }] : [];
  return {
    id: `${slideId}.${name}.${index}`,
    type: "stack",
    direction: direction === "horizontal" ? "vertical" : "horizontal",
    gap: direction === "horizontal" ? 0.12 : 0.25,
    role: "axis-ruler-item",
    align: direction === "horizontal" ? "center" : "start",
    valign: "middle",
    children: direction === "horizontal" ? [marker, label, ...body] : [marker, { id: `${slideId}.${name}.${index}.copy`, type: "stack", direction: "vertical", gap: 0.1, children: [label, ...body] }],
  };
}


function comparisonPoints(fields: Record<string, unknown>): string[] {
  const points = stringArray(fields.points);
  if (points.length > 0) return points;
  const items = stringArray(fields.items);
  if (items.length > 0) return items;
  return [stringValue(fields.subtitle, ""), stringValue(fields.body, "")].filter(Boolean);
}

/**
 * Resolve a text node color by preferring an explicit color, then mapping a
 * semantic tone to its fg token, and finally falling back to text.primary so a
 * caller passing only `tone:"neutral"` doesn't leak the literal "neutral" string
 * into the renderer (which produces UNKNOWN_COLOR).
 */
export function resolveTextColor(rawColor: unknown, rawTone: unknown): string {
  if (typeof rawColor === "string" && rawColor.trim()) return rawColor;
  const fg = toneToColors(rawTone).fg;
  if (fg) return fg;
  return "text.primary";
}

export function toneToColors(tone: unknown): { fg?: string; bg?: string; line?: string } {
  const t = normalizeToneAlias(tone);
  if (t === "inverse") return { fg: "text.inverse", line: "text.inverse" };
  if (t === "positive") return { fg: "success", bg: "success.tint", line: "success" };
  if (t === "warning") return { fg: "warning", bg: "warning.tint", line: "warning" };
  if (t === "danger") return { fg: "danger", bg: "danger.tint", line: "danger" };
  if (t === "brand") return { fg: "brand.primary", bg: "brand.tint", line: "brand.primary" };
  if (t === "neutral") return { fg: "text.primary", bg: "surface", line: "divider" };
  return {};
}

/**
 * Normalize tone aliases to the canonical vocabulary used across components.
 * Agents commonly mix the theme-token names (success/error/caution) with the
 * semantic words (positive/danger/warning) — both should work. Without this
 * shim, an agent writing `tone:"success"` on a stat-strip cell silently
 * falls through to the strip default. (qtt7dd log slide 4: KPI values
 * tone="success"|"warning"|"danger" intended green/orange/red but rendered
 * blue/blue/red because "success" wasn't in the allowed set.)
 *
 * Returns undefined for non-strings; lets callers keep their own fallback.
 */
export function normalizeToneAlias(tone: unknown): string | undefined {
  if (typeof tone !== "string") return undefined;
  const t = tone.trim().toLowerCase();
  if (!t) return undefined;
  // Synonyms → canonical.
  if (t === "success" || t === "good" || t === "positive") return "positive";
  if (t === "error" || t === "bad" || t === "negative" || t === "danger") return "danger";
  if (t === "caution" || t === "warn" || t === "warning") return "warning";
  if (t === "info" || t === "primary" || t === "brand") return "brand";
  if (t === "muted" || t === "subtle" || t === "neutral") return "neutral";
  if (t === "inverse" || t === "white") return "inverse";
  return t; // pass through unknowns; caller decides whether to accept.
}

function tonePropsFrom(tone: unknown): Record<string, unknown> {
  const mapped = toneToColors(tone);
  const out: Record<string, unknown> = {};
  if (mapped.bg) out.fill = mapped.bg;
  if (mapped.line) out.line = mapped.line;
  if (mapped.fg) out.color = mapped.fg;
  return out;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown, fallback: number): number;
function numberValue(value: unknown, fallback: undefined): number | undefined;
function numberValue(value: unknown, fallback: number | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().replace(/,/g, "");
  if (!normalized) return fallback;
  const parsed = Number.parseFloat(normalized.endsWith("%") ? normalized.slice(0, -1) : normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function arrayValue(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}
