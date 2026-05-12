/**
 * Native OOXML chart emitter.
 *
 * Vendored carve-out: structure mirrors PptxGenJS `gen-charts.ts` for the
 * three chart types we support (bar, line, pie). Stripped to the slot the
 * SlideML `chart-spec` exposes; adds the `wanyuan` / `yi` Y-axis number
 * formats that PptxGenJS doesn't have.
 *
 * For each chart shape the package emitter writes:
 *   - `ppt/charts/chart{N}.xml`           — this file's output
 *   - `ppt/charts/_rels/chart{N}.xml.rels` — empty (no embedded spreadsheet)
 *   - one `[Content_Types].xml` override
 *   - one slide rel pointing at `../charts/chart{N}.xml`
 *   - one `<p:graphicFrame>` shape on the slide
 */

import { assertHex } from "./xml.js";
import type { ChartAxisSpec, ChartDataLabels, ChartMarkerSpec, ChartNumberFormat, ChartShape, HexColor, LineSpec } from "./types.js";

const NS_CHART = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const NS_DRAWING = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const DEFAULT_COLORS: HexColor[] = [
  "3CC2FF", "1078B5", "FF9F45", "8DA8C2", "F5F9FC",
  "5A8FB5", "29B5A8", "B5829A", "8C7DCC", "BFB143",
];

/**
 * Build the `chart{N}.xml` body for a chart shape.
 */
