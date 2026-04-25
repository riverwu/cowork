import { describe, expect, it } from "vitest";
import { importPptxPackage, type PptxPackage } from "./pptx-importer";

describe("importPptxPackage", () => {
  it("imports slide size, ordered slides, text boxes, and images from a pptx package map", () => {
    const model = importPptxPackage(samplePackage(), "Quarterly Review");

    expect(model.title).toBe("Quarterly Review");
    expect(model.size).toEqual({ width: 13.3333, height: 7.5, unit: "in" });
    expect(model.slides).toHaveLength(2);
    expect(model.slides[0].title).toBe("Executive Summary");

    const title = model.slides[0].elements.find((element) => element.type === "text" && element.text === "Executive Summary");
    expect(title).toMatchObject({
      type: "text",
      placeholder: "title",
      bbox: { x: 0.5, y: 0.3, w: 5, h: 0.6 },
    });

    const image = model.slides[0].elements.find((element) => element.type === "image");
    expect(image).toMatchObject({
      relationshipId: "rIdImage1",
      mediaPath: "ppt/media/image1.png",
      dataUri: "data:image/png;base64,iVBORw0KGgo=",
      bbox: { x: 7, y: 1.2, w: 2, h: 1.5 },
    });
    expect(model.media).toEqual([
      { id: "media_1", path: "ppt/media/image1.png", contentType: "image/png", dataUri: "data:image/png;base64,iVBORw0KGgo=" },
    ]);

    expect(model.slides[1].title).toBe("Appendix");
  });

  it("inherits slide background and placeholder geometry from slide layouts", () => {
    const model = importPptxPackage(layoutInheritancePackage(), "Template Deck");

    expect(model.slides[0].background).toEqual({ color: "rgba(232, 238, 248, 0.8)" });
    const title = model.slides[0].elements.find((element) => element.type === "text" && element.placeholder === "title");
    expect(title).toMatchObject({
      bbox: { x: 0.75, y: 0.5, w: 8, h: 0.8 },
      style: { fontSize: 34, color: "#1D4ED8", fontFace: "Aptos Display" },
    });
  });

  it("imports OOXML text box layout properties from bodyPr and pPr", () => {
    const model = importPptxPackage(textLayoutPackage(), "Text Layout");
    const body = model.slides[0].elements.find((element) => element.type === "text" && element.text.includes("First line"));

    expect(body).toMatchObject({
      type: "text",
      layout: {
        horizontalAlign: "center",
        verticalAlign: "middle",
        marginLeft: 0.1,
        marginRight: 0.2,
        marginTop: 0.05,
        marginBottom: 0.15,
        lineSpacing: 1.2,
        bullet: true,
        autoFit: "shrink",
      },
    });
  });

  it("imports OOXML shape fill, line, shadow, and transform properties", () => {
    const model = importPptxPackage(shapeStylePackage(), "Shape Style");
    const shape = model.slides[0].elements.find((element) => element.type === "shape" && element.name === "Styled Shape");

    expect(shape).toMatchObject({
      type: "shape",
      fill: {
        type: "gradient",
        angle: 45,
        stops: [
          { position: 0, color: "#FF0000" },
          { position: 1, color: "#0000FF" },
        ],
      },
      line: {
        color: "#00FF00",
        width: 2,
        dash: "dash",
      },
      effects: {
        shadow: {
          color: "rgba(0, 0, 0, 0.35)",
          blur: 4,
          distance: 3,
          direction: 45,
        },
      },
      transform: {
        rotation: 30,
        flipH: true,
        flipV: false,
      },
    });
  });

  it("imports OOXML image crop, opacity, and transform properties", () => {
    const model = importPptxPackage(imageStylePackage(), "Image Style");
    const image = model.slides[0].elements.find((element) => element.type === "image");

    expect(image).toMatchObject({
      type: "image",
      crop: {
        left: 0.1,
        right: 0.2,
        top: 0.05,
        bottom: 0.15,
      },
      opacity: 0.7,
      transform: {
        rotation: 15,
        flipH: false,
        flipV: true,
      },
    });
  });

  it("imports OOXML table rows, columns, and cell styles", () => {
    const model = importPptxPackage(tablePackage(), "Table Deck");
    const table = model.slides[0].elements.find((element) => element.type === "table");

    expect(table).toMatchObject({
      type: "table",
      bbox: { x: 1, y: 1, w: 4, h: 1.5 },
      columns: [2, 2],
      rows: [
        {
          height: 0.5,
          cells: [
            {
              text: "Metric",
              fill: { type: "solid", color: "#D9EAF7" },
              borders: {
                bottom: {
                  color: "#1D4ED8",
                  width: 1,
                },
              },
            },
            { text: "Value" },
          ],
        },
        {
          height: 0.5,
          cells: [
            { text: "Revenue" },
            { text: "$12M" },
          ],
        },
      ],
      style: {
        firstRow: true,
        bandRow: true,
      },
    });
  });

  it("preserves slide XML order for PowerPoint z-order", () => {
    const model = importPptxPackage(zOrderPackage(), "Z Order");
    expect(model.slides[0].elements.map((element) => element.name)).toEqual([
      "Back Shape",
      "Middle Image",
      "Front Shape",
    ]);
  });
});

