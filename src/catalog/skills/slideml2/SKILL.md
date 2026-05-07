---
name: slideml2
description: "Use this skill whenever the user asks to create, edit, render, review, or export slide decks, presentations, PPT, PPTX, or SlideML2 decks. This skill is the component reference for Cowork's SlideML2 deck tools."
version: 1.0.4
license: Proprietary. LICENSE.txt has complete terms
---

# SlideML2 Component Reference

## Domain Style References

- **Business / research report decks**: If the request is about a company, industry, market, competitor, investment, strategy, operations, finance, KPI dashboard, consulting memo, executive briefing, or "research report" with a business audience, read [business.md](business.md) before planning the deck or calling `create_deck`. Use it to choose the storyline, visual tone, `themeOverride`, and component mix. Do not load it for unrelated education, medical, scientific, or product/technical decks unless the user's goal is a business decision.

## Authoring Workflow

1. Create the deck with `create_deck({deckPath, title, theme, brand, themeOverride})`. Do not hand-write the full deck JSON. A valid source deck has `slideml2:2`, `deck:{size:"16x9", theme, brand, themeOverride}`, and `slides`.
2. Plan slides first: one clear job per slide, a short title, and 1-3 content regions. Split dense material instead of forcing many long modules onto one slide.
3. Add, replace, insert, or delete slides:
   - `replace_slide({deckPath, slideId, slide})` — replace existing or append (when `slideId === slideCount`). Best when you have a clear "rewrite this one slide" intent.
   - `insert_slide({deckPath, index, slide})` — insert a NEW slide at a specific 0-based position. Use when splitting a slide, inserting a section break, or adding a fresh page mid-deck. `index:"end"` or omitted = append.
   - `delete_slide({deckPath, slideId})` — delete by id (string) or 0-based index (number).
   - `patch_deck({deckPath, set?, unset?, insert?, move?, copy?})` — unified primitive for all deck mutations: theme tokens, brand fields, chrome settings, slide content, slide ordering, slide insertion/deletion. Each group is a top-level OBJECT (not an array of ops) — agents pick the group whose name matches the intent:
     - `set`: path → value map. Sets each path; replaces in place when an array index already exists; creates missing intermediate object keys. Examples: `{"set":{"/deck/themeOverride/colors/brand.primary":"7C3AED","/slides/3/title":"New Title"}}`. To replace a whole slide: `{"set":{"/slides/3":{...newSlide...}}}`. To append: `{"set":{"/slides/-":{...}}}`.
     - `unset`: array of path strings to delete. Example: `{"unset":["/slides/8"]}`.
     - `insert`: path → value map for splice-inserting into arrays (existing element shifts down). Path forms: `/slides/3` (index), `/slides/-` (append), `/slides/before:<id>`, `/slides/after:<id>`. Example: `{"insert":{"/slides/after:cover":{...newSlide...}}}`.
     - `move`: from-path → to-path map. Example: `{"move":{"/slides/5":"/slides/1"}}`.
     - `copy`: from-path → to-path map.
     Multiple groups can be combined in one call; ops apply in order unset → set → insert → move → copy.
   The `slide` argument (in replace/insert) is only a slide object: `{id, title?, background?, children, notes?, metadata?}`. `background` may be a token/hex string, `{type:"solid", color:"brand.primary"}`, `{fill:"linear-gradient(...)"}`, or `{src:"/abs/path.png"}`. Do not include deck-level fields inside a slide.
4. After every 1-2 successful slide writes, run `validate_render({deckPath, render:true})`. If it returns blocking diagnostics, call `read_deck` for the affected slide, repair the current source, and validate again before continuing.
5. Finish only after `validate_render` reports no blocking diagnostics and the PPTX has been rendered.

## Hard Rules

- JSON must be valid. Use Chinese quotation marks inside Chinese prose, or escape inner English quotes.
- Use theme tokens for text colors, never raw hex on slide nodes. Put hex values in `create_deck.themeOverride.colors`, then reference tokens such as `text.primary`, `text.inverse`, `brand.primary`, `success`, `warning`, or `danger`.
- Use themeOverride text fields as `fontSize`, `fontWeight`, and `lineHeight`; do not use `bold` or `lineSpacing`.
- Style precedence is explicit: theme/themeOverride defines deck defaults; a concrete slide node or component instance may override that default with fields such as `fontSize`, `fontFamily`, `fontWeight`, `lineHeight`, `color`, `size`, `tracking`, `italic`, `surface`, `fill`, `line`, or `cornerRadius`; rich text run fields override both for that run only. Instance overrides are local and do not change the theme for other components.
- Avoid duplicate hero titles: if `slide.title` is set, do not also place a body `slide-title`, `deck-title`, or `section-break` title.
- Preserve semantic sequence markers when repairing density: if the source chapter says "判断 1/2/3", "Step 1/2/3", or similar, keep that ordinal visible in the slide title, eyebrow, label, or first card headline. Shortening a title must not erase the only visible "判断1" marker while later slides still show "判断2/判断3".
- Use component names directly in `type` with flat fields. Do not wrap components as `type:"component" + component:"X"` and do not put fields under `props`.
- Prefer semantic components over plain `card`/`text` when the content has a clear meaning: metrics, timeline, process, comparison, insight, quote, table, chart, image, or takeaway.
- Keep density renderable: most slides should have either one hero module, one data/evidence module, or 2-4 peer modules. Long prose belongs in shorter bullets, a split slide, or another slide.
- Treat `FALLBACK_FAILED`, `COLLISION`, `TITLE_OCCLUDED`, `TINY_RECT`, `SQUASHED`, `DROP`, `LOW_CONTRAST`, `SHAPE_INVISIBLE`, `UNKNOWN_COLOR`, and `UNKNOWN_STYLE` as blockers. If `TRUNCATED`/`OVERFLOW` appears repeatedly in one render, split or redesign instead of shipping tiny text.

## Deck Structure — Earn Every Slide

A deck is judged by content density, not slide count. Chrome slides (cover / TOC / section-break / closing) are infrastructure, not content. If they outweigh real material, the deck reads as padding.

- **Content slides ≥ 70% of total.** A 16-slide deck should have ≥ 11 substance slides (data, analysis, evidence, conclusions). Cover + TOC + thanks/end account for 3 chrome slides at most.
- **Use section-breaks sparingly.** One per major section, only when the deck has ≥ 3 content slides per section. A deck with 6 sections of 1 content slide each is over-segmented — collapse the dividers and let `eyebrow` + `slide-title` carry the section signal inline.
  - 4–8 content slides → 0–1 section-breaks (often none; the TOC already announces structure).
  - 9–14 content slides → 1–2 section-breaks at major pivots.
  - 15+ content slides → 2–3 section-breaks max.
- **Skip the TOC for short decks.** Below ~10 content slides the TOC adds chrome without aiding navigation. If you do include one, give it real value: per-chapter body text, page references, or a one-line thesis per chapter.
- **No empty closing slide.** A bare "Thank You" / "End" slide is wasted real estate — replace it with a recap of the 3-5 key takeaways, the strongest data point, or contact/QR. If the deck genuinely ends there, drop the slide.
- **No section-break + immediate single-content + section-break pattern.** That's structural padding. Either merge the lone slide back into a neighboring section or expand it into a real chapter.
- **A section-break is a hard reset.** Use it to change topic AND mode (e.g. context → method, results → discussion). Don't use it as decoration between any two slides.

When you find yourself authoring more chrome than content, stop and ask whether the underlying material justifies the structure. A deck of 8 dense, well-designed content slides reads better than 16 slides where half are dividers.

### A common anti-pattern (avoid)

A 22-slide deck about a paper that looks like:
`cover · TOC · § · 内容 · § · 内容 · § · 内容 · § · 内容5张 · § · 内容2张 · § · 内容3张 · 谢谢`

= 9 chrome slides (cover + TOC + 6 section-breaks + closing) + 13 content slides — 41% of the deck is structural padding, four sections have only 1 content slide.

The same material rendered well:
`cover · TOC(with body) · 内容 · 内容 · § 实验 · 实验5张 · § 结论 · 结论5张 · 致谢+引用`

= 1 cover + 1 TOC + 2 section-breaks + 13 content + 1 closing-with-content = 18 slides, 78% content. The remaining 4 standalone "lead-in" content slides absorbed into their section's first content slide as an `eyebrow:"01 研究背景"` + `slide-title` + lead paragraph — same chapter signal, no padding slide.

### Pre-validate self-check (run mentally before each `validate_render`)

1. **Count slides by class.** chrome = cover + TOC + section-break + bare-closing. content = everything else. If chrome > 30% of total, something is over-segmented.
2. **Count content per section.** A section-break should introduce ≥ 3 content slides. If a section has 1–2 slides, drop the divider and put the section name in the first slide's `eyebrow`.
3. **Is the TOC earning its place?** A TOC with 6 single-line item titles on a 13-content-slide deck is worth keeping. A TOC on a 5-content deck is chrome — drop it.
4. **Closing slide test.** If the closing slide reads "谢谢/Thank You" plus nothing else, replace its body with the 3-5 strongest takeaways or remove it. References + contact + QR is fine.

## Typography Rhythm

