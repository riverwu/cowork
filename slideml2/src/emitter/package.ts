/**
 * Assemble a complete `.pptx` package as a Buffer.
 *
 * Vendored carve-out: the package skeleton (Content_Types, _rels,
 * presentation.xml, slideMaster, slideLayout, theme) mirrors PptxGenJS's
 * `gen-xml.ts` output for the simplest possible single-master single-layout
 * deck. Trimmed to the minimum that opens cleanly in Keynote, PowerPoint,
 * and LibreOffice.
 */

import JSZip from "jszip";
import { Assets } from "../assets.js";
import { chartXml } from "./chart.js";
import { chartWorkbookXlsx } from "./chart-workbook.js";
import {
  notesMasterRelsXml,
  notesMasterXml,
  notesSlideRelsXml,
  notesSlideXml,
} from "./notes.js";
import { slideRelsXml, slideXml } from "./slide.js";
import { SLIDE_SIZES } from "../units.js";
import type { ChartShape, DeckAst, ImageShape } from "./types.js";
import { STABLE_OOXML_TIMESTAMP, xmlEscape } from "./xml.js";

/**
 * Wrap an asset.intern call so failures (404s, missing files,
 * unsupported MIME types) carry the slide-level context the agent
 * needs to find the offending slot.
 */
async function internOrAnnotate(assets: Assets, src: string, context: string): Promise<void> {
  try {
    await assets.intern(src);
  } catch (err) {
    const original = err instanceof Error ? err.message : String(err);
    throw new Error(`${context}: failed to load image "${src}" — ${original}`);
  }
}

/**
 * Resolved theme1.xml inputs — produced from `ThemeManifest.oxml` by
 * the renderer (which has the token table and can resolve names → hex).
 */
export interface ResolvedThemeOxml {
  name: string;
  colors: {
    dk1?: string; // optional → emit sysClr fallback
    lt1?: string;
    dk2: string;
    lt2: string;
    accent1: string;
    accent2: string;
    accent3: string;
    accent4: string;
    accent5: string;
    accent6: string;
    hlink: string;
    folHlink: string;
  };
  fonts: { majorLatin: string; minorLatin: string };
}

const OFFICE_FALLBACK_COLORS: ResolvedThemeOxml["colors"] = {
  dk2: "44546A", lt2: "E7E6E6",
  accent1: "4472C4", accent2: "ED7D31", accent3: "A5A5A5",
  accent4: "FFC000", accent5: "5B9BD5", accent6: "70AD47",
  hlink: "0563C1", folHlink: "954F72",
};
const OFFICE_FALLBACK_FONTS: ResolvedThemeOxml["fonts"] = {
  majorLatin: "Calibri Light",
  minorLatin: "Calibri",
};

