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
  "prose":               "Long-form body. columns: 1 (default, generous margins) | 2 (magazine flow). Density-aware budgets.",
  "executive-summary":   "TL;DR clipboard: 2–6 numbered { heading, line }. Quieter than key-point.",
  "q-and-a":             "FAQ list. 1–5 question + answer pairs.",
  "definition":          "Single-term page: term + pronunciation + body + example.",
  "glossary":            "Two-column term + definition list. 3–12 entries.",
  "letter":              "Open-letter format: date, recipient, body, signoff, signature.",
  "quote":               "Pull-quote. Optional portrait → magazine layout (circular avatar + name + role); without portrait → bare big-glyph centered quote.",

  // ── Text + visual ────────────────────────────────────────────────────
  "visual-with-text":    "Visual (image | chart | table | svg) + sibling text column. textKind: prose|bullets, imageStyle: card|bleed (image only), position: left|right, ratio.",

  // ── Image-led ────────────────────────────────────────────────────────
  "image-full-bleed":    "Image fills the slide. Optional caption band.",
  "visual-with-caption": "Visual (image | chart | table | svg) + bottom annotation. style: caption (italic editorial) | takeaway (branded callout panel).",
  "image-grid":          "Gallery of 2–4 images. count=2 → side-by-side (before/after). count=4 → 2×2 grid with optional captions.",
  "hero-image-overlay":  "Full-bleed image with translucent overlay carrying title + subtitle.",

  // ── Data ─────────────────────────────────────────────────────────────
  "stat-grid-3":         "3 KPI tiles in a row. style: tile|minimal.",
  "hero-stat":           "ONE huge headline number. Use sparingly — once per deck.",
  "data-table":          "Native table with header + alternating rows. align per column.",

  // ── Frameworks / structure ───────────────────────────────────────────
  "matrix-2x2":          "Quadrant framework (priority×effort, etc) with optional axis labels.",
  "compare-two-columns": "Side-by-side option A vs option B card layout.",
  "timeline":            "Step or event sequence. direction: horizontal (process diagram) | vertical (narrative timeline with optional date column). 2–6 items.",
  "process-flow":        "Causal A→B→C pipeline as connected chevrons. Use over `timeline` when conveying STAGES not events; over `key-point` when order matters. 2–8 steps.",
  "roadmap":             "Gantt-style time × tracks. periods[] (3–12 quarters/months) × tracks[] (1–7 lanes), each track has bars {start,end,label?,status?}. For product / project / release plans.",
  "swot":                "Fixed Strengths/Weaknesses/Opportunities/Threats quadrants with canonical color semantics. Use `matrix-2x2` for arbitrary axis frameworks.",
  "funnel":              "3–6 stages narrowing top-down. Each stage: { label, value?, sublabel? }. For conversion / pipeline / cohort.",
  "key-point":           "Tagline + 2–4 supporting points with icons. 'Three reasons' style. For 5+ items use content-grid or dashboard cells[].",
  "content-grid":        "3–8 simple `{title, body}` cards in an auto-flex grid. The 'I have N small content blocks' pattern — use over key-point (max 4) or dashboard (polymorphic regions overkill for plain text).",
  "dashboard":           "2–8 polymorphic region cells (KPI/chart/table/text/...). cells[] form for 2-8; legacy tl/tr/bl/br for 4. Auto-arranged 1×2..2×4.",
  "pricing-table":       "2–4 pricing tier cards. Recommended tier highlighted.",
  "team-grid":           "2–8 team members with circular avatars + name + role.",

  // ── Composition ──────────────────────────────────────────────────────
  "split":               "N polymorphic regions. cells: 2|3, direction: horizontal|vertical (T-shape on 3+vertical), ratio enum. Replaces split-2 / split-3-horizontal / split-3-vertical.",
  "framed":              "Optional header/footer/leftEdge/rightEdge bands + required center.",

  // ── Specialised ──────────────────────────────────────────────────────
  "code-block":          "Code on dark card with mono font + optional language + caption.",

  // ── Escape hatch ─────────────────────────────────────────────────────
  "freeform":            "Direct shapes[]: { kind, x, y, w, h }. ONLY when no other layout fits.",
};
