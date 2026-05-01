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

export interface ThemeOverride {
  colors?: Record<string, string>;
  text?: Record<string, { fontSize?: number; weight?: "normal" | "bold"; color?: string; lineHeight?: number; margin?: { l?: number; r?: number; t?: number; b?: number } }>;
  component?: Record<string, { fill?: string; line?: string; accent?: string; padding?: number; radius?: number }>;
  tone?: Record<string, { fg: string; bg: string; line: string }>;
  layout?: Partial<{ slideWidthCm: number; slideHeightCm: number; pageMarginX: number; titleTop: number; titleHeight: number; contentTop: number; contentBottom: number; defaultGap: number; columnGap: number; cardPadding: number }>;
  fonts?: { latin?: string[]; cjk?: string[]; mono?: string[] };
  chart?: { series?: string[] };
  chrome?: { brandMark?: "none" | "top-right" | "bottom-right"; pageNumber?: boolean; footerLine?: boolean; footerHeight?: number; footerPadding?: number };
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
  marks?: Array<"bold" | "italic" | "underline" | "code" | "emphasis">;
  color?: string;
  link?: string;
  breakLine?: boolean;
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
