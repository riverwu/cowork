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

/** A solid fill, gradient fill, or no fill. Gradient stops use 0..100 percent
 *  along the gradient axis; angle is in degrees clockwise from the 12 o'clock
 *  position (0=top→bottom, 90=left→right) for linear, ignored for radial. */
export interface GradientStop {
  position: number;
  color: HexColor;
  alpha?: number;
}
export type FillSpec =
  | { type: "solid"; color: HexColor; alpha?: number }
  | {
      type: "gradient";
      kind: "linear" | "radial";
      angle?: number;
      stops: GradientStop[];
    }
  | { type: "none" };

export interface LineSpec {
  color: HexColor;
  /** Line width in EMU. */
  width: number;
  dash?: "solid" | "dash" | "dashDot" | "dot";
  compound?: "single" | "double" | "thickThin" | "thinThick" | "triple";
  alpha?: number;
  headEnd?: LineEndSpec;
  tailEnd?: LineEndSpec;
}

export interface LineEndSpec {
  type?: "none" | "triangle" | "stealth" | "diamond" | "oval" | "arrow";
  width?: "sm" | "med" | "lg";
  length?: "sm" | "med" | "lg";
}

/**
 * One run of text inside a paragraph. Bold/italic/etc. are flat — no
 * nesting. SlideML's `markdown-inline` parser splits markdown into runs
 * before this layer.
 */
export interface TextRun {
  text: string;
  /** Optional native Office math payload. When present, the text emitter
   *  writes an `<a14:m><m:oMathPara>…</m:oMathPara></a14:m>` run instead of
   *  plain DrawingML text. `text` remains a fallback/measurement label. */
  mathOmml?: string;
  mathLatex?: string;
  bold?: boolean;
  italic?: boolean;
  /** Font size in HALF-POINTS (PowerPoint convention: `<a:rPr sz="2400">` = 24pt). */
  sizeHalfPt?: number;
  color?: HexColor;
  /** Latin font face. SlideML resolves a multi-family stack to one face
   *  before reaching the emitter — OOXML's `typeface` attr takes one name
   *  for each script family. */
  fontFace?: string;
  /** East Asian font face. When omitted and `cjk` is true, the emitter falls
   *  back to `fontFace` for backward compatibility. */
  eastAsianFontFace?: string;
  /** Complex-script font face. When omitted and `mono` is true, the emitter
   *  falls back to `fontFace`. */
  complexScriptFontFace?: string;
  /** Mark this run as the East-Asian (`ea`) typeface as well as latin. Set
   *  when the text contains CJK so PowerPoint applies the CJK font. */
  cjk?: boolean;
  /** Inline mono code — uses the configured monospace font. */
  mono?: boolean;
  /** Underline. Auto-applied when `hyperlink` is set; explicit `false` opts out. */
  underline?: boolean;
  /** Strikethrough. Emits `<a:rPr strike="sngStrike">`. */
  strike?: boolean;
  /** Baseline shift in per-cent of the run's font size. Negative = subscript,
   *  positive = superscript. Typical: -25 for sub, +30 for sup. Maps to
   *  `<a:rPr baseline="N">` where N is per-mille (the spec's units). We
   *  accept percent and the emitter scales to per-mille. */
  baseline?: number;
  /** Letter spacing in 1/100 pt. Negative tightens, positive opens; usually
   *  -50..+200. Maps to `<a:rPr spc="N">`. */
  letterSpacing?: number;
  /** Highlight (background) color. Maps to `<a:highlight>` inside `<a:rPr>`. */
  highlight?: HexColor;
  /** Hyperlink target. HTTPS URL → external link. `#slideN` / `slide:N`
   *  creates an internal slide jump when the package emitter can resolve it. */
  hyperlink?: string;
  /** End the paragraph after this run (newline within the same shape). */
  breakLine?: boolean;
}

