import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { clearRenderDiagnostics, getRenderDiagnostics } from "./diagnostics.js";
import { latexToOmml } from "./latex-omml.js";
import { latexToMathText } from "./m3-rich-inline.js";
import { renderToAst, renderToPptx } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { Slideml2SourceDeck } from "./types.js";
import { validateDeck } from "./validate.js";

function allRunTexts(ast: ReturnType<typeof renderToAst>): string[] {
  const out: string[] = [];
  for (const slide of ast.slides) {
    for (const shape of slide.shapes) {
      if (shape.type === "text") {
        for (const para of shape.paragraphs) for (const run of para.runs) out.push(run.text);
      } else if (shape.type === "table") {
        for (const row of shape.cells) for (const cell of row) for (const run of cell.runs) out.push(run.text);
      }
    }
  }
  return out;
}

function firstTable(ast: ReturnType<typeof renderToAst>) {
  for (const slide of ast.slides) {
    for (const shape of slide.shapes) if (shape.type === "table") return shape;
  }
  return undefined;
}

function allTables(ast: ReturnType<typeof renderToAst>): Array<Extract<ReturnType<typeof renderToAst>["slides"][number]["shapes"][number], { type: "table" }>> {
  const out: Array<Extract<ReturnType<typeof renderToAst>["slides"][number]["shapes"][number], { type: "table" }>> = [];
  for (const slide of ast.slides) {
    for (const shape of slide.shapes) if (shape.type === "table") out.push(shape);
  }
  return out;
}

