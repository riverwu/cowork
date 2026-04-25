import { EMU_PER_INCH, emuToInches, type Box, type FillStyle, type ImageCrop, type ImageElement, type LineStyle, type PresentationModel, type ShapeEffects, type ShapeElement, type ShapeTransform, type SlideBackground, type SlideElement, type SlideModel, type TableElement, type TableRow, type TextElement, type TextLayout } from "./presentation-model";
import { parseOoxmlTheme, resolveOoxmlColor, type OoxmlTheme } from "./ooxml-theme";

export interface PptxPackage {
  files: Record<string, string>;
  media?: Record<string, { mime_type: string; data: string }>;
}

interface Relationship {
  id: string;
  type: string;
  target: string;
}

const DEFAULT_WIDE_SIZE = { width: 13.3333, height: 7.5, unit: "in" as const };

export function importPptxPackage(pkg: PptxPackage, title = "Presentation"): PresentationModel {
  const presentationXml = pkg.files["ppt/presentation.xml"] || "";
  const presentationRels = parseRelationships(pkg.files["ppt/_rels/presentation.xml.rels"] || "");
  const size = parseSlideSize(presentationXml);
  const presentationTheme = resolvePresentationTheme(pkg, presentationRels);
  const slidePaths = resolveSlidePaths(pkg.files, presentationXml, presentationRels);
  const slides = slidePaths.map((slidePath, index) => parseSlide(pkg, slidePath, index + 1, presentationTheme));
  const mediaPaths = Object.keys(pkg.media || {}).filter((file) => file.startsWith("ppt/media/"));

  return {
    id: "presentation",
    title,
    size,
    slides,
    media: mediaPaths.map((path, index) => ({
      id: `media_${index + 1}`,
      path,
      contentType: pkg.media?.[path]?.mime_type || null,
      dataUri: mediaDataUri(pkg, path),
    })),
  };
}

function parseSlideSize(xml: string): PresentationModel["size"] {
  const tag = firstTag(xml, "p:sldSz");
  if (!tag) return DEFAULT_WIDE_SIZE;
  const attrs = attrsFromTag(tag);
  return {
    width: emuToInches(attrs.cx),
    height: emuToInches(attrs.cy),
    unit: "in",
  };
}