export interface Paragraph {
  runs: TextRun[];
  /** Bullet rendering. Default = no bullet.
   *  - `{ auto: true }` — layout-defined unicode bullet (•).
   *  - `{ number: true }` — auto-numbered (1., 2., ...).
   *  - `{ char, color?, sizePct?, font? }` — explicit glyph bullet, used by
   *    the bullets node's `marker` field to render shape-style markers
   *    (●, ■, ▶, ◆, →, ✓, ★, –, ›, ○) as native OOXML bullets. The
   *    glyph is colored via `<a:buClr>` and sized via `<a:buSzPct>` — both
   *    independent of the run color/size, so an agent can paint a bold
   *    accent dot in front of plain body text. `font` lets a non-Latin
   *    glyph (e.g. Wingdings) be addressed by typeface. */
  bullet?:
    | { auto: true }
    | { number: true }
    | { char: string; color?: HexColor; sizePct?: number; font?: string };
  align?: "left" | "center" | "right" | "justify";
  /** Indent level (0-based). Bullets and indent both use this. */
  indentLevel?: number;
  /** Explicit paragraph left margin in EMU. Used for stable bullet hanging indents. */
  marginLeft?: number;
  /** Explicit paragraph hanging indent in EMU. Negative value places marker left of text. */
  hanging?: number;
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
  /** Text wrapping policy. Defaults to "square"; chips/badges can use "none". */
  wrap?: "square" | "none";
  /** Optional shape fill behind the text. */
  fill?: FillSpec;
  /** Optional border around the text box. */
  line?: LineSpec;
  /** When set, the text shape's geometry switches from `rect` to
   *  `roundRect` with this corner radius (fraction of the shorter side,
   *  0..0.5). Lets a single TextShape serve as background + border +
   *  text container — agents resizing the shape in PowerPoint move all
   *  three together, instead of leaving the colored backing behind. */
  cornerRadius?: number;
  /** Auto-fit policy for the text body.
   *  - "shrink" → emit `<a:normAutofit/>` with a moderate fontScale and
   *    lnSpcReduction cap so renderers (esp. LibreOffice) don't shrink
   *    text to unreadable. Right call for body slots with a soft maxChars
   *    cap that may still spill in edge-case content.
   *  - "resize" → emit `<a:spAutoFit/>` so the shape grows to fit content.
   *    Avoid in laid-out slides — it breaks neighbor positioning.
   *  - undefined → no autofit (text may overflow / be clipped). */
  autoFit?: "shrink" | "resize";
}

export type ShapePreset =
  | "rect"
  | "roundRect"
  | "ellipse"
  | "line"
  // Polygon presets — added in Batch C. Names map to OOXML `prstGeom`
  // entries one-to-one; no compound geometry, no auto-shape adjustments.
  | "triangle"
  | "rightTriangle"
  | "pentagon"
  | "diamond"
  | "hexagon"
  | "octagon"
  | "plus"
  | "trapezoid"
  | "leftBracket"
  | "rightBracket"
  | "leftBrace"
  | "rightBrace"
  | "arrow-right"
  | "arrow-left"
  | "arrow-up"
  | "arrow-down"
  | "leftRightArrow"
  | "upDownArrow"
  | "bentArrow"
  | "elbowConnector"
  | "orthogonalConnector"
  | "curvedConnector"
  | "straightConnector"
  | "callout"
  | "chevron"
  | "star-5"
  | "star-8"
  | "parallelogram"
  | "flowChartProcess"
  | "flowChartDecision"
  | "flowChartData"
  | "flowChartTerminator"
  | "flowChartDocument"
  | "cylinder"
  | "cube"
  | "gear6"
  | "heart"
  | "lightningBolt"
  | "cloud";

export interface PresetShape {
  type: "shape";
  id: number;
  name?: string;
  preset: ShapePreset;
  xfrm: Xfrm;
  fill?: FillSpec;
  line?: LineSpec;
  /** Optional rich text embedded inside the auto-shape. */
  paragraphs?: Paragraph[];
  /** Internal padding for embedded text, in EMU. */
  margin?: { l?: number; t?: number; r?: number; b?: number };
  /** Vertical alignment for embedded text. */
  valign?: "top" | "middle" | "bottom";
  /** Text wrapping policy for embedded text. */
  wrap?: "square" | "none";
  /** Auto-fit policy for embedded text. */
  autoFit?: "shrink" | "resize";
  /** For `roundRect`: corner radius as a fraction of the shorter side, 0..1. */
  cornerRadius?: number;
  /** Optional native PowerPoint connector bindings. When present on a
   * connector preset, the slide emitter writes `<p:cxnSp>` with `stCxn` /
   * `endCxn` references to the target shapes so connectors can follow moved
   * nodes in PowerPoint. Names are resolved slide-wide just before XML emit. */
  connection?: {
    startShapeName?: string;
    endShapeName?: string;
    startShapeId?: number;
    endShapeId?: number;
    startIdx?: number;
    endIdx?: number;
  };
  /**
   * Drop shadow under the shape. Maps to `<a:outerShdw>` inside
   * `<a:effectLst>`. `blur`, `dx`, `dy` are in EMU. Used by elevation
   * tokens on cards / panels — agents typically pass elevation:"raised"
   * rather than constructing the shadow object directly.
   */
  shadow?: { color: HexColor; alpha?: number; blur?: number; dx?: number; dy?: number };
}