export function chartXml(shape: ChartShape): string {
  const colors = (shape.colors && shape.colors.length > 0 ? shape.colors : DEFAULT_COLORS).map((c) => {
    assertHex(c, "ChartShape.colors[]");
    return c.toUpperCase();
  });
  if (shape.positiveColor) assertHex(shape.positiveColor, "ChartShape.positiveColor");
  if (shape.negativeColor) assertHex(shape.negativeColor, "ChartShape.negativeColor");
  validateChartStyle(shape);

  const numFmt = numberFormatCode(shape.yAxis?.numberFormat ?? shape.yFormat ?? "int");
  // Stable axis IDs.
  const catAxId = 100000001;
  const valAxId = 100000002;
  const secondaryValAxId = 100000003;
  const hasSecondaryAxis = chartSupportsSecondaryAxis(shape) && shape.series.some((series) => series.axis === "secondary");

  const titleXml = shape.title
    ? `<c:title>` +
      `<c:tx><c:rich>` +
      `<a:bodyPr rot="0" spcFirstLastPara="1" vertOverflow="ellipsis" wrap="square" anchor="ctr" anchorCtr="1"/>` +
      `<a:lstStyle/>` +
      `<a:p><a:pPr algn="ctr"><a:defRPr sz="1400" b="1"/></a:pPr>` +
      `<a:r><a:rPr lang="en-US" sz="1400" b="1"/><a:t>${xmlEscapeText(shape.title)}</a:t></a:r></a:p>` +
      `</c:rich></c:tx>` +
      `<c:overlay val="0"/></c:title>`
    : "";

  const showLegend = shape.legend ? shape.legend.show !== false : (shape.showLegend ?? shape.series.length > 1);
  const legendXml = legendXmlOf(shape, showLegend);

  let plotInner = "";
  if (shape.chartType === "bar" || shape.chartType === "stacked-bar") {
    plotInner = barChartXml(shape, colors, catAxId, valAxId, shape.chartType === "stacked-bar", hasSecondaryAxis ? secondaryValAxId : undefined);
  } else if (shape.chartType === "line") {
    plotInner = lineChartXml(shape, colors, catAxId, valAxId, hasSecondaryAxis ? secondaryValAxId : undefined);
  } else if (shape.chartType === "area") {
    plotInner = areaChartXml(shape, colors, catAxId, valAxId, hasSecondaryAxis ? secondaryValAxId : undefined);
  } else if (shape.chartType === "pie") {
    plotInner = pieChartXml(shape, colors, /* doughnut */ false);
  } else if (shape.chartType === "doughnut") {
    plotInner = pieChartXml(shape, colors, /* doughnut */ true);
  } else if (shape.chartType === "combo") {
    plotInner = comboChartXml(shape, colors, catAxId, valAxId, hasSecondaryAxis ? secondaryValAxId : undefined);
  } else if (shape.chartType === "scatter") {
    plotInner = scatterChartXml(shape, colors, catAxId, valAxId);
  } else if (shape.chartType === "waterfall") {
    plotInner = waterfallChartXml(shape, colors, catAxId, valAxId);
  }

  const axisLessTypes: ChartShape["chartType"][] = ["pie", "doughnut"];
  const isScatter = shape.chartType === "scatter";
  const axesXml = axisLessTypes.includes(shape.chartType)
    ? ""
    : isScatter
      ? scatterAxesXml(catAxId, valAxId, shape.xAxis, shape.yAxis, numFmt)
      : axesXmlOf(catAxId, valAxId, shape.xAxis, shape.yAxis, numFmt, hasSecondaryAxis ? secondaryValAxId : undefined, shape.secondaryYAxis, isHorizontalBarChart(shape) ? "horizontal" : "vertical");

  // PowerPoint requires three chartSpace-level elements (date1904, lang,
  // roundedCorners) to validate strictly — without them PowerPoint shows
  // a "found a problem with content" / corruption warning even though
  // LibreOffice and python-pptx accept the file. LibreOffice writes them
  // on every chart, Excel does too. Reproduced via LO round-trip diff.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_DRAWING}" xmlns:r="${NS_REL}">
<c:date1904 val="0"/>
<c:lang val="en-US"/>
<c:roundedCorners val="0"/>
<c:chart>
${titleXml}
<c:autoTitleDeleted val="${shape.title ? 0 : 1}"/>
<c:plotArea>
${plotAreaLayoutXml(shape)}
${plotInner}
${axesXml}
</c:plotArea>
${legendXml}
<c:plotVisOnly val="1"/>
<c:dispBlanksAs val="gap"/>
</c:chart>
</c:chartSpace>`;
}

function chartSupportsSecondaryAxis(shape: ChartShape): boolean {
  return shape.chartType === "bar" || shape.chartType === "stacked-bar" || shape.chartType === "line" || shape.chartType === "area" || shape.chartType === "combo";
}

function validateChartStyle(shape: ChartShape): void {
  for (const [idx, series] of shape.series.entries()) {
    if (series.color) assertHex(series.color, `ChartSeries[${idx}].color`);
    if (series.marker?.fill) assertHex(series.marker.fill, `ChartSeries[${idx}].marker.fill`);
    if (series.marker?.line) assertHex(series.marker.line, `ChartSeries[${idx}].marker.line`);
  }
  for (const [label, axis] of [["xAxis", shape.xAxis], ["yAxis", shape.yAxis], ["secondaryYAxis", shape.secondaryYAxis]] as const) {
    const grid = axis?.gridlines;
    if (grid && typeof grid === "object" && grid.color) assertHex(grid.color, `ChartShape.${label}.gridlines.color`);
  }
}

function legendXmlOf(shape: ChartShape, showLegend: boolean): string {
  if (!showLegend) return "";
  const position = shape.legend?.position ?? "bottom";
  const pos = position === "top" ? "t" : position === "left" ? "l" : position === "right" ? "r" : "b";
  const overlay = shape.legend?.overlay ? 1 : 0;
  return `<c:legend><c:legendPos val="${pos}"/><c:overlay val="${overlay}"/></c:legend>`;
}

function plotAreaLayoutXml(shape: ChartShape): string {
  const p = shape.plotArea;
  if (!p) return `<c:layout/>`;
  const parts: string[] = [`<c:layoutTarget val="inner"/>`];
  const x = typeof p.x === "number" ? clampFactor(p.x) : undefined;
  const y = typeof p.y === "number" ? clampFactor(p.y) : undefined;
  const w = typeof p.w === "number" ? clampFactor(p.w, 0.01, x === undefined ? 1 : Math.max(0.01, 1 - x)) : undefined;
  const h = typeof p.h === "number" ? clampFactor(p.h, 0.01, y === undefined ? 1 : Math.max(0.01, 1 - y)) : undefined;
  if (x !== undefined) parts.push(`<c:xMode val="factor"/><c:x val="${x}"/>`);
  if (y !== undefined) parts.push(`<c:yMode val="factor"/><c:y val="${y}"/>`);
  if (w !== undefined) parts.push(`<c:wMode val="factor"/><c:w val="${w}"/>`);
  if (h !== undefined) parts.push(`<c:hMode val="factor"/><c:h val="${h}"/>`);
  return `<c:layout><c:manualLayout>${parts.join("")}</c:manualLayout></c:layout>`;
}

function clampFactor(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

// ---- Bar / Line / Pie chart bodies --------------------------------------

function barChartXml(
  shape: ChartShape,
  colors: HexColor[],
  catAxId: number,
  valAxId: number,
  stacked: boolean,
  secondaryValAxId?: number,
): string {
  const grouping = stacked ? "stacked" : "clustered";
  const overlap = stacked ? `<c:overlap val="100"/>` : "";
  const chartFor = (series: ChartShape["series"], axisId: number) => series.length === 0 ? "" : (
    `<c:barChart>` +
    `<c:barDir val="${isHorizontalBarChart(shape) ? "bar" : "col"}"/>` +
    `<c:grouping val="${grouping}"/>` +
    `<c:varyColors val="0"/>` +
    series.map((s) => seriesXml(s, shape.series.indexOf(s), colors, shape.labels, shape.showValues, false, false, shape)).join("") +
    `<c:gapWidth val="100"/>` +
    overlap +
    `<c:axId val="${catAxId}"/>` +
    `<c:axId val="${axisId}"/>` +
    `</c:barChart>`
  );
  if (!secondaryValAxId) return chartFor(shape.series, valAxId);
  return chartFor(shape.series.filter((series) => series.axis !== "secondary"), valAxId) +
    chartFor(shape.series.filter((series) => series.axis === "secondary"), secondaryValAxId);
}

function areaChartXml(
  shape: ChartShape,
  colors: HexColor[],
  catAxId: number,
  valAxId: number,
  secondaryValAxId?: number,
): string {
  const chartFor = (series: ChartShape["series"], axisId: number) => series.length === 0 ? "" : (
    `<c:areaChart>` +
    `<c:grouping val="standard"/>` +
    `<c:varyColors val="0"/>` +
    series.map((s) => seriesXml(s, shape.series.indexOf(s), colors, shape.labels, shape.showValues, /* isLine */ false, /* isArea */ true, shape)).join("") +
    `<c:axId val="${catAxId}"/>` +
    `<c:axId val="${axisId}"/>` +
    `</c:areaChart>`
  );
  if (!secondaryValAxId) return chartFor(shape.series, valAxId);
  return chartFor(shape.series.filter((series) => series.axis !== "secondary"), valAxId) +
    chartFor(shape.series.filter((series) => series.axis === "secondary"), secondaryValAxId);
}

function lineChartXml(
  shape: ChartShape,
  colors: HexColor[],
  catAxId: number,
  valAxId: number,
  secondaryValAxId?: number,
): string {
  const chartFor = (series: ChartShape["series"], axisId: number) => series.length === 0 ? "" : (
    `<c:lineChart>` +
    `<c:grouping val="standard"/>` +
    `<c:varyColors val="0"/>` +
    series.map((s) => seriesXml(s, shape.series.indexOf(s), colors, shape.labels, shape.showValues, true, false, shape)).join("") +
    `<c:marker val="1"/>` +
    `<c:axId val="${catAxId}"/>` +
    `<c:axId val="${axisId}"/>` +
    `</c:lineChart>`
  );
  if (!secondaryValAxId) return chartFor(shape.series, valAxId);
  return chartFor(shape.series.filter((series) => series.axis !== "secondary"), valAxId) +
    chartFor(shape.series.filter((series) => series.axis === "secondary"), secondaryValAxId);
}

function pieChartXml(shape: ChartShape, colors: HexColor[], doughnut: boolean): string {
  // Pie / doughnut both use the first series only; each label is a slice.
  const series = shape.series[0] ?? { name: "Series", values: [] };
  const elem = doughnut ? "doughnutChart" : "pieChart";
  const holeXml = doughnut ? `<c:holeSize val="50"/>` : "";
  const dataLabelsXml = dataLabelsXmlOf(shape, {
    position: "bestFit",
    showValue: false,
    showCategoryName: true,
    showSeriesName: false,
    showPercent: true,
    showLeaderLines: true,
  });
  return (
    `<c:${elem}>` +
    `<c:varyColors val="1"/>` +
    `<c:ser>` +
    `<c:idx val="0"/>` +
    `<c:order val="0"/>` +
    `<c:tx><c:v>${xmlEscapeText(series.name)}</c:v></c:tx>` +
    shape.labels.map((_, i) =>
      `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/>` +
      `<c:spPr><a:solidFill><a:srgbClr val="${colors[i % colors.length]!}"/></a:solidFill></c:spPr>` +
      `</c:dPt>`,
    ).join("") +
    catRefXml(shape.labels) +
    valRefXml(series.values) +
    `</c:ser>` +
    dataLabelsXml +
    `<c:firstSliceAng val="0"/>` +
    holeXml +
    `</c:${elem}>`
  );
}

function seriesXml(
  s: ChartShape["series"][number],
  idx: number,
  colors: HexColor[],
  labels: string[],
  showValues = false,
  isLine = false,
  isArea = false,
  shape?: ChartShape,
): string {
  const color = (s.color ? s.color.toUpperCase() : colors[idx % colors.length]!) as HexColor;
  const pointColorsXml = !isLine && !isArea ? pointColorsXmlOf(s.values, {
    positiveColor: shape?.positiveColor?.toUpperCase() as HexColor | undefined,
    negativeColor: shape?.negativeColor?.toUpperCase() as HexColor | undefined,
  }) : "";
  const linePart = isLine
    ? `<c:spPr>${lineStyleXml(color, s.lineWidth, s.lineDash)}</c:spPr>` +
      markerXml(s.marker, color)
    : isArea
      ? `<c:spPr><a:solidFill><a:srgbClr val="${color}"><a:alpha val="60000"/></a:srgbClr></a:solidFill>` +
        lineStyleXml(color, s.lineWidth, s.lineDash) + `</c:spPr>`
      : `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr>`;

  const dLbls = dataLabelsXmlOf({ showValues, dataLabels: s.dataLabels ?? shape?.dataLabels }, {
    position: undefined,
    showValue: true,
    showCategoryName: false,
    showSeriesName: false,
    showPercent: false,
  });

  return (
    `<c:ser>` +
    `<c:idx val="${idx}"/>` +
    `<c:order val="${idx}"/>` +
    `<c:tx><c:v>${xmlEscapeText(s.name)}</c:v></c:tx>` +
    linePart +
    pointColorsXml +
    dLbls +
    trendLineXml(s) +
    errorBarsXml(s) +
    catRefXml(labels) +
    valRefXml(s.values) +
    (isLine ? `<c:smooth val="${s.smooth ? 1 : 0}"/>` : "") +
    `</c:ser>`
  );
}

function lineStyleXml(color: HexColor, width?: number, dash?: LineSpec["dash"]): string {
  const w = Math.round(width && Number.isFinite(width) && width > 0 ? width : 22225);
  const dashXml = dash && dash !== "solid" ? `<a:prstDash val="${dash}"/>` : "";
  return `<a:ln w="${w}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${dashXml}</a:ln>`;
}

