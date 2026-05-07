/**
 * Serialize preset shapes (`<p:sp>` + `<a:xfrm>` + `<a:prstGeom>`) and the
 * `<p:sp>` wrapper for text shapes.
 *
 * Vendored carve-out: shape-XML structure mirrors PptxGenJS `gen-xml.ts`'s
 * `slideObjectToXml` for `RECTANGLE` / `ELLIPSE` / `LINE` / `ROUNDED_RECT`.
 * ShapePreset intentionally stays small and maps to OOXML preset geometry.
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
  triangle: "triangle",
  rightTriangle: "rtTriangle",
  pentagon: "pentagon",
  diamond: "diamond",
  "arrow-right": "rightArrow",
  "arrow-down": "downArrow",
  callout: "wedgeRectCallout",
  chevron: "chevron",
  "star-5": "star5",
  parallelogram: "parallelogram",
  cloud: "cloud",
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
  //
  // When `cornerRadius` is set we promote the geometry to `roundRect` so
  // the same shape carries fill, border, AND text — keeping them in one
  // resizable unit rather than two stacked shapes that drift apart on
  // user edits.
  const isRoundRect = shape.cornerRadius !== undefined;
  const nvSpPr = nvSpPrXml(shape.id, shape.name ?? `Text ${shape.id}`, true);
  const adjustments = isRoundRect
    ? `<a:avLst><a:gd name="adj" fmla="val ${Math.round(Math.max(0, Math.min(0.5, shape.cornerRadius!)) * 50000)}"/></a:avLst>`
    : undefined;
  const spPr = spPrXml(shape.xfrm, isRoundRect ? "roundRect" : "rect", adjustments, shape.fill, shape.line);
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
  const spPr = spPrXml(shape.xfrm, geom, adjustments, shape.fill, shape.line, shape.shadow);
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
  // Inner blip filters — order matters per OOXML schema:
  //   alphaModFix → biLevel → blur → clrChange → clrRepl → duotone →
  //   fillOverlay → grayscl → hsl → lum → tint → extLst.
  // We support: blur, duotone, grayscl, lum.
  const blipInner: string[] = [];
  if (shape.blur !== undefined && shape.blur > 0) {
    blipInner.push(`<a:blur rad="${Math.round(shape.blur)}" grow="0"/>`);
  }
  if (shape.duotone) {
    blipInner.push(
      `<a:duotone>` +
      `<a:srgbClr val="${shape.duotone.dark.toUpperCase()}"/>` +
      `<a:srgbClr val="${shape.duotone.light.toUpperCase()}"/>` +
      `</a:duotone>`,
    );
  }
  if (shape.grayscale) {
    blipInner.push(`<a:grayscl/>`);
  }
  if (shape.brightness !== undefined && shape.brightness !== 0) {
    // OOXML `bright` attribute is per-mille (-100000..100000) per spec.
    const bright = Math.round(Math.max(-1, Math.min(1, shape.brightness)) * 100000);
    blipInner.push(`<a:lum bright="${bright}"/>`);
  }
  const blipXml = blipInner.length > 0
    ? `<a:blip r:embed="${rId}">${blipInner.join("")}</a:blip>`
    : `<a:blip r:embed="${rId}"/>`;
  // srcRect crop — explicit per-side crop (`shape.crop`) wins. Otherwise,
  // when fit: "cover" + we have source dimensions + target aspect differs,
  // compute symmetric crop on the longer dimension so the image fills
  // without distortion.
  const fit = shape.fit ?? "cover";
  const explicitCrop = shape.crop;
  const autoCover = !explicitCrop && fit === "cover" && shape.sourceDimensions
    ? coverCrop(shape.sourceDimensions.width, shape.sourceDimensions.height, shape.xfrm.cx, shape.xfrm.cy)
    : undefined;
  // For fit: "contain" + dimensions known + aspect differs, we render the
  // image inside a smaller centered rect via fillRect insets (negative
  // numbers letterbox). This avoids needing a separate background shape.
  const containInsets = !explicitCrop && fit === "contain" && shape.sourceDimensions
    ? containFill(shape.sourceDimensions.width, shape.sourceDimensions.height, shape.xfrm.cx, shape.xfrm.cy)
    : undefined;
  const cropToUse = explicitCrop ?? autoCover;
  const srcRectXml = cropToUse
    ? `<a:srcRect` +
      ` l="${Math.round(Math.max(0, Math.min(1, cropToUse.left ?? 0)) * 100000)}"` +
      ` r="${Math.round(Math.max(0, Math.min(1, cropToUse.right ?? 0)) * 100000)}"` +
      ` t="${Math.round(Math.max(0, Math.min(1, cropToUse.top ?? 0)) * 100000)}"` +
      ` b="${Math.round(Math.max(0, Math.min(1, cropToUse.bottom ?? 0)) * 100000)}"` +
      `/>`
    : "";
  const fillRectXml = containInsets
    ? `<a:fillRect` +
      ` l="${Math.round(containInsets.left * 100000)}"` +
      ` r="${Math.round(containInsets.right * 100000)}"` +
      ` t="${Math.round(containInsets.top * 100000)}"` +
      ` b="${Math.round(containInsets.bottom * 100000)}"` +
      `/>`
    : `<a:fillRect/>`;
  const blipFill = `<p:blipFill>${blipXml}${srcRectXml}<a:stretch>${fillRectXml}</a:stretch></p:blipFill>`;
  const clip = shape.clip ?? "square";
  const geom =
    clip === "circle"  ? "ellipse" :
    clip === "rounded" ? "roundRect" :
    "rect";
  const adjustments = clip === "rounded" && shape.cornerRadius !== undefined
    ? `<a:avLst><a:gd name="adj" fmla="val ${Math.round(Math.max(0, Math.min(0.5, shape.cornerRadius)) * 50000)}"/></a:avLst>`
    : `<a:avLst/>`;
  const lineXml = shape.border ? lineXmlOf(shape.border) : "";
  // Outer effect list — softEdge + outerShdw. OOXML `<a:effectLst>` per
  // CT_EffectList ordering: blur → fillOverlay → glow → innerShdw →
  // outerShdw → prstShdw → reflection → softEdge.
  const effectParts: string[] = [];
  if (shape.shadow) {
    const sh = shape.shadow;
    const blurEmu = Math.round(sh.blur ?? 76200); // ≈6pt default
    const dx = Math.round(sh.dx ?? 0);
    const dy = Math.round(sh.dy ?? 38100); // ≈3pt default
    const dist = Math.round(Math.sqrt(dx * dx + dy * dy));
    const dirDeg = dist === 0 ? 0 : Math.round((Math.atan2(dy, dx) * 180 / Math.PI) * 60000);
    const alphaXml = sh.alpha !== undefined && sh.alpha < 1
      ? `<a:alpha val="${Math.round(sh.alpha * 100000)}"/>`
      : "";
    effectParts.push(
      `<a:outerShdw blurRad="${blurEmu}" dist="${dist}" dir="${dirDeg}" algn="tl" rotWithShape="0">` +
      `<a:srgbClr val="${sh.color.toUpperCase()}">${alphaXml}</a:srgbClr>` +
      `</a:outerShdw>`,
    );
  }
  if (shape.softEdge !== undefined && shape.softEdge > 0) {
    // Convert fraction-of-shorter-side to EMU radius.
    const shorter = Math.min(shape.xfrm.cx, shape.xfrm.cy);
    const rad = Math.round(Math.max(0, Math.min(0.5, shape.softEdge)) * shorter);
    effectParts.push(`<a:softEdge rad="${rad}"/>`);
  }
  const effectLstXml = effectParts.length > 0 ? `<a:effectLst>${effectParts.join("")}</a:effectLst>` : "";
  const spPr =
    `<p:spPr>` +
    xfrmXml(shape.xfrm) +
    `<a:prstGeom prst="${geom}">${adjustments}</a:prstGeom>` +
    lineXml +
    effectLstXml +
    `</p:spPr>`;
  let out = `<p:pic>${nvPicPr}${blipFill}${spPr}</p:pic>`;
  if (shape.overlay) {
    // Translucent rect on top of the image. Inherits the same clip
    // geometry so circle/rounded overlays don't bleed past the image.
    const ov = shape.overlay;
    const alphaXml = ov.alpha !== undefined && ov.alpha < 1
      ? `<a:alpha val="${Math.round(ov.alpha * 100000)}"/>`
      : "";
    const overlayId = shape.id + 100000; // disambiguate id (slide-scope)
    const overlayNvSpPr = nvSpPrXml(overlayId, `Overlay ${overlayId}`);
    const overlaySpPr =
      `<p:spPr>` +
      xfrmXml(shape.xfrm) +
      `<a:prstGeom prst="${geom}">${adjustments}</a:prstGeom>` +
      `<a:solidFill><a:srgbClr val="${ov.color.toUpperCase()}">${alphaXml}</a:srgbClr></a:solidFill>` +
      `<a:ln><a:noFill/></a:ln>` +
      `</p:spPr>`;
    const emptyTxBody =
      `<p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="ctr"/><a:lstStyle/>` +
      `<a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>`;
    out += `<p:sp>${overlayNvSpPr}${overlaySpPr}${emptyTxBody}</p:sp>`;
  }
  return out;
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
  shadow?: { color: string; alpha?: number; blur?: number; dx?: number; dy?: number },
): string {
  const fillXml = fillXmlOf(fill);
  const lineXml = lineXmlOf(line);
  const geomXml = `<a:prstGeom prst="${geom}">${adjustments ?? `<a:avLst/>`}</a:prstGeom>`;
  const effectLstXml = shadow ? buildShadowEffectLst(shadow) : "";
  return `<p:spPr>${xfrmXml(xfrm)}${geomXml}${fillXml}${lineXml}${effectLstXml}</p:spPr>`;
}

function buildShadowEffectLst(sh: { color: string; alpha?: number; blur?: number; dx?: number; dy?: number }): string {
  const blurEmu = Math.round(sh.blur ?? 76200);
  const dx = Math.round(sh.dx ?? 0);
  const dy = Math.round(sh.dy ?? 38100);
  const dist = Math.round(Math.sqrt(dx * dx + dy * dy));
  const dirDeg = dist === 0 ? 0 : Math.round((Math.atan2(dy, dx) * 180 / Math.PI) * 60000);
  const alphaXml = sh.alpha !== undefined && sh.alpha < 1
    ? `<a:alpha val="${Math.round(sh.alpha * 100000)}"/>`
    : "";
  return (
    `<a:effectLst>` +
    `<a:outerShdw blurRad="${blurEmu}" dist="${dist}" dir="${dirDeg}" algn="tl" rotWithShape="0">` +
    `<a:srgbClr val="${sh.color.toUpperCase()}">${alphaXml}</a:srgbClr>` +
    `</a:outerShdw>` +
    `</a:effectLst>`
  );
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

/**
 * Compute symmetric `<a:srcRect>` crop fractions so a source image of
 * (srcW × srcH) fills a target rect of (tgtW × tgtH) without distortion.
 * Crops the longer dimension; the shorter dimension is untouched.
 */
