import { describe, expect, it } from "vitest";
import { renderToAst } from "./render.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import { buildTheme } from "./theme.js";
import type { Slideml2SourceDeck, SlideV2 } from "./types.js";

/**
 * vdhl38 log: agent created a dark-themed deck (background:#0D1B2A,
 * surface:#1A1A2E, text.primary:#FFFFFF). Tables on slides 4/9/16
 * rendered with white text on a light gray header strip — invisible.
 *
 * Root cause: theme defaulted `surface.subtle` to F1F4FA (light gray),
 * regardless of the dark `surface` override. Table-header cells
 * hardcoded their fill to `surface.subtle`, so a dark deck got a light
 * header strip with white text on it.
 *
 * Fix: theme builder now derives `surface.subtle` and `divider` from
 * `surface` when the agent overrode `surface` to dark but didn't
 * override the dependents.
 */

function luminance(hex: string): number {
  const normalized = hex.replace(/^#/, "");
  const vals = [0, 2, 4].map((i) => {
    const channel = parseInt(normalized.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * vals[0]! + 0.7152 * vals[1]! + 0.0722 * vals[2]!;
}

describe("dark-theme surface dependents auto-derive", () => {
  it("dark surface override → surface.subtle becomes a dark variant (not light gray)", () => {
    const theme = buildTheme(
      { primary: "E94560" },
      "default",
      { colors: { surface: "1A1A2E", "text.primary": "FFFFFF", background: "0D1B2A" } },
    );
    const subtle = theme.colors["surface.subtle"];
    expect(subtle).toBeDefined();
    // Should NOT still be the default light gray F1F4FA.
    expect(subtle.toUpperCase()).not.toBe("F1F4FA");
    // Should sit close to the surface color (dark), not near white.
    const r = parseInt(subtle.slice(0, 2), 16);
    const g = parseInt(subtle.slice(2, 4), 16);
    const b = parseInt(subtle.slice(4, 6), 16);
    expect(Math.max(r, g, b)).toBeLessThan(80); // mostly dark
  });

  it("dark surface override → divider becomes a darker variant (not the default DDE3EC)", () => {
    const theme = buildTheme(
      { primary: "E94560" },
      "default",
      { colors: { surface: "1A1A2E" } },
    );
    expect(theme.colors["divider"].toUpperCase()).not.toBe("DDE3EC");
  });

  it("user-explicit surface.subtle override is preserved (not auto-derived over)", () => {
    const theme = buildTheme(
      { primary: "E94560" },
      "default",
      { colors: { surface: "1A1A2E", "surface.subtle": "B0B0C0" } },
    );
    expect(theme.colors["surface.subtle"].toUpperCase()).toBe("B0B0C0");
  });

  it("light surface (default) keeps the default subtle/divider — no derivation churn", () => {
    const theme = buildTheme({ primary: "2563EB" }, "default", undefined);
    expect(theme.colors["surface.subtle"].toUpperCase()).toBe("F1F4FA");
    expect(theme.colors["divider"].toUpperCase()).toBe("DDE3EC");
  });

  it("text.secondary override also feeds text.muted when muted is omitted", () => {
    const theme = buildTheme(
      { primary: "E94560" },
      "default",
      { colors: { background: "0D1B2A", surface: "1A1A2E", "text.primary": "FFFFFF", "text.secondary": "E0E0E0" } },
    );
    expect(theme.colors["text.muted"].toUpperCase()).toBe("E0E0E0");
  });

  it("dark surface override derives semantic tints as dark fills, not light pastel cards", () => {
    const theme = buildTheme(
      { primary: "E94560" },
      "default",
      { colors: { background: "0D1B2A", surface: "1A1A2E", "text.primary": "FFFFFF" } },
    );
    for (const key of ["brand.tint", "success.tint", "warning.tint", "danger.tint"]) {
      expect(luminance(theme.colors[key]!), key).toBeLessThan(0.35);
    }
  });

  it("agent-friendly theme aliases fontWeight, cornerRadius, and elevation are honored", () => {
    const theme = buildTheme(
      { primary: "E94560" },
      "default",
      {
        text: { paragraph: { fontWeight: 700 } },
        component: { card: { cornerRadius: 0.32, elevation: "raised" } },
      },
    );
    expect(theme.text.paragraph.weight).toBe(700);
    expect(theme.component.card.cornerRadius).toBe(0.32);
    expect(theme.component.card.elevation).toBe("raised");
  });
});

describe("vdhl38 end-to-end: table header cells in dark-theme deck render readably", () => {
  function deck(slides: SlideV2[]): Slideml2SourceDeck {
    return {
      slideml2: 2,
      deck: {
        size: "16x9",
        theme: "default",
        brand: { primary: "E94560" },
        themeOverride: {
          colors: {
            background: "0D1B2A",
            surface: "1A1A2E",
            "text.primary": "FFFFFF",
          },
        },
      } as never,
      slides,
    };
  }

  it("table-card on a dark deck no longer produces a light header strip", () => {
    const slide: SlideV2 = {
      id: "s",
      title: "Cancers",
      children: [{
        id: "s.tbl",
        type: "table-card",
        title: "Top cancer types",
        headers: ["Rank", "Type", "Notes"],
        rows: [["1", "Lung", "Highest mortality"]],
      } as never],
    };
    const ast = renderToAst(sourceToRenderedDeck(deck([slide])));
    // Find the table shape and check the first row's first cell fill.
    const tableShape = ast.slides[0].shapes.find((s) => s.type === "table") as
      | { type: "table"; cells: Array<Array<{ fill?: { color?: string } }>> } | undefined;
    expect(tableShape).toBeDefined();
    const headerCellFill = tableShape!.cells[0]?.[0]?.fill?.color?.toUpperCase();
    expect(headerCellFill).toBeDefined();
    // Header cell fill must NOT be the light-default F1F4FA on a dark
    // theme. The auto-derived dark variant has luminance < 0.3.
    expect(headerCellFill).not.toBe("F1F4FA");
    const r = parseInt(headerCellFill!.slice(0, 2), 16);
    const g = parseInt(headerCellFill!.slice(2, 4), 16);
    const b = parseInt(headerCellFill!.slice(4, 6), 16);
    expect(Math.max(r, g, b)).toBeLessThan(80);
  });
});