function markerXml(marker: ChartMarkerSpec | undefined, color: HexColor): string {
  const symbol = marker?.symbol ?? "circle";
  if (symbol === "none") return `<c:marker><c:symbol val="none"/></c:marker>`;
  const size = Math.max(2, Math.min(72, Math.round(marker?.size ?? 6)));
  const fill = (marker?.fill ?? color).toUpperCase();
  const line = (marker?.line ?? fill).toUpperCase();
  return (
    `<c:marker>` +
    `<c:symbol val="${markerSymbolXml(symbol)}"/>` +
    `<c:size val="${size}"/>` +
    `<c:spPr><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="${line}"/></a:solidFill></a:ln></c:spPr>` +
    `</c:marker>`
  );
}

function markerSymbolXml(symbol: NonNullable<ChartMarkerSpec["symbol"]>): string {
  switch (symbol) {
    case "dot": return "circle";
    case "x": return "x";
    default: return symbol;
  }
}

function dataLabelsXmlOf(
  shape: Pick<ChartShape, "showValues" | "dataLabels">,
  defaults: {
    position?: NonNullable<ChartShape["dataLabels"]>["position"];
    showValue: boolean;
    showCategoryName: boolean;
    showSeriesName: boolean;
    showPercent: boolean;
    showLegendKey?: boolean;
    showLeaderLines?: boolean;
  },
): string {
  const labels = shape.dataLabels;
  const show = labels?.show ?? shape.showValues ?? false;
  if (!show) return "";
  const position = labels?.position ?? defaults.position;
  const positionXml = position ? `<c:dLblPos val="${dataLabelPositionXml(position)}"/>` : "";
  const showLegendKey = labels?.showLegendKey ?? defaults.showLegendKey ?? false;
  const showValue = labels?.showValue ?? defaults.showValue;
  const showCategoryName = labels?.showCategoryName ?? defaults.showCategoryName;
  const showSeriesName = labels?.showSeriesName ?? defaults.showSeriesName;
  const showPercent = labels?.showPercent ?? defaults.showPercent;
  const showLeaderLines = labels?.showLeaderLines ?? defaults.showLeaderLines;
  const leaderLinesXml = typeof showLeaderLines === "boolean" ? `<c:showLeaderLines val="${showLeaderLines ? 1 : 0}"/>` : "";
  return (
    `<c:dLbls>` +
    positionXml +
    `<c:showLegendKey val="${showLegendKey ? 1 : 0}"/>` +
    `<c:showVal val="${showValue ? 1 : 0}"/>` +
    `<c:showCatName val="${showCategoryName ? 1 : 0}"/>` +
    `<c:showSerName val="${showSeriesName ? 1 : 0}"/>` +
    `<c:showPercent val="${showPercent ? 1 : 0}"/>` +
    `<c:showBubbleSize val="0"/>` +
    leaderLinesXml +
    `</c:dLbls>`
  );
}

