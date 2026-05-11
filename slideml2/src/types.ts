import type { DeckSize } from "./units.js";
import type { ValidationMode } from "./schema.js";

export type SlideSize = DeckSize;

export interface DeckValidationSpec {
  mode?: ValidationMode;
  allowUnknownComponents?: boolean;
  maxTextLength?: number;
  requireAlt?: boolean;
  requireSources?: boolean;
}

export type DataSourceKind = "inline-json" | "inline-csv" | "file-csv" | "computed";

export interface DataSourceSpec {
  type?: DataSourceKind;
  data?: unknown;
  json?: unknown;
  rows?: Array<Record<string, unknown>>;
  csv?: string;
  text?: string;
  path?: string;
  file?: string;
  delimiter?: "," | ";" | "\t";
  source?: string;
  view?: DataViewSpec;
  computed?: Record<string, DataComputedExpressionSpec>;
  columns?: Record<string, DataComputedExpressionSpec>;
  postComputed?: Record<string, DataComputedExpressionSpec>;
  sourceLabel?: string;
  citation?: string;
  accessedAt?: string;
}

export type DataAggregateOp = "sum" | "avg" | "min" | "max" | "count" | "first" | "last";

export type DataAggregateSpec = Record<string, DataAggregateOp | { op: DataAggregateOp; field?: string }>;

export interface DataPivotSpec {
  index: string | string[];
  columns: string;
  values: string;
  aggregate?: DataAggregateOp;
  fill?: string | number;
}

export type DataComputedOperand =
  | string
  | number
  | boolean
  | null
  | { field: string }
  | { value: unknown };

export type DataComputedExpressionSpec =
  | DataComputedOperand
  | {
      op:
        | "field"
        | "literal"
        | "add"
        | "sum"
        | "subtract"
        | "sub"
        | "multiply"
        | "mul"
        | "divide"
        | "div"
        | "ratio"
        | "percent-change"
        | "percentChange"
        | "negate"
        | "abs"
        | "round"
        | "concat"
        | "coalesce";
      field?: string;
      value?: unknown;
      left?: DataComputedOperand;
      right?: DataComputedOperand;
      current?: DataComputedOperand;
      previous?: DataComputedOperand;
      values?: DataComputedOperand[];
      digits?: number;
      separator?: string;
      empty?: unknown;
    };

export type DataColumnType = "text" | "number" | "percent" | "currency" | "date";

export interface DataColumnEncodingSpec {
  key: string;
  label?: string;
  type?: DataColumnType;
  format?: "int" | "decimal" | "compact" | "percent" | "currency" | string;
  align?: "left" | "center" | "right";
  width?: number;
}

export interface DataStatItemEncodingSpec {
  value: string;
  key?: string;
  field?: string;
  label?: string;
  labelField?: string;
  valueLabel?: string;
  tone?: string;
  type?: DataColumnType;
  format?: "int" | "decimal" | "compact" | "percent" | "currency" | string;
}

export interface DataBindSpec {
  source: string;
  select?: string[] | Record<string, string>;
  filter?: Record<string, unknown>;
  groupBy?: string | string[];
  aggregate?: DataAggregateSpec;
  pivot?: DataPivotSpec;
  sort?: string | { by: string; direction?: "asc" | "desc" };
  limit?: number;
}

export type DataViewSpec = Omit<DataBindSpec, "source">;

export interface DataEncodingSpec {
  x?: string;
  y?: string | string[];
  /** Optional orientation for bar-like bound charts. When omitted, SlideML2 can infer horizontal bars from x=numeric and y=categorical. */
  orientation?: "vertical" | "horizontal";
  series?: string;
  label?: string;
  value?: string;
  delta?: string;
  items?: DataStatItemEncodingSpec[];
  columns?: Array<string | DataColumnEncodingSpec>;
  seriesName?: string;
  seriesOptions?: Record<string, {
    name?: string;
    type?: "bar" | "line";
    axis?: "primary" | "secondary";
    trendLine?: { type?: "linear" | "exp" | "log" | "poly"; order?: number; label?: string } | boolean;
    errorBars?: { type?: "fixed" | "percent" | "stdDev" | "stdErr"; value?: number; direction?: "x" | "y" | "both" };
  }>;
}

