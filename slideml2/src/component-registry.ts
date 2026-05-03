import {
  badge, barList, bulletList, checklist, comparisonCard, ctaButton, featureCard, flowArrow,
  heroStat, iconText, insightCallout, keyTakeaway, kpiGrid, legend, logoStrip, metricCard,
  numberedGrid, numberedList, pricingCard, processFlow, profileCard, prosCons, progressBar,
  quoteBlock, sectionBreak, statComparison, statStrip, stepCard, swotMatrix, tagList,
  timelineBlock,
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
  component("timeline", "Chronological sequence with dates, eras, milestones, or releases. Use when time is the organizing meaning.", {
    items: { type: "array", required: true, description: "Array of { time? or date?, title/label, body?/description? } steps." },
    direction: { type: "enum", enum: ["horizontal", "vertical"], description: "Layout direction. Defaults to horizontal — that's the safe choice for any slide where the timeline shares space with other content. Pass 'vertical' only when the timeline owns the whole slide." },
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
    accent: { type: "string", semantic: "label", description: "Optional small uppercase label above the title." },
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
    items: { type: "array", required: true, description: "Array of { value, label } items." },
    tone: { type: "enum", enum: ["brand", "positive", "neutral"], description: "Value color tone." },
  }, "horizontal stack of (value+label) cells with thin divider rules", "stack"),
  component("legend", "Color/category key for a chart, diagram, map, or coded table. Use when colors or symbols need semantic decoding.", {
    items: { type: "array", required: true, description: "Array of { label, color } items. color is a theme token (palette name, brand.primary, etc.)." },
    direction: { type: "enum", enum: ["horizontal", "vertical"], description: "Orientation." },
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
      return {
        time: stringValue(rec.time, stringValue(rec.date, "")),
        title: stringValue(rec.title, stringValue(rec.label, "")),
        body: stringValue(rec.body, stringValue(rec.description, "")),
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
    return withComponentRoot(node, sectionBreak(slideId, name, {
      title: stringValue(node.title, ""),
      subtitle: stringValue(node.subtitle, ""),
      accent: stringValue(node.accent, ""),
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
    const items = Array.isArray(node.items) ? node.items.map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      return { value: stringValue(rec.value, stringValue(rec.metric, "")), label: stringValue(rec.label, stringValue(rec.name, stringValue(rec.title, ""))) };
    }).filter((item) => item.value || item.label) : [];
    const toneRaw = node.tone;
    const tone = toneRaw === "brand" || toneRaw === "positive" || toneRaw === "neutral" ? toneRaw : undefined;
    return withComponentRoot(node, statStrip(slideId, name, { items, tone }));
  }
  if (componentName === "legend") {
    const items = Array.isArray(node.items) ? node.items.map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      return { label: stringValue(rec.label, ""), color: stringValue(rec.color, "brand.primary") };
    }).filter((item) => item.label) : [];
    const direction = node.direction === "vertical" ? "vertical" : "horizontal";
    return withComponentRoot(node, legend(slideId, name, { items, direction }));
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
  return {
    id: `${slideId}.${name}`,
    type: "card",
    role: "chart-card",
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
  if (badgeText) children.push(badge(slideId, `${name}.badge`, { text: badgeText, tone: tone === "neutral" ? "brand" : tone }));
  children.push({ id: `${slideId}.${name}.headline`, type: "text", text: stringValue(node.headline, stringValue(node.title, "")), style: "card-title", color: tone === "neutral" ? "text.primary" : toneToColors(tone).fg, minHeight: 0.55, autoFit: "shrink" });
  const detail = stringValue(node.detail, stringValue(node.body, stringValue(node.description, "")));
  if (detail) children.push({ id: `${slideId}.${name}.detail`, type: "text", text: detail, style: "paragraph", color: "text.primary" });
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
    fixedWidth: 0.28,
    fixedHeight: 0.28,
    align: direction === "horizontal" ? "center" : "start",
  };
  const label: DomNode = { id: `${slideId}.${name}.${index}.label`, type: "text", text: item.label, style: "label", color: markerColor, align: direction === "horizontal" ? "center" : "left", fixedHeight: 0.45 };
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
  if (tone === "inverse") return { fg: "text.inverse", line: "text.inverse" };
  if (tone === "positive") return { fg: "success", bg: "success.tint", line: "success" };
  if (tone === "warning") return { fg: "warning", bg: "warning.tint", line: "warning" };
  if (tone === "danger") return { fg: "danger", bg: "danger.tint", line: "danger" };
  if (tone === "brand") return { fg: "brand.primary", bg: "brand.tint", line: "brand.primary" };
  if (tone === "neutral") return { fg: "text.primary", bg: "surface", line: "divider" };
  return {};
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