function coverCrop(srcW: number, srcH: number, tgtW: number, tgtH: number):
  { left: number; right: number; top: number; bottom: number } | undefined {
  if (srcW <= 0 || srcH <= 0 || tgtW <= 0 || tgtH <= 0) return undefined;
  const srcAspect = srcW / srcH;
  const tgtAspect = tgtW / tgtH;
  const EPS = 0.005;
  if (Math.abs(srcAspect - tgtAspect) < EPS) return undefined;
  if (srcAspect > tgtAspect) {
    // Source wider than target — crop sides.
    const visibleFraction = tgtAspect / srcAspect;
    const totalCrop = (1 - visibleFraction) / 2;
    return { left: totalCrop, right: totalCrop, top: 0, bottom: 0 };
  }
  // Source taller than target — crop top/bottom.
  const visibleFraction = srcAspect / tgtAspect;
  const totalCrop = (1 - visibleFraction) / 2;
  return { left: 0, right: 0, top: totalCrop, bottom: totalCrop };
}

/**
 * Compute `<a:fillRect>` insets so a source image of (srcW × srcH) fits
 * inside a target rect of (tgtW × tgtH) without cropping (letterbox).
 * Returns insets as fractions of the target dimensions.
 */
function containFill(srcW: number, srcH: number, tgtW: number, tgtH: number):
  { left: number; right: number; top: number; bottom: number } | undefined {
  if (srcW <= 0 || srcH <= 0 || tgtW <= 0 || tgtH <= 0) return undefined;
  const srcAspect = srcW / srcH;
  const tgtAspect = tgtW / tgtH;
  const EPS = 0.005;
  if (Math.abs(srcAspect - tgtAspect) < EPS) return undefined;
  if (srcAspect > tgtAspect) {
    // Source wider than target — letterbox top/bottom.
    const drawnHeight = tgtW / srcAspect;
    const totalInset = (tgtH - drawnHeight) / tgtH / 2;
    return { left: 0, right: 0, top: totalInset, bottom: totalInset };
  }
  const drawnWidth = tgtH * srcAspect;
  const totalInset = (tgtW - drawnWidth) / tgtW / 2;
  return { left: totalInset, right: totalInset, top: 0, bottom: 0 };
}