function samplePackage(): PptxPackage {
  return {
    files: {
      "ppt/presentation.xml": `
        <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <p:sldSz cx="12192000" cy="6858000"/>
          <p:sldIdLst>
            <p:sldId id="256" r:id="rId2"/>
            <p:sldId id="257" r:id="rId1"/>
          </p:sldIdLst>
        </p:presentation>
      `,
      "ppt/_rels/presentation.xml.rels": `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="slide" Target="slides/slide2.xml"/>
          <Relationship Id="rId2" Type="slide" Target="slides/slide1.xml"/>
        </Relationships>
      `,
      "ppt/slides/slide1.xml": slideXml("Executive Summary", "title", true),
      "ppt/slides/_rels/slide1.xml.rels": `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rIdImage1" Type="image" Target="../media/image1.png"/>
        </Relationships>
      `,
      "ppt/slides/slide2.xml": slideXml("Appendix", "title", false),
    } as PptxPackage["files"],
    media: {
      "ppt/media/image1.png": { mime_type: "image/png", data: "iVBORw0KGgo=" },
    },
  };
}

function slideXml(title: string, placeholder: string, withImage: boolean): string {
  return `
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:cSld><p:spTree>
        <p:sp>
          <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:nvPr><p:ph type="${placeholder}"/></p:nvPr></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="457200" y="274320"/><a:ext cx="4572000" cy="548640"/></a:xfrm></p:spPr>
          <p:txBody><a:p><a:r><a:rPr sz="3200"/><a:t>${title}</a:t></a:r></a:p></p:txBody>
        </p:sp>
        <p:sp>
          <p:nvSpPr><p:cNvPr id="3" name="Body"/><p:nvPr/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="457200" y="1188720"/><a:ext cx="5486400" cy="914400"/></a:xfrm></p:spPr>
          <p:txBody><a:p><a:r><a:t>Revenue grew 24%</a:t></a:r></a:p></p:txBody>
        </p:sp>
        ${withImage ? `
          <p:pic>
            <p:nvPicPr><p:cNvPr id="4" name="Product image"/></p:nvPicPr>
            <p:blipFill><a:blip r:embed="rIdImage1"/></p:blipFill>
            <p:spPr><a:xfrm><a:off x="6400800" y="1097280"/><a:ext cx="1828800" cy="1371600"/></a:xfrm></p:spPr>
          </p:pic>
        ` : ""}
      </p:spTree></p:cSld>
    </p:sld>
  `;
}

