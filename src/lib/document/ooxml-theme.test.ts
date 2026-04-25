import { describe, expect, it } from "vitest";
import { parseOoxmlTheme, resolveOoxmlColor } from "./ooxml-theme";

describe("OOXML theme color resolution", () => {
  it("resolves srgb, system, and scheme colors", () => {
    const theme = parseOoxmlTheme(themeXml());

    expect(resolveOoxmlColor('<a:srgbClr val="ff0000"/>', theme)).toBe("#FF0000");
    expect(resolveOoxmlColor('<a:sysClr val="windowText" lastClr="101010"/>', theme)).toBe("#101010");
    expect(resolveOoxmlColor('<a:schemeClr val="accent1"/>', theme)).toBe("#1D4ED8");
  });

  it("applies tint, shade, luminance, and alpha transforms", () => {
    const theme = parseOoxmlTheme(themeXml());

    expect(resolveOoxmlColor('<a:schemeClr val="accent1"><a:tint val="50000"/></a:schemeClr>', theme)).toBe("#8EA7EC");
    expect(resolveOoxmlColor('<a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr>', theme)).toBe("#0F276C");
    expect(resolveOoxmlColor('<a:srgbClr val="808080"><a:lumMod val="50000"/></a:srgbClr>', theme)).toBe("#404040");
    expect(resolveOoxmlColor('<a:srgbClr val="336699"><a:alpha val="50000"/></a:srgbClr>', theme)).toBe("rgba(51, 102, 153, 0.5)");
  });
});

function themeXml(): string {
  return `
    <a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <a:themeElements>
        <a:clrScheme name="Test">
          <a:dk1><a:srgbClr val="111827"/></a:dk1>
          <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
          <a:accent1><a:srgbClr val="1D4ED8"/></a:accent1>
        </a:clrScheme>
      </a:themeElements>
    </a:theme>
  `;
}
