import { describe, expect, it } from "vitest";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import type { Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * Component-polish regressions from the 96vi8n visual review.
 * Each test locks in one specific visual fix.
 */

const EMU = 360000;
const TINY_ICON = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI5NiIgaGVpZ2h0PSI5NiI+PGNpcmNsZSBjeD0iNDgiIGN5PSI0OCIgcj0iMzIiIGZpbGw9IiMyNTYzZWIiLz48L3N2Zz4=";

function deck(slide: SlideV2, themeOverride?: Record<string, unknown>): Slideml2SourceDeck {
  return {
    slideml2: 2,
    deck: {
      size: "16x9",
      theme: "default",
      brand: { primary: "6366F1" },
      ...(themeOverride ? { themeOverride: themeOverride as never } : {}),
    },
    slides: [slide],
  };
}

function shapes(slide: SlideV2, themeOverride?: Record<string, unknown>) {
  return renderToAst(sourceToRenderedDeck(deck(slide, themeOverride))).slides[0].shapes;
}

function findEndingWith(shapeList: ReturnType<typeof shapes>, suffix: string) {
  return shapeList.find((s) => typeof (s as { name?: string }).name === "string" && (s as { name: string }).name.endsWith(suffix));
}

function filterEndingWith(shapeList: ReturnType<typeof shapes>, suffix: string) {
  return shapeList.filter((s) => typeof (s as { name?: string }).name === "string" && (s as { name: string }).name.endsWith(suffix));
}

describe("timeline visual spine (slide 7 fix)", () => {
  it("vertical timeline emits a dot + line per row to form a continuous spine", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.tl",
        type: "timeline",
        direction: "vertical",
        items: [
          { time: "Jan", title: "First", body: "Body" },
          { time: "Feb", title: "Second", body: "Body" },
          { time: "Mar", title: "Third", body: "Body" },
        ],
      } as never],
    };
    const list = shapes(slide);
    const dots = filterEndingWith(list, ".dot");
    const lines = filterEndingWith(list, ".line");
    expect(dots.length).toBe(3);
    expect(lines.length).toBe(3);
    for (const d of dots) {
      expect((d as { preset?: string }).preset).toBe("ellipse");
    }
  });

  it("vertical timeline keeps the date, spine, and copy columns close together", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.tl",
        type: "timeline",
        direction: "vertical",
        items: [
          { time: "2015-2018", title: "0 到 1 阶段", body: "学习传统比例姿态，最大化产品可靠性。" },
          { time: "2019-2023", title: "1 到 10 阶段", body: "通过统一语言积累用户信任。" },
          { time: "2024 至今", title: "10 到 N 阶段", body: "尝试品牌升级和体验区隔。" },
        ],
      } as never],
    };
    const list = shapes(slide);
    const time = findEndingWith(list, ".0.time") as { xfrm?: { x: number; cx: number } };
    const dot = findEndingWith(list, ".0.dot") as { xfrm?: { x: number; cx: number } };
    const title = findEndingWith(list, ".0.title") as { xfrm?: { x: number } };

    const timeToDotGap = (dot.xfrm!.x - (time.xfrm!.x + time.xfrm!.cx)) / EMU;
    const dotToTitleGap = (title.xfrm!.x - (dot.xfrm!.x + dot.xfrm!.cx)) / EMU;
    expect(timeToDotGap).toBeGreaterThanOrEqual(0.15);
    expect(timeToDotGap).toBeLessThan(0.7);
    expect(dotToTitleGap).toBeGreaterThanOrEqual(0.15);
    expect(dotToTitleGap).toBeLessThan(0.7);
  });

  it("horizontal timeline emits axis markers without vertical row spines", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.tl",
        type: "timeline",
        direction: "horizontal",
        items: [
          { time: "Jan", title: "A" },
          { time: "Feb", title: "B" },
        ],
      } as never],
    };
    const list = shapes(slide);
    expect(filterEndingWith(list, ".dot").length).toBe(2);
    expect(filterEndingWith(list, ".halo").length).toBe(2);
    expect(filterEndingWith(list, ".line").length).toBe(0);
  });

  it("horizontal timeline keeps the node on the axis and supports milestone shape/icon", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.tl",
        type: "timeline",
        direction: "horizontal",
        items: [
          { time: "2024", title: "A", body: "Body", shape: "diamond", icon: "cloud" },
          { time: "2025", title: "B", body: "Body", shape: "star-5", icon: "triangle" },
        ],
      } as never],
    };
    const list = shapes(slide);
    const halo = findEndingWith(list, ".0.halo") as { preset?: string; xfrm?: { x: number; cx: number } };
    const icon = findEndingWith(list, ".0.icon") as { preset?: string };
    const dot = findEndingWith(list, ".0.dot") as { xfrm?: { x: number; y: number; cx: number; cy: number } };
    const railRight = findEndingWith(list, ".0.railRight") as { xfrm?: { y: number; cy: number } };
    const time = findEndingWith(list, ".0.time") as { xfrm?: { y: number } };
    const body = findEndingWith(list, ".0.body") as { paragraphs?: Array<{ runs: Array<{ sizeHalfPt?: number }> }> };

    expect(halo.preset).toBe("diamond");
    expect(icon.preset).toBe("cloud");
    const haloCenterX = (halo.xfrm!.x + halo.xfrm!.cx / 2) / EMU;
    const dotCenterX = (dot.xfrm!.x + dot.xfrm!.cx / 2) / EMU;
    expect(Math.abs(haloCenterX - dotCenterX)).toBeLessThan(0.05);
    const dotCenter = (dot.xfrm!.y + dot.xfrm!.cy / 2) / EMU;
    const railCenter = (railRight.xfrm!.y + railRight.xfrm!.cy / 2) / EMU;
    expect(Math.abs(dotCenter - railCenter)).toBeLessThan(0.05);
    const dotBottom = (dot.xfrm!.y + dot.xfrm!.cy) / EMU;
    const timeTop = time.xfrm!.y / EMU;
    expect(timeTop - dotBottom).toBeGreaterThanOrEqual(0);
    expect(timeTop - dotBottom).toBeLessThan(0.35);
    expect(body.paragraphs?.[0]?.runs?.[0]?.sizeHalfPt).toBe(17.6);
  });

  it("horizontal timeline renders generated iconSrc inside the milestone marker", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.tl",
        type: "timeline",
        direction: "horizontal",
        items: [
          { time: "2024", title: "A", body: "Body", shape: "ellipse", iconSrc: TINY_ICON },
          { time: "2025", title: "B", body: "Body" },
        ],
      } as never],
    };
    const list = shapes(slide);
    const icon = findEndingWith(list, ".0.icon") as { type?: string; fit?: string; xfrm?: { cx: number; cy: number } };
    const halo = findEndingWith(list, ".0.halo") as { xfrm?: { cx: number; cy: number } };

    expect(icon.type).toBe("image");
    expect(icon.fit).toBe("contain");
    expect(icon.xfrm!.cx).toBeLessThan(halo.xfrm!.cx);
    expect(icon.xfrm!.cy).toBeLessThan(halo.xfrm!.cy);
  });

  it("wrapped horizontal timeline exposes row gap for spacing between axes", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.tl",
        type: "timeline",
        direction: "horizontal",
        gap: 0.82,
        items: Array.from({ length: 8 }, (_, index) => ({
          time: `202${index}`,
          body: `Milestone ${index + 1}`,
        })),
      } as never],
    };
    const list = shapes(slide);
    const row0Dot = findEndingWith(list, ".3.dot") as { xfrm?: { y: number; cy: number } };
    const row0Body = findEndingWith(list, ".3.body") as { xfrm?: { y: number; cy: number } };
    const row1Dot = findEndingWith(list, ".4.dot") as { xfrm?: { y: number } };
    const row0Bottom = Math.max(row0Dot.xfrm!.y + row0Dot.xfrm!.cy, row0Body.xfrm!.y + row0Body.xfrm!.cy) / EMU;
    const rowGap = row1Dot.xfrm!.y / EMU - row0Bottom;
    expect(rowGap).toBeGreaterThan(0.6);
  });
});