- One hero per slide. At most one element at hero / deck-title / cover-title / metric-value scale. Two heroes split attention.
- Use ≤4 distinct font sizes per slide. theme.text already provides a calibrated scale (deck-title 48 / slide-title 29 / section-title 21 / h2 18 / paragraph 10.8 / caption 8.8); pick from those rather than inventing intermediate sizes.
- Adjacent size levels should differ by ≥1.3×. If you override `themeOverride.text` fontSize, keep the ratio between consecutive levels ≥1.3× — closer ratios read as visual noise.
- Numbers must dominate their labels. metric-value vs metric-label is ~2.7× by default; preserve that gap on any data slide. Don't render a KPI with paragraph-style text.
- CJK-heavy decks need +1pt: paragraph 12 / slide-title 32 reads better in Chinese than the Latin-tuned defaults.
- Manage fonts at deck level with `themeOverride.fonts`: `latin` and `cjk` each support `{display:[...], text:[...]}`, and `mono` is an array. Text styles pick the role with `fontFamily:"display"|"text"|"mono"`. Font chains are preference order: put the font you most want to use first. PPTX emits that first face for each script/role and does not embed fonts, so choose a first face that is both desired and available when fidelity matters; later items are documentation/fallback intent, not guaranteed runtime substitution.
- Keep title and footer clear in `themeOverride.layout`: `contentTop` must be at least `titleTop + titleHeight + 0.25`; when page numbers or footer text are enabled, `contentBottom` must leave room for footer chrome. Do not use `pageMarginY`.
- Keep tables readable. A 6-column table with 6+ body rows usually needs its own slide or a split across slides; the renderer blocks rows that fall below the PowerPoint-readable row-height floor even if the outer table technically fits.

## Component Selection — Pick the Most Semantic

- Component choice is half the design. When content fits a specific component, use it — don't hand-build with generic card/panel/grid. Specific components encode density limits, status colors, anchor rules, and contrast-safe defaults that you lose by re-inventing.
- Map intent → component, not shape → component:

## Page Layout Archetypes — Pick The Story Shape First

Before writing slide children, choose the page's composition job. This avoids the default "title + equal cards" look.

- **Claim + proof:** one dominant conclusion plus one evidence object. Use `chart-with-rail`, `evidence-layout`, or `split` with a `key-takeaway` and a `chart-card/table-card/image-card`.
- **Hero + satellites:** one idea leads, 2-4 smaller modules support it. Use `hero-and-support`; do not use a flat 2x2 card grid when one item is clearly more important.
- **Data object + interpretation:** a chart/table/screenshot should occupy most of the page and a narrow rail explains the read. Use `chart-with-rail`.
- **Screenshot walkthrough:** an image/screenshot needs numbered observations. Use `snapshot-callouts`; use `freeform-group` only when callouts must point to precise coordinates.
- **Peer comparison:** objects have equal status. Use `comparison-card` grid, `comparison-list`, `comparison-table`, or `pros-cons`.
- **Process / time:** movement or sequence is the meaning. Use `process-flow`, `timeline`, or `axis-ruler`.
- **Executive synthesis:** the page is a memo-like answer. Use `executive-summary`, `key-takeaway`, or `takeaway-list`.
  - chapters / TOC → `outline`
  - glossary / vocabulary → `glossary`
  - FAQ / interview → `q-and-a`
  - multiple-choice question → `quiz-card`
  - plan comparison → `comparison-table`
  - health / status grid → `scorecard`
  - conversion stages → `funnel`
  - 2-axis classification → `matrix-2x2`
  - chronology → `timeline` (use `items[].content` for rich moments — embed metric-card, quote, image)
  - central conclusion → `key-takeaway` (single) / `takeaway-list` (3-5)
- Search SKILL.md for a matching keyword before composing card+text+grid. If you start from card/panel and add fields, you're probably picking the wrong abstraction.

Use this file as the primary component-selection reference. Pick the component whose use case best matches the slide content, then write the component name directly in `type` with flat fields:

```json
{ "id": "s1.thesis", "type": "key-takeaway", "headline": "One central conclusion." }
```

## Layout Escape Hatches — `at`, `layer`, `anchorTo`

Components handle ~90% of slides cleanly. The remaining 10% is editorial moments — covers, section openers, hero stat slides over photography, "wow" pages where the brief calls for visual impact. For those, slideml2 has three escape hatches that bypass the flow + component model. Reach for them when components feel anemic for the moment, not as a default.

The slide canvas is **25.4 × 14.29 cm** (16:9).

### Units

- Layout geometry is cm: `at:[x,y,w,h]`, `gap`, `padding`, `fixedWidth`, `fixedHeight`, `width`, `height`, `length`, image/card/table/chart dimensions.
- `cornerRadius` is not cm or px. It is a normalized roundRect fraction `0..0.5`; use `0.08`-`0.16` for business-card subtle rounding and never use CSS-style `8` or `12` on slide nodes.
- Text size is pt: `fontSize: 24` means 24pt. Prefer semantic text styles and `size` first; use raw `fontSize` only when you intentionally override theme text.
- Stroke thickness is point-like: `lineWidth`, `borderWidth`, divider `thickness`, and `accent-rule.thickness` should use values such as `1` for a normal 1pt line and `2`-`3` for a strong rule. Legacy tiny cm values like `0.02` or `0.05` still render as hairlines, but do not use `fixedHeight:1` or `height:1` to draw a line.
- Do not mix layout and stroke units: `fixedHeight:1` is a 1cm region; `thickness:1` is a 1pt rule.

### `at:[x,y,w,h]` — slide-relative absolute positioning

Place a node at exact coordinates against the slide canvas. Slide-level only (direct child of slide root). Pairs with `rotation` (degrees) for off-axis editorial layouts.

```json
{
  "id": "cover",
  "background": "1A1B3A",
  "children": [
    { "id": "cover.headline",
      "type": "text", "text": "From Bench to Bedside",
      "style": "deck-title", "color": "F8F9FA",
      "at": [1.8, 5.2, 21.5, 3.6], "rotation": -3 },
    { "id": "cover.eyebrow",
      "type": "text", "text": "Q3 RESEARCH REVIEW",
      "style": "label", "color": "FF4B5C",
      "at": [1.8, 4.4, 8, 0.6] },
    { "id": "cover.stamp",
      "type": "shape", "preset": "rect", "fill": "FF4B5C",
      "at": [18, 0, 7.4, 14.29], "rotation": 8 }
  ]
}
```

A diagonal red stripe + rotated headline + eyebrow — three absolute-positioned nodes. Use this shape for covers, hero stats over photos, deliberate composition moments. Don't use it for ordinary content slides — flow + components are still the right default.

### `layer:"behind"|"above"` — z-stack inside a container

Inside a stack/grid, mark a child with `layer:"behind"` (renders below flow siblings, fills parent rect, claims no flow space) or `layer:"above"` (renders on top). Default is `flow`.

```json
{
  "id": "hero",
  "type": "stack", "direction": "vertical", "gap": 0.4,
  "fill": "0F172A", "cornerRadius": 0.18, "padding": 0.8,
  "children": [
    { "id": "hero.bg",
      "type": "image", "src": "...", "fit": "cover", "layer": "behind" },
    { "id": "hero.title",
      "type": "text", "text": "$12.4M ARR",
      "style": "deck-title", "color": "FFFFFF" },
    { "id": "hero.label",
      "type": "text", "text": "Q3 closed-won",
      "style": "label", "color": "F1F5F9" }
  ]
}
```

Image fills the card backing, text reads on top, no awkward Z-index hacks.

### `anchorTo:"<targetNodeId>"` — overlay positioned relative to another node

A slide-level overlay whose reference frame is another node's rect, not the slide canvas. Use for badges clipping over a card edge, callout-markers pointing at a chart region.

```json
{
  "id": "results", "title": "...",
  "children": [
    { "id": "results.chart", "type": "chart-card", "...": "..." },
    { "id": "results.flag",
      "type": "shape", "preset": "rect", "fill": "FF4B5C",
      "anchorTo": "results.chart",
      "anchor": "top-right", "offsetX": -1.2, "offsetY": -0.4,
      "width": 2.4, "height": 0.8 },
    { "id": "results.flag-text",
      "type": "text", "text": "NEW",
      "style": "label", "color": "FFFFFF",
      "anchorTo": "results.flag",
      "anchor": "middle-center" }
  ]
}
```

The flag clips over the chart card's top-right corner, with its own text centered inside.

### When to use which

| Goal | Tool |
|---|---|
| Diagonal headline, hero number on cover, custom poster-style page | `at` + `rotation` |
| Image as card background, scrim on top of content, deco-grid behind text | `layer` on a flow child |
| Badge/flag/callout-marker pointing at another element | `anchorTo` |
| Anything else | components + flow |

These primitives keep the renderer's contrast / shape-visibility / text-overflow guards active — escape hatch, not free-fall.

## Layout Containers