function dataLabelPositionXml(position: NonNullable<ChartShape["dataLabels"]>["position"]): string {
  switch (position) {
    case "center": return "ctr";
    case "insideEnd": return "inEnd";
    case "insideBase": return "inBase";
    case "outsideEnd": return "outEnd";
    case "bestFit":
    default: return "bestFit";
  }
}

function pointColorsXmlOf(
  values: Array<number | null>,
  colors: { positiveColor?: HexColor; negativeColor?: HexColor },
): string {
  return values.map((value, index) => {
    const color = typeof value === "number" && Number.isFinite(value) && value < 0
      ? colors.negativeColor
      : typeof value === "number" && Number.isFinite(value) && value > 0
        ? colors.positiveColor
        : undefined;
    if (!color) return "";
    return (
      `<c:dPt>` +
      `<c:idx val="${index}"/>` +
      `<c:invertIfNegative val="0"/>` +
      `<c:bubble3D val="0"/>` +
      `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr>` +
      `</c:dPt>`
    );
  }).join("");
}

function trendLineXml(s: { trendLine?: ChartShape["series"][number]["trendLine"] }): string {
  const trend = s.trendLine;
  if (!trend) return "";
  const spec = trend === true ? {} : trend;
  const type = spec.type === "exp" || spec.type === "log" || spec.type === "poly" ? spec.type : "linear";
  const nameXml = spec.label ? `<c:name>${xmlEscapeText(spec.label)}</c:name>` : "";
  const orderXml = type === "poly" ? `<c:order val="${Math.max(2, Math.min(6, Math.floor(spec.order ?? 2)))}"/>` : "";
  return `<c:trendline>${nameXml}<c:trendlineType val="${type}"/>${orderXml}<c:dispEq val="0"/><c:dispRSqr val="0"/></c:trendline>`;
}