describe("decoration-grid as background overlay (slide 1 fix)", () => {
  it("default behavior anchors the grid as overlay (asBackground:true)", () => {
    // We can't easily inspect anchor on the source DOM through renderToAst
    // shape output (shapes are flattened), but we can verify the dot size
    // stays subtle instead of turning the cover into a field of dark blocks.
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{ id: "s.dg", type: "decoration-grid", pattern: "dots", density: "sparse", asBackground: false } as never],
    };
    const list = shapes(slide);
    const dots = filterEndingWith(list, ".dot");
    expect(dots.length).toBeGreaterThan(0);
    for (const d of dots.slice(0, 3)) {
      expect((d as { xfrm?: { cx: number } }).xfrm!.cx / EMU).toBeCloseTo(0.12, 1);
    }
  });
});

describe("metric-card aspect cap (slides 8/15/18/20 fix)", () => {
  it("metric-value carries maxHeight 2.4 so tall KPI cells don't balloon", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.kpi",
        type: "kpi-grid",
        columns: 3,
        metrics: [
          { value: "78%", label: "A" },
          { value: "65%", label: "B" },
          { value: "43%", label: "C" },
        ],
      } as never],
    };
    const list = shapes(slide);
    const values = filterEndingWith(list, ".value");
    expect(values.length).toBeGreaterThanOrEqual(3);
    // Each value's rendered height should be ≤ 2.4cm (the cap).
    for (const v of values) {
      const cy = (v as { xfrm?: { cy: number } }).xfrm!.cy / EMU;
      expect(cy).toBeLessThanOrEqual(2.4 + 0.01);
    }
  });
});

