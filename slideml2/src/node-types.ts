import type { NodeType } from "./types.js";

export interface NodeFieldInfo {
  description: string;
  valueType: "string" | "number" | "boolean" | "enum" | "array" | "object" | "image-ref" | "table" | "chart";
  values?: string[];
  required?: boolean;
  max?: number;
}

export interface NodeTypeInfo {
  type: NodeType;
  use: string;
  fields: Record<string, string>;
  fieldsDetailed: Record<string, NodeFieldInfo>;
  acceptsChildren?: NodeType[];
}

function summarize(detailed: Record<string, NodeFieldInfo>): Record<string, string> {
  return Object.fromEntries(Object.entries(detailed).map(([key, info]) => [key, info.description]));
}

const ANCHOR_FIELDS: Record<string, NodeFieldInfo> = {
  anchor: {
    valueType: "enum",
    values: [
      "top-left", "top-center", "top-right",
      "middle-left", "middle-center", "middle-right",
      "bottom-left", "bottom-center", "bottom-right",
    ],
    description: "Anchor a node as overlay relative to the slide. Only valid as direct child of slide.",
  },
  offsetX: { valueType: "number", description: "Horizontal offset in cm from the anchor point (positive = right)." },
  offsetY: { valueType: "number", description: "Vertical offset in cm from the anchor point (positive = down)." },
  width: { valueType: "number", description: "Anchored node width in cm." },
  height: { valueType: "number", description: "Anchored node height in cm." },
  zIndex: { valueType: "number", description: "Render order: higher = on top. Negative = behind flow content." },
  fillSlide: { valueType: "boolean", description: "Slide-spanning overlay sentinel: width/height auto-expand to (slideWidthCm - 2*offsetX) / (slideHeightCm - 2*offsetY). Use for decoration-grid backgrounds, full-bleed watermarks. Works across deck sizes (16x9 / 4x3 / wide)." },
};

const TRANSFORM_FIELDS: Record<string, NodeFieldInfo> = {
  rotation: { valueType: "number", description: "Rotation in degrees (clockwise)." },
  flipH: { valueType: "boolean", description: "Flip horizontally." },
  flipV: { valueType: "boolean", description: "Flip vertically." },
};

const SLIDE_DETAILED: Record<string, NodeFieldInfo> = {
  background: { valueType: "string", description: "theme token or 6-char hex" },
  notes: { valueType: "string", description: "speaker notes (markdown-inline)" },
};

const STACK_DETAILED: Record<string, NodeFieldInfo> = {
  direction: { valueType: "enum", values: ["vertical", "horizontal"], description: "vertical | horizontal" },
  gap: { valueType: "number", description: "number in cm; spacing between children" },
  area: { valueType: "enum", values: ["content", "full"], description: "content (only valid as direct child of slide root)" },
  justify: { valueType: "enum", values: ["start", "center", "end"], description: "Main-axis alignment when children's total size is smaller than the stack. 'center' vertically centers a vertical stack's children; 'end' pushes them to the bottom (or right). Default 'start'." },
  align: { valueType: "enum", values: ["start", "center", "end"], description: "cross-axis alignment of children" },
  valign: { valueType: "enum", values: ["top", "middle", "bottom"], description: "cross-axis alignment for horizontal stacks" },
  padding: { valueType: "number", description: "number in cm; inner padding" },
  fill: { valueType: "string", description: "theme token" },
  line: { valueType: "string", description: "theme token" },
  cornerRadius: { valueType: "number", description: "0..0.5 fraction of shorter side, applied to fill/line shape" },
  layoutWeight: { valueType: "number", description: "explicit grow weight when used as a stack child" },
  optional: { valueType: "boolean", description: "if true, this child may be dropped during fallback when its parent overflows. Use for nice-to-have decoration like captions, source notes, or secondary callouts." },
  fixedHeight: { valueType: "number", description: "number in cm; explicit height" },
  minHeight: { valueType: "number", description: "number in cm; lower bound when inferred" },
  maxHeight: { valueType: "number", description: "number in cm; upper bound when inferred" },
  ...ANCHOR_FIELDS,
};