- stack: Flow container for a single semantic group whose children should read in sequence. Use for ordered narrative, grouped support points, or a module's internal layout; do not use as a generic page made of unrelated text. kind=container parent=any children=required type='stack' optional={direction:enum[vertical|horizontal], gap:number, area:enum[content|full], justify:enum[start|center|end], align:enum[start|center|end], valign:enum[top|middle|bottom], padding:number} example={"id":"example.stack","type":"stack","direction":"vertical","gap":0.4,"children":[{"id":"example.stack.text","type":"text","text":"One key message"}]}
- grid: Matrix container for peer modules that should be compared or scanned together. Children may set colSpan/rowSpan to make one semantic hero cell plus smaller satellites; avoid plain equal cards when a chart/table/process component describes the meaning better. kind=container parent=any children=required type='grid' optional={columns:number, gap:number, area:enum[content|full], columnWeights:array, rowWeights:array, rows:number, fixedHeight:number} example={"id":"example.grid","type":"grid","columns":2,"gap":0.5,"children":[{"id":"example.grid.left","type":"comparison-card","title":"Option A","points":["Fast","Low risk"]},{"id":"example.grid.right","type":"comparison-card","title":"Option B","points":["Flexible","Higher effort"]}]}
- split: Primary/secondary composition for one dominant idea plus support. Use for claim+proof, chart+commentary, image+interpretation, before+after, or side-rail pages; prefer it over equal grids when one region should lead. kind=container parent=any children=required type='split' optional={direction:enum[horizontal|vertical], ratio:array, gap:number, area:enum[content|full], padding:number, align:enum[start|center|end], valign:enum[top|middle|bottom]} example={"id":"example.split","type":"split","direction":"horizontal","ratio":[0.68,0.32],"gap":0.55,"children":[{"id":"example.split.chart","type":"chart-card","chartType":"bar","labels":["A","B"],"series":[{"name":"Series","values":[10,20]}]},{"id":"example.split.rail","type":"side-rail","title":"Interpretation","body":"Explain the read."}]}
- panel: Surface wrapper for one related semantic group that needs visual separation. Pair with stack/grid for the child layout; do not use as the page's default way to make prose look designed. kind=container parent=grid children=optional type='panel' optional={tone:enum[neutral|brand|positive|warning|danger|tinted], fill:string, line:string, padding:number, cornerRadius:number, elevation:enum[flat|raised|outlined], fixedHeight:number} example={"id":"example.panel","type":"panel","tone":"tinted","children":[{"id":"example.panel.body","type":"text","text":"Grouped content."}]}
- card: Reusable contained module with optional header/footer/accent. Use only when the content is naturally card-like (metric, definition, comparison item, evidence tile); prefer richer semantic components first. kind=container parent=grid children=optional type='card' optional={tone:enum[neutral|brand|positive|warning|danger|tinted], fill:string, line:string, padding:number, cornerRadius:number, elevation:enum[flat|raised|outlined], fixedHeight:number} example={"id":"example.card","type":"card","header":"Engagement","accent":"left","children":[{"id":"example.card.body","type":"text","text":"78% retention week one."}]}
- band: Wide emphasis band for a section break, thesis, verdict, or hero quote that should interrupt the flow. It carries one strong idea, not dense body content. kind=container parent=stack children=optional type='band' optional={tone:enum[neutral|brand|positive|warning|danger|tinted], fill:string, height:number, fixedHeight:number, cornerRadius:number, padding:number} example={"id":"example.band","type":"band","tone":"brand","height":1.6,"children":[{"id":"example.band.text","type":"text","text":"Section: outlook","style":"section-title","color":"brand.primary"}]}
- frame: Border-only wrapper for an artifact, placeholder, or lightly emphasized region. Use when containment matters but fill would compete with content. `lineWidth` is stroke thickness: use 1 for a normal 1pt border, not cm. kind=container parent=stack children=optional type='frame' optional={line:string, lineWidth:number, dash:enum[solid|dash|dashDot|dot], cornerRadius:number, padding:number, fixedHeight:number, fixedWidth:number} example={"id":"example.frame","type":"frame","lineWidth":1,"dash":"dash","children":[{"id":"example.frame.body","type":"text","text":"TBD region"}]}
- inset: Invisible padding wrapper that gives one semantic child breathing room. Use for spacing inside a surface, not as a visible module. kind=container parent=stack children=optional type='inset' required={padding:number} optional={fixedHeight:number, fixedWidth:number} example={"id":"example.inset","type":"inset","padding":0.5,"children":[{"id":"example.inset.body","type":"text","text":"Indented child."}]}
- two-column: Semantic two-region layout for narrative + visual, evidence + commentary, or before + after. Use when both sides have named roles, not as a generic equal split. kind=semantic parent=stack children=none type='two-column' required={left:object, right:object} optional={ratio:array, gap:number} example={"type":"two-column","left":"left","right":"right"}
- freeform-group: Slide-level composition group for anchored overlays. Use when a cover, section opener, annotation layer, or editorial page needs several independently positioned objects without abandoning validation. Children should set anchor/offsetX/offsetY/width/height/zIndex; mode:"background" defaults children behind content. kind=semantic parent=slide children=required type='freeform-group' optional={mode:enum[overlay|background]} example={"type":"freeform-group","children":[{"id":"s.mark","type":"pointer-arrow","anchor":"middle-right","direction":"left","label":"关键变化"}]}
- cover-composition: Editorial cover layout with optional full-bleed visual, decoration, dominant title lockup, and hero stat. Use instead of loose deck-title/text nodes when the first slide needs rich composition. kind=semantic parent=slide children=none type='cover-composition' required={title:string} optional={subtitle:string, eyebrow:string, visual:object {src,fit}, heroStat:object {value,label,caption}, tone:enum[neutral|inverse|brand], decor:enum[none|grid|shapes]} example={"type":"cover-composition","eyebrow":"DIAGNOSIS","title":"LLM Agent Memory Diagnosis","subtitle":"Task isolation strategy","heroStat":{"value":"22","label":"slides compared"},"tone":"neutral","decor":"shapes"}
- chapter-divider: High-impact chapter opener with full-slide color field, large chapter number, title/subtitle, and optional section progress bar. Use only for major section resets. kind=semantic parent=slide children=none type='chapter-divider' required={title:string} optional={subtitle:string, chapter:string, eyebrow:string, sections:array, current:number, tone:enum[brand|neutral|inverse]} example={"type":"chapter-divider","chapter":"03","eyebrow":"RESULTS","title":"实验结果","subtitle":"从诊断到改进路径","sections":["背景","方法","结果"],"current":2,"tone":"brand"}
- hero-and-support: Page archetype with one dominant hero claim/object plus 2-4 support satellites. Use instead of equal card grids when one idea leads. kind=semantic parent=stack children=none type='hero-and-support' required={headline:string, supports:array} optional={hero:object, detail:string, items:array alias, layout:enum[left|top], ratio:array, gap:number, tone:enum[neutral|brand|positive|warning|danger]} example={"type":"hero-and-support","headline":"利润率改善来自成本结构变化","detail":"主结论先读，右侧只放支撑事实。","supports":[{"title":"采购","body":"单价下降 8%"},{"title":"自动化","body":"人效提升 15%"},{"title":"结构","body":"高毛利品类占比提升"}]}
- chart-with-rail: Page archetype for a dominant chart/table/evidence object plus a narrow interpretation rail. Use for data pages where the chart/table should be inspected and the rail explains the read. kind=semantic parent=stack children=none type='chart-with-rail' required={evidence:object} optional={rail:object, headline:string, detail:string, items:array, layout:enum[rail-right|rail-left|stacked], ratio:array, gap:number, tone:enum[neutral|brand|positive|warning|danger|tinted]} example={"type":"chart-with-rail","evidence":{"id":"s.chart","type":"chart-card","chartType":"bar","labels":["Q1","Q2"],"series":[{"name":"Revenue","values":[10,18]}]},"headline":"Q2 是拐点","detail":"增长来自新增渠道，而不是价格。","items":["看斜率","看异常点","看下一步动作"]}
- snapshot-callouts: Screenshot/image walkthrough with numbered callout rail. Use for UI critique, product walkthrough, or artifact review; use freeform-group only when markers must point to exact coordinates. kind=semantic parent=stack children=none type='snapshot-callouts' required={src:image-ref, callouts:array} optional={title:string, caption:string, items:array alias, fit:enum[cover|contain|fill], layout:enum[rail-right|rail-left|below], ratio:array, gap:number, tone:enum[neutral|brand|positive|warning|danger|tinted]} example={"type":"snapshot-callouts","src":"/abs/path/screenshot.png","title":"Agent run trace","callouts":[{"title":"入口","body":"用户意图在这里确定"},{"title":"错误","body":"验证失败后没有切换版式"}]}
- evidence-layout: Evidence plus interpretation page. Use for chart/screenshot/image/table + conclusion slides so the viewer sees both proof and meaning. kind=semantic parent=stack children=none type='evidence-layout' required={evidence:object} optional={insight:object, headline:string, detail:string, annotations:array, layout:enum[sidecar|stacked], ratio:array} example={"type":"evidence-layout","evidence":{"id":"s.chart","type":"image-card","src":"/path/chart.png","title":"Chart"},"insight":{"id":"s.insight","type":"insight-card","headline":"关键结论","detail":"一眼解释证据。"}}

## Quantitative Proof

