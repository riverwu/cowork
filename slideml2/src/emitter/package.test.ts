import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { emitPackage } from "./package.js";
import { cm, inch } from "../units.js";
import type { DeckAst } from "./types.js";

describe("emitter — package end-to-end", () => {
  it("produces a valid PPTX with text + shape + image", async () => {
    // 1×1 transparent PNG
    const pngBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=",
      "base64",
    );
    const dataUrl = `data:image/png;base64,${pngBytes.toString("base64")}`;

    const deck: DeckAst = {
      size: "16x9",
      language: "zh-CN",
      title: "Stage 2 smoke test",
      author: "SlideML",
      slides: [
        {
          background: { type: "solid", color: "0B1B2A" },
          shapes: [
            {
              type: "text",
              id: 2,
              xfrm: { x: cm(2), y: cm(2), cx: cm(20), cy: cm(2) },
              valign: "middle",
              paragraphs: [
                {
                  align: "center",
                  runs: [
                    { text: "Hello ", bold: true, sizeHalfPt: 56, color: "F5F9FC" },
                    { text: "中文世界", bold: true, sizeHalfPt: 56, color: "3CC2FF", cjk: true, fontFace: "PingFang SC" },
                  ],
                },
              ],
            },
            {
              type: "shape",
              id: 3,
              preset: "roundRect",
              xfrm: { x: cm(2), y: cm(7), cx: cm(8), cy: cm(4) },
              fill: { type: "solid", color: "11293E" },
              line: { color: "1F3F5C", width: 12700 },
              cornerRadius: 0.1,
            },
            {
              type: "image",
              id: 4,
              xfrm: { x: cm(12), y: cm(7), cx: inch(2), cy: inch(2) },
              src: dataUrl,
              altText: "transparent test pixel",
            },
          ],
        },
      ],
    };

    const buffer = await emitPackage(deck);
    expect(buffer.length).toBeGreaterThan(2000);

    // Unzip and check the package shape.
    const zip = await JSZip.loadAsync(buffer);
    const files = Object.keys(zip.files).sort();

    // Required parts of any minimal pptx.
    expect(files).toContain("[Content_Types].xml");
    expect(files).toContain("_rels/.rels");
    expect(files).toContain("ppt/presentation.xml");
    expect(files).toContain("ppt/_rels/presentation.xml.rels");
    expect(files).toContain("ppt/slideMasters/slideMaster1.xml");
    expect(files).toContain("ppt/slideMasters/_rels/slideMaster1.xml.rels");
    expect(files).toContain("ppt/slideLayouts/slideLayout1.xml");
    expect(files).toContain("ppt/slideLayouts/_rels/slideLayout1.xml.rels");
    expect(files).toContain("ppt/theme/theme1.xml");
    expect(files).toContain("ppt/slides/slide1.xml");
    expect(files).toContain("ppt/slides/_rels/slide1.xml.rels");
    expect(files).toContain("docProps/core.xml");
    expect(files).toContain("docProps/app.xml");

    // Image was embedded.
    const mediaFiles = files.filter((f) => f.startsWith("ppt/media/") && !zip.files[f]!.dir);
    expect(mediaFiles.length).toBe(1);
    expect(mediaFiles[0]).toMatch(/^ppt\/media\/image1\.png$/);

    // Slide XML mentions the text and the shape preset.
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slideXml).toContain("Hello ");
    expect(slideXml).toContain("中文世界");
    expect(slideXml).toContain('prst="roundRect"');
    expect(slideXml).toContain('<p:pic>');
    // Background fill present.
    expect(slideXml).toContain('<p:bg>');
    expect(slideXml).toContain('val="0B1B2A"');

    // Slide rels reference both the layout and the image.
    const slideRels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
    expect(slideRels).toContain('Target="../slideLayouts/slideLayout1.xml"');
    expect(slideRels).toContain('Target="../media/image1.png"');

    // Presentation.xml references the right slide size for 16x9.
    const presXml = await zip.file("ppt/presentation.xml")!.async("string");
    expect(presXml).toContain('cx="9144000"');
    expect(presXml).toContain('cy="5143500"');
    expect(presXml).toContain('<p:sldId id="256"');
    const coreXml = await zip.file("docProps/core.xml")!.async("string");
    expect(coreXml).toContain("2026-01-01T00:00:00Z");
  });

  it("maps background and shape image relationships by explicit source", async () => {
    const pngA = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=", "base64");
    const pngB = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR42mP8z8AABQMBgJ3c6mQAAAAASUVORK5CYII=", "base64");
    const bg = `data:image/png;base64,${pngA.toString("base64")}`;
    const shape = `data:image/png;base64,${pngB.toString("base64")}`;
    const deck: DeckAst = {
      size: "16x9",
      slides: [{
        background: { type: "image", src: bg },
        shapes: [{ type: "image", id: 2, xfrm: { x: 0, y: 0, cx: cm(2), cy: cm(2) }, src: shape }],
      }],
    };

    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const slideRels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");

    expect(slideRels).toContain('Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"');
    expect(slideRels).toContain('Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image2.png"');
    expect(slideRels).not.toContain("__background");
  });

  it("produces multi-slide deck with sequential rel numbering", async () => {
    const deck: DeckAst = {
      size: "16x9",
      slides: [
        { shapes: [{ type: "shape", id: 2, preset: "rect", xfrm: { x: 0, y: 0, cx: cm(5), cy: cm(5) } }] },
        { shapes: [{ type: "shape", id: 2, preset: "ellipse", xfrm: { x: 0, y: 0, cx: cm(5), cy: cm(5) } }] },
        { shapes: [{ type: "shape", id: 2, preset: "line", xfrm: { x: 0, y: 0, cx: cm(5), cy: 0 } }] },
      ],
    };

    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const presXml = await zip.file("ppt/presentation.xml")!.async("string");
    expect(presXml).toContain('<p:sldId id="256"');
    expect(presXml).toContain('<p:sldId id="257"');
    expect(presXml).toContain('<p:sldId id="258"');

    expect(zip.file("ppt/slides/slide1.xml")).toBeTruthy();
    expect(zip.file("ppt/slides/slide2.xml")).toBeTruthy();
    expect(zip.file("ppt/slides/slide3.xml")).toBeTruthy();

    const rels = await zip.file("ppt/_rels/presentation.xml.rels")!.async("string");
    expect(rels).toContain('Target="slides/slide1.xml"');
    expect(rels).toContain('Target="slides/slide2.xml"');
    expect(rels).toContain('Target="slides/slide3.xml"');
  });

  it("emits embedded text in preset auto-shapes", async () => {
    const deck: DeckAst = {
      size: "16x9",
      slides: [{
        shapes: [{
          type: "shape",
          id: 2,
          preset: "flowChartProcess",
          xfrm: { x: cm(2), y: cm(2), cx: cm(6), cy: cm(2) },
          fill: { type: "solid", color: "2563EB" },
          paragraphs: [{ align: "center", runs: [{ text: "Quality Gate", color: "FFFFFF", bold: true }] }],
          valign: "middle",
        }],
      }],
    };

    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slideXml).toContain('prst="flowChartProcess"');
    expect(slideXml).toContain("Quality Gate");
    expect(slideXml).toContain('anchor="ctr"');
  });

  it("rejects an empty deck", async () => {
    await expect(emitPackage({ size: "16x9", slides: [] })).rejects.toThrow(/no slides/);
  });

  it("rejects an invalid hex color in a fill", async () => {
    const deck: DeckAst = {
      size: "16x9",
      slides: [{
        shapes: [{
          type: "shape",
          id: 2,
          preset: "rect",
          xfrm: { x: 0, y: 0, cx: cm(5), cy: cm(5) },
          fill: { type: "solid", color: "#BAD" },
        }],
      }],
    };
    await expect(emitPackage(deck)).rejects.toThrow(/must NOT include a leading "#"/);
  });

  it("does not include OPC directory entries (PowerPoint refuses them)", async () => {
    const deck: DeckAst = {
      size: "16x9",
      slides: [{ shapes: [{ type: "shape", id: 2, preset: "rect", xfrm: { x: 0, y: 0, cx: cm(5), cy: cm(5) } }] }],
    };
    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const dirEntries = Object.entries(zip.files).filter(([, entry]) => entry.dir);
    expect(dirEntries.length, `OPC packages must not contain directory entries; found: ${dirEntries.map(([p]) => p).join(", ")}`).toBe(0);
  });

  it("emits <p:sldSz> with the correct OOXML type attribute for each preset", async () => {
    const expectations: Array<["16x9" | "16x10" | "4x3" | "wide", string]> = [
      ["16x9", "screen16x9"],
      ["16x10", "screen16x10"],
      ["4x3", "screen4x3"],
      ["wide", "custom"],
    ];
    for (const [size, expectedType] of expectations) {
      const deck: DeckAst = {
        size,
        slides: [{ shapes: [{ type: "shape", id: 2, preset: "rect", xfrm: { x: 0, y: 0, cx: cm(5), cy: cm(5) } }] }],
      };
      const zip = await JSZip.loadAsync(await emitPackage(deck));
      const presXml = await zip.file("ppt/presentation.xml")!.async("string");
      expect(presXml, `${size} should serialize with type="${expectedType}"`).toMatch(
        new RegExp(`<p:sldSz [^>]*type="${expectedType}"`),
      );
    }
  });

  it("emits <p:defaultTextStyle> with the full lvl1pPr..lvl9pPr cascade required by PowerPoint", async () => {
    const deck: DeckAst = {
      size: "16x9",
      slides: [{ shapes: [{ type: "shape", id: 2, preset: "rect", xfrm: { x: 0, y: 0, cx: cm(5), cy: cm(5) } }] }],
    };
    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const presXml = await zip.file("ppt/presentation.xml")!.async("string");
    for (let n = 1; n <= 9; n++) {
      expect(presXml, `defaultTextStyle missing <a:lvl${n}pPr>`).toContain(`<a:lvl${n}pPr `);
    }
    // Each level should reference the theme's scheme fonts/colors, not bare typefaces.
    expect(presXml).toContain('typeface="+mn-lt"');
    expect(presXml).toContain('<a:schemeClr val="tx1"/>');
  });

  it("emits run sz in hundredths-of-a-point (× 50 from sizeHalfPt) — not raw half-point", async () => {
    const deck: DeckAst = {
      size: "16x9",
      slides: [{
        shapes: [{
          type: "text",
          id: 2,
          xfrm: { x: 0, y: 0, cx: cm(20), cy: cm(3) },
          paragraphs: [{ runs: [{ text: "Title", sizeHalfPt: 88 }] }],
        }],
      }],
    };
    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    // 88 half-pt × 50 = 4400 hundredths = 44pt. NOT sz="88" (which would be 0.88pt).
    expect(slideXml).toContain('sz="4400"');
    expect(slideXml).not.toContain('sz="88"');
  });

  it("rounds fractional OOXML font and spacing values to integers", async () => {
    const deck: DeckAst = {
      size: "16x9",
      slides: [{
        shapes: [{
          type: "text",
          id: 2,
          xfrm: { x: 0, y: 0, cx: cm(20), cy: cm(3) },
          paragraphs: [{
            lineSpacingHalfPt: 21.2,
            spaceAfterHalfPt: 3.4,
            runs: [{ text: "Fractional", sizeHalfPt: 18.4 }],
          }],
        }],
      }],
    };
    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slideXml).toContain('sz="920"');
    expect(slideXml).toContain('val="1060"');
    expect(slideXml).toContain('val="170"');
    expect(slideXml).not.toMatch(/\b(?:sz|val)="[-0-9]+\.[0-9]+"/);
  });

  it("uses DrawingML <a:latin>/<a:ea>/<a:cs> font children — not the WordprocessingML <a:rFonts>", async () => {
    const deck: DeckAst = {
      size: "16x9",
      slides: [{
        shapes: [{
          type: "text",
          id: 2,
          xfrm: { x: 0, y: 0, cx: cm(20), cy: cm(3) },
          paragraphs: [{
            runs: [{ text: "中文", sizeHalfPt: 56, cjk: true, fontFace: "PingFang SC" }],
          }],
        }],
      }],
    };
    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slideXml).toContain('<a:latin typeface="PingFang SC"/>');
    expect(slideXml).toContain('<a:ea typeface="PingFang SC"/>');
    // <a:rFonts> is the WordprocessingML form; PowerPoint rejects it inside <a:rPr>.
    expect(slideXml).not.toContain("<a:rFonts");
  });

  it("emits text-run hyperlinks as <a:hlinkClick> + slide-rel TargetMode=External", async () => {
    const deck: DeckAst = {
      size: "16x9",
      slides: [{
        shapes: [{
          type: "text",
          id: 2,
          xfrm: { x: 0, y: 0, cx: cm(20), cy: cm(3) },
          paragraphs: [{
            runs: [
              { text: "see ", sizeHalfPt: 28 },
              { text: "the docs", sizeHalfPt: 28, hyperlink: "https://example.com/docs" },
              { text: " for more.", sizeHalfPt: 28 },
            ],
          }],
        }],
      }],
    };
    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const slideRels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");

    const m = /<a:hlinkClick[^>]*r:id="(rId\d+)"/.exec(slideXml);
    expect(m, "hlinkClick rId not present").not.toBeNull();
    const rId = m![1]!;
    expect(rId).not.toBe("rId1"); // rId1 is the layout

    const relRe = new RegExp(
      `<Relationship Id="${rId}"[^/]*Type="[^"]+/hyperlink"[^/]*Target="([^"]+)"[^/]*TargetMode="External"`,
    );
    const relMatch = relRe.exec(slideRels);
    expect(relMatch, `slide-rels has no External hyperlink for ${rId}`).not.toBeNull();
    expect(relMatch![1]).toBe("https://example.com/docs");

    // Underline auto-applied for hyperlink runs.
    expect(slideXml).toMatch(/u="sng"/);
  });

  it("sanitizes illegal XML controls and fully escapes relationship targets", async () => {
    const deck: DeckAst = {
      size: "16x9",
      slides: [{
        shapes: [{
          type: "text",
          id: 2,
          xfrm: { x: 0, y: 0, cx: cm(20), cy: cm(3) },
          paragraphs: [{
            runs: [
              { text: "bad\u0000text", sizeHalfPt: 28 },
              { text: "link", sizeHalfPt: 28, hyperlink: "https://example.com/search?q=<x>&mode=\"strict\"" },
            ],
          }],
        }],
      }],
    };

    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const slideRels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");

    expect(slideXml).toContain("badtext");
    expect(slideXml).not.toContain("\u0000");
    expect(slideRels).toContain("q=&lt;x&gt;&amp;mode=&quot;strict&quot;");
  });

  it("emits stacked-bar with grouping=stacked and overlap=100", async () => {
    const deck: DeckAst = {
      size: "16x9",
      slides: [{
        shapes: [{
          type: "chart",
          id: 2,
          xfrm: { x: cm(2), y: cm(2), cx: cm(20), cy: cm(8) },
          chartType: "stacked-bar",
          labels: ["Q1", "Q2"],
          series: [
            { name: "A", values: [10, 20] },
            { name: "B", values: [15, 18] },
          ],
        }],
      }],
    };
    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const chartXml = await zip.file("ppt/charts/chart1.xml")!.async("string");
    const chartRels = await zip.file("ppt/charts/_rels/chart1.xml.rels")!.async("string");
    const contentTypes = await zip.file("[Content_Types].xml")!.async("string");
    expect(chartXml).toContain('<c:grouping val="stacked"/>');
    expect(chartXml).toContain('<c:overlap val="100"/>');
    expect(chartXml).toContain('<c:externalData r:id="rId1">');
    expect(chartXml).toContain("<c:strRef>");
    expect(chartXml).toContain("Sheet1!$B$1");
    expect(chartXml).toContain("<c:strRef>");
    expect(chartXml).toContain("Sheet1!$A$2:$A$3");
    expect(chartXml).toContain("<c:numRef>");
    expect(chartXml).toContain("Sheet1!$B$2:$B$3");
    expect(chartRels).toContain('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package"');
    expect(chartRels).toContain('Target="../embeddings/Microsoft_Excel_Worksheet1.xlsx"');
    expect(contentTypes).toContain('Default Extension="xlsx"');
    expect(contentTypes).toContain('/ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx');
    expect(zip.file("ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx")).toBeTruthy();

    const workbook = await JSZip.loadAsync(await zip.file("ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx")!.async("nodebuffer"));
    expect(workbook.file("docProps/app.xml")).toBeTruthy();
    expect(workbook.file("docProps/core.xml")).toBeTruthy();
    expect(workbook.file("xl/theme/theme1.xml")).toBeTruthy();
    expect(workbook.file("xl/sharedStrings.xml")).toBeTruthy();
    const sheetXml = await workbook.file("xl/worksheets/sheet1.xml")!.async("string");
    const stringsXml = await workbook.file("xl/sharedStrings.xml")!.async("string");
    expect(sheetXml).toContain('t="s"');
    expect(stringsXml).toContain("Q1");
    expect(stringsXml).toContain("A");
    expect(sheetXml).toContain("<v>10</v>");
  });

  it("emits expanded chart controls: axes, legend, plot area, series style, markers", async () => {
    const deck: DeckAst = {
      size: "16x9",
      slides: [{
        shapes: [{
          type: "chart",
          id: 2,
          xfrm: { x: cm(2), y: cm(2), cx: cm(20), cy: cm(8) },
          chartType: "line",
          labels: ["Q1", "Q2", "Q3"],
          xAxis: { title: "Quarter", tickLabelRotation: 35 },
          yAxis: { title: "Revenue", min: 0, max: 200, majorUnit: 50, gridlines: { color: "DDDDDD", width: 6350, dash: "dot" } },
          legend: { position: "right", overlay: true },
          plotArea: { x: 0.12, y: 0.08, w: 0.78, h: 0.78 },
          series: [{
            name: "Revenue",
            values: [100, 130, 170],
            color: "B42318",
            lineWidth: 38100,
            lineDash: "dash",
            marker: { symbol: "diamond", size: 9, fill: "B42318", line: "FFFFFF" },
            smooth: true,
            dataLabels: { show: true, position: "outsideEnd", showValue: true },
          }],
        }],
      }],
    };
    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const chartXml = await zip.file("ppt/charts/chart1.xml")!.async("string");
    expect(chartXml).toContain('<c:legendPos val="r"/>');
    expect(chartXml).toContain('<c:overlay val="1"/>');
    expect(chartXml).toContain("<c:manualLayout>");
    expect(chartXml).toContain("<c:max val=\"200\"/>");
    expect(chartXml).toContain("<c:majorUnit val=\"50\"/>");
    expect(chartXml).toContain("<c:majorGridlines>");
    expect(chartXml).toContain('<a:prstDash val="dot"/>');
    expect(chartXml).toContain("<c:title>");
    expect(chartXml).toContain("Quarter");
    expect(chartXml).toContain("Revenue");
    expect(chartXml).toContain('<a:ln w="38100">');
    expect(chartXml).toContain('<a:prstDash val="dash"/>');
    expect(chartXml).toContain('<c:symbol val="diamond"/>');
    expect(chartXml).toContain('<c:smooth val="1"/>');
    expect(chartXml).toContain('<c:showVal val="1"/>');
  });

  it("escapes chart number format attributes including ampersands", async () => {
    const deck: DeckAst = {
      size: "16x9",
      slides: [{
        shapes: [{
          type: "chart",
          id: 2,
          xfrm: { x: cm(2), y: cm(2), cx: cm(20), cy: cm(8) },
          chartType: "bar",
          labels: ["A"],
          yAxis: { numberFormat: '0 "A&B"' },
          series: [{ name: "Revenue", values: [100] }],
        }],
      }],
    };
    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const chartXml = await zip.file("ppt/charts/chart1.xml")!.async("string");
    expect(chartXml).toContain('formatCode="0 &quot;A&amp;B&quot;"');
  });

  it("keeps manual chart plot area within the chart frame", async () => {
    const deck: DeckAst = {
      size: "16x9",
      slides: [{
        shapes: [{
          type: "chart",
          id: 2,
          xfrm: { x: cm(2), y: cm(2), cx: cm(20), cy: cm(8) },
          chartType: "bar",
          labels: ["A", "B"],
          plotArea: { x: 0.6, y: 0.4, w: 14.5, h: 7 },
          series: [{ name: "Value", values: [1, 2] }],
        }],
      }],
    };
    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const chartXml = await zip.file("ppt/charts/chart1.xml")!.async("string");
    expect(chartXml).toContain('<c:x val="0.6"/>');
    expect(chartXml).toContain('<c:y val="0.4"/>');
    expect(chartXml).toContain('<c:w val="0.4"/>');
    expect(chartXml).toContain('<c:h val="0.6"/>');
  });

  it("emits table style controls: padding, per-side borders, banding, and rich cell text", async () => {
    const deck: DeckAst = {
      size: "16x9",
      slides: [{
        shapes: [{
          type: "table",
          id: 2,
          xfrm: { x: cm(2), y: cm(2), cx: cm(16), cy: cm(4) },
          colWidths: [cm(8), cm(8)],
          rowHeights: [cm(1.2), cm(1.2)],
          firstRowHeader: true,
          tableStyleId: "{5940675A-B579-460E-94D1-54222C63F5DA}",
          bandRows: false,
          bandCols: true,
          cellPadding: { l: cm(0.18), r: cm(0.18), t: cm(0.08), b: cm(0.08) },
          borders: { color: "999999", width: 12700, dash: "dash", top: { color: "111111", width: 25400 } },
          cells: [
            [{ runs: [{ text: "Metric", bold: true, underline: true }] }, { runs: [{ text: "Value", bold: true }] }],
            [{ runs: [{ text: "Growth", color: "B42318", highlight: "FFF2CC" }] }, { runs: [{ text: "+12%" }], align: "right", border: { left: "none" } }],
          ],
        }],
      }],
    };
    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slideXml).toContain('bandRow="0"');
    expect(slideXml).toContain('bandCol="1"');
    expect(slideXml).toContain("{5940675A-B579-460E-94D1-54222C63F5DA}");
    expect(slideXml).toContain('lIns="64800"');
    expect(slideXml).toContain('<a:lnT w="25400"');
    expect(slideXml).toContain('<a:prstDash val="dash"/>');
    expect(slideXml).toContain("<a:lnL><a:noFill/></a:lnL>");
    expect(slideXml).toContain('u="sng"');
    expect(slideXml).toContain("<a:highlight>");
  });

  it("normalizes table style aliases to OOXML GUIDs", async () => {
    const deck: DeckAst = {
      size: "16x9",
      slides: [{
        shapes: [{
          type: "table",
          id: 2,
          name: "Risk table",
          xfrm: { x: cm(2), y: cm(2), cx: cm(12), cy: cm(3) },
          colWidths: [cm(6), cm(6)],
          rowHeights: [cm(1), cm(1)],
          firstRowHeader: true,
          tableStyleId: "lightGridAccent1",
          cells: [
            [{ runs: [{ text: "Risk" }] }, { runs: [{ text: "Owner" }] }],
            [{ runs: [{ text: "High" }] }, { runs: [{ text: "Security" }] }],
          ],
        }],
      }],
    };
    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slideXml).not.toContain("lightGridAccent1");
    expect(slideXml).toContain("{5940675A-B579-460E-94D1-54222C63F5DA}");
  });

  it("emits connector presets with arrowheads and internal slide links", async () => {
    const deck: DeckAst = {
      size: "16x9",
      slides: [
        {
          transition: { type: "fade", durationMs: 350 },
          shapes: [
            {
              type: "shape",
              id: 2,
              preset: "straightConnector",
              xfrm: { x: cm(2), y: cm(2), cx: cm(6), cy: cm(0.01) },
              fill: { type: "none" },
              line: { color: "333333", width: 25400, tailEnd: { type: "triangle", width: "lg", length: "lg" } },
            },
            {
              type: "text",
              id: 3,
              xfrm: { x: cm(2), y: cm(3), cx: cm(8), cy: cm(1) },
              paragraphs: [{ runs: [{ text: "Jump", hyperlink: "#slide2" }] }],
            },
          ],
        },
        { shapes: [{ type: "shape", id: 2, preset: "hexagon", xfrm: { x: cm(2), y: cm(2), cx: cm(2), cy: cm(2) }, fill: { type: "solid", color: "DDDDDD" } }] },
      ],
    };
    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
    expect(slideXml).toContain('prst="straightConnector1"');
    expect(slideXml).toContain('<a:tailEnd type="triangle" w="lg" len="lg"/>');
    expect(slideXml).toContain("<p:transition");
    expect(slideXml).toContain("<p:fade/>");
    expect(slideXml).toContain('action="ppaction://hlinksldjump"');
    expect(rels).toContain('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"');
    expect(rels).toContain('Target="../slides/slide2.xml"');
    const slide2Xml = await zip.file("ppt/slides/slide2.xml")!.async("string");
    expect(slide2Xml).toContain('prst="hexagon"');
  });

  it("emits declared master/layout placeholders into OOXML", async () => {
    const deck: DeckAst = {
      size: "16x9",
      master: {
        layout: "Corporate Two Column",
        placeholders: {
          title: { type: "title", x: cm(1), y: cm(0.7), w: cm(20), h: cm(1.2) },
          body: { type: "body", x: cm(1), y: cm(2.2), w: cm(11), h: cm(6) },
          visual: { type: "image", x: cm(13), y: cm(2.2), w: cm(10), h: cm(6) },
        },
      },
      slides: [{ shapes: [{ type: "shape", id: 2, preset: "rect", xfrm: { x: cm(1), y: cm(1), cx: cm(1), cy: cm(1) }, fill: { type: "solid", color: "FFFFFF" } }] }],
    };
    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const masterXml = await zip.file("ppt/slideMasters/slideMaster1.xml")!.async("string");
    const layoutXml = await zip.file("ppt/slideLayouts/slideLayout1.xml")!.async("string");
    expect(masterXml).toContain('<p:ph type="title"');
    expect(masterXml).toContain('<p:ph type="pic"');
    expect(layoutXml).toContain('name="Corporate Two Column"');
    expect(layoutXml).toContain('<p:ph type="body"');
  });

  it("emits doughnut as <c:doughnutChart> with <c:holeSize>", async () => {
    const deck: DeckAst = {
      size: "16x9",
      slides: [{
        shapes: [{
          type: "chart",
          id: 2,
          xfrm: { x: cm(2), y: cm(2), cx: cm(20), cy: cm(8) },
          chartType: "doughnut",
          labels: ["A", "B", "C"],
          series: [{ name: "Share", values: [40, 35, 25] }],
        }],
      }],
    };
    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const chartXml = await zip.file("ppt/charts/chart1.xml")!.async("string");
    expect(chartXml).toContain("<c:doughnutChart>");
    expect(chartXml).toMatch(/<c:holeSize val="\d+"\/>/);
  });

  it("emits pie/doughnut data labels in the series without a PowerPoint-repairing dLblPos", async () => {
    const deck: DeckAst = {
      size: "16x9",
      slides: [{
        shapes: [{
          type: "chart",
          id: 2,
          xfrm: { x: cm(2), y: cm(2), cx: cm(20), cy: cm(8) },
          chartType: "doughnut",
          labels: ["A", "B", "C"],
          dataLabels: { show: true, position: "outsideEnd", showValue: true, showCategoryName: true },
          series: [{ name: "Share", values: [40, 35, 25] }],
        }],
      }],
    };
    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const chartXml = await zip.file("ppt/charts/chart1.xml")!.async("string");
    expect(chartXml).toContain("<c:dLbls>");
    expect(chartXml).toContain("<c:dLbl><c:idx val=\"0\"/>");
    expect(chartXml).not.toContain("<c:dLblPos");
    expect(chartXml.indexOf("<c:dLbls>")).toBeLessThan(chartXml.indexOf("<c:cat>"));
  });

  it("suppresses tiny pie/doughnut slice labels while keeping major labels", async () => {
    const deck: DeckAst = {
      size: "16x9",
      slides: [{
        shapes: [{
          type: "chart",
          id: 2,
          xfrm: { x: cm(2), y: cm(2), cx: cm(20), cy: cm(8) },
          chartType: "doughnut",
          labels: ["Main", "Tiny A", "Tiny B", "Trace"],
          dataLabels: { show: true, showCategoryName: true, showPercent: true },
          series: [{ name: "Share", values: [826.7, 4.75, 4.67, 0.05] }],
        }],
      }],
    };
    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const chartXml = await zip.file("ppt/charts/chart1.xml")!.async("string");

    expect(chartXml).toContain('<c:dLbl><c:idx val="0"/>');
    expect(chartXml).toContain('<c:dLbl><c:idx val="1"/><c:delete val="1"/></c:dLbl>');
    expect(chartXml).toContain('<c:dLbl><c:idx val="2"/><c:delete val="1"/></c:dLbl>');
    expect(chartXml).toContain('<c:dLbl><c:idx val="3"/><c:delete val="1"/></c:dLbl>');
  });

  it("emits area as <c:areaChart> with translucent series fill", async () => {
    const deck: DeckAst = {
      size: "16x9",
      slides: [{
        shapes: [{
          type: "chart",
          id: 2,
          xfrm: { x: cm(2), y: cm(2), cx: cm(20), cy: cm(8) },
          chartType: "area",
          labels: ["Jan", "Feb", "Mar"],
          series: [{ name: "Trend", values: [12, 18, 24] }],
        }],
      }],
    };
    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const chartXml = await zip.file("ppt/charts/chart1.xml")!.async("string");
    expect(chartXml).toContain("<c:areaChart>");
    expect(chartXml).toMatch(/<a:alpha val="\d+"\/>/);
  });

  it("emits combo charts with secondary value axis", async () => {
    const deck: DeckAst = {
      size: "16x9",
      slides: [{
        shapes: [{
          type: "chart",
          id: 2,
          xfrm: { x: cm(2), y: cm(2), cx: cm(20), cy: cm(8) },
          chartType: "combo",
          labels: ["Q1", "Q2", "Q3"],
          series: [
            { name: "Revenue", values: [100, 120, 140], type: "bar" },
            { name: "Margin", values: [0.32, 0.36, 0.41], type: "line", axis: "secondary" },
          ],
        }],
      }],
    };
    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const chartXml = await zip.file("ppt/charts/chart1.xml")!.async("string");
    expect(chartXml).toContain('<c:axPos val="r"/>');
    expect(chartXml).toContain('<c:axId val="100000003"/>');
    expect(chartXml).toContain('<c:crossAx val="100000001"/>');
  });

  it("emits native trend lines and error bars on chart series", async () => {
    const deck: DeckAst = {
      size: "16x9",
      slides: [{
        shapes: [{
          type: "chart",
          id: 2,
          xfrm: { x: cm(2), y: cm(2), cx: cm(20), cy: cm(8) },
          chartType: "line",
          labels: ["W1", "W2", "W3"],
          series: [{
            name: "Mean",
            values: [10, 12, 16],
            trendLine: { type: "linear", label: "Trend" },
            errorBars: { type: "fixed", value: 1.5 },
          }],
        }],
      }],
    };
    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const chartXml = await zip.file("ppt/charts/chart1.xml")!.async("string");
    expect(chartXml).toContain("<c:trendline>");
    expect(chartXml).toContain("<c:name>Trend</c:name>");
    expect(chartXml).toContain('<c:trendlineType val="linear"/>');
    expect(chartXml).toContain("<c:errBars>");
    expect(chartXml).toContain('<c:errValType val="fixedVal"/>');
    expect(chartXml).toContain('<c:val val="1.5"/>');
  });

  it("emits scatter chart x/y refs against the embedded workbook", async () => {
    const deck: DeckAst = {
      size: "16x9",
      slides: [{
        shapes: [{
          type: "chart",
          id: 2,
          xfrm: { x: cm(2), y: cm(2), cx: cm(20), cy: cm(8) },
          chartType: "scatter",
          labels: ["0", "1"],
          series: [
            { name: "Observed", values: [], points: [{ x: 1, y: 2 }, { x: 3, y: 5 }] },
            { name: "Projected", values: [], points: [{ x: 1, y: 3 }, { x: 3, y: 8 }] },
          ],
        }],
      }],
    };
    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const chartXml = await zip.file("ppt/charts/chart1.xml")!.async("string");
    expect(chartXml).toContain("<c:scatterChart>");
    expect(chartXml).toContain("Sheet1!$A$2:$A$3");
    expect(chartXml).toContain("Sheet1!$B$2:$B$3");
    expect(chartXml).toContain("Sheet1!$C$2:$C$3");
    expect(chartXml).toContain("Sheet1!$D$2:$D$3");

    const workbook = await JSZip.loadAsync(await zip.file("ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx")!.async("nodebuffer"));
    const sheetXml = await workbook.file("xl/worksheets/sheet1.xml")!.async("string");
    const stringsXml = await workbook.file("xl/sharedStrings.xml")!.async("string");
    expect(stringsXml).toContain("Observed x");
    expect(stringsXml).toContain("Observed y");
    expect(stringsXml).toContain("Projected x");
    expect(stringsXml).toContain("Projected y");
    expect(sheetXml).toContain("<v>8</v>");
  });

  it("emits chart graphicFrame with <a:graphicFrameLocks noGrp=\"1\"/> (PowerPoint requirement)", async () => {
    const deck: DeckAst = {
      size: "16x9",
      slides: [{
        shapes: [{
          type: "chart",
          id: 2,
          xfrm: { x: cm(2), y: cm(2), cx: cm(20), cy: cm(8) },
          chartType: "bar",
          labels: ["Q1", "Q2"],
          series: [{ name: "rev", values: [10, 20] }],
        }],
      }],
    };
    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slideXml).toContain('<a:graphicFrameLocks noGrp="1"/>');
    expect(slideXml).not.toContain("<p:cNvGraphicFramePr/>");
  });

  it("renders a short Chinese deck without crashing on smart quotes", async () => {
    const deck: DeckAst = {
      size: "16x9",
      language: "zh-CN",
      slides: [{
        shapes: [{
          type: "text",
          id: 2,
          xfrm: { x: cm(2), y: cm(2), cx: cm(20), cy: cm(3) },
          paragraphs: [{
            runs: [{ text: "他说\u201C你好\u201D。", sizeHalfPt: 36, cjk: true, fontFace: "PingFang SC" }],
          }],
        }],
      }],
    };
    const zip = await JSZip.loadAsync(await emitPackage(deck));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slideXml).toContain("&#x201C;");
    expect(slideXml).toContain("&#x201D;");
  });
});