const GRID_DETAILED: Record<string, NodeFieldInfo> = {
  columns: { valueType: "number", description: "number of columns" },
  gap: { valueType: "number", description: "number in cm; spacing between children" },
  area: { valueType: "enum", values: ["content", "full"], description: "content (only valid as direct child of slide root)" },
  columnWeights: { valueType: "array", description: "number[]; explicit column proportions, otherwise equal" },
  rowWeights: { valueType: "array", description: "number[]; explicit row proportions, otherwise equal" },
  rows: { valueType: "number", description: "minimum row count; rows expand automatically if children + colSpan/rowSpan need more" },
  fixedHeight: { valueType: "number", description: "number in cm; explicit height" },
  // Per-child fields supported in grid (set on each child node):
  //   colSpan: child occupies N adjacent columns (default 1)
  //   rowSpan: child occupies N adjacent rows (default 1)
  // Children are placed left-to-right, top-to-bottom in the next free cell
  // big enough to fit their span (CSS-Grid 'dense' style). Use a hero
  // colSpan:2,rowSpan:2 child + smaller satellite cells to break out of
  // pure-column layouts.
  ...ANCHOR_FIELDS,
};

const SPLIT_DETAILED: Record<string, NodeFieldInfo> = {
  direction: { valueType: "enum", values: ["horizontal", "vertical"], description: "horizontal: primary on the left, secondary on the right. vertical: primary on top, secondary on the bottom." },
  ratio: { valueType: "array", description: "number[]; explicit weights for the children (default [0.62, 0.38] for 2 children — golden-ratio split). Length must equal children.length." },
  gap: { valueType: "number", description: "number in cm; spacing between primary and secondary." },
  area: { valueType: "enum", values: ["content", "full"], description: "content (only valid as direct child of slide root)" },
  padding: { valueType: "number", description: "number in cm; inner padding." },
  align: { valueType: "enum", values: ["start", "center", "end"], description: "cross-axis alignment of children." },
  valign: { valueType: "enum", values: ["top", "middle", "bottom"], description: "cross-axis alignment for horizontal splits." },
  fixedHeight: { valueType: "number", description: "number in cm; explicit height." },
  fixedWidth: { valueType: "number", description: "number in cm; explicit width." },
  layoutWeight: { valueType: "number", description: "explicit grow weight when used as a stack/grid child." },
  ...ANCHOR_FIELDS,
};

const SPACER_DETAILED: Record<string, NodeFieldInfo> = {
  fixedWidth: { valueType: "number", description: "number in cm; explicit width in horizontal stacks or grids" },
  fixedHeight: { valueType: "number", description: "number in cm; explicit height in vertical stacks or grids" },
  minWidth: { valueType: "number", description: "number in cm; lower bound when width is inferred" },
  minHeight: { valueType: "number", description: "number in cm; lower bound when height is inferred" },
  layoutWeight: { valueType: "number", description: "number; set to grow and consume remaining stack space" },
};

const DIVIDER_DETAILED: Record<string, NodeFieldInfo> = {
  orientation: { valueType: "enum", values: ["horizontal", "vertical", "auto"], description: "horizontal | vertical | auto" },
  thickness: { valueType: "number", description: "number in cm; line thickness" },
  line: { valueType: "string", description: "theme token or 6-char hex" },
  dash: { valueType: "enum", values: ["solid", "dash", "dashDot", "dot"], description: "line dash style" },
  fixedWidth: { valueType: "number", description: "number in cm; useful for vertical dividers" },
  fixedHeight: { valueType: "number", description: "number in cm; useful for horizontal dividers" },
};

