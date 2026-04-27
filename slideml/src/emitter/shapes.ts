/**
 * Serialize preset shapes (`<p:sp>` + `<a:xfrm>` + `<a:prstGeom>`) and the
 * `<p:sp>` wrapper for text shapes.
 *
 * Vendored carve-out: shape-XML structure mirrors PptxGenJS `gen-xml.ts`'s
 * `slideObjectToXml` for `RECTANGLE` / `ELLIPSE` / `LINE` / `ROUNDED_RECT`.
 * We support only the four preset names SlideML's `ShapePreset` lists.
 */

import { txBody, type RunRels } from "./text.js";
import { tableGraphicFrameXml } from "./table.js";
import { assertHex, attr } from "./xml.js";
import type { ChartShape, FillSpec, ImageShape, LineSpec, PresetShape, Shape, ShapePreset, TableShape, TextShape, Xfrm } from "./types.js";

/** Map our `ShapePreset` to OOXML `prstGeom` names. */
const PRESET_TO_GEOM: Record<ShapePreset, string> = {
  rect: "rect",
  roundRect: "roundRect",
  ellipse: "ellipse",
  line: "line",
};

export function shapeXml(shape: Shape, slidePart: string, rels: SlideRels): string {
  switch (shape.type) {
    case "text":   return textShapeXml(shape, rels);
    case "shape":  return presetShapeXml(shape);
    case "image":  return imageShapeXml(shape, slidePart, rels);
    case "chart":  return chartShapeXml(shape, rels);
    case "table":  return tableShapeXml(shape);
  }
}

function tableShapeXml(shape: TableShape): string {
  return tableGraphicFrameXml(shape);
}

// ---- Text shapes ----------------------------------------------------------

function textShapeXml(shape: TextShape, rels: SlideRels): string {
  // Text-bearing shapes need `txBox="1"` on `<p:cNvSpPr>` so PowerPoint
  // treats them as text frames (not auto-shapes with rich text). Without
  // this, PowerPoint's strict-validate path flags the file as having
  // "content problems" and offers to repair on open. LibreOffice and
  // python-pptx tolerate the omission.
  const nvSpPr = nvSpPrXml(shape.id, shape.name ?? `Text ${shape.id}`, true);
  const spPr = spPrXml(shape.xfrm, "rect", undefined, shape.fill, shape.line);
  // Adapter: text-emitter asks for hyperlink rIds via this RunRels, which
  // pushes a slide-level rel of type `/hyperlink` with TargetMode=External.
  const runRels: RunRels = {
    addHyperlink(target: string): string {
      const rId = nextRelId(rels);
      rels.entries.push({
        id: rId,
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
        target,
        targetMode: "External",
      });
      return rId;
    },
  };
  return `<p:sp>${nvSpPr}${spPr}${txBody(shape, runRels)}</p:sp>`;
}

// ---- Preset shapes --------------------------------------------------------

function presetShapeXml(shape: PresetShape): string {
  const nvSpPr = nvSpPrXml(shape.id, shape.name ?? `${shape.preset} ${shape.id}`);
  const geom = PRESET_TO_GEOM[shape.preset];
  const adjustments = shape.preset === "roundRect" && shape.cornerRadius !== undefined
    ? `<a:avLst><a:gd name="adj" fmla="val ${Math.round(Math.max(0, Math.min(0.5, shape.cornerRadius)) * 50000)}"/></a:avLst>`
    : `<a:avLst/>`;
  const spPr = spPrXml(shape.xfrm, geom, adjustments, shape.fill, shape.line);
  // PowerPoint requires a `<p:txBody>` even on shapes with no text — emit empty.
  const emptyTxBody =
    `<p:txBody>` +
    `<a:bodyPr wrap="square" rtlCol="0" anchor="ctr"/>` +
    `<a:lstStyle/>` +
    `<a:p><a:endParaRPr lang="en-US"/></a:p>` +
    `</p:txBody>`;
  return `<p:sp>${nvSpPr}${spPr}${emptyTxBody}</p:sp>`;
}

// ---- Image shapes ---------------------------------------------------------

export interface SlideRels {
  /** Map of relationship ID → target path within the .pptx package.
   *  `targetMode === "External"` is required for hyperlinks; omit otherwise. */
  entries: Array<{ id: string; type: string; target: string; targetMode?: "External" }>;
}

/**
 * Produce a fresh rId; mutates `rels`. rId1 is reserved for the slideLayout
 * relationship (see `slideRelsXml`), so shape rels start at rId2.
 */
function nextRelId(rels: SlideRels): string {
  return `rId${rels.entries.length + 2}`;
}

// ---- Chart shapes ---------------------------------------------------------