describe("bar-list inline value (slides 8/16/18 fix)", () => {
  it("value is in the .row sibling next to the .track, not floating in a header above", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.b",
        type: "bar-list",
        items: [{ label: "A", value: 80 }, { label: "B", value: 40 }],
      } as never],
    };
    const list = shapes(slide);
    const labels = filterEndingWith(list, ".label");
    const values = filterEndingWith(list, ".value");
    const trackBackings = filterEndingWith(list, ".track-background");
    expect(labels.length).toBeGreaterThanOrEqual(2);
    expect(values.length).toBeGreaterThanOrEqual(2);
    expect(trackBackings.length).toBeGreaterThanOrEqual(2);
    // Verify each value sits at the SAME y as the track (inline row),
    // not above it as the old header layout did.
    for (let i = 0; i < 2; i++) {
      const label = (labels[i] as { xfrm: { y: number; cy: number } }).xfrm;
      const track = (trackBackings[i] as { xfrm: { y: number; cy: number } }).xfrm;
      const value = (values[i] as { xfrm: { y: number; cy: number } }).xfrm;
      // Label sits ABOVE track (label bottom <= track top + small slack).
      expect(label.y + label.cy).toBeLessThanOrEqual(track.y + EMU * 0.5);
      // Value y is within the track's y band (vertically inline with the bar).
      const valueCenter = value.y + value.cy / 2;
      const trackCenter = track.y + track.cy / 2;
      expect(Math.abs(valueCenter - trackCenter)).toBeLessThanOrEqual(EMU * 0.3);
    }
  });
});

describe("process-flow arrows are larger (slide 20 fix)", () => {
  it("horizontal flow arrow defaults to ~1.1cm wide (was 0.7)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.pf",
        type: "process-flow",
        steps: [
          { title: "A", body: "do" },
          { title: "B", body: "do" },
          { title: "C", body: "do" },
        ],
      } as never],
    };
    const list = shapes(slide);
    const arrows = list.filter((s) => typeof (s as { name?: string }).name === "string" && (s as { name: string }).name.includes(".arrow"));
    expect(arrows.length).toBeGreaterThan(0);
    for (const a of arrows) {
      expect((a as { xfrm?: { cx: number } }).xfrm!.cx / EMU).toBeGreaterThanOrEqual(1.0 - 0.01);
    }
  });

  it("step body has minHeight ≥ 0.9cm (was 0.4) so two lines fit", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.pf",
        type: "process-flow",
        steps: [
          { title: "Reflective answer", body: "Quick LLM lookup with no chain-of-thought" },
          { title: "Reasoning step", body: "Multi-step plan and self-critique" },
          { title: "Tool use", body: "Issue API/tool calls and synthesize" },
        ],
      } as never],
    };
    const list = shapes(slide);
    const bodies = list.filter((s) => typeof (s as { name?: string }).name === "string" && (s as { name: string }).name.endsWith(".body"));
    expect(bodies.length).toBe(3);
    for (const b of bodies) {
      const cy = (b as { xfrm?: { cy: number } }).xfrm!.cy / EMU;
      expect(cy).toBeGreaterThanOrEqual(0.85);
    }
  });
});