function errorBarsXml(s: { errorBars?: ChartShape["series"][number]["errorBars"] }): string {
  const spec = s.errorBars;
  if (!spec) return "";
  const type = spec.type === "percent" ? "percentage"
    : spec.type === "stdDev" ? "stdDev"
      : spec.type === "stdErr" ? "stdErr"
        : "fixedVal";
  const value = typeof spec.value === "number" && Number.isFinite(spec.value) ? Math.max(0, spec.value) : type === "percentage" ? 5 : 1;
  const directions = spec.direction === "both" ? ["x", "y"] : [spec.direction === "x" ? "x" : "y"];
  return directions.map((dir) =>
    `<c:errBars>` +
    `<c:errDir val="${dir}"/>` +
    `<c:errBarType val="both"/>` +
    `<c:errValType val="${type}"/>` +
    `<c:noEndCap val="0"/>` +
    `<c:val val="${value}"/>` +
    `</c:errBars>`,
  ).join("");
}

// PowerPoint resolves `c:strRef`/`c:numRef` formula refs (e.g.
// `Sheet1!$A$2:$A$5`) by looking for an embedded xlsx workbook via
// chart{N}.xml.rels. We don't ship one — LibreOffice silently falls
// back to the cache, but PowerPoint reports the file as corrupted /
// "needs repair". Use the literal-data forms (`c:strLit` / `c:numLit`)
// which are self-contained and accepted by both renderers.
function catRefXml(labels: string[]): string {
  return (
    `<c:cat><c:strLit><c:ptCount val="${labels.length}"/>` +
    labels.map((l, i) => `<c:pt idx="${i}"><c:v>${xmlEscapeText(l)}</c:v></c:pt>`).join("") +
    `</c:strLit></c:cat>`
  );
}

function valRefXml(values: Array<number | null>): string {
  return (
    `<c:val><c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>` +
    values.map((v, i) => `<c:pt idx="${i}"><c:v>${typeof v === "number" && Number.isFinite(v) ? v : 0}</c:v></c:pt>`).join("") +
    `</c:numLit></c:val>`
  );
}

// ---- Combo / Scatter / Waterfall ---------------------------------------

/**
 * Combo chart — bar series rendered as `<c:barChart>`, line series as
 * `<c:lineChart>` in the same plotArea, sharing axes. Each series's
 * per-series `type` defaults to "bar" when the field is missing.
 */
function comboChartXml(
  shape: ChartShape,
  colors: HexColor[],
  catAxId: number,
  valAxId: number,
  secondaryValAxId?: number,
): string {
  // Preserve original series order so colour cycling matches the legend.
  const indexed = shape.series.map((s, idx) => ({ s, idx }));
  const chartXmlForAxis = (axisId: number, axis: "primary" | "secondary") => {
    const axisSeries = indexed.filter((entry) => axis === "secondary" ? entry.s.axis === "secondary" : entry.s.axis !== "secondary");
    const bars = axisSeries.filter((e) => (e.s.type ?? "bar") === "bar");
    const lines = axisSeries.filter((e) => e.s.type === "line");
    const barXml = bars.length === 0 ? "" :
    `<c:barChart>` +
    `<c:barDir val="col"/>` +
    `<c:grouping val="clustered"/>` +
    `<c:varyColors val="0"/>` +
    bars.map((e) => seriesXml(e.s, e.idx, colors, shape.labels, shape.showValues, false, false, shape)).join("") +
    `<c:gapWidth val="100"/>` +
    `<c:axId val="${catAxId}"/>` +
    `<c:axId val="${axisId}"/>` +
    `</c:barChart>`;
    const lineXml = lines.length === 0 ? "" :
    `<c:lineChart>` +
    `<c:grouping val="standard"/>` +
    `<c:varyColors val="0"/>` +
    lines.map((e) => seriesXml(e.s, e.idx, colors, shape.labels, shape.showValues, true, false, shape)).join("") +
    `<c:marker val="1"/>` +
    `<c:axId val="${catAxId}"/>` +
    `<c:axId val="${axisId}"/>` +
    `</c:lineChart>`;
    return barXml + lineXml;
  };
  return chartXmlForAxis(valAxId, "primary") + (secondaryValAxId ? chartXmlForAxis(secondaryValAxId, "secondary") : "");
}

