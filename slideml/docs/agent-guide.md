---
name: slideml
description: "Generate PowerPoint decks (.pptx) via SlideML — a typed, theme-driven YAML language with built-in layouts (cover, agenda, stat-grid-3, chart-with-takeaway, data-table, code-block, compare-two-columns, process-timeline, image-grid-2x2, hero-image-overlay, quote, closing, …). PREFERRED over hand-rolled pptxgenjs for any deck. Trigger whenever the user asks for a slide deck, presentation, PPT, pitch deck, quarterly review, market analysis, or any .pptx output."
license: MIT
---

# SlideML Skill

## When to use this skill

The user asks for any slide-deck deliverable: PPT, presentation, pitch
deck, quarterly review, market analysis, post-mortem, status report.
**Default to SlideML.** Only fall back to `run_node` + `pptxgenjs` if no
built-in SlideML layout fits the use case (rare — the registry has
16 layouts and grows over time).

## Workflow

```text
list_slide_layouts (theme: "technical-blue")
       ↓
[ pick layouts per slide ]
       ↓
write SlideML YAML
       ↓
render_slideml(slideml: yaml, theme: "...", output_path: "/Users/.../deck.pptx")
       ↓
[ on validation error: error names the offending slot, fix YAML, retry ]
```

## Hard rules

1. **Always call `list_slide_layouts` first** so you see the slot schema
   for each available layout. Don't guess slot names.
2. **Never put coordinates, hex colors, or font sizes in the YAML.** The
   theme owns visual design. Your YAML is content + structure only.
3. **Match each layout's slot schema exactly.** `bullets` slots have
   `min`/`max`/`itemMaxChars` constraints — respect them. `text` slots
   have `maxChars`. Validation failures point at the offending slot.
4. **Speaker notes go in `notes:`** at the slide level (not inside `slots`).
5. **For Chinese decks set `deck.language: zh-CN`** — drives the CJK font
   fallback chain (PingFang SC → Microsoft YaHei → Source Han / Noto).

## SlideML grammar (v1)

```yaml
slideml: 1
deck:
  size: 16x9            # 16x9 | 16x10 | 4x3 | wide
  language: zh-CN       # BCP-47; CJK languages get the CJK font stack
  theme: technical-blue
slides:
  - layout: <name>      # one of the names returned by list_slide_layouts
    chrome: default     # default (page-number + brand-bar) | none
    notes: |            # optional speaker notes (text only)
      ...
    transition: none    # none | fade
    slots:              # per-layout schema; see list_slide_layouts
      title: "..."
      items: [...]
```

## Slot value vocabulary (8 frozen types)

| Type | Shape |
|---|---|
| `text(maxChars)` | single-line string |
| `text-block(maxChars)` | multi-line string; blank lines = paragraph break |
| `markdown-inline(maxChars)` | `**bold**`, `*italic*`, `` `code` `` only |
| `bullets(min, max, itemMaxChars)` | array of strings or layout-defined objects |
| `image-ref` | `{ src, alt?, fit? }` — src is path/URL/data URL |
| `chart-spec` | `{ type: bar\|stacked-bar\|line\|area\|pie\|doughnut, data: { labels, series }, format: { y: int\|decimal\|percent\|wanyuan\|yi }, title? }` |
| `table` | `{ header: string[], rows: string[][], colWidths?: number[] }` |
| `component-ref` | `{ name, slots }` — instance of a theme component |

## Two example decks

### English: 5-slide product update

```yaml
slideml: 1
deck:
  size: 16x9
  language: en-US
  theme: technical-blue
slides:
  - layout: cover
    chrome: none
    slots:
      eyebrow: "Q1 product update"
      title: "Reliability shipped, ARPU up"
      subtitle: "Engineering · 2026"
  - layout: stat-grid-3
    slots:
      title: "Quarter at a glance"
      items:
        - { value: "99.95%", label: "Availability", delta: "+0.04%", trend: up }
        - { value: "120ms",  label: "P99 latency",  delta: "-32%",   trend: up }
        - { value: "1.4×",   label: "ARPU",         delta: "+0.2",   trend: up }
  - layout: chart-with-takeaway
    slots:
      title: "Latency over the quarter"
      chart:
        type: line
        data:
          labels: ["Wk1","Wk2","Wk3","Wk4","Wk5","Wk6"]
          series: [{ name: "P99 ms", values: [180, 165, 142, 138, 128, 120] }]
        format: { y: int }
      takeaway: "**Steady drop** through engineering investments."
  - layout: bullet-with-image
    slots:
      title: "What we shipped"
      bullets:
        - "Connection multiplexing on the gateway"
        - "Hot-cache warming on rollouts"
        - "Adaptive backpressure on tail-latency events"
        - "Per-tenant rate-limit isolation"
      image: { src: "/path/to/architecture.png", alt: "architecture" }
  - layout: closing
    chrome: none
    slots:
      title: "Q&A"
      subtitle: "Thanks"
```

### 中文：3 页市场分析

```yaml
slideml: 1
deck:
  size: 16x9
  language: zh-CN
  theme: technical-blue
slides:
  - layout: cover
    chrome: none
    slots:
      eyebrow: "市场报告 · 2026 Q1"
      title: "同传市场格局分析"
      subtitle: "AI 与传统服务的拐点已到"
  - layout: chart-with-takeaway
    slots:
      title: "各赛道收入"
      chart:
        type: bar
        data:
          labels: ["AI 同传","人工同传","字幕生成","翻译记忆"]
          series: [{ name: "Q1 收入", values: [3200, 1800, 920, 650] }]
        format: { y: wanyuan }
      takeaway: "**AI 同传**超过传统人工同传 *1.7×*。"
  - layout: closing
    chrome: none
    slots:
      title: "感谢聆听"
```

## Common pitfalls

- **Putting hex colors in slots** → rejected by validator. Use theme tokens.
- **Bullets with too many items** → check the layout's `max` (most are 3–6).
- **Long titles** → check `maxChars` (cover ≤60, section-divider ≤50, etc.).
- **Forgetting `slideml: 1`** → top-level version key is required.
- **Putting raw markdown in `text` slots** → only `markdown-inline` slots
  parse `**bold**` etc. `text` and `text-block` are plain.
