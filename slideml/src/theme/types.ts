/**
 * Theme package types — the shape of a loaded theme as seen by the runtime.
 *
 * The wire-format definitions (theme.json, theme.md structure) are validated
 * by the loader (Stage 3). These types describe the in-memory result.
 */

/** Hex color, 6-char, no `#` prefix. Validated at theme-load time. */
export type HexColor = string;

/** Token values. Colors are HexColor; font-* are string arrays (fallback chains). */
export type TokenValue = HexColor | readonly string[];

/** Required tokens every theme MUST define. See SPEC.md → Tokens. */
export interface RequiredTokens {
  "bg-canvas":     HexColor;
  "bg-card":       HexColor;
  "brand-primary": HexColor;
  "brand-deep":    HexColor;
  "text-strong":   HexColor;
  "text-muted":    HexColor;
  accent:          HexColor;
  divider:         HexColor;
  "font-latin":    readonly string[];
  "font-cjk":      readonly string[];
  "font-mono":     readonly string[];
}

/** A theme's complete token table — required keys plus any custom additions. */
export type Tokens = RequiredTokens & Record<string, TokenValue>;

export interface LayoutEntry {
  name: string;
  module: string;       // path relative to the theme root, e.g. "layouts/cover.ts"
  thumbnail: string;    // path relative to the theme root, e.g. "thumbnails/cover.png"
}

export interface ComponentEntry {
  name: string;
  module: string;
}

/**
 * `theme.json` shape. Validated structurally at load time.
 */