- hero-stat: Slide-defining number: one very large metric that carries the main message. Use for cover stats, market size, landmark deltas, or decisive proof; one per slide max. kind=semantic parent=stack children=none type='hero-stat' required={value:string, label:string} optional={caption:string, tone:enum[brand|positive|warning|danger|neutral]} example={"type":"hero-stat","value":"value","label":"label"}
- kpi-grid: Set of related headline metrics that should be scanned together. Use for 2-6 KPI peers; prefer chart/bar-list when the relationship is ranking or trend. Metrics can include delta/status/comparison/source/sparkline when the number needs context. kind=semantic parent=stack children=none type='kpi-grid' required={metrics:array of {value:string, label/name/title:string}} optional={items:array alias for metrics, columns:number, variant:enum[plain|card|compact], density:enum[comfortable|compact], surface:object} example={"type":"kpi-grid","columns":3,"variant":"card","metrics":[{"value":"42%","label":"Adoption","delta":"+8pp","status":"positive","sparkline":[10,18,25,42]}]}
- metric-card: Single compact KPI: one short numeric value plus label, optionally with delta/status/comparison/source/sparkline. Do not use for prose, product names, or step text. kind=semantic parent=grid children=none type='metric-card' required={value:string, label:string} optional={unit:string, trend:enum[up|down|flat], delta:string, status:enum[brand|positive|warning|danger|neutral], comparison:string, source:string, sparkline:array, variant:enum[plain|card|compact], density:enum[comfortable|compact], surface:object} example={"type":"metric-card","value":"42%","label":"Adoption","delta":"+8pp","status":"positive","variant":"card"}
- stat-strip: Inline row of headline metrics with minimal chrome. Use when 3-6 numbers support one read and card frames would be too heavy. kind=semantic parent=stack children=none type='stat-strip' required={items:array of {value:string, label/name/title:string}} optional={tone:enum[brand|positive|neutral]} example={"type":"stat-strip","items":[{"value":"42%","label":"Adoption"}]}
- stat-comparison: Before/after or current/target numeric change with delta. Use when the transformation is the point and two values must be read together. kind=semantic parent=stack children=none type='stat-comparison' required={beforeLabel:string, beforeValue:string, afterLabel:string, afterValue:string} optional={trend:enum[up|down|flat], deltaLabel:string} example={"type":"stat-comparison","beforeLabel":"beforeLabel","beforeValue":"beforeValue","afterLabel":"afterLabel","afterValue":"afterValue"}
- bar-list: Ranked or sortable categorical numeric comparison. Use when the viewer should see who is bigger/smaller across 4-8 items. kind=semantic parent=stack children=none type='bar-list' required={items:array of {label/name/title:string, value/score/percent:number|string}} optional={tone:enum[brand|positive|warning|danger], sort:enum[desc|asc|none]} example={"type":"bar-list","items":[{"label":"A","value":75}]}
- progress-bar: Single progress-to-target measure. Use for completion, quota, adoption, or capacity where the percent/ratio is the semantic point. kind=semantic parent=stack children=none type='progress-bar' required={label:string, value:number|string} optional={max:number|string, valueLabel:string, tone:enum[brand|positive|warning|danger]} example={"type":"progress-bar","label":"Done","value":"75%"}
- chart-card: Titled quantitative evidence module. Use when the chart is a self-contained proof object with interpretation/source, not just a raw plot. Add insight for the readout, caption for provenance. kind=semantic parent=grid children=none type='chart-card' required={chartType:enum[bar|stacked-bar|line|pie|doughnut|area|combo|scatter|waterfall] or chart, labels:array or data.labels, series:array or data.series} optional={title:string, badge:string, insight:string, caption:string, showLegend:boolean, showValues:boolean, yFormat:enum[int|decimal|percent|wanyuan|yi], tone:enum[neutral|brand|tinted], variant:enum[card|frameless|compact], surface:object} example={"type":"chart-card","title":"Conversion","badge":"Finding","chartType":"bar","labels":["A"],"series":[{"name":"X","values":[1]}],"insight":"A is the bottleneck."}

## Comparison And Decisions

- comparison-card: One peer item in a comparison set: option, product, persona, scenario, or competitor with parallel points. Can carry badge, score, winner state, compact metrics, pros/cons, rich body, and footer. kind=semantic parent=grid children=none type='comparison-card' required={title:string} optional={subtitle:string, body:string, content:richTextRuns, badge:string, points:array, items:array, metrics:array, pros:array, cons:array, score:string, winner:boolean, footer:string, variant:enum[plain|card|compact], density:enum[comfortable|compact], surface:object} example={"type":"comparison-card","variant":"card","winner":true,"badge":"Recommended","title":"Option A","score":"92/100","points":["Fast setup","Lowest risk"],"metrics":[{"label":"Cost","value":"$12k","tone":"positive"}]}
- pros-cons: Two-sided trade-off frame. Use when the meaning is explicitly benefits vs drawbacks, not for any two-column layout. kind=semantic parent=stack children=none type='pros-cons' required={pros:array, cons:array} optional={prosTitle:string, consTitle:string} example={"type":"pros-cons","pros":"pros","cons":"cons"}
- swot-matrix: Four-quadrant strategic diagnosis: strengths, weaknesses, opportunities, threats. Use only when this exact SWOT semantic frame fits. kind=semantic parent=stack children=none type='swot-matrix' required={strengths:array, weaknesses:array, opportunities:array, threats:array} example={"type":"swot-matrix","strengths":"strengths","weaknesses":"weaknesses","opportunities":"opportunities","threats":"threats"}
- pricing-card: One commercial/package tier with price and included features. Use inside a pricing comparison; mark the recommended tier semantically. kind=semantic parent=grid children=none type='pricing-card' required={plan:string, price:string, features:array} optional={period:string, tone:enum[neutral|brand], ctaText:string} example={"type":"pricing-card","plan":"plan","price":"price","features":"features"}
- table-card: Titled structured comparison or lookup table. Use for financials, feature matrices, risks, guidance, and compact data summaries. Add insight for the readout, caption for provenance. kind=semantic parent=stack children=none type='table-card' required={rows:array or data.rows} optional={title:string, badge:string, insight:string, headers:array or data.headers, columns:array, caption:string, tone:enum[neutral|brand|tinted], variant:enum[card|frameless|compact], surface:object} example={"type":"table-card","title":"Risk Matrix","badge":"Audit","headers":["Risk","Level"],"rows":[["Memory carryover","High"]],"insight":"Context isolation is the main control."}

## Sequence And Causality

- process-flow: Connected process, workflow, recipe, pipeline, or causal sequence. Use when steps depend on each other or movement through stages is the main idea. Steps can include status/owner/time/icon/bullets when the process needs operational detail. kind=semantic parent=stack children=none type='process-flow' required={steps:array of {title/label:string, body/description:string, status?:enum[brand|positive|warning|danger|neutral], owner?:string, time?:string, icon?:string, bullets?:array} or items} optional={direction:enum[horizontal|vertical], variant:enum[plain|cards], density:enum[comfortable|compact], surface:object} example={"type":"process-flow","variant":"cards","steps":[{"title":"Collect","status":"positive","owner":"Research"},{"title":"Ship","status":"warning","time":"W2"}]}
- timeline: Chronological sequence with dates, eras, milestones, or releases. Use when time is the organizing meaning. Each item carries a time label plus one of three content forms — choose the simplest that fits the moment.

  **Three ways to fill a timeline item** (priority order if multiple are set: `content` > `body`; pick ONE):

  1. **`body`** — plain text caption when the moment is a single sentence. Stick with this for simple "what happened" annotations.
     ```json
     { "time": "1996", "title": "Yahoo IPO", "body": "First-day market cap $849M" }
     ```
     Aliases are accepted when source material names fields differently: `year` behaves like `time`; `headline` or `name` behaves like `title`.

  2. **`content`** — embed ANY DomNode (any registered component or primitive) when the moment deserves more visual weight than a text caption. The renderer expands components recursively, so `metric-card`, `insight-card`, `image`, `quote`, `chart-card`, even a nested `stack` of multiple blocks all work inside a timeline item. Pass `content` for fundraising metrics, launch screenshots, key quotes, multi-bullet milestones — anything that would otherwise stretch `body` past one line. The optional `title` field still works alongside `content` as a sub-headline above the embedded card; usually omit `title` when the embedded card has its own headline (e.g. metric-card.label, insight-card.headline).

     Examples — one per common content type:
     ```json
     // Funding milestone — embed a metric-card
     { "time": "2024 Q3",
       "content": { "type": "metric-card", "value": "$15M", "label": "Series A raised" } }

     // Multi-point milestone — embed an insight-card with bullets
     { "time": "2025 Q1",
       "title": "Geographic expansion",
       "content": { "type": "insight-card", "headline": "Three new offices",
                    "bullets": ["Tokyo", "Singapore", "London"] } }

     // Memorable line — embed a quote
     { "time": "2026 Q2",
       "content": { "type": "quote", "text": "A defining moment.", "source": "CEO" } }

     // Hero moment — embed an image with caption
     { "time": "2025 Q4",
       "content": { "type": "image", "src": "/abs/path/launch.png", "caption": "Product 2.0 launch" } }

     // Compound moment — embed a stack of multiple blocks
     { "time": "2026 Q3",
       "content": { "type": "stack", "direction": "vertical", "gap": 0.2, "children": [
         { "type": "h2", "text": "Public listing" },
         { "type": "metric-card", "value": "$2.1B", "label": "Market cap day 1" }
       ]} }
     ```

  3. **`title` only** — a one-word headline for ultra-compact horizontal timelines (4-5 quarters in a row).
     ```json
     { "time": "Q1", "title": "Plan" }
     ```

  **Layout direction**:
   - `direction:"horizontal"` (default for short text items) — items packed side-by-side, each cell ~4cm wide. Use for ≤5 simple-text items. Rich `content` will be cramped here.
   - `direction:"vertical"` (recommended whenever any item has `content`) — each row is `[time-on-left 2.5cm | content-on-right ~12cm]`. Time labels align in a narrow left column, content fills the rest of the row at full row height. This is the standard timeline visual for milestones with cards.

  **Capacity limits**:
   - Horizontal: 5 simple-text items.
   - Vertical: 6 simple-text items, OR 3 metric-card items, OR 2-3 insight-card items. Beyond this, split into two timelines.

  kind=semantic parent=stack children=none type='timeline' required={items:array of {time/date/year:string}, where each item also has at least one of title/label/headline/name/body/content} optional={direction:enum[horizontal|vertical], orientation:enum[horizontal|vertical] (alias), per-item: title/label/headline/name, body/description (text), content (any DomNode — metric-card, insight-card, image, quote, chart-card, stack, etc.)}
