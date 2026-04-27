/**
 * Build `ppt/slides/slide{N}.xml` from a `SlideAst`.
 *
 * The slide envelope is fixed boilerplate; the variable parts are the
 * shape tree (`<p:spTree>`) and an optional background fill.
 */

import { shapeXml, type SlideRels } from "./shapes.js";
import { assertHex } from "./xml.js";
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

  const bgXml = backgroundXml(slide);

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

  const shapesXml = slide.shapes.map((s) => shapeXml(s, slidePart, rels)).join("");

  const spTree = `<p:spTree>${groupHeader}${shapesXml}</p:spTree>`;

  const cSld = `<p:cSld>${bgXml}${spTree}</p:cSld>`;
  const clrMapOvr = `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>`;

  const body = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld${SLIDE_NS}>${cSld}${clrMapOvr}</p:sld>`;

  return { body, rels };
}

function backgroundXml(slide: SlideAst): string {
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
  // Image backgrounds: the package emitter will add the rel + media file
  // when it sees a `bgImage` marker. For Stage 2 we keep it simple — solid
  // only. Image-bg lands in Stage 3 alongside chrome.
  return "";
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
      const tm = e.targetMode ? ` TargetMode="${e.targetMode}"` : "";
      // Hyperlink targets must be XML-escaped (& → &amp;) but the target is
      // already a URL with possible &; we minimal-escape to keep it safe.
      const target = e.target.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
      return `<Relationship Id="${e.id}" Type="${e.type}" Target="${target}"${tm}/>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${layoutRel}${otherRels}</Relationships>`;
}
