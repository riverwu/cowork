# SlideML2 Roadmap

基于对 `slideml2/src/` 的当前实现 review，本 roadmap 聚焦两类问题：

- **A 类：规范化与接口扩展**。让已经存在的能力形成稳定契约，并继续给 agent 更高的排版、布局和风格调整自由。
- **B 类：商业 / 科研关键能力补齐**。让 SlideML2 能稳定覆盖咨询、经营分析、投研、实验报告、学术汇报等用途。

优先级：P0 = 近期必须做，P1 = 高价值增强，P2 = 长期能力。

---

## 当前状态摘要

SlideML2 已经具备一套不错的 agent-facing 基础：

- 语义组件库比较丰富，覆盖 KPI、callout、timeline、process-flow、chart-card、table-card、evidence-layout、cover-composition 等常见商业页面。
- 低层 DOM 支持 `stack` / `grid` / `split` / `panel` / `card` / `band` / `frame` / `inset`，并有 `anchor`、`anchorTo`、`at`、`zIndex`、`layer` 等自由排版逃生口。
- 主题系统支持嵌套/扁平 color override、tone override、字体链、OpenType feature、sizeScale、chrome、guidance。
- 渲染层已支持渐变背景、图片背景、图片 crop/clip/overlay/shadow/duotone、shape opacity/dash、notes、chart/table 原生 OOXML、布局诊断和低对比度修复。

主要问题不是“完全没能力”，而是三类不一致：

1. **契约分裂**：`types.ts`、`node-types.ts`、`SPEC.md`、`component-registry.ts`、`validate.ts` 对同一能力的描述不同步。例如 emitter 支持 `16x10` / `4x3` / `wide`，source validation 仍只允许 `16x9`；`AgentSurface` 有统一入口，但 primitive/component/theme 的 surface 字段不完全一致。
2. **能力只在组件内存在**：很多商业图形组件是手写组合节点，但缺少统一的数据模型、绑定层、注释锚点和可复用图形 grammar。
3. **科研/商业硬需求缺口明显**：公式、引用、参考文献、数据绑定、高级统计图、条件格式表格、模板母版、PDF/PNG 导出仍缺。

---

## A. 接口规范化 / 扩展

### A1. Schema 单一事实源（P0）

**现状**

- `types.ts` 是 TypeScript 类型源，`node-types.ts` 是 agent disclosure，`component-registry.ts` 是组件 disclosure 和 expansion，`validate.ts` 是实际 gate，`SPEC.md` 是人工文档。
- 这些文件经常出现能力漂移：字段已实现但 disclosure 不完整，或者 roadmap/spec 仍记录已完成事项。

**目标**

建立一个可生成 disclosure、validator 规则和文档片段的 schema registry，减少手动同步。

**改动落点**

- 新增 `src/schema/`：
  - `primitive-schema.ts`：primitive node fields、单位、默认值、validate policy。
  - `component-schema.ts`：组件字段、别名、required、examples。
  - `theme-schema.ts`：themeOverride fields、token categories。
- `node-types.ts` 和 `component-registry.ts` 的 disclosure 从 schema 生成，保留 expansion 实现。
- `validate.ts` 使用 schema 的 field allowlist，避免单独维护 `THEME_*_KEYS` 与 node field 集合。
- `SPEC.md` 的字段表改为 generated section 或至少由脚本校验。

**验收**

- 新增 `schema-sync.test.ts`：任一 documented field 必须能被 validator 接受；任一 validator allowlist 字段必须出现在 disclosure 或明确标记 internal。
- `pnpm --dir slideml2 test` 通过，旧 deck zero-diff。

### A2. Layout Areas 与画布尺寸统一（P0）

**现状**

- `DeckAst` 和单位表支持 `16x9 | 16x10 | 4x3 | wide`，但 source validation 只允许 `deck.size:"16x9"`。
- `area` 基本只有 `"content"` / `"full"`，更多版式区域需要手写 `anchor` / `at`。
- 主题 layout 只有一组 title/content/footer 坐标，不适合商业模板中的左 rail、右 insight rail、chart zone、evidence strip。

**目标**

把 deck size 和 named areas 变成正式 authoring contract。

**改动落点**

- `SlideSize` 扩展为 `"16x9" | "16x10" | "4x3" | "wide"`，并让 `validateDeck` 与 `renderToAst` 不再硬编码 `16x9`。
- `ThemeOverride.layout.areas?: Record<string, { x, y, w, h } | { left, top, right, bottom }>`。
- primitive `area` 接受 `"content" | "full" | string`，`rectForTopLevelNode` 先查 named area。
- `SPEC.md` 明确 `contentTop/contentBottom` 仍为 y 坐标，named areas 使用 cm。