function resolveSlidePaths(files: Record<string, string>, presentationXml: string, rels: Relationship[]): string[] {
  const ids = [...presentationXml.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"[^>]*>/g)].map((match) => match[1]);
  const relById = new Map(rels.map((rel) => [rel.id, rel]));
  const paths = ids
    .map((id) => relById.get(id)?.target)
    .filter((target): target is string => Boolean(target))
    .map((target) => normalizePackagePath("ppt", target));

  if (paths.length > 0) return paths;

  return Object.keys(files)
    .filter((file) => /^ppt\/slides\/slide\d+\.xml$/.test(file))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
}

function parseSlide(pkg: PptxPackage, slidePath: string, index: number, presentationTheme: OoxmlTheme | null): SlideModel {
  const xml = pkg.files[slidePath] || "";
  const rels = parseRelationships(pkg.files[relsPathForPart(slidePath)] || "");
  const mediaByRel = new Map(rels.map((rel) => [rel.id, normalizePackagePath("ppt/slides", rel.target)]));
  const layoutPath = resolveRelatedPartPath(slidePath, rels, "slideLayout");
  const layoutXml = layoutPath ? pkg.files[layoutPath] || "" : "";
  const layoutRels = layoutPath ? parseRelationships(pkg.files[relsPathForPart(layoutPath)] || "") : [];
  const masterPath = layoutPath ? resolveRelatedPartPath(layoutPath, layoutRels, "slideMaster") : null;
  const masterXml = masterPath ? pkg.files[masterPath] || "" : "";
  const masterRels = masterPath ? parseRelationships(pkg.files[relsPathForPart(masterPath)] || "") : [];
  const theme = resolveSlideTheme(pkg, masterPath, masterRels) || presentationTheme;
  const placeholderDefaults = buildPlaceholderDefaults(pkg, layoutPath, layoutXml, masterPath, masterXml, theme);
  const elements = applyPlaceholderDefaults(parseSlideElements(pkg, xml, slidePath, mediaByRel, theme), placeholderDefaults);
  const title = findSlideTitle(elements);

  return {
    id: `slide_${index}`,
    index,
    title,
    background: parseBackground(xml, theme) || parseBackground(layoutXml, theme) || parseBackground(masterXml, theme) || { color: "#FFFFFF" },
    elements,
    sourceRef: { packagePath: slidePath },
  };
}

function parseSlideElements(pkg: PptxPackage, xml: string, slidePath: string, mediaByRel: Map<string, string>, theme?: OoxmlTheme | null): SlideElement[] {
  const elements: SlideElement[] = [];
  const counters = { sp: 0, pic: 0, graphicFrame: 0 };

  for (const item of extractSlideElementBlocks(xml)) {
    if (item.tag === "p:sp") {
      counters.sp += 1;
      const element = parseShapeOrTextElement(item.block, slidePath, counters.sp, theme);
      elements.push(element);
    } else if (item.tag === "p:pic") {
      counters.pic += 1;
      elements.push(parseImageElement(pkg, item.block, slidePath, counters.pic, mediaByRel));
    } else if (item.tag === "p:graphicFrame") {
      counters.graphicFrame += 1;
      const table = parseTableElement(item.block, slidePath, counters.graphicFrame, theme);
      if (table) elements.push(table);
    }
  }

  return elements;
}

function parseShapeOrTextElement(block: string, slidePath: string, shapeIndex: number, theme?: OoxmlTheme | null): TextElement | ShapeElement {
    const text = decodeXml(extractText(block)).trim();
    const common = {
      id: stableElementId(slidePath, "sp", shapeIndex),
      name: decodeXml(attrFromFirstTag(block, "p:cNvPr", "name") || `Shape ${shapeIndex}`),
      bbox: parseTransform(block),
      sourceRef: { packagePath: slidePath, xmlPath: `p:sp[${shapeIndex}]` },
    };
    if (text) {
      return {
        ...common,
        type: "text",
        text,
        placeholder: attrFromFirstTag(block, "p:ph", "type"),
        placeholderIndex: attrFromFirstTag(block, "p:ph", "idx"),
        style: {
          fontSize: parseFontSize(block),
          color: parseTextColor(block, theme),
          bold: /\ba:b="1"\b|\bb="1"/.test(block),
          fontFace: attrFromFirstTag(block, "a:latin", "typeface"),
        },
        layout: parseTextLayout(block),
      } satisfies TextElement;
    }
    return {
      ...common,
      type: "shape",
      shapeType: attrFromFirstTag(block, "a:prstGeom", "prst") || "rect",
      placeholder: attrFromFirstTag(block, "p:ph", "type"),
      placeholderIndex: attrFromFirstTag(block, "p:ph", "idx"),
      fill: parseFillStyle(block, theme),
      line: parseLineStyle(block, theme),
      effects: parseShapeEffects(block, theme),
      transform: parseShapeTransform(block),
    } satisfies ShapeElement;
}

function parseImageElement(pkg: PptxPackage, block: string, slidePath: string, picIndex: number, mediaByRel: Map<string, string>): ImageElement {
  const relId = attrFromFirstTag(block, "a:blip", "r:embed");
  const mediaPath = relId ? mediaByRel.get(relId) || null : null;
  return {
    id: stableElementId(slidePath, "pic", picIndex),
    name: decodeXml(attrFromFirstTag(block, "p:cNvPr", "name") || `Picture ${picIndex}`),
    type: "image",
    bbox: parseTransform(block),
    relationshipId: relId,
    mediaPath,
    dataUri: mediaPath ? mediaDataUri(pkg, mediaPath) : null,
    crop: parseImageCrop(block),
    opacity: parseImageOpacity(block),
    transform: parseShapeTransform(block),
    sourceRef: { packagePath: slidePath, xmlPath: `p:pic[${picIndex}]` },
  } satisfies ImageElement;
}

function parseTableElement(block: string, slidePath: string, index: number, theme?: OoxmlTheme | null): TableElement | null {
  const tableBlock = extractFirstBlock(block, "a:tbl");
  if (!tableBlock) return null;
  const columns = extractTags(tableBlock, "a:gridCol")
    .map((column) => emuToInches(attrsFromTag(column).w));
  const rows: TableRow[] = extractBlocks(tableBlock, "a:tr").map((rowBlock) => {
    const rowAttrs = attrsFromTag(firstTag(rowBlock, "a:tr") || "");
    return {
      height: rowAttrs.h ? emuToInches(rowAttrs.h) : null,
      cells: extractBlocks(rowBlock, "a:tc").map((cellBlock) => {
        const gridSpan = attrFromFirstTag(cellBlock, "a:gridSpan", "val");
        const rowSpan = attrFromFirstTag(cellBlock, "a:rowSpan", "val");
        return {
          text: decodeXml(extractText(cellBlock)).trim(),
          fill: parseFillStyle(cellBlock, theme),
          borders: parseTableCellBorders(cellBlock, theme),
          textStyle: {
            fontSize: parseFontSize(cellBlock),
            color: parseTextColor(cellBlock, theme),
            bold: /\ba:b="1"\b|\bb="1"/.test(cellBlock),
            fontFace: attrFromFirstTag(cellBlock, "a:latin", "typeface"),
          },
          layout: parseTextLayout(cellBlock),
          colSpan: gridSpan ? Number(gridSpan) : null,
          rowSpan: rowSpan ? Number(rowSpan) : null,
        };
      }),
    };
  });
  if (rows.length === 0) return null;
  const tablePr = firstTag(tableBlock, "a:tblPr") || "";
  const tablePrAttrs = attrsFromTag(tablePr);
  return {
    id: stableElementId(slidePath, "table", index),
    name: decodeXml(attrFromFirstTag(block, "p:cNvPr", "name") || `Table ${index}`),
    type: "table",
    bbox: parseTransform(block),
    columns,
    rows,
    style: {
      firstRow: tablePrAttrs.firstRow === "1",
      bandRow: tablePrAttrs.bandRow === "1",
      borderColor: null,
    },
    sourceRef: { packagePath: slidePath, xmlPath: `p:graphicFrame[${index}]/a:tbl` },
  };
}

function parseTableCellBorders(block: string, theme?: OoxmlTheme | null): TableElement["rows"][number]["cells"][number]["borders"] {
  return {
    top: parseTableCellBorder(block, "a:lnT", theme),
    right: parseTableCellBorder(block, "a:lnR", theme),
    bottom: parseTableCellBorder(block, "a:lnB", theme),
    left: parseTableCellBorder(block, "a:lnL", theme),
  };
}

function parseTableCellBorder(block: string, tag: string, theme?: OoxmlTheme | null): LineStyle | null {
  const line = firstTag(block, tag);
  if (!line) return null;
  const attrs = attrsFromTag(line);
  const lineBlock = extractFirstBlock(block, tag) || line;
  return {
    color: parseFillColor(lineBlock, theme),
    width: parseEmuToPoints(attrs.w),
    dash: attrFromFirstTag(lineBlock, "a:prstDash", "val"),
  };
}

function buildPlaceholderDefaults(
  pkg: PptxPackage,
  layoutPath: string | null,
  layoutXml: string,
  masterPath: string | null,
  masterXml: string,
  theme?: OoxmlTheme | null,
): Map<string, SlideElement> {
  const defaults = new Map<string, SlideElement>();
  const addDefaults = (partPath: string | null, xml: string) => {
    if (!partPath || !xml) return;
    const rels = parseRelationships(pkg.files[relsPathForPart(partPath)] || "");
    const mediaByRel = new Map(rels.map((rel) => [rel.id, normalizePackagePath(pathDir(partPath), rel.target)]));
    for (const element of parseSlideElements(pkg, xml, partPath, mediaByRel, theme)) {
      const key = placeholderKey(element);
      if (key) defaults.set(key, element);
    }
  };
  addDefaults(masterPath, masterXml);
  addDefaults(layoutPath, layoutXml);
  return defaults;
}

function applyPlaceholderDefaults(elements: SlideElement[], defaults: Map<string, SlideElement>): SlideElement[] {
  return elements.map((element) => {
    const fallback = defaults.get(placeholderKey(element));
    if (!fallback) return element;
    const bbox = hasBox(element.bbox) ? element.bbox : fallback.bbox;
    if (element.type === "text" && fallback.type === "text") {
      return {
        ...element,
        bbox,
        style: {
          fontFace: element.style.fontFace || fallback.style.fontFace,
          fontSize: element.style.fontSize || fallback.style.fontSize,
          color: element.style.color || fallback.style.color,
          bold: element.style.bold || fallback.style.bold,
        },
        layout: {
          ...fallback.layout,
          ...element.layout,
        },
      };
    }
    if (element.type === "shape" && fallback.type === "shape") {
      return {
        ...element,
        bbox,
        fill: element.fill || fallback.fill,
        line: element.line || fallback.line,
        effects: element.effects || fallback.effects,
        transform: element.transform || fallback.transform,
      };
    }
    return { ...element, bbox };
  });
}

function parseTransform(block: string): Box {
  const off = firstTag(block, "a:off");
  const ext = firstTag(block, "a:ext");
  const offAttrs = attrsFromTag(off || "");
  const extAttrs = attrsFromTag(ext || "");
  return {
    x: emuToInches(offAttrs.x),
    y: emuToInches(offAttrs.y),
    w: emuToInches(extAttrs.cx),
    h: emuToInches(extAttrs.cy),
  };
}

function parseBackground(xml: string, theme?: OoxmlTheme | null): SlideBackground | null {
  const bg = extractFirstBlock(xml, "p:bg");
  if (!bg) return null;
  const color = parseFillColor(bg, theme);
  return color ? { color } : null;
}

function parseFontSize(block: string): number | null {
  const size = attrFromFirstTag(block, "a:rPr", "sz") || attrFromFirstTag(block, "a:defRPr", "sz");
  if (!size) return null;
  return Number((Number(size) / 100).toFixed(1));
}

function parseTextLayout(block: string): TextLayout {
  const bodyPr = firstTag(block, "a:bodyPr") || "";
  const firstParagraph = extractFirstBlock(block, "a:p") || "";
  const pPr = firstTag(firstParagraph, "a:pPr") || "";
  return {
    horizontalAlign: parseHorizontalAlign(attrsFromTag(pPr).algn),
    verticalAlign: parseVerticalAlign(attrsFromTag(bodyPr).anchor),
    marginLeft: parseInset(attrsFromTag(bodyPr).lIns),
    marginRight: parseInset(attrsFromTag(bodyPr).rIns),
    marginTop: parseInset(attrsFromTag(bodyPr).tIns),
    marginBottom: parseInset(attrsFromTag(bodyPr).bIns),
    lineSpacing: parseLineSpacing(firstParagraph),
    bullet: /<a:bu(Char|AutoNum|Blip)\b/.test(firstParagraph),
    autoFit: /<a:spAutoFit\b/.test(block) ? "resize_shape" : /<a:normAutofit\b/.test(block) ? "shrink" : /<a:noAutofit\b/.test(block) ? "none" : null,
  };
}

function parseHorizontalAlign(value: string | undefined): TextLayout["horizontalAlign"] {
  if (value === "ctr") return "center";
  if (value === "r") return "right";
  if (value === "just" || value === "justLow") return "justify";
  if (value === "l") return "left";
  return null;
}

function parseVerticalAlign(value: string | undefined): TextLayout["verticalAlign"] {
  if (value === "mid" || value === "ctr") return "middle";
  if (value === "b") return "bottom";
  if (value === "t") return "top";
  return null;
}

function parseInset(value: string | undefined): number | null {
  if (!value) return null;
  return Number((Number(value) / EMU_PER_INCH).toFixed(4));
}

function parseLineSpacing(paragraph: string): number | null {
  const lnSpc = extractFirstBlock(paragraph, "a:lnSpc");
  if (!lnSpc) return null;
  const pct = attrFromFirstTag(lnSpc, "a:spcPct", "val");
  if (pct) return Number((Number(pct) / 100000).toFixed(3));
  const pts = attrFromFirstTag(lnSpc, "a:spcPts", "val");
  if (pts) return Number((Number(pts) / 100).toFixed(2));
  return null;
}

function parseTextColor(block: string, theme?: OoxmlTheme | null): string | null {
  const rPr = firstTag(block, "a:rPr") || firstTag(block, "a:defRPr");
  if (!rPr) return parseColor(block, theme);
  const start = block.indexOf(rPr);
  const nextTextEnd = block.indexOf("</a:rPr>", start);
  const scope = nextTextEnd > start ? block.slice(start, nextTextEnd) : block;
  return parseColor(scope, theme);
}

function parseFillColor(block: string, theme?: OoxmlTheme | null): string | null {
  if (/<a:noFill\b/.test(block)) return "transparent";
  const solidFill = extractFirstBlock(block, "a:solidFill");
  return solidFill ? parseColor(solidFill, theme) : parseColor(block, theme);
}

function parseFillStyle(block: string, theme?: OoxmlTheme | null): FillStyle | null {
  if (/<a:noFill\b/.test(block)) return { type: "none" };
  const gradFill = extractFirstBlock(block, "a:gradFill");
  if (gradFill) {
    const stops = extractBlocks(gradFill, "a:gs").map((stop) => ({
      position: Number(attrFromFirstTag(stop, "a:gs", "pos") || 0) / 100000,
      color: parseColor(stop, theme) || "#000000",
    }));
    return {
      type: "gradient",
      stops,
      angle: parseAngle(attrFromFirstTag(gradFill, "a:lin", "ang")),
    };
  }
  const solidFill = extractFirstBlock(block, "a:solidFill");
  const color = solidFill ? parseColor(solidFill, theme) : null;
  return color ? { type: "solid", color } : null;
}

function parseLineStyle(block: string, theme?: OoxmlTheme | null): LineStyle | null {
  const line = extractFirstBlock(block, "a:ln");
  if (!line || /<a:noFill\b/.test(line)) return null;
  return {
    color: parseFillColor(line, theme),
    width: parseEmuToPoints(attrFromFirstTag(line, "a:ln", "w")),
    dash: attrFromFirstTag(line, "a:prstDash", "val"),
  };
}

function parseShapeEffects(block: string, theme?: OoxmlTheme | null): ShapeEffects | null {
  const shadow = extractFirstBlock(block, "a:outerShdw");
  if (!shadow) return null;
  return {
    shadow: {
      color: parseColor(shadow, theme),
      blur: parseEmuToPoints(attrFromFirstTag(shadow, "a:outerShdw", "blurRad")),
      distance: parseEmuToPoints(attrFromFirstTag(shadow, "a:outerShdw", "dist")),
      direction: parseAngle(attrFromFirstTag(shadow, "a:outerShdw", "dir")),
    },
  };
}

function parseShapeTransform(block: string): ShapeTransform | null {
  const xfrm = firstTag(block, "a:xfrm");
  if (!xfrm) return null;
  const attrs = attrsFromTag(xfrm);
  return {
    rotation: parseAngle(attrs.rot),
    flipH: attrs.flipH === "1",
    flipV: attrs.flipV === "1",
  };
}

function parseImageCrop(block: string): ImageCrop | null {
  const srcRect = firstTag(block, "a:srcRect");
  if (!srcRect) return null;
  const attrs = attrsFromTag(srcRect);
  return {
    left: parseCropPercent(attrs.l),
    right: parseCropPercent(attrs.r),
    top: parseCropPercent(attrs.t),
    bottom: parseCropPercent(attrs.b),
  };
}

function parseCropPercent(value: string | undefined): number | null {
  if (!value) return null;
  return Number((Number(value) / 100000).toFixed(4));
}

function parseImageOpacity(block: string): number | null {
  const blip = extractFirstBlock(block, "a:blip") || firstTag(block, "a:blip") || "";
  const alpha = attrFromFirstTag(blip, "a:alpha", "val");
  if (alpha) return Number((Number(alpha) / 100000).toFixed(3));
  const alphaModFix = attrFromFirstTag(blip, "a:alphaModFix", "amt");
  if (alphaModFix) return Number((Number(alphaModFix) / 100000).toFixed(3));
  return null;
}

function parseColor(block: string, theme?: OoxmlTheme | null): string | null {
  return resolveOoxmlColor(block, theme);
}

function parseEmuToPoints(value: string | null | undefined): number | null {
  if (!value) return null;
  return Number((Number(value) / 12700).toFixed(2));
}

function parseAngle(value: string | null | undefined): number | null {
  if (!value) return null;
  return Number((Number(value) / 60000).toFixed(2));
}

function findSlideTitle(elements: SlideElement[]): string | null {
  const title = elements.find((element) => element.type === "text" && ["title", "ctrTitle"].includes(element.placeholder || ""));
  if (title?.type === "text") return title.text;
  const firstText = elements.find((element) => element.type === "text");
  return firstText?.type === "text" ? firstText.text : null;
}

function extractText(block: string): string {
  return extractBlocks(block, "a:p")
    .map((paragraph) => [...paragraph.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((match) => match[1]).join(""))
    .filter(Boolean)
    .join("\n");
}

function parseRelationships(xml: string): Relationship[] {
  return [...xml.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((match) => {
    const attrs = attrsFromTag(match[0]);
    return {
      id: attrs.Id || "",
      type: attrs.Type || "",
      target: attrs.Target || "",
    };
  }).filter((rel) => rel.id && rel.target);
}

function resolveRelatedPartPath(partPath: string, rels: Relationship[], type: string): string | null {
  const rel = rels.find((candidate) => candidate.type.includes(type) || candidate.target.includes(type));
  return rel ? normalizePackagePath(pathDir(partPath), rel.target) : null;
}

function resolvePresentationTheme(pkg: PptxPackage, presentationRels: Relationship[]): OoxmlTheme | null {
  const themePath = resolveRelatedPartPath("ppt/presentation.xml", presentationRels, "theme");
  return themePath && pkg.files[themePath] ? parseOoxmlTheme(pkg.files[themePath]) : null;
}

function resolveSlideTheme(pkg: PptxPackage, masterPath: string | null, masterRels: Relationship[]): OoxmlTheme | null {
  if (!masterPath) return null;
  const themePath = resolveRelatedPartPath(masterPath, masterRels, "theme");
  return themePath && pkg.files[themePath] ? parseOoxmlTheme(pkg.files[themePath]) : null;
}

function extractBlocks(xml: string, tag: string): string[] {
  const escaped = tag.replace(":", "\\:");
  return [...xml.matchAll(new RegExp(`<${escaped}\\b[\\s\\S]*?<\\/${escaped}>`, "g"))].map((match) => match[0]);
}

function extractSlideElementBlocks(xml: string): Array<{ tag: "p:sp" | "p:pic" | "p:graphicFrame"; block: string }> {
  return [...xml.matchAll(/<(p:sp|p:pic|p:graphicFrame)\b[\s\S]*?<\/\1>/g)]
    .map((match) => ({ tag: match[1] as "p:sp" | "p:pic" | "p:graphicFrame", block: match[0] }));
}

function extractFirstBlock(xml: string, tag: string): string | null {
  return extractBlocks(xml, tag)[0] || null;
}

function extractTags(xml: string, tag: string): string[] {
  const escaped = tag.replace(":", "\\:");
  return [...xml.matchAll(new RegExp(`<${escaped}\\b[^>]*\\/?>`, "g"))].map((match) => match[0]);
}

function firstTag(xml: string, tag: string): string | null {
  const escaped = tag.replace(":", "\\:");
  return xml.match(new RegExp(`<${escaped}\\b[^>]*>`, "m"))?.[0] || null;
}

function attrFromFirstTag(xml: string, tag: string, attr: string): string | null {
  const tagText = firstTag(xml, tag);
  return tagText ? attrsFromTag(tagText)[attr] || null : null;
}

function attrsFromTag(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:.-]+)="([^"]*)"/g)) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function relsPathForPart(partPath: string): string {
  const slash = partPath.lastIndexOf("/");
  const dir = partPath.slice(0, slash);
  const name = partPath.slice(slash + 1);
  return `${dir}/_rels/${name}.rels`;
}

function pathDir(partPath: string): string {
  const slash = partPath.lastIndexOf("/");
  return slash >= 0 ? partPath.slice(0, slash) : "";
}

function normalizePackagePath(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = `${baseDir}/${target}`.split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }
  return normalized.join("/");
}

function slideNumber(path: string): number {
  return Number(path.match(/slide(\d+)\.xml$/)?.[1] || 0);
}

function stableElementId(slidePath: string, type: string, index: number): string {
  const slide = slideNumber(slidePath) || 1;
  return `slide_${slide}_${type}_${index}`;
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function placeholderKey(element: SlideElement): string {
  if (element.type === "image" || element.type === "table") return "";
  const type = element.placeholder || "";
  const idx = element.placeholderIndex || "";
  if (!type && !idx) return "";
  return `${type}:${idx}`;
}

function hasBox(box: Box): boolean {
  return box.w > 0 && box.h > 0;
}

function mediaDataUri(pkg: PptxPackage, mediaPath: string): string | null {
  const media = pkg.media?.[mediaPath];
  if (!media?.data) return null;
  return `data:${media.mime_type || "application/octet-stream"};base64,${media.data}`;
}
