/**
 * ShapeList — the IR the emitter consumes.
 *
 * Layouts (Stage 3) produce `Shape[]` per slide using helpers that take
 * cm/in/pt and convert to EMU. By the time anything reaches the emitter,
 * every number is EMU. Tools that read `Shape` must not re-interpret units.
 */

/** EMU coordinates and sizes. Always integer EMU. */
export interface Xfrm {
  x: number;
  y: number;
  cx: number;
  cy: number;
  /** Rotation in OOXML units: 60000 per degree (so 90° = 5_400_000). */
  rot?: number;
  flipH?: boolean;
  flipV?: boolean;
}

/** Hex color, 6 chars, no `#` prefix. Validated at emit time. */
export type HexColor = string;

/** A solid fill or no fill. We deliberately don't support gradients here —
 *  PptxGenJS doesn't either; gradients ship as background images instead. */
export type FillSpec =
  | { type: "solid"; color: HexColor; alpha?: number }
  | { type: "none" };

export interface LineSpec {
  color: HexColor;
  /** Line width in EMU. */
  width: number;
  dash?: "solid" | "dash" | "dashDot" | "dot";
}

/**
 * One run of text inside a paragraph. Bold/italic/etc. are flat — no
 * nesting. SlideML's `markdown-inline` parser splits markdown into runs
 * before this layer.
 */
export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  /** Font size in HALF-POINTS (PowerPoint convention: `<a:rPr sz="2400">` = 24pt). */
  sizeHalfPt?: number;
  color?: HexColor;
  /** Single font face. SlideML resolves a multi-family stack to one face
   *  before reaching the emitter — OOXML's `typeface` attr takes one name. */
  fontFace?: string;
  /** Mark this run as the East-Asian (`ea`) typeface as well as latin. Set
   *  when the text contains CJK so PowerPoint applies the CJK font. */
  cjk?: boolean;
  /** Inline mono code — uses the configured monospace font. */
  mono?: boolean;
  /** Underline. Auto-applied when `hyperlink` is set; explicit `false` opts out. */
  underline?: boolean;
  /** Hyperlink target. HTTPS URL → external link. The slide emitter
   *  registers a slide-level rel of type `/hyperlink` with
   *  `TargetMode="External"` and stamps the rId onto `<a:hlinkClick>`. */
  hyperlink?: string;
  /** End the paragraph after this run (newline within the same shape). */
  breakLine?: boolean;
}

export interface Paragraph {
  runs: TextRun[];
  /** Bullet rendering. Default = no bullet. `{ char: "•" }` would produce
   *  a unicode bullet — DON'T; SlideML core uses `{ auto: true }` for
   *  layout-defined bullets. */
  bullet?: { auto: true } | { number: true };
  align?: "left" | "center" | "right";
  /** Indent level (0-based). Bullets and indent both use this. */
  indentLevel?: number;
  /** Line spacing in HALF-POINTS, or undefined for layout default. */
  lineSpacingHalfPt?: number;
  /** Space-after in HALF-POINTS. */
  spaceAfterHalfPt?: number;
}

export interface TextShape {
  type: "text";
  id: number;
  name?: string;
  xfrm: Xfrm;
  paragraphs: Paragraph[];
  /** Internal padding inside the text box, in EMU. Default 91440 (~0.1in). */
  margin?: { l?: number; t?: number; r?: number; b?: number };
  /** Vertical alignment of text within the box. */
  valign?: "top" | "middle" | "bottom";
  /** Optional shape fill behind the text. */
  fill?: FillSpec;
  /** Optional border around the text box. */
  line?: LineSpec;
}

export type ShapePreset = "rect" | "roundRect" | "ellipse" | "line";

export interface PresetShape {
  type: "shape";
  id: number;
  name?: string;
  preset: ShapePreset;
  xfrm: Xfrm;
  fill?: FillSpec;
  line?: LineSpec;
  /** For `roundRect`: corner radius as a fraction of the shorter side, 0..1. */
  cornerRadius?: number;
}

