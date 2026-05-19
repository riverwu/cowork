/**
 * Serialize text shapes — `<a:r>`, `<a:rPr>`, `<a:pPr>`, `<a:t>`, `<p:txBody>`.
 *
 * Vendored carve-out: structure mirrors PptxGenJS `gen-xml.ts`'s
 * `genXmlBodyProperties` / `genXmlTextRun`. We rewrote rather than copied
 * because their version supports a wider option surface — we only need
 * what SlideML's `TextShape` exposes.
 */

import { assertHex, attr, escapeText, xmlEscape } from "./xml.js";
import type { Paragraph, TextRun, TextShape } from "./types.js";
import { protectTextRunsForCjkLineBreaks } from "./text-protection.js";

/** Per-text-shape rels that the run-XML accumulates. The slide emitter
 *  passes a SlideRels-shaped accumulator so hyperlink rels land on the
 *  enclosing slide. */
export interface RunRels {
  /** Allocate the next free rId and remember a hyperlink target. Returns
   *  the rId to stamp on `<a:hlinkClick r:id="…"/>`. */
  addHyperlink(target: string): string;
}

/** Default text-box internal padding, ~0.1in in EMU. */
const DEFAULT_TEXT_MARGIN_EMU = 91440;

/**
 * Render a text shape's `<p:txBody>` block. The wrapper `<p:sp>` is built
 * by `shapes.ts`; this only emits the body. Hyperlink rels (if any text
 * run has `hyperlink`) are pushed through `rels`.
 */
export function txBody(shape: TextShape, rels?: RunRels): string {
  const margin = shape.margin ?? {};
  const lIns = margin.l ?? DEFAULT_TEXT_MARGIN_EMU;
  const tIns = margin.t ?? DEFAULT_TEXT_MARGIN_EMU;
  const rIns = margin.r ?? DEFAULT_TEXT_MARGIN_EMU;
  const bIns = margin.b ?? DEFAULT_TEXT_MARGIN_EMU;
  const anchor = shape.valign === "middle" ? "ctr" : shape.valign === "bottom" ? "b" : "t";

  // normAutofit semantics (CRITICAL): the optional `fontScale` /
  // `lnSpcReduction` attributes are NOT minimum-scale caps — they
  // specify "this body is ALREADY authored at this scale". Setting
  // `fontScale="85000"` tells the renderer "text in this shape is at
  // 85% of nominal size" and the renderer applies that scale
  // unconditionally on display, even when content fits natively. Earlier
  // versions emitted those attributes and produced visibly-small text
  // sitting in the top of an oversized-relative-to-content box.
  //
  // Bare `<a:normAutofit/>` is the right form for "shrink ONLY if
  // needed" — both PowerPoint and LibreOffice compute the actual scale
  // themselves at view time, applying nothing when the natural text
  // fits the box and shrinking just enough when it doesn't.
  const autoFitChild =
    shape.autoFit === "shrink" ? `<a:normAutofit/>` :
    shape.autoFit === "resize" ? `<a:spAutoFit/>` : "";
  const bodyPrAttrs =
    attr("wrap", shape.wrap ?? "square") +
    attr("lIns", lIns) +
    attr("tIns", tIns) +
    attr("rIns", rIns) +
    attr("bIns", bIns) +
    attr("anchor", anchor);
  const bodyPr = autoFitChild
    ? `<a:bodyPr${bodyPrAttrs}>${autoFitChild}</a:bodyPr>`
    : `<a:bodyPr${bodyPrAttrs}/>`;

  const lstStyle = `<a:lstStyle/>`;

  const paragraphs = shape.paragraphs.length > 0
    ? shape.paragraphs.map((p) => paragraphXml(p, rels)).join("")
    : `<a:p><a:endParaRPr lang="en-US"/></a:p>`;

  return `<p:txBody>${bodyPr}${lstStyle}${paragraphs}</p:txBody>`;
}

/** Render a single `<a:p>` paragraph with its runs. */
function paragraphXml(p: Paragraph, rels?: RunRels): string {
  const pPr = paragraphPropsXml(p);
  const protectedRuns = protectTextRunsForCjkLineBreaks(p.runs);
  const runs = protectedRuns.length > 0
    ? protectedRuns.map((r, i) => runXml(r, i === protectedRuns.length - 1, rels)).join("")
    : "";
  // Empty paragraphs still need an endParaRPr so PowerPoint doesn't drop them.
  const endRPr = protectedRuns.length === 0 ? `<a:endParaRPr lang="en-US"/>` : "";
  return `<a:p>${pPr}${runs}${endRPr}</a:p>`;
}

