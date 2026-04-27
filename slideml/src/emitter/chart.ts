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
import type { ChartNumberFormat, ChartShape, HexColor } from "./types.js";

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

  const numFmt = numberFormatCode(shape.yFormat ?? "int");
  // Stable axis IDs.
  const catAxId = 100000001;
  const valAxId = 100000002;

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

  const showLegend = shape.showLegend ?? shape.series.length > 1;
  const legendXml = showLegend
    ? `<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>`
    : "";

  let plotInner = "";
  if (shape.chartType === "bar" || shape.chartType === "stacked-bar") {
    plotInner = barChartXml(shape, colors, catAxId, valAxId, shape.chartType === "stacked-bar");
  } else if (shape.chartType === "line") {
    plotInner = lineChartXml(shape, colors, catAxId, valAxId);
  } else if (shape.chartType === "area") {
    plotInner = areaChartXml(shape, colors, catAxId, valAxId);
  } else if (shape.chartType === "pie") {
    plotInner = pieChartXml(shape, colors, /* doughnut */ false);
  } else if (shape.chartType === "doughnut") {
    plotInner = pieChartXml(shape, colors, /* doughnut */ true);
  } else if (shape.chartType === "combo") {
    plotInner = comboChartXml(shape, colors, catAxId, valAxId);
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
      ? scatterAxesXml(catAxId, valAxId, numFmt)
      : axesXmlOf(catAxId, valAxId, numFmt);

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
<c:layout/>
${plotInner}
${axesXml}
</c:plotArea>
${legendXml}
<c:plotVisOnly val="1"/>
<c:dispBlanksAs val="gap"/>
</c:chart>
</c:chartSpace>`;
}

// ---- Bar / Line / Pie chart bodies --------------------------------------

function barChartXml(
  shape: ChartShape,
  colors: HexColor[],
  catAxId: number,
  valAxId: number,
  stacked: boolean,
): string {
  const grouping = stacked ? "stacked" : "clustered";
  const overlap = stacked ? `<c:overlap val="100"/>` : "";
  return (
    `<c:barChart>` +
    `<c:barDir val="col"/>` +
    `<c:grouping val="${grouping}"/>` +
    `<c:varyColors val="0"/>` +
    shape.series.map((s, idx) => seriesXml(s, idx, colors, shape.labels, shape.showValues)).join("") +
    `<c:gapWidth val="100"/>` +
    overlap +
    `<c:axId val="${catAxId}"/>` +
    `<c:axId val="${valAxId}"/>` +
    `</c:barChart>`
  );
}

function areaChartXml(
  shape: ChartShape,
  colors: HexColor[],
  catAxId: number,
  valAxId: number,
): string {
  return (
    `<c:areaChart>` +
    `<c:grouping val="standard"/>` +
    `<c:varyColors val="0"/>` +
    shape.series.map((s, idx) => seriesXml(s, idx, colors, shape.labels, shape.showValues, /* isLine */ false, /* isArea */ true)).join("") +
    `<c:axId val="${catAxId}"/>` +
    `<c:axId val="${valAxId}"/>` +
    `</c:areaChart>`
  );
}

function lineChartXml(
  shape: ChartShape,
  colors: HexColor[],
  catAxId: number,
  valAxId: number,
): string {
  return (
    `<c:lineChart>` +
    `<c:grouping val="standard"/>` +
    `<c:varyColors val="0"/>` +
    shape.series.map((s, idx) => seriesXml(s, idx, colors, shape.labels, shape.showValues, true)).join("") +
    `<c:marker val="1"/>` +
    `<c:axId val="${catAxId}"/>` +
    `<c:axId val="${valAxId}"/>` +
    `</c:lineChart>`
  );
}

function pieChartXml(shape: ChartShape, colors: HexColor[], doughnut: boolean): string {
  // Pie / doughnut both use the first series only; each label is a slice.
  const series = shape.series[0] ?? { name: "Series", values: [] };
  const elem = doughnut ? "doughnutChart" : "pieChart";
  const holeXml = doughnut ? `<c:holeSize val="50"/>` : "";
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
    `<c:firstSliceAng val="0"/>` +
    holeXml +
    `</c:${elem}>`
  );
}

function seriesXml(
  s: { name: string; values: Array<number | null> },
  idx: number,
  colors: HexColor[],
  labels: string[],
  showValues = false,
  isLine = false,
  isArea = false,
): string {
  const color = colors[idx % colors.length]!;
  const linePart = isLine
    ? `<c:spPr><a:ln w="22225"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></c:spPr>` +
      `<c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr></c:marker>`
    : isArea
      ? `<c:spPr><a:solidFill><a:srgbClr val="${color}"><a:alpha val="60000"/></a:srgbClr></a:solidFill>` +
        `<a:ln><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></c:spPr>`
      : `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr>`;

  const dLbls = showValues
    ? `<c:dLbls><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>`
    : "";

  return (
    `<c:ser>` +
    `<c:idx val="${idx}"/>` +
    `<c:order val="${idx}"/>` +
    `<c:tx><c:v>${xmlEscapeText(s.name)}</c:v></c:tx>` +
    linePart +
    dLbls +
    catRefXml(labels) +
    valRefXml(s.values) +
    (isLine ? `<c:smooth val="0"/>` : "") +
    `</c:ser>`
  );
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
): string {
  // Preserve original series order so colour cycling matches the legend.
  const indexed = shape.series.map((s, idx) => ({ s, idx }));
  const bars = indexed.filter((e) => (e.s.type ?? "bar") === "bar");
  const lines = indexed.filter((e) => e.s.type === "line");
  const barXml = bars.length === 0 ? "" :
    `<c:barChart>` +
    `<c:barDir val="col"/>` +
    `<c:grouping val="clustered"/>` +
    `<c:varyColors val="0"/>` +
    bars.map((e) => seriesXml(e.s, e.idx, colors, shape.labels, shape.showValues)).join("") +
    `<c:gapWidth val="100"/>` +
    `<c:axId val="${catAxId}"/>` +
    `<c:axId val="${valAxId}"/>` +
    `</c:barChart>`;
  const lineXml = lines.length === 0 ? "" :
    `<c:lineChart>` +
    `<c:grouping val="standard"/>` +
    `<c:varyColors val="0"/>` +
    lines.map((e) => seriesXml(e.s, e.idx, colors, shape.labels, shape.showValues, true)).join("") +
    `<c:marker val="1"/>` +
    `<c:axId val="${catAxId}"/>` +
    `<c:axId val="${valAxId}"/>` +
    `</c:lineChart>`;
  return barXml + lineXml;
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
      return (
        `<c:ser>` +
        `<c:idx val="${idx}"/>` +
        `<c:order val="${idx}"/>` +
        `<c:tx><c:v>${xmlEscapeText(s.name)}</c:v></c:tx>` +
        `<c:spPr><a:ln w="22225"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></c:spPr>` +
        `<c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr></c:marker>` +
        `<c:xVal><c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="${pts.length}"/>` +
        pts.map((p, i) => `<c:pt idx="${i}"><c:v>${Number.isFinite(p.x) ? p.x : 0}</c:v></c:pt>`).join("") +
        `</c:numLit></c:xVal>` +
        `<c:yVal><c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="${pts.length}"/>` +
        pts.map((p, i) => `<c:pt idx="${i}"><c:v>${Number.isFinite(p.y) ? p.y : 0}</c:v></c:pt>`).join("") +
        `</c:numLit></c:yVal>` +
        `<c:smooth val="0"/>` +
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

function scatterAxesXml(xAxId: number, yAxId: number, numFmt: string): string {
  return (
    `<c:valAx>` +
    `<c:axId val="${xAxId}"/>` +
    `<c:scaling><c:orientation val="minMax"/></c:scaling>` +
    `<c:delete val="0"/>` +
    `<c:axPos val="b"/>` +
    `<c:numFmt formatCode="General" sourceLinked="1"/>` +
    `<c:majorTickMark val="out"/>` +
    `<c:minorTickMark val="none"/>` +
    `<c:tickLblPos val="nextTo"/>` +
    `<c:crossAx val="${yAxId}"/>` +
    `</c:valAx>` +
    `<c:valAx>` +
    `<c:axId val="${yAxId}"/>` +
    `<c:scaling><c:orientation val="minMax"/></c:scaling>` +
    `<c:delete val="0"/>` +
    `<c:axPos val="l"/>` +
    `<c:numFmt formatCode="${numFmt}" sourceLinked="0"/>` +
    `<c:majorTickMark val="out"/>` +
    `<c:minorTickMark val="none"/>` +
    `<c:tickLblPos val="nextTo"/>` +
    `<c:crossAx val="${xAxId}"/>` +
    `</c:valAx>`
  );
}

function axesXmlOf(catAxId: number, valAxId: number, numFmt: string): string {
  return (
    `<c:catAx>` +
    `<c:axId val="${catAxId}"/>` +
    `<c:scaling><c:orientation val="minMax"/></c:scaling>` +
    `<c:delete val="0"/>` +
    `<c:axPos val="b"/>` +
    `<c:crossAx val="${valAxId}"/>` +
    `</c:catAx>` +
    `<c:valAx>` +
    `<c:axId val="${valAxId}"/>` +
    `<c:scaling><c:orientation val="minMax"/></c:scaling>` +
    `<c:delete val="0"/>` +
    `<c:axPos val="l"/>` +
    `<c:numFmt formatCode="${numFmt}" sourceLinked="0"/>` +
    `<c:majorTickMark val="out"/>` +
    `<c:minorTickMark val="none"/>` +
    `<c:tickLblPos val="nextTo"/>` +
    `<c:crossAx val="${catAxId}"/>` +
    `</c:valAx>`
  );
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
function numberFormatCode(format: ChartNumberFormat): string {
  switch (format) {
    case "int":     return "0";
    case "decimal": return "0.0";
    case "percent": return "0%";
    case "wanyuan": return "#,##0&quot;万&quot;";
    case "yi":      return "0.0&quot;亿&quot;";
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