function scatterChartXml(
  shape: ChartShape,
  colors: HexColor[],
  xAxId: number,
  yAxId: number,
): string {
  return (
    `<c:scatterChart>` +
    `<c:scatterStyle val="lineMarker"/>` +
    `<c:varyColors val="0"/>` +
    shape.series.map((s, idx) => {
      const pts = s.points && s.points.length > 0
        ? s.points
        // Fallback: derive {x,y} from labels (parsed as numbers) + values.
        : shape.labels.map((l, i) => ({ x: Number(l) || i, y: s.values[i] ?? 0 }));
      const color = colors[idx % colors.length]!;
      const seriesColor = (s.color ? s.color.toUpperCase() : color) as HexColor;
      return (
        `<c:ser>` +
        `<c:idx val="${idx}"/>` +
        `<c:order val="${idx}"/>` +
        `<c:tx><c:v>${xmlEscapeText(s.name)}</c:v></c:tx>` +
        `<c:spPr>${lineStyleXml(seriesColor, s.lineWidth, s.lineDash)}</c:spPr>` +
        markerXml(s.marker, seriesColor) +
        trendLineXml(s) +
        errorBarsXml(s) +
        `<c:xVal><c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="${pts.length}"/>` +
        pts.map((p, i) => `<c:pt idx="${i}"><c:v>${Number.isFinite(p.x) ? p.x : 0}</c:v></c:pt>`).join("") +
        `</c:numLit></c:xVal>` +
        `<c:yVal><c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="${pts.length}"/>` +
        pts.map((p, i) => `<c:pt idx="${i}"><c:v>${Number.isFinite(p.y) ? p.y : 0}</c:v></c:pt>`).join("") +
        `</c:numLit></c:yVal>` +
        `<c:smooth val="${s.smooth ? 1 : 0}"/>` +
        `</c:ser>`
      );
    }).join("") +
    `<c:axId val="${xAxId}"/>` +
    `<c:axId val="${yAxId}"/>` +
    `</c:scatterChart>`
  );
}

/**
 * Waterfall — rendered as a stacked bar chart with two synthetic series:
 * an invisible "base" series and a visible "delta" series. Per-bar fill
 * colours encode positive / negative / total. Real Office 2016 waterfall
 * uses the c15 namespace extension; we keep portable OOXML that round-trips
 * through LibreOffice / Keynote and looks waterfall-like in PowerPoint.
 *
 * Convention: a bar with `value === null` (or NaN) is treated as a "total"
 * (cumulative). All other bars are deltas applied to the running total.
 */
function waterfallChartXml(
  shape: ChartShape,
  colors: HexColor[],
  catAxId: number,
  valAxId: number,
): string {
  const upColor = colors[0] ?? "3CC2FF";
  const downColor = "C0432D";
  const totalColor = colors[1] ?? "1078B5";
  const series = shape.series[0] ?? { name: "Series", values: [] };
  const values = series.values;
  // Compute base + delta + per-point colors.
  let running = 0;
  const base: number[] = [];
  const delta: number[] = [];
  const fill: string[] = [];
  values.forEach((raw) => {
    if (raw === null || typeof raw !== "number" || !Number.isFinite(raw)) {
      base.push(0);
      delta.push(running);
      fill.push(totalColor);
      return;
    }
    const v = raw;
    if (v >= 0) {
      base.push(running);
      delta.push(v);
      fill.push(upColor);
      running += v;
    } else {
      base.push(running + v);
      delta.push(-v);
      fill.push(downColor);
      running += v;
    }
  });
  const baseSer =
    `<c:ser>` +
    `<c:idx val="0"/><c:order val="0"/>` +
    `<c:tx><c:v>${xmlEscapeText("(base)")}</c:v></c:tx>` +
    `<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>` +
    catRefXml(shape.labels) +
    valRefXml(base) +
    `</c:ser>`;
  const deltaSer =
    `<c:ser>` +
    `<c:idx val="1"/><c:order val="1"/>` +
    `<c:tx><c:v>${xmlEscapeText(series.name)}</c:v></c:tx>` +
    fill.map((c, i) =>
      `<c:dPt><c:idx val="${i}"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/>` +
      `<c:spPr><a:solidFill><a:srgbClr val="${c}"/></a:solidFill></c:spPr></c:dPt>`,
    ).join("") +
    catRefXml(shape.labels) +
    valRefXml(delta) +
    `</c:ser>`;
  return (
    `<c:barChart>` +
    `<c:barDir val="col"/>` +
    `<c:grouping val="stacked"/>` +
    `<c:varyColors val="0"/>` +
    baseSer +
    deltaSer +
    `<c:gapWidth val="40"/>` +
    `<c:overlap val="100"/>` +
    `<c:axId val="${catAxId}"/>` +
    `<c:axId val="${valAxId}"/>` +
    `</c:barChart>`
  );
}

