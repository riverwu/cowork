# SlideML — Core Specification v1

This document is the **frozen** contract for SlideML core. Themes and layouts
extend appearance and intent vocabulary, but cannot extend the language itself.
Any change here is a major version bump (`slideml: 2`).

---

## Document grammar

A SlideML deck is a single YAML document.

```yaml
slideml: 1                    # required, integer, == 1 for this spec version
deck:
  size: 16x9                  # required; enum
  language: zh-CN             # optional; default "en-US"
  theme: technical-blue       # required; theme package name
  defaults:                   # optional; per-deck token overrides
    accent: brand-deep        # references another token in the theme
slides:                       # required; non-empty array
  - <slide>
  - <slide>
```

### `deck.size` enum

| Value | EMU width × height | Inches | cm |
|---|---|---|---|
| `16x9` | `9144000 × 5143500` | 10.000 × 5.625 | 25.4 × 14.288 |
| `16x10` | `9144000 × 5715000` | 10.000 × 6.250 | 25.4 × 15.875 |
| `4x3` | `9144000 × 6858000` | 10.000 × 7.500 | 25.4 × 19.05 |
| `wide` | `12192000 × 6858000` | 13.333 × 7.500 | 33.867 × 19.05 |

### `deck.language` enum

`en-US`, `zh-CN`, `zh-TW`, `ja-JP`, `ko-KR`, plus any BCP-47 tag the theme
recognizes. Drives:
- Default font slot (`token(font-cjk)` for CJK languages, `token(font-latin)`
  otherwise).
- Number-format defaults in chart slots (`万元/亿` Y-axis only available for
  `zh-*`).
- Punctuation handling in `markdown-inline` (CJK-aware quote escaping).

### `deck.theme`

Name of an installed theme package. Resolution is the host's responsibility;
slideml takes a `themeDir` path or pre-loaded theme to its compile API. The
deck-level `theme:` field is informational and used for validation against
the loaded theme's `name` field.

### `deck.defaults`

Optional per-deck overrides of theme tokens. Keys must be names that exist in
the theme's `tokens` table. Values must reference *another* token in the same
theme (`accent: brand-deep`) — raw hex/literals are rejected. This keeps
themes the only place colors are spelled out.

---

## Slide grammar

```yaml
- layout: cover                # required; layout name from the theme registry
  chrome: default              # optional; default | none. Default: default
  notes: |                     # optional; markdown speaker notes
    Talking points...
  transition: none             # optional; none | fade. Default: none
  slots:                       # required; per-layout, schema-validated
    title: "..."
    subtitle: "..."
```

### Slide-level keys (frozen set)

Exactly these keys. Extra keys at the slide level are a validation error.

| Key | Required | Type | Notes |
|---|---|---|---|
| `layout` | yes | string | Must exist in the loaded theme's layout registry |
| `chrome` | no | enum | `default` (master decorations on) or `none` |
| `notes` | no | text-block | Markdown speaker notes; not rendered on slide |
| `transition` | no | enum | `none` or `fade`. We deliberately don't expand this |
| `slots` | yes | object | Layout-specific slot values, schema-validated |

No `style:`, no `position:`, no `theme:`, no `chrome-overrides:`. The
language is intentionally narrow.

---

## Slot value vocabulary (frozen — the eight types)

Layouts declare their slots typed against this vocabulary. Adding a ninth
type is a SlideML major version bump. Each layout's slot schema lives in
its theme; slideml core enforces only the type-shape rules below.

### 1. `text(maxChars)`
Single-line plain text. No formatting, no newlines.
```yaml
title: "Q1 Revenue Review"
```

### 2. `text-block(maxChars)`
Multi-line plain text. Newlines preserved. No markdown.
```yaml
notes: |
  Line 1
  Line 2
```

### 3. `markdown-inline(maxChars)`
Rich text limited to: `**bold**`, `*italic*`, `` `code` ``. **No** links, **no**
headers, **no** lists, **no** tables, **no** images. The renderer parses to
runs and emits `<a:r>`/`<a:rPr>` accordingly.
```yaml
takeaway: "**AI 同传**超过传统人工 *1.7×*。"
```

### 4. `bullets(min, max, item-maxChars)`
An array of `text(item-maxChars)` items. Constraints enforced before render.
```yaml
points:
  - "Cut latency from 800ms to 120ms"
  - "Halved infra spend"
  - "Onboarded 3 enterprise pilots"
```

### 5. `image-ref`
Reference to an image asset. The renderer reads the file or fetches the URL.
```yaml
hero:
  src: ./assets/cover.png       # absolute path, relative path, or http(s) URL
  alt: "Q1 hero image"          # required for accessibility
  fit: cover                    # optional; contain | cover | crop. Default: contain
```

