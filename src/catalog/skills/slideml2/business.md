# Business Research Deck Style

Use this reference for business-related PPT generation: market research, industry reports, company analysis, competitor benchmarking, strategy recommendations, investment memos, operations reviews, financial/KPI reports, executive briefings, and consulting-style deliverables.

The goal is a decision-quality business deck, not a decorative article. The viewer should understand the answer, the proof, and the decision implication without reading speaker notes.

## Core Principle

Default to a McKinsey/BCG-style analytical memo:

- Lead with the answer, not the journey.
- Make every slide a single claim backed by evidence.
- Prefer charts, tables, ranked lists, matrices, and process/decision components over generic card grids.
- Use page titles as conclusions: "Luxury positioning is now the growth driver", not "Market Analysis".
- Treat visual style as quiet infrastructure. The data and recommendation should be louder than decoration.

## When To Use This Style

Use this file when the user's request includes signals such as:

- market, industry, competitor, company, business model, strategy, investment, financing, M&A, due diligence
- revenue, margin, profit, CAC, LTV, funnel, conversion, KPI, operations, supply chain, pricing
- consulting report, executive summary, board deck, management briefing, research report, analyst report

If the topic is medical, education, science, or technical but the audience is executives/investors and the output must support a business decision, still use this file.

## Story Structure

Pick a structure before authoring slides. Do not simply convert source headings into slides.

### Default 8-12 Slide Research Report

1. Cover: report title, scope, date, optional hero stat or thesis.
2. Executive summary: 3-5 conclusions plus implication/action.
3. Why now: market inflection, external trigger, or business pressure.
4. Market / category landscape: size, growth, segments, or value chain.
5. Evidence page 1: trend, ranking, funnel, table, or benchmark that proves the thesis.
6. Evidence page 2: customer, competitor, economics, or operations proof.
7. Diagnosis: drivers, constraints, risks, or causal chain.
8. Strategic options: compare 2-4 paths with criteria.
9. Recommendation: preferred path, rationale, expected upside.
10. Execution roadmap: phases, owners, milestones, dependencies.
11. Risks and mitigations: risk matrix or scorecard.
12. Closing synthesis: key takeaways, decisions requested, next steps.

Short decks can merge slides 3-6. Long decks can repeat the evidence/diagnosis pattern per chapter. Avoid many section dividers; use `eyebrow` and slide titles to signal chapters unless a true topic reset occurs.

### Common Business Storylines

- Market entry: thesis -> market size/growth -> segments -> competitor gaps -> entry options -> recommended wedge -> roadmap -> risks.
- Company diagnosis: headline performance -> KPI tree -> driver analysis -> peer benchmark -> root causes -> initiatives -> impact/risk.
- Competitor research: landscape -> positioning matrix -> feature/pricing benchmark -> go-to-market comparison -> vulnerability/opportunity -> recommendation.
- Investment memo: one-line thesis -> market tailwinds -> business model -> traction/economics -> risks -> valuation/return logic -> decision.
- Operating review: scorecard -> exceptions -> root-cause evidence -> corrective actions -> owners/timeline.

## Page Patterns

Use these patterns instead of defaulting to many `insight-card`s.

### Answer First

- Component: `executive-summary`
- Use for: opening answer, board summary, final synthesis.
- Content: thesis + 2-4 findings + implication/action.
- Avoid: 4 equal cards that force the audience to infer the conclusion.

### Evidence Plus Meaning

- Component: `evidence-layout`
- Evidence side: `chart-card`, `table-card`, `image-card`, `bar-list`, `heatmap`, `funnel`, `range-plot`, or `matrix-2x2`.
- Insight side: `key-takeaway`, `explanation-block`, `fact-list`, or one `insight-card`.
- Use for: any slide where a chart/table/screenshot must be interpreted.

### Metrics Snapshot

- Components: `kpi-grid`, `stat-strip`, `scorecard`, `hero-stat`
- Use `stat-strip` when numbers support one read and card frames would feel repetitive.
- Use `scorecard` for status/health with good/warning/danger semantics.
- Use one `hero-stat` only when the number is the slide's point.

### Ranking / Distribution / Mix

- Components: `bar-list`, `chart-card`, `donut-summary`, `range-plot`, `heatmap`
- Use `bar-list` for ranked categories where relative size matters.
- Use `donut-summary` only when one share dominates the story.
- Use `heatmap` for market/category/time matrices, not for tiny arbitrary tables.

### Competitive / Strategic Comparison

- Components: `comparison-table`, `comparison-list`, `comparison-card`, `matrix-2x2`, `swot-matrix`, `table-card`
- Use `comparison-table` for options x criteria, competitor features, pricing tiers.
- Use `matrix-2x2` for strategic positioning or priority trade-offs.
- Use `swot-matrix` only when the source explicitly needs SWOT.

### Causality / Economics

- Components: `stat-flow`, `process-flow`, `flow-arrow`, `explanation-block`
- Use `stat-flow` for KPI derivations such as CAC -> payback -> LTV.
- Use `process-flow` for operating model, value chain, sales pipeline, or implementation steps.

### Timeline / Roadmap

- Components: `process-flow`, `timeline`, `axis-ruler`, `timeline-axis-bar`
- For executive roadmaps, prefer `process-flow` or `axis-ruler` over decorative milestone pins.
- Use `timeline` only when dates are the organizing meaning.

### Risks / Actions