- outline: Table of contents / agenda — vertical list of chapters with optional number + title + optional 1-line body + optional page reference. Use for cover-following TOC slides, talk agendas, chapter indexes. Distinct from numbered-grid (parallel modules in a grid) and timeline (date-ordered events) — outline is for linear reading-order chapters with editorial spacing. Density auto-adapts: 1-5 items show body comfortably, 6-9 items compact, 10-12 items hide body. **Numbering is NEVER auto-generated** — pass `number` per item if you want chapter labels (e.g. "01", "I", "Ch 1"). When at least one item supplies number, a number column is reserved across all rows so titles stay aligned. kind=semantic parent=stack children=none type='outline' required={items:array of {title:string, number?:string, body?:string, page?:string|number, tone?:enum[brand|positive|warning|danger]}} optional={showPages:boolean, density:enum[comfortable|compact|auto], tone:enum[brand|neutral]} example={"type":"outline","items":[{"number":"01","title":"Core Strategies","body":"Skim, scan, infer, eliminate"},{"number":"02","title":"Question Types","body":"Five major categories"},{"number":"03","title":"Worked Examples","body":"Two annotated passages"}]}
- numbered-grid: Designed set of ordered priorities, principles, or framework points. Use when each item is a peer module and the number itself communicates order. Supports subtle title-row markers so you do not need raw square shapes for decoration. kind=semantic parent=stack children=none type='numbered-grid' required={items:array of {title/label/name:string, body/description/text:string, marker?:markerSpec, tone?:enum[brand|positive|warning|danger|neutral]}} optional={columns:number, tone:enum[brand|neutral], marker:markerSpec, numberStyle:enum[chip|plain]} example={"type":"numbered-grid","marker":{"shape":"diamond","variant":"tint","tone":"brand","size":"sm"},"items":[{"title":"Principle","body":"Detail"}]}
- numbered-list: Ordered text list where sequence or priority matters but each item is still brief prose. Use numbered-grid when each item should become a designed module. kind=semantic parent=stack children=none type='numbered-list' required={items:array} optional={density:enum[comfortable|compact]} example={"type":"numbered-list","items":"items"}
- step-card: One discrete step or stage with a title and short detail. Use inside a larger sequence only when each step needs card-level detail; prefer process-flow for connected pipelines. Use marker for a small decorative cue beside the title; use icon only when a large symbolic shape is meaningful. kind=semantic parent=grid children=none type='step-card' required={title:string} optional={step:string, number:string, body:string, description:string, steps:array, marker:markerSpec, icon:shapePreset} example={"type":"step-card","step":"01","title":"Reset context","body":"Clear prior task style anchors.","marker":{"shape":"dot","tone":"brand","variant":"solid"}}
- axis-ruler: Ordered conceptual scale: eras, maturity stages, spectrum, or progression. Use when position along an axis is the meaning, not just a dated timeline. kind=semantic parent=stack children=none type='axis-ruler' required={items:array of {label/title/name:string, body/text/description:string}} optional={direction:enum[horizontal|vertical], tone:enum[brand|neutral|positive|warning|danger]} example={"type":"axis-ruler","items":[{"label":"Low","body":"Basic"}]}
- flow-arrow: Connector showing direction, transition, or causality between two modules. Use for one explicit relationship; use process-flow for multi-step sequences. kind=semantic parent=stack children=none type='flow-arrow' optional={label:string, tone:enum[brand|positive|warning|danger], direction:enum[right|down]} example={"type":"flow-arrow"}

## Evidence And Media

- image-card: Image as evidence or subject: product shot, screenshot, diagram, photo, or artifact with optional title/caption. Use when the visual must be inspected. Add insight/annotations/callouts when the viewer needs to know what to look at. kind=semantic parent=grid children=none type='image-card' required={src:image-ref} optional={alt:string, title:string, badge:string, insight:string, annotations:array, callouts:array, caption:string, fit:enum[cover|contain|fill], imageWidth:number, tone:enum[neutral|brand|tinted], variant:enum[card|frameless|compact], surface:object} example={"type":"image-card","src":"src","title":"Screenshot","badge":"Evidence","insight":"The error clusters around retrieval.","annotations":["Missing reset","Style carryover"]}
- quote: Verbatim or voice-like statement with optional attribution. Use when authority, emotion, or wording is the evidence. kind=semantic parent=stack children=none type='quote' required={text:string} optional={source:string} example={"type":"quote","text":"text"}
- source-note: Quiet source, citation, caveat, or disclaimer. Use for provenance and constraints, not for live-read content. kind=semantic parent=stack children=none type='source-note' required={text:string} optional={align:enum[left|center|right]} example={"type":"source-note","text":"Text"}
- legend: Color/category key for a chart, diagram, map, or coded table. Use when colors or symbols need semantic decoding. kind=semantic parent=stack children=none type='legend' required={items:array of {label:string, color:string}} optional={direction:enum[horizontal|vertical]} example={"type":"legend","items":[{"label":"A","color":"brand.primary"}]}

## Insight And Narrative