export type ThemeLayoutArea =
  | { x: number; y: number; w: number; h: number }
  | { left: number; top: number; right: number; bottom: number };

export interface SurfaceShadowOverride {
  color?: string;
  alpha?: number;
  blur?: number;
  dx?: number;
  dy?: number;
}

export interface SurfaceGradientStopOverride {
  color: string;
  position?: number;
  alpha?: number;
}

export interface SurfaceGradientOverride {
  kind?: "linear" | "radial";
  angle?: number;
  stops: SurfaceGradientStopOverride[];
}

export interface SurfaceOverride {
  fill?: string;
  fillOpacity?: number;
  line?: string;
  lineOpacity?: number;
  lineWidth?: number;
  lineDash?: "solid" | "dash" | "dashDot" | "dot";
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: "solid" | "dash" | "dashDot" | "dot";
  cornerRadius?: number;
  padding?: number;
  elevation?: "flat" | "raised" | "floating" | "outlined";
  shadow?: SurfaceShadowOverride;
  gradient?: SurfaceGradientOverride;
  accent?: "none" | "left" | "top";
  accentColor?: string;
  accentWidth?: number;
}

export interface Slideml2Deck {
  slideml2: 1;
  deck: DeckSpec;
  slides: SlideSpec[];
}

export interface DeckSpec {
  size?: SlideSize;
  theme?: "default" | "simple" | string;
  /**
   * Agent-supplied theme override. Deep-merged over the default scaffold.
   * Agents are expected to populate this at the start of every deck — the
   * default theme is a neutral baseline, not a finished design.
   *
   *   { colors: {...}, text: {...}, component: {...}, layout: {...}, fonts: {...} }
   */
  themeOverride?: ThemeOverride;
  brand?: BrandSpec;
  chrome?: ChromeSpec;
  validation?: DeckValidationSpec;
  dataSources?: Record<string, DataSourceSpec>;
  references?: ReferenceSpec[];
  footnotes?: FootnoteSpec[];
  metadata?: Record<string, unknown>;
}

/** themeOverride.colors accepts BOTH the canonical flat shape
 *    {"brand.primary":"...", "text.primary":"..."}
 *  and the nested object shape LLMs gravitate toward
 *    {brand:{primary:"..."}, text:{primary:"..."}}.
 *  Nested forms are flattened by `flattenColorOverrides()` before the renderer
 *  ever sees them. */
type ColorOverrideValue = string | { [k: string]: ColorOverrideValue };
export interface ThemeOverride {
  colors?: Record<string, ColorOverrideValue>;
  text?: Record<string, {
    fontSize?: number;
    /** "normal" | "bold" | numeric 100..900. Numeric weights resolve to
     *  typeface-name suffixes ("Inter Light", "Inter SemiBold") and emit
     *  b="1" for >=600. */
    weight?: "normal" | "bold" | number;
    /** Agent-friendly alias for weight. */
    fontWeight?: "normal" | "bold" | number;
    color?: string;
    lineHeight?: number;
    margin?: { l?: number; r?: number; t?: number; b?: number };
    letterSpacing?: number;
    /** Pull from the theme's display, text, or mono font role. */
    fontFamily?: "display" | "text" | "mono";
    /** OpenType feature flags ('tnum', 'smcp', ...) emitted on every run. */
    fontFeatures?: string[];
    uppercase?: boolean;
    italic?: boolean;
  }>;
  component?: Record<string, Omit<SurfaceOverride, "accent"> & { accent?: string | SurfaceOverride["accent"] }>;
  tone?: Record<string, { fg: string; bg: string; line: string }>;
  layout?: Partial<{ slideWidthCm: number; slideHeightCm: number; pageMarginX: number; titleTop: number; titleHeight: number; contentTop: number; contentBottom: number; defaultGap: number; columnGap: number; cardPadding: number; areas: Record<string, ThemeLayoutArea> }>;
  /** Per-script font chains. `latin` and `cjk` accept either a single
   *  string[] (legacy: doubles as text + display) or `{ display?, text? }`
   *  for separate display + text faces. `mono` is always a single chain. */
  fonts?: {
    latin?: string[] | { display?: string[]; text?: string[] };
    cjk?: string[] | { display?: string[]; text?: string[] };
    mono?: string[];
  };
  chart?: { series?: string[] };
  chrome?: { brandMark?: "none" | "top-right" | "bottom-right"; pageNumber?: boolean; footerText?: string; footerLine?: boolean; footerHeight?: number; footerPadding?: number };
  imageGrowWeight?: number;
  sizeScale?: Partial<Record<"xs" | "sm" | "md" | "lg" | "xl" | "2xl", number>>;
  /**
   * Prompt-facing guidance carried by a theme. These fields do not render
   * directly; they teach the agent how to use the visual system for a
   * scenario, audience, and component set.
   */
  guidance?: {
    scenario?: string;
    stylePrinciples?: string[];
    layoutPrinciples?: string[];
    componentGuidance?: Record<string, string>;
    dataVizGuidance?: string[];
    imageGuidance?: string[];
    avoid?: string[];
  };
}

