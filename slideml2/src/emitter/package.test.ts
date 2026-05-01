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
    expect(chartXml).toContain('<c:grouping val="stacked"/>');
    expect(chartXml).toContain('<c:overlap val="100"/>');
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