/** Compile a `DeckAst` to a `.pptx` Buffer. */
export async function emitPackage(deck: DeckAst, themeOxml?: ResolvedThemeOxml): Promise<Buffer> {
  if (deck.slides.length === 0) {
    throw new Error("emitPackage: deck has no slides");
  }

  const zip = new JSZip();
  const dims = SLIDE_SIZES[deck.size];
  const author = deck.author ?? "SlideML";
  const title = deck.title ?? "Presentation";
  const lang = deck.language ?? "en-US";

  // Pre-count chart and notes parts so Content_Types can register their overrides.
  const chartCount = deck.slides.reduce(
    (acc, slide) => acc + slide.shapes.filter((s) => s.type === "chart").length,
    0,
  );
  const notesIndices: number[] = [];
  deck.slides.forEach((s, i) => {
    if (s.notes && s.notes.trim().length > 0) notesIndices.push(i + 1);
  });
  const hasNotes = notesIndices.length > 0;

  // Asset pipeline: walk the deck once to intern every image src (shapes +
  // backgrounds). After this, the zip writer just iterates assets.entries().
  // Errors are wrapped with the slide index + role so the agent can attribute
  // them to the offending slot (otherwise it'd see a bare "HTTP 404").
  //
  // Side effect: when intern returns dimensions (PNG/JPG/SVG header probe),
  // we stamp them onto every matching ImageShape so the slide emitter can
  // compute `<a:srcRect>` for fit: "cover" / "contain". This is mutation
  // but contained — the AST is already a single-use intermediate.
  const assets = new Assets();
  for (let i = 0; i < deck.slides.length; i++) {
    const slide = deck.slides[i]!;
    const slideNum = i + 1;
    if (slide.background?.type === "image") {
      await internOrAnnotate(assets, slide.background.src, `slides[${slideNum}].background`);
    }
    for (const shape of slide.shapes) {
      if (shape.type === "image") {
        await internOrAnnotate(assets, shape.src, `slides[${slideNum}] image shape "${shape.name ?? shape.id}"`);
        const entry = assets.get(shape.src);
        if (entry?.resolved.dimensions && !shape.sourceDimensions) {
          shape.sourceDimensions = { ...entry.resolved.dimensions };
        }
      }
    }
  }

  // --- Top-level package files ---------------------------------------------
  zip.file("[Content_Types].xml", contentTypesXml(deck.slides.length, assets.extensions(), chartCount, notesIndices));
  zip.file("_rels/.rels", rootRelsXml());
  zip.file("docProps/app.xml", appXml(deck.slides.length));
  zip.file("docProps/core.xml", coreXml(title, author));

  // --- Theme (single fixed default) ---------------------------------------
  zip.file("ppt/theme/theme1.xml", themeXml(themeOxml));

  // --- Slide master + layout (single, fixed) ------------------------------
  zip.file("ppt/slideMasters/slideMaster1.xml", slideMasterXml(deck.master));
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", slideMasterRelsXml());
  zip.file("ppt/slideLayouts/slideLayout1.xml", slideLayoutXml(deck.master));
  zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", slideLayoutRelsXml());

  // --- Notes master (only when at least one slide has notes) --------------
  if (hasNotes) {
    zip.file("ppt/notesMasters/notesMaster1.xml", notesMasterXml());
    zip.file("ppt/notesMasters/_rels/notesMaster1.xml.rels", notesMasterRelsXml());
    // PowerPoint requires the notesMaster to have its OWN theme part
    // (typically theme2.xml). Sharing theme1.xml across slideMaster and
    // notesMaster triggers a "found a problem with content" warning even
    // though the file otherwise validates. Confirmed by gold-file diff
    // (python-pptx and Office both ship a separate theme2.xml for notes).
    zip.file("ppt/theme/theme2.xml", themeXml());
  }

  // --- Presentation root ---------------------------------------------------
  zip.file("ppt/presentation.xml", presentationXml(deck.slides.length, dims, lang, hasNotes));
  zip.file("ppt/_rels/presentation.xml.rels", presentationRelsXml(deck.slides.length, hasNotes));
  zip.file("ppt/presProps.xml", presPropsXml());
  zip.file("ppt/viewProps.xml", viewPropsXml());
  zip.file("ppt/tableStyles.xml", tableStylesXml());

  // --- Slides --------------------------------------------------------------
  // Write all media files once (assets already interned above).
  for (const entry of assets.entries()) {
    zip.file(`ppt/media/${entry.filename}`, entry.resolved.bytes);
  }
  // Charts: each chart shape gets its own chart{N}.xml part.
  let nextChartIndex = 1;

  for (let i = 0; i < deck.slides.length; i++) {
    const slide = deck.slides[i]!;
    const slideNum = i + 1;
    const slidePart = `ppt/slides/slide${slideNum}.xml`;

    // Build slide XML. The shape emitter populates `rels` with placeholder
    // targets that we rewrite after the fact. The slide emitter also adds
    // a background-image rel marker if the slide has an image background.
    const built = slideXml(slide, slidePart);

    // Rewrite image and chart rel targets to the actual filenames.
    let imgRelIdx = 0;
    let chartRelIdx = 0;
    const imageShapes = slide.shapes.filter((s): s is ImageShape => s.type === "image");
    const chartShapes = slide.shapes.filter((s): s is ChartShape => s.type === "chart");

    // Allocate chart filenames for THIS slide and write their XML parts.
    const slideChartFilenames: string[] = [];
    for (const _chart of chartShapes) {
      const chartFilename = `chart${nextChartIndex++}.xml`;
      slideChartFilenames.push(chartFilename);
      const workbookFilename = `Microsoft_Excel_Worksheet${nextChartIndex - 1}.xlsx`;
      zip.file(`ppt/charts/${chartFilename}`, chartXml(_chart, { embeddedWorkbookRelId: "rId1" }));
      zip.file(`ppt/embeddings/${workbookFilename}`, await chartWorkbookXlsx(_chart));
      zip.file(
        `ppt/charts/_rels/${chartFilename}.rels`,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="../embeddings/${workbookFilename}"/>
</Relationships>`,
      );
    }

    const bgImageSrc = slide.background?.type === "image" ? slide.background.src : undefined;
    let bgRelConsumed = false;
    built.rels.entries = built.rels.entries.map((rel) => {
      if (rel.type.endsWith("/image")) {
        const explicitSrc = rel.assetSrc;
        const src = explicitSrc || (bgImageSrc && !bgRelConsumed ? bgImageSrc : imageShapes[imgRelIdx++]?.src);
        if (rel.role === "background-image" || (src === bgImageSrc && !bgRelConsumed)) {
          bgRelConsumed = true;
        }
        if (!src) throw new Error(`slides[${slideNum}] image relationship ${rel.id} has no source asset`);
        const entry = assets.get(src);
        if (!entry) throw new Error(`slides[${slideNum}] image relationship ${rel.id} references uninterned asset "${src}"`);
        return { ...rel, target: `../media/${entry.filename}` };
      }
      if (rel.type.endsWith("/chart")) {
        const filename = slideChartFilenames[chartRelIdx++]!;
        return { ...rel, target: `../charts/${filename}` };
      }
      return rel;
    });

    // If the slide carries notes, append a notes-rel to the slide-rels list
    // and write the corresponding notesSlide{N}.xml part. This must happen
    // BEFORE serializing slide-rels so the rel appears.
    if (slide.notes && slide.notes.trim().length > 0) {
      const notesFilename = `notesSlide${slideNum}.xml`;
      zip.file(`ppt/notesSlides/${notesFilename}`, notesSlideXml(slide.notes, slideNum));
      zip.file(`ppt/notesSlides/_rels/${notesFilename}.rels`, notesSlideRelsXml(slideNum));
      const nextRId = `rId${built.rels.entries.length + 2}`; // +2 because rId1 = layout, then existing entries
      built.rels.entries.push({
        id: nextRId,
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide",
        target: `../notesSlides/${notesFilename}`,
      });
    }

    zip.file(slidePart, built.body);
    // Layout rId is always rId1; shape emitters allocate rId2+ directly,
    // so the in-XML `r:id="rIdN"` matches the rel-file entry without any
    // post-serialization renumbering.
    zip.file(`ppt/slides/_rels/slide${slideNum}.xml.rels`, slideRelsXml(built.rels, "rId1"));
  }

  // PowerPoint rejects OPC packages that contain explicit directory entries
  // (`_rels/`, `ppt/`, etc. with size 0). JSZip auto-creates them whenever
  // `zip.file("a/b/c", ...)` introduces a new path segment; we strip them
  // before serializing. The OPC spec forbids these entries and Office 365's
  // strict reader treats them as corruption. LibreOffice tolerates them
  // silently — that's why the bug survived Stage 2 testing.
  for (const path of Object.keys(zip.files)) {
    if (zip.files[path]!.dir) delete zip.files[path];
  }
  return await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
}


// =============================================================================
// Static OOXML — minimum viable package files
// =============================================================================

function contentTypesXml(slideCount: number, imageExts: Set<string>, chartCount: number, notesIndices: number[]): string {
  const overrides: string[] = [
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>`,
    `<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>`,
    `<Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>`,
    `<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>`,
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`,
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`,
    `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`,
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`,
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`,
  ];
  for (let i = 1; i <= slideCount; i++) {
    overrides.push(
      `<Override PartName="/ppt/slides/slide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    );
  }
  for (let i = 1; i <= chartCount; i++) {
    overrides.push(
      `<Override PartName="/ppt/charts/chart${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
    );
    overrides.push(
      `<Override PartName="/ppt/embeddings/Microsoft_Excel_Worksheet${i}.xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>`,
    );
  }
  if (notesIndices.length > 0) {
    overrides.push(
      `<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>`,
    );
    // theme2.xml is the notesMaster's own theme part (see package.ts).
    overrides.push(
      `<Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`,
    );
    for (const i of notesIndices) {
      overrides.push(
        `<Override PartName="/ppt/notesSlides/notesSlide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`,
      );
    }
  }

  const defaults: string[] = [
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`,
    `<Default Extension="xml" ContentType="application/xml"/>`,
  ];
  if (chartCount > 0) {
    defaults.push(`<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>`);
  }
  // Always declare png/jpg defaults so a deck without an image still
  // validates if a layout decides to inject one later (charts hand-rolled
  // to PptxGenJS shape style sometimes carry inline png blips).
  const allExts = new Set<string>([...imageExts, "png", "jpg"]);
  for (const ext of allExts) {
    const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
    defaults.push(`<Default Extension="${ext}" ContentType="${mime}"/>`);
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults.join("")}${overrides.join("")}</Types>`;
}

function rootRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function appXml(slideCount: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<TotalTime>0</TotalTime>
<Words>0</Words>
<Application>SlideML</Application>
<PresentationFormat>Custom</PresentationFormat>
<Paragraphs>0</Paragraphs>
<Slides>${slideCount}</Slides>
<Notes>0</Notes>
<HiddenSlides>0</HiddenSlides>
<MMClips>0</MMClips>
<ScaleCrop>false</ScaleCrop>
<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Slides</vt:lpstr></vt:variant><vt:variant><vt:i4>${slideCount}</vt:i4></vt:variant></vt:vector></HeadingPairs>
<TitlesOfParts><vt:vector size="${slideCount}" baseType="lpstr">${"<vt:lpstr>Slide</vt:lpstr>".repeat(slideCount)}</vt:vector></TitlesOfParts>
<LinksUpToDate>false</LinksUpToDate>
<SharedDoc>false</SharedDoc>
<HyperlinksChanged>false</HyperlinksChanged>
<AppVersion>1.0</AppVersion>
</Properties>`;
}

function coreXml(title: string, author: string): string {
  const now = STABLE_OOXML_TIMESTAMP;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${escapeForXml(title)}</dc:title>
<dc:creator>${escapeForXml(author)}</dc:creator>
<cp:lastModifiedBy>${escapeForXml(author)}</cp:lastModifiedBy>
<cp:revision>1</cp:revision>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

/**
 * theme1.xml. When `themeOxml` is provided (typically computed from
 * `ThemeManifest.oxml`), the color scheme and fonts reflect the SlideML
 * theme — making PowerPoint's color picker and font picker show the
 * brand palette instead of generic Office. When omitted, falls back to
 * Office defaults.
 */
function themeXml(themeOxml?: ResolvedThemeOxml): string {
  const themeName = themeOxml?.name ?? "Office Theme";
  const c = themeOxml?.colors ?? OFFICE_FALLBACK_COLORS;
  const f = themeOxml?.fonts ?? OFFICE_FALLBACK_FONTS;
  const dk1 = c.dk1
    ? `<a:srgbClr val="${c.dk1.toUpperCase()}"/>`
    : `<a:sysClr val="windowText" lastClr="000000"/>`;
  const lt1 = c.lt1
    ? `<a:srgbClr val="${c.lt1.toUpperCase()}"/>`
    : `<a:sysClr val="window" lastClr="FFFFFF"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${escapeForXml(themeName)}">
<a:themeElements>
<a:clrScheme name="${escapeForXml(themeName)}">
<a:dk1>${dk1}</a:dk1>
<a:lt1>${lt1}</a:lt1>
<a:dk2><a:srgbClr val="${c.dk2.toUpperCase()}"/></a:dk2>
<a:lt2><a:srgbClr val="${c.lt2.toUpperCase()}"/></a:lt2>
<a:accent1><a:srgbClr val="${c.accent1.toUpperCase()}"/></a:accent1>
<a:accent2><a:srgbClr val="${c.accent2.toUpperCase()}"/></a:accent2>
<a:accent3><a:srgbClr val="${c.accent3.toUpperCase()}"/></a:accent3>
<a:accent4><a:srgbClr val="${c.accent4.toUpperCase()}"/></a:accent4>
<a:accent5><a:srgbClr val="${c.accent5.toUpperCase()}"/></a:accent5>
<a:accent6><a:srgbClr val="${c.accent6.toUpperCase()}"/></a:accent6>
<a:hlink><a:srgbClr val="${c.hlink.toUpperCase()}"/></a:hlink>
<a:folHlink><a:srgbClr val="${c.folHlink.toUpperCase()}"/></a:folHlink>
</a:clrScheme>
<a:fontScheme name="${escapeForXml(themeName)}">
<a:majorFont><a:latin typeface="${escapeForXml(f.majorLatin)}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="${escapeForXml(f.minorLatin)}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
</a:fontScheme>
<a:fmtScheme name="Office">
<a:fillStyleLst>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
</a:fillStyleLst>
<a:lnStyleLst>
<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
<a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
<a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
</a:lnStyleLst>
<a:effectStyleLst>
<a:effectStyle><a:effectLst/></a:effectStyle>
<a:effectStyle><a:effectLst/></a:effectStyle>
<a:effectStyle><a:effectLst/></a:effectStyle>
</a:effectStyleLst>
<a:bgFillStyleLst>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
</a:bgFillStyleLst>
</a:fmtScheme>
</a:themeElements>
<a:objectDefaults/>
<a:extraClrSchemeLst/>
</a:theme>`;
}

function slideMasterXml(master?: DeckAst["master"]): string {
  const placeholders = placeholderShapesXml(master, 10);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld>
<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>
<p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
${placeholders}
</p:spTree>
</p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
<p:txStyles>
<p:titleStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle>
<p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle>
<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle>
</p:txStyles>
</p:sldMaster>`;
}

function slideMasterRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;
}

function slideLayoutXml(master?: DeckAst["master"]): string {
  const placeholders = placeholderShapesXml(master, 100);
  const layoutName = escapeForXml(master?.layout ?? "Blank");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
<p:cSld name="${layoutName}">
<p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
${placeholders}
</p:spTree>
</p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;
}

function placeholderShapesXml(master: DeckAst["master"] | undefined, startId: number): string {
  const entries = Object.entries(master?.placeholders ?? {});
  return entries.map(([name, ph], index) => {
    const id = startId + index;
    const type = placeholderType(ph.type);
    const idxAttr = ` idx="${index + 1}"`;
    const x = Math.round(ph.x);
    const y = Math.round(ph.y);
    const w = Math.round(ph.w);
    const h = Math.round(ph.h);
    return (
      `<p:sp>` +
      `<p:nvSpPr><p:cNvPr id="${id}" name="${escapeForXml(name)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="${type}"${idxAttr}/></p:nvPr></p:nvSpPr>` +
      `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>` +
      `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>` +
      `</p:sp>`
    );
  }).join("");
}

function placeholderType(type: "title" | "body" | "chart" | "table" | "image" | "footer" | undefined): string {
  switch (type) {
    case "title": return "title";
    case "footer": return "ftr";
    case "image": return "pic";
    case "chart":
    case "table":
    case "body":
    default: return "body";
  }
}

function slideLayoutRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;
}

function presentationXml(slideCount: number, dims: { width: number; height: number }, lang: string, hasNotes: boolean): string {
  const sldIdEntries: string[] = [];
  for (let i = 0; i < slideCount; i++) {
    // Slide IDs start at 256 per OOXML convention; rIds start at rId2 (rId1 = master).
    sldIdEntries.push(`<p:sldId id="${256 + i}" r:id="rId${2 + i}"/>`);
  }
  // PowerPoint requires <p:sldSz type="..."> matching the dimensions, or
  // type="custom" for non-standard sizes. Missing `type` causes the strict
  // Office reader to flag the file as needing repair.
  const sldSzType = sizeTypeFor(dims);
  // The notesMasterIdLst rId follows the pattern documented in
  // `presentationRelsXml` — when present, it sits AFTER tableStyles (last).
  const notesMasterRId = hasNotes
    ? `rId${1 /* master */ + slideCount + 4 /* presProps,viewProps,theme,tableStyles */ + 1}`
    : null;
  const notesMasterLst = notesMasterRId
    ? `<p:notesMasterIdLst><p:notesMasterId r:id="${notesMasterRId}"/></p:notesMasterIdLst>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
${notesMasterLst}
<p:sldIdLst>${sldIdEntries.join("")}</p:sldIdLst>
<p:sldSz cx="${dims.width}" cy="${dims.height}" type="${sldSzType}"/>
<p:notesSz cx="6858000" cy="9144000"/>
<p:defaultTextStyle>${defaultTextStyleXml(lang)}</p:defaultTextStyle>
</p:presentation>`;
}

/** Match standard `<p:sldSz>` types from OOXML §19.7.21. */
function sizeTypeFor(dims: { width: number; height: number }): string {
  // 16:9 = 9144000 × 5143500
  if (dims.width === 9144000 && dims.height === 5143500) return "screen16x9";
  // 16:10 = 9144000 × 5715000
  if (dims.width === 9144000 && dims.height === 5715000) return "screen16x10";
  // 4:3 = 9144000 × 6858000
  if (dims.width === 9144000 && dims.height === 6858000) return "screen4x3";
  return "custom";
}

/** Build a strict, PowerPoint-friendly `<p:defaultTextStyle>` body. */
function defaultTextStyleXml(lang: string): string {
  const escapedLang = lang.replace(/"/g, "&quot;");
  const lvl = (n: number, marL: number) =>
    `<a:lvl${n}pPr marL="${marL}" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">` +
    `<a:defRPr sz="1800" kern="1200">` +
    `<a:solidFill><a:schemeClr val="tx1"/></a:solidFill>` +
    `<a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/>` +
    `</a:defRPr></a:lvl${n}pPr>`;
  const indents = [0, 457200, 914400, 1371600, 1828800, 2286000, 2743200, 3200400, 3657600];
  const levels = indents.map((m, i) => lvl(i + 1, m)).join("");
  return `<a:defPPr><a:defRPr lang="${escapedLang}"/></a:defPPr>${levels}`;
}

function presentationRelsXml(slideCount: number, hasNotes: boolean): string {
  const slideRels: string[] = [];
  for (let i = 1; i <= slideCount; i++) {
    slideRels.push(
      `<Relationship Id="rId${1 + i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i}.xml"/>`,
    );
  }
  const finalIds = {
    master: 1,
    presProps: 2 + slideCount,
    viewProps: 3 + slideCount,
    theme: 4 + slideCount,
    tableStyles: 5 + slideCount,
    notesMaster: 6 + slideCount,
  };
  const notesMasterRel = hasNotes
    ? `\n<Relationship Id="rId${finalIds.notesMaster}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="notesMasters/notesMaster1.xml"/>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId${finalIds.master}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
${slideRels.join("\n")}
<Relationship Id="rId${finalIds.presProps}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps" Target="presProps.xml"/>
<Relationship Id="rId${finalIds.viewProps}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps" Target="viewProps.xml"/>
<Relationship Id="rId${finalIds.theme}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
<Relationship Id="rId${finalIds.tableStyles}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/>${notesMasterRel}
</Relationships>`;
}

function presPropsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentationPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`;
}

function viewPropsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:viewPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr>
<p:slideViewPr><p:cSldViewPr snapToGrid="0"><p:cViewPr varScale="1"><p:scale><a:sx n="100" d="100"/><a:sy n="100" d="100"/></p:scale><p:origin x="0" y="0"/></p:cViewPr><p:guideLst/></p:cSldViewPr></p:slideViewPr>
<p:notesTextViewPr><p:cViewPr><p:scale><a:sx n="100" d="100"/><a:sy n="100" d="100"/></p:scale><p:origin x="0" y="0"/></p:cViewPr></p:notesTextViewPr>
<p:gridSpacing cx="76200" cy="76200"/>
</p:viewPr>`;
}

function tableStylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`;
}

// =============================================================================

function escapeForXml(s: string): string {
  return xmlEscape(s);
}
