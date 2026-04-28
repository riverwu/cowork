/**
 * Single source of truth for agent-facing layout purposes.
 *
 * Each entry is a ≤100-char one-liner that tells the agent:
 *   1. What the layout is FOR (one phrase).
 *   2. (When relevant) capacity / scale hint.
 *   3. (When relevant) "use X instead when …" pointer.
 *
 * Surfaced by `summarizeLayouts` (compact list) and `describeLayout`
 * (full detail). Convention: write in agent voice, no flowery language.
 *
 * Add a new layout? Add an entry here. The registry reads `PURPOSES`
 * automatically — layouts not in this map fall back to their theme.md
 * description's first sentence.
 */

export const PURPOSES: Record<string, string> = {
  // ── Structural / chrome ─────────────────────────────────────────────
  "cover":               "Deck opener (slide 1). Title + subtitle + eyebrow.",
  "closing":             "Final 'thank you' slide. Mirrors cover.",
  "title-only":          "Section / chapter pause. One large centered title.",
  "section-divider":     "Section break with eyebrow + title. Brand-deep panel.",
  "agenda":              "Numbered table of contents. 2–8 items.",
  "outline":             "Multi-level ToC with nested sub-items (book/syllabus).",

  // ── Pure text ────────────────────────────────────────────────────────
  "prose":               "Single-column long-form body. ≤270/540/1080/1800 chars CJK by density.",
  "two-column-prose":    "Magazine 2-column body flow. ≤540/1080/2160/3600 chars CJK by density.",
  "executive-summary":   "TL;DR clipboard: 2–6 numbered { heading, line }. Quieter than key-point.",
  "q-and-a":             "FAQ list. 1–5 question + answer pairs.",
  "definition":          "Single-term page: term + pronunciation + body + example.",
  "glossary":            "Two-column term + definition list. 3–12 entries.",
  "letter":              "Open-letter format: date, recipient, body, signoff, signature.",
  "timeline-text":       "Vertical narrative timeline. 2–6 events with date + body.",
  "quote":               "Pull-quote. ≤240 chars. Use quote-with-portrait if you have a face.",
  "quote-with-portrait": "Pull-quote + circular portrait + name + role.",

  // ── Text + image ─────────────────────────────────────────────────────
  "two-col-text-image":  "Title + paragraph text + image side-by-side. Pick density + imageRatio.",
  "bullet-with-image":   "Title + 3–6 bullets + side image. imageRatio configurable.",
  "image-split-text":    "Immersive 50/50 — image edge-to-edge, text on other half.",

  // ── Image-led ────────────────────────────────────────────────────────
  "image-full-bleed":    "Image fills the slide. Optional caption band.",
  "image-with-caption":  "Editorial: image + italic caption + optional credit. Magazine feel.",
  "image-pair":          "Two side-by-side images (before/after, comparison). Optional labels.",
  "hero-image-overlay":  "Full-bleed image with translucent overlay carrying title + subtitle.",
  "image-grid-2x2":      "2×2 grid of up to 4 images, each with optional caption.",

  // ── Data ─────────────────────────────────────────────────────────────
  "stat-grid-3":         "3 KPI tiles in a row. style: tile|minimal.",
  "hero-stat":           "ONE huge headline number. Use sparingly — once per deck.",
  "chart-with-takeaway": "Title + NATIVE chart-spec data + boxed conclusion. NOT for static images — use image-with-takeaway.",
  "image-with-takeaway": "Title + STATIC image (rendered chart, diagram, photo) + boxed conclusion. Use when chart is a PNG/JPG, not data.",
  "data-table":          "Native table with header + alternating rows. align per column.",
  "dashboard":           "2×2 grid of polymorphic regions (KPI/chart/table/text/...).",

  // ── Frameworks / structure ───────────────────────────────────────────
  "matrix-2x2":          "Quadrant framework (priority×effort, etc) with optional axis labels.",
  "compare-two-columns": "Side-by-side option A vs option B card layout.",
  "process-timeline":    "3–5 step process. direction: horizontal|vertical.",
  "key-point":           "Tagline + 2–4 supporting points with icons. 'Three reasons' style.",
  "pricing-table":       "2–4 pricing tier cards. Recommended tier highlighted.",
  "team-grid":           "2–8 team members with circular avatars + name + role.",

  // ── Composition ──────────────────────────────────────────────────────
  "split-2":             "Two heterogeneous regions side-by-side. ratio: 50-50/60-40/40-60/etc.",
  "split-3-horizontal":  "Three region columns. ratio: equal/wide-center/wide-left/wide-right.",
  "split-3-vertical":    "Top region + 50/50 bottom row. ratio: top:bottom height.",
  "framed":              "Optional header/footer/leftEdge/rightEdge bands + required center.",

  // ── Specialised ──────────────────────────────────────────────────────
  "code-block":          "Code on dark card with mono font + optional language + caption.",

  // ── Escape hatch ─────────────────────────────────────────────────────
  "freeform":            "Direct shapes[]: { kind, x, y, w, h }. ONLY when no other layout fits.",
};