const TEXT_DETAILED: Record<string, NodeFieldInfo> = {
  size: {
    valueType: "enum",
    values: ["xs", "sm", "md", "lg", "xl", "2xl"],
    description: "Semantic font-size dial. md = default for the chosen style. Use sm/xs for narrow cards (≤ 5cm), lg/xl for big-number hero text (≥ 9cm). Never set raw fontSize.",
  },
  text: { valueType: "string", description: "string (single paragraph; for multi-paragraph use paragraphs)" },
  weight: { valueType: "enum", values: ["normal", "medium", "bold"], description: "Override the style's default weight. Use 'medium' to add emphasis without going to full bold." },
  italic: { valueType: "boolean", description: "Render the text in italic." },
  underline: { valueType: "boolean", description: "Render with an underline." },
  uppercase: { valueType: "boolean", description: "Render text in uppercase (CSS text-transform style)." },
  letterSpacing: { valueType: "number", description: "Letter spacing in pt × 100 (OOXML <a:rPr spc='X'> field). Negative tightens, positive opens; usually -50 to 200." },
  paragraphs: { valueType: "array", description: "Paragraph[]: { text|runs, align?, indentLevel?, lineSpacing?, spaceAfter?, bullet? } for multi-paragraph rich text." },
  content: { valueType: "array", description: "RichTextRun[]: low-level run array with marks (bold/italic/underline/code/emphasis), color, link, breakLine." },
  style: { valueType: "string", description: "theme text style; usually omitted for agents" },
  color: { valueType: "string", description: "theme token or 6-char hex" },
  align: { valueType: "enum", values: ["left", "center", "right", "justify"], description: "left | center | right | justify" },
  valign: { valueType: "enum", values: ["top", "middle", "bottom"], description: "vertical alignment within text box" },
  lineSpacing: { valueType: "number", description: "line height in points (overrides theme)" },
  spaceAfter: { valueType: "number", description: "space after paragraph in points" },
  indentLevel: { valueType: "number", description: "0..8 indent level (also drives bullet level)" },
  autoFit: { valueType: "enum", values: ["shrink", "resize"], description: "shrink: <a:normAutofit/>; resize: <a:spAutoFit/>" },
  fill: { valueType: "string", description: "theme token; box fill behind text" },
  line: { valueType: "string", description: "theme token; box border" },
  cornerRadius: { valueType: "number", description: "0..0.5 fraction of shorter side; promotes geometry to roundRect" },
  fixedHeight: { valueType: "number", description: "number in cm; explicit height" },
  ...ANCHOR_FIELDS,
};

const BULLETS_DETAILED: Record<string, NodeFieldInfo> = {
  size: { valueType: "enum", values: ["xs", "sm", "md", "lg"], description: "Semantic font-size dial; lg only for hero bulleted lists." },
  items: {
    valueType: "array",
    required: true,
    description: "string[] OR array of { text, indentLevel?, bold?, color?, runs? } for nested/styled bullets",
  },
  density: { valueType: "enum", values: ["comfortable", "compact"], description: "comfortable | compact" },
  numbered: { valueType: "boolean", description: "render as numbered list (1., 2., ...) instead of bullets" },
  align: { valueType: "enum", values: ["left", "center", "right"], description: "horizontal alignment" },
  title: { valueType: "string", description: "optional bullet group title" },
  indentLevel: { valueType: "number", description: "default indent level for items without explicit level" },
  marker: {
    valueType: "string",
    description:
      "Shape glyph for the bullet marker. String shorthand: 'disc' (●), 'circle' (○), 'square' (■), 'square-outline' (□), 'triangle' (▶), 'diamond' (◆), 'arrow' (→), 'check' (✓), 'star' (★), 'dash' (–), 'chevron' (›). Object form: { shape: <preset>, color?, size? }. Ignored when numbered:true.",
  },
  markerColor: { valueType: "string", description: "Theme token or hex; colors the marker glyph independent of the run text color." },
  markerSize: { valueType: "number", description: "Marker size as fraction of text size (0.5..2.0). 1.0 = same as text." },
};

