export type SlideSize = "16x9";

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
  component?: Record<string, { fill?: string; line?: string; accent?: string; padding?: number; cornerRadius?: number; elevation?: "flat" | "raised" | "floating" | "outlined" }>;
  tone?: Record<string, { fg: string; bg: string; line: string }>;
  layout?: Partial<{ slideWidthCm: number; slideHeightCm: number; pageMarginX: number; titleTop: number; titleHeight: number; contentTop: number; contentBottom: number; defaultGap: number; columnGap: number; cardPadding: number }>;
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

export interface RichTextRun {
  text: string;
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