export interface ThemeManifest {
  name: string;
  version: string;             // semver
  slidemlVersion: string;      // major version of SlideML core, e.g. "1"
  displayName: string;
  description: string;
  author?: string;
  tokens: Tokens;
  layouts: readonly LayoutEntry[];
  components?: readonly ComponentEntry[];
  chrome?: readonly string[];
  /**
   * OOXML-level overrides written into `ppt/theme/theme1.xml`. Optional —
   * when omitted, the package emits the generic Office Theme. Setting this
   * makes PowerPoint's Color/Font picker show the theme's actual palette
   * and lets master-driven tokens (`schemeClr val="accent1"`) inherit the
   * brand colors. All values reference token names already in `tokens`.
   */
  /**
   * Routing metadata — helps an agent pick the right theme for a given
   * deck request. Surfaced via `list_themes` so the LLM can match user
   * intent ("board pack", "consulting brief") to a theme without first
   * loading layouts. All fields optional; populated themes show up
   * with richer routing hints, themes without meta still list cleanly.
   */
  meta?: {
    /** Audiences this theme is designed for, e.g. "board / executives". */
    audiences?: readonly string[];
    /** Industries / domains this theme suits, e.g. "saas", "finance". */
    industries?: readonly string[];
    /** Mood / tone descriptors, e.g. "serious", "warm", "minimal". */
    moods?: readonly string[];
    /** Use-cases this theme is NOT for; agent should pick another. */
    antiPatterns?: readonly string[];
  };
  /**
   * Theme-level style flags consumed by primitives. Lets a theme opt out
   * of common AI-tells (accent rules under titles, centered body text)
   * without rewriting layout source files. Also carries imagery guidance
   * the agent should follow when calling `image_gen` so generated images
   * stay visually coherent with the theme.
   */
  style?: {
    /**
     * Whether `slideTitle()` should draw a brand-color rule beneath the
     * title. The Pptx skill notes universal accent rules are a hallmark
     * of AI-generated decks; restrained themes (charcoal-minimal,
     * editorial-warm, …) should set false. Default true.
     */
    titleAccentRule?: boolean;
    /**
     * Contrast enforcement at theme-load. "warn" (default) emits stderr
     * warnings; "AA" / "AAA" throw on failure.
     */
    contrastTarget?: "warn" | "AA" | "AAA";
    /**
     * Image generation guidance — the agent reads this BEFORE calling
     * `image_gen` so cover/background/illustration images match the
     * theme. Without this, image_gen tends to produce style-clashing
     * outputs (bright cartoon images on a serious dark deck, etc.).
     */
    imagery?: {
      /** One-paragraph style brief — paste verbatim into image_gen prompt. */
      guidance?: string;
      /** Hex colors to mention in image_gen prompts (palette anchors). */
      palette?: readonly string[];
      /** Negative cues — what to avoid (cartoon, bright pastels, etc.). */
      avoid?: readonly string[];
      /** Style descriptors to include (photographic, line-art, etc.). */
      preferredStyles?: readonly string[];
    };
    /** Voice / tone guidance for slide text content. */
    voice?: {
      tone?: string;
      avoid?: readonly string[];
    };
    /**
     * Per-theme typography scale (point values). Layouts can ask for a
     * named size (`ctx.size("display")`) instead of hard-coding pt — the
     * theme decides what each step actually looks like. When omitted the
     * built-in default scale is used.
     *
     * Defaults:
     *   xs: 10, sm: 12, base: 14, lg: 18, xl: 24, display: 48, hero: 96.
     */
    fontSizes?: {
      xs?: number;
      sm?: number;
      base?: number;
      lg?: number;
      xl?: number;
      display?: number;
      hero?: number;
    };
    /**
     * Per-theme bullet styling. Optional — when omitted, layouts fall back
     * to the renderer's default bullets (PowerPoint-style auto bullets).
     *
     * `glyph` is the leading character emitted before each bullet's text;
     * common choices: "•" (round), "›" (chevron), "—" (en-dash editorial),
     * "▸" (filled triangle), "◆" (diamond). Themes pick the one that
     * matches their visual register — editorial themes lean en-dash,
     * technical themes lean chevron, executive themes lean diamond.
     *
     * `color` overrides the default text-strong colour for the glyph
     * (use it to highlight bullets in brand-primary).
     */
    bullets?: {
      /** Level-0 (top) glyph. */
      glyph?: string;
      /** Color token name applied to the glyph (defaults to brand-primary). */
      color?: string;
      /** Level-1 indent glyph (defaults to glyph if omitted). */
      level1?: string;
      /** Level-2 indent glyph (defaults to level1 if omitted). */
      level2?: string;
    };

    /**
     * Surface / card visual identity. Themes can opt for sharper corners,
     * heavier elevation, or omit accent stripes entirely. Layouts that use
     * the `card()` primitive inherit these without code changes.
     *
     * Defaults: { cornerRadius: 0.03, elevation: "hairline",
     *            accentStripe: { position: "none", width: cm(0.12) } }.
     */
    surface?: {
      /** 0..0.5 of shorter side. 0 = sharp; 0.03 = soft; 0.06 = round. */
      cornerRadius?: number;
      /** "flat" (no border, no shadow) | "hairline" (thin border) |
       *  "shadow" (soft drop shadow) — applied uniformly. */
      elevation?: "flat" | "hairline" | "shadow";
      /** Accent stripe across the card. */
      accentStripe?: {
        position?: "top" | "left" | "none";
        widthCm?: number;
        /** Token name; defaults to brand-primary. */
        color?: string;
      };
      /** Border policy for cards. "card-only" (default) | "full" | "none". */
      borderPolicy?: "card-only" | "full" | "none";
    };

    /**
     * Semantic color overrides — let themes pick semantic palettes that
     * harmonize with their brand instead of the hardcoded green/red/blue/
     * amber. Forest themes might use varying greens; midnight themes might
     * use desaturated tones. Used by SWOT, chip color resolver, alert
     * styling. Each entry is a hex (no #) — NOT a token name (semantic
     * colors should be self-contained even when brand changes).
     */
    semantic?: {
      positive?: string;
      negative?: string;
      warning?: string;
      info?: string;
      neutral?: string;
    };

    /**
     * Data visualization palette. Categorical for series colors,
     * sequential for heatmaps / progress, diverging for centered scales.
     * All entries hex, no #.
     */
    dataviz?: {
      categorical?: readonly string[];
      sequential?: { from: string; to: string };
      diverging?: { negative: string; mid: string; positive: string };
    };

    /**
     * Typography scale + role policy. When `typography` is set, layouts
     * derive sizes from `baseHalfPt × ratio^step` and `ctx.role(...)`
     * returns a complete style for a named text role (title, body, …).
     * Without this, layouts fall back to hardcoded sizes + `style.fontSizes`.
     */
    typography?: {
      /** Base body size in half-points (e.g. 28 = 14pt). */
      baseHalfPt?: number;
      /** Modular scale ratio (1.2 / 1.25 / 1.333 / 1.414 / 1.5). */
      ratio?: number;
      /** Whether to apply italic to CJK text (italic CJK falls back to
       *  slanted serif on macOS / LO — most themes should set false). */
      italicCjk?: boolean;
      /** Numeral style — `tabular` keeps digit widths uniform (good for
       *  data tables and KPI alignment). */
      numerals?: "proportional" | "tabular";
      /** Per-role overrides. */
      roles?: {
        title?:   { weight?: "regular" | "medium" | "bold"; transform?: "none" | "upper" | "smallCaps"; trackingHalfPt?: number };
        heading?: { weight?: "regular" | "medium" | "bold"; transform?: "none" | "upper" | "smallCaps"; trackingHalfPt?: number };
        body?:    { weight?: "regular" | "medium" | "bold"; transform?: "none" | "upper" | "smallCaps"; trackingHalfPt?: number };
        caption?: { weight?: "regular" | "medium" | "bold"; transform?: "none" | "upper" | "smallCaps"; trackingHalfPt?: number };
        label?:   { weight?: "regular" | "medium" | "bold"; transform?: "none" | "upper" | "smallCaps"; trackingHalfPt?: number };
      };
    };

    /**
     * Numbering style for ordered lists / sections (agenda, outline,
     * process-flow). "padded" → 01/02; "decimal" → 1./2.; "roman" → I./II.;
     * "circled" → ①②. Default "padded".
     */
    numbering?: {
      style?: "padded" | "decimal" | "roman" | "circled";
    };

    /**
     * Inline chip overrides — themes can replace the default ▲▼→✓⚠✗●
     * glyph set with theme-appropriate alternatives, or override the
     * resolved color (otherwise chips draw in the matching semantic
     * color above when set, then fall back to text-muted).
     */
    chips?: {
      up?:        { glyph?: string; color?: string };
      down?:      { glyph?: string; color?: string };
      flat?:      { glyph?: string; color?: string };
      ok?:        { glyph?: string; color?: string };
      warn?:      { glyph?: string; color?: string };
      bad?:       { glyph?: string; color?: string };
      highlight?: { glyph?: string; color?: string };
    };

    /** Global image rendering defaults applied when a layout doesn't override. */
    image?: {
      /** Default clip shape. "rect" | "rounded" | "circle". */
      defaultClip?: "rect" | "rounded" | "circle";
      /** Hairline border around images. */
      border?: { widthPt?: number; color?: string };
      /** Color treatment hint surfaced in image_gen guidance (no actual
       *  pixel-level treatment is applied — pptx is static). */
      treatment?: "none" | "sepia" | "duotone" | "grayscale";
    };

    /**
     * Chart styling defaults. Carries through to renderChartCell and any
     * code-generated chart shapes that consult ctx.style.chart.
     */
    chart?: {
      gridStyle?: "solid" | "dashed" | "none";
      barCornerRadius?: number;
      dataLabelPosition?: "inside" | "outside" | "none";
    };

    /** Table rendering style. */
    table?: {
      headerFill?: string;          // token name; default brand-deep
      rowStripe?: boolean;          // default true
      borderStyle?: "full" | "rows" | "none"; // default rows
      firstColEmphasis?: "none" | "bold" | "accent"; // default none
    };
  };
  oxml?: {
    /** 12 OOXML color slots; values are TOKEN NAMES from `tokens`. */
    clrScheme?: {
      bg1: string;       // light 1 (canvas)
      tx1: string;       // dark 1 (body text)
      bg2: string;       // light 2 (card)
      tx2: string;       // dark 2 (muted text)
      accent1: string;
      accent2: string;
      accent3: string;
      accent4: string;
      accent5: string;
      accent6: string;
      hlink: string;
      folHlink: string;
    };
    /** Font scheme written into theme1.xml's `<a:fontScheme>`. */
    fontScheme?: {
      majorLatin: string;
      minorLatin: string;
    };
  };
}

