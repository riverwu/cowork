import { describe, expect, it } from "vitest";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import { buildTheme } from "./theme.js";
import type { Slideml2SourceDeck, SlideV2 } from "./types.js";

const EMU_PER_CM = 360000;

type AnyShape = {
  type: string;
  name?: string;
  xfrm?: { x: number; y: number; cx: number; cy: number };
  cornerRadius?: number;
  fill?: { type: string; color?: string; alpha?: number };
  line?: { color: string; width: number; alpha?: number };
};

function renderShapesForChild(
  themeOverride: Slideml2SourceDeck["deck"]["themeOverride"],
  child: SlideV2["children"][number],
): AnyShape[] {
  const deck: Slideml2SourceDeck = {
    slideml2: 2,
    deck: {
      size: "16x9",
      theme: "default",
      brand: { primary: "2563EB" },
      themeOverride,
    },
    slides: [{
      id: "s",
      title: "Theme units",
      children: [child],
    } as SlideV2],
  };
  return renderToAst(sourceToRenderedDeck(deck)).slides[0]!.shapes as AnyShape[];
}

function renderShapes(themeOverride: Slideml2SourceDeck["deck"]["themeOverride"]): AnyShape[] {
  return renderShapesForChild(themeOverride, {
    id: "s.card",
    type: "card",
    children: [{ id: "s.card.text", type: "text", text: "Body", style: "paragraph" }],
  });
}

describe("theme component unit normalization", () => {
  it("treats CSS-like component padding numbers as px, not centimeters", () => {
    const shapes = renderShapes({
      component: {
        card: { padding: 16, cornerRadius: 8 },
      },
    });
    const card = shapes.find((s) => s.name === "s.card-card");
    const text = shapes.find((s) => s.name === "s.card.text");
    expect(card?.xfrm).toBeDefined();
    expect(text?.xfrm).toBeDefined();
    const leftPaddingCm = (text!.xfrm!.x - card!.xfrm!.x) / EMU_PER_CM;
    expect(leftPaddingCm).toBeGreaterThan(0.35);
    expect(leftPaddingCm).toBeLessThan(0.5);
    expect(card!.cornerRadius).toBeCloseTo(0.08, 2);
  });
});

describe("theme semantic accent aliases", () => {
  it("maps authored accent colors to semantic component tokens", () => {
    const theme = buildTheme({ primary: "2563EB" }, "default", {
      colors: {
        "accent.green": "00A86B",
        "accent.orange": "FF8C00",
        "accent.red": "E11D48",
        "accent.blue": "0284C7",
      },
    });

    expect(theme.colors["success.accent"]).toBe("00A86B");
    expect(theme.colors["warning.accent"]).toBe("FF8C00");
    expect(theme.colors["danger.accent"]).toBe("E11D48");
    expect(theme.colors["info.accent"]).toBe("0284C7");
    expect(theme.colors.success).not.toBe("0E7C3A");
    expect(theme.colors.warning).not.toBe("B45309");
    expect(theme.colors.danger).not.toBe("B42318");
    expect(theme.colors.info).not.toBe("2563EB");
    expect(theme.colors["success.tint"]).not.toBe("E6F6EC");
    expect(theme.colors["warning.tint"]).not.toBe("FFF6E6");
  });

  it("keeps explicit semantic color overrides stronger than accent aliases", () => {
    const theme = buildTheme({ primary: "2563EB" }, "default", {
      colors: {
        "accent.green": "00A86B",
        success: "14532D",
        "success.tint": "DCFCE7",
      },
    });

    expect(theme.colors.success).toBe("14532D");
    expect(theme.colors["success.tint"]).toBe("DCFCE7");
  });

  it("renders component tones with the authored accent palette", () => {
    const shapes = renderShapesForChild({
      colors: {
        "accent.green": "00A86B",
        "accent.orange": "FF8C00",
      },
    }, {
      id: "s.takeaways",
      type: "takeaway-list",
      marker: { shape: "side-bar", variant: "solid", size: "md" },
      items: [
        { headline: "Positive", detail: "Uses accent.green.", tone: "positive" },
        { headline: "Warning", detail: "Uses accent.orange.", tone: "warning" },
      ],
    } as SlideV2["children"][number]);

    const positive = shapes.find((s) => s.name === "s.takeaways.0.marker");
    const warning = shapes.find((s) => s.name === "s.takeaways.1.marker");
    expect(positive?.fill?.color).toBe("00A86B");
    expect(warning?.fill?.color).toBe("FF8C00");
  });
});