- Components: `matrix-2x2`, `scorecard`, `checklist`, `takeaway-list`, `cta`
- Use `matrix-2x2` for risk impact x probability.
- Use `checklist` for readiness and implementation tracking.
- End with decisions or next actions, not a bare "Thank you".

## Visual Style

Business decks should feel precise, calm, and evidence-led.

Business research decks are light-first. Use dark or saturated backgrounds only for covers, section resets, hero-stat pages, or explicit brand/keynote requests. Evidence-heavy pages with tables, charts, source notes, or dense bullets should stay on white or near-white backgrounds.

### Theme

Set `themeOverride` at `create_deck` time. A safe default:

```json
{
  "colors": {
    "background": "FFFFFF",
    "surface": "F8FAFC",
    "surface.elevated": "FFFFFF",
    "text.primary": "111827",
    "text.secondary": "4B5563",
    "text.muted": "6B7280",
    "divider": "E5E7EB",
    "brand.primary": "2563EB",
    "brand.secondary": "0F766E",
    "success": "16A34A",
    "warning": "D97706",
    "danger": "DC2626"
  },
  "fonts": {
    "latin": {
      "display": ["Helvetica Neue"],
      "text": ["Arial"]
    },
    "cjk": {
      "display": ["PingFang SC"],
      "text": ["PingFang SC"]
    },
    "mono": ["Menlo"]
  },
  "text": {
    "slide-title": { "fontSize": 31, "fontWeight": 700, "lineHeight": 1.12, "fontFamily": "display" },
    "section-title": { "fontSize": 21, "fontWeight": 700, "lineHeight": 1.18, "fontFamily": "display" },
    "paragraph": { "fontSize": 12, "lineHeight": 1.35, "fontFamily": "text" },
    "caption": { "fontSize": 8.8, "lineHeight": 1.25 },
    "metric-value": { "fontSize": 34, "fontWeight": 700, "lineHeight": 1.0, "fontFamily": "display" }
  },
  "layout": {
    "pageMarginX": 1.25,
    "titleTop": 0.75,
    "titleHeight": 1.35,
    "contentTop": 2.6,
    "contentBottom": 0.9,
    "defaultGap": 0.48
  },
  "component": {
    "card": { "cornerRadius": 0.12, "padding": 0.45 },
    "panel": { "cornerRadius": 0.12, "padding": 0.55 }
  }
}
```

Adjust the accent color to the company/industry if the brief provides one. Keep semantic status colors stable: green = good/upside, amber = caution, red = risk.

Use only effective theme fields. Vertical page rhythm is controlled by `titleTop`, `titleHeight`, `contentTop`, and `contentBottom`; do not invent `pageMarginY`. Component borders use the `divider` token by default. Font chains are preference order: put the font you most want to use first. PPTX OOXML emits that first face for each script/role and SlideML2 does not embed fonts, so the first face should also be available in the render/viewing environment when fidelity matters.

### Composition

- Use white or near-white backgrounds for most pages.
- Do not make a full business research report dark by default. Reserve dark pages for cover/chapter/hero moments unless the user explicitly asks for a dark theme.
- Use 1 primary accent color plus status colors. Avoid rainbow palettes unless categories require them.
- Prefer thin lines, `accent-rule`, `side-rail`, `eyebrow`, and sparse `decoration-grid` over large decorative blocks.
- Use cards only for naturally modular objects: options, metrics, evidence tiles. Do not make every paragraph a card.
- Avoid heavy rounded rectangles; business cards should use small normalized radius (`cornerRadius: 0.08`-`0.16`). Do not use CSS/px-style values such as `8`, `12`, or `16` on slide nodes.
- Use asymmetry: one large evidence object plus one interpretation rail often beats a 2x2 card grid.
- Keep screenshots and generated illustrations as evidence or context, not decorative filler. Use `fit:"contain"` when the content must be inspected.

### Typography

- Slide title is the main sentence. It should be readable as the conclusion.
- Body text should wrap naturally; do not shrink long paragraphs into one line.
- Prefer 2-4 bullets per module, 8-14 Chinese characters or 5-9 English words per bullet when possible.
- Use bold rich text only for the part that matters, not whole paragraphs.
- Keep source notes quiet but present on evidence pages.

## Component Selection Rules

Before using `insight-card`, check whether one of these is more precise:

- Overall answer: `executive-summary`
- One decisive conclusion: `key-takeaway`
- Multiple final conclusions: `takeaway-list`
- Explanation / cause / implication: `explanation-block`
- Evidence rows with source/meaning: `fact-list`
- Options or before/after: `comparison-list` or `comparison-table`
- Data proof: `chart-card`, `table-card`, `bar-list`, `scorecard`, `funnel`, `heatmap`
- Evidence plus interpretation: `evidence-layout`

Use `insight-card` only for a curated finding that can stand alone in a peer set. If a slide has 3-4 `insight-card`s and no clear title-level claim, redesign it as `executive-summary`, `evidence-layout`, `comparison-list`, `fact-list`, or a chart/table page.

## Business Slide Quality Checklist

Run this mentally before validation:

1. Does the title state the business conclusion?
2. Is there one dominant evidence object or one clear decision frame?
3. Is the component choice semantic, not just visually convenient?
4. Are all metrics sourced or explained?
5. Are cards used because the content is modular, not because layout is uncertain?
6. Are status colors meaningful and consistent?
7. Is the final slide asking for a decision, summarizing actions, or stating next steps?

If any answer is "no", revise the slide before adding more decoration.
