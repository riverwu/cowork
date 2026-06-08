# slideml2 Design Contract

**版本**: 1.0 草案
**生效日期**: 2026-06-08
**适用范围**: slideml2 所有内置组件、布局算法、theme 系统

---

## 0. 为什么需要契约

过去几轮组件升级（quote / comparison-list / key-takeaway / fact-list）让我们意识到：

1. **空间值自由发挥**：rail 粗细在 0.08 / 0.18 / 0.2 / 0.32 之间漂；padding 在 0.22–0.7 之间漂；gap 出现 15 个不同值。
2. **chrome 重叠**：每个 variant 自己决定要不要加 surface / border / cornerRadius / elevation，结果"卡里有卡里有卡"。
3. **tone 误用**：`recommended` 被默认涂成 `positive` 绿色，把"被选中"和"积极"两个不同语义混为一谈。
4. **缺乏全局调节杠杆**：想让整本 deck 紧凑一档，必须改十几处 minHeight；想换基线韵律，得改每个组件。

这份契约的目标：**把零散的视觉决策收敛成一套可调节的系统，并明确"精致从哪里来"。**

---

## 1. 设计哲学：三传统的交集

| 传统 | 我们采纳的核心 | 我们不采纳的部分 |
|---|---|---|
| **IBM Carbon** | Layer 是上下文；density 是上下文；token 化空间；强语义 tone | Material 式 elevation 系统、IBM Plex 字体绑定 |
| **Refactoring UI** | 用 hierarchy 和 spacing 做强调，不用 chrome；chrome 是 opt-in；一张 slide 一个焦点 | "现代 SaaS" 调色板、glassmorphism 等装饰潮流 |
| **Swiss / 国际主义** | 不对称网格、克制配色、whitespace 是结构、排版作为主角 | 极端纯净（slideml2 是分析交付物，需要可读密度，不是美术馆海报）|

三者交集是一句话：**结构靠网格 + 排版，色彩靠 signal + 一次性 moment，chrome 靠 opt-in 而不是 default。**

slideml2 的**默认气质**：editorial analytical。参考对象是 *The Economist briefing* / 高盛 / 麦肯锡交付物 / NYT Upshot——不是 SaaS 营销页，也不是美术馆画册。

---

## 2. 五条核心原则

### 2.1 Layer 是上下文，不是属性

**规则**: 组件不再写 `fill: "surface.subtle"`；写 `layer: 1 | 2 | 3 | hero`。渲染期根据**父级 layer**解析为实际颜色。

- `layer.0`：slide 背景（最深）
- `layer.1`：第一层 surface（slide 直接子组件）
- `layer.2`：嵌入 surface（卡里的卡）
- `layer.3`：第三层及以上 → 强制 demote 为 frameless

**约束**：layer 深度超过 3，渲染器报警告，并强制把最里层的 surface 砍掉。

### 2.2 Density 是上下文，不是组件 prop

**规则**: density 在 deck / slide 层级声明，向下 propagate；组件不再写 `density: "compact" | "comfortable"` 各自的分支。

- `comfortable` (默认): spacing scale × 1.0
- `compact`: × 0.83
- `dense`: × 0.67

组件用 token 表达意图（`spacing.md`），实际值由当前 density × 系数算出。

### 2.3 Whitespace 是预算，不是 leftover

**规则**: 布局算法**先扣 whitespace 预算，再分配内容空间**。当 slide 装不下时，被压缩的是 **autoFit 文字**，不是 whitespace。

具体：

- section-title 上方强制 `spacing.lg` (16pt) 间距
- 组件之间默认 `spacing.md` (12pt)
- rail 周围 `spacing.sm` (8pt) 内边距
- 这些预算从可用空间中**先扣**，剩下的才是内容分配区

### 2.4 Chrome 是 opt-in，不是 default

**规则**: 组件的默认变体不带 surface / border / elevation。只有显式 prop 或 dispatcher 在以下情况下提升：

1. **信号密度高**（slide 上已有 4+ 组件时，新组件需要 chrome 帮助绑定）
2. **强调（emphasis）**：agent 显式 `emphasis: "raised"` 或 `variant: "panel"`
3. **layer.1 顶层**：单独的 hero 区域允许带 surface

否则——默认是 typographic hierarchy + spacing + rail。没有 tinted card。

### 2.5 Color 是 signal，不是 surface

