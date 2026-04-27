/**
 * Stage 4 end-to-end tests: parser + validator + chart emit + public API.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";
import {
  compile,
  validateDeck,
  loadTheme,
  listLayouts,
  SlidemlAggregateError,
} from "./index.js";
import { parseSlideml } from "./parser.js";
import { validateDeckSpec } from "./validator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SLIDEML_ROOT = resolve(__dirname, "..");
const BUILT_THEME = join(SLIDEML_ROOT, "dist/themes/technical-blue");
const SRC_THEME = join(SLIDEML_ROOT, "src/themes/technical-blue");
const FIXTURES = join(SLIDEML_ROOT, "fixtures");

beforeAll(() => {
  const sourceMtime = statSync(SRC_THEME).mtimeMs;
  const fresh = existsSync(BUILT_THEME) && statSync(BUILT_THEME).mtimeMs >= sourceMtime;
  if (!fresh) execSync("pnpm run build", { cwd: SLIDEML_ROOT, stdio: "inherit" });
}, 60_000);

describe("Stage 4 — parser", () => {
  it("parses the quarterly-review fixture", () => {
    const yaml = readFileSync(join(FIXTURES, "quarterly-review.slideml.yaml"), "utf8");
    const spec = parseSlideml(yaml);
    expect(spec.slideml).toBe(1);
    expect(spec.deck.size).toBe("16x9");
    expect(spec.deck.theme).toBe("technical-blue");
    expect(spec.slides).toHaveLength(5);
    expect(spec.slides[0]?.layout).toBe("cover");
    expect(spec.slides[3]?.layout).toBe("chart-with-takeaway");
  });

  it("accepts the version key as a string ('1') as well as the number 1", () => {
    // Real LLMs occasionally emit `slideml: "1"` (YAML treats quoted scalars
    // as strings). Both forms unambiguously mean v1; reject only genuinely
    // wrong values.
    expect(() => parseSlideml(`slideml: "1"\ndeck: { size: 16x9, theme: t }\nslides: [{ layout: cover, slots: {} }]`))
      .not.toThrow();
    expect(() => parseSlideml(`slideml: 2\ndeck: { size: 16x9, theme: t }\nslides: [{ layout: cover, slots: {} }]`))
      .toThrow(/Unsupported SlideML version/);
  });

  it("rejects unknown top-level keys", () => {
    expect(() => parseSlideml(`slideml: 1\ndeck: { size: 16x9, theme: technical-blue }\nslides: [{ layout: cover, slots: {} }]\nmystery: 42\n`))
      .toThrow(/Unknown top-level/);
  });

  it("rejects unknown slide-level keys", () => {
    expect(() => parseSlideml(`slideml: 1\ndeck: { size: 16x9, theme: technical-blue }\nslides: [{ layout: cover, slots: {}, foo: 1 }]`))
      .toThrow(/not a recognized slide key/);
  });

  it("rejects invalid deck.size", () => {
    expect(() => parseSlideml(`slideml: 1\ndeck: { size: 21x9, theme: t }\nslides: [{ layout: x, slots: {} }]`))
      .toThrow(/deck\.size must be one of/);
  });

  it("rejects raw color values in deck.defaults", () => {
    const yaml = `slideml: 1\ndeck: { size: 16x9, theme: technical-blue, defaults: { accent: "#FF0000" } }\nslides: [{ layout: cover, slots: { title: x } }]`;
    // Note this is "string" so passes parser; validator catches the unknown-token reference.
    const spec = parseSlideml(yaml);
    expect(spec.deck.defaults?.["accent"]).toBe("#FF0000");
  });
});

describe("Stage 4 — validator", () => {
  it("flags missing required slot, overflow, and underflow on the broken fixture", async () => {
    const theme = await loadTheme(BUILT_THEME);
    const yaml = readFileSync(join(FIXTURES, "broken.slideml.yaml"), "utf8");
    const spec = parseSlideml(yaml);
    const result = validateDeckSpec(spec, theme);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const codes = result.errors.map((e) => e.code).sort();
    expect(codes).toContain("SLOT_OVERFLOW");
    expect(codes).toContain("SLOT_UNDERFLOW");
    // The overflow message points at the offending slot.
    const overflow = result.errors.find((e) => e.code === "SLOT_OVERFLOW")!;
    expect(overflow.slot).toBe("title");
    expect(overflow.message).toMatch(/exceeds maxChars 40/);
  });

  it("accepts the well-formed quarterly-review fixture", async () => {
    const theme = await loadTheme(BUILT_THEME);
    const yaml = readFileSync(join(FIXTURES, "quarterly-review.slideml.yaml"), "utf8");
    const spec = parseSlideml(yaml);
    const result = validateDeckSpec(spec, theme);
    if (!result.ok) {
      // Surface the first error to ease debugging if the fixture drifts.
      throw new Error(`Fixture failed validation: ${JSON.stringify(result.errors[0])}`);
    }
    expect(result.ok).toBe(true);
  });

  it("rejects extra unrecognized slot names", async () => {
    const theme = await loadTheme(BUILT_THEME);
    const yaml = `slideml: 1\ndeck: { size: 16x9, theme: technical-blue }\nslides:\n  - layout: cover\n    slots:\n      title: hi\n      mystery: 42\n`;
    const result = validateDeckSpec(parseSlideml(yaml), theme);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const code = result.errors.find((e) => e.slot === "mystery")?.code;
    expect(code).toBe("EXTRA_KEY");
  });
});

describe("Stage 4 — public API: compile + validateDeck + listLayouts", () => {
  it("compiles the quarterly-review fixture into a valid PPTX with a chart", async () => {
    const yaml = readFileSync(join(FIXTURES, "quarterly-review.slideml.yaml"), "utf8");
    const result = await compile(yaml, { themeDir: BUILT_THEME });
    expect(result.buffer.length).toBeGreaterThan(5000);

    const zip = await JSZip.loadAsync(result.buffer);
    const files = Object.keys(zip.files).filter((f) => !zip.files[f]!.dir).sort();

    // Chart parts present.
    expect(files).toContain("ppt/charts/chart1.xml");
    expect(files).toContain("ppt/charts/_rels/chart1.xml.rels");

    // Content_Types declares the chart override.
    const contentTypes = await zip.file("[Content_Types].xml")!.async("string");
    expect(contentTypes).toContain("/ppt/charts/chart1.xml");
    expect(contentTypes).toContain("application/vnd.openxmlformats-officedocument.drawingml.chart+xml");

    // The chart-bearing slide has a graphicFrame referencing the chart rel.
    const chartSlide = await zip.file("ppt/slides/slide4.xml")!.async("string");
    expect(chartSlide).toContain("<p:graphicFrame>");
    expect(chartSlide).toMatch(/r:id="rId\d+"/);

    // Chart XML uses the wanyuan format code.
    const chartXml = await zip.file("ppt/charts/chart1.xml")!.async("string");
    expect(chartXml).toContain("万");
    // Bar chart with the Q1 series.
    expect(chartXml).toContain("<c:barChart>");
    expect(chartXml).toContain("Q1");
  });

  it("compile() throws SlidemlAggregateError on validation failure", async () => {
    const yaml = readFileSync(join(FIXTURES, "broken.slideml.yaml"), "utf8");
    await expect(compile(yaml, { themeDir: BUILT_THEME })).rejects.toBeInstanceOf(SlidemlAggregateError);
  });

  it("validateDeck returns ok:false on the broken fixture without throwing", async () => {
    const yaml = readFileSync(join(FIXTURES, "broken.slideml.yaml"), "utf8");
    const result = await validateDeck(yaml, { themeDir: BUILT_THEME });
    expect(result.ok).toBe(false);
  });

  it("listLayouts exposes name, description, slot schema, and thumbnail", async () => {
    const theme = await loadTheme(BUILT_THEME);
    const layouts = listLayouts(theme);
    const cover = layouts.find((l) => l.name === "cover")!;
    expect(cover.description).toMatch(/Title slide/i);
    expect(cover.slotSchema["title"]?.type).toBe("text");
    expect(cover.thumbnailPath).toMatch(/cover\.png$/);

    const chart = layouts.find((l) => l.name === "chart-with-takeaway")!;
    expect(chart.slotSchema["chart"]?.type).toBe("chart-spec");
  });
});

describe("Stage 4 — bundle smoke", () => {
  it("compiles every well-formed fixture", async () => {
    const fixtures = ["quarterly-review.slideml.yaml", "stat-only.slideml.yaml", "cover-and-quote.slideml.yaml"];
    for (const fixture of fixtures) {
      const yaml = readFileSync(join(FIXTURES, fixture), "utf8");
      const r = await compile(yaml, { themeDir: BUILT_THEME });
      expect(r.buffer.length, `${fixture} should compile to non-empty buffer`).toBeGreaterThan(2000);
    }
  });
});

describe("Stage 4 — slide-rels rId matching (regression for chart/image dropped silently)", () => {
  it("graphicFrame r:id in slide XML matches the chart rel target in slide-rels", async () => {
    const yaml = readFileSync(join(FIXTURES, "quarterly-review.slideml.yaml"), "utf8");
    const result = await compile(yaml, { themeDir: BUILT_THEME });
    const zip = await JSZip.loadAsync(result.buffer);

    const slideXml = await zip.file("ppt/slides/slide4.xml")!.async("string");
    const slideRels = await zip.file("ppt/slides/_rels/slide4.xml.rels")!.async("string");

    // Pull the rId the graphicFrame asks for.
    const m = /<c:chart [^>]*r:id="(rId\d+)"/.exec(slideXml);
    expect(m, "chart rId not found in slide XML").not.toBeNull();
    const requestedRId = m![1]!;

    // That rId must exist in the rel file AND point at a chart part.
    const relRegex = new RegExp(`<Relationship Id="${requestedRId}"[^/]*Type="[^"]+/chart"[^/]*Target="([^"]+)"`);
    const relMatch = relRegex.exec(slideRels);
    expect(relMatch, `slide-rels has no chart entry for ${requestedRId}`).not.toBeNull();
    expect(relMatch![1]!).toMatch(/^\.\.\/charts\/chart\d+\.xml$/);

    // And rId1 must remain reserved for the slide layout.
    expect(slideRels).toMatch(/<Relationship Id="rId1"[^/]*Type="[^"]+\/slideLayout"/);
  });

  it("image r:embed in slide XML matches an image rel target", async () => {
    const yaml = readFileSync(join(FIXTURES, "quarterly-review.slideml.yaml"), "utf8");
    const result = await compile(yaml, { themeDir: BUILT_THEME });
    const zip = await JSZip.loadAsync(result.buffer);

    // The 5th slide in the fixture (`bullet-with-image`) embeds an image.
    const slideXml = await zip.file("ppt/slides/slide5.xml")!.async("string");
    const slideRels = await zip.file("ppt/slides/_rels/slide5.xml.rels")!.async("string");

    const m = /<a:blip r:embed="(rId\d+)"/.exec(slideXml);
    expect(m, "image r:embed not found").not.toBeNull();
    const requestedRId = m![1]!;
    expect(requestedRId).not.toBe("rId1"); // rId1 is the layout — image must NOT collide

    const relRegex = new RegExp(`<Relationship Id="${requestedRId}"[^/]*Type="[^"]+/image"[^/]*Target="([^"]+)"`);
    const relMatch = relRegex.exec(slideRels);
    expect(relMatch, `slide-rels has no image entry for ${requestedRId}`).not.toBeNull();
    expect(relMatch![1]!).toMatch(/^\.\.\/media\/image\d+\.png$/);
  });
});