/**
 * Loaded layout — the `slots` schema and the render function from a layout
 * module, paired with the manifest entry that referenced it.
 *
 * The actual `LayoutFn` signature lives in `render/layout-context.ts` and
 * is added as a dependency in Stage 3.
 */
export interface LoadedLayout {
  entry: LayoutEntry;
  /** Slot schema, as exported by the layout module's `slots` named export. */
  slots: Record<string, SlotSchema>;
  /** Default-exported render function, typed loosely until Stage 3 lands. */
  render: (...args: unknown[]) => unknown;
  /** Description: first paragraph of the layout's section in `theme.md`. */
  description: string;
  /**
   * One-line agent-facing purpose from the global `_purposes.ts` table.
   * Surfaced by `summarizeLayouts` and `describeLayout` so the agent can
   * scan the layout list once and route correctly without reading every
   * theme.md subsection.
   */
  purpose?: string;
  /** Resolved absolute path to the thumbnail PNG. */
  thumbnailAbsPath: string;
  /**
   * Optional agent-facing guidance — text following a `**Guidance:**`
   * marker inside the layout's `theme.md` subsection. Surfaced in
   * `describeLayout()` so an LLM picking this layout sees do/don't tips
   * (e.g. "use the takeaway as a CONCLUSION, not chart commentary").
   */
  guidance?: string;
}