**规则**: 5 个语义 tone 只在以下场景出现：

| Tone | 允许出现的位置 | 不允许出现的位置 |
|---|---|---|
| `neutral` | 任何 surface, divider | — |
| `brand` | rail / accent / icon / kicker / 数字字段 / 一张 slide 的 brand moment | card fill 默认 |
| `positive` | 正向数据（涨 / 通过 / 完成）、正向趋势 chart 系列 | "被推荐"、"被选中"、"突出显示" 等非情感语义 |
| `warning` / `danger` | 警告 / 风险 / 下跌 / 失败 | "重要" 等非情感语义 |

**"被选中"用 brand emphasis（粗体 + brand rail），不用 positive。**

每张 slide 最多**一个 chromatic moment**——一个 tone 色出现一次，剩下全部走 neutral。

---

## 3. Design Tokens

新文件：`slideml2/src/design-tokens.ts`。组件不允许写字面量数字或颜色，只能引用 token。

### 3.1 Spacing（4pt baseline）

| Token | pt | cm | 典型用途 |
|---|---|---|---|
| `xs` | 4pt | 0.14cm | 内联 chip / 紧密 inline |
| `sm` | 8pt | 0.28cm | rail 周围 / 标题与 body 之间 |
| `md` | 12pt | 0.42cm | 组件之间默认 |
| `lg` | 16pt | 0.56cm | section 之间 |
| `xl` | 24pt | 0.85cm | hero 上下 |
| `2xl` | 32pt | 1.13cm | art-directed slide 留白 |

### 3.2 Radius

| Token | cm | 用途 |
|---|---|---|
| `sm` | 0.10cm | hairline chip, badge |
| `md` | 0.20cm | card, surface |
| `lg` | 0.40cm | oversized callout, art-directed |

### 3.3 Rail / Accent

| Token | pt | cm | 用途 |
|---|---|---|---|
| `thin` | 2pt | 0.07cm | 内联 list item rail（fact-list 默认）|
| `thick` | 6pt | 0.21cm | 强调用 rail（key-takeaway panel）|

只允许这 2 个粗细。今天 4 个值（0.08 / 0.18 / 0.2 / 0.32）收敛到 2 个。

### 3.4 Layer