### 6. `chart-spec`
Native chart. Renderer emits OOXML chart XML.
```yaml
chart:
  type: bar                     # bar | line | pie
  data:
    labels: ["Q1", "Q2", "Q3", "Q4"]
    series:
      - { name: "Revenue", values: [4500, 5500, 6200, 7100] }
  format:
    y: int                      # int | decimal | percent | wanyuan | yi
```

### 7. `component-ref`
Instance of a component the theme provides. `name` must exist in the theme's
component registry; `slots` are validated against that component's schema.
```yaml
takeaway:
  name: takeaway-callout
  slots:
    text: "Net: ship Tuesday."
```

### 8. `table`
Structured tabular data. Header row is mandatory.
```yaml
table:
  header: ["Metric", "Plan", "Actual"]
  rows:
    - ["Revenue", "8000万", "8283万"]
    - ["GM%",     "42",     "39.8"]
  colWidths: [3, 2, 2]          # optional; relative weights or cm strings
```

### Token references

Inside any string slot, `token(<name>)` resolves to a theme token value at
render time. Allowed inside `markdown-inline` and `text-block` for color
runs only via the runtime's restricted parser; not allowed in `text`.

---

## Length values

Used by themes/layouts internally; **not** by slot values. Documented here
because the theme contract references them.

A `Length` accepts:
- Number → interpreted as EMU (914400 EMU = 1 inch).
- String with unit suffix: `"6cm"`, `"0.4in"`, `"24pt"`, `"914400emu"`.
- All units are converted to EMU at parse time.

Conversion constants:
- `1 in = 914400 EMU`
- `1 cm = 360000 EMU`
- `1 pt = 12700 EMU`

---

## Theme package contract

A theme is a directory (or zip of one). The directory layout is fixed:

```
theme-name/
  theme.json          required; machine-readable manifest
  theme.md            required; LLM-readable spec
  layouts/            required; each .ts file exports default (ctx) => ShapeList
  components/         optional
  chrome/             optional
  thumbnails/         required; one PNG per layout, filename matches layout name
  assets/             optional; embedded fonts, images, etc.
  examples/           optional; example .slideml.yaml files
  CHANGELOG.md        optional
  LICENSE             required for distribution
```

### `theme.json` schema

```json
{
  "name": "technical-blue",                  // required; matches directory name
  "version": "1.0.0",                        // required; semver
  "slidemlVersion": "1",                     // required; major version of SlideML core
  "displayName": "Technical Blue",           // required
  "description": "Engineering / data deck",  // required; one line
  "author": "...",                           // optional
  "tokens": {                                // required; see Tokens below
    "<token-name>": "<value>"
  },
  "layouts": [                               // required; non-empty
    { "name": "cover", "module": "layouts/cover.ts", "thumbnail": "thumbnails/cover.png" }
  ],
  "components": [                            // optional
    { "name": "header", "module": "components/header.ts" }
  ],
  "chrome": ["page-number", "brand-bar"]     // optional; module names from chrome/
}
```

### Tokens

Required token names every theme must define:

| Token | Type | Purpose |
|---|---|---|
| `bg-canvas` | hex color | Slide background base |
| `bg-card` | hex color | Card / surface fills |
| `brand-primary` | hex color | Primary brand accent |
| `brand-deep` | hex color | Secondary / deeper brand accent |
| `text-strong` | hex color | High-contrast body text |
| `text-muted` | hex color | Lower-contrast labels, captions |
| `accent` | hex color | Sparingly-used emphasis (deltas, callouts) |
| `divider` | hex color | Hairlines, separators |
| `font-latin` | string[] | Latin font fallback chain |
| `font-cjk` | string[] | CJK font fallback chain |
| `font-mono` | string[] | Monospace fallback chain |

Themes MAY define additional named tokens. Names are kebab-case ASCII.

Hex colors use 6-character format **without** the `#` prefix
(e.g. `"3CC2FF"`). Themes containing `#` or 8-char hex will fail to load.

### `theme.md` structure

The loader parses this as markdown and validates the section structure.
Required sections (level-2 headings, in order):

1. `# <Display Name>` (level-1 title)
2. Free-form description paragraph
3. `## When to use this theme`
4. `## When NOT to use`
5. `## Layout reference` — followed by one level-3 section per layout. Each
   layout section MUST contain:
   - One paragraph: when to pick.
   - A bulleted slot list: each bullet starts with the slot name in
     backticks, then `—`, then the slot type and constraints.
   - A line containing `![<layout-name>](thumbnails/<layout-name>.png)`.
6. `## Components` — optional. If present, one level-3 section per component
   following the same slot-bullet pattern.
7. `## Tokens` — bullets, one per token, format
   `` - `<token-name>` — <one-line description> ``.
8. `## Chrome` — optional. One bullet per chrome decoration.
9. `## Examples` — optional. Free-form prose pointing at `examples/`.

Loader fails with a structured error if any required section is missing or
mis-ordered.

### Layout module contract