const IMAGE_DETAILED: Record<string, NodeFieldInfo> = {
  src: { valueType: "image-ref", required: true, description: "absolute path, URL, or data URL" },
  alt: { valueType: "string", description: "string" },
  caption: { valueType: "string", description: "optional string rendered below the image" },
  captionPosition: { valueType: "enum", values: ["below", "above", "right", "none"], description: "optional caption placement (default below)" },
  fit: { valueType: "enum", values: ["cover", "contain", "fill"], description: "cover | contain | fill" },
  position: { valueType: "enum", values: ["bottom-right", "top-right", "center"], description: "(legacy) anchored position; prefer anchor + offsetX/offsetY" },
  width: { valueType: "number", description: "number in cm" },
  height: { valueType: "number", description: "number in cm" },
  fixedHeight: { valueType: "number", description: "number in cm; explicit height" },
  minHeight: { valueType: "number", description: "number in cm; lower bound when inferred" },
  clip: { valueType: "enum", values: ["square", "rounded", "circle"], description: "image silhouette: square | rounded | circle" },
  cornerRadius: { valueType: "number", description: "0..0.5 fraction; for clip: rounded" },
  border: { valueType: "object", description: "{ color, width?, dash? } drawn around clipped image" },
  overlay: { valueType: "object", description: "{ color, alpha? } translucent color overlay" },
  crop: { valueType: "object", description: "{ left?, right?, top?, bottom? } source-rect crop fractions 0..1" },
  softEdge: { valueType: "number", description: "0..0.5 feathered edge fraction" },
  shadow: { valueType: "object", description: "{ color, alpha?, blur?, dx?, dy? } drop shadow" },
  grayscale: { valueType: "boolean", description: "convert to grayscale" },
  brightness: { valueType: "number", description: "-1..1 luminance shift" },
  blur: { valueType: "number", description: "EMU radius gaussian blur" },
  duotone: { valueType: "object", description: "{ dark, light } two-tone recolor" },
  ...ANCHOR_FIELDS,
};

const TABLE_DETAILED: Record<string, NodeFieldInfo> = {
  headers: { valueType: "array", description: "string[]" },
  rows: { valueType: "array", required: true, description: "string[][] for plain rows; or TableCell[][]: { text|runs, align?, valign?, fill?, color?, bold?, colspan?, rowspan? }" },
  caption: { valueType: "string", description: "optional string rendered below the table" },
  align: { valueType: "enum", values: ["left", "center", "right"], description: "default cell alignment" },
  firstRowHeader: { valueType: "boolean", description: "optional: treat first row as header (default true when headers present)" },
  colWidths: { valueType: "array", description: "number[] in cm OR fractional weights; controls column proportions" },
  rowHeights: { valueType: "array", description: "number[] in cm; controls row heights" },
  borderColor: { valueType: "string", description: "theme token or hex; cell border color" },
  borderWidth: { valueType: "number", description: "number in cm; cell border width" },
  fixedHeight: { valueType: "number", description: "number in cm; explicit height" },
};

const CHART_DETAILED: Record<string, NodeFieldInfo> = {
  chartType: {
    valueType: "enum",
    values: ["bar", "stacked-bar", "line", "pie", "doughnut", "area", "combo", "scatter", "waterfall"],
    required: true,
    description: "bar | stacked-bar | line | pie | doughnut | area | combo | scatter | waterfall",
  },
  labels: { valueType: "array", required: true, description: "string[]" },
  series: { valueType: "array", required: true, description: "array of {name?, values:number[], type?: 'bar'|'line' (combo), points?: {x,y}[] (scatter)}" },
  title: { valueType: "string", description: "string" },
  yFormat: { valueType: "enum", values: ["int", "decimal", "percent", "wanyuan", "yi"], description: "Y-axis number format" },
  axis: { valueType: "object", description: "optional object for axis labels or formatting" },
  legend: { valueType: "object", description: "optional object for legend visibility or position" },
  caption: { valueType: "string", description: "optional string rendered below the chart" },
  showValues: { valueType: "boolean", description: "boolean" },
  showLegend: { valueType: "boolean", description: "boolean (default true when series.length > 1)" },
  colors: { valueType: "array", description: "hex[] without # prefix; series color cycle (overrides theme palette)" },
  annotations: { valueType: "array", description: "ChartAnnotation[]: { at?, range?, label, style?: 'callout'|'marker'|'band' }" },
  fixedHeight: { valueType: "number", description: "number in cm; explicit height" },
};

