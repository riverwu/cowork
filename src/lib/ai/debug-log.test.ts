import { describe, it, expect } from "vitest";
import { __test } from "./debug-log";

const { extractArtifactPaths } = __test;

describe("extractArtifactPaths", () => {
  it("finds an absolute pptx path in a sentence", () => {
    const result = "SlideML compiled to /Users/river/work/deck.pptx. Editable source written to /Users/river/work/deck.json.";
    expect(extractArtifactPaths(result).sort()).toEqual([
      "/Users/river/work/deck.json",
      "/Users/river/work/deck.pptx",
    ]);
  });

  it("does not match relative paths or extension-less paths", () => {
    expect(extractArtifactPaths("saved to ./deck.pptx")).toEqual([]);
    expect(extractArtifactPaths("created /Users/river/Documents")).toEqual([]);
  });

  it("dedupes identical paths within a single result", () => {
    const result = "outputPath: /a/b/x.pptx\ndomPath: /a/b/x.render-tree.json\noutputPath: /a/b/x.pptx";
    expect(extractArtifactPaths(result).sort()).toEqual(["/a/b/x.pptx", "/a/b/x.render-tree.json"]);
  });

  it("handles paths inside JSON quotes", () => {
    const result = `{"outputPath":"/abs/d.pptx","domPath":"/abs/d.json"}`;
    expect(extractArtifactPaths(result).sort()).toEqual(["/abs/d.json", "/abs/d.pptx"]);
  });

  it("matches png and json from image_gen-style messages", () => {
    const result = "Image saved to /tmp/foo-1.png (image_gen). Cache: /tmp/foo-1.json";
    expect(extractArtifactPaths(result).sort()).toEqual(["/tmp/foo-1.json", "/tmp/foo-1.png"]);
  });

  it("ignores tilde-prefixed paths (renderer can't resolve $HOME)", () => {
    expect(extractArtifactPaths("saved to ~/cowork/foo.pptx")).toEqual([]);
  });

  it("strips trailing punctuation that isn't part of the path", () => {
    expect(extractArtifactPaths("file at /tmp/a.pptx, then /tmp/b.png.")).toEqual([
      "/tmp/a.pptx",
      "/tmp/b.png",
    ]);
  });
});