function layoutInheritancePackage(): PptxPackage {
  return {
    files: {
      "ppt/presentation.xml": `
        <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <p:sldSz cx="12192000" cy="6858000"/>
          <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
        </p:presentation>
      `,
      "ppt/_rels/presentation.xml.rels": `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="slide" Target="slides/slide1.xml"/>
        </Relationships>
      `,
      "ppt/slides/slide1.xml": `
        <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <p:cSld><p:spTree>
            <p:sp>
              <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
              <p:txBody><a:p><a:r><a:t>Inherited Title</a:t></a:r></a:p></p:txBody>
            </p:sp>
          </p:spTree></p:cSld>
        </p:sld>
      `,
      "ppt/slides/_rels/slide1.xml.rels": `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rIdLayout1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
        </Relationships>
      `,
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels": `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rIdMaster1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
        </Relationships>
      `,
      "ppt/slideLayouts/slideLayout1.xml": `
        <p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <p:cSld>
            <p:bg><p:bgPr><a:solidFill><a:schemeClr val="lt2"><a:alpha val="80000"/></a:schemeClr></a:solidFill></p:bgPr></p:bg>
            <p:spTree>
              <p:sp>
                <p:nvSpPr><p:cNvPr id="2" name="Title Placeholder"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
                <p:spPr><a:xfrm><a:off x="685800" y="457200"/><a:ext cx="7315200" cy="731520"/></a:xfrm></p:spPr>
                <p:txBody><a:p><a:r><a:rPr sz="3400"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:latin typeface="Aptos Display"/></a:rPr><a:t>Layout Title</a:t></a:r></a:p></p:txBody>
              </p:sp>
            </p:spTree>
          </p:cSld>
        </p:sldLayout>
      `,
      "ppt/slideMasters/slideMaster1.xml": `
        <p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:cSld><p:spTree/></p:cSld>
        </p:sldMaster>
      `,
      "ppt/slideMasters/_rels/slideMaster1.xml.rels": `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rIdTheme1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
        </Relationships>
      `,
      "ppt/theme/theme1.xml": `
        <a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Test Theme">
          <a:themeElements>
            <a:clrScheme name="Test">
              <a:dk1><a:srgbClr val="111827"/></a:dk1>
              <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
              <a:dk2><a:srgbClr val="1F2937"/></a:dk2>
              <a:lt2><a:srgbClr val="E8EEF8"/></a:lt2>
              <a:accent1><a:srgbClr val="1D4ED8"/></a:accent1>
            </a:clrScheme>
            <a:fontScheme name="Test">
              <a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont>
              <a:minorFont><a:latin typeface="Aptos"/></a:minorFont>
            </a:fontScheme>
          </a:themeElements>
        </a:theme>
      `,
    },
  };
}

function textLayoutPackage(): PptxPackage {
  return {
    files: {
      "ppt/presentation.xml": `
        <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <p:sldSz cx="12192000" cy="6858000"/>
          <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
        </p:presentation>
      `,
      "ppt/_rels/presentation.xml.rels": `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="slide" Target="slides/slide1.xml"/>
        </Relationships>
      `,
      "ppt/slides/slide1.xml": `
        <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:cSld><p:spTree>
            <p:sp>
              <p:nvSpPr><p:cNvPr id="3" name="Body"/><p:nvPr/></p:nvSpPr>
              <p:spPr><a:xfrm><a:off x="457200" y="914400"/><a:ext cx="5486400" cy="1828800"/></a:xfrm></p:spPr>
              <p:txBody>
                <a:bodyPr anchor="mid" lIns="91440" rIns="182880" tIns="45720" bIns="137160"><a:normAutofit/></a:bodyPr>
                <a:p>
                  <a:pPr algn="ctr"><a:lnSpc><a:spcPct val="120000"/></a:lnSpc><a:buChar char="•"/></a:pPr>
                  <a:r><a:t>First line</a:t></a:r>
                </a:p>
              </p:txBody>
            </p:sp>
          </p:spTree></p:cSld>
        </p:sld>
      `,
    },
  };
}

function shapeStylePackage(): PptxPackage {
  return {
    files: {
      "ppt/presentation.xml": `
        <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <p:sldSz cx="12192000" cy="6858000"/>
          <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
        </p:presentation>
      `,
      "ppt/_rels/presentation.xml.rels": `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="slide" Target="slides/slide1.xml"/>
        </Relationships>
      `,
      "ppt/slides/slide1.xml": `
        <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:cSld><p:spTree>
            <p:sp>
              <p:nvSpPr><p:cNvPr id="4" name="Styled Shape"/><p:nvPr/></p:nvSpPr>
              <p:spPr>
                <a:xfrm rot="1800000" flipH="1"><a:off x="914400" y="914400"/><a:ext cx="1828800" cy="914400"/></a:xfrm>
                <a:prstGeom prst="roundRect"/>
                <a:gradFill>
                  <a:gsLst>
                    <a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs>
                    <a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs>
                  </a:gsLst>
                  <a:lin ang="2700000"/>
                </a:gradFill>
                <a:ln w="25400"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill><a:prstDash val="dash"/></a:ln>
                <a:effectLst>
                  <a:outerShdw blurRad="50800" dist="38100" dir="2700000"><a:srgbClr val="000000"><a:alpha val="35000"/></a:srgbClr></a:outerShdw>
                </a:effectLst>
              </p:spPr>
            </p:sp>
          </p:spTree></p:cSld>
        </p:sld>
      `,
    },
  };
}

function imageStylePackage(): PptxPackage {
  return {
    files: {
      "ppt/presentation.xml": `
        <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <p:sldSz cx="12192000" cy="6858000"/>
          <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
        </p:presentation>
      `,
      "ppt/_rels/presentation.xml.rels": `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="slide" Target="slides/slide1.xml"/>
        </Relationships>
      `,
      "ppt/slides/_rels/slide1.xml.rels": `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rIdImage1" Type="image" Target="../media/image1.png"/>
        </Relationships>
      `,
      "ppt/slides/slide1.xml": `
        <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <p:cSld><p:spTree>
            <p:pic>
              <p:nvPicPr><p:cNvPr id="5" name="Styled Image"/></p:nvPicPr>
              <p:blipFill>
                <a:blip r:embed="rIdImage1"><a:alpha val="70000"/></a:blip>
                <a:srcRect l="10000" r="20000" t="5000" b="15000"/>
                <a:stretch><a:fillRect/></a:stretch>
              </p:blipFill>
              <p:spPr><a:xfrm rot="900000" flipV="1"><a:off x="914400" y="914400"/><a:ext cx="1828800" cy="1371600"/></a:xfrm></p:spPr>
            </p:pic>
          </p:spTree></p:cSld>
        </p:sld>
      `,
    },
    media: {
      "ppt/media/image1.png": { mime_type: "image/png", data: "iVBORw0KGgo=" },
    },
  };
}

function tablePackage(): PptxPackage {
  return {
    files: {
      "ppt/presentation.xml": `
        <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <p:sldSz cx="12192000" cy="6858000"/>
          <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
        </p:presentation>
      `,
      "ppt/_rels/presentation.xml.rels": `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="slide" Target="slides/slide1.xml"/>
        </Relationships>
      `,
      "ppt/slides/slide1.xml": `
        <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:cSld><p:spTree>
            <p:graphicFrame>
              <p:nvGraphicFramePr><p:cNvPr id="7" name="Revenue Table"/></p:nvGraphicFramePr>
              <p:xfrm><a:off x="914400" y="914400"/><a:ext cx="3657600" cy="1371600"/></p:xfrm>
              <a:graphic><a:graphicData>
                <a:tbl>
                  <a:tblPr firstRow="1" bandRow="1"/>
                  <a:tblGrid><a:gridCol w="1828800"/><a:gridCol w="1828800"/></a:tblGrid>
                  <a:tr h="457200">
                    <a:tc>
                      <a:txBody><a:bodyPr/><a:p><a:r><a:rPr b="1" sz="1400"/><a:t>Metric</a:t></a:r></a:p></a:txBody>
                      <a:tcPr>
                        <a:solidFill><a:srgbClr val="D9EAF7"/></a:solidFill>
                        <a:lnB w="12700"><a:solidFill><a:srgbClr val="1D4ED8"/></a:solidFill></a:lnB>
                      </a:tcPr>
                    </a:tc>
                    <a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Value</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
                  </a:tr>
                  <a:tr h="457200">
                    <a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Revenue</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
                    <a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>$12M</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
                  </a:tr>
                </a:tbl>
              </a:graphicData></a:graphic>
            </p:graphicFrame>
          </p:spTree></p:cSld>
        </p:sld>
      `,
    },
  };
}

function zOrderPackage(): PptxPackage {
  return {
    files: {
      "ppt/presentation.xml": `
        <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <p:sldSz cx="12192000" cy="6858000"/>
          <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
        </p:presentation>
      `,
      "ppt/_rels/presentation.xml.rels": `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="slide" Target="slides/slide1.xml"/>
        </Relationships>
      `,
      "ppt/slides/_rels/slide1.xml.rels": `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rIdImage1" Type="image" Target="../media/image1.png"/>
        </Relationships>
      `,
      "ppt/slides/slide1.xml": `
        <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <p:cSld><p:spTree>
            <p:sp>
              <p:nvSpPr><p:cNvPr id="2" name="Back Shape"/></p:nvSpPr>
              <p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>
            </p:sp>
            <p:pic>
              <p:nvPicPr><p:cNvPr id="3" name="Middle Image"/></p:nvPicPr>
              <p:blipFill><a:blip r:embed="rIdImage1"/></p:blipFill>
              <p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="1828800" cy="914400"/></a:xfrm></p:spPr>
            </p:pic>
            <p:sp>
              <p:nvSpPr><p:cNvPr id="4" name="Front Shape"/></p:nvSpPr>
              <p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>
            </p:sp>
          </p:spTree></p:cSld>
        </p:sld>
      `,
    },
    media: {
      "ppt/media/image1.png": { mime_type: "image/png", data: "iVBORw0KGgo=" },
    },
  };
}