const SHAPE_DETAILED: Record<string, NodeFieldInfo> = {
  preset: {
    valueType: "enum",
    values: [
      "rect", "roundRect", "ellipse", "line",
      "triangle", "rightTriangle", "pentagon",
      "arrow-right", "arrow-down", "callout",
      "chevron", "star-5", "parallelogram", "cloud",
    ],
    description: "OOXML preset geometry name",
  },
  fill: { valueType: "string", description: "theme token or 6-char hex" },
  line: { valueType: "string", description: "theme token or 6-char hex" },
  lineWidth: { valueType: "number", description: "number in cm; line/border width" },
  lineDash: { valueType: "enum", values: ["solid", "dash", "dashDot", "dot"], description: "line dash style" },
  cornerRadius: { valueType: "number", description: "0..1 fraction of shorter side (roundRect)" },
  fixedHeight: { valueType: "number", description: "number in cm; explicit height" },
  ...TRANSFORM_FIELDS,
  ...ANCHOR_FIELDS,
};

const PANEL_DETAILED: Record<string, NodeFieldInfo> = {
  tone: { valueType: "enum", values: ["neutral", "brand", "positive", "warning", "danger", "tinted"], description: "Pre-mapped color set for fill/line/text. 'tinted' uses brand.tint. Aliases also accepted: success↔positive, error↔danger, caution↔warning, info↔brand, muted↔neutral." },
  fill: { valueType: "string", description: "Override fill: theme token or hex." },
  line: { valueType: "string", description: "Override line: theme token or hex." },
  padding: { valueType: "number", description: "Inner padding in cm. Defaults to theme.component.panel.padding." },
  cornerRadius: { valueType: "number", description: "Roundness 0..0.5 of the shorter side." },
  elevation: { valueType: "enum", values: ["flat", "raised", "outlined"], description: "Shadow / border combination preset." },
  fixedHeight: { valueType: "number", description: "Explicit height in cm." },
  fixedWidth: { valueType: "number", description: "Explicit width in cm." },
  layoutWeight: { valueType: "number", description: "Grow weight when used as a stack child." },
};

const CARD_DETAILED: Record<string, NodeFieldInfo> = {
  ...PANEL_DETAILED,
  header: { valueType: "string", description: "Optional short header text (rendered as h2)." },
  footer: { valueType: "string", description: "Optional short footer text (rendered as caption)." },
  accent: { valueType: "enum", values: ["none", "left", "top"], description: "Optional brand-color accent bar position." },
  accentColor: { valueType: "string", description: "Theme token for the accent bar (default: brand.primary)." },
};

const BAND_DETAILED: Record<string, NodeFieldInfo> = {
  tone: { valueType: "enum", values: ["neutral", "brand", "positive", "warning", "danger", "tinted"], description: "Pre-mapped color set. Aliases also accepted: success↔positive, error↔danger, caution↔warning, info↔brand, muted↔neutral." },
  fill: { valueType: "string", description: "Override fill." },
  height: { valueType: "number", description: "Band height in cm. Default 1.6cm." },
  fixedHeight: { valueType: "number", description: "Alias of height." },
  cornerRadius: { valueType: "number", description: "Default 0 (sharp full-bleed band)." },
  padding: { valueType: "number", description: "Inner padding in cm." },
};