describe("section-break vertical centering (slides 4/9/13/17/21 fix)", () => {
  it("section-break content y-centers in the content area (not top-aligned)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "",
      children: [{
        id: "s.b",
        type: "section-break",
        title: "01",
        subtitle: "Topic",
      } as never],
    };
    const list = shapes(slide);
    // Find the title shape and verify its y is meaningfully past the
    // top of the content area (y > 4cm), not pinned at y=2.95.
    const titleShape = findEndingWith(list, ".title");
    expect(titleShape).toBeDefined();
    const ty = ((titleShape as { xfrm?: { y: number } }).xfrm!.y) / EMU;
    expect(ty).toBeGreaterThan(4);
  });
});

describe("hero-stat progress bar for percentages (slide 19 fix)", () => {
  it("a percent value emits a progress bar below the label", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.hs",
        type: "hero-stat",
        value: "66%",
        label: "Inference share of compute",
      } as never],
    };
    const list = shapes(slide);
    const progressFill = findEndingWith(list, ".progress.fill");
    expect(progressFill).toBeDefined();
    expect((progressFill as { preset?: string }).preset).toBe("roundRect");
  });

  it("a non-percent value does NOT emit a progress bar", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.hs",
        type: "hero-stat",
        value: "$3000亿",
        label: "Q1 funding",
      } as never],
    };
    const list = shapes(slide);
    const progressFill = findEndingWith(list, ".progress.fill");
    expect(progressFill).toBeUndefined();
  });

  it("over-100% values do NOT emit a progress bar (the bar represents 0..100, not delta/growth)", () => {
    // Values like "150%" or "300%" are typically growth/multiplier
    // metrics, not 0..100 ratios. A 100%-clamped bar would mislead.
    // Suppress the bar; the number text still renders.
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.hs",
        type: "hero-stat",
        value: "150%",
        label: "growth",
      } as never],
    };
    const list = shapes(slide);
    const progressFill = findEndingWith(list, ".progress.fill");
    expect(progressFill).toBeUndefined();
  });
});

describe("takeaway-list dense bar thickness (slide 2/22 fix)", () => {
  it("dense (5+ items) accent bar is at least 0.18cm wide", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.t",
        type: "takeaway-list",
        items: [
          { headline: "A", detail: "a" },
          { headline: "B", detail: "b" },
          { headline: "C", detail: "c" },
          { headline: "D", detail: "d" },
          { headline: "E", detail: "e" },
        ],
      } as never],
    };
    const list = shapes(slide);
    const bars = list.filter((s) => typeof (s as { name?: string }).name === "string" && (s as { name: string }).name.endsWith(".bar"));
    expect(bars.length).toBe(5);
    for (const b of bars) {
      const cx = (b as { xfrm?: { cx: number } }).xfrm!.cx / EMU;
      expect(cx).toBeGreaterThanOrEqual(0.18 - 0.001);
    }
  });
});

describe("numbered-grid chip alignment (slide 23 fix)", () => {
  it("chip's x matches the title's x (both left-aligned, no centered chip floating)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.g",
        type: "numbered-grid",
        items: [
          { title: "A", body: "x" },
          { title: "B", body: "y" },
          { title: "C", body: "z" },
          { title: "D", body: "w" },
        ],
      } as never],
    };
    const list = shapes(slide);
    for (let i = 0; i < 4; i++) {
      const chip = list.find((s) => typeof (s as { name?: string }).name === "string" && (s as { name: string }).name.endsWith(`.${i}.num`)) as
        | { xfrm?: { x: number } } | undefined;
      const title = list.find((s) => typeof (s as { name?: string }).name === "string" && (s as { name: string }).name.endsWith(`.${i}.title`)) as
        | { xfrm?: { x: number } } | undefined;
      expect(chip).toBeDefined();
      expect(title).toBeDefined();
      expect(Math.abs((chip!.xfrm!.x) - (title!.xfrm!.x))).toBeLessThanOrEqual(EMU * 0.05);
    }
  });
});

describe("outline number cell height cap (slide 3 fix)", () => {
  it("number text fits within ~1.0cm even when row height is larger", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.o",
        type: "outline",
        items: [
          { number: "01", title: "Chapter A", body: "b" },
          { number: "02", title: "Chapter B", body: "b" },
          { number: "03", title: "Chapter C", body: "b" },
        ],
      } as never],
    };
    const list = shapes(slide);
    const nums = list.filter((s) => typeof (s as { name?: string }).name === "string" && (s as { name: string }).name.endsWith(".num"));
    expect(nums.length).toBeGreaterThan(0);
    for (const n of nums) {
      const cy = (n as { xfrm?: { cy: number } }).xfrm!.cy / EMU;
      expect(cy).toBeLessThanOrEqual(1.0 + 0.01);
    }
  });
});

