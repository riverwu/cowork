import {
  applyAgentSurface, arrowLink, badge, barList, bigPageNumber, brandMark, bracket, bulletList, calloutMarker, checklist,
  comparisonCard, comparisonTable, cornerMark, ctaButton, decorationGrid, decorativeShapes, donutSummary,
  featureCard, flowArrow, funnel, gauge, glossary, heatmap, heroStat, iconText, insightCallout,
  keyTakeaway, kpiGrid, legend, logoStrip, matrix2x2, metricCard, numberedGrid, numberedList,
  outline, pricingCard, processFlow, profileCard, prosCons, progressBar, qAndA, quizCard,
  pointerArrow, quoteBlock, rangePlot, scaleBar, scorecard, sectionBreak, statComparison, statFlow, statStrip,
  stepCard, swotMatrix, tagList, takeawayList, textChipWidthCm, timelineAxisBar, timelineBlock, trendLine,
  watermark,
} from "./components.js";
import { listNodeTypes } from "./node-types.js";
import type { DomNode, NodeType } from "./types.js";
import type { AgentSurface, DecorationMarkerInput } from "./components.js";
import { latexToMathText, richRunsPlainText } from "./m3-rich-inline.js";
import { normalizeStrokeCm } from "./units.js";

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
  | "code-block"
  | "equation"
  | "bibliography"
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
  | "explanation-block"
  | "comparison-list"
  | "fact-list"
  | "executive-summary"
  | "quiz-card"
  | "q-and-a"
  | "takeaway-list"
  | "warning-list"
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
  | "decorative-shapes"
  | "corner-mark"
  | "brand-mark"
  | "bracket"
  | "arrow-link"
  | "pointer-arrow"
  | "watermark"
  | "big-page-number"
  | "timeline-axis-bar"
  | "scale-bar"
  | "two-column"
  | "freeform-group"
  | "cover-composition"
  | "chapter-divider"
  | "hero-and-support"
  | "chart-with-rail"
  | "snapshot-callouts"
  | "evidence-layout"
  | "factorial-matrix"
  | "probe-flow"
  | "failure-taxonomy"
  | "main-effect-comparison";

export interface PropDefinition {
  type: "string" | "number" | "boolean" | "enum" | "array" | "object" | "image-ref" | "color-ref" | "table" | "chart";
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
  children: { allowed: boolean; required?: boolean };
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
  guidance?: string[];
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
  guidance?: string[];
}

const PRIMITIVE_COMPONENT_TYPES = ["stack", "grid", "split", "spacer", "divider", "bullets", "image", "table", "chart", "shape", "panel", "card", "band", "frame", "inset"] as const satisfies readonly NodeType[];
type PrimitiveComponentType = typeof PRIMITIVE_COMPONENT_TYPES[number];