export interface GroupShape {
  type: "group";
  id: number;
  name?: string;
  xfrm: Xfrm;
  children: ShapeList;
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
  /**
   * How the image fits its target rectangle:
   *   "cover" (default) — scale to fill, cropping the longer dimension via
   *                       OOXML `<a:srcRect>`. Preserves aspect ratio.
   *   "contain"        — scale to fit inside, letterboxing with the
   *                       canvas color. Preserves aspect ratio.
   *   "fill"           — stretch to fill (legacy behaviour). Distorts.
   *
   * `cover` requires source pixel dimensions to compute the crop; the
   * package emitter probes them at compile time and stashes them on
   * `sourceDimensions`. When dimensions are unknown, falls back to "fill".
   */
  fit?: "cover" | "contain" | "fill";
  /**
   * Pixel dimensions of the source image — populated by the package
   * emitter from the asset pipeline's probe. Used to compute srcRect for
   * `fit: "cover"` and letterbox math for `fit: "contain"`.
   */
  sourceDimensions?: { width: number; height: number };
  /**
   * Optional clip shape — turns the image's bounding box into a non-
   * rectangular silhouette. "circle" maps to OOXML `prstGeom prst="ellipse"`,
   * "rounded" maps to roundRect with cornerRadius, "square" is the default
   * (no clipping). Other values are ignored.
   */
  clip?: "square" | "rounded" | "circle";
  /** Corner radius for the "rounded" clip (0..0.5 of the shorter side). */
  cornerRadius?: number;
  /** Optional border drawn around the clipped image. */
  border?: LineSpec;
  /** Translucent colored overlay drawn on top of the image. */
  overlay?: { color: HexColor; alpha?: number };
  /** Overall image opacity, 0..1. */
  opacity?: number;
  /**
   * Inset crop (fractions 0..1 of width/height). Maps to OOXML
   * `<a:srcRect l="..." r="..." t="..." b="..."/>` inside the blipFill.
   * Handy when the image's hot region isn't centred in the source file.
   */
  crop?: { left?: number; right?: number; top?: number; bottom?: number };
  /**
   * Soft / feathered edge (fade-into-canvas). Value is a fraction of the
   * shorter side (0..0.5). OOXML `<a:softEdge rad="EMU"/>` inside the
   * picture's `<a:effectLst>`.
   */
  softEdge?: number;
  /**
   * Drop shadow underneath the image. Maps to `<a:outerShdw>` inside
   * `<a:effectLst>`. `blur` and offsets are in EMU.
   */
  shadow?: { color: HexColor; alpha?: number; blur?: number; dx?: number; dy?: number };
  /** Convert the image to grayscale. OOXML `<a:grayscl/>` inside the blip. */
  grayscale?: boolean;
  /**
   * Brightness/luminance shift in [-1, 1]. Maps to `<a:lum bright="N"/>`
   * (PowerPoint expects the value as a per-mille integer in the OOXML).
   */
  brightness?: number;
  /** Gaussian blur on the image itself (EMU radius). `<a:blur rad="N"/>`. */
  blur?: number;
  /**
   * Two-tone recolour. Maps to `<a:duotone>` with the two srgbClr stops.
   * Great for editorial / magazine treatments — keeps photos visually
   * coherent with the brand palette.
   */
  duotone?: { dark: HexColor; light: HexColor };
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
  | "doughnut"     // single-series doughnut
  | "combo"        // mixed bar + line (per-series `type` picks)
  | "scatter"      // x/y scatter (per-series `points: {x,y}[]`)
  | "waterfall";   // styled cumulative bar (positive/negative/total colors)

export type ChartNumberFormat =
  | "int"        // 1234   (formatCode "0")
  | "decimal"    // 1234.5 (formatCode "0.0")
  | "percent"    // 12%    (formatCode "0%")
  | "wanyuan"    // 1.23 万元 (Chinese 10K-yuan)
  | "yi";        // 1.23 亿  (Chinese 100M)

export interface ChartAxisSpec {
  title?: string;
  show?: boolean;
  /** Tick-label color. Renderer supplies a theme-aware default. */
  color?: HexColor;
  /** Axis title color; falls back to color. */
  titleColor?: HexColor;
  min?: number;
  max?: number;
  majorUnit?: number;
  minorUnit?: number;
  numberFormat?: ChartNumberFormat | string;
  gridlines?: boolean | { major?: boolean; minor?: boolean; color?: HexColor; width?: number; dash?: LineSpec["dash"] };
  tickLabelRotation?: number;
  tickLabelPosition?: "nextTo" | "low" | "high" | "none";
  majorTickMark?: "none" | "in" | "out" | "cross";
  minorTickMark?: "none" | "in" | "out" | "cross";
}

export interface ChartLegendSpec {
  show?: boolean;
  position?: "bottom" | "top" | "left" | "right";
  overlay?: boolean;
}

export interface ChartPlotAreaSpec {
  /** Manual layout factors, 0..1, relative to the chart frame; cm-like values are converted by the emitter. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export interface ChartMarkerSpec {
  symbol?: "none" | "circle" | "dash" | "diamond" | "dot" | "plus" | "square" | "star" | "triangle" | "x";
  size?: number;
  fill?: HexColor;
  line?: HexColor;
}

export interface ChartSeries {
  name: string;
  /**
   * Numeric values, one per category label. `null` is only meaningful
   * for waterfall charts, where it marks a "total" bar (the running
   * total of every prior delta). Other chart types treat null as 0.
   */
  values: Array<number | null>;
  /**
   * Per-series chart type override — only consumed when the parent
   * `chartType` is "combo". Default "bar". Any other parent chartType
   * ignores this field.
   */
  type?: "bar" | "line";
  /** Draw this series against the primary left Y axis or secondary right Y axis. */
  axis?: "primary" | "secondary";
  /**
   * Native chart trend line. Supported by line/bar/scatter OOXML series.
   * Boolean true means a linear trend line.
   */
  trendLine?: true | { type?: "linear" | "exp" | "log" | "poly"; order?: number; label?: string };
  /**
   * Native symmetric error bars. This intentionally starts with the simple
   * OOXML forms rather than custom per-point ranges.
   */
  errorBars?: { type?: "fixed" | "percent" | "stdDev" | "stdErr"; value?: number; direction?: "x" | "y" | "both" };
  /**
   * Per-series xy data — only consumed when parent `chartType` is
   * "scatter". When present, `values` is ignored. Each point is a
   * literal {x,y} pair; the emitter writes both into the OOXML.
   */
  points?: Array<{ x: number; y: number }>;
  /** Per-series visual style. */
  color?: HexColor;
  lineWidth?: number;
  lineDash?: LineSpec["dash"];
  marker?: ChartMarkerSpec;
  smooth?: boolean;
  dataLabels?: ChartDataLabels;
}

export interface ChartDataLabels {
  show?: boolean;
  position?: "bestFit" | "center" | "insideEnd" | "insideBase" | "outsideEnd";
  /** Label text color. Renderer supplies a theme-aware default. */
  color?: HexColor;
  showValue?: boolean;
  showCategoryName?: boolean;
  showSeriesName?: boolean;
  showPercent?: boolean;
  showLegendKey?: boolean;
  showLeaderLines?: boolean;
  /** Hide pie/doughnut labels for slices below this share. 0.03 = 3%. */
  minPercent?: number;
}

/**
 * Inline annotation on a chart — a callout, marker, or band that
 * highlights a specific category or range. Annotations are rendered as
 * overlay shapes by the layout that owns the chart (not by the chart
 * emitter itself), so they cooperate with whatever bounding rectangle
 * the layout chose for the chart.
 *
 * Positioning is approximate — the layout computes proportional x
 * based on category index ÷ labels.length. Good enough for "look at
 * Q3" callouts; not a substitute for native chart data labels.
 */
export interface ChartAnnotation {
  /** Category index this annotation refers to (0-based). */
  at?: number;
  /** Inclusive [start, end] category range — used for "band" style. */
  range?: [number, number];
  /** Label text (supports SlideML inline markdown). */
  label: string;
  /**
   * Visual style:
   *   "callout" (default) — small chip with an arrow pointing to the bar
   *   "marker"            — bold dot + label, rendered at the data point
   *   "band"              — translucent vertical band spanning `range`
   */
  style?: "callout" | "marker" | "band";
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
  yFormat?: ChartNumberFormat | string;
  xAxis?: ChartAxisSpec;
  yAxis?: ChartAxisSpec;
  secondaryYAxis?: ChartAxisSpec;
  legend?: ChartLegendSpec;
  plotArea?: ChartPlotAreaSpec;
  /** Optional title rendered above the chart. */
  title?: string;
  /** Theme-aware default text color for native chart text. */
  textColor?: HexColor;
  /** Theme-aware axis tick-label fallback color. */
  axisTextColor?: HexColor;
  /** Theme-aware data-label fallback color. */
  dataLabelColor?: HexColor;
  /** Theme-aware chart-title color. */
  titleColor?: HexColor;
  /** Theme-aware legend color. */
  legendTextColor?: HexColor;
  /** Color cycle in hex (no `#`). The renderer cycles series through these. */
  colors?: HexColor[];
  /** Show the legend. Default true when series.length > 1. */
  showLegend?: boolean;
  /** Show data values on each point. Default false. */
  showValues?: boolean;
  /** Bar-like chart orientation. `horizontal` renders OOXML barDir="bar"; default vertical. */
  orientation?: "vertical" | "horizontal";
  /** Data-label controls. Supersedes showValues when provided. */
  dataLabels?: ChartDataLabels;
  /** Optional color for positive bar points. Defaults to series color. */
  positiveColor?: HexColor;
  /** Optional color for negative bar points. Defaults to the theme danger color. */
  negativeColor?: HexColor;
  /**
   * Annotations attached to this chart. Carried on the shape so layouts
   * can render them as overlay text shapes layered over the chart frame.
   * The chart emitter (chart.ts) IGNORES this field — it only affects
   * the layout's overlay pass.
   */
  annotations?: ChartAnnotation[];
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
  /** Optional cell-level border override. */
  border?: TableBorderSpec | Partial<Record<TableBorderSide, TableBorderLineSpec | "none">>;
  /** Internal padding in EMU. */
  padding?: Partial<Record<"l" | "t" | "r" | "b", number>>;
  /** Text rotation in OOXML bodyPr units. */
  textRotation?: 0 | 90 | 270 | "vertical";
  /** Vertical alignment within the cell. */
  valign?: "top" | "middle" | "bottom";
  /** Horizontal alignment. */
  align?: "left" | "center" | "right";
  /** Number of grid columns covered by this origin cell. */
  colspan?: number;
  /** Number of table rows covered by this origin cell. */
  rowspan?: number;
  /** Covered cell placeholder for a horizontal merge. */
  hMerge?: boolean;
  /** Covered cell placeholder for a vertical merge. */
  vMerge?: boolean;
}

export type TableBorderSide = "left" | "right" | "top" | "bottom";
export interface TableBorderLineSpec {
  color?: HexColor;
  width?: number;
  dash?: LineSpec["dash"];
  alpha?: number;
}
export interface TableBorderSpec extends Partial<Record<TableBorderSide, TableBorderLineSpec | "none">> {
  color?: HexColor;
  width?: number;
  dash?: LineSpec["dash"];
  alpha?: number;
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
  /** Native table style GUID. */
  tableStyleId?: string;
  bandRows?: boolean;
  bandCols?: boolean;
  firstCol?: boolean;
  lastCol?: boolean;
  lastRow?: boolean;
  /** Default cell padding in EMU. */
  cellPadding?: Partial<Record<"l" | "t" | "r" | "b", number>>;
  /** Default table borders, optionally per side. */
  borders?: TableBorderSpec | Partial<Record<TableBorderSide, TableBorderLineSpec | "none">>;
  /** Hairline color between cells. */
  borderColor?: HexColor;
  /** Hairline width in EMU. */
  borderWidth?: number;
  borderDash?: LineSpec["dash"];
}

export type Shape = TextShape | PresetShape | ImageShape | ChartShape | TableShape | GroupShape;
export type ShapeList = Shape[];

/** Per-slide background — set by chrome compositor in Stage 3. */
export type SlideBackground =
  | { type: "solid"; color: HexColor }
  | { type: "image"; src: string }
  | {
      type: "gradient";
      kind: "linear" | "radial";
      angle?: number;
      stops: GradientStop[];
    };

export interface SlideAst {
  shapes: ShapeList;
  background?: SlideBackground;
  transition?: { type?: "none" | "fade" | "push" | "wipe" | "split" | "cover" | "uncover"; durationMs?: number; direction?: "left" | "right" | "up" | "down" };
  layout?: string;
  /** Speaker notes (markdown-inline). Renderer emits notesSlide if present. */
  notes?: string;
}

export interface DeckAst {
  size: "16x9" | "16x10" | "4x3" | "wide";
  /** BCP-47 language tag. */
  language?: string;
  title?: string;
  author?: string;
  master?: {
    layout?: string;
    placeholders?: Record<string, { x: number; y: number; w: number; h: number; type?: "title" | "body" | "chart" | "table" | "image" | "footer" }>;
  };
  slides: SlideAst[];
}