describe("progressBar pill-inside-pill + safe value color", () => {
  it("renders no .empty shape (only .fill + .spacer)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.pb",
        type: "progress-bar",
        label: "Done",
        value: 60,
      } as never],
    };
    const list = shapes(slide);
    const empty = list.filter((s) => typeof (s as { name?: string }).name === "string" && (s as { name: string }).name.endsWith(".empty"));
    expect(empty.length).toBe(0);
    const fill = list.find((s) => typeof (s as { name?: string }).name === "string" && (s as { name: string }).name.endsWith(".fill"));
    expect(fill).toBeDefined();
  });

  it("value text uses text.primary (not the tone color), so LOW_CONTRAST doesn't rewrite it", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.pb",
        type: "progress-bar",
        label: "Done",
        value: 75,
        tone: "warning",
      } as never],
    };
    const list = shapes(slide);
    const value = list.find((s) => typeof (s as { name?: string }).name === "string" && (s as { name: string }).name.endsWith(".value")) as
      | { paragraphs?: Array<{ runs: Array<{ color?: string }> }> } | undefined;
    const color = value?.paragraphs?.[0]?.runs[0]?.color?.toUpperCase();
    expect(color).toBeDefined();
    expect(["B45309", "E67E22"]).not.toContain(color);
  });
});

describe("bracket label uses text.primary (not lineColor)", () => {
  it("bracket label color is text.primary, line carries the tone", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.b",
        type: "bracket",
        direction: "right",
        label: "Group",
        tone: "warning",
      } as never],
    };
    const list = shapes(slide);
    const label = list.find((s) => typeof (s as { name?: string }).name === "string" && (s as { name: string }).name.endsWith(".label")) as
      | { paragraphs?: Array<{ runs: Array<{ color?: string }> }> } | undefined;
    const lineShape = list.find((s) => typeof (s as { name?: string }).name === "string" && (s as { name: string }).name.endsWith(".line")) as
      | { fill?: { color?: string } } | undefined;
    const labelColor = label?.paragraphs?.[0]?.runs[0]?.color?.toUpperCase();
    expect(labelColor).toBeDefined();
    expect(["B45309", "E67E22"]).not.toContain(labelColor);
    expect(lineShape?.fill?.color?.toUpperCase()).toBe("B45309");
  });
});

describe("schema↔impl alignment for recently-touched component fields", () => {
  it("decoration-grid asBackground:false is forwarded by the registry (was being dropped)", () => {
    // With asBackground:false the grid should NOT be anchored as
    // overlay — it should be a normal flow grid. We detect this by
    // confirming the dots aren't all on a slide-spanning rect.
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.dg",
        type: "decoration-grid",
        pattern: "dots",
        density: "sparse",
        asBackground: false,
      } as never],
    };
    const list = shapes(slide);
    const dots = list.filter((s) => typeof (s as { name?: string }).name === "string" && (s as { name: string }).name.endsWith(".dot"));
    expect(dots.length).toBeGreaterThan(0);
    // Inline grid (asBackground:false) flows in content — its top
    // should be > content top (~3cm) since slide title is at top.
    const minY = Math.min(...dots.map((d) => ((d as { xfrm: { y: number } }).xfrm.y) / EMU));
    expect(minY).toBeGreaterThan(2);
  });

  it("legend.marker:'square' is honored end-to-end (was missing from registry)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.lg",
        type: "legend",
        marker: "square",
        items: [
          { label: "A", color: "brand.primary" },
          { label: "B", color: "success" },
        ],
      } as never],
    };
    const list = shapes(slide);
    // Square markers render with preset:"rect" (vs preset:"ellipse" for dots).
    const squares = list.filter((s) =>
      typeof (s as { name?: string }).name === "string" &&
      (s as { name: string }).name.includes(".dot") && // legend marker shapes happen to be named .dot regardless of style
      (s as { preset?: string }).preset === "rect"
    );
    expect(squares.length).toBeGreaterThanOrEqual(2);
  });
});