const FRAME_DETAILED: Record<string, NodeFieldInfo> = {
  line: { valueType: "string", description: "Border color theme token (default 'divider')." },
  lineWidth: { valueType: "number", description: "Line width in cm (default 0.025)." },
  dash: { valueType: "enum", values: ["solid", "dash", "dashDot", "dot"], description: "Border dash style." },
  cornerRadius: { valueType: "number", description: "Roundness 0..0.5." },
  padding: { valueType: "number", description: "Inner padding in cm." },
  fixedHeight: { valueType: "number", description: "Explicit height in cm." },
  fixedWidth: { valueType: "number", description: "Explicit width in cm." },
};

const INSET_DETAILED: Record<string, NodeFieldInfo> = {
  padding: { valueType: "number", required: true, description: "Inner padding in cm. The whole point of inset." },
  fixedHeight: { valueType: "number", description: "Explicit height in cm." },
  fixedWidth: { valueType: "number", description: "Explicit width in cm." },
};

const COMPONENT_DETAILED: Record<string, NodeFieldInfo> = {
  component: { valueType: "string", required: true, description: "registered component name" },
  "...fields": { valueType: "object", description: "component-specific fields from describeComponents([name])" },
};

export const NODE_TYPES: NodeTypeInfo[] = [
  {
    type: "slide",
    use: "Root of one slide. Set background and hold top-level containers.",
    fields: summarize(SLIDE_DETAILED),
    fieldsDetailed: SLIDE_DETAILED,
    acceptsChildren: ["stack", "grid", "spacer", "divider", "text", "bullets", "image", "table", "chart", "shape", "component"],
  },
  {
    type: "stack",
    use: "Flow container for a single semantic group whose children should read in sequence. Use for ordered narrative, grouped support points, or a module's internal layout; do not use as a generic page made of unrelated text.",
    fields: summarize(STACK_DETAILED),
    fieldsDetailed: STACK_DETAILED,
    acceptsChildren: ["spacer", "divider", "text", "bullets", "image", "table", "chart", "shape", "component", "stack", "grid", "split", "panel", "card", "band", "frame", "inset"],
  },
  {
    type: "grid",
    use: "Matrix container for peer modules that should be compared or scanned together. Children may set colSpan/rowSpan to make one semantic hero cell plus smaller satellites; avoid plain equal cards when a chart/table/process component describes the meaning better.",
    fields: summarize(GRID_DETAILED),
    fieldsDetailed: GRID_DETAILED,
    acceptsChildren: ["spacer", "divider", "text", "bullets", "image", "table", "chart", "shape", "component", "stack", "split", "panel", "card", "frame", "inset"],
  },
  {
    type: "split",
    use: "Primary/secondary composition for one dominant idea plus support: chart + commentary, image + interpretation, claim + proof, before + after. Use when the slide has a clear focus and subordinate context.",
    fields: summarize(SPLIT_DETAILED),
    fieldsDetailed: SPLIT_DETAILED,
    acceptsChildren: ["spacer", "divider", "text", "bullets", "image", "table", "chart", "shape", "component", "stack", "grid", "split", "panel", "card", "band", "frame", "inset"],
  },
  { type: "spacer", use: "Layout-only breathing room or flexible push inside an existing semantic module. Use to pace composition; never use empty text for spacing.", fields: summarize(SPACER_DETAILED), fieldsDetailed: SPACER_DETAILED },
  { type: "divider", use: "Semantic separator between related regions, phases, or columns. Use when the boundary itself helps reading; prefer accent-rule for editorial emphasis.", fields: summarize(DIVIDER_DETAILED), fieldsDetailed: DIVIDER_DETAILED },
  { type: "text", use: "Plain prose, caption, or one-off label when no richer semantic component fits. Prefer lead, callout, quote, key-takeaway, source-note, or data components when the text has a specific role.", fields: summarize(TEXT_DETAILED), fieldsDetailed: TEXT_DETAILED },
  { type: "bullets", use: "Parallel list of facts, criteria, or options. Use only when items are genuinely peers; use checklist for status, numbered-list/numbered-grid for order, and process-flow/timeline for sequence.", fields: summarize(BULLETS_DETAILED), fieldsDetailed: BULLETS_DETAILED },
  { type: "image", use: "Raw visual asset node for a photo, logo, screenshot, or diagram. Use image-card when the image needs title/caption/evidence framing; use fit/crop deliberately.", fields: summarize(IMAGE_DETAILED), fieldsDetailed: IMAGE_DETAILED },
  { type: "table", use: "Raw structured rows/columns for lookup, matrix, or dense comparison. Use table-card when the table is an evidence module with title/source/chrome.", fields: summarize(TABLE_DETAILED), fieldsDetailed: TABLE_DETAILED },
  { type: "chart", use: "Raw quantitative relationship: ranking, trend, distribution, part-to-whole, or bridge. Use chart-card when the chart is a titled evidence module.", fields: summarize(CHART_DETAILED), fieldsDetailed: CHART_DETAILED },
  { type: "shape", use: "Geometric mark for connectors, masks, icons, highlights, or purposeful diagram geometry. Do not use as a generic substitute for semantic components.", fields: summarize(SHAPE_DETAILED), fieldsDetailed: SHAPE_DETAILED },
  { type: "component", use: "Agent-facing component selected from listComponents(); may expand to a primitive, semantic leaf, or composite node.", fields: summarize(COMPONENT_DETAILED), fieldsDetailed: COMPONENT_DETAILED },
  {
    type: "panel",
    use: "Surface wrapper for one related semantic group that needs visual separation. Pair with stack/grid for the child layout; do not use as the page's default way to make prose look designed.",
    fields: summarize(PANEL_DETAILED),
    fieldsDetailed: PANEL_DETAILED,
    acceptsChildren: ["stack", "grid", "text", "bullets", "image", "table", "chart", "shape", "component", "spacer", "divider"],
  },
  {
    type: "card",
    use: "Reusable contained module with optional header/footer/accent. Use only when the content is naturally card-like (metric, definition, comparison item, evidence tile); prefer richer semantic components first.",
    fields: summarize(CARD_DETAILED),
    fieldsDetailed: CARD_DETAILED,
    acceptsChildren: ["stack", "grid", "text", "bullets", "image", "table", "chart", "shape", "component"],
  },
  {
    type: "band",
    use: "Wide emphasis band for a section break, thesis, verdict, or hero quote that should interrupt the flow. It carries one strong idea, not dense body content.",
    fields: summarize(BAND_DETAILED),
    fieldsDetailed: BAND_DETAILED,
    acceptsChildren: ["stack", "grid", "text", "image", "component"],
  },
  {
    type: "frame",
    use: "Border-only wrapper for an artifact, placeholder, or lightly emphasized region. Use when containment matters but fill would compete with content.",
    fields: summarize(FRAME_DETAILED),
    fieldsDetailed: FRAME_DETAILED,
    acceptsChildren: ["stack", "grid", "text", "bullets", "image", "table", "chart", "shape", "component"],
  },
  {
    type: "inset",
    use: "Invisible padding wrapper that gives one semantic child breathing room. Use for spacing inside a surface, not as a visible module.",
    fields: summarize(INSET_DETAILED),
    fieldsDetailed: INSET_DETAILED,
    acceptsChildren: ["stack", "grid", "text", "bullets", "image", "table", "chart", "shape", "component"],
  },
];

export function listNodeTypes(): NodeTypeInfo[] {
  return NODE_TYPES;
}

export function describeNodeType(type: NodeType): NodeTypeInfo {
  const found = NODE_TYPES.find((item) => item.type === type);
  if (!found) throw new Error(`Unknown node type: ${type}`);
  return found;
}
