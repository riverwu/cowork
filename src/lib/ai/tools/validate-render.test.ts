import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateRenderTool } from "./validate-render";

vi.mock("@/lib/tauri", () => ({
  slideml2ValidateRender: vi.fn(),
}));

import { slideml2ValidateRender } from "@/lib/tauri";

const mockValidateRender = slideml2ValidateRender as unknown as ReturnType<typeof vi.fn>;

async function tempDeckPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "slideml2-validate-render-"));
  const deckPath = join(dir, "deck.json");
  await writeFile(deckPath, '{"version":"slideml2:2","slides":[]}', "utf8");
  return deckPath;
}

beforeEach(() => {
  mockValidateRender.mockReset();
});

describe("validate_render quality diagnostics", () => {
  it("keeps warn-level soft-fit quality diagnostics non-blocking", async () => {
    const deckPath = await tempDeckPath();
    mockValidateRender.mockResolvedValue({
      ok: true,
      outputPath: "/tmp/deck.pptx",
      domPath: "/tmp/deck.pptx.render-tree.json",
      diagnosticsPath: "/tmp/deck.pptx.diagnostics.json",
      validation: { ok: true, errors: [] },
      diagnostics: {
        count: 8,
        summary: { TRUNCATED: 8 },
        blockingCount: 0,
        blocking: [],
        qualityCount: 8,
        quality: [
          {
            code: "TRUNCATED",
            severity: "warning",
            slideId: "s8",
            nodeId: "s8.card.body",
            message: "Text was softly fit.",
            suggestion: "Shorten this card body or give the card more height.",
          },
        ],
      },
    });

    const result = JSON.parse(String(await validateRenderTool.execute({ deckPath, render: true })));

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.diagnosticsPath).toBe("/tmp/deck.pptx.diagnostics.json");
    expect(result.diagnostics.qualityCount).toBe(8);
    expect(result.diagnostics.quality[0]).toMatchObject({
      code: "TRUNCATED",
      slideId: "s8",
      nodeId: "s8.card.body",
      compiler: {
        code: "SLIDEML_TEXT_FIT",
        sourceCode: "TRUNCATED",
        location: { slideId: "s8", nodeId: "s8.card.body" },
      },
    });
    expect(result.diagnostics.qualityAction).toContain("Quality advisory");
  });

  it("adds a quality advisory when generated icon assets are never referenced", async () => {
    const deckPath = await tempDeckPath();
    const iconDir = join(deckPath, "..", "assets", "icons");
    await mkdir(iconDir, { recursive: true });
    await writeFile(join(iconDir, "manifest.json"), JSON.stringify({
      icons: [{ name: "robot", path: `${iconDir}/robot.png` }],
    }), "utf8");
    mockValidateRender.mockResolvedValue({
      ok: true,
      outputPath: "/tmp/deck.pptx",
      domPath: "/tmp/deck.pptx.render-tree.json",
      diagnosticsPath: "/tmp/deck.pptx.diagnostics.json",
      validation: { ok: true, errors: [] },
      diagnostics: {
        count: 0,
        summary: {},
        blockingCount: 0,
        blocking: [],
        qualityCount: 0,
        quality: [],
      },
    });

    const result = JSON.parse(String(await validateRenderTool.execute({ deckPath, render: true })));

    expect(result.ok).toBe(true);
    expect(result.diagnostics.summary.UNUSED_GENERATED_ICON_ASSETS).toBe(1);
    expect(result.diagnostics.quality[0]).toMatchObject({
      code: "UNUSED_GENERATED_ICON_ASSETS",
      severity: "warn",
    });
    expect(result.diagnostics.qualityAction).toContain("generated icon assets");
  });

  it("warns when only part of a generated icon manifest is referenced", async () => {
    const deckPath = await tempDeckPath();
    const iconDir = join(deckPath, "..", "assets", "icons");
    const usedPath = `${iconDir}/robot.png`;
    const unusedPath = `${iconDir}/bank.png`;
    await writeFile(deckPath, JSON.stringify({
      version: "slideml2:2",
      slides: [{
        id: "s1",
        children: [{ id: "s1.card", type: "feature-card", title: "Robot", iconSrc: usedPath }],
      }],
    }), "utf8");
    await mkdir(iconDir, { recursive: true });
    await writeFile(join(iconDir, "manifest.json"), JSON.stringify({
      icons: [
        { name: "robot", path: usedPath },
        { name: "bank", path: unusedPath },
      ],
    }), "utf8");
    mockValidateRender.mockResolvedValue({
      ok: true,
      outputPath: "/tmp/deck.pptx",
      domPath: "/tmp/deck.pptx.render-tree.json",
      diagnosticsPath: "/tmp/deck.pptx.diagnostics.json",
      validation: { ok: true, errors: [] },
      diagnostics: {
        count: 0,
        summary: {},
        blockingCount: 0,
        blocking: [],
        qualityCount: 0,
        quality: [],
      },
    });

    const result = JSON.parse(String(await validateRenderTool.execute({ deckPath, render: true })));

    expect(result.ok).toBe(true);
    expect(result.diagnostics.summary.PARTIAL_UNUSED_GENERATED_ICON_ASSETS).toBe(1);
    expect(result.diagnostics.quality[0]).toMatchObject({
      code: "PARTIAL_UNUSED_GENERATED_ICON_ASSETS",
      measured: { used: 1, needed: 2 },
    });
    expect(result.diagnostics.qualityAction).toContain("some generated icon assets");
  });

  it("does not duplicate generated-icon diagnostics already returned by the native renderer", async () => {
    const deckPath = await tempDeckPath();
    const iconDir = join(deckPath, "..", "assets", "icons");
    await mkdir(iconDir, { recursive: true });
    await writeFile(join(iconDir, "manifest.json"), JSON.stringify({
      icons: [{ name: "robot", path: `${iconDir}/robot.png` }],
    }), "utf8");
    mockValidateRender.mockResolvedValue({
      ok: true,
      outputPath: "/tmp/deck.pptx",
      domPath: "/tmp/deck.pptx.render-tree.json",
      diagnosticsPath: "/tmp/deck.pptx.diagnostics.json",
      validation: { ok: true, errors: [] },
      diagnostics: {
        count: 1,
        summary: { UNUSED_GENERATED_ICON_ASSETS: 1 },
        blockingCount: 0,
        blocking: [],
        qualityCount: 1,
        quality: [{
          code: "UNUSED_GENERATED_ICON_ASSETS",
          severity: "warn",
          message: "Native warning",
        }],
      },
    });

    const result = JSON.parse(String(await validateRenderTool.execute({ deckPath, render: true })));

    expect(result.diagnostics.summary.UNUSED_GENERATED_ICON_ASSETS).toBe(1);
    expect(result.diagnostics.quality).toHaveLength(1);
    expect(result.diagnostics.quality[0].message).toBe("Native warning");
  });

  it("surfaces sparse-slide authoring diagnostics as quality advisories", async () => {
    const deckPath = await tempDeckPath();
    mockValidateRender.mockResolvedValue({
      ok: true,
      outputPath: "/tmp/deck.pptx",
      domPath: "/tmp/deck.pptx.render-tree.json",
      diagnosticsPath: "/tmp/deck.pptx.diagnostics.json",
      validation: { ok: true, errors: [] },
      diagnostics: {
        count: 1,
        summary: { SPARSE_CONTENT_SLIDE: 1 },
        blockingCount: 0,
        blocking: [],
        qualityCount: 1,
        quality: [{
          code: "SPARSE_CONTENT_SLIDE",
          severity: "warn",
          slideId: "s4",
          nodeId: "s4.flow",
          message: "Sparse page",
        }],
      },
    });

    const result = JSON.parse(String(await validateRenderTool.execute({ deckPath, render: true })));

    expect(result.diagnostics.quality[0].code).toBe("SPARSE_CONTENT_SLIDE");
    expect(result.diagnostics.qualityAction).toContain("visually sparse");
  });
});