**验收**

- 4:3、16:10、wide 三个 source deck 能 validate + render。
- `area:"left-rail"`、`area:"chart-main"` 在示例 deck 中稳定定位。

### A3. Surface / Style Override 合约收敛（P0）

**现状**

- `AgentSurface` 是组件统一入口，支持 fill/border/padding/elevation/accent。
- primitive shape/image/text/panel/card 又各自有 `fill`、`line`、`border`、`opacity`、`dash`、`shadow` 等字段。
- theme component style 只允许 `{ fill,line,accent,padding,cornerRadius,elevation }`，表达不了 opacity、dash、shadow tuning、gradient。

**目标**

形成统一 `SurfaceSpec`，让 agent 能在任意组件/primitive 上用同一套字段调整风格。

**改动落点**

- 新增 `SurfaceSpec`：
  - `fill`, `fillOpacity`, `line`, `lineOpacity`, `lineWidth`, `lineDash`
  - `cornerRadius`
  - `shadow?: { color?, alpha?, blur?, dx?, dy? }`
  - `gradient?: { kind?, angle?, stops }`
  - `accent?: { side, color?, width? }`
- `AgentSurface`、primitive panel/card/band/frame/text/shape、`ThemeOverride.component.*` 全部映射到 `SurfaceSpec`。
- `applyAgentSurface()` 扩展并成为唯一 surface merge helper。
- validator 对旧字段保留 alias，但 warning 推荐 `surface:{...}`。

**验收**

- `surface` 同时作用于 `metric-card`、`chart-card`、primitive `card`、`text` chip。
- opacity、dash、shadow、gradient 在 PPTX XML 中可见。

### A4. Rich Text / Inline Run 类型化（P0）

**现状**

- `RichTextRun` 已支持 marks、link、highlight、baseline、tracking、emphasis、font role。
- 但它仍是 text-only run；公式、引用、变量、inline icon、small badge 无法作为 run 类型出现。

**目标**

把 inline content 从“字符串 run + marks”升级为 discriminated union。

**改动落点**

- `RichInline`：
  - `{ kind:"text", text, marks?, ... }`
  - `{ kind:"math", latex }`
  - `{ kind:"cite", refId, style? }`
  - `{ kind:"icon", src | marker, alt? }`
  - `{ kind:"token", value, tone?, format? }`
- `textShape` / `table` run conversion 支持 union。
- markdown parser 先只继续输出 text run；math/cite 由显式 JSON 字段触发。

**验收**

- text、table cell、callout body 都可混用 citation/math/token。
- 旧 `RichTextRun[]` 自动升级为 `{kind:"text"}`，旧 deck zero-diff。

### A5. Layout Grammar 增强（P1）

**现状**

- `split` 已支持多 child + ratio，并通过 lowering 到 stack 实现。
- `grid` 有 `columnWeights`、`rowWeights`、`colSpan`、`rowSpan`，但缺少显式 placement。
- 复杂 editorial layouts 目前依赖 `at` 或 `anchor`，自由但不够语义化，agent 很难系统调整。

**目标**

给 agent 一个介于 grid 和 absolute 之间的布局 grammar。

**改动落点**

- `grid` children 支持 `gridArea?: { col, row, colSpan?, rowSpan? }`。
- 新 `layoutPreset` / `pageArchetype` 元数据，例如 `"hero-left" | "chart-rail" | "evidence-strip" | "two-up" | "dashboard"`.
- `stack/grid/split` 增加 `overflowPolicy?: "shrink" | "drop-optional" | "paginate" | "error"`。
- expose layout decisions 到 render-tree：每个 node 记录 measured rect、fallback action、dropped reason。

**验收**

- agent 能稳定指定非顺序 grid placement。
- render-tree JSON 可供外部 QA 工具解释“为什么被压缩/丢弃”。

### A6. Validation 模式与修复建议（P1）

**现状**

- validator 偏严格，且很多规则直接返回 error。
- 有重复卡片、低对比度、title occlusion、layout overflow 等实用诊断，但缺少可配置策略。

**目标**

区分 authoring strictness、delivery strictness、experimental mode。

**改动落点**

- `deck.validation?: { mode:"strict"|"standard"|"experimental", allowUnknownComponents?, maxTextLength?, requireAlt?, requireSources? }`。
- `validateDeck` 输出 machine-readable `fixHints`，例如字段路径、建议值、可自动 patch 操作。
- diagnostics 分类为 `schema | layout | visual | accessibility | provenance`。

**验收**