/** `<a:pPr>` — paragraph properties (alignment, indent, bullets, spacing). */
function paragraphPropsXml(p: Paragraph): string {
  const algn = p.align === "center" ? "ctr" : p.align === "right" ? "r" : p.align === "justify" ? "just" : undefined;
  const lvl = p.indentLevel && p.indentLevel > 0 ? p.indentLevel : undefined;

  const lnSpc = p.lineSpacingHalfPt
    ? `<a:lnSpc><a:spcPts val="${Math.round(p.lineSpacingHalfPt * 50)}"/></a:lnSpc>`
    : "";
  const spcAft = p.spaceAfterHalfPt
    ? `<a:spcAft><a:spcPts val="${Math.round(p.spaceAfterHalfPt * 50)}"/></a:spcAft>`
    : "";

  let bullet = "";
  if (p.bullet && "auto" in p.bullet && p.bullet.auto) {
    // Inherit from the layout's master bullet definition.
    bullet = `<a:buChar char="\u2022"/>`;
  } else if (p.bullet && "number" in p.bullet && p.bullet.number) {
    bullet = `<a:buAutoNum type="arabicPeriod"/>`;
  } else if (p.bullet && "char" in p.bullet && typeof p.bullet.char === "string" && p.bullet.char.length > 0) {
    // Explicit shape-glyph bullet: paint a colored, sized character before
    // each item. Order in OOXML CT_TextParagraphProperties is
    // buClr → buSzPct → buFont → buChar (xsd choice in that sequence).
    const buClr = typeof p.bullet.color === "string"
      ? `<a:buClr><a:srgbClr val="${p.bullet.color.toUpperCase()}"/></a:buClr>`
      : "";
    const sizeRaw = typeof p.bullet.sizePct === "number" ? p.bullet.sizePct : 0;
    const sizeClamped = sizeRaw > 0 ? Math.max(0.25, Math.min(4, sizeRaw)) : 0;
    const buSz = sizeClamped > 0 ? `<a:buSzPct val="${Math.round(sizeClamped * 100000)}"/>` : "";
    const buFont = typeof p.bullet.font === "string" && p.bullet.font.length > 0
      ? `<a:buFont typeface="${xmlEscape(p.bullet.font)}"/>`
      : "";
    bullet = `${buClr}${buSz}${buFont}<a:buChar char="${xmlEscape(p.bullet.char)}"/>`;
  } else if (!p.bullet) {
    // Explicit `buNone` so we don't inherit a stray bullet from the master.
    bullet = `<a:buNone/>`;
  }

  const marginLeft = typeof p.marginLeft === "number" ? Math.max(0, Math.round(p.marginLeft)) : undefined;
  const hanging = typeof p.hanging === "number" ? Math.round(p.hanging) : undefined;
  const attrs = attr("marL", marginLeft ?? (lvl ? lvl * 285750 : undefined)) +
                attr("lvl", lvl) +
                attr("indent", hanging ?? (lvl ? -285750 : undefined)) +
                attr("algn", algn) +
                attr("eaLnBrk", "1") +
                attr("latinLnBrk", "0") +
                attr("hangingPunct", "1");

  // Order matters for OOXML: spacing first, then bullet props.
  const inner = `${lnSpc}${spcAft}${bullet}`;
  return `<a:pPr${attrs}>${inner}</a:pPr>`;
}