const EXAMPLE_IMAGE_DATA_URL = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iMTIwIj48cmVjdCB3aWR0aD0iMjQwIiBoZWlnaHQ9IjEyMCIgZmlsbD0iIzI1NjNFQiIvPjwvc3ZnPg==";

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
  component("code-block", "First-class code listing for research, engineering, SQL, or appendix slides. Supports language-aware highlighting, line numbers, diff line styling, highlighted lines, wrapping, captions, and maxLines truncation.", {
    code: { type: "string", required: true, description: "Source code or diff text." },
    language: { type: "string", description: "Language label such as ts, python, sql, bash, c, cpp, diff, or text." },
    title: { type: "string", description: "Optional code block title." },
    caption: { type: "string", description: "Optional code caption or source." },
    showLineNumbers: { type: "boolean", description: "Show stable line numbers." },
    highlightLines: { type: "array", description: "Line numbers or ranges such as [2,{start:4,end:6}] to tint." },
    wrap: { type: "boolean", description: "Wrap long lines instead of preserving a single visual line." },
    density: { type: "enum", enum: ["compact", "dense", "tiny"], description: "Code-specific vertical density. Use dense/tiny for long listings instead of truncating." },
    columns: { type: "number", description: "Split code into 2 or 3 vertical columns for long listings while preserving line numbers." },
    fontSize: { type: "number", description: "Explicit monospace code font size in points." },
    maxLines: { type: "number", description: "Maximum rendered lines; excess is truncated with an ellipsis row." },
  }, "stack(title?, table(lineNo, highlighted code lines), caption?)", "stack"),
  component("equation", "Display equation for scientific and analytical decks. Accepts supported LaTeX input and renders native Office Math (OMML) with optional label, number, alignment, and caption.", {
    latex: { type: "string", required: true, description: "LaTeX equation body, e.g. \\frac{a}{b}=c or \\sum_i x_i." },
    label: { type: "string", description: "Optional equation label for authoring references." },
    number: { type: "string", description: "Optional equation number rendered as (number)." },
    align: { type: "enum", enum: ["left", "center", "right"], description: "Equation alignment." },
    caption: { type: "string", description: "Optional explanatory caption." },
    style: { type: "string", description: "Text style for the equation body. Defaults to body so page-level typography stays respected; use section-title/slide-title only for hero equations." },
    size: { type: "string", description: "Optional semantic size dial (xs/sm/md/lg/xl/2xl) applied to the equation body." },
    fontSize: { type: "number", description: "Optional explicit equation body font size in points." },
    renderMode: { type: "enum", enum: ["omml"], description: "Native Office Math renderer. Unsupported LaTeX commands are rejected instead of emitted as plain text." },
  }, "stack(label?, split(math text, number?), caption?)", "stack"),
  component("bibliography", "Auto bibliography for cited references in deck.references. Lists only cited items by default, or every reference with includeAll:true.", {
    title: { type: "string", description: "Optional heading." },
    style: { type: "enum", enum: ["numeric", "author-year", "short"], description: "Citation list style." },
    includeAll: { type: "boolean", description: "List all deck.references even if not cited." },
    items: { type: "array", description: "Internal resolved items; normally populated by SlideML2 from deck.references." },
  }, "stack(title?, bibliography items)", "stack"),
  component("metric-card", "Single compact KPI: one short numeric value plus label, usually as part of a grid or comparison. Do not use for prose, product names, or step text.", {
    value: { type: "string", required: true, semantic: "metric-value", description: "Short numeric or ranked value." },
    label: { type: "string", required: true, semantic: "metric-label", description: "Short metric label." },
    unit: { type: "string", description: "Optional unit appended to value." },
    trend: { type: "enum", enum: ["up", "down", "flat"], description: "Optional trend intent." },
    delta: { type: "string", description: "Optional delta or change label." },
    status: { type: "enum", enum: ["brand", "positive", "warning", "danger", "neutral"], description: "Semantic status color independent of trend." },
    comparison: { type: "string", description: "Optional benchmark / target / peer note." },
    source: { type: "string", description: "Optional compact source note." },
    sparkline: { type: "array", description: "Optional tiny trend sequence; numeric values render as a micro-bar sparkline." },
    bind: { type: "object", description: "Optional deck data binding {source, filter?, groupBy?, aggregate?, pivot?, sort?, limit?}; with encoding.value/label it resolves value and label from deck.dataSources." },
    encoding: { type: "object", description: "Optional binding encoding {value, label, delta} for data-bound metric cards." },
    variant: { type: "enum", enum: ["plain", "card", "compact"], description: "Visual treatment." },
    density: { type: "enum", enum: ["comfortable", "compact"], description: "Vertical density." },
    surface: { type: "object", description: "Optional surface override {fill,border,cornerRadius,padding,elevation,accent}." },
  }, "stack(text.metric-value, text.metric-label)", "grid"),
  component("callout", "Highlighted insight, warning, recommendation, or rule of thumb. Use sparingly: at most one primary callout per slide, not as the default container for every idea. Supports either legacy single-line text or a richer title/body/bullets/content block, so agents should not hand-build callout cards for formatted emphasis.", {
    text: { type: "string", semantic: "callout", description: "Legacy concise insight. Use title/body/content for richer callouts." },
    title: { type: "string", semantic: "card-title", description: "Optional colored heading." },
    body: { type: "string", semantic: "paragraph", description: "Optional supporting body text." },
    content: { type: "array", description: "Optional rich text runs for body text, e.g. [{text:'Key',marks:['bold']},{text:' detail'}]." },
    bullets: { type: "array", semantic: "bullet", max: 5, description: "Optional short support bullets." },
    variant: { type: "enum", enum: ["plain", "card", "banner"], description: "plain keeps legacy text shape; card/banner add stronger surface and heading structure." },
    tone: { type: "enum", enum: ["neutral", "brand", "positive", "warning", "danger"], description: "Semantic tone." },
  }, "text.callout with styled surface", "stack"),
  component("comparison-card", "One peer item in a comparison set: option, product, persona, scenario, or competitor with parallel points.", {
    title: { type: "string", required: true, semantic: "card-title", description: "Object title." },
    subtitle: { type: "string", semantic: "label", description: "Optional subtitle." },
    body: { type: "string", semantic: "caption", description: "Optional explanatory sentence." },
    content: { type: "array", description: "Optional rich text runs for explanatory copy." },
    badge: { type: "string", description: "Optional short status/category badge." },
    points: { type: "array", semantic: "bullet", max: 6, description: "Short supporting points (max 6)." },
    items: { type: "array", semantic: "bullet", max: 6, description: "Alias for points (max 6)." },
    metrics: { type: "array", description: "Optional compact metrics [{label,value,tone?}]." },
    pros: { type: "array", description: "Optional benefits list." },
    cons: { type: "array", description: "Optional drawbacks list." },
    score: { type: "string", description: "Optional score/rating/value." },
    winner: { type: "boolean", description: "Mark this option as the selected/recommended winner." },
    footer: { type: "string", description: "Optional muted footer note." },
    variant: { type: "enum", enum: ["plain", "card", "compact"], description: "Visual treatment." },
    density: { type: "enum", enum: ["comfortable", "compact"], description: "Vertical density." },
    surface: { type: "object", description: "Optional surface override." },
  }, "stack(text.card-title, bullets)", "grid"),
  component("step-card", "One discrete step or stage with a title and short detail. Use inside a larger sequence only when each step needs card-level detail; prefer process-flow for connected pipelines.", {
    step: { type: "string", semantic: "numbered-step", description: "Optional step label." },
    number: { type: "string", semantic: "numbered-step", description: "Alias for step when the source uses a numeric stage marker." },
    title: { type: "string", required: true, semantic: "card-title", description: "Step title." },
    body: { type: "string", semantic: "paragraph", description: "Step body." },
    description: { type: "string", semantic: "paragraph", description: "Alias for body when the source uses description copy." },
    steps: { type: "array", semantic: "bullet", description: "Alias used when a step has multiple short details." },
    content: { type: "array", description: "Optional rich text runs for the body." },
    bullets: { type: "array", semantic: "bullet", description: "Optional short substeps." },
    icon: { type: "enum", enum: ["rect", "roundRect", "ellipse", "triangle", "rightTriangle", "pentagon", "diamond", "arrow-right", "arrow-down", "callout", "chevron", "star-5", "parallelogram", "cloud"], description: "Optional step icon." },
    marker: { type: "object", description: "Optional semantic item marker instead of a full icon. String or {shape:'dot|ring|square|rounded-square|diamond|side-bar|slash|index-chip', variant?:'tint|solid|outline|ghost|ring|badge', tone?, size?}. Use for subtle list-item decoration." },
    status: { type: "enum", enum: ["brand", "positive", "warning", "danger", "neutral"], description: "Semantic step state." },
    owner: { type: "string", description: "Optional owner/role." },
    time: { type: "string", description: "Optional duration/date." },
    variant: { type: "enum", enum: ["plain", "card", "compact"], description: "Visual treatment." },
    density: { type: "enum", enum: ["comfortable", "compact"], description: "Vertical density." },
    surface: { type: "object", description: "Optional surface override." },
  }, "stack(text.numbered-step, text.card-title, text.paragraph)", "grid"),
  component("definition-card", "Term plus definition. Use for glossary, concept introduction, vocabulary, or clarifying a named framework element.", {
    term: { type: "string", required: true, semantic: "card-title", description: "Term." },
    definition: { type: "string", required: true, semantic: "paragraph", description: "Definition." },
  }, "stack(text.card-title, text.paragraph)", "grid"),
  component("numbered-list", "Ordered text list where sequence or priority matters but each item is still brief prose. Use numbered-grid when each item should become a designed module.", {
    items: { type: "array", required: true, semantic: "bullet", description: "Ordered list items. Each item may be a string or {title/headline/label/name/text, body/detail/description?}." },
    density: { type: "enum", enum: ["comfortable", "compact"], description: "Bullet density." },
  }, "bullets with numbered:true", "stack"),
  component("quote", "Verbatim or voice-like statement with optional attribution. Use when authority, emotion, or wording is the evidence.", {
    text: { type: "string", required: true, semantic: "quote", description: "Quote text (without enclosing quotes; component adds them)." },
    source: { type: "string", description: "Optional source / attribution." },
  }, "stack(text.quote, text.quote-source)", "stack"),
  component("icon-text", "Icon plus short label for compact feature/status/category cues. Use as a small semantic marker, not as a substitute for rich explanation.", {
    icon: { type: "enum", enum: ["rect", "roundRect", "ellipse", "triangle", "rightTriangle", "pentagon", "diamond", "arrow-right", "arrow-down", "callout", "chevron", "star-5", "parallelogram", "cloud"], required: true, description: "OOXML preset icon shape." },
    text: { type: "string", required: true, semantic: "card-title", description: "Label text." },
    iconColor: { type: "string", description: "Icon line/glyph color token." },
    iconBackground: { type: "string", description: "Icon background fill token." },
    tone: { type: "string", description: "Optional text color token." },
  }, "stack.horizontal(shape, text)", "stack"),
  component("timeline", "Chronological sequence with dates, eras, milestones, or releases. Use when time is the organizing meaning. Each item supports a sub-headline (title), simple body text (body), an optional tone (brand|positive|warning|danger|neutral) for accent color, optional milestone shape/icon/iconSrc, OR a full embedded DomNode (content) such as a metric-card, image, insight-card, quote. Capacity caps (auto-applied): horizontal rich items > 5 auto-flip to vertical (each row gets full width); simple items > 6 auto-wrap to a 4-col grid; the renderer takes care of overflow but for histories beyond ~8 rich events you should split into two timeline slides.", {
    items: { type: "array", required: true, description: "Array of { time?/date?/year?, title?/label?/headline?/name?, body?/description? (text), tone? (brand|positive|warning|danger|neutral), shape? (outer milestone OOXML preset: ellipse/diamond/cloud/star-5/etc.), icon? (optional inner OOXML preset), iconSrc? (generated raster icon path rendered inside the milestone), content? (any DomNode — metric-card, image, insight-card, etc.) }. content takes priority over body when both are supplied. Prefer body+tone for ordinary events; use iconSrc when generated icons should appear on the timeline marker itself." },
    direction: { type: "enum", enum: ["horizontal", "vertical"], description: "Layout direction. Defaults to horizontal — safe for short text items. Pass 'vertical' when items have rich content (each row gets ~12cm width vs ~4cm in horizontal). The component auto-flips to vertical when items > 5 with rich content, and auto-wraps simple items > 6 into a 4-col grid." },
    orientation: { type: "enum", enum: ["horizontal", "vertical"], description: "Alias for direction." },
    gap: { type: "number", description: "For wrapped horizontal timelines, vertical gap in cm between axis rows. Default 0.52; useful range 0.3-1.0." },
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
    icon: { type: "enum", enum: ["rect", "roundRect", "ellipse", "triangle", "rightTriangle", "pentagon", "diamond", "arrow-right", "arrow-down", "callout", "chevron", "star-5", "parallelogram", "cloud"], description: "Optional large icon shape preset. Prefer marker for subtle item decoration." },
    iconSrc: { type: "image-ref", description: "Optional generated/raster icon path. Use with generate_icon_sheet outputs; rendered as a contain-fit square icon." },
    title: { type: "string", required: true, semantic: "card-title", description: "Feature title." },
    body: { type: "string", semantic: "caption", description: "Optional supporting copy." },
    content: { type: "array", description: "Optional rich text runs for supporting copy." },
    marker: { type: "object", description: "Optional semantic item marker that sits beside the title and replaces the large icon. String or {shape:'dot|ring|square|rounded-square|diamond|side-bar|slash|index-chip', variant?, tone?, size?}. Use when a small decorative cue is enough." },
    badge: { type: "string", description: "Optional category/status badge." },
    tags: { type: "array", description: "Optional compact tags." },
    metric: { type: "object", description: "Optional proof metric {value,label,tone?}. Concise numeric values render as compact KPI; prose/star-rating values render as supporting evidence to preserve card hierarchy." },
    proof: { type: "string", description: "Optional short evidence/source line." },
    ctaText: { type: "string", description: "Optional compact action label." },
    iconColor: { type: "string", description: "Icon line color (theme token)." },
    iconBackground: { type: "string", description: "Icon fill (theme token)." },
    tone: { type: "enum", enum: ["brand", "neutral", "positive", "warning", "danger"], description: "Semantic feature tone; controls title and marker color." },
    titleColor: { type: "color-ref", description: "Explicit title color token when semantic tone is not enough." },
    variant: { type: "enum", enum: ["plain", "card", "compact"], description: "Visual treatment." },
    density: { type: "enum", enum: ["comfortable", "compact"], description: "Vertical density." },
    surface: { type: "object", description: "Optional surface override." },
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
  component("process-flow", "Connected process, workflow, recipe, pipeline, or causal sequence. Use when steps depend on each other or movement through stages is the main idea. Card flows default to numbered stage chips and top accent rules so a single process component can carry a full slide. Horizontal card flows are tuned for 2-3 readable stages; rich 4+ step card flows may auto-wrap into two readable rows on wide slides or auto-orient vertically in narrow columns instead of shrinking text.", {
    steps: { type: "array", required: true, description: "Array of { title/label, body?/description?, status?, owner?, time?/duration?, icon?, iconSrc?, number?/step?, marker?, accentColor?, bullets? } steps. Use iconSrc for generated icons." },
    items: { type: "array", description: "Alias for steps." },
    direction: { type: "enum", enum: ["horizontal", "vertical"], description: "Flow direction (default horizontal)." },
    variant: { type: "enum", enum: ["plain", "cards"], description: "Use cards when each stage needs its own surface." },
    density: { type: "enum", enum: ["comfortable", "compact"], description: "Step density. Use compact only for short step copy; rich card flows keep extra breathing room." },
    marker: { type: "enum", enum: ["auto", "number", "dot", "icon", "none"], description: "Stage marker style. auto uses icon/iconSrc when supplied, otherwise numbered chips for card flows." },
    showNumbers: { type: "boolean", description: "Alias control for numbered stage chips; marker takes precedence." },
    connector: { type: "enum", enum: ["arrow", "chevron", "line", "none"], description: "Connector treatment between steps." },
    connectorDash: { type: "enum", enum: ["solid", "dash", "dot"], description: "Line connector dash style." },
    connectorColor: { type: "color-ref", description: "Theme token or hex for connectors (default brand.primary)." },
    placement: { type: "enum", enum: ["top", "center"], description: "Cross-axis placement inside the available region. Card flows default top to avoid floating in empty pages." },
    spread: { type: "enum", enum: ["compact", "balanced", "fill"], description: "Card visual mass. balanced is the card-flow default; fill creates taller stage cards for single-component slides." },
    stepAccent: { type: "enum", enum: ["top", "none"], description: "Per-card accent rule (default top for card flows)." },
    stepSurface: { type: "object", description: "Optional per-step card surface override (fill, borderColor, cornerRadius, padding, shadow)." },
    surface: { type: "object", description: "Optional surface override." },
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
    bind: { type: "object", description: "Optional deck data binding {source, filter?, groupBy?, aggregate?, pivot?, sort?, limit?}; with encoding.value/label it resolves value and label from deck.dataSources." },
    encoding: { type: "object", description: "Optional binding encoding {value, label, delta}." },
    tone: { type: "enum", enum: ["brand", "positive", "warning", "danger", "neutral"], description: "Color tone for the value." },
  }, "stack of metric-value(2xl) + card-title + caption", "stack"),
  component("bar-list", "Ranked or sortable categorical numeric/rating comparison. Use when the viewer should see who is bigger/smaller across 4-8 items.", {
    items: { type: "array", required: true, description: "Array of { label/name/title, value/score/percent, max?, valueLabel?, tone? }. Numeric strings like '75%' are accepted. Star strings like '★★★★' are rendered as rating labels and converted to numeric bar lengths." },
    tone: { type: "enum", enum: ["brand", "positive", "neutral", "warning", "danger"], description: "Default bar fill color. 'neutral' renders de-emphasized gray bars." },
    sort: { type: "enum", enum: ["desc", "asc", "none"], description: "Sort items by value (default 'none' — keep input order)." },
  }, "stack of (label-row + horizontal-track) per item", "stack"),
  component("stat-strip", "Inline row of headline metrics with minimal chrome. Use when 3-6 numbers support one read and card frames would be too heavy.", {
    items: { type: "array", required: true, description: "Array of { value, label, tone? } items. Per-item tone (brand|positive|neutral|warning|danger) sets that cell's value color and overrides the strip default — useful for mixed signals (good/risk/bad in one row)." },
    bind: { type: "object", description: "Optional deck data binding {source, filter?, groupBy?, aggregate?, pivot?, sort?, limit?}; resolves items from deck.dataSources." },
    encoding: { type: "object", description: "Binding encoding {value, label}." },
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
    thickness: { type: "number", description: "Rule thickness. Prefer point-like values 1-3 for normal lines; legacy tiny cm values 0.03-0.18 are also accepted." },
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
    detail: { type: "string", semantic: "lead", description: "Optional supporting **sentence**. For multiple implications, pass `bullets`/`points` instead — a `detail` that crams '1. … 2. … 3. …' or '；'-separated runs into one string is rendered as a single paragraph." },
    body: { type: "string", semantic: "lead", description: "Alias for detail." },
    content: { type: "array", description: "Optional rich text runs for detail copy." },
    bullets: { type: "array", semantic: "bullet", description: "Optional supporting implications." },
    points: { type: "array", semantic: "bullet", description: "Alias for bullets — short list of supporting points." },
    tone: { type: "enum", enum: ["brand", "positive", "warning", "danger"], description: "Tone color (default brand)." },
    variant: { type: "enum", enum: ["panel", "banner", "minimal"], description: "Visual emphasis level." },
    density: { type: "enum", enum: ["comfortable", "compact"], description: "Vertical density." },
    surface: { type: "object", description: "Optional surface override." },
  }, "tinted+bordered panel with accent bar + headline + detail", "stack"),
  component("numbered-grid", "Designed set of ordered priorities, principles, or framework points. Use when each item is a peer module and the number itself communicates order.", {
    items: { type: "array", required: true, description: "Array of { title/label/name, body/description/text?, marker?, tone? } items. marker can be string or {shape,variant,tone,size}." },
    columns: { type: "number", description: "Columns (default min(4, items.length))." },
    tone: { type: "enum", enum: ["brand", "neutral"], description: "Number color tone." },
    marker: { type: "object", description: "Optional marker applied to every item title row. Prefer this over raw square shapes for item decoration." },
    numberStyle: { type: "enum", enum: ["chip", "plain"], description: "Number treatment. chip is default; plain uses oversized text numerals." },
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
    badge: { type: "string", description: "Optional status/category badge above the image." },
    insight: { type: "string", description: "Optional interpretation sentence below the image." },
    annotations: { type: "array", description: "Optional local labels; render as compact notes below/around the media." },
    callouts: { type: "array", description: "Optional short callout notes." },
    caption: { type: "string", description: "Optional caption below the image." },
    fit: { type: "enum", enum: ["cover", "contain", "fill"], description: "Image fit mode." },
    imageWidth: { type: "number", description: "Optional inner image width in cm. Defaults to a centered illustration width for contain-fit cards." },
    tone: { type: "enum", enum: ["neutral", "brand", "tinted"], description: "Card surface tone." },
    variant: { type: "enum", enum: ["card", "frameless", "compact"], description: "Visual treatment." },
    surface: { type: "object", description: "Optional surface override." },
  }, "card(stack(title?, image, caption?))", "grid"),
  component("chart-card", "Titled quantitative evidence module. Use when the chart is a self-contained proof object with interpretation/source, not just a raw plot.", {
    chartType: { type: "enum", enum: ["bar", "stacked-bar", "line", "pie", "doughnut", "area", "combo", "scatter", "waterfall"], required: true, description: "Chart type." },
    chart: { type: "enum", enum: ["bar", "stacked-bar", "line", "pie", "doughnut", "area", "combo", "scatter", "waterfall"], description: "Alias for chartType." },
    labels: { type: "array", required: true, description: "Category labels." },
    series: { type: "array", required: true, description: "Chart series. Series may set type:'bar'|'line' for combo, axis:'primary'|'secondary', trendLine, errorBars, color, lineWidth, lineDash, marker, or dataLabels." },
    data: { type: "object", description: "Optional { labels, series } alias bundle." },
    bind: { type: "object", description: "Optional deck data binding {source, filter?, groupBy?, aggregate?, pivot?, sort?, limit?}; resolves labels/series from deck.dataSources." },
    encoding: { type: "object", description: "Binding encoding: {x, y, orientation?, series?, seriesName?, seriesOptions?}. y may be a string or string[]; seriesOptions can set bar/line type, secondary axis, trendLine, and errorBars per output series. For horizontal bars, use orientation:'horizontal' or x=numeric/y=categorical." },
    title: { type: "string", description: "Optional card/chart title." },
    badge: { type: "string", description: "Optional status/category badge." },
    insight: { type: "string", description: "Optional conclusion sentence." },
    caption: { type: "string", description: "Optional source or interpretation note." },
    showLegend: { type: "boolean", description: "Show chart legend." },
    showValues: { type: "boolean", description: "Show values on chart marks." },
    orientation: { type: "enum", enum: ["vertical", "horizontal"], description: "Bar-like chart orientation. Horizontal bars are useful for ranked categories with long labels." },
    dataLabels: { type: "object", description: "Optional data-label controls {show, position:'bestFit'|'center'|'insideEnd'|'insideBase'|'outsideEnd', showValue, showCategoryName, showSeriesName, showPercent, showLegendKey, showLeaderLines}. Pie/doughnut default to category+percent labels." },
    xAxis: { type: "object", description: "Optional x/category axis controls {title, show, min, max, majorUnit, numberFormat, gridlines, tickLabelRotation, tickLabelPosition}." },
    yAxis: { type: "object", description: "Optional primary value axis controls {title, show, min, max, majorUnit, numberFormat, gridlines, tickLabelRotation, tickLabelPosition}." },
    secondaryYAxis: { type: "object", description: "Optional secondary value axis controls for series using axis:'secondary'." },
    legend: { type: "object", description: "Optional legend controls {show, position:'bottom'|'top'|'left'|'right', overlay}." },
    plotArea: { type: "object", description: "Manual plot-area layout factors {x,y,w,h} in 0..1." },
    positiveColor: { type: "color-ref", description: "Optional color for positive bar/stacked-bar/combo points." },
    negativeColor: { type: "color-ref", description: "Optional color for negative bar/stacked-bar/combo points. Defaults to theme danger." },
    yFormat: { type: "enum", enum: ["int", "decimal", "percent", "wanyuan", "yi"], description: "Y-axis number format." },
    tone: { type: "enum", enum: ["neutral", "brand", "tinted"], description: "Card surface tone." },
    variant: { type: "enum", enum: ["card", "frameless", "compact"], description: "Visual treatment." },
    surface: { type: "object", description: "Optional surface override." },
  }, "card(stack(title?, chart, caption?))", "grid"),
  component("table-card", "Titled structured comparison or lookup table. Use for financials, feature matrices, risks, guidance, and compact data summaries. Hand-authored cells can carry rich runs and footnoteRefs.", {
    title: { type: "string", description: "Optional table title." },
    headers: { type: "array", description: "Header row labels. For object rows, headers can also act as row keys when labels and keys match." },
    columns: { type: "array", description: "Alternative column definitions { key?|field?, header?|label?, width? }. Use key/field when display header differs from object row key." },
    rows: { type: "array", required: true, description: "Table rows. Rows may be arrays, {cells:[...]}, or objects keyed by columns/header names; common aliases like Metric→label and Amount→value are tolerated. Supports cell objects with text/value/runs/footnoteRefs/fill/color/tone/bold/align/valign/colspan/rowspan/padding/border/textRotation; runs accepts RichInline math/cite/token." },
    data: { type: "object", description: "Optional { headers, rows } alias bundle." },
    bind: { type: "object", description: "Optional deck data binding {source, select?, filter?, groupBy?, aggregate?, pivot?, sort?, limit?}; resolves headers/rows from deck.dataSources." },
    encoding: { type: "object", description: "Binding encoding {columns:[key|{key|field,label|header,type,format,align,width}]} to choose, label, format, align, and size table columns." },
    badge: { type: "string", description: "Optional status/category badge." },
    insight: { type: "string", description: "Optional conclusion sentence." },
    caption: { type: "string", description: "Optional source note below the table." },
    tone: { type: "enum", enum: ["neutral", "brand", "tinted"], description: "Card surface tone." },
    variant: { type: "enum", enum: ["card", "frameless", "compact"], description: "Visual treatment." },
    density: { type: "enum", enum: ["comfortable", "compact"], description: "Table text density. Compact is suitable for 6-8 row business tables." },
    cellPadding: { type: "object", description: "Default cell padding in cm: number or {left/right/top/bottom}." },
    borders: { type: "object", description: "Default table borders {color,width,dash,alpha,left?,right?,top?,bottom?}; each side may be 'none' or a border object." },
    borderDash: { type: "enum", enum: ["solid", "dash", "dashDot", "dot"], description: "Default table border dash style." },
    bandRows: { type: "boolean", description: "Enable/disable native banded rows." },
    bandCols: { type: "boolean", description: "Enable native banded columns." },
    tableStyleId: { type: "string", description: "Native OOXML table style GUID." },
    surface: { type: "object", description: "Optional surface override." },
  }, "card(stack(title?, table, caption?))", "stack"),
  component("insight-card", "One modular insight with badge/headline/detail/proof bullets. Use for a curated finding or recommendation, not generic paragraph storage; avoid filling a whole deck with repeated insight-card grids when process-flow, comparison-card, key-takeaway, chart-card, table-card, or evidence-layout better fits the slide job.", {
    badge: { type: "string", description: "Optional short status/category badge." },
    headline: { type: "string", required: true, semantic: "card-title", description: "Main insight." },
    title: { type: "string", semantic: "card-title", description: "Alias for headline." },
    detail: { type: "string", semantic: "paragraph", description: "Supporting sentence." },
    body: { type: "string", semantic: "paragraph", description: "Alias for detail." },
    bullets: { type: "array", semantic: "bullet", description: "Optional supporting bullets." },
    items: { type: "array", semantic: "bullet", description: "Alias for bullets." },
    points: { type: "array", semantic: "bullet", description: "Alias for bullets." },
    tone: { type: "enum", enum: ["neutral", "brand", "positive", "warning", "danger"], description: "Card tone." },
    density: { type: "enum", enum: ["comfortable", "compact"], description: "Use compact in dense grids or small cells." },
  }, "card(stack(badge?, title, detail?, bullets?))", "grid"),
  component("explanation-block", "Structured explanation for concepts, mechanisms, causes, or implications. Prefer this over repeated insight-cards when the slide job is to explain how/why something works.", {
    title: { type: "string", semantic: "card-title", description: "Optional explanation heading." },
    headline: { type: "string", semantic: "card-title", description: "Alias for title." },
    body: { type: "string", semantic: "paragraph", description: "Main explanatory paragraph." },
    detail: { type: "string", semantic: "paragraph", description: "Alias for body." },
    description: { type: "string", semantic: "paragraph", description: "Alias for body." },
    content: { type: "array", description: "Optional rich text runs for the body." },
    bullets: { type: "array", semantic: "bullet", description: "Optional supporting points." },
    items: { type: "array", semantic: "bullet", description: "Alias for bullets." },
    example: { type: "string", description: "Optional example sentence." },
    note: { type: "string", description: "Optional muted note or caveat." },
    variant: { type: "enum", enum: ["plain", "minimal", "rail", "panel"], description: "plain/minimal = no chrome; rail = accent spine; panel = subtle surface." },
    tone: { type: "enum", enum: ["neutral", "brand", "positive", "warning", "danger"], description: "Semantic accent tone." },
    density: { type: "enum", enum: ["comfortable", "compact"], description: "Vertical density." },
    surface: { type: "object", description: "Optional surface override." },
  }, "stack(title?, paragraph, bullets?, example?, note?)", "stack"),
  component("comparison-list", "Lightweight comparison of 2-4 options, positions, cases, or before/after states. Use when a full matrix is too heavy and separate comparison-card grids would create repetitive chrome.", {
    title: { type: "string", description: "Optional local heading." },
    basis: { type: "string", description: "Optional comparison basis or lens." },
    items: { type: "array", required: true, description: "Array of {title/name/label, body/description?, points/items/bullets?, badge?, tone?}." },
    columns: { type: "number", description: "Optional column count; default follows item count." },
    variant: { type: "enum", enum: ["plain", "columns", "subtle"], description: "Visual treatment." },
    density: { type: "enum", enum: ["comfortable", "compact"], description: "Vertical density." },
  }, "stack(title?, grid(option stacks))", "stack"),
  component("fact-list", "Evidence-first list of facts, data snippets, claims, or source-backed observations. Prefer this over insight-card when each item is a fact plus interpretation/source rather than a full standalone insight. Dense list variants auto-flow into a compact grid while preserving per-item tone.", {
    title: { type: "string", description: "Optional local heading." },
    items: { type: "array", required: true, description: "Array of {label/title/name, value?, fact/text/body?, interpretation/insight?, source?, tone?}." },
    columns: { type: "number", description: "Optional column count for grid layout." },
    variant: { type: "enum", enum: ["list", "grid", "strip"], description: "list = vertical evidence list (5+ items auto-flow to compact grid); grid = compact multi-column; strip = horizontal facts." },
    tone: { type: "enum", enum: ["neutral", "brand", "positive", "warning", "danger"], description: "Default accent tone." },
    density: { type: "enum", enum: ["comfortable", "compact"], description: "Vertical density." },
  }, "stack/grid of fact rows(label,value,fact,interpretation,source)", "stack"),
  component("executive-summary", "Executive synthesis block: thesis plus findings and implication/action. Use for opening summary, closing summary, decision memo, or high-level answer slides.", {
    thesis: { type: "string", semantic: "lead", description: "Primary thesis or answer." },
    headline: { type: "string", semantic: "lead", description: "Alias for thesis." },
    title: { type: "string", semantic: "lead", description: "Alias for thesis." },
    summary: { type: "string", semantic: "paragraph", description: "Optional short summary sentence." },
    body: { type: "string", semantic: "paragraph", description: "Alias for summary." },
    findings: { type: "array", description: "Array of {headline/title, detail/body?, tone?}; alias items." },
    items: { type: "array", description: "Alias for findings." },
    implication: { type: "string", description: "Optional implication sentence." },
    action: { type: "string", description: "Optional recommended next action." },
    variant: { type: "enum", enum: ["memo", "board", "compact"], description: "Visual treatment. Default auto-selects 'board' when ≥4 findings AND at least 3 carry both headline and detail (renders findings as a labeled grid with tone color); otherwise 'memo' (collapses findings to a bullet list — better for short prose summaries with ≤3 findings or headline-only items)." },
    tone: { type: "enum", enum: ["neutral", "brand", "positive", "warning", "danger"], description: "Semantic accent tone." },
  }, "stack(thesis, summary?, findings?, implication/action?)", "stack"),
  component("hero-and-support", "Page archetype: one dominant claim/object plus 2-4 supporting modules. Use instead of an equal card grid when one idea should clearly lead and the rest are satellites.", {
    headline: { type: "string", required: true, semantic: "lead", description: "Dominant claim or object label. Used to create the hero when hero is omitted." },
    detail: { type: "string", semantic: "paragraph", description: "Optional hero supporting sentence." },
    hero: { type: "object", description: "Optional DomNode for the hero region, e.g. key-takeaway, chart-card, image-card, hero-stat, or executive-summary. Overrides headline/detail hero." },
    supports: { type: "array", required: true, description: "2-4 support modules. Each item may be a DomNode or {title/headline/name, body/detail, value?, label?, tone?}. Alias: items." },
    items: { type: "array", description: "Alias for supports." },
    layout: { type: "enum", enum: ["left", "top"], description: "left (default) = hero left + support rail/grid right; top = hero band above support grid." },
    ratio: { type: "array", description: "Optional split ratio for layout:left, default [0.62,0.38]." },
    gap: { type: "number", description: "Region gap in cm." },
    tone: { type: "enum", enum: ["neutral", "brand", "positive", "warning", "danger"], description: "Default accent tone." },
  }, "grid/span layout: dominant hero + support satellites", "stack"),
  component("chart-with-rail", "Page archetype: one chart/table/evidence object plus a narrow interpretation rail. Use when a data object must dominate and the rail explains what to notice, why it matters, and what action follows.", {
    evidence: { type: "object", required: true, description: "DomNode for chart-card, table-card, image-card, chart, table, image, or diagram." },
    headline: { type: "string", description: "Rail headline when rail node is omitted." },
    detail: { type: "string", description: "Rail body / interpretation when rail node is omitted." },
    items: { type: "array", description: "Optional short rail bullets or proof points." },
    rail: { type: "object", description: "Optional DomNode for the rail, usually side-rail, key-takeaway, fact-list, or callout. Overrides headline/detail/items." },
    layout: { type: "enum", enum: ["rail-right", "rail-left", "stacked"], description: "rail-right default; stacked puts evidence above interpretation for wide/short evidence." },
    ratio: { type: "array", description: "Split ratio, default [0.72,0.28] for side rail and [0.68,0.32] for stacked." },
    gap: { type: "number", description: "Region gap in cm." },
    tone: { type: "enum", enum: ["neutral", "brand", "positive", "warning", "danger", "tinted"], description: "Rail tone." },
  }, "split(evidence, side-rail interpretation)", "stack"),
  component("snapshot-callouts", "Page archetype: screenshot/image plus numbered callout rail. Use for product walkthroughs, UI critique, artifact review, or any visual where the viewer needs labeled observations without hand-positioned overlays.", {
    src: { type: "image-ref", required: true, description: "Screenshot or image source." },
    title: { type: "string", description: "Optional image title." },
    caption: { type: "string", description: "Optional source/caption." },
    callouts: { type: "array", required: true, description: "2-5 callouts. Each item may be string or {title/headline/label, body/detail, tone?}. Alias: items." },
    items: { type: "array", description: "Alias for callouts." },
    fit: { type: "enum", enum: ["cover", "contain", "fill"], description: "Image fit mode; contain is default for screenshots." },
    layout: { type: "enum", enum: ["rail-right", "rail-left", "below"], description: "rail-right default; below puts callouts under the image." },
    ratio: { type: "array", description: "Split ratio, default [0.72,0.28] for side rail or [0.7,0.3] for below." },
    gap: { type: "number", description: "Region gap in cm." },
    tone: { type: "enum", enum: ["neutral", "brand", "positive", "warning", "danger", "tinted"], description: "Default callout rail tone." },
  }, "split(image-card, numbered callout rail)", "stack"),
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
    items: { type: "array", required: true, description: "Array of {headline, detail?, tone?, marker?}. Per-item tone (brand|positive|warning|danger|neutral) overrides the list default — useful for a 'three findings + one caveat' shape where the caveat is muted (neutral) and the findings are chromatic." },
    tone: { type: "enum", enum: ["brand", "positive", "warning", "danger", "neutral"], description: "Default accent tone for items that don't supply one. 'neutral' renders a divider-gray bar (de-emphasized)." },
    marker: { type: "object", description: "Optional list-wide item marker. String or {shape,variant,tone,size}. Replaces the default accent bar; use side-bar for a slimmer rail, ring/dot/diamond for lightweight bullets." },
  }, "stack(items:Array<marker/bar+stack(headline,detail)>)", "stack"),
  component("warning-list", "Tone-coded list of warnings, risks, redlines, anti-patterns, or rule violations. Use for '5 things to avoid', '红线 / 警示 / 雷区', 'do-not-do' lists, threat enumeration. Default tone is `warning` (orange) but per-item tone supports a danger/warning mix. Sized for 3-8 items on a single slide WITHOUT degrading to a plain numbered-list — replaces the failure-prone pattern of stacking 4+ `callout` cards in a vertical stack.", {
    items: { type: "array", required: true, description: "Array of {title|headline, body|detail?, tone?, marker?}. ≥3 items recommended; ≤8 supported on one slide." },
    tone: { type: "enum", enum: ["brand", "positive", "warning", "danger", "neutral"], description: "Default tone (warning by default)." },
    marker: { type: "object", description: "Optional list-wide marker shape." },
  }, "stack(items:Array<marker/bar+stack(headline,detail)>)", "stack"),
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
  component("matrix-2x2", "2x2 quadrant matrix with labeled axes. Use for risk-matrix (impact × probability), priority (effort × value), Boston matrix, market segmentation. Different from swot-matrix which has fixed S/W/O/T semantics. Two authoring modes: (1) item-style — pass `items` with each entry placed in a quadrant via x/y enum; (2) label-style — pass only `quadrantLabels {tl,tr,bl,br}` to render each quadrant as a tinted card carrying just the corner label/headline. At least one of `items` or `quadrantLabels` is required.", {
    xAxis: { type: "object", required: true, description: "{low:string, high:string} — x-axis labels." },
    yAxis: { type: "object", required: true, description: "{low:string, high:string} — y-axis labels." },
    items: { type: "array", description: "Array of {label:string, x:enum[low|high], y:enum[low|high], tone?}. Optional when quadrantLabels alone describes the matrix." },
    quadrantLabels: { type: "object", description: "Optional {tl?:string, tr?:string, bl?:string, br?:string} corner names (e.g. \"Quick Wins\"). When provided without items, each quadrant renders as a tinted summary card." },
    quadrantTones: { type: "object", description: "Optional {tl?,tr?,bl?,br?: enum[brand|positive|warning|danger|neutral]} — per-quadrant accent tone, applied in label-only mode (no items[]). In item-style mode set per-item `tone` instead — quadrant cells stay neutral there so the data points stand out." },
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
  component("decorative-shapes", "Cluster of decorative vector shapes for background texture, corner ornaments, confetti, bubbles, abstract blobs, or light scientific/tech motifs. Use when the slide needs visual atmosphere but not semantic content.", {
    motif: { type: "enum", enum: ["bubbles", "confetti", "corner-blobs", "sparkles", "molecule"], description: "Visual motif (default bubbles)." },
    anchor: { type: "enum", enum: ["top-left", "top-right", "bottom-left", "bottom-right", "full"], description: "Where the cluster is anchored. full spans the slide as a background texture." },
    tone: { type: "enum", enum: ["muted", "brand", "accent", "warning"], description: "Color family (default muted)." },
    count: { type: "number", description: "Approximate number of marks, 3-40." },
    width: { type: "number", description: "Cluster width in cm for corner positions." },
    height: { type: "number", description: "Cluster height in cm for corner positions." },
    asBackground: { type: "boolean", description: "Default true: places the motif behind content. Set false for foreground decorative accents." },
  }, "anchored grid of vector shape marks", "grid"),
  component("corner-mark", "Small ribbon/stamp/tag in a slide corner — DRAFT, CONFIDENTIAL, V2.0 style markers. Anchored to corner, doesn't compete with main content.", {
    text: { type: "string", required: true, description: "The marker text." },
    corner: { type: "enum", enum: ["top-left", "top-right", "bottom-left", "bottom-right"], description: "Corner position (default top-right)." },
    tone: { type: "enum", enum: ["brand", "warning", "danger", "neutral"], description: "Color tone (default warning)." },
    style: { type: "enum", enum: ["ribbon", "stamp", "tag"], description: "Visual style (default tag)." },
  }, "anchored corner-positioned label shape", "stack"),
  component("brand-mark", "Small brand/source label anchored to a slide corner. Use for unobtrusive footer marks such as customer, partner, source, or logo text. Prefer this over hand-coded at coordinates for corner labels.", {
    text: { type: "string", required: true, description: "Brand/source label text." },
    corner: { type: "enum", enum: ["top-left", "top-right", "bottom-left", "bottom-right"], description: "Corner anchor (default bottom-right)." },
    tone: { type: "enum", enum: ["muted", "neutral", "inverse", "brand"], description: "Color tone (default muted)." },
    width: { type: "number", description: "Label box width in cm (default 3.2)." },
    height: { type: "number", description: "Label box height in cm (default 0.45)." },
    offsetX: { type: "number", description: "Inset from left/right edge in cm (default 0.75)." },
    offsetY: { type: "number", description: "Inset from top/bottom edge in cm (default 0.55)." },
  }, "anchored text label", "stack"),
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
  component("pointer-arrow", "Anchored directional arrow used to point at a region of an image, chart, diagram, or highlighted object. Different from arrow-link: this is an overlay annotation arrow, not an inline flow connector.", {
    label: { type: "string", description: "Optional label above/beside the arrow." },
    direction: { type: "enum", enum: ["right", "left", "down", "up"], description: "Direction the arrow points (default right)." },
    anchor: { type: "enum", enum: ["top-left", "top-center", "top-right", "middle-left", "middle-center", "middle-right", "bottom-left", "bottom-center", "bottom-right"], description: "Slide-relative anchor position." },
    offsetX: { type: "number", description: "Horizontal offset from the anchor in cm." },
    offsetY: { type: "number", description: "Vertical offset from the anchor in cm." },
    width: { type: "number", description: "Overlay width in cm." },
    height: { type: "number", description: "Overlay height in cm." },
    tone: { type: "enum", enum: ["brand", "positive", "warning", "danger"], description: "Arrow color tone." },
    style: { type: "enum", enum: ["solid", "dashed"], description: "Line style (default solid)." },
  }, "anchored arrow shape with optional label", "stack"),
  component("watermark", "Large semi-transparent decorative text overlay (DRAFT, CONFIDENTIAL, SAMPLE). Anchored to slide center.", {
    text: { type: "string", required: true, description: "The watermark text." },
    rotation: { type: "number", description: "Rotation in degrees (default 0)." },
    tone: { type: "enum", enum: ["muted", "danger", "warning", "brand"], description: "Color tone (default muted)." },
  }, "center-anchored uppercase hero text", "stack"),
  component("big-page-number", "Large decorative page number for cover/section slides. Different from chrome.pageNumber (small footer). Use as visual marker on chapter openers.", {
    current: { type: "string", required: true, description: "Current page number (e.g. 5 or \"Ch 5\")." },
    total: { type: "string", description: "Optional total (renders as \"05 / 22\")." },
    corner: { type: "enum", enum: ["top-left", "top-right", "bottom-left", "bottom-right"], description: "Corner anchor (default top-right)." },
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
  containerComponent("freeform-group", "Slide-level composition group for anchored overlays. Use when a cover, section opener, annotation layer, or editorial page needs several independently positioned objects without abandoning validation. Children should set anchor/offsetX/offsetY/width/height/zIndex; the component expands them as direct slide children.", {
    mode: { type: "enum", enum: ["overlay", "background"], description: "overlay (default) keeps authored zIndex; background defaults child zIndex to -1." },
  }, "fragment(children as slide-level overlays)", "stack", true),
  component("cover-composition", "Editorial cover layout: optional full-bleed visual/background, decorative motif, dominant title lockup, and optional hero stat. Use instead of loose deck-title/text nodes when a cover needs richer composition.", {
    title: { type: "string", required: true, description: "Cover title." },
    subtitle: { type: "string", description: "Optional subtitle." },
    eyebrow: { type: "string", description: "Optional kicker." },
    visual: { type: "object", description: "Optional {src, fit:'cover'|'contain', anchor?, width?, height?, offsetX?, offsetY?, opacity?, scrimOpacity?} background or hero image. Omitting geometry makes it full-bleed." },
    heroStat: { type: "object", description: "Optional {value,label,caption,tone} hero stat." },
    tone: { type: "enum", enum: ["neutral", "inverse", "brand"], description: "Text tone. Use inverse on dark/image backgrounds." },
    decor: { type: "enum", enum: ["none", "grid", "shapes"], description: "Optional background decoration." },
    titleSize: { type: "enum", enum: ["deck-title", "slide-title", "section-title"], description: "Optional title scale override. Long cover titles auto-downgrade to slide-title." },
    lockupWidth: { type: "number", description: "Optional title lockup width in cm. Defaults wider when no heroStat is present." },
    lockupHeight: { type: "number", description: "Optional title lockup height in cm." },
  }, "fragment(background + title-lockup overlays)", "stack"),
  component("chapter-divider", "High-impact chapter opener with full-slide color field, large chapter number, title/subtitle lockup, and optional progress bar. Use for major section resets only.", {
    title: { type: "string", required: true, description: "Chapter title." },
    subtitle: { type: "string", description: "Optional subtitle." },
    chapter: { type: "string", description: "Large chapter number or label, e.g. 03." },
    eyebrow: { type: "string", description: "Small label above title." },
    sections: { type: "array", description: "Optional section names for timeline-axis-bar." },
    current: { type: "number", description: "0-based current section index when sections are provided." },
    tone: { type: "enum", enum: ["brand", "neutral", "inverse"], description: "Color treatment." },
  }, "fragment(full-slide band + big-page-number + title-lockup)", "stack"),
  component("evidence-layout", "Two-region evidence page: visual proof on the left or top, interpretation panel beside/below it, plus optional annotations. Use for chart/screenshot/image/table + conclusion pages so the slide says what the evidence means.", {
    evidence: { type: "object", required: true, description: "DomNode for chart-card, image-card, table-card, chart, image, or diagram." },
    insight: { type: "object", description: "DomNode for insight-card/key-takeaway/callout. If omitted, headline/detail create an insight-card." },
    headline: { type: "string", description: "Insight headline alias when insight node is omitted." },
    detail: { type: "string", description: "Insight detail alias when insight node is omitted." },
    annotations: { type: "array", description: "Optional anchored DomNodes such as pointer-arrow/callout-marker. These expand as slide-level overlays." },
    layout: { type: "enum", enum: ["sidecar", "stacked"], description: "sidecar (default) = evidence left + insight right; stacked = evidence top + insight bottom." },
    ratio: { type: "array", description: "Split ratio, default [0.68,0.32]." },
  }, "fragment(split + annotations)", "stack"),
  component("factorial-matrix", "Labeled 2D matrix for experiment factors, scenarios, capabilities, or model comparisons. Use when rows and columns both carry meaning; cells are compact values or short labels.", {
    rows: { type: "array", required: true, description: "Row labels." },
    columns: { type: "array", required: true, description: "Column labels." },
    cells: { type: "array", required: true, description: "2D array matching rows x columns; each cell may be string or {text,tone}." },
    title: { type: "string", description: "Optional matrix title." },
  }, "stack(title?, grid(header+cells))", "stack"),
  component("probe-flow", "Experiment/probe walkthrough: prompt or input → model/agent step(s) → observation/output. Use for evaluation methods, user-study protocols, and technical walkthroughs.", {
    steps: { type: "array", required: true, description: "Array of {title, body?, tone?}; alias items." },
    items: { type: "array", description: "Alias for steps." },
    direction: { type: "enum", enum: ["horizontal", "vertical"], description: "Flow direction." },
  }, "process-flow with probe semantics", "stack"),
  component("failure-taxonomy", "Horizontal set of failure categories with rate chips and examples. Use for error analysis, evaluation results, risk taxonomies, or postmortems.", {
    items: { type: "array", required: true, description: "Array of {title/name, rate/value?, examples?/bullets?, body?}." },
    columns: { type: "number", description: "Optional columns." },
    tone: { type: "enum", enum: ["brand", "warning", "danger", "neutral"], description: "Default rate chip tone." },
  }, "grid of failure cards", "stack"),
  component("main-effect-comparison", "Main-effect summary: visual comparison/evidence plus a right-side conclusion panel. Use for experimental result pages where one effect dominates and must be interpreted.", {
    title: { type: "string", description: "Optional local title." },
    beforeLabel: { type: "string", required: true, description: "Left/current/baseline label." },
    beforeValue: { type: "string", required: true, description: "Baseline value." },
    afterLabel: { type: "string", required: true, description: "Right/treatment label." },
    afterValue: { type: "string", required: true, description: "Treatment value." },
    insight: { type: "string", description: "Interpretation sentence." },
    trend: { type: "enum", enum: ["up", "down", "flat"], description: "Effect direction." },
  }, "stat-comparison + insight panel", "stack"),
];

export function listComponents(): ComponentSummary[] {
  return [
    ...primitiveComponentDescriptions().map(({ name, purpose }) => ({ name, purpose })),
    ...COMPONENT_DEFINITIONS.map(({ name, purpose }) => ({ name, purpose })),
  ];
}

function describeOne(name: string): ComponentDescription | null {
  const primitive = primitiveComponentDescription(name);
  if (primitive) return withUsabilityGuidance(name, primitive);
  const definition = COMPONENT_DEFINITIONS.find((item) => item.name === name) || null;
  return definition ? withUsabilityGuidance(name, definition) : null;
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

function withUsabilityGuidance<T extends ComponentDescription>(name: string, desc: T): T {
  const guidance = componentUsabilityGuidance(name);
  return guidance.length ? { ...desc, guidance } : desc;
}

function componentUsabilityGuidance(name: string): string[] {
  switch (name) {
    case "chart-card":
      return [
        "Reserve a real chart body: bar/line/combo charts need roughly >=4.8x3.0cm inside the card; pie/doughnut with labels/legend need roughly >=5.2x4.4cm before title/caption chrome.",
        "Give the chart full width or about 60-75% of a split/chart-with-rail/evidence-layout region; move KPI/table/commentary to a rail or follow-up slide before changing component.",
        "After body area is adequate, reduce categories/series/legend/label density. Pie/doughnut charts must keep slice labels/dataLabels visible.",
      ];
    case "table-card":
      return [
        "Reserve table body height before adding other evidence: a compact 6-8 row business table often needs about 4.5-6cm plus title/caption chrome, and text-heavy tables may need more.",
        "For dense tables, widen text-heavy columns with encoding.columns/colWidths, use density:'compact', shorten cells, or set rowHeights before removing evidence.",
        "If the row-height floor cannot be met, paginate the same table across slides or split exact table and interpretation into separate regions.",
      ];
    case "kpi-grid":
    case "stat-strip":
      return [
        "Short labels and 2-6 metrics work best; reduce metrics per row or widen the metric region before replacing numbers with prose cards.",
        "Use stat-strip for a tighter supporting row and kpi-grid for headline metric cards.",
      ];
    case "code-block":
      return [
        "Long required code should paginate across code-blocks/slides; maxLines is only for intentional excerpts.",
        "Use columns:2/3, density:'tiny', and smaller readable fontSize before truncating.",
      ];
    case "equation":
      return [
        "Display math respects deck typography; use size/fontSize for dense formula grids.",
        "Split derivation steps across slides before converting equations to plain text/screenshots.",
      ];
    case "process-flow":
      return [
        "Horizontal rich flows work best with 2-3 stages; use vertical direction or split slides for rich 4+ stages.",
        "Reduce per-step body/bullets and increase component area before changing away from process-flow.",
      ];
    case "donut-summary":
      return [
        "Reserve about 5x4cm for the donut ring plus legend; do not stack it with a long table or fact-list in a shallow region.",
        "Use it for one dominant share story. Reduce minor slices or move interpretation to a rail/follow-up slide before replacing the component.",
      ];
    case "evidence-layout":
    case "chart-with-rail":
      return [
        "Use one dominant evidence object plus one concise interpretation rail; avoid putting a second full table/chart/KPI stack inside the rail.",
        "When capacity fails, increase the evidence ratio/area or move secondary support to a follow-up slide before changing the evidence component.",
      ];
    default:
      return [];
  }
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
  if (componentName === "code-block") {
    return withComponentRoot(node, codeBlockNode(slideId, name, node));
  }
  if (componentName === "equation") {
    return withComponentRoot(node, equationNode(slideId, name, node));
  }
  if (componentName === "bibliography") {
    return withComponentRoot(node, bibliographyNode(slideId, name, node));
  }
  if (componentName === "metric-card") {
    const unit = stringValue(node.unit, "");
    const trend = node.trend === "up" || node.trend === "down" || node.trend === "flat" ? node.trend : undefined;
    const status = componentTone(node.status);
    const variant = node.variant === "card" || node.variant === "compact" ? node.variant : undefined;
    const density = node.density === "compact" || node.density === "comfortable" ? node.density : undefined;
    return withComponentRoot(node, metricCard(slideId, name, stringValue(node.value, ""), stringValue(node.label, ""), {
      unit,
      trend,
      delta: stringValue(node.delta, ""),
      status,
      source: stringValue(node.source, ""),
      comparison: stringValue(node.comparison, ""),
      sparkline: Array.isArray(node.sparkline) ? node.sparkline as Array<number | string> : undefined,
      variant,
      density,
      ...surfaceOptions(node),
    }));
  }
  if (componentName === "callout") {
    return withComponentRoot(node, calloutNode(slideId, name, node));
  }
  if (componentName === "comparison-card") {
    const metrics = Array.isArray(node.metrics) ? node.metrics.map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      return { label: stringValue(rec.label, ""), value: stringValue(rec.value, ""), tone: componentTone(rec.tone) };
    }).filter((m) => m.label || m.value) : undefined;
    const variant = node.variant === "card" || node.variant === "compact" ? node.variant : undefined;
    const density = node.density === "compact" || node.density === "comfortable" ? node.density : undefined;
    return withComponentRoot(node, comparisonCard(slideId, name, stringValue(node.title, ""), comparisonPoints(node).slice(0, 6), {
      subtitle: stringValue(node.subtitle, ""),
      badge: stringValue(node.badge, ""),
      body: stringValue(node.body, ""),
      content: node.content,
      metrics,
      pros: stringArray(node.pros),
      cons: stringArray(node.cons),
      score: stringValue(node.score, ""),
      winner: node.winner === true || node.recommended === true,
      footer: stringValue(node.footer, ""),
      variant,
      density,
      ...surfaceOptions(node),
    }));
  }
  if (componentName === "step-card") {
    return withComponentRoot(node, stepCard(
      slideId,
      name,
      stringValue(node.step, stringValue(node.number, "")),
      stringValue(node.title, stringValue(node.label, "")),
      stringValue(node.body, stringValue(node.description, stringArray(node.steps).join("\n"))),
      {
        content: node.content,
        bullets: stringArray(node.bullets),
        icon: stringValue(node.icon, ""),
        marker: decorationMarker(node.marker),
        status: componentTone(node.status),
        owner: stringValue(node.owner, ""),
        time: stringValue(node.time, ""),
        variant: node.variant === "card" || node.variant === "compact" ? node.variant : undefined,
        density: node.density === "compact" || node.density === "comfortable" ? node.density : undefined,
        ...surfaceOptions(node),
      },
    ));
  }
  if (componentName === "article") return withComponentRoot(node, articleFallback(slideId, name, node));
  if (componentName === "definition-card") return withComponentRoot(node, definitionCard(slideId, name, stringValue(node.term, ""), stringValue(node.definition, "")));
  if (componentName === "numbered-list") {
    const density = node.density === "compact" ? "compact" : "comfortable";
    return withComponentRoot(node, numberedList(slideId, name, numberedListItems(node.items), density));
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
    type TLTone = "brand" | "positive" | "warning" | "danger" | "neutral";
    const toneOf = (raw: unknown): TLTone | undefined =>
      raw === "brand" || raw === "positive" || raw === "warning" || raw === "danger" || raw === "neutral" ? raw : undefined;
    const items = Array.isArray(node.items) ? node.items.map((raw, index) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      // `content` accepts any DomNode (registered component or
      // primitive). It runs through the same materialize/expand path as
      // any other slide child, so nested components are handled by the
      // renderer recursively.
      const contentRaw = rec.content;
      const content: DomNode | undefined = contentRaw && typeof contentRaw === "object" && !Array.isArray(contentRaw)
        ? normalizeTimelineContent(slideId, name, index, contentRaw as DomNode)
        : undefined;
      return {
        time: stringValue(rec.time, stringValue(rec.date, stringValue(rec.year, ""))),
        // title is now optional; when content is present, agents often
        // omit it because the content carries its own headline.
        title: stringValue(rec.title, stringValue(rec.label, stringValue(rec.headline, stringValue(rec.name, "")))),
        body: stringValue(rec.body, stringValue(rec.description, "")),
        tone: toneOf(rec.tone),
        shape: stringValue(rec.shape, stringValue(rec.milestoneShape, stringValue(rec.markerShape, ""))),
        icon: stringValue(rec.icon, ""),
        iconSrc: stringValue(rec.iconSrc, ""),
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
    const gap = typeof node.gap === "number" && Number.isFinite(node.gap) ? node.gap : undefined;
    return withComponentRoot(node, timelineBlock(slideId, name, { items, direction, gap }));
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
        delta: stringValue(rec.delta, ""),
        status: componentTone(rec.status),
        source: stringValue(rec.source, ""),
        comparison: stringValue(rec.comparison, ""),
        sparkline: Array.isArray(rec.sparkline) ? rec.sparkline as Array<number | string> : undefined,
        trend,
      };
    });
    const columns = typeof node.columns === "number" ? node.columns : undefined;
    return withComponentRoot(node, kpiGrid(slideId, name, metrics, columns, {
      variant: node.variant === "card" || node.variant === "compact" ? node.variant : undefined,
      density: node.density === "compact" || node.density === "comfortable" ? node.density : undefined,
      ...surfaceOptions(node),
    }));
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
    const rawTone = stringValue(node.tone, "");
    const semanticTone = componentTone(rawTone);
    return withComponentRoot(node, featureCard(slideId, name, {
      icon: stringValue(node.icon, "ellipse"),
      iconSrc: stringValue(node.iconSrc, ""),
      title: stringValue(node.title, ""),
      body: stringValue(node.body, ""),
      content: node.content,
      marker: decorationMarker(node.marker),
      badge: stringValue(node.badge, ""),
      tags: stringArray(node.tags),
      metric: node.metric && typeof node.metric === "object" ? {
        value: stringValue((node.metric as Record<string, unknown>).value, ""),
        label: stringValue((node.metric as Record<string, unknown>).label, ""),
        tone: componentTone((node.metric as Record<string, unknown>).tone),
      } : undefined,
      proof: stringValue(node.proof, ""),
      ctaText: stringValue(node.ctaText, ""),
      iconColor: stringValue(node.iconColor, ""),
      iconBackground: stringValue(node.iconBackground, ""),
      tone: semanticTone,
      titleColor: stringValue(node.titleColor, semanticTone ? "" : rawTone),
      variant: node.variant === "card" || node.variant === "compact" ? node.variant : undefined,
      density: node.density === "compact" || node.density === "comfortable" ? node.density : undefined,
      ...surfaceOptions(node),
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
      return {
        title: stringValue(rec.title, stringValue(rec.label, "")),
        body: stringValue(rec.body, stringValue(rec.description, "")),
        status: stringValue(rec.status, ""),
        owner: stringValue(rec.owner, ""),
        time: stringValue(rec.time, stringValue(rec.duration, "")),
        icon: stringValue(rec.icon, ""),
        iconSrc: stringValue(rec.iconSrc, stringValue(rec.src, "")),
        bullets: stringArray(rec.bullets),
        step: stringValue(rec.step, ""),
        number: stringValue(rec.number, ""),
        marker: processFlowMarker(rec.marker),
        accentColor: stringValue(rec.accentColor, ""),
      };
    }).filter((step) => step.title);
    const direction = node.direction === "vertical" ? "vertical" : "horizontal";
    const marker = processFlowMarker(node.marker);
    const connector = node.connector === "arrow" || node.connector === "chevron" || node.connector === "line" || node.connector === "none" ? node.connector : undefined;
    const connectorDash = node.connectorDash === "solid" || node.connectorDash === "dash" || node.connectorDash === "dot" ? node.connectorDash : undefined;
    const placement = node.placement === "top" || node.placement === "center" ? node.placement : undefined;
    const spread = node.spread === "compact" || node.spread === "balanced" || node.spread === "fill" ? node.spread : undefined;
    const stepAccent = node.stepAccent === "top" || node.stepAccent === "none" ? node.stepAccent : undefined;
    const stepSurface = node.stepSurface && typeof node.stepSurface === "object" && !Array.isArray(node.stepSurface) ? node.stepSurface as AgentSurface : undefined;
    return withComponentRoot(node, processFlow(slideId, name, {
      steps,
      direction,
      variant: node.variant === "cards" ? "cards" : undefined,
      density: node.density === "compact" || node.density === "comfortable" ? node.density : undefined,
      marker,
      showNumbers: typeof node.showNumbers === "boolean" ? node.showNumbers : undefined,
      connector,
      connectorDash,
      connectorColor: stringValue(node.connectorColor, ""),
      placement,
      spread,
      stepAccent,
      stepSurface,
      ...surfaceOptions(node),
    }));
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
    type BarTone = "brand" | "positive" | "neutral" | "warning" | "danger";
    const coerceTone = (v: unknown): BarTone | undefined => {
      const norm = normalizeToneAlias(v);
      return norm === "brand" || norm === "positive" || norm === "neutral" || norm === "warning" || norm === "danger" ? norm : undefined;
    };
    const tone = coerceTone(node.tone);
    const items = Array.isArray(node.items) ? node.items.map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const value = barListValue(rec.value, rec.score, rec.percent);
      const valueLabel = barListValueLabel(rec.valueLabel, rec.value ?? rec.score ?? rec.percent, value);
      return {
        label: stringValue(rec.label, stringValue(rec.name, stringValue(rec.title, ""))),
        value,
        max: rec.max === undefined ? undefined : numberValue(rec.max, undefined),
        valueLabel,
        tone: coerceTone(rec.tone),
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
    // `points` is an alias for `bullets`; either resolves to the bulleted
    // implications below the headline. When neither is set AND `detail` looks
    // like a hand-rolled inline numbered/semicolon list, auto-split it so the
    // takeaway renders structured rather than as a single wrapped paragraph.
    const explicitBullets = stringArray(node.bullets).length ? stringArray(node.bullets) : stringArray(node.points);
    const detailText = stringValue(node.detail, stringValue(node.body, stringValue(node.description, "")));
    const splitBullets = explicitBullets.length === 0 ? splitInlineList(detailText) : null;
    const finalDetail = splitBullets ? "" : detailText;
    const finalBullets = splitBullets ? splitBullets : explicitBullets;
    return withComponentRoot(node, keyTakeaway(slideId, name, {
      headline: stringValue(node.headline, stringValue(node.title, "")),
      detail: finalDetail,
      content: node.content,
      bullets: finalBullets,
      tone,
      variant: node.variant === "banner" || node.variant === "minimal" || node.variant === "panel" ? node.variant : undefined,
      density: node.density === "compact" || node.density === "comfortable" ? node.density : undefined,
      ...surfaceOptions(node),
    }));
  }
  if (componentName === "numbered-grid") {
    const items = Array.isArray(node.items) ? node.items.map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : { title: String(raw ?? "") };
      return {
        title: stringValue(rec.title, stringValue(rec.label, stringValue(rec.name, ""))),
        body: stringValue(rec.body, stringValue(rec.description, stringValue(rec.text, ""))),
        marker: decorationMarker(rec.marker),
        tone: componentTone(rec.tone),
      };
    }).filter((item) => item.title) : [];
    const cols = typeof node.columns === "number" ? node.columns : undefined;
    const toneRaw = node.tone;
    const tone = toneRaw === "brand" || toneRaw === "neutral" ? toneRaw : undefined;
    const numberStyle = node.numberStyle === "plain" ? "plain" : node.numberStyle === "chip" ? "chip" : undefined;
    return withComponentRoot(node, numberedGrid(slideId, name, { items, columns: cols, tone, marker: decorationMarker(node.marker), numberStyle, ...surfaceOptions(node) }));
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
  if (componentName === "explanation-block") {
    return withComponentRoot(node, explanationBlockNode(slideId, name, node));
  }
  if (componentName === "comparison-list") {
    return withComponentRoot(node, comparisonListNode(slideId, name, node));
  }
  if (componentName === "fact-list") {
    return withComponentRoot(node, factListNode(slideId, name, node));
  }
  if (componentName === "executive-summary") {
    return withComponentRoot(node, executiveSummaryNode(slideId, name, node));
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
    type MatItemTone = "brand" | "positive" | "warning" | "danger";
    type MatQuadrantTone = MatItemTone | "neutral";
    const xAxis = node.xAxis && typeof node.xAxis === "object" ? node.xAxis as { low: string; high: string } : { low: "Low", high: "High" };
    const yAxis = node.yAxis && typeof node.yAxis === "object" ? node.yAxis as { low: string; high: string } : { low: "Low", high: "High" };
    const items: Array<{ label: string; x: "low" | "high"; y: "low" | "high"; tone?: MatItemTone }> = Array.isArray(node.items) ? node.items.map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const tRaw = rec.tone;
      const tone: MatItemTone | undefined = tRaw === "brand" || tRaw === "positive" || tRaw === "warning" || tRaw === "danger" ? tRaw : undefined;
      const x: "low" | "high" = rec.x === "high" ? "high" : "low";
      const y: "low" | "high" = rec.y === "high" ? "high" : "low";
      return { label: stringValue(rec.label, ""), x, y, tone };
    }).filter((it) => it.label) : [];
    const ql = node.quadrantLabels && typeof node.quadrantLabels === "object" ? node.quadrantLabels as Record<string, unknown> : {};
    const qt = node.quadrantTones && typeof node.quadrantTones === "object" ? node.quadrantTones as Record<string, unknown> : {};
    const tone = (raw: unknown): MatQuadrantTone | undefined =>
      raw === "brand" || raw === "positive" || raw === "warning" || raw === "danger" || raw === "neutral" ? raw : undefined;
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
      quadrantTones: {
        tl: tone(qt.tl),
        tr: tone(qt.tr),
        bl: tone(qt.bl),
        br: tone(qt.br),
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
  if (componentName === "decorative-shapes") {
    const motif = node.motif === "confetti" || node.motif === "corner-blobs" || node.motif === "sparkles" || node.motif === "molecule" || node.motif === "bubbles" ? node.motif : undefined;
    const anchor = node.anchor === "top-left" || node.anchor === "top-right" || node.anchor === "bottom-left" || node.anchor === "bottom-right" || node.anchor === "full" ? node.anchor : undefined;
    const tone = node.tone === "brand" || node.tone === "accent" || node.tone === "warning" || node.tone === "muted" ? node.tone : undefined;
    return withComponentRoot(node, decorativeShapes(slideId, name, {
      motif,
      anchor,
      tone,
      count: typeof node.count === "number" ? node.count : undefined,
      width: typeof node.width === "number" ? node.width : undefined,
      height: typeof node.height === "number" ? node.height : undefined,
      ...(node.asBackground === false ? { asBackground: false } : {}),
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
  if (componentName === "brand-mark") {
    const corner = node.corner === "top-left" || node.corner === "top-right" || node.corner === "bottom-left" || node.corner === "bottom-right" ? node.corner : undefined;
    const tn = node.tone === "muted" || node.tone === "neutral" || node.tone === "inverse" || node.tone === "brand" ? node.tone : undefined;
    return withComponentRoot(node, brandMark(slideId, name, {
      text: stringValue(node.text, ""),
      corner,
      tone: tn,
      width: typeof node.width === "number" ? node.width : undefined,
      height: typeof node.height === "number" ? node.height : undefined,
      offsetX: typeof node.offsetX === "number" ? node.offsetX : undefined,
      offsetY: typeof node.offsetY === "number" ? node.offsetY : undefined,
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
  if (componentName === "pointer-arrow") {
    const dir = node.direction === "left" || node.direction === "down" || node.direction === "up" || node.direction === "right" ? node.direction : undefined;
    const tn = node.tone === "brand" || node.tone === "positive" || node.tone === "warning" || node.tone === "danger" ? node.tone : undefined;
    const anchorVals = ["top-left", "top-center", "top-right", "middle-left", "middle-center", "middle-right", "bottom-left", "bottom-center", "bottom-right"];
    const anchor = typeof node.anchor === "string" && anchorVals.includes(node.anchor) ? node.anchor as Parameters<typeof pointerArrow>[2]["anchor"] : undefined;
    const expanded = pointerArrow(slideId, name, {
      label: stringValue(node.label, "") || undefined,
      direction: dir,
      anchor,
      offsetX: typeof node.offsetX === "number" ? node.offsetX : undefined,
      offsetY: typeof node.offsetY === "number" ? node.offsetY : undefined,
      width: typeof node.width === "number" ? node.width : undefined,
      height: typeof node.height === "number" ? node.height : undefined,
      tone: tn,
      style: node.style === "dashed" || node.style === "solid" ? node.style : undefined,
    });
    const root = withComponentRoot(node, expanded);
    // width/height are both authored placement hints and internal fit
    // constraints. Preserve the agent's larger explicit size, but do not let
    // too-small values override the component's minimum needed to fit label +
    // arrow.
    return {
      ...root,
      width: Math.max(numberValue(node.width, 0), numberValue(expanded.width, 0)),
      height: Math.max(numberValue(node.height, 0), numberValue(expanded.height, 0)),
    };
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
    const corner = node.corner === "top-left" || node.corner === "top-right" || node.corner === "bottom-left" || node.corner === "bottom-right" ? node.corner : undefined;
    const tn = node.tone === "brand" || node.tone === "muted" ? node.tone : undefined;
    const cur = typeof node.current === "number" || typeof node.current === "string" ? node.current : "";
    const tot = typeof node.total === "number" || typeof node.total === "string" ? node.total : undefined;
    return withComponentRoot(node, bigPageNumber(slideId, name, {
      current: cur, total: tot, corner, tone: tn,
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
  if (componentName === "freeform-group") {
    return withComponentRoot(node, freeformGroupNode(slideId, name, node));
  }
  if (componentName === "cover-composition") {
    return withComponentRoot(node, coverCompositionNode(slideId, name, node));
  }
  if (componentName === "chapter-divider") {
    return withComponentRoot(node, chapterDividerNode(slideId, name, node));
  }
  if (componentName === "hero-and-support") {
    return withComponentRoot(node, heroAndSupportNode(slideId, name, node));
  }
  if (componentName === "chart-with-rail") {
    return withComponentRoot(node, chartWithRailNode(slideId, name, node));
  }
  if (componentName === "snapshot-callouts") {
    return withComponentRoot(node, snapshotCalloutsNode(slideId, name, node));
  }
  if (componentName === "evidence-layout") {
    return withComponentRoot(node, evidenceLayoutNode(slideId, name, node));
  }
  if (componentName === "factorial-matrix") {
    return withComponentRoot(node, factorialMatrixNode(slideId, name, node));
  }
  if (componentName === "probe-flow") {
    const steps = arrayValue(node.steps, node.items).map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : { title: String(raw ?? "") };
      return { title: stringValue(rec.title, stringValue(rec.label, "")), body: stringValue(rec.body, stringValue(rec.description, "")) };
    }).filter((step) => step.title);
    return withComponentRoot(node, processFlow(slideId, name, { steps, direction: node.direction === "vertical" ? "vertical" : "horizontal" }));
  }
  if (componentName === "failure-taxonomy") {
    return withComponentRoot(node, failureTaxonomyNode(slideId, name, node));
  }
  if (componentName === "main-effect-comparison") {
    return withComponentRoot(node, mainEffectComparisonNode(slideId, name, node));
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
  if (componentName === "takeaway-list" || componentName === "warning-list") {
    type TakeawayTone = "brand" | "positive" | "warning" | "danger" | "neutral";
    const allowed = new Set<string>(["brand", "positive", "warning", "danger", "neutral"]);
    const coerce = (v: unknown): TakeawayTone | undefined => {
      const norm = normalizeToneAlias(v);
      return norm && allowed.has(norm) ? norm as TakeawayTone : undefined;
    };
    const items: Array<{ headline: string; detail?: string; tone?: TakeawayTone; marker?: DecorationMarkerInput }> = Array.isArray(node.items) ? node.items.map((raw) => {
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : { headline: String(raw ?? "") };
      return {
        headline: stringValue(rec.headline, stringValue(rec.title, stringValue(rec.text, ""))),
        detail: stringValue(rec.detail, stringValue(rec.body, stringValue(rec.description, ""))) || undefined,
        tone: coerce(rec.tone),
        marker: decorationMarker(rec.marker),
      };
    }).filter((item) => item.headline) : [];
    // warning-list defaults to tone "warning"; takeaway-list keeps existing
    // brand default. Both share the same render path so danger/warning mix
    // works in either component.
    const explicitTone = coerce(node.tone);
    const tone: TakeawayTone | undefined = explicitTone || (componentName === "warning-list" ? "warning" : undefined);
    return withComponentRoot(node, takeawayList(slideId, name, { title: stringValue(node.title, ""), items, tone, marker: decorationMarker(node.marker), ...surfaceOptions(node) }));
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
      required: primitiveType === "stack" || primitiveType === "grid" || primitiveType === "split",
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
  const typography = typographyProps(source);
  const styled = Object.keys(typography).length > 0
    ? applyTypographyOverrides(expanded, typography)
    : expanded;
  return {
    ...styled,
    ...layoutProps(source),
    id: source.id || expanded.id,
  };
}

function typographyProps(node: DomNode): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of [
    "color",
    "fontSize",
    "fontFamily",
    "font",
    "fontWeight",
    "weight",
    "lineHeight",
    "letterSpacing",
    "tracking",
    "uppercase",
    "italic",
    "underline",
    "size",
  ]) {
    if (node[key] !== undefined) output[key] = node[key];
  }
  return output;
}

function applyTypographyOverrides(node: DomNode, typography: Record<string, unknown>): DomNode {
  const next: DomNode = { ...node };
  const appliesHere = next.type === "text" || next.type === "bullets";
  if (appliesHere) {
    for (const [key, value] of Object.entries(typography)) {
      if (next[key] === undefined) next[key] = value;
    }
  }
  if (next.children) {
    next.children = next.children.map((child) => applyTypographyOverrides(child, typography));
  }
  return next;
}

function layoutProps(node: DomNode): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of [
    "area",
    "at",
    "fixedWidth",
    "fixedHeight",
    "minWidth",
    "minHeight",
    "maxWidth",
    "maxHeight",
    "layoutWeight",
    "optional",
    "anchor",
    "anchorTo",
    "offsetX",
    "offsetY",
    "width",
    "height",
    "fillSlide",
    "layer",
    "zIndex",
    "fill",
    "line",
    "lineWidth",
    "dash",
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
    "fontSize",
    "fontFamily",
    "font",
    "fontWeight",
    "lineHeight",
    "color",
    "letterSpacing",
    "tracking",
    "uppercase",
    "italic",
    "underline",
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

function calloutNode(slideId: string, name: string, node: DomNode): DomNode {
  const title = stringValue(node.title, "");
  const text = stringValue(node.text, "");
  const body = stringValue(node.body, stringValue(node.detail, ""));
  const bullets = stringArray(node.bullets).length ? stringArray(node.bullets) : stringArray(node.items);
  const richContent = richTextRuns(node.content);
  const normalizedVariant = normalizeComponentEnumValue("callout", "variant", node.variant);
  const variant = normalizedVariant === "banner" || normalizedVariant === "card" ? normalizedVariant : (title || body || richContent || bullets.length ? "card" : "plain");
  const toneProps = tonePropsFrom(node.tone);
  const accent = toneAccent(node.tone);
  // Compact density: tighter padding/gap and no decorative accent. Triggered
  // either by explicit author choice (density:"compact") or by render's
  // densifyCalloutSiblings pre-pass when ≥4 callouts share a stack/grid.
  const compact = node.density === "compact";
  if (variant === "plain") {
    const expanded = insightCallout(slideId, name, text || title || body);
    return { ...expanded, ...toneProps, color: "text.primary" };
  }
  const children: DomNode[] = [];
  const textPromotedToTitle = !title && variant === "banner" && Boolean(text);
  const titleText = title || (textPromotedToTitle ? text : "");
  if (titleText) {
    children.push({
      id: `${slideId}.${name}.title`,
      type: "text",
      text: titleText,
      style: compact ? "label" : "card-title",
      color: accent,
      ...(compact ? { weight: "semibold" } : {}),
      minHeight: compact ? 0.32 : 0.55,
      autoFit: "shrink",
    });
  }
  const bodyText = body || (textPromotedToTitle ? "" : text);
  if (bodyText || richContent) {
    const bodyPlain = bodyText || richTextPlain(richContent);
    children.push({
      id: `${slideId}.${name}.body`,
      type: "text",
      text: bodyText,
      ...(richContent ? { content: richContent } : {}),
      style: variant === "banner" ? "lead" : (compact ? "caption" : "paragraph"),
      color: "text.primary",
      autoFit: "shrink",
      lineHeight: variant === "banner" ? 1.42 : (compact ? 1.28 : 1.45),
      // Compact rows have ~1.2-1.6cm of vertical budget total; the body
      // shouldn't claim more than ~0.5cm so the title stays visible.
      minHeight: compact ? 0.42 : estimateCalloutBodyMinHeight(bodyPlain, variant === "banner"),
      ...(compact ? { optional: true } : {}),
    });
  }
  if (bullets.length > 0) children.push(bulletList(slideId, `${name}.bullets`, bullets.slice(0, 5), "compact"));
  if (children.length === 0) children.push({ id: `${slideId}.${name}.body`, type: "text", text, style: "callout", color: "text.primary", autoFit: "shrink" });
  const surface = variant === "banner"
    ? { fill: toneProps.fill || "brand.tint", line: toneProps.line || accent, padding: compact ? 0.18 : 0.75, cornerRadius: 0.08 }
    : { fill: toneProps.fill || "surface", line: toneProps.line || "divider", padding: compact ? 0.18 : 0.72, cornerRadius: compact ? 0.06 : 0.12 };
  const accentChild: DomNode | null = compact ? null : {
    id: `${slideId}.${name}.accent`,
    type: "shape",
    preset: "rect",
    fill: accent,
    line: accent,
    fixedHeight: 0.12,
    fixedWidth: 2.5,
    align: "start",
    optional: true,
  };
  return {
    id: `${slideId}.${name}`,
    type: "stack",
    direction: "vertical",
    gap: compact ? 0.10 : 0.22,
    role: "callout",
    ...surface,
    children: [
      ...(accentChild ? [accentChild] : []),
      ...children,
    ],
  };
}

function toneAccent(tone: unknown): string {
  if (tone === "positive") return "success";
  if (tone === "warning") return "warning";
  if (tone === "danger") return "danger";
  if (tone === "neutral") return "text.primary";
  return "brand.primary";
}

function freeformGroupNode(_slideId: string, _name: string, node: DomNode): DomNode {
  const mode = node.mode === "background" ? "background" : "overlay";
  const children = Array.isArray(node.children) ? node.children.map((child, index) => {
    const out = { ...child };
    const hasAbsoluteAt = Array.isArray(out.at)
      && out.at.length === 4
      && out.at.every((value) => typeof value === "number" && Number.isFinite(value));
    const hasAnchorTo = typeof out.anchorTo === "string" && out.anchorTo.length > 0;
    if (!hasAbsoluteAt && !hasAnchorTo && typeof out.anchor !== "string") out.anchor = "top-left";
    if (!hasAbsoluteAt && typeof out.offsetX !== "number") out.offsetX = 0;
    if (!hasAbsoluteAt && typeof out.offsetY !== "number") out.offsetY = 0;
    if (typeof out.zIndex !== "number") out.zIndex = mode === "background" ? -1 : index + 1;
    return out;
  }) : [];
  return { id: node.id, type: "fragment", children };
}

function coverCompositionNode(slideId: string, name: string, node: DomNode): DomNode {
  const tone = node.tone === "inverse" ? "inverse" : node.tone === "brand" ? "brand" : "neutral";
  const color = tone === "inverse" ? "text.inverse" : "text.primary";
  const decor = node.decor === "grid" || node.decor === "shapes" ? node.decor : "none";
  const visual = node.visual && typeof node.visual === "object" ? node.visual as Record<string, unknown> : {};
  const hero = node.heroStat && typeof node.heroStat === "object" ? node.heroStat as Record<string, unknown> : {};
  const hasHero = Boolean(stringValue(hero.value, ""));
  const title = stringValue(node.title, "");
  const titleWeight = weightedTextLengthForComponent(title);
  const titleStyle = node.titleSize === "slide-title" || node.titleSize === "section-title" || node.titleSize === "deck-title"
    ? node.titleSize
    : titleWeight > 18
      ? "slide-title"
      : "deck-title";
  const requestedLockupWidth = numberValue(node.lockupWidth, hasHero ? 13.5 : 18.4);
  const requestedLockupHeight = numberValue(node.lockupHeight, titleStyle === "deck-title" ? 6.1 : 5.6);
  const lockupWidth = Math.max(hasHero ? 13.5 : 16.5, Math.min(20.8, requestedLockupWidth));
  const lockupHeight = Math.max(titleStyle === "deck-title" ? 4.8 : 3.6, Math.min(8.4, requestedLockupHeight));
  const children: DomNode[] = [];
  if (typeof visual.src === "string" && visual.src) {
    const anchorVals = ["top-left", "top-center", "top-right", "middle-left", "middle-center", "middle-right", "bottom-left", "bottom-center", "bottom-right"];
    const visualAnchor = typeof visual.anchor === "string" && anchorVals.includes(visual.anchor) ? visual.anchor : "top-left";
    const visualHasBox = visual.fillSlide === false
      || typeof visual.width === "number"
      || typeof visual.height === "number"
      || (typeof visual.anchor === "string" && visualAnchor !== "top-left");
    const visualOpacity = numberValue(visual.opacity, undefined);
    children.push({
      id: `${slideId}.${name}.visual`,
      type: "image",
      src: visual.src,
      alt: stringValue(visual.alt, stringValue(node.title, "cover visual")),
      fit: visual.fit === "contain" || visual.fit === "fill" ? visual.fit : "cover",
      anchor: visualAnchor,
      offsetX: numberValue(visual.offsetX, 0),
      offsetY: numberValue(visual.offsetY, 0),
      ...(visualHasBox
        ? { width: numberValue(visual.width, 9.2), height: numberValue(visual.height, 8.4) }
        : { fillSlide: true }),
      ...(visualOpacity !== undefined ? { opacity: visualOpacity } : {}),
      zIndex: -3,
    });
    if (tone === "inverse") {
      children.push({ id: `${slideId}.${name}.scrim`, type: "shape", preset: "rect", fill: "000000", fillOpacity: numberValue(visual.scrimOpacity, 0.42), anchor: "top-left", offsetX: 0, offsetY: 0, fillSlide: true, zIndex: -2 });
    }
  }
  if (decor === "grid") children.push(decorationGrid(slideId, `${name}.decor`, { pattern: "dots", density: "sparse", tone: "muted" }));
  if (decor === "shapes") children.push(decorativeShapes(slideId, `${name}.decor`, { motif: "corner-blobs", anchor: "bottom-right", tone: "brand", count: 7 }));
  children.push({
    id: `${slideId}.${name}.lockup`,
    type: "stack",
    direction: "vertical",
    gap: 0.3,
    anchor: "middle-left",
    offsetX: 1.4,
    offsetY: 0,
    width: lockupWidth,
    height: lockupHeight,
    zIndex: 1,
    children: [
      ...(stringValue(node.eyebrow, "") ? [{ id: `${slideId}.${name}.eyebrow`, type: "text" as const, text: stringValue(node.eyebrow, ""), style: "label", color: tone === "inverse" ? "text.inverse" : "brand.primary", uppercase: true, letterSpacing: 100, minHeight: 0.45, autoFit: "shrink" as const }] : []),
      { id: `${slideId}.${name}.title`, type: "text", text: title, style: titleStyle, color, align: "left", autoFit: "shrink", minHeight: titleStyle === "deck-title" ? 1.55 : 1.15 },
      ...(stringValue(node.subtitle, "") ? [{ id: `${slideId}.${name}.subtitle`, type: "text" as const, text: stringValue(node.subtitle, ""), style: "lead", color: tone === "inverse" ? "text.inverse" : "text.muted", align: "left" as const, minHeight: 0.8, autoFit: "shrink" as const }] : []),
    ],
  });
  if (hasHero) {
    children.push({
      id: `${slideId}.${name}.hero`,
      type: "stack",
      direction: "vertical",
      gap: 0.12,
      align: "center",
      justify: "center",
      children: [
        { id: `${slideId}.${name}.hero.value`, type: "text", text: stringValue(hero.value, ""), style: "metric-value", size: "xl", color: tone === "inverse" ? "text.inverse" : "brand.primary", align: "center", minHeight: 1.0, autoFit: "shrink" },
        { id: `${slideId}.${name}.hero.label`, type: "text", text: stringValue(hero.label, ""), style: "label", color: tone === "inverse" ? "text.inverse" : "text.primary", align: "center", minHeight: 0.38, autoFit: "shrink" },
        ...(stringValue(hero.caption, "") ? [{ id: `${slideId}.${name}.hero.caption`, type: "text" as const, text: stringValue(hero.caption, ""), style: "caption", color: tone === "inverse" ? "text.inverse" : "text.muted", align: "center" as const, minHeight: 0.35, autoFit: "shrink" as const }] : []),
      ],
      anchor: "bottom-right",
      offsetX: 1.2,
      offsetY: 1.0,
      width: 6.2,
      height: 2.9,
      zIndex: 2,
    } as DomNode);
  }
  return { id: `${slideId}.${name}`, type: "fragment", children };
}

function chapterDividerNode(slideId: string, name: string, node: DomNode): DomNode {
  const tone = node.tone === "neutral" || node.tone === "inverse" ? node.tone : "brand";
  const inverse = tone === "brand" || tone === "inverse";
  const bg = tone === "neutral" ? "surface" : "brand.primary";
  const fg = inverse ? "text.inverse" : "text.primary";
  const children: DomNode[] = [
    { id: `${slideId}.${name}.bg`, type: "shape", preset: "rect", fill: bg, line: bg, anchor: "top-left", offsetX: 0, offsetY: 0, fillSlide: true, zIndex: -2 },
    {
      ...bigPageNumber(slideId, `${name}.num`, { current: stringValue(node.chapter, stringValue(node.number, "01")), corner: "top-right", tone: tone === "neutral" ? "muted" : "brand" }),
      color: inverse ? "text.inverse" : "brand.primary",
      anchor: "top-right",
      offsetX: 0.9,
      offsetY: 0.7,
      width: 6.5,
      height: 2.2,
      zIndex: 1,
    } as DomNode,
    {
      id: `${slideId}.${name}.lockup`,
      type: "stack",
      direction: "vertical",
      gap: 0.35,
      anchor: "middle-left",
      offsetX: 1.4,
      offsetY: 0.2,
      width: 15,
      height: 5.0,
      zIndex: 2,
      children: [
        ...(stringValue(node.eyebrow, "") ? [{ id: `${slideId}.${name}.eyebrow`, type: "text" as const, text: stringValue(node.eyebrow, ""), style: "label", color: fg, uppercase: true, letterSpacing: 120, minHeight: 0.45, autoFit: "shrink" as const }] : []),
        { id: `${slideId}.${name}.title`, type: "text", text: stringValue(node.title, ""), style: "deck-title", color: fg, align: "left", autoFit: "shrink" },
        ...(stringValue(node.subtitle, "") ? [{ id: `${slideId}.${name}.subtitle`, type: "text" as const, text: stringValue(node.subtitle, ""), style: "lead", color: fg, align: "left" as const, minHeight: 0.8, autoFit: "shrink" as const }] : []),
      ],
    },
  ];
  const sections = Array.isArray(node.sections) ? node.sections.map(String) : [];
  if (sections.length > 0) {
    children.push({ ...timelineAxisBar(slideId, `${name}.nav`, { sections, current: numberValue(node.current, 0), tone: "neutral" }), anchor: "bottom-left", offsetX: 1.4, offsetY: 0.7, width: 17, height: 1.0, zIndex: 2 } as DomNode);
  }
  return { id: `${slideId}.${name}`, type: "fragment", children };
}

function heroAndSupportNode(slideId: string, name: string, node: DomNode): DomNode {
  const tone = componentTone(node.tone) || "brand";
  const hero = domNodeValue(node.hero, `${slideId}.${name}.hero`) || {
    id: `${slideId}.${name}.hero`,
    type: "key-takeaway",
    headline: stringValue(node.headline, stringValue(node.title, "")),
    detail: stringValue(node.detail, stringValue(node.body, "")),
    tone,
    variant: "panel",
  };
  const supports = arrayValue(node.supports, node.items)
    .slice(0, 4)
    .map((item, index) => supportModuleNode(slideId, `${name}.support${index + 1}`, item, tone));
  const supportGrid: DomNode = {
    id: `${slideId}.${name}.supports`,
    type: "grid",
    columns: supports.length <= 2 ? 1 : 2,
    gap: 0.3,
    layoutWeight: node.layout === "top" ? 0.8 : 0.92,
    children: supports.length ? supports : [{
      id: `${slideId}.${name}.support.empty`,
      type: "spacer",
      fixedHeight: 0.2,
    }],
  };
  if (node.layout === "top") {
    return {
      id: `${slideId}.${name}`,
      type: "stack",
      direction: "vertical",
      gap: 0.45,
      role: "hero-and-support",
      children: [
        { ...hero, layoutWeight: typeof hero.layoutWeight === "number" ? hero.layoutWeight : 1.1 },
        supportGrid,
      ],
    };
  }
  return {
    id: `${slideId}.${name}`,
    type: "split",
    direction: "horizontal",
    ratio: Array.isArray(node.ratio) ? node.ratio : [0.62, 0.38],
    gap: typeof node.gap === "number" ? node.gap : 0.55,
    role: "hero-and-support",
    children: [
      { ...hero, layoutWeight: typeof hero.layoutWeight === "number" ? hero.layoutWeight : 0.62 },
      supportGrid,
    ],
  };
}

function chartWithRailNode(slideId: string, name: string, node: DomNode): DomNode {
  const evidence = domNodeValue(node.evidence, `${slideId}.${name}.evidence`) || { id: `${slideId}.${name}.evidence.empty`, type: "spacer" };
  const rail = domNodeValue(node.rail, `${slideId}.${name}.rail`) || interpretationRailNode(slideId, `${name}.rail`, node);
  const layout = node.layout === "rail-left" ? "rail-left" : node.layout === "stacked" ? "stacked" : "rail-right";
  const direction = layout === "stacked" ? "vertical" : "horizontal";
  const ratio = Array.isArray(node.ratio) ? node.ratio : (layout === "stacked" ? [0.68, 0.32] : [0.72, 0.28]);
  const children = layout === "rail-left" ? [rail, evidence] : [evidence, rail];
  return {
    id: `${slideId}.${name}`,
    type: "split",
    direction,
    ratio: layout === "rail-left" ? [...ratio].reverse() : ratio,
    gap: typeof node.gap === "number" ? node.gap : 0.55,
    role: "chart-with-rail",
    children,
  };
}

function snapshotCalloutsNode(slideId: string, name: string, node: DomNode): DomNode {
  const callouts = arrayValue(node.callouts, node.items).slice(0, 5);
  const tone = node.tone === "tinted" ? "tinted" : componentTone(node.tone) || "brand";
  const image: DomNode = {
    id: `${slideId}.${name}.image`,
    type: "image-card",
    src: stringValue(node.src, ""),
    title: stringValue(node.title, ""),
    caption: stringValue(node.caption, ""),
    fit: node.fit === "cover" || node.fit === "fill" ? node.fit : "contain",
    variant: "frameless",
  };
  const rail: DomNode = {
    id: `${slideId}.${name}.rail`,
    type: "stack",
    direction: "vertical",
    gap: 0.22,
    role: "snapshot-callouts",
    fill: tone === "tinted" ? "brand.tint" : "surface.subtle",
    line: tone === "neutral" ? "divider" : toneToColors(tone).line || "brand.primary",
    padding: 0.45,
    cornerRadius: 0.08,
    children: callouts.length ? callouts.map((item, index) => calloutRowNode(slideId, `${name}.callout${index + 1}`, item, index, tone)) : [{
      id: `${slideId}.${name}.callout.empty`,
      type: "spacer",
      fixedHeight: 0.2,
    }],
  };
  if (node.layout === "below") {
    return {
      id: `${slideId}.${name}`,
      type: "split",
      direction: "vertical",
      ratio: Array.isArray(node.ratio) ? node.ratio : [0.7, 0.3],
      gap: typeof node.gap === "number" ? node.gap : 0.4,
      children: [image, rail],
    };
  }
  const railLeft = node.layout === "rail-left";
  return {
    id: `${slideId}.${name}`,
    type: "split",
    direction: "horizontal",
    ratio: Array.isArray(node.ratio) ? node.ratio : (railLeft ? [0.28, 0.72] : [0.72, 0.28]),
    gap: typeof node.gap === "number" ? node.gap : 0.55,
    children: railLeft ? [rail, image] : [image, rail],
  };
}

function domNodeValue(value: unknown, fallbackId: string): DomNode | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as DomNode;
  if (typeof rec.type !== "string" || !rec.type) return null;
  return {
    ...rec,
    id: typeof rec.id === "string" && rec.id ? rec.id : fallbackId,
  };
}

function supportModuleNode(slideId: string, name: string, raw: unknown, defaultTone: ComponentTone): DomNode {
  const authored = domNodeValue(raw, `${slideId}.${name}`);
  if (authored) return authored;
  const rec = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : { title: String(raw ?? "") };
  const value = stringValue(rec.value, "");
  const label = stringValue(rec.label, stringValue(rec.name, ""));
  const tone = componentTone(rec.tone) || defaultTone;
  if (value || label) {
    return {
      id: `${slideId}.${name}`,
      type: "metric-card",
      value: value || stringValue(rec.title, ""),
      label: label || stringValue(rec.body, stringValue(rec.detail, "")),
      status: tone,
      delta: stringValue(rec.delta, ""),
      variant: "compact",
    };
  }
  const title = stringValue(rec.title, stringValue(rec.headline, stringValue(rec.name, "")));
  const body = stringValue(rec.body, stringValue(rec.detail, stringValue(rec.description, "")));
  const bullets = stringArray(rec.bullets).length ? stringArray(rec.bullets) : stringArray(rec.items);
  return {
    id: `${slideId}.${name}`,
    type: "stack",
    direction: "vertical",
    gap: 0.12,
    fill: "surface.subtle",
    line: "divider",
    padding: 0.32,
    cornerRadius: 0.08,
    children: [
      ...(title ? [{ id: `${slideId}.${name}.title`, type: "text" as const, text: title, style: "card-title", color: toneAccent(tone), minHeight: 0.42, autoFit: "shrink" as const }] : []),
      ...(body ? [{ id: `${slideId}.${name}.body`, type: "text" as const, text: body, style: "caption", color: "text.primary", minHeight: 0.4, autoFit: "shrink" as const, optional: true }] : []),
      ...(bullets.length ? [{ ...bulletList(slideId, `${name}.bullets`, bullets.slice(0, 3), "compact"), optional: true } as DomNode] : []),
    ],
  };
}

function interpretationRailNode(slideId: string, name: string, node: DomNode): DomNode {
  const tone = node.tone === "tinted" ? "tinted" : componentTone(node.tone) || "brand";
  const headline = stringValue(node.headline, stringValue(node.title, "Interpretation"));
  const detail = stringValue(node.detail, stringValue(node.body, ""));
  const items = stringArray(node.items);
  return {
    id: `${slideId}.${name}`,
    type: "side-rail",
    title: headline,
    body: detail,
    tone,
    children: items.length ? [{ ...bulletList(slideId, `${name}.items`, items.slice(0, 5), "compact"), optional: true } as DomNode] : [],
  };
}

function calloutRowNode(slideId: string, name: string, raw: unknown, index: number, defaultTone: string): DomNode {
  const rec = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : { title: String(raw ?? "") };
  const tone = componentTone(rec.tone) || componentTone(defaultTone) || "brand";
  const title = stringValue(rec.title, stringValue(rec.headline, stringValue(rec.label, "")));
  const body = stringValue(rec.body, stringValue(rec.detail, stringValue(rec.description, "")));
  const accent = toneAccent(tone);
  return {
    id: `${slideId}.${name}`,
    type: "stack",
    direction: "horizontal",
    gap: 0.28,
    valign: "top",
    children: [
      {
        id: `${slideId}.${name}.num`,
        type: "text",
        text: String(index + 1).padStart(2, "0"),
        style: "label",
        weight: "bold",
        color: "text.inverse",
        fill: accent,
        cornerRadius: 0.5,
        fixedWidth: 0.58,
        fixedHeight: 0.42,
        align: "center",
        valign: "middle",
      },
      {
        id: `${slideId}.${name}.text`,
        type: "stack",
        direction: "vertical",
        gap: 0.06,
        layoutWeight: 1,
        children: [
          ...(title ? [{ id: `${slideId}.${name}.title`, type: "text" as const, text: title, style: "label", color: "text.primary", weight: "bold", minHeight: 0.34, autoFit: "shrink" as const }] : []),
          ...(body ? [{ id: `${slideId}.${name}.body`, type: "text" as const, text: body, style: "caption", color: "text.primary", minHeight: 0.34, autoFit: "shrink" as const, optional: true }] : []),
        ],
      },
    ],
  };
}

function evidenceLayoutNode(slideId: string, name: string, node: DomNode): DomNode {
  const evidence = node.evidence && typeof node.evidence === "object" ? node.evidence as DomNode : { id: `${slideId}.${name}.evidence.empty`, type: "spacer" };
  const defaultHeadline = stringValue(node.headline, stringValue(node.title, ""));
  const defaultDetail = stringValue(node.detail, stringValue(node.body, ""));
  const hasAuthoredInsight = node.insight && typeof node.insight === "object";
  const hasDefaultInsight = Boolean(defaultHeadline || defaultDetail);
  const annotations = Array.isArray(node.annotations) ? node.annotations.filter((a): a is DomNode => a && typeof a === "object").map((a, i) => ({
    ...a,
    id: typeof a.id === "string" && a.id ? a.id : `${slideId}.${name}.annotation${i + 1}`,
    zIndex: typeof a.zIndex === "number" ? a.zIndex : 4,
  })) : [];
  if (!hasAuthoredInsight && !hasDefaultInsight) {
    return { id: `${slideId}.${name}`, type: "fragment", children: [evidence, ...annotations] };
  }
  const insight = hasAuthoredInsight ? node.insight as DomNode : {
    id: `${slideId}.${name}.insight`,
    type: "insight-card",
    headline: defaultHeadline,
    detail: defaultDetail,
  };
  const layout = node.layout === "stacked" ? "vertical" : "horizontal";
  const split: DomNode = {
    id: `${slideId}.${name}.split`,
    type: "split",
    direction: layout,
    ratio: Array.isArray(node.ratio) ? node.ratio : (layout === "horizontal" ? [0.68, 0.32] : [0.68, 0.32]),
    gap: typeof node.gap === "number" ? node.gap : 0.55,
    children: [evidence, insight],
  };
  return { id: `${slideId}.${name}`, type: "fragment", children: [split, ...annotations] };
}

function factorialMatrixNode(slideId: string, name: string, node: DomNode): DomNode {
  const rows = Array.isArray(node.rows) ? node.rows.map(String) : [];
  const columns = Array.isArray(node.columns) ? node.columns.map(String) : [];
  const rawCells = Array.isArray(node.cells) ? node.cells : [];
  const gridChildren: DomNode[] = [
    { id: `${slideId}.${name}.corner`, type: "text", text: "", style: "label", fill: "surface.subtle" },
    ...columns.map((col, i) => ({ id: `${slideId}.${name}.col${i}`, type: "text" as const, text: col, style: "label", weight: "bold" as const, align: "center" as const, valign: "middle" as const, fill: "surface.subtle", color: "text.primary", minHeight: 0.6, autoFit: "shrink" as const })),
  ];
  rows.forEach((row, r) => {
    gridChildren.push({ id: `${slideId}.${name}.row${r}`, type: "text", text: row, style: "label", weight: "bold", align: "right", valign: "middle", color: "text.primary", minHeight: 0.6, autoFit: "shrink" });
    for (let c = 0; c < columns.length; c++) {
      const raw = Array.isArray(rawCells[r]) ? rawCells[r][c] : "";
      const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : { text: String(raw ?? "") };
      const tone = rec.tone;
      gridChildren.push({ id: `${slideId}.${name}.cell${r}.${c}`, type: "text", text: stringValue(rec.text, ""), style: "caption", align: "center", valign: "middle", fill: tone === "warning" ? "warning.tint" : tone === "danger" ? "danger.tint" : tone === "positive" ? "success.tint" : "surface", line: "divider", color: "text.primary", minHeight: 0.75, autoFit: "shrink" });
    }
  });
  return {
    id: `${slideId}.${name}`,
    type: "stack",
    direction: "vertical",
    gap: 0.3,
    role: "factorial-matrix",
    children: [
      ...(stringValue(node.title, "") ? [{ id: `${slideId}.${name}.title`, type: "text" as const, text: stringValue(node.title, ""), style: "card-title", minHeight: 0.6, autoFit: "shrink" as const }] : []),
      { id: `${slideId}.${name}.grid`, type: "grid", columns: Math.max(1, columns.length + 1), gap: 0.08, children: gridChildren, layoutWeight: 1 },
    ],
  };
}

function failureTaxonomyNode(slideId: string, name: string, node: DomNode): DomNode {
  const items = arrayValue(node.items).map((raw) => raw && typeof raw === "object" ? raw as Record<string, unknown> : { title: String(raw ?? "") }).filter((rec) => stringValue(rec.title, stringValue(rec.name, "")));
  const columns = typeof node.columns === "number" ? node.columns : Math.min(3, Math.max(1, items.length));
  const tone = node.tone === "brand" || node.tone === "warning" || node.tone === "danger" || node.tone === "neutral" ? node.tone : "danger";
  return {
    id: `${slideId}.${name}`,
    type: "grid",
    columns,
    gap: 0.45,
    role: "failure-taxonomy",
    children: items.map((rec, index) => {
      const examples = stringArray(rec.examples).length ? stringArray(rec.examples) : stringArray(rec.bullets);
      const title = stringValue(rec.title, stringValue(rec.name, ""));
      const rate = stringValue(rec.rate, stringValue(rec.value, ""));
      return {
        id: `${slideId}.${name}.${index}`,
        type: "stack",
        direction: "vertical",
        gap: 0.2,
        fill: tone === "neutral" ? "surface" : tone === "brand" ? "brand.tint" : tone === "warning" ? "warning.tint" : "danger.tint",
        line: tone === "neutral" ? "divider" : toneAccent(tone),
        padding: 0.22,
        cornerRadius: 0.08,
        children: [
          {
            id: `${slideId}.${name}.${index}.title`,
            type: "text",
            text: rate ? `${rate}  ${title}` : title,
            style: "card-title",
            color: "text.primary",
            minHeight: 0.45,
            autoFit: "shrink",
          },
          ...(stringValue(rec.body, "") ? [{ id: `${slideId}.${name}.${index}.body`, type: "text" as const, text: stringValue(rec.body, ""), style: "caption", color: "text.primary", minHeight: 0.4, autoFit: "shrink" as const, optional: true }] : []),
          ...(examples.length ? [{ id: `${slideId}.${name}.${index}.examples`, type: "text" as const, text: examples.slice(0, 3).join("；"), style: "caption", color: "text.primary", minHeight: 0.4, autoFit: "shrink" as const }] : []),
        ],
      };
    }),
  };
}

function mainEffectComparisonNode(slideId: string, name: string, node: DomNode): DomNode {
  const trend = node.trend === "down" || node.trend === "flat" ? node.trend : "up";
  const accent = trend === "down" ? "danger" : trend === "flat" ? "warning" : "success";
  const comparison: DomNode = {
    id: `${slideId}.${name}.effect`,
    type: "stack",
    direction: "horizontal",
    gap: 0.24,
    fixedHeight: 1.75,
    valign: "middle",
    children: [
      compactEffectValue(slideId, `${name}.before`, stringValue(node.beforeLabel, ""), stringValue(node.beforeValue, ""), "text.primary"),
      { id: `${slideId}.${name}.arrow`, type: "shape", preset: trend === "down" ? "arrow-down" : "arrow-right", fill: accent, line: accent, fixedWidth: 0.85, fixedHeight: 0.65 },
      compactEffectValue(slideId, `${name}.after`, stringValue(node.afterLabel, ""), stringValue(node.afterValue, ""), accent),
    ],
  };
  const insight: DomNode = {
    id: `${slideId}.${name}.insight`,
    type: "text",
    text: stringValue(node.insight, stringValue(node.headline, "Main effect")),
    style: "caption",
    color: "text.primary",
    fill: trend === "down" ? "danger.tint" : trend === "flat" ? "warning.tint" : "success.tint",
    line: accent,
    padding: 0.25,
    cornerRadius: 0.08,
    minHeight: 0.7,
    autoFit: "shrink",
  };
  return {
    id: `${slideId}.${name}`,
    type: "stack",
    direction: "vertical",
    gap: 0.28,
    role: "main-effect-comparison",
    children: [
      ...(stringValue(node.title, "") ? [{ id: `${slideId}.${name}.title`, type: "text" as const, text: stringValue(node.title, ""), style: "card-title", minHeight: 0.6, autoFit: "shrink" as const }] : []),
      comparison,
      insight,
    ],
  };
}

function compactEffectValue(slideId: string, id: string, label: string, value: string, color: string): DomNode {
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.08,
    layoutWeight: 1,
    align: "center",
    justify: "center",
    children: [
      { id: `${slideId}.${id}.value`, type: "text", text: value, style: "metric-value", size: "lg", color, align: "center", minHeight: 0.75, autoFit: "shrink" },
      { id: `${slideId}.${id}.label`, type: "text", text: label, style: "label", color: "text.muted", align: "center", minHeight: 0.35, autoFit: "shrink" },
    ],
  };
}

function imageCardNode(slideId: string, name: string, node: DomNode): DomNode {
  const title = stringValue(node.title, "");
  const badge = stringValue(node.badge, "");
  const insight = stringValue(node.insight, "");
  const caption = stringValue(node.caption, "");
  const fit = node.fit === "cover" || node.fit === "fill" ? node.fit : "contain";
  const imageWidth = numberValue(node.imageWidth, undefined);
  const containFrameWidth = fit === "contain" ? imageWidth ?? 18.2 : undefined;
  const annotations = arrayValue(node.annotations, node.callouts).map((raw) => {
    const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : { text: String(raw ?? "") };
    return stringValue(rec.text, stringValue(rec.label, ""));
  }).filter(Boolean).slice(0, 4);
  const frameless = node.variant === "frameless";
  return applyAgentSurface({
    id: `${slideId}.${name}`,
    type: frameless ? "stack" : "card",
    role: "image-card",
    ...(frameless ? {} : { padding: node.variant === "compact" ? 0.3 : 0.45, ...cardToneProps(node.tone) }),
    children: [{
      id: `${slideId}.${name}.stack`,
      type: "stack",
      direction: "vertical",
      gap: node.variant === "compact" ? 0.16 : 0.25,
      children: [
        ...(badge ? [{ id: `${slideId}.${name}.badge`, type: "text" as const, text: badge, style: "label", fill: "surface.subtle", color: "text.primary", cornerRadius: 0.18, fixedHeight: 0.42, fixedWidth: textChipWidthCm(badge, { min: 1.0, max: 4.8, padding: 0.62 }), align: "center" as const, autoFit: "shrink" as const }] : []),
        ...(title ? [{ id: `${slideId}.${name}.title`, type: "text" as const, text: title, style: "card-title", fixedHeight: 0.65 }] : []),
        {
          id: `${slideId}.${name}.image`,
          type: "image",
          src: stringValue(node.src, ""),
          alt: stringValue(node.alt, title || "image"),
          fit,
          ...(containFrameWidth !== undefined ? { fixedWidth: containFrameWidth, align: "center" as const } : {}),
          layoutWeight: 1,
        },
        ...(insight ? [{ id: `${slideId}.${name}.insight`, type: "text" as const, text: insight, style: "paragraph", color: "text.primary", minHeight: 0.45, autoFit: "shrink" as const, optional: true }] : []),
        ...(annotations.length ? [{ id: `${slideId}.${name}.annotations`, type: "stack" as const, direction: "horizontal" as const, gap: 0.15, optional: true, children: annotations.map((text, index) => ({ id: `${slideId}.${name}.ann${index}`, type: "text" as const, text, style: "caption" as const, color: "text.muted", fill: "surface.subtle", cornerRadius: 0.12, minHeight: 0.35, autoFit: "shrink" as const, layoutWeight: 1 })) }] : []),
        // Caption is optional+autoFit so when the image-card sits in a tight
        // fixedHeight slot the layout solver drops/shrinks the caption rather
        // than triggering FALLBACK_FAILED on the parent.
        ...(caption ? [{ id: `${slideId}.${name}.caption`, type: "text" as const, text: caption, style: "figure-caption", align: "center" as const, minHeight: 0.4, autoFit: "shrink" as const, optional: true }] : []),
      ],
    }],
  } as DomNode, surfaceOptions(node));
}

function chartCardNode(slideId: string, name: string, node: DomNode): DomNode {
  const title = stringValue(node.title, "");
  const badge = stringValue(node.badge, "");
  const insight = stringValue(node.insight, "");
  const caption = stringValue(node.caption, "");
  const data = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
  // 96vi8n slide 14: chart-card with only title+chart (no caption) had
  // padding 0.45 + gap 0.25 + title 0.65, eating ~1.4cm of the card's
  // ~8cm height — the chart looked cramped against the title and the
  // card felt empty around it. When the card has no caption, we tighten
  // padding (0.45→0.35) and gap (0.25→0.18) so the chart gets more room.
  const lean = !caption && !insight;
  const padding = lean ? 0.35 : 0.45;
  const gap = lean ? 0.18 : 0.25;
  const frameless = node.variant === "frameless";
  return applyAgentSurface({
    id: `${slideId}.${name}`,
    type: frameless ? "stack" : "card",
    role: "chart-card",
    ...(frameless ? {} : { padding: node.variant === "compact" ? 0.3 : padding, ...cardToneProps(node.tone) }),
    children: [{
      id: `${slideId}.${name}.stack`,
      type: "stack",
      direction: "vertical",
      gap,
      children: [
        ...(badge ? [{ id: `${slideId}.${name}.badge`, type: "text" as const, text: badge, style: "label", fill: "surface.subtle", color: "text.primary", cornerRadius: 0.18, fixedHeight: 0.42, fixedWidth: textChipWidthCm(badge, { min: 1.0, max: 4.8, padding: 0.62 }), align: "center" as const, autoFit: "shrink" as const }] : []),
        ...(title ? [{ id: `${slideId}.${name}.title`, type: "text" as const, text: title, style: "card-title", fixedHeight: 0.65 }] : []),
        {
          id: `${slideId}.${name}.chart`,
          type: "chart",
          role: "chart-card",
          chartType: node.chartType || node.chart,
          labels: arrayValue(node.labels, data.labels),
          series: arrayValue(node.series, data.series),
          showLegend: node.showLegend,
          showValues: node.showValues,
          orientation: node.orientation,
          dataLabels: node.dataLabels,
          positiveColor: node.positiveColor,
          negativeColor: node.negativeColor,
          yFormat: node.yFormat,
          xAxis: node.xAxis ?? node.axis,
          yAxis: node.yAxis,
          secondaryYAxis: node.secondaryYAxis ?? node.secondaryAxis,
          legend: node.legend,
          plotArea: node.plotArea,
          colors: node.colors,
          annotations: node.annotations,
          layoutWeight: 1,
        },
        ...(insight ? [{ id: `${slideId}.${name}.insight`, type: "text" as const, text: insight, style: "paragraph", color: "text.primary", minHeight: 0.45, autoFit: "shrink" as const, optional: true }] : []),
        ...(caption ? [{ id: `${slideId}.${name}.caption`, type: "text" as const, text: caption, style: "source-note", color: "text.muted", minHeight: 0.35, autoFit: "shrink" as const, optional: true }] : []),
      ],
    }],
  } as DomNode, surfaceOptions(node));
}

function tableCardNode(slideId: string, name: string, node: DomNode): DomNode {
  const title = stringValue(node.title, "");
  const badge = stringValue(node.badge, "");
  const insight = stringValue(node.insight, "");
  const caption = stringValue(node.caption, "");
  const data = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
  const tableRows = Array.isArray(node.rows) ? node.rows : Array.isArray(data.rows) ? data.rows : Array.isArray(node.items) ? node.items : [];
  const tableHeaders = Array.isArray(node.headers) ? node.headers : Array.isArray(data.headers) ? data.headers : [];
  const denseTable = node.density === "compact" || node.variant === "compact" || tableRows.length + (tableHeaders.length ? 1 : 0) >= 7;
  const cardProps = cardToneProps(node.tone);
  const cardFill = typeof node.fill === "string" ? node.fill : typeof cardProps.fill === "string" ? cardProps.fill : "surface";
  const frameless = node.variant === "frameless";
  return applyAgentSurface({
    id: `${slideId}.${name}`,
    type: frameless ? "stack" : "card",
    role: "table-card",
    ...(frameless ? {} : { padding: node.variant === "compact" ? 0.3 : 0.45, ...cardProps }),
    children: [{
      id: `${slideId}.${name}.stack`,
      type: "stack",
      direction: "vertical",
      gap: denseTable ? 0.16 : 0.25,
      children: [
        ...(badge ? [{ id: `${slideId}.${name}.badge`, type: "text" as const, text: badge, style: "label", fill: "surface.subtle", color: "text.primary", cornerRadius: 0.18, fixedHeight: 0.42, fixedWidth: textChipWidthCm(badge, { min: 1.0, max: 4.8, padding: 0.62 }), align: "center" as const, autoFit: "shrink" as const }] : []),
        ...(title ? [denseTable
          ? { id: `${slideId}.${name}.title`, type: "text" as const, text: title, style: "card-title", minHeight: 0.45, autoFit: "shrink" as const, optional: true }
          : { id: `${slideId}.${name}.title`, type: "text" as const, text: title, style: "card-title", fixedHeight: 0.65 }] : []),
        {
          id: `${slideId}.${name}.table`,
          type: "table",
          headers: node.headers || data.headers,
          columns: node.columns || data.columns,
          encoding: node.encoding,
          rows: node.rows || data.rows || node.items,
          firstRowHeader: node.firstRowHeader,
          colWidths: node.colWidths,
          rowHeights: node.rowHeights,
          density: denseTable ? "compact" : node.density,
          cellPadding: node.cellPadding ?? node.padding,
          borders: node.borders ?? node.border,
          borderDash: node.borderDash,
          bandRows: node.bandRows,
          bandCols: node.bandCols,
          firstCol: node.firstCol,
          lastCol: node.lastCol,
          lastRow: node.lastRow,
          tableStyleId: node.tableStyleId,
          bodyFill: cardFill,
          borderColor: node.borderColor,
          borderWidth: node.borderWidth,
          layoutWeight: 1,
        },
        ...(insight ? [{ id: `${slideId}.${name}.insight`, type: "text" as const, text: insight, style: "paragraph", color: "text.primary", minHeight: 0.45, autoFit: "shrink" as const, optional: true }] : []),
        ...(caption ? [{ id: `${slideId}.${name}.caption`, type: "text" as const, text: caption, style: "source-note", color: "text.muted", minHeight: 0.35, autoFit: "shrink" as const, optional: true }] : []),
      ],
    }],
  } as DomNode, surfaceOptions(node));
}

function insightCardNode(slideId: string, name: string, node: DomNode): DomNode {
  const tone = node.tone === "positive" || node.tone === "warning" || node.tone === "danger" || node.tone === "brand" ? node.tone : "neutral";
  const density = node.density === "compact" ? "compact" : "comfortable";
  const compact = density === "compact";
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
  children.push({ id: `${slideId}.${name}.headline`, type: "text", text: stringValue(node.headline, stringValue(node.title, "")), style: "card-title", color: "text.primary", minHeight: compact ? 0.38 : 0.48, autoFit: "shrink" });
  const detail = stringValue(node.detail, stringValue(node.body, stringValue(node.description, "")));
  const richContent = richTextRuns(node.content);
  if (detail || richContent) {
    const plainDetail = detail || richTextPlain(richContent);
    children.push({
      id: `${slideId}.${name}.detail`,
      type: "text",
      text: detail,
      ...(richContent ? { content: richContent } : {}),
      style: compact ? "caption" : "paragraph",
      color: "text.primary",
      minHeight: estimateInsightDetailMinHeight(plainDetail, compact),
      layoutWeight: 1,
      autoFit: "shrink",
      optional: true,
    });
  }
  const metric = node.metric && typeof node.metric === "object" ? node.metric as Record<string, unknown> : undefined;
  if (metric) {
    const value = stringValue(metric.value, "");
    const label = stringValue(metric.label, stringValue(metric.name, ""));
    if (value || label) {
      children.push({
        id: `${slideId}.${name}.metric`,
        type: "text",
        text: [value, label].filter(Boolean).join(" · "),
        style: "label",
        color: tone === "neutral" ? "text.primary" : toneAccent(tone),
        fill: "surface.subtle",
        cornerRadius: 0.12,
        align: "center",
        valign: "middle",
        minHeight: compact ? 0.32 : 0.42,
        autoFit: "shrink",
        optional: true,
      });
    }
  }
  const bullets = stringArray(node.bullets).length ? stringArray(node.bullets) : stringArray(node.items).length ? stringArray(node.items) : stringArray(node.points);
  if (bullets.length > 0) children.push({ ...bulletList(slideId, `${name}.bullets`, bullets.slice(0, compact ? 3 : 5), "compact"), optional: true });
  return {
    id: `${slideId}.${name}`,
    type: "card",
    role: "insight-card",
    padding: compact ? 0.22 : 0.32,
    ...(tone === "neutral" ? cardToneProps("neutral") : tonePropsFrom(tone)),
    children: [{
      id: `${slideId}.${name}.stack`,
      type: "stack",
      direction: "vertical",
      gap: compact ? 0.08 : 0.14,
      children,
    }],
  };
}

function explanationBlockNode(slideId: string, name: string, node: DomNode): DomNode {
  const tone = componentTone(node.tone) || "brand";
  const variant = node.variant === "plain" || node.variant === "minimal"
    ? "plain"
    : node.variant === "panel"
      ? "panel"
      : "rail";
  const compact = node.density === "compact";
  const title = stringValue(node.title, stringValue(node.headline, ""));
  const body = stringValue(node.body, stringValue(node.detail, stringValue(node.description, "")));
  const richContent = richTextRuns(node.content);
  const bullets = stringArray(node.bullets).length ? stringArray(node.bullets) : stringArray(node.items);
  const example = stringValue(node.example, "");
  const note = stringValue(node.note, "");
  const children: DomNode[] = [];
  if (title) {
    children.push({
      id: `${slideId}.${name}.title`,
      type: "text",
      text: title,
      style: "card-title",
      color: toneAccent(tone),
      minHeight: compact ? 0.42 : 0.5,
      autoFit: "shrink",
    });
  }
  if (body || richContent) {
    children.push({
      id: `${slideId}.${name}.body`,
      type: "text",
      text: body,
      ...(richContent ? { content: richContent } : {}),
      style: "paragraph",
      ...(compact ? { size: "sm" as const } : {}),
      color: "text.primary",
      lineHeight: compact ? 1.42 : 1.58,
      minHeight: estimateInsightDetailMinHeight(body || richTextPlain(richContent), compact),
      layoutWeight: 1,
      autoFit: "shrink",
    });
  }
  if (bullets.length) children.push(bulletList(slideId, `${name}.bullets`, bullets.slice(0, compact ? 4 : 6), compact ? "compact" : "comfortable"));
  if (example) {
    children.push({
      id: `${slideId}.${name}.example`,
      type: "text",
      text: `Example: ${example}`,
      style: "caption",
      color: "text.muted",
      minHeight: 0.38,
      autoFit: "shrink",
      optional: true,
    });
  }
  if (note) {
    children.push({
      id: `${slideId}.${name}.note`,
      type: "text",
      text: note,
      style: "source-note",
      color: "text.muted",
      minHeight: 0.32,
      autoFit: "shrink",
      optional: true,
    });
  }
  if (!children.length) {
    children.push({ id: `${slideId}.${name}.body`, type: "text", text: "", style: "paragraph", minHeight: 0.45 });
  }
  const contentStack: DomNode = {
    id: `${slideId}.${name}.content`,
    type: "stack",
    direction: "vertical",
    gap: compact ? 0.1 : 0.16,
    children,
  };
  const baseSurface = variant === "panel"
    ? { fill: "surface.subtle", line: "divider", padding: compact ? 0.42 : 0.58, cornerRadius: 0.1 }
    : {};
  const expanded: DomNode = variant === "rail"
    ? {
        id: `${slideId}.${name}`,
        type: "stack",
        direction: "horizontal",
        gap: compact ? 0.22 : 0.32,
        role: "explanation-block",
        children: [
          { id: `${slideId}.${name}.rail`, type: "shape", preset: "rect", fill: toneAccent(tone), line: toneAccent(tone), fixedWidth: compact ? 0.07 : 0.08 },
          { ...contentStack, layoutWeight: 1 },
        ],
      }
    : {
        id: `${slideId}.${name}`,
        type: "stack",
        direction: "vertical",
        gap: compact ? 0.1 : 0.16,
        role: "explanation-block",
        ...baseSurface,
        children,
      };
  return applyAgentSurface(expanded, surfaceOptions(node));
}

function comparisonListNode(slideId: string, name: string, node: DomNode): DomNode {
  const compact = node.density === "compact";
  const variant = node.variant === "plain" || node.variant === "subtle" ? node.variant : "columns";
  const items = recordItems(node.items).map((rec) => ({
    title: stringValue(rec.title, stringValue(rec.name, stringValue(rec.label, ""))),
    body: stringValue(rec.body, stringValue(rec.description, stringValue(rec.text, ""))),
    badge: stringValue(rec.badge, ""),
    tone: componentTone(rec.tone) || "brand",
    points: stringArray(rec.points).length ? stringArray(rec.points) : stringArray(rec.items).length ? stringArray(rec.items) : stringArray(rec.bullets),
  })).filter((item) => item.title || item.body || item.points.length);
  const columns = Math.max(1, Math.min(4, Math.round(numberValue(node.columns, items.length <= 1 ? 1 : items.length) || 1)));
  const cells = items.map((item, index) => {
    const children: DomNode[] = [];
    if (item.badge) children.push({ ...badge(slideId, `${name}.${index + 1}.badge`, { text: item.badge, tone: item.tone }), optional: true });
    if (item.title) children.push({ id: `${slideId}.${name}.${index + 1}.title`, type: "text", text: item.title, style: "card-title", color: toneAccent(item.tone), minHeight: compact ? 0.38 : 0.48, autoFit: "shrink" });
    if (item.body) children.push({ id: `${slideId}.${name}.${index + 1}.body`, type: "text", text: item.body, style: compact ? "caption" : "paragraph", color: "text.primary", minHeight: estimateInsightDetailMinHeight(item.body, compact), autoFit: "shrink", optional: true });
    if (item.points.length) children.push({ ...bulletList(slideId, `${name}.${index + 1}.points`, item.points.slice(0, compact ? 4 : 6), "compact"), optional: true });
    return {
      id: `${slideId}.${name}.${index + 1}`,
      type: "stack",
      direction: "vertical",
      gap: compact ? 0.08 : 0.12,
      padding: variant === "subtle" ? (compact ? 0.24 : 0.32) : 0,
      ...(variant === "subtle" ? { fill: "surface.subtle", line: "divider", cornerRadius: 0.08 } : {}),
      children,
    } as DomNode;
  });
  const children: DomNode[] = [];
  const title = stringValue(node.title, "");
  const basis = stringValue(node.basis, "");
  if (title) children.push({ id: `${slideId}.${name}.title`, type: "text", text: title, style: "card-title", color: "text.primary", minHeight: 0.5, autoFit: "shrink" });
  if (basis) {
    const basisIsMainStatement = !title;
    children.push({
      id: `${slideId}.${name}.basis`,
      type: "text",
      text: basis,
      style: basisIsMainStatement ? "card-title" : "caption",
      color: basisIsMainStatement ? "text.primary" : "text.muted",
      minHeight: basisIsMainStatement ? 0.5 : 0.36,
      autoFit: "shrink",
      optional: true,
    });
  }
  children.push({
    id: `${slideId}.${name}.grid`,
    type: "grid",
    columns,
    gap: compact ? 0.22 : 0.34,
    children: cells.length ? cells : [{ id: `${slideId}.${name}.empty`, type: "text", text: "", style: "paragraph" }],
  });
  return {
    id: `${slideId}.${name}`,
    type: "stack",
    direction: "vertical",
    gap: compact ? 0.12 : 0.2,
    role: "comparison-list",
    children,
  };
}

function factListNode(slideId: string, name: string, node: DomNode): DomNode {
  const requestedVariant = node.variant === "grid" || node.variant === "strip" ? node.variant : "list";
  const defaultTone = componentTone(node.tone) || "brand";
  const items = recordItems(node.items).map((rec) => ({
    label: stringValue(rec.label, stringValue(rec.title, stringValue(rec.name, ""))),
    value: stringValue(rec.value, ""),
    fact: stringValue(rec.fact, stringValue(rec.text, stringValue(rec.body, ""))),
    interpretation: stringValue(rec.interpretation, stringValue(rec.insight, "")),
    source: stringValue(rec.source, ""),
    tone: componentTone(rec.tone) || defaultTone,
  })).filter((item) => item.label || item.value || item.fact || item.interpretation);
  const compact = node.density === "compact" || items.length >= 5 || requestedVariant === "strip";
  // A single-column fact list with 5-8 rows routinely appears when agents
  // turn a timeline or evidence list into facts. Preserve the fact-list item
  // semantics and per-item tones, but flow dense lists into multiple columns
  // so a normal content slide can still render.
  const variant = requestedVariant === "list" && items.length >= 5 ? "grid" : requestedVariant;
  const cells = items.map((item, index) => factItemNode(slideId, `${name}.${index + 1}`, item, compact, variant !== "list", variant));
  const children: DomNode[] = [];
  const title = stringValue(node.title, "");
  if (title) children.push({ id: `${slideId}.${name}.title`, type: "text", text: title, style: "card-title", color: "text.primary", minHeight: 0.5, autoFit: "shrink" });
  if (variant === "list") {
    children.push({
      id: `${slideId}.${name}.items`,
      type: "stack",
      direction: "vertical",
      gap: compact ? 0.14 : 0.22,
      children: cells,
    });
  } else {
    const fallbackColumns = variant === "strip"
      ? Math.max(1, Math.min(4, items.length || 1))
      : items.length >= 5
        ? 2
        : Math.min(3, Math.max(1, items.length || 1));
    children.push({
      id: `${slideId}.${name}.items`,
      type: "grid",
      columns: Math.max(1, Math.min(4, Math.round(numberValue(node.columns, fallbackColumns) || fallbackColumns))),
      gap: compact ? 0.2 : 0.3,
      children: cells,
    });
  }
  return {
    id: `${slideId}.${name}`,
    type: "stack",
    direction: "vertical",
    gap: compact ? 0.12 : 0.22,
    role: "fact-list",
    children,
  };
}

function executiveSummaryNode(slideId: string, name: string, node: DomNode): DomNode {
  const tone = componentTone(node.tone) || "brand";
  const thesis = stringValue(node.thesis, stringValue(node.headline, stringValue(node.title, "")));
  const summary = stringValue(node.summary, stringValue(node.body, stringValue(node.detail, "")));
  const findings = recordItems(Array.isArray(node.findings) ? node.findings : node.items).map((rec) => ({
    headline: stringValue(rec.headline, stringValue(rec.title, stringValue(rec.name, ""))),
    detail: stringValue(rec.detail, stringValue(rec.body, stringValue(rec.description, ""))),
    tone: componentTone(rec.tone) || tone,
  })).filter((item) => item.headline || item.detail);
  // Default variant: prefer "board" when there are ≥4 findings AND each
  // finding carries structured detail (headline + detail). Collapsing a
  // 4-finding executive-summary into a flat bullet list (memo) lost the
  // per-finding tone color and headline emphasis the agent set. memo
  // stays the default for ≤3 findings or for "headline-only" findings
  // where bullets read tighter than card grids.
  const explicitVariant = node.variant === "board" || node.variant === "compact" || node.variant === "memo" ? node.variant : null;
  const structuredFindings = findings.filter((item) => item.headline && item.detail).length;
  const autoVariant = findings.length >= 4 && structuredFindings >= 3 ? "board" : "memo";
  const variant = explicitVariant ?? autoVariant;
  const compact = variant === "compact";
  const children: DomNode[] = [{
    id: `${slideId}.${name}.thesis`,
    type: "text",
    text: thesis,
    style: compact ? "card-title" : "lead",
    color: toneAccent(tone),
    minHeight: compact ? 0.6 : 0.85,
    autoFit: "shrink",
  }];
  if (summary) children.push({ id: `${slideId}.${name}.summary`, type: "text", text: summary, style: "paragraph", color: "text.primary", minHeight: estimateInsightDetailMinHeight(summary, compact), autoFit: "shrink", optional: true });
  if (findings.length) {
    if (variant !== "board") {
      const bulletDensity = compact || findings.length > 4 ? "compact" : "comfortable";
      children.push({
        ...bulletList(slideId, `${name}.findings`, findings.map((item) => [item.headline, item.detail].filter(Boolean).join(": ")).filter(Boolean), bulletDensity),
        optional: true,
      });
    } else {
      const findingNodes = findings.map((item, index) => {
      const localChildren: DomNode[] = [];
      if (item.headline) localChildren.push({ id: `${slideId}.${name}.finding${index + 1}.headline`, type: "text", text: item.headline, style: "card-title", color: toneAccent(item.tone), minHeight: compact ? 0.34 : 0.42, autoFit: "shrink" });
      if (item.detail) localChildren.push({ id: `${slideId}.${name}.finding${index + 1}.detail`, type: "text", text: item.detail, style: "caption", color: "text.primary", minHeight: estimateInsightDetailMinHeight(item.detail, true), autoFit: "shrink", optional: true });
      return { id: `${slideId}.${name}.finding${index + 1}`, type: "stack", direction: "vertical", gap: 0.08, children: localChildren } as DomNode;
      });
      children.push({
        id: `${slideId}.${name}.findings`,
        type: "grid",
        columns: Math.min(3, Math.max(1, findingNodes.length)),
        gap: 0.28,
        children: findingNodes,
      });
    }
  }
  const implication = stringValue(node.implication, "");
  const action = stringValue(node.action, "");
  if (implication || action) {
    const implicationOnly = Boolean(implication && !action);
    children.push({
      id: `${slideId}.${name}.next`,
      type: "stack",
      direction: "vertical",
      gap: 0.08,
      fill: "surface.subtle",
      line: "divider",
      padding: compact ? 0.28 : 0.38,
      cornerRadius: 0.08,
      optional: true,
      children: [
        ...(implication ? [{
          id: `${slideId}.${name}.implication`,
          type: "text" as const,
          text: implication,
          style: implicationOnly ? "card-title" : "paragraph",
          color: implicationOnly ? toneAccent(tone) : "text.primary",
          minHeight: implicationOnly ? 0.5 : 0.42,
          autoFit: "shrink" as const,
        }] : []),
        ...(action ? [{ id: `${slideId}.${name}.action`, type: "text" as const, text: action, style: "card-title", color: toneAccent(tone), minHeight: 0.42, autoFit: "shrink" as const }] : []),
      ],
    });
  }
  return {
    id: `${slideId}.${name}`,
    type: "stack",
    direction: "vertical",
    gap: compact ? 0.16 : 0.24,
    role: "executive-summary",
    fill: variant === "memo" ? "surface.subtle" : undefined,
    line: variant === "memo" ? "divider" : undefined,
    padding: variant === "memo" ? (compact ? 0.42 : 0.58) : 0,
    cornerRadius: variant === "memo" ? 0.1 : undefined,
    children,
  };
}

function factItemNode(
  slideId: string,
  name: string,
  item: { label: string; value: string; fact: string; interpretation: string; source: string; tone: ComponentTone },
  compact: boolean,
  framed: boolean,
  variant: "list" | "grid" | "strip",
): DomNode {
  const children: DomNode[] = [];
  const strip = variant === "strip";
  if (item.label) children.push({ id: `${slideId}.${name}.label`, type: "text", text: item.label, style: "label", color: toneAccent(item.tone), minHeight: compact ? 0.28 : 0.34, autoFit: "shrink" });
  if (item.value) children.push({
    id: `${slideId}.${name}.value`,
    type: "text",
    text: item.value,
    style: compact ? "label" : "card-title",
    color: "text.primary",
    minHeight: estimateFactValueMinHeight(item.value, compact),
    autoFit: "shrink",
  });
  if (item.fact) children.push({
    id: `${slideId}.${name}.fact`,
    type: "text",
    text: item.fact,
    style: compact && !strip ? "caption" : "paragraph",
    color: "text.primary",
    minHeight: strip ? estimateStripFactMinHeight(item.fact) : compact ? estimateCompactFactMinHeight(item.fact) : estimateInsightDetailMinHeight(item.fact, false),
    autoFit: "shrink",
    optional: !strip && compact,
  });
  if (item.interpretation) children.push({ id: `${slideId}.${name}.interpretation`, type: "text", text: item.interpretation, style: "caption", color: "text.primary", minHeight: compact ? 0.28 : 0.38, autoFit: "shrink", optional: true });
  if (item.source) children.push({ id: `${slideId}.${name}.source`, type: "text", text: item.source, style: "source-note", color: "text.muted", minHeight: compact ? 0.22 : 0.28, autoFit: "shrink", optional: true });
  if (compact) {
    return {
      id: `${slideId}.${name}`,
      type: "stack",
      direction: "vertical",
      gap: 0.08,
      padding: framed ? 0.16 : 0,
      ...(framed ? { fill: "surface.subtle", line: "divider", cornerRadius: 0.06 } : {}),
      children: [
        { id: `${slideId}.${name}.accent`, type: "shape", preset: "rect", fill: toneAccent(item.tone), line: toneAccent(item.tone), fixedHeight: 0.06, optional: true },
        ...children,
      ],
    };
  }
  return {
    id: `${slideId}.${name}`,
    type: "stack",
    direction: "horizontal",
    gap: compact ? 0.16 : 0.22,
    padding: framed ? (compact ? 0.14 : 0.3) : 0,
    ...(framed ? { fill: "surface.subtle", line: "divider", cornerRadius: 0.08 } : {}),
    children: [
      { id: `${slideId}.${name}.accent`, type: "shape", preset: "rect", fill: toneAccent(item.tone), line: toneAccent(item.tone), fixedWidth: 0.08 },
      { id: `${slideId}.${name}.stack`, type: "stack", direction: "vertical", gap: compact ? 0.04 : 0.1, layoutWeight: 1, children },
    ],
  };
}

function estimateFactValueMinHeight(text: string, compact: boolean): number {
  const explicitLines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean).length;
  const weighted = weightedTextLengthForComponent(text);
  const estimatedLines = Math.max(explicitLines || 1, Math.ceil(weighted / (compact ? 28 : 34)));
  const lineHeight = compact ? 0.3 : 0.4;
  return Math.max(compact ? 0.3 : 0.44, Math.min(compact ? 0.82 : 1.1, estimatedLines * lineHeight + 0.08));
}

function estimateCompactFactMinHeight(text: string): number {
  const explicitLines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean).length;
  const weighted = weightedTextLengthForComponent(text);
  const estimatedLines = Math.max(explicitLines || 1, Math.ceil(weighted / 48));
  return Math.max(0.3, Math.min(0.72, estimatedLines * 0.28 + 0.06));
}

function estimateStripFactMinHeight(text: string): number {
  const explicitLines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean).length;
  const weighted = weightedTextLengthForComponent(text);
  const estimatedLines = Math.max(explicitLines || 1, Math.ceil(weighted / 32));
  return Math.max(0.7, Math.min(1.8, estimatedLines * 0.48 + 0.16));
}

function estimateInsightDetailMinHeight(text: string, compact: boolean): number {
  const explicitLines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean).length;
  const weighted = weightedTextLengthForComponent(text);
  const estimatedLines = Math.max(explicitLines || 1, Math.ceil(weighted / (compact ? 34 : 42)));
  const lineHeight = compact ? 0.48 : 0.58;
  return Math.max(compact ? 0.56 : 0.72, Math.min(2.4, estimatedLines * lineHeight + 0.12));
}

function estimateCalloutBodyMinHeight(text: string, banner: boolean): number {
  const explicitLines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean).length;
  const weighted = weightedTextLengthForComponent(text);
  const estimatedLines = Math.max(explicitLines || 1, Math.ceil(weighted / (banner ? 42 : 48)));
  if (estimatedLines <= 1) return banner ? 0.74 : 0.55;
  const lineHeight = banner ? 0.54 : 0.48;
  return Math.max(banner ? 0.82 : 0.68, Math.min(banner ? 2.4 : 2.0, estimatedLines * lineHeight + 0.16));
}

function weightedTextLengthForComponent(text: string): number {
  let length = 0;
  for (const char of text) {
    if (char === "\n") continue;
    length += /[\u4e00-\u9fff]/.test(char) ? 1.05 : isWideVisualSymbol(char) ? 0.9 : 0.58;
  }
  return length;
}

function isWideVisualSymbol(char: string): boolean {
  return /[\u2605\u2606\u2713\u2714\u2717\u2715\u2716\u26a0\u25cf\u25cb\u25c6\u25c7\u25a0\u25a1\u25b2\u25b3\u25b6\u25b7\u25bc\u25bd]/.test(char);
}

function normalizeTimelineContent(slideId: string, name: string, index: number, content: DomNode): DomNode {
  const id = typeof content.id === "string" && content.id ? content.id : `${slideId}.${name}.${index + 1}.content`;
  const next: DomNode = { ...content, id };
  if (next.type === "metric-card") {
    if (next.variant === undefined) next.variant = "compact";
    if (next.density === undefined) next.density = "compact";
    if (next.size === undefined) next.size = "xs";
  } else if (next.type === "insight-card" || next.type === "key-takeaway") {
    if (next.density === undefined) next.density = "compact";
    if (next.type === "key-takeaway" && next.variant === undefined) next.variant = "minimal";
  }
  return next;
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
  if (type === "split") {
    return {
      id: "example.split",
      type: "split",
      direction: "horizontal",
      ratio: [0.62, 0.38],
      gap: 0.5,
      children: [
        { id: "example.split.primary", type: "key-takeaway", headline: "Primary claim", detail: "The main region carries the slide's focus." },
        { id: "example.split.rail", type: "side-rail", title: "Reader lens", body: "Use the smaller region for context, proof, or interpretation." },
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
  if (type === "card") return { id: "example.card", type: "card", title: "Engagement", accent: "left", children: [{ id: "example.card.body", type: "text", text: "78% retention week one." }] };
  if (type === "band") return { id: "example.band", type: "band", tone: "brand", height: 1.6, children: [{ id: "example.band.text", type: "text", text: "Section: outlook", style: "section-title", color: "brand.primary" }] };
  if (type === "frame") return { id: "example.frame", type: "frame", dash: "dash", children: [{ id: "example.frame.body", type: "text", text: "TBD region" }] };
  if (type === "inset") return { id: "example.inset", type: "inset", padding: 0.5, children: [{ id: "example.inset.body", type: "text", text: "Indented child." }] };
  return { id: "example.shape", type: "shape", preset: "rect", fill: "surface" };
}

function primitiveLayoutBehavior(type: PrimitiveComponentType): ComponentDescription["layoutBehavior"] {
  if (type === "stack" || type === "grid" || type === "split") return { intrinsicSize: "collection", canGrow: true };
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
    examples: [componentExample(name, fields)],
  };
}

function componentExample(name: ComponentName, fields: Record<string, PropDefinition>): Record<string, unknown> {
  const example: Record<string, unknown> = { type: name };
  for (const [key, prop] of Object.entries(fields)) {
    if (prop.required || minimumExampleField(name, key)) {
      example[key] = exampleValueForField(name, key, prop);
    }
  }
  return example;
}

function minimumExampleField(name: ComponentName, key: string): boolean {
  if (name === "article" && key === "text") return true;
  if (name === "callout" && key === "text") return true;
  if (name === "matrix-2x2" && key === "items") return true;
  return false;
}

function exampleValueForField(name: ComponentName, key: string, prop: PropDefinition): unknown {
  if (prop.type === "image-ref") return EXAMPLE_IMAGE_DATA_URL;
  if (prop.type === "color-ref") return "brand.primary";
  if (prop.type === "boolean") return false;
  if (prop.type === "number") {
    if (key === "current" || key === "min") return 0;
    if (key === "max") return 100;
    if (key === "columns" || key === "rows" || key === "ticks") return 3;
    if (key === "value") return 60;
    return 1;
  }
  if (prop.type === "enum") {
    const values = prop.enum || prop.values || [];
    return values.find((value) => value !== "inverse") || values[0] || "brand";
  }
  if (prop.type === "array") return exampleArrayValue(name, key);
  if (prop.type === "object" || prop.type === "table" || prop.type === "chart") return exampleObjectValue(name, key);
  if (key === "value" || key === "beforeValue" || key === "afterValue" || key === "price") return "60%";
  if (key === "latex") return "\\frac{x_1}{\\sigma^2}=\\mu";
  if (key === "code") return "const value = 1;";
  if (key === "current") return "01";
  if (key === "max") return "100";
  if (key === "label" || key === "name" || key === "term") return "Label";
  if (key === "title" || key === "headline" || key === "question") return "Core finding";
  if (key === "definition" || key === "body" || key === "detail" || key === "insight" || key === "summary") return "A concise explanation of the evidence.";
  if (key === "beforeLabel") return "Before";
  if (key === "afterLabel") return "After";
  if (key === "plan") return "Pro";
  if (key === "text") return "Key message";
  return "Example";
}

function exampleArrayValue(name: ComponentName, key: string): unknown[] {
  if (key === "labels" || key === "sections" || key === "features" || key === "xLabels" || key === "yLabels") return ["A", "B", "C"];
  if (key === "series") return [{ name: "Series", values: [10, 20, 30] }];
  if (key === "rows" && name === "factorial-matrix") return ["Row A", "Row B"];
  if (key === "columns" && name === "factorial-matrix") return ["Col A", "Col B"];
  if (key === "cells" && name === "factorial-matrix") return [["A1", "A2"], ["B1", "B2"]];
  if (key === "rows") return [["A", "10"], ["B", "20"]];
  if (key === "values" && name === "heatmap") return [[1, 2, 3], [2, 3, 4]];
  if (key === "values") return [10, 20, 30];
  if (key === "metrics") return [{ value: "42%", label: "Adoption" }, { value: "18%", label: "Growth" }];
  if (key === "logos") return [{ src: EXAMPLE_IMAGE_DATA_URL, alt: "Logo" }];
  if (key === "callouts") return [{ title: "Observation", body: "Important region." }, { title: "Change", body: "Notable difference." }];
  if (key === "stages") return [{ label: "Lead", value: 100 }, { label: "Qualified", value: 64 }, { label: "Closed", value: 28 }];
  if (key === "options") return [{ name: "Option A", values: ["Yes", "No", "Yes"] }];
  if (key === "steps") {
    if (name === "stat-flow") return [{ value: "$12", label: "CAC" }, { connector: "x" }, { value: "4.2", label: "LTV" }];
    return [{ title: "Step 1", body: "Define the input." }, { title: "Step 2", body: "Run the process." }];
  }
  if (key === "items") {
    if (name === "timeline") return [{ time: "2026", title: "Launch", body: "First milestone." }];
    if (name === "numbered-list") return ["First point", "Second point"];
    if (name === "bar-list") return [{ label: "A", value: 42 }, { label: "B", value: 28 }];
    if (name === "legend") return [{ label: "Segment A", color: "brand.primary" }];
    if (name === "range-plot") return [{ label: "Market", min: 10, max: 60, point: 42 }];
    if (name === "matrix-2x2") return [{ label: "Quick win", x: "high", y: "high", tone: "positive" }];
    if (name === "failure-taxonomy") return [{ title: "Missing data", rate: "18%", examples: ["No source", "No date"] }];
    if (name === "scorecard") return [{ label: "Accuracy", value: "92%", status: "good" }];
    return [{ title: "Item 1", body: "Short supporting detail." }, { title: "Item 2", body: "Second detail." }];
  }
  if (key === "pros") return ["Fast setup", "Lower cost"];
  if (key === "cons") return ["Less flexible", "Needs review"];
  if (key === "strengths" || key === "weaknesses" || key === "opportunities" || key === "threats") return ["Point 1", "Point 2"];
  return ["Item 1", "Item 2"];
}

function exampleObjectValue(name: ComponentName, key: string): unknown {
  if (key === "left") return { id: "example.left", type: "text", text: "Left argument" };
  if (key === "right") return { id: "example.right", type: "text", text: "Right argument" };
  if (key === "evidence") return { id: "example.evidence", type: "chart-card", chartType: "bar", labels: ["A", "B"], series: [{ name: "Series", values: [10, 20] }] };
  if (key === "insight") return { id: "example.insight", type: "key-takeaway", headline: "Interpret the evidence" };
  if (key === "hero") return { id: "example.hero", type: "key-takeaway", headline: "Dominant conclusion" };
  if (key === "rail") return { id: "example.rail", type: "side-rail", title: "Lens", body: "How to read this evidence." };
  if (key === "primary") return { label: "Primary", value: 62 };
  if (key === "xAxis" || key === "yAxis") return { low: "Low", high: "High" };
  if (key === "data" && name === "chart-card") return { labels: ["A", "B"], series: [{ name: "Series", values: [10, 20] }] };
  if (key === "data" && name === "table-card") return { headers: ["Name", "Value"], rows: [["A", "10"], ["B", "20"]] };
  if (key === "visual") return { src: EXAMPLE_IMAGE_DATA_URL, fit: "cover" };
  if (key === "heroStat") return { value: "42%", label: "Adoption" };
  return {};
}

function containerComponent(name: ComponentName, purpose: string, fields: Record<string, PropDefinition>, expandsTo: string, preferredParent: "stack" | "grid", childrenRequired = false): ComponentDefinition {
  return {
    name,
    category: "chrome",
    purpose,
    fields,
    children: { allowed: true, required: childrenRequired },
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
  const wrapMinHeight = style === "deck-title" || style === "slide-title" || style === "section-title";
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
      ...(wrapMinHeight ? { wrapMinHeight: true } : {}),
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

function equationNode(slideId: string, name: string, node: DomNode): DomNode {
  const latex = stringValue(node.latex, stringValue(node.text, ""));
  const align = node.align === "left" || node.align === "right" || node.align === "center" ? node.align : "center";
  const label = stringValue(node.label, "");
  const number = stringValue(node.number, "");
  const caption = stringValue(node.caption, "");
  const style = typeof node.style === "string" && node.style.trim() ? node.style : "body";
  const equationText: DomNode = {
    id: `${slideId}.${name}.math`,
    type: "text",
    style,
    align,
    content: [{ kind: "math", latex }],
    autoFit: "shrink",
    noWrap: true,
    wrapMinHeight: true,
  };
  const main: DomNode = number ? {
    id: `${slideId}.${name}.line`,
    type: "split",
    direction: "horizontal",
    ratio: [0.86, 0.14],
    gap: 0.2,
    children: [
      equationText,
      {
        id: `${slideId}.${name}.number`,
        type: "text",
        text: `(${number.replace(/^\(|\)$/g, "")})`,
        style: "label",
        color: "text.muted",
        align: "right",
        valign: "middle",
        minHeight: 0.48,
        noWrap: true,
        autoFit: "shrink",
      },
    ],
  } : equationText;
  const children: DomNode[] = [
    ...(label ? [{
      id: `${slideId}.${name}.label`,
        type: "text" as const,
        text: label,
        style: "label",
        color: "text.muted",
        // Keep above the renderer's text squash threshold under theme
        // overrides. A 0.36cm label technically fits small default labels, but
        // custom business/science themes commonly raise label typography and
        // then the equation component trips blocking SQUASHED diagnostics.
        fixedHeight: 0.52,
        autoFit: "shrink" as const,
      }] : []),
    main,
    ...(caption ? [{
      id: `${slideId}.${name}.caption`,
      type: "text" as const,
      text: caption,
      style: "figure-caption",
      align,
      fixedHeight: 0.58,
      autoFit: "shrink" as const,
    }] : []),
  ];
  return {
    id: `${slideId}.${name}`,
    type: "stack",
    direction: "vertical",
    gap: caption ? 0.16 : 0.08,
    role: "equation",
    mathFallback: "office-math",
    renderMode: "omml",
    mathText: latexToMathText(latex),
    children,
  };
}

function bibliographyNode(slideId: string, name: string, node: DomNode): DomNode {
  const title = stringValue(node.title, "References");
  const items = bibliographyItemRows(node.items);
  return {
    id: `${slideId}.${name}`,
    type: "stack",
    direction: "vertical",
    gap: 0.18,
    role: "bibliography",
    children: [
      ...(title ? [{
        id: `${slideId}.${name}.title`,
        type: "text" as const,
        text: title,
        style: "card-title",
        fixedHeight: 0.52,
      }] : []),
      items.length ? {
        id: `${slideId}.${name}.items`,
        type: "text" as const,
        style: "footnote",
        paragraphs: items.map((item) => ({
          runs: [
            { text: item.label ? `${item.label} ` : "", marks: ["bold"], color: "brand.primary" },
            { text: item.text },
          ],
          style: "footnote",
          spaceAfter: 3,
        })),
      } : {
        id: `${slideId}.${name}.empty`,
        type: "text" as const,
        text: "No cited references.",
        style: "source-note",
        color: "text.muted",
      },
    ],
  };
}

function codeBlockNode(slideId: string, name: string, node: DomNode): DomNode {
  const language = stringValue(node.language, "text").trim().toLowerCase() || "text";
  const code = stringValue(node.code, stringValue(node.text, ""));
  const showLineNumbers = node.showLineNumbers !== false;
  const density = codeBlockDensity(node.density, code);
  const fontSize = numberValue(node.fontSize, undefined);
  const requestedColumns = numberValue(node.columns, undefined);
  const columns = requestedColumns === undefined ? 1 : Math.max(1, Math.min(3, Math.floor(requestedColumns)));
  const originalLineCount = code.replace(/\r\n/g, "\n").split("\n").length;
  const maxLines = typeof node.maxLines === "number" && Number.isFinite(node.maxLines) && node.maxLines > 0
    ? Math.floor(node.maxLines)
    : Number.POSITIVE_INFINITY;
  const highlightSet = codeHighlightLines(node.highlightLines);
  let lines = code.replace(/\r\n/g, "\n").split("\n");
  const truncated = lines.length > maxLines;
  if (truncated) lines = lines.slice(0, maxLines);
  const rowGroups = splitCodeLinesIntoColumns(lines, columns);
  const tables = rowGroups.map((group, groupIndex) => {
    const startLine = groupIndex * Math.ceil(lines.length / columns) + 1;
    const rows = group.map((line, index) => codeBlockRow(line, startLine + index, language, showLineNumbers, highlightSet.has(startLine + index), fontSize));
    if (truncated && groupIndex === rowGroups.length - 1) {
      rows.push(showLineNumbers
        ? [{ text: "", fill: "surface.subtle" }, { text: "...", color: "text.muted", fill: "surface.subtle", runs: codeLineRuns("...", language, fontSize) }]
        : [{ text: "...", color: "text.muted", fill: "surface.subtle", runs: codeLineRuns("...", language, fontSize) }]);
    }
    return {
      id: `${slideId}.${name}.table${columns > 1 ? groupIndex + 1 : ""}`,
      type: "table" as const,
      role: "code-block-table",
      rows,
      colWidths: showLineNumbers ? [0.08, 0.92] : [1],
      density,
      codeTotalLines: originalLineCount,
      codeRenderedLines: lines.length,
      codeColumns: columns,
      codeColumnIndex: groupIndex + 1,
      codeDensity: density,
      codeFontSize: fontSize,
      codeTruncated: truncated,
      borderColor: "divider",
      bodyFill: "surface.subtle",
    };
  });
  const title = stringValue(node.title, "");
  const caption = stringValue(node.caption, "");
  const codeBody: DomNode = columns > 1
    ? {
        id: `${slideId}.${name}.columns`,
        type: "grid",
        columns,
        gap: 0.18,
        children: tables,
      }
    : tables[0]!;
  return {
    id: `${slideId}.${name}`,
    type: "stack",
    direction: "vertical",
    gap: density === "code-tiny" ? 0.08 : 0.12,
    role: "code-block",
    children: [
      ...(title || language !== "text" ? [{
        id: `${slideId}.${name}.title`,
        type: "text" as const,
        text: title || language,
        style: "label",
        color: "text.muted",
        fixedHeight: 0.36,
      }] : []),
      codeBody,
      ...(caption ? [{
        id: `${slideId}.${name}.caption`,
        type: "text" as const,
        text: caption,
        style: "code-caption",
        fixedHeight: 0.42,
      }] : []),
    ],
  };
}

function codeBlockDensity(raw: unknown, code: string): "code" | "code-dense" | "code-tiny" {
  if (raw === "tiny") return "code-tiny";
  if (raw === "dense") return "code-dense";
  if (raw === "compact") return "code";
  const lineCount = code.replace(/\r\n/g, "\n").split("\n").length;
  if (lineCount >= 34) return "code-tiny";
  if (lineCount >= 22) return "code-dense";
  return "code";
}

function splitCodeLinesIntoColumns(lines: string[], columns: number): string[][] {
  if (columns <= 1 || lines.length === 0) return [lines];
  const perColumn = Math.ceil(lines.length / columns);
  const groups: string[][] = [];
  for (let index = 0; index < columns; index++) {
    const group = lines.slice(index * perColumn, (index + 1) * perColumn);
    if (group.length > 0) groups.push(group);
  }
  return groups.length ? groups : [[]];
}

function bibliographyItemRows(raw: unknown): Array<{ label: string; text: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const rec = item as Record<string, unknown>;
      const label = stringValue(rec.label, "");
      const text = stringValue(rec.text, stringValue(rec.citation, stringValue(rec.title, "")));
      return { label, text };
    }
    return { label: `[${index + 1}]`, text: String(item ?? "") };
  }).filter((item) => item.label || item.text);
}

function codeBlockRow(line: string, lineNumber: number, language: string, showLineNumbers: boolean, highlighted: boolean, fontSize?: number): unknown[] {
  const diffKind = line.startsWith("+") && !line.startsWith("+++") ? "added" : line.startsWith("-") && !line.startsWith("---") ? "removed" : "";
  const fill = diffKind === "added" ? "success.tint" : diffKind === "removed" ? "danger.tint" : highlighted ? "warning.tint" : "surface.subtle";
  const codeCell = {
    runs: codeLineRuns(line, language, fontSize),
    fill,
    valign: "top",
  };
  if (!showLineNumbers) return [codeCell];
  return [
    {
      runs: [{ text: String(lineNumber), font: "mono", color: "text.muted", ...(fontSize !== undefined ? { fontSize } : {}) }],
      color: "text.muted",
      fill,
      align: "right",
      valign: "top",
    },
    codeCell,
  ];
}

function codeLineRuns(line: string, language: string, fontSize?: number): Array<Record<string, unknown>> {
  if (!line) return [codeRun(" ", "text.primary", fontSize)];
  const commentStart = commentIndex(line, language);
  if (commentStart >= 0) {
    return [
      ...codeTokens(line.slice(0, commentStart), language, fontSize),
      codeRun(line.slice(commentStart), "text.muted", fontSize, { italic: true }),
    ];
  }
  return codeTokens(line, language, fontSize);
}

function codeTokens(line: string, language: string, fontSize?: number): Array<Record<string, unknown>> {
  const keywordRe = keywordRegex(language);
  if (!keywordRe) return [codeRun(line, "text.primary", fontSize)];
  const runs: Array<Record<string, unknown>> = [];
  const re = /("[^"]*"|'[^']*'|`[^`]*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b|\s+|.)/g;
  for (const match of line.matchAll(re)) {
    const token = match[0];
    if (!token) continue;
    if (/^["'`]/.test(token)) runs.push(codeRun(token, "success", fontSize));
    else if (/^\d/.test(token)) runs.push(codeRun(token, "brand.primary", fontSize));
    else if (keywordRe.test(token)) runs.push(codeRun(token, "brand.primary", fontSize, { marks: ["bold"] }));
    else runs.push(codeRun(token, "text.primary", fontSize));
    keywordRe.lastIndex = 0;
  }
  return runs.length ? runs : [codeRun(line, "text.primary", fontSize)];
}

function codeRun(text: string, color: string, fontSize?: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { text, font: "mono", color, ...(fontSize !== undefined ? { fontSize } : {}), ...extra };
}

function keywordRegex(language: string): RegExp | null {
  if (["ts", "tsx", "js", "jsx", "typescript", "javascript"].includes(language)) return /\b(?:const|let|var|function|return|if|else|for|while|class|interface|type|import|export|from|async|await|new|extends|implements)\b/g;
  if (["py", "python"].includes(language)) return /\b(?:def|return|if|elif|else|for|while|class|import|from|as|with|try|except|finally|lambda|yield|async|await|True|False|None)\b/g;
  if (["c", "cc", "cpp", "c++", "h", "hpp"].includes(language)) return /\b(?:auto|bool|break|case|char|class|const|continue|double|else|enum|false|float|for|if|include|int|long|namespace|return|short|sizeof|static|struct|switch|true|using|void|while)\b/g;
  if (["sql", "postgres", "mysql"].includes(language)) return /\b(?:select|from|where|join|left|right|inner|outer|group|by|order|having|limit|with|as|case|when|then|else|end|sum|avg|count|min|max|insert|update|delete)\b/gi;
  if (["sh", "bash", "shell", "zsh"].includes(language)) return /\b(?:if|then|else|fi|for|in|do|done|case|esac|function|export|echo|cd|pwd|grep|rg|awk|sed)\b/g;
  return null;
}

function commentIndex(line: string, language: string): number {
  if (["sql", "postgres", "mysql"].includes(language)) return line.indexOf("--");
  if (["py", "python", "sh", "bash", "shell", "zsh"].includes(language)) return line.indexOf("#");
  const slash = line.indexOf("//");
  return slash >= 0 ? slash : -1;
}

function codeHighlightLines(raw: unknown): Set<number> {
  const out = new Set<number>();
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (typeof item === "number" && Number.isFinite(item)) out.add(Math.floor(item));
    else if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      const start = typeof rec.start === "number" ? Math.floor(rec.start) : typeof rec.from === "number" ? Math.floor(rec.from) : 0;
      const end = typeof rec.end === "number" ? Math.floor(rec.end) : typeof rec.to === "number" ? Math.floor(rec.to) : start;
      for (let line = start; line <= end; line++) if (line > 0) out.add(line);
    }
  }
  return out;
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
  const thickness = normalizeAccentRuleThickness(node.thickness);
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

function normalizeAccentRuleThickness(raw: unknown): number {
  return normalizeStrokeCm(raw, 0.08, { minCm: 0.015, maxCm: 0.18 });
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
  if (items.length > 6) {
    const columns = 4;
    const rows: DomNode[] = [];
    for (let start = 0; start < items.length; start += columns) {
      const rowIndex = Math.floor(start / columns);
      const rowItems = items.slice(start, start + columns);
      rows.push({
        id: `${slideId}.${name}.row${rowIndex}`,
        type: "stack",
        direction: "vertical",
        gap: 0.16,
        role: "axis-ruler-row",
        children: [
          { id: `${slideId}.${name}.row${rowIndex}.line`, type: "divider", orientation: "horizontal", line: toneToColors(node.tone).line || "brand.primary", thickness: 0.04, fixedHeight: 0.10 },
          {
            id: `${slideId}.${name}.row${rowIndex}.items`,
            type: "grid",
            columns,
            gap: 0.32,
            children: rowItems.map((item, localIndex) => axisRulerItem(slideId, name, item, start + localIndex, "horizontal")),
          },
        ],
      });
    }
    return {
      id: `${slideId}.${name}`,
      type: "stack",
      direction: "vertical",
      gap: 0.28,
      role: "axis-ruler",
      children: rows,
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

type ComponentTone = "brand" | "positive" | "warning" | "danger" | "neutral";

function componentTone(value: unknown): ComponentTone | undefined {
  const normalized = normalizeToneAlias(value);
  return normalized === "brand" || normalized === "positive" || normalized === "warning" || normalized === "danger" || normalized === "neutral"
    ? normalized
    : undefined;
}

function decorationMarker(value: unknown): DecorationMarkerInput | undefined {
  if (typeof value === "string" && value.trim()) return value.trim() as DecorationMarkerInput;
  if (value && typeof value === "object" && !Array.isArray(value)) return value as DecorationMarkerInput;
  return undefined;
}

type ProcessFlowMarker = "auto" | "number" | "dot" | "icon" | "none";

function processFlowMarker(value: unknown): ProcessFlowMarker | undefined {
  return value === "auto" || value === "number" || value === "dot" || value === "icon" || value === "none"
    ? value
    : undefined;
}

function surfaceOptions(node: DomNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (node.surface && typeof node.surface === "object") out.surface = node.surface;
  for (const key of ["fill", "border", "borderColor", "borderWidth", "borderStyle", "cornerRadius", "padding", "elevation", "accent", "accentColor", "accentWidth"]) {
    if (node[key] !== undefined) out[key] = node[key];
  }
  return out;
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

export function normalizeComponentEnumValue(componentName: string, propName: string, value: unknown): string | undefined {
  if (propName === "tone" || propName === "status") return normalizeToneAlias(value);
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (!v) return undefined;
  if (componentName === "callout" && propName === "variant") {
    if (v === "panel" || v === "surface") return "card";
  }
  return v;
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

function barListValue(...values: unknown[]): number {
  for (const value of values) {
    const numeric = numberValue(value, undefined);
    if (typeof numeric === "number") return numeric;
    const rating = starRatingValue(value);
    if (typeof rating === "number") return rating;
  }
  return 0;
}

function barListValueLabel(explicit: unknown, raw: unknown, numericValue: number): string {
  const authored = stringValue(explicit, "");
  if (authored) return authored;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (typeof raw === "number" && Number.isFinite(raw)) return `${raw}`;
  return `${numericValue}`;
}

function starRatingValue(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const filled = Array.from(value).filter((ch) => ch === "★" || ch === "⭐").length;
  return filled > 0 ? filled : undefined;
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

/**
 * Best-effort split of an inline-list-shaped string into bullet items. Used
 * when an agent piles "1. … 2. … 3. …" or "•/\n" runs into a single `detail`
 * field on key-takeaway / callout: the renderer would otherwise render that
 * as a single wrapped paragraph and the per-item structure is lost. Returns
 * null when the string is plainly a sentence (so the caller keeps the prose
 * shape).
 */
function splitInlineList(detail: string): string[] | null {
  if (!detail || typeof detail !== "string") return null;
  const trimmed = detail.trim();
  if (!trimmed) return null;
  // Multi-line bullet markers (•/·/★/numbered) — split on hard line breaks.
  if (/\r?\n/.test(trimmed)) {
    const lines = trimmed.split(/\r?\n+/).map((line) => line.trim()).filter(Boolean);
    const bulletLines = lines.filter((line) => /^[•·★▶▪◆\-–]\s+\S/.test(line) || /^(?:\d+[.、)）]|[一二三四五六七八九十][、.])\s*\S/.test(line));
    if (bulletLines.length >= 2 && bulletLines.length === lines.length) {
      return lines.map((line) => line.replace(/^[•·★▶▪◆\-–]\s*/, "").replace(/^\d+[.、)）]\s*/, "").replace(/^[一二三四五六七八九十][、.]\s*/, "").trim()).filter(Boolean);
    }
  }
  // Inline numeric list "1. A 2. B 3. C" without explicit newlines. Accept
  // bare "<digits>." even without preceding whitespace — agents often write
  // "...路径）2. 跨平台..." where the previous segment ends in punctuation
  // and runs straight into the next number. Require whitespace AFTER the
  // dot/paren so decimals like "10.5" do not parse as a list prefix. Use
  // a lookahead-driven split so repeated digits don't confuse indexOf.
  const numericPrefix = /(?:^|(?<=[\s）)\]、，,。.]))\d+[.、)）]\s+/;
  const inlineMatches = trimmed.match(new RegExp(numericPrefix.source, "g"));
  if (inlineMatches && inlineMatches.length >= 3) {
    const segments = trimmed.split(new RegExp(`(?=${numericPrefix.source})`));
    const stripped = segments.map((seg) => seg.replace(numericPrefix, "").trim()).filter(Boolean);
    if (stripped.length >= 2) return stripped;
  }
  // Chinese semicolon-separated runs (≥3 segments).
  const semiParts = trimmed.split(/[；;]\s*/).map((part) => part.trim()).filter((part) => part.length > 1);
  if (semiParts.length >= 3) return semiParts;
  return null;
}

function numberedListItems(value: unknown): Array<string | { title?: string; headline?: string; label?: string; name?: string; text?: string; body?: string; detail?: string; description?: string }> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const rec = item as Record<string, unknown>;
      return {
        title: stringValue(rec.title, ""),
        headline: stringValue(rec.headline, ""),
        label: stringValue(rec.label, ""),
        name: stringValue(rec.name, ""),
        text: stringValue(rec.text, ""),
        body: stringValue(rec.body, ""),
        detail: stringValue(rec.detail, ""),
        description: stringValue(rec.description, ""),
      };
    }
    return String(item ?? "");
  });
}

function recordItems(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.map((item) => item && typeof item === "object" ? item as Record<string, unknown> : { title: String(item ?? "") })
    : [];
}

function richTextRuns(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) return undefined;
  const runs = value.filter((run): run is Record<string, unknown> => {
    if (!run || typeof run !== "object" || Array.isArray(run)) return false;
    const rec = run as Record<string, unknown>;
    if (typeof rec.text === "string") return true;
    return rec.kind === "math" || rec.kind === "cite" || rec.kind === "footnoteRef" || rec.kind === "icon" || rec.kind === "token";
  });
  return runs.length ? runs : undefined;
}

function richTextPlain(runs: Array<Record<string, unknown>> | undefined): string {
  return runs ? richRunsPlainText(runs) : "";
}
