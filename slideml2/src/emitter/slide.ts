/**
 * Build `ppt/slides/slide{N}.xml` from a `SlideAst`.
 *
 * The slide envelope is fixed boilerplate; the variable parts are the
 * shape tree (`<p:spTree>`) and an optional background fill.
 */

import { gradientFillXml, shapeXml, type SlideRels } from "./shapes.js";
import { assertHex, xmlEscape } from "./xml.js";
import type { SlideAst } from "./types.js";

const SLIDE_NS =
  ` xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"` +
  ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"` +
  ` xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;

export interface SlideXml {
  /** The full `slide{N}.xml` body, ready to write to the package. */
  body: string;
  /** Relationships the slide accumulated (images, charts, etc). */
  rels: SlideRels;
}

/** Produce `slide{N}.xml` for one `SlideAst`. */
export function slideXml(slide: SlideAst, slidePart: string): SlideXml {
  const rels: SlideRels = { entries: [] };

  // Background image needs a slide-level rel BEFORE shape rels, so the
  // package emitter can match it deterministically. nextRelId for shapes
  // starts at rId2, so an image-bg consumes rId2 and bumps shapes to rId3+.
  const bgXml = backgroundXml(slide, rels);

  // Required first two shapes: the title placeholder and the body
  // placeholder slots are NOT mandatory in OOXML for slides that don't
  // declare placeholders. We simply emit a `nvGrpSpPr` group then our
  // content shapes.
  const groupHeader =
    `<p:nvGrpSpPr>` +
    `<p:cNvPr id="1" name=""/>` +
    `<p:cNvGrpSpPr/>` +
    `<p:nvPr/>` +
    `</p:nvGrpSpPr>` +
    `<p:grpSpPr>` +
    `<a:xfrm>` +
    `<a:off x="0" y="0"/>` +
    `<a:ext cx="0" cy="0"/>` +
    `<a:chOff x="0" y="0"/>` +
    `<a:chExt cx="0" cy="0"/>` +
    `</a:xfrm>` +
    `</p:grpSpPr>`;

  const shapeIdByName = collectShapeIds(slide.shapes);
  const shapesXml = slide.shapes.map((s) => shapeXml(s, slidePart, rels, { shapeIdByName })).join("");

  const spTree = `<p:spTree>${groupHeader}${shapesXml}</p:spTree>`;

  const cSld = `<p:cSld>${bgXml}${spTree}</p:cSld>`;
  const clrMapOvr = `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>`;

  const transition = transitionXml(slide);
  const body = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld${SLIDE_NS}>${cSld}${clrMapOvr}${transition}</p:sld>`;

  return { body, rels };
}

function collectShapeIds(shapes: SlideAst["shapes"], out = new Map<string, number>()): Map<string, number> {
  for (const shape of shapes) {
    if (typeof shape.name === "string" && shape.name && !out.has(shape.name)) out.set(shape.name, shape.id);
    if (shape.type === "group") collectShapeIds(shape.children, out);
  }
  return out;
}

function transitionXml(slide: SlideAst): string {
  const t = slide.transition;
  if (!t || t.type === "none") return "";
  const dur = typeof t.durationMs === "number" && Number.isFinite(t.durationMs)
    ? ` dur="${Math.max(0, Math.round(t.durationMs))}"`
    : "";
  const dir = t.direction === "left" ? "l" : t.direction === "right" ? "r" : t.direction === "up" ? "u" : t.direction === "down" ? "d" : undefined;
  const dirAttr = dir ? ` dir="${dir}"` : "";
  switch (t.type) {
    case "push": return `<p:transition${dur}><p:push${dirAttr}/></p:transition>`;
    case "wipe": return `<p:transition${dur}><p:wipe${dirAttr}/></p:transition>`;
    case "split": return `<p:transition${dur}><p:split orient="horz"/></p:transition>`;
    case "cover": return `<p:transition${dur}><p:cover${dirAttr}/></p:transition>`;
    case "uncover": return `<p:transition${dur}><p:uncover${dirAttr}/></p:transition>`;
    case "fade":
    default: return `<p:transition${dur}><p:fade/></p:transition>`;
  }
}

function backgroundXml(slide: SlideAst, rels: SlideRels): string {
  if (!slide.background) return "";
  if (slide.background.type === "solid") {
    assertHex(slide.background.color, "Slide.background.color");
    return (
      `<p:bg>` +
      `<p:bgPr>` +
      `<a:solidFill><a:srgbClr val="${slide.background.color.toUpperCase()}"/></a:solidFill>` +
      `<a:effectLst/>` +
      `</p:bgPr>` +
      `</p:bg>`
    );
  }
  if (slide.background.type === "gradient") {
    return (
      `<p:bg>` +
      `<p:bgPr>` +
      gradientFillXml(slide.background, "Slide.background") +
      `<a:effectLst/>` +
      `</p:bgPr>` +
      `</p:bg>`
    );
  }
  // Image background: register a slide-level image rel and emit blipFill.
  // The package emitter rewrites the placeholder Target to the actual
  // `../media/imageN.{ext}` once it has resolved the asset.
  const rId = `rId${rels.entries.length + 2}`; // rId1 reserved for slideLayout
  rels.entries.push({
    id: rId,
    type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
    target: `../media/__background-${slide.background.src}`, // package emitter rewrites
    role: "background-image",
    assetSrc: slide.background.src,
  });
  return (
    `<p:bg>` +
    `<p:bgPr>` +
    `<a:blipFill dpi="0" rotWithShape="1">` +
    `<a:blip r:embed="${rId}"/>` +
    `<a:srcRect/>` +
    `<a:stretch><a:fillRect/></a:stretch>` +
    `</a:blipFill>` +
    `<a:effectLst/>` +
    `</p:bgPr>` +
    `</p:bg>`
  );
}

/** Build the `slide{N}.xml.rels` document for a slide's relationships. */
export function slideRelsXml(rels: SlideRels, slideLayoutRId: string): string {
  // Every slide must have a relationship to its slideLayout.
  const layoutRel =
    `<Relationship Id="${slideLayoutRId}" ` +
    `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" ` +
    `Target="../slideLayouts/slideLayout1.xml"/>`;

  const otherRels = rels.entries
    .map((e) => {
      const tm = e.targetMode ? ` TargetMode="${xmlEscape(e.targetMode)}"` : "";
      const target = xmlEscape(e.target);
      return `<Relationship Id="${xmlEscape(e.id)}" Type="${xmlEscape(e.type)}" Target="${target}"${tm}/>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${layoutRel}${otherRels}</Relationships>`;
}
