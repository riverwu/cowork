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

// Standard placeholder dimensions for the notesMaster (notes page is
// 6858000 × 9144000 EMU). The master defines positions; the notesSlide
// inherits them via empty `<p:spPr/>`.
const MASTER_DIMS = {
  hdr:    { x:        0, y:        0, cx: 2971800, cy:  457200 },
  dt:     { x:  3884613, y:        0, cx: 2971800, cy:  457200 },
  sldImg: { x:  1143000, y:   685800, cx: 4572000, cy: 3429000 },
  body:   { x:   685800, y:  4343400, cx: 5486400, cy: 4114800 },
  ftr:    { x:        0, y:  8685213, cx: 2971800, cy:  457200 },
  sldNum: { x:  3884613, y:  8685213, cx: 2971800, cy:  457200 },
} as const;

// Per-placeholder ph attribute strings — the `idx` and `sz` values must
// match exactly what python-pptx / Office produce, otherwise PowerPoint
// flags the file as corrupted on open. Specifically:
//   - hdr/dt are default placeholders (no idx, only `sz` for hdr)
//   - sldImg=2, body=3, ftr=4, sldNum=5 — non-default, idx required
const PH_ATTRS = {
  hdr:    `type="hdr" sz="quarter"`,
  dt:     `type="dt" idx="1"`,
  sldImg: `type="sldImg" idx="2"`,
  body:   `type="body" sz="quarter" idx="3"`,
  ftr:    `type="ftr" sz="quarter" idx="4"`,
  sldNum: `type="sldNum" sz="quarter" idx="5"`,
} as const;

/** Master placeholder — full xfrm + prstGeom + bodyPr (it owns the layout). */
function masterPlaceholderSp(
  id: number,
  name: string,
  phType: keyof typeof MASTER_DIMS,
  body: string,
  spLocksExtra = "",
): string {
  const dims = MASTER_DIMS[phType];
  return (
    `<p:sp>` +
    `<p:nvSpPr>` +
    `<p:cNvPr id="${id}" name="${name}"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1"${spLocksExtra}/></p:cNvSpPr>` +
    `<p:nvPr><p:ph ${PH_ATTRS[phType]}/></p:nvPr>` +
    `</p:nvSpPr>` +
    `<p:spPr>` +
    `<a:xfrm><a:off x="${dims.x}" y="${dims.y}"/><a:ext cx="${dims.cx}" cy="${dims.cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `</p:spPr>` +
    body +
    `</p:sp>`
  );
}

/** Notes-slide placeholder — empty `<p:spPr/>` to inherit from the master. */
function slidePlaceholderSp(
  id: number,
  name: string,
  phType: "sldImg" | "body" | "sldNum",
  body: string,
): string {
  return (
    `<p:sp>` +
    `<p:nvSpPr>` +
    `<p:cNvPr id="${id}" name="${name}"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph ${PH_ATTRS[phType]}/></p:nvPr>` +
    `</p:nvSpPr>` +
    `<p:spPr/>` +
    body +
    `</p:sp>`
  );
}

const EMPTY_BODY =
  `<p:txBody>` +
  `<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/>` +
  `<a:lstStyle/>` +
  `<a:p><a:endParaRPr lang="en-US"/></a:p>` +
  `</p:txBody>`;

/**
 * Build `notesSlide{N}.xml`. Only emits the 3 placeholders the slide
 * customizes (sldImg, body, sldNum) — header/date/footer are inherited
 * from the master. Each placeholder uses `<p:spPr/>` (empty) so PowerPoint
 * pulls position from the master.
 *
 * Mirrors the python-pptx-generated structure exactly. Earlier we emitted
 * the full 6-placeholder set with custom positions on every notes slide,
 * which PowerPoint flagged as corrupted (placeholders override master
 * placeholders by `idx`, and an `idx` mismatch breaks rendering).
 */
export function notesSlideXml(notes: string, _slideNumber: number): string {
  const escaped = escapeText(notes);

  const notesBody =
    `<p:txBody>` +
    `<a:bodyPr/>` +
    `<a:lstStyle/>` +
    `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t xml:space="preserve">${escaped}</a:t></a:r></a:p>` +
    `</p:txBody>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes${SLIDE_NS}>
<p:cSld>
<p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
${slidePlaceholderSp(2, "Slide Image Placeholder 1", "sldImg", "")}
${slidePlaceholderSp(3, "Notes Placeholder 2", "body", notesBody)}
${slidePlaceholderSp(4, "Slide Number Placeholder 3", "sldNum", "")}
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
  // sldImg has noRot+noChangeAspect locks (PowerPoint requires these).
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notesMaster${SLIDE_NS}>
<p:cSld>
<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>
<p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
${masterPlaceholderSp(2, "Header Placeholder 1", "hdr", EMPTY_BODY)}
${masterPlaceholderSp(3, "Date Placeholder 2", "dt", EMPTY_BODY)}
${masterPlaceholderSp(4, "Slide Image Placeholder 3", "sldImg", EMPTY_BODY, ` noRot="1" noChangeAspect="1"`)}
${masterPlaceholderSp(5, "Notes Placeholder 4", "body", EMPTY_BODY)}
${masterPlaceholderSp(6, "Footer Placeholder 5", "ftr", EMPTY_BODY)}
${masterPlaceholderSp(7, "Slide Number Placeholder 6", "sldNum", EMPTY_BODY)}
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
  // theme2.xml is the notesMaster's OWN theme — see package.ts comment.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme2.xml"/>
</Relationships>`;
}