- experimental 模式允许 unknown component 作为 warning，但 render 仍必须 fail-safe。
- strict 模式下 alt/source/reference 规则可开启。

### A7. Component Variant Taxonomy（P1）

**现状**

- 很多组件有 `variant`，但命名不统一：`plain/card/compact/banner/minimal/rail/panel/frameless/list/grid/strip/board/memo/cards` 混用。

**目标**

形成跨组件一致的 variant 语义，降低 agent 选择成本。

**改动落点**

- 定义全局 variant 维度：
  - `chrome: "none" | "subtle" | "card" | "panel" | "banner"`
  - `density: "comfortable" | "compact" | "dense"`
  - `emphasis: "low" | "medium" | "high"`
  - `arrangement: "list" | "grid" | "strip" | "board"`
- 旧 `variant` 保留，但 expansion 归一化到这些维度。
- disclosure 显示推荐组合，而不是每个组件自定义一套词。

**验收**

- `component-usability.test.ts` 覆盖同一组 visual dimensions 在 5 个核心组件上表现一致。

---

## B. 商业 / 科研关键能力

### B1. Data Binding 与数据视图层（P0）

**现状**

- chart/table/list/scorecard 都要求 agent 手写最终数据结构。
- 同一份数据在多页复用时容易不一致，无法过滤、排序、聚合。

**目标**

deck 级数据源 + 组件绑定，把数据转换集中在编译期完成。

**改动落点**

- `DeckSpec.dataSources?: Record<string, DataSource>`：
  - `inline-json`
  - `inline-csv`
  - `file-csv`
  - `computed`（受控表达式，不执行任意代码）
- component/primitive 支持：
  - `bind: { source, select?, filter?, groupBy?, aggregate?, sort?, limit?, pivot? }`
  - `encoding` 用于图表：`x`, `y`, `series`, `color`, `label`。
- render-tree 保存 resolved data 和 source lineage。

**验收**

- 一个 CSV 同时驱动 chart-card、table-card、scorecard。
- 修改 dataSource 后多页输出一致。
- validator 能指出 bind 字段不存在、类型不匹配、聚合非法。

### B2. 高级图表与统计图（P0）

**现状**

- 原生 chart 支持 bar、stacked-bar、line、area、pie、doughnut、combo、scatter、waterfall。
- chart annotations 是 overlay 近似，不是数据坐标锚定。
- 缺少科研和金融常用能力：误差线、置信区间、回归线、双轴、箱线图、直方图、分布图、热力图原生 chart、forest plot。

**目标**

覆盖商业分析和科研汇报的主流图表类型，同时保持 PowerPoint 可编辑。

**改动落点**

- `ChartSeries` 扩展：
  - `axis?: "primary" | "secondary"`
  - `errorBars?: { kind:"fixed"|"percent"|"stdev"|"custom", plus?, minus? }`
  - `confidenceBand?: { lower:number[], upper:number[] }`
  - `trendLine?: { type:"linear"|"exp"|"log"|"poly", order?, label? }`
- 新 `ChartType`：
  - `histogram`
  - `boxplot`
  - `heatmap`
  - `bubble`
  - `forest`
  - `gantt`
- chart coordinate annotation：
  - `annotations: { x?, y?, series?, index?, label, kind }[]`
  - renderer 能根据 plot rect 计算 overlay。

**验收**

- 每个新增 chart type 一个 package test。
- PowerPoint 打开不报 repair，基础元素可编辑。

### B3. 公式与科学符号（P0）

**现状**

- 无公式节点，只有 superscript/subscript baseline。
- 科研页只能把公式做成图片或普通文本，无法编辑、无法统一样式。

**目标**

支持 inline/block 公式，并尽量输出 PowerPoint 原生 OMML。

**改动落点**

- `RichInline` 增加 `{kind:"math", latex}`。
- 新 block node/component `equation`：
  - `{ latex, label?, number?, align?, caption? }`
- LaTeX -> MathML -> OMML 转换：
  - 优先使用稳定本地转换库。
  - 如果 OMML 覆盖不全，先支持公式转 SVG/PNG fallback，但 render-tree 标记非原生。
- text/table/callout 中允许 inline math。

**验收**

- 分式、上下标、求和、积分、矩阵、希腊字母、化学式样例通过。
- block equation 支持编号 `(1)` 和引用。

### B4. 引用、脚注、参考文献（P0）

**现状**

- 有 `source-note` 和 notes，但没有结构化 citation。
- 无自动编号、无 bibliography、无表格脚注联动。

**目标**

科研/商业报告中引用来源可追踪、可自动排版。

**改动落点**

