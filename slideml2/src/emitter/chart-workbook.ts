import JSZip from "jszip";
import type { ChartShape } from "./types.js";
import { XML_DECL, xmlEscape } from "./xml.js";

interface WorkbookSeries {
  name: string;
  values: Array<number | null>;
}

type SheetCell =
  | { kind: "string"; ref: string; value: string }
  | { kind: "number"; ref: string; value: number | null | undefined };

interface SheetRow {
  index: number;
  cells: SheetCell[];
}

interface WorksheetModel {
  rows: SheetRow[];
  colCount: number;
  rowCount: number;
}

/**
 * Build the embedded workbook that PowerPoint expects for editable native
 * charts. PowerPoint validates chart formulas against the workbook part, and
 * it is stricter than LibreOffice/python-pptx. Keep this package close to a
 * normal Excel-generated workbook: shared strings, theme, styles, and docProps.
 */
export async function chartWorkbookXlsx(shape: ChartShape): Promise<Buffer> {
  const model = shape.chartType === "scatter"
    ? scatterWorksheetModel(shape)
    : worksheetModel(shape.labels, workbookSeries(shape));
  const sharedStrings = sharedStringTable(model);

  const zip = new JSZip();
  zip.file("[Content_Types].xml", workbookContentTypesXml());
  zip.file("_rels/.rels", workbookRootRelsXml());
  zip.file("docProps/app.xml", workbookAppXml());
  zip.file("docProps/core.xml", workbookCoreXml());
  zip.file("xl/workbook.xml", workbookXml());
  zip.file("xl/_rels/workbook.xml.rels", workbookRelsXml());
  zip.file("xl/worksheets/sheet1.xml", worksheetXml(model, sharedStrings.indexes));
  zip.file("xl/styles.xml", stylesXml());
  zip.file("xl/theme/theme1.xml", workbookThemeXml());
  zip.file("xl/sharedStrings.xml", sharedStringsXml(sharedStrings.values, sharedStrings.count));

  for (const path of Object.keys(zip.files)) {
    if (zip.files[path]!.dir) delete zip.files[path];
  }
  return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function workbookSeries(shape: ChartShape): WorkbookSeries[] {
  if (shape.chartType !== "waterfall") {
    return shape.series.map((s) => ({ name: s.name, values: s.values }));
  }

  const source = shape.series[0] ?? { name: "Series", values: [] };
  let running = 0;
  const base: number[] = [];
  const delta: number[] = [];
  source.values.forEach((raw) => {
    if (raw === null || typeof raw !== "number" || !Number.isFinite(raw)) {
      base.push(0);
      delta.push(running);
      return;
    }
    if (raw >= 0) {
      base.push(running);
      delta.push(raw);
      running += raw;
    } else {
      base.push(running + raw);
      delta.push(-raw);
      running += raw;
    }
  });
  return [
    { name: "(base)", values: base },
    { name: source.name, values: delta },
  ];
}

function worksheetModel(labels: string[], series: WorkbookSeries[]): WorksheetModel {
  const rowCount = Math.max(labels.length, ...series.map((s) => s.values.length), 1) + 1;
  const colCount = Math.max(1 + series.length, 2);
  const rows: SheetRow[] = [];

  rows.push({
    index: 1,
    cells: [
      stringCell("A1", ""),
      ...series.map((s, idx) => stringCell(`${excelColumnName(idx + 2)}1`, s.name)),
    ],
  });

  for (let i = 0; i < rowCount - 1; i++) {
    const r = i + 2;
    const cells: SheetCell[] = [stringCell(`A${r}`, labels[i] ?? "")];
    series.forEach((s, idx) => {
      cells.push(numberCell(`${excelColumnName(idx + 2)}${r}`, s.values[i]));
    });
    rows.push({ index: r, cells });
  }

  return { rows, colCount, rowCount };
}

function scatterWorksheetModel(shape: ChartShape): WorksheetModel {
  const pointsBySeries = shape.series.map((series) => scatterPoints(shape, series));
  const dataRows = Math.max(...pointsBySeries.map((points) => points.length), 1);
  const colCount = Math.max(shape.series.length * 2, 2);
  const rows: SheetRow[] = [];

  const headerCells: SheetCell[] = [];
  shape.series.forEach((series, idx) => {
    const xCol = excelColumnName(idx * 2 + 1);
    const yCol = excelColumnName(idx * 2 + 2);
    headerCells.push(stringCell(`${xCol}1`, `${series.name} x`));
    headerCells.push(stringCell(`${yCol}1`, `${series.name} y`));
  });
  if (headerCells.length === 0) {
    headerCells.push(stringCell("A1", "x"));
    headerCells.push(stringCell("B1", "y"));
  }
  rows.push({ index: 1, cells: headerCells });

  for (let i = 0; i < dataRows; i++) {
    const r = i + 2;
    const cells: SheetCell[] = [];
    pointsBySeries.forEach((points, idx) => {
      const point = points[i];
      cells.push(numberCell(`${excelColumnName(idx * 2 + 1)}${r}`, point?.x));
      cells.push(numberCell(`${excelColumnName(idx * 2 + 2)}${r}`, point?.y));
    });
    if (cells.length === 0) {
      cells.push(numberCell(`A${r}`, 0));
      cells.push(numberCell(`B${r}`, 0));
    }
    rows.push({ index: r, cells });
  }

  return { rows, colCount, rowCount: dataRows + 1 };
}

function scatterPoints(shape: ChartShape, series: ChartShape["series"][number]): Array<{ x: number; y: number }> {
  return series.points && series.points.length > 0
    ? series.points
    : shape.labels.map((label, i) => ({ x: Number(label) || i, y: series.values[i] ?? 0 }));
}

function sharedStringTable(model: WorksheetModel): { values: string[]; indexes: Map<string, number>; count: number } {
  const values: string[] = [];
  const indexes = new Map<string, number>();
  let count = 0;
  for (const row of model.rows) {
    for (const cell of row.cells) {
      if (cell.kind !== "string") continue;
      count += 1;
      if (!indexes.has(cell.value)) {
        indexes.set(cell.value, values.length);
        values.push(cell.value);
      }
    }
  }
  return { values, indexes, count };
}

function workbookContentTypesXml(): string {
  return `${XML_DECL}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`;
}

function workbookRootRelsXml(): string {
  return `${XML_DECL}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function workbookXml(): string {
  return `${XML_DECL}
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" mc:Ignorable="x15" xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main">
<fileVersion appName="xl" lastEdited="7" lowestEdited="7" rupBuild="18129"/>
<workbookPr defaultThemeVersion="166925"/>
<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="17600"/></bookViews>
<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
<calcPr calcId="0" concurrentCalc="0"/>
</workbook>`;
}

function workbookRelsXml(): string {
  return `${XML_DECL}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;
}

function worksheetXml(model: WorksheetModel, sharedStringIndexes: Map<string, number>): string {
  const lastCell = `${excelColumnName(model.colCount)}${model.rowCount}`;
  const rows = model.rows.map((row) => {
    const cells = row.cells.map((cell) => {
      if (cell.kind === "string") {
        const idx = sharedStringIndexes.get(cell.value) ?? 0;
        return `<c r="${cell.ref}" t="s"><v>${idx}</v></c>`;
      }
      const safe = typeof cell.value === "number" && Number.isFinite(cell.value) ? cell.value : 0;
      return `<c r="${cell.ref}"><v>${safe}</v></c>`;
    }).join("");
    return `<row r="${row.index}" spans="1:${model.colCount}">${cells}</row>`;
  }).join("");

  return `${XML_DECL}
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac">
<dimension ref="A1:${lastCell}"/>
<sheetViews><sheetView workbookViewId="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="15" x14ac:dyDescent="0.2"/>
<sheetData>${rows}</sheetData>
<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
}

function sharedStringsXml(values: string[], count: number): string {
  const body = values.map((value) => {
    const preserve = /^\s|\s$/.test(value) ? ` xml:space="preserve"` : "";
    return `<si><t${preserve}>${xmlEscape(value)}</t></si>`;
  }).join("");
  return `${XML_DECL}
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${count}" uniqueCount="${values.length}">${body}</sst>`;
}

function workbookAppXml(): string {
  return `${XML_DECL}
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Application>Microsoft Excel</Application>
<DocSecurity>0</DocSecurity>
<ScaleCrop>false</ScaleCrop>
<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs>
<TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>Sheet1</vt:lpstr></vt:vector></TitlesOfParts>
<Company></Company>
<LinksUpToDate>false</LinksUpToDate>
<SharedDoc>false</SharedDoc>
<HyperlinksChanged>false</HyperlinksChanged>
<AppVersion>16.0300</AppVersion>
</Properties>`;
}

function workbookCoreXml(): string {
  const created = "2026-01-01T00:00:00Z";
  return `${XML_DECL}
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:creator>SlideML2</dc:creator>
<cp:lastModifiedBy>SlideML2</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>
</cp:coreProperties>`;
}

function stylesXml(): string {
  return `${XML_DECL}
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="1"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="0"/>
<tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;
}

function workbookThemeXml(): string {
  return `${XML_DECL}
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">
<a:themeElements>
<a:clrScheme name="Office">
<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F497D"/></a:dk2>
<a:lt2><a:srgbClr val="EEECE1"/></a:lt2>
<a:accent1><a:srgbClr val="4F81BD"/></a:accent1>
<a:accent2><a:srgbClr val="C0504D"/></a:accent2>
<a:accent3><a:srgbClr val="9BBB59"/></a:accent3>
<a:accent4><a:srgbClr val="8064A2"/></a:accent4>
<a:accent5><a:srgbClr val="4BACC6"/></a:accent5>
<a:accent6><a:srgbClr val="F79646"/></a:accent6>
<a:hlink><a:srgbClr val="0000FF"/></a:hlink>
<a:folHlink><a:srgbClr val="800080"/></a:folHlink>
</a:clrScheme>
<a:fontScheme name="Office">
<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
</a:fontScheme>
<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements>
<a:objectDefaults/>
<a:extraClrSchemeLst/>
</a:theme>`;
}

function stringCell(ref: string, value: string): SheetCell {
  return { kind: "string", ref, value };
}

function numberCell(ref: string, value: number | null | undefined): SheetCell {
  return { kind: "number", ref, value };
}

function excelColumnName(col: number): string {
  let n = Math.max(1, Math.floor(col));
  let out = "";
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}