- key-takeaway: The slide's central conclusion or 'so what'. Use when the viewer should leave with one decision, implication, or verdict; one per slide. Supports rich detail runs and supporting bullets for conclusion pages. kind=semantic parent=stack children=none type='key-takeaway' required={headline:string or title:string} optional={detail:string, body:string, description:string, content:richTextRuns, bullets:array, tone:enum[brand|positive|warning|danger], variant:enum[panel|banner|minimal], density:enum[comfortable|compact], surface:object} example={"type":"key-takeaway","variant":"banner","headline":"Reset task context before each new deck","content":[{"text":"Style anchors must be explicit, ","marks":["bold"]},{"text":"not inherited from memory."}],"bullets":["Clear prior visual tokens","Restate audience and topic"]}
- takeaway-list: Multi-item Key Takeaways block. 3-5 short conclusions, each with an accent marker/bar + bold headline + optional 1-line detail. The right component for a wrap-up / summary slide where multiple parallel takeaways need to dominate the page; use key-takeaway when there is exactly one. `marker` replaces the default bar with controlled dot/ring/diamond/side-bar markers. kind=semantic parent=stack children=none type='takeaway-list' required={items:array of {headline:string, detail:string, tone:enum[brand|positive|warning|danger|neutral], marker?:markerSpec}} optional={tone:enum[brand|positive|warning|danger|neutral], marker:markerSpec} example={"type":"takeaway-list","marker":{"shape":"side-bar","variant":"solid","size":"md"},"items":[{"headline":"Skim before answering","detail":"Always preview structure first.","tone":"brand"},{"headline":"Eliminate wrong answers","detail":"Pattern: contradictory, too broad, unsupported.","tone":"positive"}]}
- executive-summary: FIRST CHOICE for a slide that answers the audience's main question: thesis + 2-4 findings + implication/action. Use for opening answer, management summary, closing synthesis, decision memo, or “what should we believe/do” pages. It creates a hierarchy; do not replace it with a grid of insight-cards. kind=semantic parent=stack children=none type='executive-summary' optional={thesis/headline/title:string, summary/body:string, findings/items:array of {headline/title,detail/body,tone}, implication:string, action:string, variant:enum[memo|board|compact], tone:enum[neutral|brand|positive|warning|danger]} example={"type":"executive-summary","thesis":"新 session 应清理旧任务决策，而不是普通压缩。","summary":"保留稳定事实，丢弃前一个 PPT 的视觉锚点。","findings":[{"headline":"风格隔离","detail":"颜色和版式不跨任务继承。","tone":"warning"},{"headline":"技能重载","detail":"新任务重新装载所需 skill。","tone":"positive"}],"implication":"这会降低不同任务之间的互相干扰。"}
- explanation-block: FIRST CHOICE for explanatory text: why/how/mechanism/cause/implication/concept. Use when the page needs one coherent explanation with optional support points, example, or note. This should replace “3-4 insight-cards that are really paragraphs.” kind=semantic parent=stack children=none type='explanation-block' optional={title/headline:string, body/detail/description:string, content:richTextRuns, bullets/items:array, example:string, note:string, variant:enum[plain|rail|panel], tone:enum[neutral|brand|positive|warning|danger], density:enum[comfortable|compact], surface:object} example={"type":"explanation-block","variant":"rail","title":"为什么会发生串扰","body":"旧任务的主题、视觉 token 和素材留在上下文里，会被误判为当前约束。","bullets":["区分事实记忆和任务决策","新任务重新加载 skill"]}
- comparison-list: FIRST CHOICE for lightweight text comparison: before/after, options, positions, trade-offs, causes, cases, or alternatives. Use when each item is short text and a full comparison-table is too heavy; use comparison-card only when each option deserves a full card with metrics/pros/cons. kind=semantic parent=stack children=none type='comparison-list' required={items:array of {title/name/label, body/description, points/items/bullets, badge, tone}} optional={title:string, basis:string, columns:number, variant:enum[plain|columns|subtle], density:enum[comfortable|compact]} example={"type":"comparison-list","basis":"两种处理方式","items":[{"title":"普通 compact","body":"压缩所有历史，旧决策仍可能残留。"},{"title":"session reset","body":"只保留跨任务稳定信息。","tone":"positive"}]}
- fact-list: FIRST CHOICE for evidence rows: facts, observations, claims, data snippets, examples, source-backed bullets, or “fact → interpretation” material. Use when each row is evidence plus meaning/source; use insight-card only after the fact has been synthesized into one curated finding. kind=semantic parent=stack children=none type='fact-list' required={items:array of {label/title/name, value, fact/text/body, interpretation/insight, source, tone}} optional={title:string, columns:number, variant:enum[list|grid|strip], tone:enum[neutral|brand|positive|warning|danger], density:enum[comfortable|compact]} example={"type":"fact-list","variant":"list","items":[{"label":"日志","fact":"第二个 PPT 沿用第一个 PPT 风格。","interpretation":"上下文边界没有显式重置。","tone":"warning"},{"label":"策略","fact":"skill 应在新 session 重新装载。","source":"Cowork session plan"}]}
- insight-card: One modular insight with badge/headline/detail/proof bullets. Use when there is one curated finding, recommendation, risk, or opportunity that can stand alone as a card in a peer set. It is NOT the default text container. Before choosing insight-card, check whether the content is actually an executive-summary, explanation-block, comparison-list, fact-list, key-takeaway, takeaway-list, chart-card, table-card, or evidence-layout. kind=semantic parent=grid children=none type='insight-card' required={headline:string or title:string} optional={badge:string, detail:string, body:string, description:string, bullets/items/points:array, tone:enum[neutral|brand|positive|warning|danger]} example={"type":"insight-card","headline":"Finding","bullets":["Proof"]}
- callout: Highlighted insight, warning, recommendation, or rule of thumb. Supports legacy single-line text and rich callouts with colored title, body, rich text runs, and bullets. Use sparingly: at most one primary callout on a slide, never as a grid filler or default paragraph container. Prefer key-takeaway for the slide verdict, lead for framing, quote for voice/evidence, annotation/callout-marker for labels, and insight-card only for a finding with proof. kind=semantic parent=stack children=none type='callout' required={text OR title/body/content/bullets} optional={title:string, body:string, content:richTextRuns, bullets:array, variant:enum[plain|card|banner], tone:enum[neutral|brand|positive|warning|danger]} example={"type":"callout","variant":"card","tone":"warning","title":"模型记忆会污染下一次任务","content":[{"text":"必须重置风格锚点，","marks":["bold"]},{"text":"否则新 PPT 会沿用旧视觉。"}],"bullets":["隔离任务上下文","显式记录本次主题"]}
- lead: Short thesis, framing sentence, or transition line that tells the viewer how to read the slide. kind=semantic parent=stack children=none type='lead' required={text:string} optional={align:enum[left|center|right]} example={"type":"lead","text":"Text"}
- h1: Primary in-content heading for a major module or section inside the slide body. kind=semantic parent=stack children=none type='h1' required={text:string} optional={align:enum[left|center|right]} example={"type":"h1","text":"Text"}
- h2: Secondary heading for a local group, card, panel, or evidence module. kind=semantic parent=stack children=none type='h2' required={text:string} optional={align:enum[left|center|right]} example={"type":"h2","text":"Text"}
- text: Plain body copy for residual explanation when no stronger semantic component fits. Prefer callout, quote, key-takeaway, bullets, or data components when possible. kind=semantic parent=stack children=none type='text' required={text:string} optional={align:enum[left|center|right]} example={"type":"text","text":"Text"}
- label: Short metadata label, tag, axis marker, or local caption. Use for naming parts of a visual, not for body prose. kind=semantic parent=stack children=none type='label' required={text:string} optional={align:enum[left|center|right], variant:enum[plain|badge|tag], tone:enum[neutral|brand|positive|warning|danger]} example={"type":"label","text":"Text"}
- definition-card: Term plus definition. Use for glossary, concept introduction, vocabulary, or clarifying a named framework element. kind=semantic parent=grid children=none type='definition-card' required={term:string, definition:string} example={"type":"definition-card","term":"term","definition":"definition"}
- glossary: Term + definition list — 6-15 terms in a single coherent layout. Different from definition-card (one card per term): glossary aligns terms uniformly without competing card chrome. Use for technical glossaries, vocabulary lists, framework concept indexes. kind=semantic parent=stack children=none type='glossary' required={items:array of {term:string, definition:string}} optional={layout:enum[list|two-column]} example={"type":"glossary","items":[{"term":"Skimming","definition":"Reading quickly to grasp the main idea"},{"term":"Scanning","definition":"Locating specific facts"},{"term":"Inference","definition":"Drawing conclusions not explicitly stated"}]}
- q-and-a: FAQ / interview / answer-page block. Multiple {question, answer} pairs stacked vertically with Q/A chips so the eye scans Q→A→Q→A. Use for FAQs, interview transcripts, classroom answer pages. Distinct from quiz-card (which is for testing readers with multiple-choice options) — q-and-a is read-only and does not expect the reader to select. Max 6 pairs per slide; split into two slides for longer FAQs. kind=semantic parent=stack children=none type='q-and-a' required={items:array of {q:string, a:string} (max 6)} optional={density:enum[comfortable|compact]} example={"type":"q-and-a","items":[{"q":"How long is the test?","a":"35 minutes for 2 passages."},{"q":"Can I skip questions?","a":"Yes, but flag them to revisit."}]}
- comparison-table: Multi-option comparison matrix — features as rows, options as columns, one option highlighted as RECOMMENDED. Distinct from table-card (no per-column emphasis) and comparison-card (a single-option card in a peer set). Cell values that read as ✓/✗/yes/no auto-render in success/danger color. kind=semantic parent=stack children=none type='comparison-table' required={features:array of strings, options:array of {name:string, values:array of strings, recommended?:boolean}} optional={title:string} example={"type":"comparison-table","features":["Pricing","Setup","Best for"],"options":[{"name":"Plan A","values":["$10/mo","5 min","Solo"]},{"name":"Plan B","values":["$30/mo","30 min","Team"],"recommended":true},{"name":"Plan C","values":["$100/mo","1 day","Enterprise"]}]}
- quiz-card: Question card — prompt + optional multi-line trailing content + optional correctness highlight + optional explanation. Flexible: works for MCQ (provide `items` + `correct` to get letter chips), short-answer hints (just `items`), T/F (`items:["True","False"], correct:"A"`), or just a prompt + `explanation`. When `correct` is supplied items render with letter chips A.. and the matching item is highlighted in success tone; otherwise items render with bullet dots. For SEPARATE question + answer pages, write the question slide without `correct` and use `insert_slide` to add an answer slide that supplies `correct` and `explanation`. kind=semantic parent=stack children=none type='quiz-card' required={question:string} optional={items:array of strings (max 6), correct:string letter "A".."F" or 0-based index, explanation:string, number:string, questionType:string, tone:enum[brand|neutral|tinted]} examples=[{"type":"quiz-card","number":"Q1","questionType":"Inference","question":"What can be inferred from paragraph 2?","items":["Sales doubled","Costs fell sharply","Mechanized production scaled","Workers stayed rural"],"correct":"C","explanation":"Paragraph 2 cites the introduction of steam-driven looms..."},{"type":"quiz-card","question":"True or False — silk was traded primarily for spices.","items":["True","False"],"correct":"B","explanation":"Silk was exchanged mainly for horses, glass, and silver — not spices."},{"type":"quiz-card","question":"What three skimming targets should you note?","items":["Topic sentence of each paragraph","Transition signals","Conclusion / verdict line"]}]
- article: Long-form article that automatically paginates across multiple slides. The renderer measures the typography of style:"article" against the available content area, splits paragraphs at safe boundaries, and emits one rendered slide per page (titled "{Title} (1/N)", "{Title} (2/N)", ...). Use for reading passages, magazine prose, case studies, transcripts, or any single body of text that exceeds one slide. Do not wrap a body in `paragraph` + `text` blocks just to fit — let the article flow. kind=semantic parent=stack children=none type='article' required={text:string OR paragraphs:array} optional={title:string (falls back to slide title), source:string (rendered on the last page)} example={"type":"article","title":"Reading Passage","paragraphs":["Paragraph one...","Paragraph two..."],"source":"Adapted from ETS sample"}
- code: Preformatted code or command excerpt where syntax and monospace alignment are the content. Use for code samples, shell commands, JSON snippets, or anything that should render in a monospace font. kind=semantic parent=stack children=none type='code' required={text:string} optional={align:enum[left|center|right], title:string, language:string} example={"type":"code","language":"ts","text":"const sum = (a: number, b: number) => a + b;"}
- deck-title: Deck-level title for covers and section openers. Use when the title itself is the dominant semantic object, not for normal slide headings (use slide.title or h1/h2 for those). kind=semantic parent=stack children=none type='deck-title' required={text:string} optional={align:enum[left|center|right]} example={"type":"deck-title","text":"Cover Title"}
- slide-title: Canonical title slot for ordinary content slides. Almost never authored directly — set `slide.title` instead so the renderer can place the title in its dedicated rect. Only use this when overriding placement for a specific decorative composition. kind=semantic parent=stack children=none type='slide-title' required={text:string} optional={align:enum[left|center|right]} example={"type":"slide-title","text":"Slide Title"}

## Data Visualization