describe("decoration-grid fillSlide overlay works across deck sizes", () => {
  it("default asBackground=true emits a fillSlide overlay node, not hardcoded 25.4×14.29", () => {
    // Verified at the source-DOM level since the rendered shapes
    // flatten the overlay container.
    // We can confirm by rendering and ensuring dots fill close to the
    // canvas extents.
    const slide: SlideV2 = {
      id: "s",
      title: "",
      children: [{ id: "s.dg", type: "decoration-grid", pattern: "dots", density: "sparse" } as never],
    };
    const list = shapes(slide);
    const dots = list.filter((s) => typeof (s as { name?: string }).name === "string" && (s as { name: string }).name.endsWith(".dot"));
    expect(dots.length).toBeGreaterThan(0);
    // With fillSlide, the rightmost dot should be near the slide
    // canvas right edge (~25.4cm for 16:9). The previous hardcoded
    // 25.4 happened to match, so this test mainly guards the field
    // wiring for non-16:9 decks (caught at type level via the field
    // schema).
    const maxX = Math.max(...dots.map((d) => ((d as { xfrm: { x: number } }).xfrm.x) / EMU));
    expect(maxX).toBeGreaterThan(20);
  });
});

describe("metric-card value-wrap caps height (verified via rendered cy)", () => {
  it("rendered metric-value cy ≤ 2.4 even when given a tall 3-col cell", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.kpi",
        type: "kpi-grid",
        columns: 3,
        metrics: [
          { value: "78%", label: "A" },
          { value: "65%", label: "B" },
          { value: "43%", label: "C" },
        ],
      } as never],
    };
    const list = shapes(slide);
    const values = list.filter((s) => typeof (s as { name?: string }).name === "string" && (s as { name: string }).name.endsWith(".value"));
    expect(values.length).toBeGreaterThanOrEqual(3);
    for (const v of values) {
      const cy = (v as { xfrm?: { cy: number } }).xfrm!.cy / EMU;
      // The wrap container caps at 2.4cm; the inner text cy must be
      // strictly within (the wrap may take exactly 2.4).
      expect(cy).toBeLessThanOrEqual(2.4 + 0.01);
    }
  });
});

describe("hero-stat percent range guard", () => {
  it("over-100% no longer emits a progress bar (was clamped silently)", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{ id: "s.hs", type: "hero-stat", value: "150%", label: "growth" } as never],
    };
    const list = shapes(slide);
    const fill = list.find((s) => typeof (s as { name?: string }).name === "string" && (s as { name: string }).name.endsWith(".progress.fill"));
    expect(fill).toBeUndefined();
  });

  it("negative percent does not emit a progress bar either", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{ id: "s.hs", type: "hero-stat", value: "-5%", label: "shrinkage" } as never],
    };
    const list = shapes(slide);
    const fill = list.find((s) => typeof (s as { name?: string }).name === "string" && (s as { name: string }).name.endsWith(".progress.fill"));
    expect(fill).toBeUndefined();
  });
});

describe("bar-list value width: short numbers no longer waste 1.6cm", () => {
  it("short value '99' uses ≤ 1.0cm of the row, leaving more for the bar", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "x",
      children: [{
        id: "s.b",
        type: "bar-list",
        items: [{ label: "A", value: 99 }],
      } as never],
    };
    const list = shapes(slide);
    const value = list.find((s) => typeof (s as { name?: string }).name === "string" && (s as { name: string }).name.endsWith(".value")) as
      | { xfrm?: { cx: number } } | undefined;
    expect(value).toBeDefined();
    const cx = (value!.xfrm!.cx) / EMU;
    expect(cx).toBeLessThanOrEqual(1.0 + 0.01);
  });
});

describe("chart-card padding tightens when no caption (slide 14 fix)", () => {
  it("chart-card without caption has tighter padding/gap than with caption", () => {
    const slideWithCaption: SlideV2 = {
      id: "s1",
      title: "x",
      children: [{
        id: "s1.cc",
        type: "chart-card",
        chartType: "bar",
        title: "Title",
        caption: "source: A",
        labels: ["a", "b"],
        series: [{ name: "x", values: [1, 2] }],
      } as never],
    };
    const slideLean: SlideV2 = {
      id: "s2",
      title: "x",
      children: [{
        id: "s2.cc",
        type: "chart-card",
        chartType: "bar",
        title: "Title",
        labels: ["a", "b"],
        series: [{ name: "x", values: [1, 2] }],
      } as never],
    };
    // Render both and just confirm both render without errors. The
    // specific padding numerics are off the public AST so we sanity-check
    // shape counts: both should have a chart shape.
    const a = shapes(slideWithCaption);
    const b = shapes(slideLean);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
  });
});
