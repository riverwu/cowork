import { buildTheme, listPaletteColors, listSemanticTones, listThemes } from "./theme.js";

export interface DeckFieldDescription {
  type: "string" | "number" | "boolean" | "enum" | "object";
  required?: boolean;
  enum?: string[];
  description: string;
  default?: unknown;
}

export interface DeckDescription {
  size: { value: "16x9"; slideWidthCm: number; slideHeightCm: number };
  contentArea: {
    marginX: number;
    titleTop: number;
    titleHeight: number;
    contentTop: number;
    contentBottom: number;
    contentHeight: number;
    description: string;
  };
  themes: { available: string[]; default: string; description: string };
  brand: { description: string; fields: Record<string, DeckFieldDescription>; example: unknown };
  chrome: { description: string; fields: Record<string, DeckFieldDescription>; example: unknown };
  colorTokens: { description: string; tokens: string[]; tones: { description: string; names: string[] }; palette: { description: string; names: string[] } };
  textStyles: { description: string; styles: string[] };
  themeGuidance: {
    description: string;
    fields: Record<string, DeckFieldDescription>;
    current: ReturnType<typeof buildTheme>["guidance"];
  };
  styleDecisionProtocol: string[];
  subjectStylePlaybook: Array<{
    subjectSignals: string[];
    scenario: string;
    palette: Record<string, string>;
    typography: string[];
    layout: string[];
    componentBias: string[];
    avoid: string[];
  }>;
  slideRoot: { description: string; fields: Record<string, DeckFieldDescription> };
  layoutPrinciples: string[];
  consistencyPrinciples: string[];
  textHygiene: string[];
  componentChoiceGuidelines: string[];
  doNot: string[];
  fallbackLadder: { stages: string[]; diagnostics: string[] };
  containerUsageRules: string[];
  colorUsageRules: string[];
  colorPaletteUsage: string[];
  shapeDecorationRules: string[];
  emphasisHierarchy: string[];
  densityRules: string[];
}