- `DeckSpec.references?: Array<{ id, title?, authors?, year?, venue?, doi?, url?, citation? }>`。
- `DeckSpec.footnotes?: Array<{ id, text }>`。
- `RichInline` 增加 `{kind:"cite", refId}`、`{kind:"footnoteRef", footnoteId}`。
- 新 `bibliography` component：
  - 自动列出已引用项。
  - 支持 `style:"numeric"|"author-year"|"short"`.
- table cell 支持 `footnoteRefs?: string[]`。

**验收**

- 文中 `[1]`、脚注、参考文献页按出现顺序一致。
- 未引用 ref、缺失 refId、重复 refId 都有 validator 诊断。

### B5. 表格高级能力（P1）

**现状**

- table 支持 header、row/col span、rich runs、fill、alignment、border。
- 缺少条件格式、数字格式、列类型、分组、排序标识、总计行、脚注。

**目标**

让 table-card 能承担商业分析 appendix、投研对比表、实验结果表。

**改动落点**

- `columns?: Array<{ key, label, type:"text"|"number"|"percent"|"currency"|"date", format?, align?, width? }>`。
- `conditionalFormats?: Array<{ column, rule, palette | fill | icon }>`。
- `rowGroups?: Array<{ label, start, end }>` 或 binding 后自动 group。
- `summaryRows?: Array<{ label, aggregate }>`。
- cell `footnoteRefs`, `sortIndicator`, `bar`, `sparkline`, `icon`.

**验收**

- 条件格式表格和总计行在 PPT 中稳定渲染。
- 数字格式和对齐由 column type 自动决定。

### B6. Diagram Grammar（P1）

**现状**

- 已有 process-flow、swot、matrix、funnel、stat-flow、probe-flow、failure-taxonomy 等组件。
- 但它们是各自手写组件，不共享 `nodes + edges` 模型，也缺少 org chart、network、sankey、decision tree 等通用图。

**目标**

引入通用 diagram node，支持商业结构图和科研流程图。

**改动落点**

- 新 `diagram` primitive/component：
  - `kind:"flowchart"|"org-chart"|"network"|"sankey"|"tree"|"causal-loop"`
  - `nodes: Array<{ id, label, body?, tone?, shape?, data? }>`
  - `edges: Array<{ from, to, label?, weight?, style? }>`
- layout engine：
  - DAG 用 dagre/elk。
  - tree 用 d3-hierarchy。
  - sankey 用 d3-sankey。
- 输出仍用 shape/text，不引入图片 fallback。

**验收**

- 决策流程、组织架构、Sankey 用户漏斗、实验 protocol 四类示例 deck。

### B7. 代码块与技术内容（P1）

**现状**

- 有 `code` text component 和 mono style，但没有 syntax highlighting、行号、highlightLines、文件标题栏。

**目标**

满足技术方案、科研方法、SQL/Python/实验脚本展示。

**改动落点**

- 新 `code-block` component：
  - `{ language, code, title?, caption?, showLineNumbers?, highlightLines?, wrap?, maxLines? }`
- 使用 `shiki` 或轻量 tokenizer 编译成 rich runs。
- 支持 diff mode：`added/removed` 行背景。

**验收**

- TS/Python/SQL/Bash 四类高亮。
- 行号对齐稳定，长代码能截断或分页。

### B8. Provenance / 审计与可复现性（P1）

**现状**

- `metadata`、render-tree、diagnostics 已存在，但没有结构化来源链。

**目标**

商业/科研 deck 能说明每张图、表、结论来自哪里。

**改动落点**

- node 支持 `provenance?: { sourceId?, query?, transform?, accessedAt?, confidence? }`。
- data binding 生成 lineage。
- `audit.ts` 输出：
  - missing source
  - stale accessedAt
  - unsupported transform
  - uncited claim
- `source-note` 可自动从 provenance 生成。

**验收**

- strict 模式下 chart/table/fact-list/executive-summary 的关键 claim 必须有 source 或 provenance。

### B9. Export Targets 与视觉回归（P1）

**现状**

- package emitter 只输出 PPTX。
- 测试以 AST/XML/diagnostics 为主，缺少稳定的 PDF/PNG visual artifact。

**目标**

支持交付前视觉 QA 和多格式产物。

**改动落点**

- CLI / API 增加 `export: { pptx?, pdf?, png?, html? }`。
- PDF：LibreOffice headless。
- PNG：PDF per-slide 或 LibreOffice export。
- HTML：先作为 inspection viewer，不要求完全等同 PPT。
- Visual regression：关键 example deck 渲染 PNG，做尺寸、非空、低级别 pixel sanity。

**验收**

- 一条命令生成 PPTX + PDF + slide PNG。
- CI 至少跑核心示例的 PNG smoke test。