function scatterAxesXml(xAxId: number, yAxId: number, xAxis: ChartAxisSpec | undefined, yAxis: ChartAxisSpec | undefined, numFmt: string): string {
  return (
    `<c:valAx>` +
    `<c:axId val="${xAxId}"/>` +
    scalingXml(xAxis) +
    `<c:delete val="${xAxis?.show === false ? 1 : 0}"/>` +
    `<c:axPos val="b"/>` +
    axisTitleXml(xAxis) +
    axisGridlinesXml(xAxis) +
    `<c:numFmt formatCode="${formatCodeAttr(numberFormatCode(xAxis?.numberFormat ?? "General"))}" sourceLinked="${xAxis?.numberFormat ? 0 : 1}"/>` +
    axisTicksXml(xAxis) +
    axisTextXml(xAxis) +
    `<c:crossAx val="${yAxId}"/>` +
    `</c:valAx>` +
    `<c:valAx>` +
    `<c:axId val="${yAxId}"/>` +
    scalingXml(yAxis) +
    `<c:delete val="${yAxis?.show === false ? 1 : 0}"/>` +
    `<c:axPos val="l"/>` +
    axisTitleXml(yAxis) +
    axisGridlinesXml(yAxis) +
    `<c:numFmt formatCode="${formatCodeAttr(numberFormatCode(yAxis?.numberFormat ?? numFmt))}" sourceLinked="0"/>` +
    axisTicksXml(yAxis) +
    axisTextXml(yAxis) +
    `<c:crossAx val="${xAxId}"/>` +
    `</c:valAx>`
  );
}

function isHorizontalBarChart(shape: ChartShape): boolean {
  return shape.orientation === "horizontal" && (shape.chartType === "bar" || shape.chartType === "stacked-bar");
}

function axesXmlOf(
  catAxId: number,
  valAxId: number,
  xAxis: ChartAxisSpec | undefined,
  yAxis: ChartAxisSpec | undefined,
  numFmt: string,
  secondaryValAxId?: number,
  secondaryYAxis?: ChartAxisSpec,
  orientation: "vertical" | "horizontal" = "vertical",
): string {
  const horizontal = orientation === "horizontal";
  return (
    `<c:catAx>` +
    `<c:axId val="${catAxId}"/>` +
    scalingXml(xAxis) +
    `<c:delete val="${xAxis?.show === false ? 1 : 0}"/>` +
    `<c:axPos val="${horizontal ? "l" : "b"}"/>` +
    axisTitleXml(xAxis) +
    axisGridlinesXml(xAxis) +
    axisTicksXml(xAxis) +
    axisTextXml(xAxis) +
    `<c:crossAx val="${valAxId}"/>` +
    `</c:catAx>` +
    `<c:valAx>` +
    `<c:axId val="${valAxId}"/>` +
    scalingXml(yAxis) +
    `<c:delete val="${yAxis?.show === false ? 1 : 0}"/>` +
    `<c:axPos val="${horizontal ? "b" : "l"}"/>` +
    axisTitleXml(yAxis) +
    axisGridlinesXml(yAxis) +
    `<c:numFmt formatCode="${formatCodeAttr(numberFormatCode(yAxis?.numberFormat ?? numFmt))}" sourceLinked="0"/>` +
    axisUnitXml(yAxis) +
    axisTicksXml(yAxis) +
    axisTextXml(yAxis) +
    `<c:crossAx val="${catAxId}"/>` +
    `</c:valAx>` +
    (secondaryValAxId ? (
      `<c:valAx>` +
      `<c:axId val="${secondaryValAxId}"/>` +
      scalingXml(secondaryYAxis) +
      `<c:delete val="${secondaryYAxis?.show === false ? 1 : 0}"/>` +
      `<c:axPos val="${horizontal ? "t" : "r"}"/>` +
      axisTitleXml(secondaryYAxis) +
      axisGridlinesXml(secondaryYAxis) +
      `<c:numFmt formatCode="${formatCodeAttr(numberFormatCode(secondaryYAxis?.numberFormat ?? numFmt))}" sourceLinked="0"/>` +
      axisUnitXml(secondaryYAxis) +
      axisTicksXml(secondaryYAxis) +
      axisTextXml(secondaryYAxis) +
      `<c:crossAx val="${catAxId}"/>` +
      `</c:valAx>`
    ) : "")
  );
}

function scalingXml(axis: ChartAxisSpec | undefined): string {
  const parts = [`<c:orientation val="minMax"/>`];
  if (typeof axis?.min === "number" && Number.isFinite(axis.min)) parts.push(`<c:min val="${axis.min}"/>`);
  if (typeof axis?.max === "number" && Number.isFinite(axis.max)) parts.push(`<c:max val="${axis.max}"/>`);
  return `<c:scaling>${parts.join("")}</c:scaling>`;
}