function chartShapeXml(shape: ChartShape, rels: SlideRels): string {
  const rId = nextRelId(rels);
  rels.entries.push({
    id: rId,
    type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
    // Placeholder target; package emitter rewrites to the actual chart filename.
    target: `../charts/__chart_${shape.id}__.xml`,
  });

  const nvGFP =
    `<p:nvGraphicFramePr>` +
    `<p:cNvPr id="${shape.id}" name="${shape.name ?? `Chart ${shape.id}`}"/>` +
    // PowerPoint expects the graphicFrameLocks child here; the bare
    // self-closed <p:cNvGraphicFramePr/> form is accepted by LibreOffice
    // but flagged as schema-defective by Office 365's strict reader.
    `<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr>` +
    `<p:nvPr/>` +
    `</p:nvGraphicFramePr>`;
  const xfrm =
    `<p:xfrm>` +
    `<a:off x="${Math.round(shape.xfrm.x)}" y="${Math.round(shape.xfrm.y)}"/>` +
    `<a:ext cx="${Math.round(shape.xfrm.cx)}" cy="${Math.round(shape.xfrm.cy)}"/>` +
    `</p:xfrm>`;
  const graphic =
    `<a:graphic>` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
    `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${rId}"/>` +
    `</a:graphicData>` +
    `</a:graphic>`;
  return `<p:graphicFrame>${nvGFP}${xfrm}${graphic}</p:graphicFrame>`;
}

function imageShapeXml(shape: ImageShape, _slidePart: string, rels: SlideRels): string {
  // The actual media file is added by the package emitter — here we just
  // need to register a relationship and embed the rId in the picture XML.
  const rId = nextRelId(rels);
  rels.entries.push({
    id: rId,
    type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
    target: `../media/${shape.name ?? `image${shape.id}`}.png`, // package emitter rewrites filename
  });

  const nvPicPr =
    `<p:nvPicPr>` +
    `<p:cNvPr id="${shape.id}" name="${shape.name ?? `Picture ${shape.id}`}"` +
    (shape.altText ? attr("descr", shape.altText) : "") +
    `/>` +
    `<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>` +
    `<p:nvPr/>` +
    `</p:nvPicPr>`;
  const blipFill = `<p:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>`;
  const spPr =
    `<p:spPr>` +
    xfrmXml(shape.xfrm) +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `</p:spPr>`;
  return `<p:pic>${nvPicPr}${blipFill}${spPr}</p:pic>`;
}

// ---- Shared building blocks ----------------------------------------------

function nvSpPrXml(id: number, name: string, isTextBox = false): string {
  const cNvSpPr = isTextBox ? `<p:cNvSpPr txBox="1"/>` : `<p:cNvSpPr/>`;
  return (
    `<p:nvSpPr>` +
    `<p:cNvPr id="${id}" name="${name}"/>` +
    cNvSpPr +
    `<p:nvPr/>` +
    `</p:nvSpPr>`
  );
}

function spPrXml(
  xfrm: Xfrm,
  geom: string,
  adjustments: string | undefined,
  fill: FillSpec | undefined,
  line: LineSpec | undefined,
): string {
  const fillXml = fillXmlOf(fill);
  const lineXml = lineXmlOf(line);
  const geomXml = `<a:prstGeom prst="${geom}">${adjustments ?? `<a:avLst/>`}</a:prstGeom>`;
  return `<p:spPr>${xfrmXml(xfrm)}${geomXml}${fillXml}${lineXml}</p:spPr>`;
}

function xfrmXml(xfrm: Xfrm): string {
  const rotAttr = xfrm.rot ? attr("rot", Math.round(xfrm.rot)) : "";
  const flipAttr = (xfrm.flipH ? ` flipH="1"` : "") + (xfrm.flipV ? ` flipV="1"` : "");
  return (
    `<a:xfrm${rotAttr}${flipAttr}>` +
    `<a:off x="${Math.round(xfrm.x)}" y="${Math.round(xfrm.y)}"/>` +
    `<a:ext cx="${Math.round(xfrm.cx)}" cy="${Math.round(xfrm.cy)}"/>` +
    `</a:xfrm>`
  );
}

function fillXmlOf(fill: FillSpec | undefined): string {
  if (!fill || fill.type === "none") return `<a:noFill/>`;
  assertHex(fill.color, "Shape.fill.color");
  const alphaXml = fill.alpha !== undefined && fill.alpha < 1
    ? `<a:alpha val="${Math.round(fill.alpha * 100000)}"/>`
    : "";
  return `<a:solidFill><a:srgbClr val="${fill.color.toUpperCase()}">${alphaXml}</a:srgbClr></a:solidFill>`;
}

function lineXmlOf(line: LineSpec | undefined): string {
  if (!line) return `<a:ln><a:noFill/></a:ln>`;
  assertHex(line.color, "Shape.line.color");
  const dashXml = line.dash && line.dash !== "solid"
    ? `<a:prstDash val="${line.dash}"/>`
    : "";
  return (
    `<a:ln w="${Math.round(line.width)}">` +
    `<a:solidFill><a:srgbClr val="${line.color.toUpperCase()}"/></a:solidFill>` +
    dashXml +
    `</a:ln>`
  );
}
