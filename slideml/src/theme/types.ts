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
 */
export type SlotSchema =
  | { type: "text"; maxChars: number; optional?: boolean }
  | { type: "text-block"; maxChars: number; optional?: boolean }
  | { type: "markdown-inline"; maxChars: number; optional?: boolean }
  | { type: "bullets"; min: number; max: number; itemMaxChars: number; optional?: boolean }
  | { type: "image-ref"; optional?: boolean }
  | { type: "chart-spec"; optional?: boolean }
  | { type: "component-ref"; allowed?: readonly string[]; optional?: boolean }
  | { type: "table"; optional?: boolean };