function axisUnitXml(axis: ChartAxisSpec | undefined): string {
  let out = "";
  if (typeof axis?.majorUnit === "number" && Number.isFinite(axis.majorUnit) && axis.majorUnit > 0) out += `<c:majorUnit val="${axis.majorUnit}"/>`;
  if (typeof axis?.minorUnit === "number" && Number.isFinite(axis.minorUnit) && axis.minorUnit > 0) out += `<c:minorUnit val="${axis.minorUnit}"/>`;
  return out;
}

function axisTicksXml(axis: ChartAxisSpec | undefined): string {
  const major = axis?.majorTickMark ?? "out";
  const minor = axis?.minorTickMark ?? "none";
  const tick = axis?.tickLabelPosition ?? "nextTo";
  return `<c:majorTickMark val="${tickMarkXml(major)}"/><c:minorTickMark val="${tickMarkXml(minor)}"/><c:tickLblPos val="${tick}"/>`;
}

function tickMarkXml(value: NonNullable<ChartAxisSpec["majorTickMark"]>): string {
  return value === "in" ? "in" : value === "cross" ? "cross" : value === "none" ? "none" : "out";
}

function axisTextXml(axis: ChartAxisSpec | undefined): string {
  if (typeof axis?.tickLabelRotation !== "number") return "";
  const rot = Math.round(-axis.tickLabelRotation * 60000);
  return `<c:txPr><a:bodyPr rot="${rot}"/><a:lstStyle/><a:p><a:pPr/><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;
}

function axisTitleXml(axis: ChartAxisSpec | undefined): string {
  if (!axis?.title) return "";
  return (
    `<c:title><c:tx><c:rich>` +
    `<a:bodyPr rot="0" spcFirstLastPara="1" vertOverflow="ellipsis" wrap="square" anchor="ctr" anchorCtr="1"/>` +
    `<a:lstStyle/><a:p><a:pPr algn="ctr"><a:defRPr sz="1000" b="1"/></a:pPr>` +
    `<a:r><a:rPr lang="en-US" sz="1000" b="1"/><a:t>${xmlEscapeText(axis.title)}</a:t></a:r>` +
    `</a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title>`
  );
}

function axisGridlinesXml(axis: ChartAxisSpec | undefined): string {
  const grid = axis?.gridlines;
  if (!grid) return "";
  const showMajor = typeof grid === "boolean" ? grid : grid.major !== false;
  const showMinor = typeof grid === "object" && grid.minor === true;
  const line = typeof grid === "object" ? gridlineSpPrXml(grid) : "";
  return (showMajor ? `<c:majorGridlines>${line}</c:majorGridlines>` : "") +
    (showMinor ? `<c:minorGridlines>${line}</c:minorGridlines>` : "");
}

function gridlineSpPrXml(grid: Exclude<ChartAxisSpec["gridlines"], boolean | undefined>): string {
  const color = (grid.color ?? "D9D9D9").toUpperCase();
  const width = Math.round(grid.width ?? 6350);
  const dash = grid.dash && grid.dash !== "solid" ? `<a:prstDash val="${grid.dash}"/>` : "";
  return `<c:spPr><a:ln w="${width}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${dash}</a:ln></c:spPr>`;
}

/**
 * Map our friendly format names to OOXML/Excel format codes.
 *
 * Excel format codes:
 *   "0"    → integer
 *   "0.0"  → one decimal
 *   "0%"   → percent (multiplies value by 100 — caller passes 0.12 not 12)
 *   custom → 万元 / 亿
 *
 * For 万元: "0.00&quot;万&quot;" — but our SlideML callers pass actual yuan
 * values. We instead use the Excel custom format with a divisor:
 *   value 82_300_000 → display "8230 万" requires either pre-dividing the
 *   data OR a format like "0,," — the latter divides by 1M which doesn't
 *   match 万 (10K). The honest answer: Excel format codes can't divide by
 *   10000 directly. We pre-divide values upstream when the user picks
 *   `wanyuan` / `yi`; here we just append the unit suffix to the formatCode.
 *
 * To keep the format-code path local (no upstream pre-division), we use:
 *   wanyuan → `"#,##0&quot;万&quot;"` and document that values should already
 *   be expressed in 万元 (i.e. 8230 not 82_300_000). Same convention for
 *   `yi`. This matches how Chinese finance decks talk about numbers.
 */
function numberFormatCode(format: ChartNumberFormat | string): string {
  switch (format) {
    case "int":     return "0";
    case "decimal": return "0.0";
    case "percent": return "0%";
    case "wanyuan": return "#,##0&quot;万&quot;";
    case "yi":      return "0.0&quot;亿&quot;";
    case "General": return "General";
    default: return format;
  }
}

/**
 * XML-escape text inside chart elements. We re-implement here to avoid
 * a dependency cycle with `./xml.ts` (which carries smart-quote handling
 * we don't want to apply inside numeric text).
 */
function xmlEscapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatCodeAttr(s: string): string {
  return s
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