export function describeDeck(): DeckDescription {
  const sample = buildTheme();
  const layout = sample.layout;
  const contentHeight = layout.contentBottom - layout.contentTop;
  const colorTokens = Object.keys(sample.colors).sort();
  const textStyles = Object.keys(sample.text).sort();
  return {
    size: { value: "16x9", slideWidthCm: layout.slideWidthCm, slideHeightCm: layout.slideHeightCm },
    contentArea: {
      marginX: layout.pageMarginX,
      titleTop: layout.titleTop,
      titleHeight: layout.titleHeight,
      contentTop: layout.contentTop,
      contentBottom: layout.contentBottom,
      contentHeight,
      description: `Title sits at y=${layout.titleTop}cm with height ${layout.titleHeight}cm. contentTop and contentBottom are y-coordinates for the content rect. The content rect (area:'content') spans x=${layout.pageMarginX}..${(layout.slideWidthCm - layout.pageMarginX).toFixed(2)}, y=${layout.contentTop}..${layout.contentBottom.toFixed(2)} (height ${contentHeight.toFixed(2)}cm). All cm.`,
    },
    themes: {
      available: listThemes(),
      default: "default",
      description: "Only the 'default' scaffold ships built-in. Concrete styling is the agent's responsibility — call set_theme with a themeOverride that fits the subject (consulting / pitch / academic / engineering). The default theme is intentionally neutral.",
    },
    brand: {
      description: "Brand identity injected into every slide. Drives brand.primary token, derived brand.tint and brand.shade, optional logo placement via chrome.brandMark.",
      fields: {
        name: { type: "string", description: "Brand or product name (used by metadata, not rendered as text)." },
        primary: { type: "string", description: "6-char hex (no '#'). Becomes brand.primary; derived tint + shade tokens are auto-mixed." },
        logo: { type: "string", description: "Absolute path, URL, or data URL to a logo image. Required for chrome.brandMark != 'none'." },
      },
      example: { name: "Youdao", primary: "E8382C", logo: "/abs/path/logo.png" },
    },
    chrome: {
      description: "Per-deck decorations stamped onto every slide by the renderer. Set once at deck level; do not duplicate inside slide DOMs.",
      fields: {
        brandMark: { type: "enum", enum: ["none", "top-right", "bottom-right"], description: "Logo placement. 'none' suppresses it.", default: "none" },
        pageNumber: { type: "boolean", description: "Render '1 / N' page counter in the footer.", default: false },
        footerText: { type: "string", description: "Optional footer text (left side)." },
      },
      example: { brandMark: "bottom-right", pageNumber: true, footerText: "Internal use" },
    },
    colorTokens: {
      description: "Use these tokens anywhere a color is expected (fill, line, color). Avoid raw hex except for one-off accents. Tokens auto-update when theme or brand.primary changes.",
      tokens: colorTokens,
      tones: {
        description: "Semantic component tones. Components should use `tone` with these names; the theme owns each tone's foreground/background/line colors. Tone color tokens also expose base/.tint/.accent where applicable.",
        names: listSemanticTones(),
      },
      palette: {
        description: "Semantic palette names. Each resolves to a theme-defined hex; agents express intent ('red', 'lime') and the theme picks the exact value. Palette colors also expose .tint and .shade variants.",
        names: listPaletteColors(),
      },
    },
    textStyles: {
      description: "Each text node has an inferred or explicit `style`. These names map to font sizes, weights, and colors managed by the theme. Component text styles (for example timeline-body) are centrally derived from base tokens such as caption/label — do NOT set fontSize on component text nodes.",
      styles: textStyles,
    },
    themeGuidance: {
      description: "Prompt-facing theme guidance. These fields do not render directly; they teach the agent which layouts, components, data treatments, and visual rules fit the deck scenario.",
      fields: {
        scenario: { type: "string", description: "Target context, e.g. board memo, academic lecture, product launch, sales proposal." },
        stylePrinciples: { type: "object", description: "String[] describing typography, density, color, and surface rules." },
        layoutPrinciples: { type: "object", description: "String[] describing preferred layout moves for this theme." },
        componentGuidance: { type: "object", description: "Map from component name to use/avoid/style guidance." },
        dataVizGuidance: { type: "object", description: "String[] describing chart/table usage rules." },
        imageGuidance: { type: "object", description: "String[] describing image treatment rules." },
        avoid: { type: "object", description: "String[] of visual or layout mistakes to avoid." },
      },
      current: sample.guidance,
    },
    styleDecisionProtocol: [
      "Before create_deck/set_theme, classify the source by subject domain, audience posture, emotional register, and viewing context.",
      "Choose a palette because it encodes the subject, not because it is fashionable. Assign roles: background, surface, primary accent, secondary/data accent, warning/extinction/risk accent.",
      "Choose typography from the audience: executive decks need neutral sans and fast scanning; academic/history decks can use warmer serif or humanist sans; engineering decks need compact sans + mono.",
      "Choose density from use case: live presentation = fewer words and bigger objects; leave-behind/reference = tables and smaller but still readable type.",
      "Name one visual signature for the deck (e.g. museum field-note, editorial poster, precision dashboard, lab notebook) and make it visible on slide 1 through color field, type scale, rail, ruler, or evidence treatment.",
      "Decide the cover archetype before writing slide 1: type-led poster, color-field title, image/evidence-led opener, or one-number opener. Do not use ordinary content-slide layout on the cover.",
      "Write the choice into themeOverride.guidance.scenario/stylePrinciples/layoutPrinciples/avoid so later slide decisions stay consistent.",
      "Do not use the same palette for unrelated subjects. A deck about Earth history should not look like a SaaS dashboard; a board memo should not look like a nature museum poster.",
    ],
    subjectStylePlaybook: [
      {
        subjectSignals: ["earth science", "geology", "climate", "evolution", "ecology", "natural history"],
        scenario: "educational earth-systems lecture",
        palette: {
          "brand.primary": "0F766E",
          background: "F7F3EA",
          surface: "FFFFFF",
          "surface.subtle": "E6F3F1",
          "text.primary": "1F2933",
          secondaryAccent: "B45309",
          lifeAccent: "2F855A",
          extinctionAccent: "B91C1C",
        },
        typography: [
          "Use a humanist or sturdy sans for readability; optional serif only for cover/title, not dense labels.",
          "Use warm, museum-like typography with generous title scale and restrained body text.",
        ],
        layout: [
          "Prefer deep-time axis-ruler, editorial side-rails, map-like cause/effect layouts, process-flow, tables for eras/events, and paired Earth<->Life feedback diagrams.",
          "Map color roles consistently: geology/land = amber, ocean/climate = teal/blue, life = green, extinction/crisis = red.",
          "At least one slide should use a dark mineral color field with inverse typography; at least one should use a ruler/axis instead of cards.",
        ],
        componentBias: ["axis-ruler", "side-rail", "eyebrow", "accent-rule", "timeline", "process-flow", "table-card", "feature-card", "key-takeaway", "stat-strip"],
        avoid: [
          "Do not make it look like a corporate KPI dashboard.",
          "Avoid too many identical cards; use deep-time scale and feedback loops as the visual rhythm.",
        ],
      },
      {
        subjectSignals: ["strategy", "board", "business review", "competitive", "operating plan"],
        scenario: "executive decision memo",
        palette: {
          "brand.primary": "0F172A",
          background: "F8FAFC",
          surface: "FFFFFF",
          "surface.subtle": "EEF2F7",
          "text.primary": "0F172A",
          success: "15803D",
          warning: "B45309",
          danger: "B91C1C",
        },
        typography: [
          "Use neutral sans typography, tight hierarchy, and direct headlines.",
          "Keep body copy compact but not tiny; assume fast executive scanning.",
        ],
        layout: [
          "Prefer thesis + evidence, chart-with-rail/table-with-rail, decision tables, KPI strips, comparison grids, and risk/action matrices.",
          "Make every slide answer: what changed, why it matters, what decision is needed.",
        ],
        componentBias: ["key-takeaway", "chart-with-rail", "table-card", "chart-card", "stat-strip", "comparison-card", "hero-and-support", "insight-card"],
        avoid: ["Avoid decorative illustration, playful color, and museum/poster compositions."],
      },
      {
        subjectSignals: ["system design", "engineering", "architecture", "API", "data model", "platform"],
        scenario: "technical architecture walkthrough",
        palette: {
          "brand.primary": "155E75",
          background: "F8FAFC",
          surface: "FFFFFF",
          "surface.subtle": "ECFEFF",
          "text.primary": "0F172A",
          codeAccent: "2563EB",
          warning: "D97706",
        },
        typography: [
          "Use compact sans plus mono for identifiers and endpoints.",
          "Favor clear labels over expressive display typography.",
        ],
        layout: [
          "Prefer layered architecture diagrams, process-flow, two-column explanation, and compact schema tables.",
          "Keep color semantic: data, compute, user surface, risk/failure path.",
        ],
        componentBias: ["process-flow", "table-card", "two-column", "code-card", "insight-card", "chart-card"],
        avoid: ["Avoid generic sales-deck hero sections and oversized decorative cards."],
      },
      {
        subjectSignals: ["research", "academic", "paper", "scientific study", "experiment"],
        scenario: "academic research briefing",
        palette: {
          "brand.primary": "374151",
          background: "FAFAF7",
          surface: "FFFFFF",
          "surface.subtle": "F3F4F1",
          "text.primary": "111827",
          evidenceAccent: "0F766E",
        },
        typography: [
          "Use restrained typography; optionally serif for titles and sans for tables/charts.",
          "Increase paragraph line height; avoid loud label styling.",
        ],
        layout: [
          "Prefer hypothesis/evidence/result flow, methods diagrams, charts, and careful tables.",
          "Use sources/captions quietly; make uncertainty visible.",
        ],
        componentBias: ["chart-card", "table-card", "process-flow", "quote", "key-takeaway"],
        avoid: ["Avoid hype language, bright sales colors, and excessive KPI styling."],
      },
      {
        subjectSignals: ["product launch", "pitch", "fundraising", "sales", "marketing"],
        scenario: "persuasive product narrative",
        palette: {
          "brand.primary": "EA580C",
          background: "FFF7ED",
          surface: "FFFFFF",
          "surface.subtle": "FFEDD5",
          "text.primary": "111827",
          secondaryAccent: "2563EB",
        },
        typography: [
          "Use larger hero type, punchy headlines, and high-contrast proof points.",
          "Prefer fewer words per slide; speaker carries nuance.",
        ],
        layout: [
          "Prefer problem/tension, before-after, hero metric, proof, and CTA sequence.",
          "Use one vivid accent block per slide; keep supporting content quiet.",
        ],
        componentBias: ["hero-stat", "stat-comparison", "feature-card", "quote", "cta", "key-takeaway"],
        avoid: ["Avoid dense tables except in appendix-style proof slides."],
      },
      {
        subjectSignals: ["finance", "investor update", "earnings", "forecast", "budget"],
        scenario: "financial performance update",
        palette: {
          "brand.primary": "1E3A8A",
          background: "F8FAFC",
          surface: "FFFFFF",
          "surface.subtle": "EFF6FF",
          "text.primary": "111827",
          success: "15803D",
          danger: "B91C1C",
        },
        typography: [
          "Use tabular, restrained typography; numbers need clear hierarchy.",
          "Avoid decorative title treatments that compete with the data.",
        ],
        layout: [
          "Prefer chart-card, table-card, stat-strip, variance callouts, and concise footnotes.",
          "Use green/red only for true positive/negative movement.",
        ],
        componentBias: ["chart-card", "table-card", "stat-strip", "stat-comparison", "bar-list"],
        avoid: ["Avoid categorical rainbow palettes and non-data illustrations."],
      },
    ],
    slideRoot: {
      description: "Top-level slide DOM has type:'slide' and a free-form children array. Optional title is a slide-title text node placed by the renderer at the top. Put area:'content' on any top-level node that should occupy the standard content rect; use anchors/explicit dimensions for overlays or deliberate full-slide elements.",
      fields: {
        background: { type: "string", description: "theme token or 6-char hex; sets the slide fill." },
        notes: { type: "string", description: "Speaker notes (markdown-inline)." },
      },
    },
    layoutPrinciples: [
      "One central message per slide. The slide-title is the headline; the body proves it once.",
      "Compose the page from the slide's children directly. A single area:'content' stack/grid is often convenient, but it is not required; top-level semantic components, containers, and anchored overlays are valid when they express the slide better.",
      "Prefer auto-layout (stack/grid) over absolute positioning. Use the anchor/zIndex overlay system only for chrome-style decorations.",
      "Respect the content rect bounds. If your intrinsic content is taller than the area, split into two slides instead of shrinking text.",
      "Leave breathing room. A grid with > 4 columns or a stack with > 6 vertical children almost always feels cramped.",
      "Use spacer for intentional asymmetry; do not pad with empty text nodes.",
      "Align: visually heavy elements (image, chart, big metric) deserve at least 40% of the content rect to read confidently.",
      "Choose a page archetype before choosing individual components: claim+proof, hero+satellites, data+rail, screenshot walkthrough, peer comparison, process/time, or executive synthesis.",
      "Use `split` for primary/secondary compositions. Use `hero-and-support`, `chart-with-rail`, and `snapshot-callouts` when those named archetypes match; they are safer than hand-built equal card grids.",
      "Every non-appendix slide needs a visible design move: color field, side-rail, axis/ruler, hero metric, oversized quote, image crop, diagram, or strong accent rule. A plain title plus equal cards is not enough.",
      "Use small visual primitives (`eyebrow`, `accent-rule`, `annotation`, `side-rail`, `axis-ruler`) to build style and hierarchy; do not wait for a full-page composite to make the slide designed.",
      "Cover slides need a poster-scale title lockup: use `title-lockup` with deck-title scale inside a full-slide color field, large quiet whitespace, or a dominant evidence/image region. A small centered title inside a mid-page rectangle fails.",
      "Closing slides need a final visual gesture: large `key-takeaway`, `title-lockup`, quote, or verdict band. Do not end with a normal content grid.",
      "Components must adapt to the page's color scheme through tone/token choices (`inverse` on dark fields, `brand` on light fields, `neutral` for support). Do not make or use a component that only works on one background.",
    ],
    consistencyPrinciples: [
      "Same content type, same layout. If two slides each show a 3-way comparison, both should use the same comparison-card grid pattern with the same column count.",
      "Same role across the deck means same component. Don't alternate between metric-card and a hand-rolled stack of texts for KPIs.",
      "Pick one accent color (brand.primary) for emphasis; do not introduce a second highlight color per slide.",
      "Page numbering and brand mark are deck-level decisions — set them once via chrome, do not toggle per slide.",
      "Title casing, punctuation, and language must be uniform (all Chinese or all English; consistent ending punctuation).",
      "Section-break slides should appear at chapter boundaries, never as a stand-alone closing slide.",
    ],
    textHygiene: [
      "Slide title ≤ 18 CJK chars / 60 latin chars; otherwise split.",
      "Card title (h2 / metric label / step-card title) ≤ 10 CJK chars / 30 latin chars to fit one line.",
      "Bullet item ≤ 22 CJK chars / 70 latin chars; longer than that, demote into paragraph or split.",
      "Callout ≤ 40 CJK chars / 120 latin chars to fit two lines.",
      "Metric value should be one short token (number+unit), not a sentence.",
      "Avoid trailing period on labels and bullets unless they are full sentences.",
    ],
    componentChoiceGuidelines: [
      "One slide verdict → `key-takeaway`; framing thesis → `lead`; warning/rule-of-thumb → one `callout` max.",
      "Opening/closing synthesis or decision memo → `executive-summary`; use `takeaway-list` when the page is only parallel conclusions.",
      "Concept / mechanism / cause / implication explanation → `explanation-block`, especially when the content is paragraph + support points.",
      "Lightweight before/after/options/trade-off comparison → `comparison-list`; full feature matrix → `comparison-table`; one peer object → `comparison-card`.",
      "Facts, observations, source snippets, or evidence rows → `fact-list`; use `evidence-layout` when a visual proof object must dominate.",
      "One dominant claim/object plus 2-4 supporting modules → `hero-and-support`.",
      "Dominant chart/table/image plus interpretation rail → `chart-with-rail`.",
      "Screenshot/image walkthrough with numbered observations → `snapshot-callouts`.",
      "Many KPIs → `kpi-grid` or `grid` with 3-4 `metric-card` children. Use `unit` and `trend` fields for delta semantics.",
      "Stage / process / roadmap → `timeline` or a `grid` of `step-card`.",
      "Compare 2-4 things → `grid` of `comparison-card` with parallel `points` arrays of equal length.",
      "Define a term → `definition-card`. For a list of definitions, use a grid of them.",
      "Person bio → `profile-card` (renders circular photo).",
      "Long article body → `article` (auto-paginates across multiple slides).",
      "Pull-quote / testimonial → `quote` with optional source.",
      "Strategic 2x2 analysis → `swot-matrix`.",
      "Single action / CTA → `cta` button-style text.",
      "Chapter divider → `section-break` (use as the only content of the slide).",
      "Cover/section/opening typography group → `title-lockup`; use it instead of loose text nodes when the title must look designed.",
      "Editorial kicker above a title/section → `eyebrow`, optionally with rule:true.",
      "A deliberate underline/side rule/visual spine → `accent-rule`, not a freeform shape.",
      "Diagram or evidence label → `annotation`.",
      "Asymmetric context column → `side-rail` inside a split/grid.",
      "Era scale, maturity scale, or ordered conceptual range → `axis-ruler`.",
      "Icon + label pair → `icon-text` (uses shape preset for the icon).",
      "Numbered procedure → `numbered-list` (NOT `bullets` with numbers prefixed in text).",
      "Product/feature highlights → `feature-card` in a grid (icon + title + body).",
      "Framed product shot, screenshot, or diagram → `image-card`.",
      "Chart module with title/source note → `chart-card`.",
      "Financial summary or feature matrix with title/source note → `table-card`.",
      "Reusable insight with status badge, detail, and bullets → `insight-card`; when the content shape is explanation, comparison, evidence list, or executive synthesis, prefer the matching text narrative component.",
      "Two-region narrative + visual/chart layout → `two-column`.",
      "Done/not-done audit → `checklist`. For trade-offs (good vs bad) → `pros-cons`.",
      "% completion / quota / capacity → `progress-bar`.",
      "Short pipeline (3-5 stages with arrows) → `process-flow`. Longer dated sequence → `timeline`.",
      "Partner/customer logos → `logo-strip` (NOT a hand-rolled grid of images).",
      "Pricing tiers → `pricing-card` in a grid; mark exactly one tier with tone:'brand'.",
      "Before/after KPI shift → `stat-comparison` (NOT two side-by-side metric-cards).",
    ],
    doNot: [
      "Do not set fontSize, fontFace, or rgb-hex `color` on component text nodes; use `style` and theme tokens. If a component needs a default, add a centralized component typography token derived from caption/label/card-title/etc.",
      "Do not nest `type:'component'` + `component:'X'`; write `type:'X'` directly.",
      "Do not wrap node fields under `props` — fields are flat.",
      "Do not use pixel coordinates. Layout distances are cm; text fontSize is pt; stroke fields (`lineWidth`, `borderWidth`, rule/divider `thickness`) are point-like, so `thickness:1` is a 1pt line while `fixedHeight:1` is a 1cm region.",
      "Do not draw your own page-number / logo / footer inside slides — that is chrome.",
      "Do not use shape primitives to fake bullets, dividers, or cards — there are dedicated components.",
      "Do not rely on overlapping default content rects accidentally. If multiple top-level nodes share area:'content', make the overlap intentional with anchors/zIndex or wrap them in an explicit stack/grid/split.",
    ],
    colorUsageRules: [
      "One emphasis system per slide. Pick either brand.primary or a single palette color (red/lime/...) — not both.",
      "Use semantic functional tokens (success/warning/danger) only when the value carries that meaning (e.g. KPI trend up=success, metric down=danger). Do not use them as decoration.",
      "Body text stays text.primary; muted text stays text.muted. Do not color paragraphs to draw attention — bold weight or layout placement does that.",
      "On dark color fields, use components with tone:'inverse' or text.inverse. On light fields, use brand/neutral tones. Do not hand-patch every child with raw colors.",
      "Backgrounds: surface (cards), surface.subtle (bands), brand.tint (one accent panel), background (slide). Avoid raw hex.",
      "Lines: divider for separators, brand.primary for emphasis lines. A second line color almost always reads as accidental.",
      "Charts use theme.chart.series automatically. Do not override colors unless the chart has a categorical legend that maps to palette names.",
    ],
    colorPaletteUsage: [
      "Palette (red, orange, yellow, lime, green, teal, blue, purple, pink) is for *categorical distinction*, not decoration: SWOT quadrants, process steps, distinct product lines, multi-series charts.",
      "≤ 4 palette colors per slide; pick adjacent hues on the color wheel (e.g. blue+teal+green or orange+yellow+lime). Wide-spaced hues (red+green+blue) read carnival.",
      "Use palette `.tint` for fills/backgrounds and the base name for text/lines. The base name is contrast-correct on a white surface.",
      "If brand.primary is already the slide's emphasis, do NOT introduce palette colors as a second accent — choose one system.",
      "Across the deck, a palette color should mean the same thing on every slide it appears (e.g. 'green = success category', 'orange = at-risk').",
      "Do not use palette colors for hero text; deck-title and slide-title stay text.primary or text.inverse.",
    ],
    containerUsageRules: [
      "Layout containers (stack, grid) only do layout. Do NOT set fill, line, cornerRadius on stack/grid — wrap them in a panel/card/band/frame instead.",
      "panel — generic tinted/bordered surface to group related content. Use one when 2+ related primitives form a unit and need visual separation from siblings.",
      "card — like panel, but adds optional header/footer/accent. Use for repeating card patterns (kpi list, comparison cells, definition lists).",
      "band — full-width tinted strip. Use sparingly: section dividers, hero quotes, or one strong callout that needs a colored background.",
      "frame — borderless fill with a clear outline. Use when you want emphasis without color (e.g. dashed placeholder regions, premium-product highlight).",
      "inset — pure padding wrapper. Use when a child needs to breathe inside its parent without a visual surface.",
      "Each decorative container takes ONE child. Multiple inner items belong in a stack/grid that is itself the panel's child.",
      "Decorative containers nest, but two adjacent panels or cards on the same slide should share the same tone — mixing tones reads as accidental.",
      "Choose tone:'tinted' or tone:'brand' for the 1-2 panels that carry the slide's main message; keep the rest tone:'neutral' or unset.",
    ],
    shapeDecorationRules: [
      "Shape primitives are for *iconography and arrow glyphs* only — feature-card icons, process-flow arrows, stat-comparison delta arrows. Do NOT use shape to fake bullets, dividers, or card backgrounds.",
      "Decorative backgrounds → panel/card/band/frame, never a shape rect.",
      "Separators → divider, never shape preset:'line'.",
      "If you find yourself stacking 3+ shapes for chrome on one slide, you're rebuilding chrome — set chrome.brandMark / chrome.pageNumber on the deck instead.",
      "Allowed shape presets per role: arrow-right/arrow-down for direction; ellipse/roundRect/star-5 for icons; rect for fills inside progress-bars; chevron for breadcrumb-style flow.",
      "Shape fill should be a single token (brand.primary, success, palette color). Avoid gradients and multi-shape compositions; use a component if a richer mark is needed.",
    ],
    emphasisHierarchy: [
      "Visual hierarchy on one slide, top to bottom: deck-title (only on cover) > slide-title > one accent block (callout, band, or tone:'brand' panel) > tinted surface backgrounds > divider > body text.",
      "Pick exactly one accent block per slide — multiple accents flatten the hierarchy.",
      "Color emphasis follows weight: bold + brand.primary > bold + text.primary > regular + text.primary > regular + text.muted.",
      "Big numbers (metric-value) carry weight on their own; do not also tint their surface unless the value is the slide's whole point (e.g. cover stat).",
      "Reserve uppercase + label style for short tags (≤ 2 words). Long uppercase strings degrade scan-ability.",
    ],
    densityRules: [
      "Bullets default to 'comfortable'. Switch to 'compact' only when the slide hosts 5+ bullets next to a peer block (chart, image, kpi-grid).",
      "If a stack at the slide-content area exceeds 6 vertical children OR a grid exceeds 4 columns × 2 rows, split into two slides.",
      "Card text density: card-title ≤ 10 CJK / 30 latin chars on one line; if it wraps, the card is overloaded — drop a sibling.",
      "When density-demote happens automatically (DEMOTED diagnostic), prefer to also re-author rather than relying on auto-shrink.",
      "Whitespace is content. A single panel:tone:'brand' surrounded by white reads stronger than three side-by-side panels.",
      "Aesthetic density is not content density: add style with scale, rails, rulers, and color fields, not by adding more cards.",
    ],
    fallbackLadder: {
      stages: [
        "1. shrink — flexible (non-fixedSize, non-weighted) children are scaled down toward their min.",
        "2. demote density — bullets density 'comfortable' → 'compact'; text style 'paragraph' → 'caption' when overflow remains.",
        "3. drop optional — children with `optional: true` are removed (use this on captions, source-notes, secondary callouts).",
        "4. truncate — text/bullets get autoFit:'shrink' so OOXML tightens line-spacing/font to fit.",
        "5. hard fail — FALLBACK_FAILED diagnostic is emitted; the slide is rendered but the container cannot honor all children.",
      ],
      diagnostics: [
        "After render, call getRenderDiagnostics() to read structured warnings; OVERFLOW/DEMOTED/DROP/TRUNCATED/FALLBACK_FAILED/COLLISION/TITLE_OCCLUDED/TINY_RECT/UNKNOWN_COLOR/UNKNOWN_STYLE codes are stable.",
        "Each diagnostic has `suggestion`; agents should re-author the slide following the suggestion rather than adjusting raw cm sizes.",
        "If FALLBACK_FAILED appears, split content into a new slide instead of fighting the layout.",
        "If TITLE_OCCLUDED appears, fix deck.themeOverride.layout.contentTop or move the covering decoration behind the title.",
        "If SQUASHED appears, treat it as a layout failure even if the slide technically renders; reduce columns, change the component, or split the content.",
        "Use `optional: true` on nice-to-have decoration so the renderer can drop it cleanly when space is tight.",
      ],
    },
  };
}