```ts
// layouts/cover.ts
import type { LayoutContext, ShapeList } from "slideml/render";

export const slots = {
  title:    { type: "text",            maxChars: 60 },
  subtitle: { type: "text",            maxChars: 80, optional: true },
  eyebrow:  { type: "text",            maxChars: 20, optional: true },
};

export default function cover(ctx: LayoutContext): ShapeList {
  const { cm, token, font, slot, deckSize } = ctx;
  return [
    // ...absolute geometry built from helpers, never raw EMU
  ];
}
```

The exported `slots` object is the layout's slot schema. `slideml` core
generates a JSON Schema from this and validates each slide's `slots:` block
against it before invoking the layout function.

The default-exported function is **pure**: same `ctx` → same `ShapeList`.
No I/O, no random IDs, no Date.now (the package emitter assigns IDs).

---

## Public API surface

`slideml/src/index.ts` exports:

```ts
export function compile(
  slidemlYaml: string,
  opts: {
    themeDir: string;          // path to a theme package directory
    output?: string;           // if set, also writes to this path
  }
): Promise<{ buffer: Buffer; written?: string }>;

export function validateDeck(
  slidemlYaml: string,
  opts: { themeDir: string }
): Promise<ValidationResult>;

export function loadTheme(themeDir: string): Promise<LoadedTheme>;

export function listLayouts(theme: LoadedTheme): LayoutInfo[];

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: SlidemlError[] };

export type SlidemlError = {
  code: string;                // stable error code, e.g. "SLOT_OVERFLOW"
  slideIndex?: number;
  layout?: string;
  slot?: string;
  message: string;             // English; cowork localizes at the boundary
  hint?: string;
};

export type LayoutInfo = {
  name: string;
  description: string;         // first paragraph of the layout's section in theme.md
  slotSchema: object;          // JSON Schema generated from the layout module's `slots`
  thumbnailPath: string;       // absolute path to the layout's thumbnail PNG
};
```

No other exports. Internal modules are not re-exported.

---

## Boundary rules (slideml is independent)

The slideml package is an independent component that lives in this repo for
development convenience but ships zero coupling to cowork. CI enforces:

1. No imports starting with `..` (no parent-relative paths out of slideml).
2. No imports starting with `@/` (no cowork path aliases).
3. `package.json` runtime deps limited to: `js-yaml`, `ajv`, `jszip`. No
   tauri, no electron, no react, no zustand, no cowork-internal packages.
4. Targets Node ≥ 20. No DOM globals, no browser-only APIs.
5. Errors are English-only structured objects. Localization is the host's
   concern.

Lint check in root CI: `grep -rE "from ['\"]\.\." slideml/src/ && exit 1` and
similar for `@/`.

---

## Versioning

- **SlideML core** uses integer major versions: `slideml: 1`, `slideml: 2`, …
  Bump the major when the slot vocabulary, slide-level keys, or document
  grammar changes incompatibly.
- **Themes** use semver and declare `slidemlVersion: "1"`. The loader rejects
  themes whose major doesn't match core, with a migration message.
- The `compile`/`validateDeck`/`loadTheme` API uses semver of the slideml
  package. Breaking changes here are also major bumps.

---

## Errors

Errors thrown by `compile`/`validateDeck` are `SlidemlError` objects (see
above). Stable codes (extend as needed):

| Code | When |
|---|---|
| `PARSE_ERROR` | YAML didn't parse |
| `UNKNOWN_LAYOUT` | Slide references a layout not in the theme |
| `UNKNOWN_COMPONENT` | Slot references a component not in the theme |
| `UNKNOWN_TOKEN` | `token(...)` references a name the theme doesn't define |
| `SLOT_REQUIRED` | Required slot missing |
| `SLOT_OVERFLOW` | Slot value exceeds `maxChars` / array `max` |
| `SLOT_UNDERFLOW` | Array slot has fewer than `min` items |
| `SLOT_TYPE_MISMATCH` | Slot value doesn't match declared type |
| `EXTRA_KEY` | Unrecognized key at deck or slide level |
| `THEME_INVALID` | Theme package fails contract validation |
| `THEME_VERSION_MISMATCH` | Theme's `slidemlVersion` doesn't match core |
| `RENDER_ERROR` | Layout function threw |
| `EMIT_ERROR` | OOXML emitter failed (e.g. invalid color hex) |

---

## What's frozen vs. extensible

**Frozen (changing requires major version bump):**
- The eight slot value types.
- The slide-level key set.
- The deck-level key set.
- The `Length` units.
- The theme package directory layout and required files.
- The required token names every theme must define.
- The `theme.md` required section structure.
- The public API signature.

**Extensible (themes can add freely):**
- New layouts.
- New components.
- New chrome decorations.
- New tokens (additional ones beyond the required set).
- New thumbnails.
- Theme assets (fonts, images).

This is the contract. The whole architecture rests on it.