export interface ImageShape {
  type: "image";
  id: number;
  name?: string;
  xfrm: Xfrm;
  /** Source: either a local file path, a data URL, or an HTTP(S) URL.
   *  The package emitter resolves all of these to bytes + an extension. */
  src: string;
  altText?: string;
}

/**
 * Chart shape — rendered as a native OOXML `<p:graphicFrame>` referencing
 * a `ppt/charts/chart{N}.xml` part. The chart emitter produces the chart
 * XML; the slide emits the graphic frame; the package wires the
 * content-type overrides and rels.
 */
export type ChartType =
  | "bar"          // clustered column
  | "stacked-bar"  // stacked column (uses grouping="stacked")
  | "line"         // line chart with markers
  | "area"         // filled area chart
  | "pie"          // single-series pie
  | "doughnut";    // single-series doughnut

export type ChartNumberFormat =
  | "int"        // 1234   (formatCode "0")
  | "decimal"    // 1234.5 (formatCode "0.0")
  | "percent"    // 12%    (formatCode "0%")
  | "wanyuan"    // 1.23 万元 (Chinese 10K-yuan)
  | "yi";        // 1.23 亿  (Chinese 100M)

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartShape {
  type: "chart";
  id: number;
  name?: string;
  xfrm: Xfrm;
  chartType: ChartType;
  labels: string[];
  series: ChartSeries[];
  /** Y-axis number format. Default `int`. */
  yFormat?: ChartNumberFormat;
  /** Optional title rendered above the chart. */
  title?: string;
  /** Color cycle in hex (no `#`). The renderer cycles series through these. */
  colors?: HexColor[];
  /** Show the legend. Default true when series.length > 1. */
  showLegend?: boolean;
  /** Show data values on each point. Default false. */
  showValues?: boolean;
}

/**
 * Table shape — rendered as a native OOXML `<p:graphicFrame>` containing
 * `<a:tbl>`. Supports a header row, plain body cells, and per-column widths.
 *
 * For a typed business deck this is enough: pricing tables, comparison
 * grids, KPI summary tables. Cell-level rich text uses the same `TextRun`
 * shape as text shapes.
 */
export interface TableCell {
  /** Cell content as one or more runs. */
  runs: TextRun[];
  /** Optional cell fill — used for header row or accent rows. */
  fill?: FillSpec;
  /** Vertical alignment within the cell. */
  valign?: "top" | "middle" | "bottom";
  /** Horizontal alignment. */
  align?: "left" | "center" | "right";
}

export interface TableShape {
  type: "table";
  id: number;
  name?: string;
  xfrm: Xfrm;
  /** Column widths in EMU. Sum should equal `xfrm.cx`. */
  colWidths: number[];
  /** Row heights in EMU. */
  rowHeights: number[];
  /** Rows × cols of cells. `rows[r][c]`. */
  cells: TableCell[][];
  /** If true, the first row is rendered as a header (different fill / bold). */
  firstRowHeader?: boolean;
  /** Hairline color between cells. */
  borderColor?: HexColor;
  /** Hairline width in EMU. */
  borderWidth?: number;
}

export type Shape = TextShape | PresetShape | ImageShape | ChartShape | TableShape;
export type ShapeList = Shape[];

/** Per-slide background — set by chrome compositor in Stage 3. */
export type SlideBackground =
  | { type: "solid"; color: HexColor }
  | { type: "image"; src: string };

export interface SlideAst {
  shapes: ShapeList;
  background?: SlideBackground;
  /** Speaker notes (markdown-inline). Renderer emits notesSlide if present. */
  notes?: string;
}

export interface DeckAst {
  size: "16x9" | "16x10" | "4x3" | "wide";
  /** BCP-47 language tag. */
  language?: string;
  title?: string;
  author?: string;
  slides: SlideAst[];
}