### B10. 模板、母版和品牌系统（P1）

**现状**

- `layouts.ts` 是 legacy v1 layout，source v2 主要靠 DOM 和 themeOverride。
- PowerPoint master/layout 基本固定，brand template 只能通过 themeOverride 和组件约定表达。

**目标**

让企业/机构模板成为一等公民，而不是每次让 agent 重新发明。

**改动落点**

- `BrandTemplate`：
  - theme tokens
  - layout areas
  - component defaults
  - title/footer/chrome rules
  - examples/guidance
- template registry：本地目录可加载。
- emitter 支持多个 slide layout / master placeholder 的最小集合。
- `slideml2 template init` 生成模板骨架。

**验收**

- 同一 source deck 切换 consulting / academic / startup pitch 三套模板，内容不变但风格明显不同。

### B11. 可访问性与阅读顺序（P2）

**现状**

- image 有 `alt`，render 时缺省为 node label；但 strict validation 不强制。
- 没有 reading order schema。

**目标**

让商业/科研交付满足基础可访问性要求。

**改动落点**

- slide `readingOrder?: string[]`。
- strict 模式下 image/chart/table 必须有 alt/title/caption 中至少一种语义描述。
- audit 输出 WCAG contrast、alt coverage、reading order coverage。
- emitter 尽可能按 readingOrder 排 shape 或写对应 nv metadata。

**验收**

- strict a11y report 可量化通过率。

### B12. 动画与演讲构建序列（P2）

**现状**

- 不生成 `<p:timing>`，所有内容静态出现。

**目标**

支持基础演讲节奏，不追求复杂动画编辑器。

**改动落点**

- node `animate?: { kind:"appear"|"fade"|"fly", trigger:"click"|"with-prev"|"after-prev", delay?, duration? }`。
- chart `animateBuild?: "bySeries"|"byCategory"`。
- emitter 写 slide timing tree。

**验收**

- stat-strip、process-flow、chart series 可按点击顺序出现。

---

## 建议里程碑

### M1：契约收敛与设计自由度基线

范围：A1 + A2 + A3 + A6。

目标：先消灭 schema/disclosure/validation 不一致，让 agent 使用现有能力时不再被错误文档或 validator 卡住。

当前进展（2026-05-09）：

- 已落地 schema registry 基线：deck size、validation mode、theme layout/component/surface 字段由 `schema.ts` 统一导出，validator 与 tests 复用该清单。
- 已落地 `deck.size` 多尺寸 authoring contract：`16x9`、`16x10`、`4x3`、`wide` 均可通过 validation，并在 render/measure 阶段注入默认画布尺寸；显式 `themeOverride.layout.slideWidthCm/slideHeightCm` 仍保留为高级覆盖。
- 已落地 named layout areas：`themeOverride.layout.areas` 支持 `{x,y,w,h}` 和 `{left,top,right,bottom}`，顶层 `area:"name"` 可直接定位。
- 已落地 surface override 基线：`fillOpacity`、`lineOpacity`、`lineWidth`、`lineDash`、`shadow`、`gradient` 可进入 primitive/container render AST；组件 `surface` helper 与 theme component style 对齐。
- 已落地 validation mode 基线：`strict` 强制 image alt 与 chart/table source metadata，`experimental` 将未知 node/component 降级为 warning。
- 已补测试：schema contract、disclosure/validator 同步、component surface 回归、AST 视觉 smoke；M1 仍需在后续批次继续把 rich text union 与更细的 fix hints 纳入 A4/A6。

### M2：数据驱动商业分析

范围：B1 + B2 的双轴/误差线/回归线基础 + B5 第一阶段。

目标：让经营分析、投研、实验结果页不再手写散落数据。

### M3：科研硬能力

范围：A4 + B3 + B4 + B7。

目标：公式、引用、代码块成为一等能力。

### M4：模板和可复现交付

范围：B8 + B9 + B10。

目标：支持企业/机构模板、来源审计、多格式导出和视觉 QA。

### M5：图形语法与演讲增强

范围：B6 + B11 + B12。

目标：补齐复杂 diagram、accessibility、animation。

---

## 工程纪律

- 每个新增字段必须同时更新 schema registry、validator、SPEC、agent disclosure、至少一个 regression test。
- 所有新字段默认可选；旧 deck 必须 zero-diff 或有明确 migration。
- OOXML 新能力必须有 package-level test，避免 PowerPoint repair。
- 数据绑定、公式、引用这类编译期转换必须在 render-tree 保留 resolved + source 信息，便于审计。
- 商业/科研示例 deck 要成为验收资产，不只测单组件。
