/**
 * Speaker-notes parts.
 *
 * When a slide carries `notes`, we emit:
 *   - `ppt/notesSlides/notesSlide{N}.xml`
 *   - `ppt/notesSlides/_rels/notesSlide{N}.xml.rels` linking to notesMaster + slide
 *   - one slide-level rel pointing at the notesSlide
 *   - one Content_Types override
 *
 * The notesMaster is shared across the deck and is emitted once (see
 * `notesMasterXml`).
 *
 * Schema compliance — both `notesMaster1.xml` and `notesSlide{N}.xml`
 * include the FULL standard placeholder set (header, date, slide-image,
 * notes-body, footer, slide-number). PowerPoint refuses to open the file
 * when these are missing, even though OOXML schema allows empty `spTree`.
 * This matches the placeholder structure python-pptx and the Office
 * default theme produce.
 */

import { escapeText } from "./xml.js";

const SLIDE_NS =
  ` xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"` +
  ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"` +
  ` xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;

// Standard placeholder dimensions copied from the python-pptx default.
// Values are in EMU; positions assume the standard notes page (6858000 × 9144000).
const PLACEHOLDER_DIMS = {
  hdr:    { x:        0, y:        0, cx: 2971800, cy:  458788 },
  dt:     { x:  3884613, y:        0, cx: 2971800, cy:  458788 },
  sldImg: { x:   685800, y:   685800, cx: 5486400, cy: 3086100 },
  body:   { x:   685800, y:  3884613, cx: 5486400, cy: 4351338 },
  ftr:    { x:        0, y:  8685213, cx: 2971800, cy:  458788 },
  sldNum: { x:  3884613, y:  8685213, cx: 2971800, cy:  458788 },
} as const;

function placeholderSp(
  id: number,
  name: string,
  phType: keyof typeof PLACEHOLDER_DIMS,
  phSz: "quarter" | "half" | "full" | undefined,
  phIdx: number | undefined,
  body: string,
): string {
  const dims = PLACEHOLDER_DIMS[phType];
  const phAttrs =
    `type="${phType}"` +
    (phSz ? ` sz="${phSz}"` : "") +
    (phIdx !== undefined ? ` idx="${phIdx}"` : "");
  return (
    `<p:sp>` +
    `<p:nvSpPr>` +
    `<p:cNvPr id="${id}" name="${name}"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph ${phAttrs}/></p:nvPr>` +
    `</p:nvSpPr>` +
    `<p:spPr>` +
    `<a:xfrm><a:off x="${dims.x}" y="${dims.y}"/><a:ext cx="${dims.cx}" cy="${dims.cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `</p:spPr>` +
    body +
    `</p:sp>`
  );
}

const EMPTY_BODY =
  `<p:txBody>` +
  `<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"/>` +
  `<a:lstStyle/>` +
  `<a:p><a:endParaRPr lang="en-US"/></a:p>` +
  `</p:txBody>`;

/** Build `notesSlide{N}.xml` with the full standard placeholder set. */
export function notesSlideXml(notes: string, slideNumber: number): string {
  const escaped = escapeText(notes);
  const fldGuid = `{${stableGuid(slideNumber)}}`;

  // Notes body — carries the actual note text.
  const notesBody =
    `<p:txBody>` +
    `<a:bodyPr/>` +
    `<a:lstStyle/>` +
    `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t xml:space="preserve">${escaped}</a:t></a:r></a:p>` +
    `</p:txBody>`;

  // Slide number placeholder — auto-fills with the page number.
  const sldNumBody =
    `<p:txBody>` +
    `<a:bodyPr/>` +
    `<a:lstStyle/>` +
    `<a:p><a:fld id="${fldGuid}" type="slidenum"><a:rPr lang="en-US"/><a:t>${slideNumber}</a:t></a:fld></a:p>` +
    `</p:txBody>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes${SLIDE_NS}>
<p:cSld>
<p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
${placeholderSp(2, "Header Placeholder 1", "hdr", "quarter", undefined, EMPTY_BODY)}
${placeholderSp(3, "Date Placeholder 2", "dt", "half", undefined, EMPTY_BODY)}
${placeholderSp(4, "Slide Image Placeholder 3", "sldImg", undefined, undefined, EMPTY_BODY)}
${placeholderSp(5, "Notes Placeholder 4", "body", undefined, 1, notesBody)}
${placeholderSp(6, "Footer Placeholder 5", "ftr", "quarter", undefined, EMPTY_BODY)}
${placeholderSp(7, "Slide Number Placeholder 6", "sldNum", "quarter", undefined, sldNumBody)}
</p:spTree>
</p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:notes>`;
}

/** rels for one notesSlide: link to slide{N}.xml and the notesMaster. */
export function notesSlideRelsXml(slideNumber: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide${slideNumber}.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/>
</Relationships>`;
}

/** `notesMaster1.xml` with the full standard placeholder set + notesStyle. */
export function notesMasterXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notesMaster${SLIDE_NS}>
<p:cSld>
<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>
<p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
${placeholderSp(2, "Header Placeholder 1", "hdr", "quarter", undefined, EMPTY_BODY)}
${placeholderSp(3, "Date Placeholder 2", "dt", "half", undefined, EMPTY_BODY)}
${placeholderSp(4, "Slide Image Placeholder 3", "sldImg", undefined, undefined, EMPTY_BODY)}
${placeholderSp(5, "Notes Placeholder 4", "body", undefined, 1, EMPTY_BODY)}
${placeholderSp(6, "Footer Placeholder 5", "ftr", "quarter", undefined, EMPTY_BODY)}
${placeholderSp(7, "Slide Number Placeholder 6", "sldNum", "quarter", undefined, EMPTY_BODY)}
</p:spTree>
</p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:notesStyle>
<a:lvl1pPr marL="0" indent="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">
<a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr>
</a:lvl1pPr>
</p:notesStyle>
</p:notesMaster>`;
}

export function notesMasterRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;
}

/** Stable GUID per slide number — Office expects field IDs to be unique. */
function stableGuid(seed: number): string {
  // Format: 8-4-4-4-12 hex chars. Deterministic from `seed`.
  const hex = (n: number, w: number) => n.toString(16).padStart(w, "0").slice(-w).toUpperCase();
  return `${hex(seed * 0x9e3779b1, 8)}-${hex(seed * 0x85ebca6b, 4)}-4${hex(seed * 0xc2b2ae35, 3)}-A${hex(seed * 0x27d4eb2f, 3)}-${hex(seed * 0x165667b1, 12)}`;
}