- scorecard: Status-coded metric grid. Each item carries label + value + status (good/warning/danger/neutral) + optional delta + trend arrow. Use for project status, health checks, ops dashboards. Different from metric-card / kpi-grid which have no health/status semantics. kind=semantic parent=stack children=none type='scorecard' required={items:array of {label:string, value:string, status?:enum[good|warning|danger|neutral], delta?:string, trend?:enum[up|down|flat]}} optional={columns:number} example={"type":"scorecard","items":[{"label":"Revenue","value":"$4.2M","status":"good","delta":"+12%","trend":"up"},{"label":"Latency","value":"920ms","status":"danger","delta":"+120","trend":"up"}]}
- funnel: Conversion funnel — sales pipeline, signup → activation → paid funnel, traffic stages. Each stage is a chevron sized by value; drop% vs previous stage shown. kind=semantic parent=stack children=none type='funnel' required={stages:array of {label:string, value:number, valueLabel?:string, tone?:enum[brand|positive|warning|danger]} (max 6)} optional={showDrop:boolean (default true)} example={"type":"funnel","stages":[{"label":"Visitors","value":100000},{"label":"Sign-ups","value":12000},{"label":"Activated","value":4500},{"label":"Paid","value":380}]}
- gauge: Single-value progress dial with threshold-banded track. Use for NPS, CSAT, target completion. Different from progress-bar (no threshold zones). kind=semantic parent=stack children=none type='gauge' required={value:number, label:string} optional={max:number (default 100), unit:string, thresholds:array of {upTo:number, tone:enum[danger|warning|positive|brand], label?:string}} example={"type":"gauge","value":72,"max":100,"label":"NPS","unit":"","thresholds":[{"upTo":30,"tone":"danger"},{"upTo":70,"tone":"warning"},{"upTo":100,"tone":"positive"}]}
- heatmap: NxM matrix of cells colored by value with linear interpolation. Use for time × category, A/B test matrices, activity patterns. Max 12×12. kind=semantic parent=stack children=none type='heatmap' required={xLabels:array of string, yLabels:array of string, values:number matrix [yLabels.length][xLabels.length]} optional={palette:enum[warm|cool|diverging] (default cool), showValues:boolean} example={"type":"heatmap","xLabels":["Mon","Tue","Wed","Thu","Fri"],"yLabels":["6am","12pm","6pm"],"values":[[1,2,3,2,1],[3,5,7,5,2],[4,6,8,6,2]],"palette":"warm"}
- matrix-2x2: 2×2 quadrant matrix with labeled axes and items placed in quadrants. Use for impact × probability, effort × value, Boston matrix. Different from swot-matrix which has fixed S/W/O/T semantics. kind=semantic parent=stack children=none type='matrix-2x2' required={xAxis:object {low,high}, yAxis:object {low,high}, items:array of {label:string, x:enum[low|high], y:enum[low|high], tone?}} optional={quadrantLabels:object {tl?,tr?,bl?,br?}} example={"type":"matrix-2x2","xAxis":{"low":"Low Effort","high":"High Effort"},"yAxis":{"low":"Low Value","high":"High Value"},"quadrantLabels":{"tl":"Quick Wins","tr":"Big Bets","bl":"Skip","br":"Time Sinks"},"items":[{"label":"Auth fix","x":"low","y":"high","tone":"positive"},{"label":"Refactor logging","x":"high","y":"low","tone":"danger"}]}
- trend-line: Mini sparkline visualization (bars whose height reflects values). Use as decoration next to a metric or under a heading. Different from chart-card (full chart with axes/legend). kind=semantic parent=stack children=none type='trend-line' required={values:array of number (max 24)} optional={tone:enum[brand|positive|warning|danger], height:number (cm)} example={"type":"trend-line","values":[12,14,13,18,22,28,26,31,35,33,41,48],"tone":"positive"}
- stat-flow: Horizontal sequence of stat blocks connected by operator/connector text. Use for unit economics derivation (CAC × period → LTV), formula walkthroughs, KPI cause-effect chains. kind=semantic parent=stack children=none type='stat-flow' required={steps:array of either {value,label,tone?} OR {connector:string} (max 10). Connectors are operator strings like "×", "÷ 24m", "→"} example={"type":"stat-flow","steps":[{"value":"$120","label":"CAC","tone":"warning"},{"connector":"÷ 24m"},{"value":"$5/mo","label":"Recovery"},{"connector":"→"},{"value":"$200","label":"LTV","tone":"positive"}]}
- donut-summary: Primary share + remainder legend. Use for "X% from Y" stories where one share dominates. Different from chart-card pie (no primary emphasis). kind=semantic parent=stack children=none type='donut-summary' required={primary:object {label,value}} optional={others:array of {label,value}, unit:string, tone:enum[brand|positive|warning|danger]} example={"type":"donut-summary","primary":{"label":"Direct","value":62},"others":[{"label":"Search","value":23},{"label":"Social","value":15}],"unit":"of traffic"}
- range-plot: Horizontal range bars showing min..max (and optional point) per category. Use for salary bands, confidence intervals, price ranges. kind=semantic parent=stack children=none type='range-plot' required={items:array of {label:string, min:number, max:number, point?:number, unit?:string}} optional={tone:enum[brand|positive|warning|danger]} example={"type":"range-plot","items":[{"label":"Junior","min":80,"max":110,"point":95,"unit":"k"},{"label":"Senior","min":140,"max":200,"point":170,"unit":"k"}]}
- factorial-matrix: Labeled 2D matrix for experiment factors, scenarios, capabilities, or model comparisons. Use when rows and columns both carry meaning. kind=semantic parent=stack children=none type='factorial-matrix' required={rows:array, columns:array, cells:2D array of string or {text,tone}} optional={title:string} example={"type":"factorial-matrix","title":"2×2 条件","rows":["记忆开","记忆关"],"columns":["旧任务","新任务"],"cells":[[{"text":"污染","tone":"danger"},{"text":"继承","tone":"warning"}],[{"text":"干净","tone":"positive"},{"text":"稳定","tone":"positive"}]]}
- probe-flow: Experiment/probe walkthrough: prompt/input → model/agent step(s) → observation/output. Use for evaluation methods, user-study protocols, and technical walkthroughs. kind=semantic parent=stack children=none type='probe-flow' required={steps:array of {title,body?}} optional={items:array alias, direction:enum[horizontal|vertical]} example={"type":"probe-flow","steps":[{"title":"输入","body":"新主题 brief"},{"title":"执行","body":"生成 deck"},{"title":"检查","body":"比对风格残留"}]}
- failure-taxonomy: Horizontal set of failure categories with rate chips and examples. Use for error analysis, evaluation results, risk taxonomies, or postmortems. kind=semantic parent=stack children=none type='failure-taxonomy' required={items:array of {title/name, rate/value?, examples?/bullets?, body?}} optional={columns:number, tone:enum[brand|warning|danger|neutral]} example={"type":"failure-taxonomy","items":[{"title":"风格串扰","rate":"42%","examples":["颜色沿用","版式沿用"]},{"title":"主题偏移","rate":"18%","examples":["术语残留"]}]}
- main-effect-comparison: Main-effect summary with compact before/after values and an interpretation strip. Use for experimental result pages where one effect dominates and must be interpreted. kind=semantic parent=stack children=none type='main-effect-comparison' required={beforeLabel:string,beforeValue:string,afterLabel:string,afterValue:string} optional={title:string, insight:string, trend:enum[up|down|flat], deltaLabel:string} example={"type":"main-effect-comparison","beforeLabel":"隔离前","beforeValue":"42%","afterLabel":"隔离后","afterValue":"8%","trend":"down","insight":"任务隔离显著降低风格串扰。"}

## Decoration

`markerSpec` is the safe way to add small item decoration without creating raw stretched rectangles. Use it on `feature-card`, `step-card`, `numbered-grid`, and `takeaway-list`, or as a primitive shape with `role:"item-marker"`.

```json
{ "marker": { "shape": "dot|ring|square|rounded-square|diamond|side-bar|slash|index-chip", "variant": "tint|solid|outline|ghost|ring|badge", "tone": "brand|positive|warning|danger|neutral", "size": "xs|sm|md|lg|xl" } }
```

Primitive escape hatch:

```json
{ "id": "s.item.marker", "type": "shape", "role": "item-marker", "marker": { "shape": "diamond", "variant": "tint", "tone": "brand", "size": "sm" } }
```

Prefer component `marker` fields for list/card item decoration. Use raw `shape` only for purposeful geometry, arrows, masks, or anchored composition.