describe("M3 scientific authoring capabilities", () => {
  it("converts common LaTeX formula input into readable editable math text", () => {
    expect(latexToMathText("\\sin^2\\alpha + \\cos^2\\alpha = 1")).toBe("sin² α + cos² α = 1");
    expect(latexToMathText("\\tan\\alpha = \\frac{\\sin\\alpha}{\\cos\\alpha}")).toBe("tan α = sin α/cos α");
    expect(latexToMathText("\\sin(\\alpha+\\beta)=\\sin\\alpha\\cos\\beta+\\cos\\alpha\\sin\\beta")).toBe("sin(α + β) = sin α cos β + cos α sin β");
    expect(latexToMathText("\\frac{a}{\\sin A}=\\frac{b}{\\sin B}=\\frac{c}{\\sin C}=2R")).toBe("a/sin A = b/sin B = c/sin C = 2R");
    expect(latexToMathText("c^2=a^2+b^2-2ab\\cos C")).toBe("c² = a² + b² - 2ab cos C");
    expect(latexToMathText("\\boxed{\\vec{I}=\\Delta\\vec{p}}")).toBe("I⃗ = Δp⃗");
    expect(latexToMathText("\\vec{F}_{net}=0 \\implies \\vec{p}=\\text{const}")).toBe("F⃗ₙₑₜ = 0 ⇒ p⃗ = const");
  });

  it("converts supported LaTeX to native Office Math instead of leaking command names", () => {
    const out = latexToOmml("\\boxed{\\vec{I}=\\Delta\\vec{p}}");
    expect(out.ok).toBe(true);
    expect(out.omml).toContain("<m:oMathPara>");
    expect(out.omml).toContain("<m:borderBox>");
    expect(out.omml).toContain("<m:acc>");
    expect(out.omml).not.toContain("boxed");
    expect(out.omml).not.toContain("vec");

    const unsupported = latexToOmml("\\begin{cases}x&x>0\\end{cases}");
    expect(unsupported.ok).toBe(false);
    expect(unsupported.unsupported).toContain("\\begin");
  });

  it("emits native Office Math with repaired contrast color into the final pptx package", async () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [{
        id: "omml-pptx",
        background: "0F172A",
        children: [{
          id: "omml-pptx.eq",
          type: "equation",
          latex: "\\boxed{\\vec{I}=\\Delta\\vec{p}}",
        }],
      }],
    };
    const dir = mkdtempSync(join(tmpdir(), "slideml2-omml-"));
    const out = join(dir, "omml.pptx");
    await renderToPptx(sourceToRenderedDeck(deck), out);
    const zip = await JSZip.loadAsync(await readFile(out));
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slideXml).toContain("<a14:m");
    expect(slideXml).toContain("<m:oMathPara>");
    expect(slideXml).toContain("<m:borderBox>");
    expect(slideXml).toContain('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"');
    expect(slideXml).toContain('<w:color w:val="FFFFFF"/>');
    expect(slideXml).not.toContain("boxed");
    expect(slideXml).not.toContain("vec");
  });

  it("renders math, citations, tokens, and footnotes inside text, callouts, and table cells", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        references: [{
          id: "smith2024",
          authors: ["A. Smith"],
          year: 2024,
          title: "Reputation pressure and reporting",
          venue: "Journal of Classroom Methods",
        }],
        footnotes: [{ id: "fn-private", text: "Scores were anonymized before aggregation." }],
      },
      slides: [{
        id: "m3-rich",
        title: "Rich inline science",
        children: [{
          id: "m3-rich.stack",
          type: "stack",
          area: "content",
          children: [
            {
              id: "m3-rich.text",
              type: "text",
              style: "paragraph",
              content: [
                { text: "Effect size " },
                { kind: "math", latex: "\\frac{x_1}{\\sigma^2}" },
                { text: " follows prior work " },
                { kind: "cite", refId: "smith2024" },
                { text: " with lift " },
                { kind: "token", value: 0.42, format: "percent", tone: "positive" },
                { text: "." },
              ],
            },
            {
              id: "m3-rich.callout",
              type: "callout",
              title: "Finding",
              content: [
                { text: "Threshold " },
                { kind: "math", latex: "p \\leq 0.05" },
                { text: " is reported in " },
                { kind: "cite", refId: "smith2024" },
                { text: "." },
              ],
              variant: "card",
            },
            {
              id: "m3-rich.table",
              type: "table",
              rows: [
                [{ text: "Metric" }, { text: "Value" }],
                [{ text: "Reported gap", footnoteRefs: ["fn-private"] }, { runs: [{ kind: "math", latex: "\\Delta = 7.17" }] }],
              ],
              colWidths: [0.42, 0.58],
            },
            { id: "m3-rich.refs", type: "bibliography", title: "References" },
          ],
        }],
      }],
    };

    const validation = validateDeck(deck);
    expect(validation.errors, validation.errors.map((item) => item.message).join("\n")).toHaveLength(0);

    const ast = renderToAst(sourceToRenderedDeck(deck));
    const text = allRunTexts(ast).join("");
    expect(text).toContain("x");
    expect(text).toContain("\u03C3\u00B2");
    expect(text).toContain("[1]");
    expect(text).toContain("42%");
    expect(text).toContain("\u0394 = 7.17");
    expect(text).toContain("Reputation pressure and reporting");
  });

  it("expands equation and code-block into renderable scientific components", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [{
        id: "m3-components",
        title: "Formula and code",
        children: [{
          id: "m3-components.stack",
          type: "stack",
          area: "content",
          children: [
            {
              id: "m3-components.eq",
              type: "equation",
              latex: "\\sum_{i=1}^{n} x_i = \\mu",
              number: "1",
              caption: "Sample mean definition.",
            },
            {
              id: "m3-components.code",
              type: "code-block",
              language: "ts",
              code: "const mean = values.reduce((a, b) => a + b, 0) / values.length;\n+return mean;\n-console.log(mean);",
              showLineNumbers: true,
              highlightLines: [1],
            },
          ],
        }],
      }],
    };
    const validation = validateDeck(deck);
    expect(validation.errors, validation.errors.map((item) => item.message).join("\n")).toHaveLength(0);

    const ast = renderToAst(sourceToRenderedDeck(deck));
    const text = allRunTexts(ast).join("");
    expect(text).toContain("\u2211");
    expect(text).toContain("\u03BC");
    expect(text).toContain("(1)");
    expect(text).toContain("const");
    expect(text).toContain("return mean");
    const table = firstTable(ast);
    expect(table?.cells[0]?.[0]?.runs[0]?.text).toBe("1");
    expect(table?.cells[1]?.[1]?.fill?.color).toBeDefined();
    expect(table?.cells[2]?.[1]?.fill?.color).toBeDefined();
  });

  it("equation uses the same rich math path and honors explicit font size and color", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [{
        id: "eq-size",
        title: "Formula size",
        children: [{
          id: "eq-size.eq",
          type: "equation",
          latex: "\\tan\\alpha = \\frac{\\sin\\alpha}{\\cos\\alpha}",
          fontSize: 12,
          color: "006400",
        }],
      }],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const mathShape = ast.slides[0]!.shapes.find((shape) => shape.type === "text" && shape.name === "eq-size.eq.math");
    expect(mathShape?.type).toBe("text");
    const run = mathShape?.type === "text" ? mathShape.paragraphs[0]?.runs[0] : undefined;
    expect(run?.text).toBe("tan α = sin α/cos α");
    expect(run?.mathOmml).toContain("<m:f>");
    expect(run?.sizeHalfPt).toBe(24);
    expect(run?.color).toBe("006400");
  });

  it("code-block can render long code in columns without forced truncation", () => {
    const code = Array.from({ length: 30 }, (_, index) => `int value${index + 1} = ${index + 1};`).join("\n");
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [{
        id: "code-long",
        title: "Long listing",
        children: [{
          id: "code-long.block",
          type: "code-block",
          language: "cpp",
          code,
          density: "dense",
          fontSize: 6.5,
          columns: 2,
          showLineNumbers: true,
        }],
      }],
    };
    const validation = validateDeck(deck);
    expect(validation.errors, validation.errors.map((item) => item.message).join("\n")).toHaveLength(0);

    clearRenderDiagnostics();
    const ast = renderToAst(sourceToRenderedDeck(deck));
    const tables = allTables(ast);
    expect(tables).toHaveLength(2);
    expect(tables.reduce((sum, table) => sum + table.cells.length, 0)).toBe(30);
    const text = allRunTexts(ast).join("\n");
    expect(text).toContain("value30");
    expect(text).not.toContain("...");
    expect(tables[0]?.cells[0]?.[1]?.runs[0]?.sizeHalfPt).toBe(13);
    expect(getRenderDiagnostics().filter((item) => item.code === "CODE_BLOCK_OVERFLOW")).toHaveLength(0);
  });

  it("reports a blocking code overflow diagnostic when a full listing cannot fit", () => {
    const code = Array.from({ length: 80 }, (_, index) => `int value${index + 1} = ${index + 1};`).join("\n");
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [{
        id: "code-overflow",
        title: "Too much code",
        children: [{
          id: "code-overflow.block",
          type: "code-block",
          language: "cpp",
          code,
          showLineNumbers: true,
        }],
      }],
    };

    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck));
    const diagnostic = getRenderDiagnostics().find((item) => item.code === "CODE_BLOCK_OVERFLOW");
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.nodeId).toBe("code-overflow.block");
    expect(diagnostic?.suggestion).toContain("Paginate");
    expect(diagnostic?.measured?.lineCount).toBe(80);
  });

  it("reports code overflow for dense 7pt listings that PowerPoint table rows expand beyond the slide", () => {
    const code = [
      "// 判断在 (row, col) 位置放皇后是否与已放皇后冲突",
      "bool isValid(int row, int col) {",
      "    for (int prevRow = 0; prevRow < row; ++prevRow) {",
      "        int prevCol = board[prevRow];",
      "        if (prevCol == col) return false;                     // 同列",
      "        if (prevRow - prevCol == row - col) return false;   // 主对角线",
      "        if (prevRow + prevCol == row + col) return false;   // 副对角线",
      "    }",
      "    return true;",
      "}",
      "",
      "// DFS 回溯核心：尝试在第 row 行放皇后",
      "void backtrack(int row) {",
      "    if (row == N) {                        // 所有行都放好了，找到解",
      "        solutions.push_back(board);",
      "        return;",
      "    }",
      "    for (int col = 0; col < N; ++col) {  // 枚举第 row 行的所有列",
      "        if (isValid(row, col)) {           // 剪枝：只尝试合法位置",
      "            board[row] = col;              // 做选择",
      "            backtrack(row + 1);             // 递归进入下一行",
      "            board[row] = -1;                // 撤销选择（回溯）",
      "        }",
      "    }",
      "}",
    ].join("\n");
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: { size: "16x9", theme: "default" },
      slides: [{
        id: "code-visual-overflow",
        title: "C++ code",
        children: [{
          id: "code-visual-overflow.block",
          type: "code-block",
          language: "cpp",
          code,
          density: "dense",
          fontSize: 7,
          showLineNumbers: true,
        }],
      }],
    };

    clearRenderDiagnostics();
    renderToAst(sourceToRenderedDeck(deck));
    const diagnostic = getRenderDiagnostics().find((item) => item.code === "CODE_BLOCK_OVERFLOW");
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.nodeId).toBe("code-visual-overflow.block");
    expect(diagnostic?.measured?.lineCount).toBe(25);
    expect(diagnostic?.measured?.estimatedCapacityLines).toBeLessThan(25);
  });

  it("validates missing references and malformed footnote references", () => {
    const deck: Slideml2SourceDeck = {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        references: [{ id: "dup" }, { id: "dup" }],
        footnotes: [{ id: "known", text: "Known note." }],
      },
      slides: [{
        id: "m3-invalid",
        children: [{
          id: "m3-invalid.text",
          type: "text",
          content: [
            { kind: "cite", refId: "missing" },
            { text: " " },
            { kind: "footnoteRef", footnoteId: "missing-note" },
          ],
        }],
      }],
    };
    const validation = validateDeck(deck);
    expect(validation.errors.map((item) => item.code)).toEqual(expect.arrayContaining([
      "DUPLICATE_REFERENCE_ID",
      "UNKNOWN_REFERENCE_ID",
      "UNKNOWN_FOOTNOTE_ID",
    ]));
  });
});
