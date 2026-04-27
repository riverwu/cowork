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
 * "table" | "text", ... }` and the consuming layout enforces the cell
 * shape. Used by the `dashboard` layout to host arbitrary content per
 * cell without exploding the schema surface.
 */
export type SlotSchema =
  | { type: "text"; maxChars: number; optional?: boolean }
  | { type: "text-block"; maxChars: number; optional?: boolean }
  | { type: "markdown-inline"; maxChars: number; optional?: boolean }
  | { type: "bullets"; min: number; max: number; itemMaxChars: number; optional?: boolean }
  | { type: "image-ref"; optional?: boolean }
  | { type: "chart-spec"; optional?: boolean }
  | { type: "component-ref"; allowed?: readonly string[]; optional?: boolean }
  | { type: "table"; optional?: boolean }
  | { type: "region"; optional?: boolean };