export interface LoadedComponent {
  entry: ComponentEntry;
  slots: Record<string, SlotSchema>;
  render: (...args: unknown[]) => unknown;
}

/**
 * The fully loaded theme as the runtime sees it. Constructed by `loadTheme`
 * in Stage 3.
 */
export interface LoadedTheme {
  manifest: ThemeManifest;
  /** Absolute path to the theme directory. */
  rootDir: string;
  layouts: Map<string, LoadedLayout>;
  components: Map<string, LoadedComponent>;
  /** Chrome modules loaded from the theme. Key = chrome name from manifest.chrome[]. */
  chrome?: Map<string, (...args: unknown[]) => unknown>;
  /**
   * `theme.md` parsed into per-section text (key = level-2 heading slug).
   * Layout descriptions in `LoadedLayout.description` come from this.
   */
  docSections: Record<string, string>;
}

/**
 * Slot schema declared by a layout/component module. Mirrors SPEC.md → Slot
 * value vocabulary. The validator (Stage 4) compiles these to JSON Schema.
 *
 * `region` is a polymorphic slot: the value is `{ kind: "kpi" | "chart" |
 * "table" | "text" | "bullets" | "image" | "code" | "quote" |
 * "sparkline" | "progress", ... }` and the consuming layout enforces the
 * cell shape. `region-list` is the same value vocabulary repeated N times,
 * used by variable-cell layouts like `dashboard`.
 */
export type SlotSchema =
  | { type: "text"; maxChars: number; optional?: boolean }
  | { type: "text-block"; maxChars: number; maxLines?: number; optional?: boolean }
  | { type: "markdown-inline"; maxChars: number; optional?: boolean }
  | { type: "bullets"; min: number; max: number; itemMaxChars: number; optional?: boolean }
  | { type: "image-ref"; optional?: boolean }
  | { type: "chart-spec"; optional?: boolean }
  | { type: "component-ref"; allowed?: readonly string[]; optional?: boolean }
  | { type: "table"; maxRows?: number; maxCols?: number; cellMaxChars?: number; optional?: boolean }
  | { type: "region"; optional?: boolean }
  | { type: "region-list"; min: number; max: number; optional?: boolean }
  /** Polymorphic "show me a thing": image | svg | chart | table.
   *  Tagged via `kind` discriminator; legacy un-tagged shapes (image-ref,
   *  chart-spec, table) are coerced. See render/visual.ts. */
  | { type: "visual"; optional?: boolean }
  | { type: "enum"; values: readonly string[]; default?: string; optional?: boolean };