/** `<a:r>` — one styled text run. */
function runXml(run: TextRun, isLast: boolean, rels?: RunRels): string {
  if (run.mathOmml) {
    if (run.color) assertHex(run.color, "TextRun.color");
    const mathOmml = run.color ? mathOmmlWithRunColor(run.mathOmml, run.color) : run.mathOmml;
    const softBreak = run.breakLine && !isLast ? `<a:br><a:rPr lang="en-US"/></a:br>` : "";
    return `<a14:m xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${mathOmml}</a14:m>${softBreak}`;
  }

  if (run.color) assertHex(run.color, "TextRun.color");

  // `sz` attribute is in HUNDREDTHS of a point per OOXML spec
  // (CT_TextCharacterProperties): 24pt → sz="2400". Our `sizeHalfPt` value
  // is in HALF-points (1 half-pt = 0.5pt = 50/100 of a point), so the
  // wire-format multiplier is × 50.
  const szValue = run.sizeHalfPt !== undefined ? Math.round(run.sizeHalfPt * 50) : undefined;
  // Hyperlinks default to underlined unless the caller explicitly opts out.
  const underlined = run.underline ?? !!run.hyperlink;

  // OOXML `baseline` is per-mille (30000 = +30%). We accept per-cent in the
  // run (closer to CSS authoring intent) and scale at emit time.
  const baselineValue = typeof run.baseline === "number" && run.baseline !== 0
    ? Math.round(run.baseline * 1000)
    : undefined;

  const rPrAttrs =
    attr("lang", "en-US") +
    attr("sz", szValue) +
    attr("b", run.bold) +
    attr("i", run.italic) +
    (underlined ? ` u="sng"` : "") +
    (run.strike ? ` strike="sngStrike"` : "") +
    attr("baseline", baselineValue) +
    attr("spc", typeof run.letterSpacing === "number" ? Math.round(run.letterSpacing) : undefined) +
    attr("dirty", "0");

  const fillXml = run.color ? `<a:solidFill><a:srgbClr val="${run.color.toUpperCase()}"/></a:solidFill>` : "";
  const highlightXml = run.highlight
    ? (assertHex(run.highlight, "TextRun.highlight"), `<a:highlight><a:srgbClr val="${run.highlight.toUpperCase()}"/></a:highlight>`)
    : "";

  // DrawingML (used in PowerPoint slides) requires SEPARATE child elements
  // `<a:latin>`, `<a:ea>`, `<a:cs>` inside `<a:rPr>` — NOT the
  // WordprocessingML `<a:rFonts>` element. Office 365's strict reader
  // refuses `<a:rFonts>` here as a schema violation.
  let fontsXml = "";
  if (run.fontFace || run.cjk || run.mono) {
    const latinFace = xmlEscape(run.fontFace ?? "Calibri");
    const eaFace = run.cjk ? xmlEscape(run.eastAsianFontFace ?? run.fontFace ?? "PingFang SC") : undefined;
    const csFace = run.mono ? xmlEscape(run.complexScriptFontFace ?? run.fontFace ?? "Menlo") : undefined;
    // Order per CT_TextCharacterProperties:
    //   ln → fill → effects → highlight → underline → latin → ea → cs → sym → hlinkClick → hlinkMouseOver → ...
    fontsXml += `<a:latin typeface="${latinFace}"/>`;
    if (eaFace !== undefined) fontsXml += `<a:ea typeface="${eaFace}"/>`;
    if (csFace !== undefined) fontsXml += `<a:cs typeface="${csFace}"/>`;
  }

  // Hyperlink — `<a:hlinkClick>` belongs after `<a:cs>` per the schema.
  // We register the rel on the slide and stamp the rId here.
  let hlinkXml = "";
  if (run.hyperlink && rels) {
    const rId = rels.addHyperlink(run.hyperlink);
    const action = isInternalSlideLink(run.hyperlink) ? ` action="ppaction://hlinksldjump"` : "";
    hlinkXml = `<a:hlinkClick xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${rId}"${action}/>`;
  }

  // OOXML CT_TextCharacterProperties order:
  //   ln → fill → effects → highlight → uLnTx/uFillTx → uFill → latin → ea → cs → sym → hlinkClick
  const rPr = `<a:rPr${rPrAttrs}>${fillXml}${highlightXml}${fontsXml}${hlinkXml}</a:rPr>`;

  // breakLine semantics: PptxGenJS emits a `<a:br/>` element after the run.
  // We emit `</a:p><a:p>` boundaries via the higher-level paragraph splitter,
  // so `breakLine` here just produces `<a:br/>` for in-paragraph soft breaks.
  const softBreak = run.breakLine && !isLast ? `<a:br><a:rPr lang="en-US"/></a:br>` : "";

  // `xml:space="preserve"` keeps leading/trailing whitespace.
  const text = `<a:t xml:space="preserve">${escapeText(run.text)}</a:t>`;

  return `<a:r>${rPr}${text}</a:r>${softBreak}`;
}

function mathOmmlWithRunColor(omml: string, hex: string): string {
  const colorPr = `<w:rPr><w:color w:val="${hex.toUpperCase()}"/></w:rPr>`;
  return omml.replace(/<m:r>(<m:rPr>[\s\S]*?<\/m:rPr>)?(<w:rPr>[\s\S]*?<\/w:rPr>)?/g, (_match, mathPr = "", wordPr = "") => {
    if (!wordPr) return `<m:r>${mathPr}${colorPr}`;
    const patchedWordPr = /<w:color\b/.test(wordPr)
      ? wordPr.replace(/<w:color\b[^>]*\/>/, `<w:color w:val="${hex.toUpperCase()}"/>`)
      : wordPr.replace("</w:rPr>", `<w:color w:val="${hex.toUpperCase()}"/></w:rPr>`);
    return `<m:r>${mathPr}${patchedWordPr}`;
  });
}

function isInternalSlideLink(target: string): boolean {
  return /^#?slide\d+$/i.test(target.trim()) || /^slide:\d+$/i.test(target.trim());
}