| Token | 默认主题解析 | 嵌套 layer.1 时解析 |
|---|---|---|
| `layer.0` | `background` (#FFFFFF) | — |
| `layer.1` | `surface` (#FFFFFF, possibly elevated shadow) | shift up to layer.2 |
| `layer.2` | `surface.subtle` (#F1F4FA) | shift up to layer.3 |
| `layer.3` | `surface.subtle.deep` (#E5EAF2) | warn + demote to frameless |

### 3.5 Elevation

| Token | 视觉 | 用法 |
|---|---|---|
| `flat` | 无阴影 | layer.1+ 默认 |
| `raised` | 极轻阴影 (blur 4pt) | 仅 hero 区域 |
| `floating` | 中等阴影 (blur 10pt) | art-directed slide only |

### 3.6 Density modifier

deck-level prop `density: "comfortable" | "compact" | "dense"`，向下 propagate；组件不直接读 density，读 effective spacing scale 系数。

---

## 4. 类型系统

### 4.1 字号 ramp（1.25× 比例）

| Token | size (pt) | weight | 用途 |
|---|---|---|---|
| `display` | 64 | 700 (display master) | art-directed cover / hero |
| `h1` | 40 | 700 | slide-title |
| `section` | 28 | 600 | section-title |
| `card-title` | 18 | 600 | card / 组件标题 |
| `lead` | 16 | 500 | lead 句、副标题 |
| `body` | 13 | 400 | paragraph |
| `caption` | 11 | 400 | 注释、metadata |
| `label` | 9.5 | 600 | uppercase kicker / chip |
| `source-note` | 9 | 400 | footer 引用、出处 |

### 4.2 字重 ramp

最少 3 档：`regular` (400) / `medium` (500) / `bold` (700)。display 走 (800-900) 单独 master。

**weight 优先于 size 表达 emphasis**：长 body 里强调一句话 → 加粗，不放大字号。

### 4.3 字距 / 数字 / 标点

- **tracking**: `normal` / `wide` (+50) / `wider` (+80) / `widest` (+120)。kicker 默认 `wider`
- **数字**: 默认 tabular numerals（对齐列）；hero 大字号用 proportional
- **标点**: hanging punctuation（句号、引号悬挂出栏，仅 art-directed slide 启用）
- **smart quotes**: 自动转换 `"..."` → `"..."`、`'...'` → `'...'`
- **em-dash / en-dash**: 自动转换 `--` → `—`、` - ` → ` – `

---

## 5. 布局契约

### 5.1 默认 split ratio

- horizontal split 默认 `[0.62, 0.38]`（golden ratio）
- vertical split 默认 `[0.66, 0.33]`（rule of thirds）
- agent 显式传 ratio 才用 [0.5, 0.5]
- 这是一行代码改动，但视觉提升显著

### 5.2 Baseline grid

所有正文文字（`body` / `caption` / `lead`）的**第一基线**必须 snap 到 12pt 全局网格。

实现：layout pass 末尾扫描所有 text 节点，把 y-offset 拉到最近的 12pt 倍数；父容器高度相应增加。

效果：comparison-list 两列 title 自动齐基线、多卡片 grid 文字齐线。

### 5.3 Whitespace 预算优先级

布局算法处理顺序：

1. 计算结构 whitespace（section-title 上方 / 组件之间 / rail 内边距）
2. 从 region 总高度扣除 whitespace 预算
3. 在剩余空间分配内容
4. 内容超出时**先 autoFit 文字字号**，再 demote style，再 drop optional 节点
5. **永远不压缩 whitespace 预算**

### 5.4 Layer cascade

组件声明 `layer: N`，渲染器：

1. 计算父级 effective layer
2. 子级 effective = max(子声明, 父+1)
3. 当 effective >= 3，强制 `fill: none, line: none, elevation: flat`（demote 为 frameless）
4. 报 `LAYER_DEPTH_EXCEEDED` warn（不阻塞）

### 5.5 "一张 slide 一个 loud component"

定义 "loud"：`elevation >= raised` 或 `layer.fill !== "background"` 且 chromatic tone。

约束：一张 slide 上 loud 组件 > 1 时，第 2+ 个自动 demote 到 frameless。

实现：slide 级 dispatcher 扫描子组件，给除第一个 loud 之外的所有组件附加 `__autoDemote: true`。

---

## 6. 八个 Expressive Escape Valves

契约严格，但精致住在这 8 个空间。每个都是一等公民，不是补丁。

### 6.1 排版本身作为主角

允许的 expressive 动作（在契约内）：

- 字重对比：long form body 里关键句加粗（不放大字号）
- tracking-wide kicker：所有 label 默认 `tracking: wide`
- display master：`display` / `h1` 字号自动启用 optical display master（如果字体有）
- 单一 serif 介入：theme 可声明 `display: { font: "serif" }`，其余 sans——经典 editorial 招式
- 数字精度：tabular numerals + decimal align 让对比表格自动整齐
- smart quotes / hanging punctuation / em-dash 自动转换

### 6.2 不对称布局原语

新增 layout primitives：

| Primitive | 行为 |
|---|---|
| `margin-asymmetric` | slide 左 6cm 右 1cm 留白，标题挂在 left hanging margin |
| `hanging-title` | section-title 飞出主栏，挂在左侧 margin |
| `bleed` | image / shape 切到 slide 边缘，故意打破网格 |
| `pull-quote` | quote 横跨两列或飞入侧栏 |
| `breakout` | 单个元素故意破栏（只允许每 slide 一次）|

### 6.3 一张 slide 一个 chromatic moment

强约束（见 5.5）。这种克制把单个 brand 色变成 signature——每张 slide 唯一的 brand color 出现位置就是设计语言。

### 6.4 art-directed slide kind

特殊 slide 类型，**不走 baseline grid、layer、chrome、density 约束**：

| Kind | 用途 |
|---|---|
| `cover` | 封面 |
| `chapter-divider` | 章节分隔 |
| `thesis` | 单页核心论点 |
| `breakout` | 数据故事的视觉高潮 |

约束：一份 deck 中 art-directed slide **不超过 15%**，且不能连续 ≥2 张。

### 6.5 Imagery 作为情感和色彩层

- `full-bleed` image 是一等公民
- `editorial-crop`：指定主体位置，按 rule of thirds 自动裁切
- `duotone`：单色 / 双色调把图片融入 brand
- `hanging-caption`：图片注释挂在侧 margin，不在底部

当 chrome 克制时，image 得到完整视觉权重——这是 Economist briefing 的精髓。

### 6.6 主题层作为真实表达

`themeOverride` 可以改：

- display / text font 全套
- 字重 ramp 偏移
- baseline grid 单位（12pt → 14pt 偏舒展、10pt 偏紧致）
- spacing scale 系数
- 默认 split ratio
- 中性色温（warm gray / cool gray）
- 默认 tone 派生算法（HSL / Oklab）

同一份契约，Economist / Bloomberg / NYT / Pentagram 主题应该长得完全不同。

### 6.7 细节工艺

看不见但少了就感觉到：

- tabular numerals + decimal align
- hanging punctuation
- 视觉重心校正（quote 大引号、icon 中心偏移）
- Oklab 派生 tone tint（避免品牌色"洗白"）
- 真粗细 hairline（0.5pt 而不是 1pt）
- 圆角内 hairline stroke

### 6.8 Deck-level rhythm

单 slide 严格守规，但 deck 应有节奏：

- chrome-heavy 数据 slide + chrome-free quote slide 交替
- 灰调多张 + brand 调一张
- 横向 split 多张 + 纵向 split 偶尔一张
- 4 张数据 + 1 张 full-bleed image

slideml2 提供 deck inspector：连续 3 张同类 slide 时建议插入 breathing slide。

---

## 7. 组件实现契约

任何 variant 函数必须满足：

1. **不写字面量空间数字**：所有 padding / gap / minHeight / radius / rail width 走 token
2. **不写字面量颜色**：所有 fill / line / color 走 layer 或 tone token
3. **不直接读 density**：声明 `spacing: tokens.md`，由 token 解析层处理 density
4. **声明 layer 意图**：每个组件根节点必须有 `layer: 1 | 2 | 3 | hero`
5. **默认 minimal chrome**：默认变体应该是最低 chrome 的形态；卡片 / surface / elevation 走 opt-in 升级
6. **响应 layout context**：接受 parent 传入的 layer / density / chromatic-budget context
7. **报告 chrome 强度**：组件声明 `chromeLevel: "frameless" | "subtle" | "loud"`，供 slide dispatcher 做 "一张 slide 一个 loud" 约束

ESLint 规则（或 lint check）：在 `src/components.ts` 和 `src/component-registry.ts` 中，禁止以下模式：

```
padding: <numeric literal>
cornerRadius: <numeric literal>
fixedWidth: <numeric literal>   // 仅在 rail / icon 场景下
fill: "<hex>" 或 "surface" / "surface.subtle" 直接引用
```

必须改为 `padding: tokens.spacing.md` / `fill: tokens.layer(1)` 等。

---

## 8. 布局算法契约

布局算法必须：

1. **先扣 whitespace 预算**，再分配内容（见 5.3）
2. **末尾 snap text baseline 到 grid**（见 5.2）
3. **解析 layer cascade** 并强制 demote 超深度（见 5.4）
4. **propagate density 系数**，token 解析层负责实际数字
5. **统计 chrome 强度**，强制 "slide-level 一个 loud"（见 5.5）
6. **统计 chromatic moments**，强制 "slide-level 一个 tone 色"（见 2.5）

---

## 9. 实现路线图

### M1 · 写契约（本文档） · 已完成

- [x] DESIGN.md
- [ ] 团队 review 与签字（暂缓到团队扩张）

### M2 · Spatial tokens + density 上下文 · 半周

**目标**: 组件不再写字面量空间数字；density 改 context。

任务：
1. 新建 `src/design-tokens.ts`，导出 `spacing` / `radius` / `rail` / `elevation` / `density-scale`
2. `src/theme.ts` 增加 `density` 字段，slide / deck 级声明
3. 改 4 个升级过的组件（quote / comparison-list / key-takeaway / fact-list）改用 token
4. 加一个 lint 脚本扫描 `components.ts` / `component-registry.ts` 中的字面量空间数字
5. 全套测试通过

**Acceptance**: `grep -E "padding: 0\\.[0-9]+|cornerRadius: 0\\.[0-9]+" components.ts` 在 4 个升级组件中返回 0 行。

### M3 · Layer-aware surface · 1 周

**目标**: surface 从静态颜色改为 layer 标签，渲染期解析父级层级。

任务：
1. 新增 `LayerContext` 类型，渲染 pass 中向下传递
2. token 层暴露 `tokens.layer(n, parentContext)` 函数
3. 改组件的 `fill: "surface"` 等字面量为 `fill: tokens.layer(1)`
4. 渲染期检测 layer 深度，>= 3 自动 demote frameless
5. 新增 diagnostic `LAYER_DEPTH_EXCEEDED`
6. 写新测试覆盖嵌套 3 层 surface 自动 demote

**Acceptance**: 测试 case "key-takeaway panel 嵌入 comparison-list paired 卡片" 不再出现三层 tinted 嵌套。

### M4 · Baseline grid + whitespace-first 布局 · 1-2 周

**目标**: 文字基线全局对齐；whitespace 不再被压缩。

任务：
1. 布局算法增加 `baselineGrid: 12` 全局参数（theme 可 override）
2. layout pass 末尾扫描 text 节点，y-offset snap 到 grid
3. 改布局算法的 budget 分配顺序：whitespace 预算先扣
4. autoFit 优先级调整：先收文字、再 demote style、再 drop optional、永不压缩 whitespace
5. 默认 split ratio 改 `[0.62, 0.38]` / `[0.66, 0.33]`
6. 引入 `margin-asymmetric` / `hanging-title` layout primitive
7. 全套回归测试 + 视觉对比 case

**Acceptance**: comparison-list 两列 title 基线自动对齐；split 默认黄金比；老 deck 视觉变化在可控范围内（必要时 deck 可显式回退 `splitRatio: [0.5, 0.5]`）。

### M5 · Context-aware dispatcher · 1 周

**目标**: 组件自动 pick variant，参考 sibling 密度 / layer 深度 / chromatic budget。

任务：
1. dispatcher 接受 `LayoutContext` 入参（parent layer / sibling 数量 / chromatic budget）
2. 修改每个组件的 auto-pick 规则，从纯 prop-based 改为 context-aware
3. 实现 "一张 slide 一个 loud" 约束
4. 实现 "一张 slide 一个 chromatic moment" 约束
5. 写诊断：违反约束时输出 `CHROME_BUDGET_EXCEEDED` / `CHROMATIC_BUDGET_EXCEEDED`

**Acceptance**: 给一个含 3 个 `key-takeaway panel` 的 slide → 渲染后只有 1 个保留 panel chrome，其余自动 demote 到 minimal。

### M6 · Expressive escape valves · 持续

按优先级实施 8 个 escape valve：

| 优先级 | Valve | 实现成本 |
|---|---|---|
| P0 | 排版精细化（tabular numerals / smart quotes / em-dash 自动转换 / tracking token）| 半周 |
| P0 | art-directed slide kind（不走契约约束）| 半周 |
| P0 | 主题层扩展（font / weight ramp / spacing scale 系数）| 半周 |
| P1 | 不对称布局原语（margin-asymmetric / hanging-title / bleed）| 1 周 |
| P1 | full-bleed / editorial-crop image | 1 周 |
| P2 | duotone / Oklab tone 派生 | 1-2 周 |
| P2 | 光学对齐 / hanging punctuation | 探索 |
| P3 | deck-level rhythm inspector | 探索 |

---

## 10. 反向场景：什么不在这套契约里

明确**不**适用：

1. **营销 / 品牌发布 deck**：需要高 chrome、多色、强 brand expression。slideml2 不是 Keynote 的替代品。
2. **全交互 web slide**：动画 / 滚动叙事 / 嵌入视频。我们的目标格式是 OOXML（pptx）。
3. **完全自定义 visual identity**：通过 `themeOverride` 可以调气质，但骨架契约（layer cascade / baseline grid / whitespace budget）不可 override。

如果用户需要这些场景，应该用专门工具（Keynote / Figma slide / Pitch）。slideml2 的甜蜜点是**信息密度高、克制气质的分析交付物**。

---

## 11. 已知 Trade-off

接受这套契约的代价：

| Trade-off | 理由 |
|---|---|
| 默认偏 "editorial analytical"，不偏 "marketing/产品发布" | 这是 slideml2 的实际用户场景 |
| 老 deck 视觉会变化 | 数据层兼容，但视觉表达升级；可选 `legacy` 模式（暂缓决定） |
| agent 要适应 "chrome opt-in" 思维 | guidance 文档 + 自动 demote 一起兜底 |
| 大字号 hero / display 字体可能缺 master，效果打折 | 提供 system fallback 字体集，theme 可指定 |
| baseline grid 增加 layout pass 复杂度 | 一次性投入，长期回报 |

---

## 12. 决策记录

| 决策 | 选项 | 选择 | 理由 |
|---|---|---|---|
| 设计哲学锚定 | Material / Carbon / Apple / Swiss | Carbon spatial + RUI hierarchy + Swiss restraint | 与 slideml2 分析交付物场景吻合 |
| Baseline 单位 | 8pt / 12pt / 16pt | 12pt | 中文 + 拉丁混排下视觉最佳 |
| Spacing scale | 4pt-based / 8pt-based | 4pt-based（更细粒度） | 我们的字号比例下更灵活 |
| Default split ratio | [0.5, 0.5] / [0.6, 0.4] / [0.62, 0.38] | [0.62, 0.38] / [0.66, 0.33] | 黄金比 + rule of thirds 经典编辑选择 |
| Tone 用法 | 自由 / 严格 signal | 严格 signal | 与 "一张 slide 一个 chromatic moment" 一致 |
| Density 模型 | per-component / per-deck context | per-deck context | Carbon 一致；可全局调节 |
| Layer 深度上限 | 2 / 3 / unbounded | 3 | 平衡灵活性和可读性 |
| art-directed slide 比例上限 | 10% / 15% / 25% | 15% | 经验值，可调 |

---

**变更日志**

- 2026-06-08: v1.0 草案，整理三派交集，定义 5 条原则、token 体系、8 个 escape valve、6 个 milestone
- 2026-06-08: M2 + M3 落地（design-tokens.ts、layer-cascade.ts、4 个组件全部 token 化、lint 接入 check）；M4 部分落地（baselineGridPt 进 theme、vertical/horizontal split 默认改为 rule-of-thirds / golden ratio）
- 2026-06-08: M4.2 (baseline snap) / M4.3 (whitespace-first 预算重排) / M4.5 (hanging-title primitive) 留 stub，决策推迟到独立 PR — 这三项需要重写布局求解器，单独立项前不动现有 layout pass
- 2026-06-08: M5.3 + M5.4 落地 (slide-budget-audit.ts；CHROME_BUDGET_EXCEEDED + CHROMATIC_BUDGET_EXCEEDED warning-only 第一版，不自动 demote)；M5.1 + M5.2 (LayoutContext dispatcher 改造) 留 stub，layer-cascade 模式可作为后续 PR 起点
- 2026-06-08: M6.P0a 工具模块 (typography.ts smart quotes / em-dash / en-dash + thin-space) 落地，全局应用留独立 PR；M6.P0b/c + M6.P1/P2/P3 留独立 PR（每项工作量都在 0.5-2 周）

## 当前实施状态总结 (2026-06-08)

### 已完成
- 完整 design contract（DESIGN.md v1.0）
- design-tokens.ts（spacing / radius / rail / elevation / density / baselineGrid / tracking）
- 4 个组件全部 token 化（quote / comparison-list / key-takeaway / fact-list）
- lint-design-tokens.ts CI 接入（npm check 跑）
- layer-cascade.ts（LAYER_DEPTH_EXCEEDED 诊断 + 自动 demote）
- slide-budget-audit.ts（CHROME_BUDGET_EXCEEDED + CHROMATIC_BUDGET_EXCEEDED warning）
- typography.ts（smartQuotes + smartDashes + refineTypography 工具）
- baseline-snap.ts stub + theme.baselineGridPt 字段
- 默认 split ratio: 黄金比 / rule of thirds
- 1881 测试通过（+16 新增），0 回归

### 留 stub，单独 PR 实施
- M4.2 baseline grid snap pass（需重写 layout 求解器）
- M4.3 whitespace-first 预算重排（同上）
- M4.5 hanging-title / margin-asymmetric primitive
- M5.1 + M5.2 LayoutContext dispatcher 改造
- M6.P0a 全局 refineTypography 应用（工具已就绪）
- M6.P0b art-directed slide kind
- M6.P0c 主题层扩展（font / weight ramp / spacing scale 系数）
- M6.P1a full-bleed / editorial-crop image
- M6.P1b breakout / pull-quote primitive
- M6.P2 Oklab tone 派生 + 光学对齐
- M6.P3 deck-level rhythm inspector

每个 deferred 项预估 0.5-2 周；本轮 M2/M3 部分 M4/M5/M6 的工作奠定了基础设施和契约，后续项可以基于此独立推进。