function fillXmlOf(fill: FillSpec | undefined): string {
  if (!fill || fill.type === "none") return `<a:noFill/>`;
  if (fill.type === "gradient") return gradientFillXml(fill, "Shape.fill");
  assertHex(fill.color, "Shape.fill.color");
  const alphaXml = fill.alpha !== undefined && fill.alpha < 1
    ? `<a:alpha val="${Math.round(fill.alpha * 100000)}"/>`
    : "";
  return `<a:solidFill><a:srgbClr val="${fill.color.toUpperCase()}">${alphaXml}</a:srgbClr></a:solidFill>`;
}

export function gradientFillXml(fill: Extract<FillSpec, { type: "gradient" }>, ownerLabel: string): string {
  const stops = (fill.stops && fill.stops.length >= 2 ? fill.stops : null);
  if (!stops) return `<a:noFill/>`;
  const stopXml = stops
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((stop) => {
      assertHex(stop.color, `${ownerLabel}.stop.color`);
      const alphaXml = stop.alpha !== undefined && stop.alpha < 1 ? `<a:alpha val="${Math.round(stop.alpha * 100000)}"/>` : "";
      const pos = Math.max(0, Math.min(100, stop.position));
      return `<a:gs pos="${Math.round(pos * 1000)}"><a:srgbClr val="${stop.color.toUpperCase()}">${alphaXml}</a:srgbClr></a:gs>`;
    })
    .join("");
  if (fill.kind === "radial") {
    return `<a:gradFill flip="none" rotWithShape="1"><a:gsLst>${stopXml}</a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill>`;
  }
  // OOXML lin angle uses 60000ths of a degree, with 0 = pointing right.
  // Our angle convention (0 = top→bottom) maps to OOXML by adding 90 deg.
  const cssAngle = typeof fill.angle === "number" ? fill.angle : 180;
  const ooxmlAngle = ((cssAngle - 90) % 360 + 360) % 360;
  const angleAttr = Math.round(ooxmlAngle * 60000);
  return `<a:gradFill flip="none" rotWithShape="1"><a:gsLst>${stopXml}</a:gsLst><a:lin ang="${angleAttr}" scaled="0"/></a:gradFill>`;
}

function lineXmlOf(line: LineSpec | undefined): string {
  if (!line) return `<a:ln><a:noFill/></a:ln>`;
  assertHex(line.color, "Shape.line.color");
  const dashXml = line.dash && line.dash !== "solid"
    ? `<a:prstDash val="${line.dash}"/>`
    : "";
  const alphaXml = line.alpha !== undefined && line.alpha < 1
    ? `<a:alpha val="${Math.round(line.alpha * 100000)}"/>`
    : "";
  return (
    `<a:ln w="${Math.round(line.width)}">` +
    `<a:solidFill><a:srgbClr val="${line.color.toUpperCase()}">${alphaXml}</a:srgbClr></a:solidFill>` +
    dashXml +
    `</a:ln>`
  );
}