- callout-marker: Anchored bubble with text — floats over slide content via anchor positioning. Use to point at a region of an image, chart, or hero element. Different from annotation (inline label, no anchor). kind=semantic parent=stack children=none type='callout-marker' required={text:string} optional={anchor:enum[top-left|top-center|top-right|middle-left|middle-center|middle-right|bottom-left|bottom-center|bottom-right] (default top-right), tone:enum[brand|positive|warning|danger|neutral], width:number, height:number} example={"type":"callout-marker","text":"Q3 inflection","anchor":"top-right","tone":"warning"}
- decoration-grid: Geometric pattern background (dots, diagonals, grid lines). Use for cover slide texture, section-break decoration, empty-area visual interest. Defaults to slide-spanning background overlay, so it does not consume content layout space; set asBackground:false only when intentionally embedding inline. kind=semantic parent=stack children=none type='decoration-grid' optional={pattern:enum[dots|diagonal-lines|grid] (default dots), density:enum[sparse|normal|dense], tone:enum[muted|brand], rows:number, columns:number, asBackground:boolean (default true)} example={"type":"decoration-grid","pattern":"dots","density":"sparse","tone":"muted"}
- decorative-shapes: Anchored vector motif cluster for decorative atmosphere: bubbles, confetti, corner blobs, sparkles, or molecule-like marks. Use for background texture, corner ornaments, scientific/tech visual atmosphere, or empty-area decoration without generating an image. Different from decoration-grid, which is a regular repeated pattern. kind=semantic parent=stack children=none type='decorative-shapes' optional={motif:enum[bubbles|confetti|corner-blobs|sparkles|molecule] (default bubbles), position:enum[top-left|top-right|bottom-left|bottom-right|full] (default top-right), tone:enum[muted|brand|accent|warning], count:number, width:number, height:number, asBackground:boolean (default true)} example={"type":"decorative-shapes","motif":"molecule","position":"top-right","tone":"muted","count":14}
- corner-mark: Small ribbon/stamp/tag in a slide corner — DRAFT, CONFIDENTIAL, V2.0 markers. Anchored to corner. kind=semantic parent=stack children=none type='corner-mark' required={text:string} optional={corner:enum[top-left|top-right|bottom-left|bottom-right] (default top-right), tone:enum[brand|warning|danger|neutral], style:enum[ribbon|stamp|tag]} example={"type":"corner-mark","text":"DRAFT","corner":"top-right","tone":"warning","style":"tag"}
- bracket: Geometric brace/bracket emphasizing a group of elements. Renders a thin shape on one side with optional label. kind=semantic parent=stack children=none type='bracket' optional={direction:enum[left|right|top|bottom] (default left), label:string, tone:enum[brand|positive|warning|danger]} example={"type":"bracket","direction":"left","label":"Core strategies","tone":"brand"}
- arrow-link: Single directional connector with optional from/to labels and middle text. MVP is inline horizontal/vertical only. kind=semantic parent=stack children=none type='arrow-link' optional={fromLabel:string, toLabel:string, label:string, direction:enum[right|down] (default right), tone:enum[brand|positive|warning|danger]} example={"type":"arrow-link","fromLabel":"Step A","toLabel":"Step B","label":"depends on","tone":"brand"}
- pointer-arrow: Anchored overlay arrow that points at a specific region of an image, chart, diagram, screenshot, or highlighted object. Use for visual annotation arrows; use arrow-link for inline process connectors. kind=semantic parent=stack children=none type='pointer-arrow' optional={label:string, direction:enum[right|left|down|up] (default right), anchor:enum[top-left|top-center|top-right|middle-left|middle-center|middle-right|bottom-left|bottom-center|bottom-right], offsetX:number, offsetY:number, width:number, height:number, tone:enum[brand|positive|warning|danger], style:enum[solid|dashed]} example={"type":"pointer-arrow","label":"关键变化","direction":"left","anchor":"middle-right","offsetX":0.6,"tone":"warning"}
- watermark: Large semi-transparent decorative text overlay (DRAFT, CONFIDENTIAL, SAMPLE). Anchored to slide center. kind=semantic parent=stack children=none type='watermark' required={text:string} optional={rotation:number, tone:enum[muted|danger|warning|brand] (default muted)} example={"type":"watermark","text":"CONFIDENTIAL","tone":"danger"}
- big-page-number: Large decorative page number for cover/section slides. Different from chrome.pageNumber (small footer). Use as visual marker on chapter openers. kind=semantic parent=stack children=none type='big-page-number' required={current:string|number} optional={total:string|number, position:enum[top-left|top-right|bottom-left|bottom-right] (default top-right), tone:enum[brand|muted]} example={"type":"big-page-number","current":5,"total":22,"position":"top-right","tone":"brand"}
- timeline-axis-bar: Section navigation bar — N section dots with current section highlighted. Use at top of section break slides to communicate progress through deck. kind=semantic parent=stack children=none type='timeline-axis-bar' required={sections:array of string (max 8), current:number (0-based)} optional={tone:enum[brand|neutral]} example={"type":"timeline-axis-bar","sections":["Intro","Strategy","Examples","Q&A","Wrap-up"],"current":2}
- scale-bar: Horizontal numeric scale with tick marks. Companion to images/charts/diagrams when measurement context matters. kind=semantic parent=stack children=none type='scale-bar' required={max:number} optional={min:number (default 0), unit:string, ticks:number (default 5), tone:enum[brand|neutral]} example={"type":"scale-bar","min":0,"max":100,"unit":"%","ticks":5}

## Product, Identity, And Markers

- feature-card: One feature, capability, benefit, or ingredient of an offer. Use for modular value propositions, not for arbitrary bullet paragraphs. Can include badge, rich body, tags, proof metric, source/proof line, and compact CTA. Use marker for a subtle title cue; use icon only when a larger symbol is part of the story. kind=semantic parent=grid children=none type='feature-card' required={title:string} optional={icon:enum[rect|roundRect|ellipse|triangle|rightTriangle|pentagon|diamond], marker:markerSpec, body:string, content:richTextRuns, badge:string, tags:array, metric:object, proof:string, ctaText:string, iconColor:string, iconBackground:string, tone:string, variant:enum[plain|card|compact], density:enum[comfortable|compact], surface:object} example={"type":"feature-card","variant":"card","marker":{"shape":"rounded-square","variant":"tint","tone":"brand","size":"sm"},"badge":"Core","title":"Task isolation","content":[{"text":"Resets style memory","marks":["bold"]},{"text":" before authoring."}],"metric":{"value":"-68%","label":"carryover","tone":"positive"},"tags":["memory","style"]}
- logo-strip: Set of logos representing customers, partners, integrations, sponsors, or tools. Use when recognition and affiliation are the evidence. kind=semantic parent=stack children=none type='logo-strip' required={logos:array of {src:string, alt:string} or items/images} optional={columns:number, caption:string} example={"type":"logo-strip","logos":[{"src":"/path/logo.png","alt":"Logo"}]}
- tag-list: Set of short keywords, categories, feature flags, or filters. Use for compact classification; not for sentences or long labels. kind=semantic parent=stack children=none type='tag-list' required={items:array} optional={tone:enum[neutral|brand|positive|warning|danger]} example={"type":"tag-list","items":"items"}
- badge: Single short status/category marker such as NEW, RISK, BETA, or DRAFT. Use as metadata on another module; use tag-list for multiple chips. kind=semantic parent=stack children=none type='badge' required={text:string} optional={tone:enum[brand|positive|warning|danger|neutral]} example={"type":"badge","text":"text"}
- icon-text: Icon plus short label for compact feature/status/category cues. Use as a small semantic marker, not as a substitute for rich explanation. kind=semantic parent=stack children=none type='icon-text' required={icon:enum[rect|roundRect|ellipse|triangle|rightTriangle|pentagon|diamond], text:string} optional={iconColor:string, iconBackground:string, tone:string} example={"type":"icon-text","icon":"diamond","text":"Signal"}
- section-break: Full-slide chapter marker or cover-like transition. Use to reset the audience's mental context, not for ordinary content slides. kind=semantic parent=stack children=none type='section-break' required={title:string} optional={subtitle:string, accent:string} example={"type":"section-break","title":"title"}
- checklist: Status list with checked/unchecked/warning states. Use for requirements, audit, readiness, QA, or feature parity where completion state matters. kind=semantic parent=stack children=none type='checklist' required={items:array} example={"type":"checklist","items":"items"}
- profile-card: Person or role profile with photo, name, role, and short bio. Use when identity / authorship / ownership / speaker is the content (team slides, attribution, expert panel). kind=semantic parent=grid children=none type='profile-card' optional={image:image-ref, name:string, role:string, bio:string} example={"type":"profile-card","image":"/abs/path/headshot.png","name":"Jane Wu","role":"Head of Research","bio":"Twelve years in supply-chain analytics."}
- cta: Explicit next action, request, or decision button. Use when the slide asks the viewer to do something specific — schedule, sign up, vote, reply. Keep one CTA per slide. kind=semantic parent=stack children=none type='cta' optional={text:string, tone:enum[brand|neutral|positive|warning|danger], link:string} example={"type":"cta","text":"Schedule a follow-up","tone":"brand"}
- title-lockup: Integrated editorial title group: eyebrow + dominant title + subtitle + optional accent rule. Use for covers, section openers, and poster-style slide openings instead of stacking three separate text nodes. kind=semantic parent=stack children=none type='title-lockup' optional={title:string, eyebrow:string, subtitle:string, align:enum[left|center|right], tone:enum[brand|inverse|neutral|positive|warning|danger], rule:boolean} example={"type":"title-lockup","eyebrow":"CHAPTER 02","title":"The Industrial Revolution","subtitle":"Factory production at scale","rule":true}
- eyebrow: Small kicker that classifies the next headline by topic, chapter, or frame ("SECTION 03", "FY26 PLAN"). Use to create editorial hierarchy without badge/card chrome; pairs naturally above an h1/section-title. kind=semantic parent=stack children=none type='eyebrow' optional={text:string, tone:enum[brand|inverse|neutral|positive|warning|danger], rule:boolean} example={"type":"eyebrow","text":"SECTION 03","rule":true}
- accent-rule: Purposeful visual spine, underline, or separator that anchors a hierarchy (under a title, between two regions, beside a side-rail). Use only when the rule carries structure or pacing — not as decoration. `length` is cm; `thickness` is stroke thickness, so use 1 for a normal 1pt rule and 2-3 for a stronger rule. kind=semantic parent=stack children=none type='accent-rule' optional={direction:enum[horizontal|vertical], tone:enum[brand|inverse|neutral|positive|warning|danger], length:number, thickness:number} example={"type":"accent-rule","direction":"horizontal","tone":"brand","length":4.0,"thickness":1}
- annotation: Compact label plus optional one-sentence note attached to a chart, image, diagram, or hero object. Use for local explanation of a visual feature ("Q3 inflection point", "Outlier"), not for body copy. kind=semantic parent=stack children=none type='annotation' optional={label:string, text:string, tone:enum[brand|inverse|neutral|positive|warning|danger]} example={"type":"annotation","label":"Q3 inflection","text":"New SKU ship date drove the jump.","tone":"brand"}
- side-rail: Narrow contextual rail beside the main content for chapter label, lens, constraints, or interpretation. Place inside split/grid to create asymmetry and reading frame; left/top accent rule reinforces "this is meta-content next to the main module". kind=semantic parent=grid children=optional type='side-rail' optional={title:string, body:string, tone:enum[brand|neutral|positive|warning|danger|tinted], accent:enum[left|top]} example={"type":"side-rail","title":"Reader's lens","body":"Read with attention to causal chain.","tone":"tinted","accent":"left"}