export interface BrandSpec {
  name?: string;
  primary?: string;
  logo?: string;
}

export type LayoutName = "cover" | "title-and-content" | "image-and-text";

export interface SlideSpec {
  id: string;
  layout: LayoutName;
  title?: string;
  subtitle?: string;
  items?: string[];
  image?: string;
  text?: string;
}

export interface SlideV2 {
  id: string;
  title?: string;
  background?: string;
  children: DomNode[];
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface Slideml2SourceDeck {
  slideml2: 2;
  deck: Required<Pick<DeckSpec, "size">> & Omit<DeckSpec, "size">;
  slides: SlideV2[];
}

export interface ChromeSpec {
  brandMark?: "none" | "top-right" | "bottom-right";
  pageNumber?: boolean;
  footerText?: string;
}

export type NodeType = "slide" | "stack" | "grid" | "split" | "spacer" | "divider" | "text" | "bullets" | "image" | "table" | "chart" | "shape" | "component" | "panel" | "card" | "band" | "frame" | "inset";

export type TextContent = string | RichTextRun[];

export interface ReferenceSpec {
  id: string;
  title?: string;
  authors?: string[] | string;
  year?: string | number;
  venue?: string;
  doi?: string;
  url?: string;
  citation?: string;
}

export interface FootnoteSpec {
  id: string;
  text: string;
}

export interface RichTextRun {
  /**
   * RichInline discriminant. Omitted means legacy text run and remains
   * backwards-compatible with older decks.
   */
  kind?: "text" | "math" | "cite" | "footnoteRef" | "icon" | "token";
  text?: string;
  latex?: string;
  refId?: string;
  footnoteId?: string;
  style?: "numeric" | "author-year" | "short";
  src?: string;
  marker?: string;
  alt?: string;
  value?: unknown;
  tone?: "neutral" | "brand" | "positive" | "warning" | "danger" | "info";
  format?: "plain" | "int" | "number" | "decimal" | "percent" | "currency";
  /** Inline marks. `code` swaps to the mono font role; `emphasis` is a
   *  semantic alias for italic; `strikethrough` / `superscript` /
   *  `subscript` map to `<a:rPr strike|baseline>`. `highlight` requires
   *  pairing with the `highlight` field. */
  marks?: Array<"bold" | "italic" | "underline" | "code" | "emphasis" | "strikethrough" | "superscript" | "subscript" | "highlight">;
  color?: string;
  link?: string;
  breakLine?: boolean;
  /** Per-run size override using the theme's semantic dial. Lets a single
   *  paragraph mix a hero number with normal copy without splitting into
   *  multiple text nodes. */
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
  /** Explicit per-run font size in points. Prefer semantic `size` for prose;
   *  code/table components use this when dense monospace listings need a
   *  precise fit. */
  fontSize?: number;
  /** Per-run weight override. Accepts named CSS weights (light/regular/
   *  medium/semibold/bold/extrabold/black) or numeric 100..900. */
  weight?:
    | "thin" | "extralight" | "light"
    | "normal" | "regular" | "book"
    | "medium" | "semibold" | "demibold"
    | "bold" | "extrabold" | "ultrabold" | "heavy"
    | "black" | "super"
    | number;
  italic?: boolean;
  underline?: boolean;
  /** Force this run to draw from a specific font role rather than letting
   *  the parent style decide. */
  font?: "display" | "text" | "mono" | "cjk";
  /** Letter spacing in 1/100 pt; passes through to `<a:rPr spc>`. */
  letterSpacing?: number;
  /** Friendly tracking word: `tight | snug | normal | wide | wider | widest`.
   *  Resolves to letter-spacing in 1/100 pt so agents can reach for "tight"
   *  on a hero or "wide" on an eyebrow without remembering point math. */
  tracking?: "tighter" | "tight" | "snug" | "normal" | "wide" | "wider" | "widest";
  /** Semantic emphasis word resolved by the theme into a (color, weight,
   *  italic, letter-spacing) hint. Lets agents say `emphasis:"key"` to
   *  bold an important phrase without having to pick a hex color or a
   *  numeric weight. Explicit per-run color/weight still win. */
  emphasis?: "lead" | "key" | "strong" | "muted" | "subtle" | "accent" | "danger" | "warning" | "success" | "info";
  /** Background highlight color (theme token or 6-char hex). Either form
   *  applies the highlight; pair with the `highlight` mark only if you
   *  want the theme's default warning tint and no explicit color. */
  highlight?: string;
  /** Baseline shift in per-cent of the run size. -25 = subscript, +30 =
   *  superscript. Set automatically when marks include sub/sup. */
  baseline?: number;
}

export interface RichParagraph {
  text?: string;
  runs?: RichTextRun[];
  align?: "left" | "center" | "right" | "justify";
  indentLevel?: number;
  lineSpacing?: number;
  spaceAfter?: number;
  bullet?: "auto" | "number" | "none";
  style?: string;
  color?: string;
}

export type AnchorPoint =
  | "top-left" | "top-center" | "top-right"
  | "middle-left" | "middle-center" | "middle-right"
  | "bottom-left" | "bottom-center" | "bottom-right";

export interface CellSpec {
  text?: string;
  runs?: RichTextRun[];
  footnoteRefs?: string[];
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  fill?: string;
  color?: string;
  bold?: boolean;
  colspan?: number;
  rowspan?: number;
}

export interface ChartAnnotationSpec {
  at?: number;
  range?: [number, number];
  label: string;
  style?: "callout" | "marker" | "band";
}

export interface DomNode {
  id: string;
  type: NodeType | string;
  children?: DomNode[];
  [property: string]: any;
}

export interface RenderedSlide {
  id: string;
  layout: LayoutName;
  dom: DomNode;
}

export interface RenderedDeck {
  deck: Required<Pick<DeckSpec, "size" | "theme">> & { brand: BrandSpec; themeOverride?: ThemeOverride };
  slides: RenderedSlide[];
}

export type EditOp =
  | { op: "setSlideProp"; slideId: string; prop: string; value: unknown }
  | { op: "setNodeProp"; slideId: string; nodeName: string; prop: string; value: unknown }
  | { op: "insertNode"; slideId: string; parentName: string; node: DomNode; position?: InsertPosition }
  | { op: "deleteNode"; slideId: string; nodeName: string };

export type InsertPosition =
  | "first"
  | "last"
  | { before: string }
  | { after: string }
  | { index: number };

export interface AuditIssue {
  code: string;
  slideId?: string;
  nodeName?: string;
  message: string;
}

export interface AuditReport {
  ok: boolean;
  issues: AuditIssue[];
}

export interface AgentTask {
  requireCoverBrandBackground?: boolean;
  requireBrandLogoBottomRight?: boolean;
  requireBusinessBullets?: boolean;
  requireCompanyOverviewLayout?: {
    slideId: string;
  };
}
