# SlideML 双层架构 + Theme 自动提取器 — 完整路线图

> 写于 2026-04-28。本文档把三轮设计讨论（declarative layout DSL → PPTX
> 提取器 → VLM 增强）整合成一份可执行的工程计划。每一节既是设计也是
> 实施 spec；各节有独立的可交付物，可分批落地。

---

## 0. 总览

当前 SlideML：
```
LLM 写语义 (layout 名 + slots) → 全局 layout 注册表 (硬编码 ts) → ShapeList → OOXML
```

目标终态：
```
LLM 写语义 (不变)
  ├─ 全局 layout 注册表 (现有)
  └─ Theme-local 自定义布局 (新增 — 用 declarative DSL 写，纯数据)
                  ▲
                  │
       PPTX 提取器 (新增 — OOXML + VLM 联合推理)
                  ▲
                  │
              .pptx 模板 (用户输入)
```

两个核心交付物：
1. **Declarative Layout DSL**：theme 包可以用 yaml 定义自己的精确布局，不写 ts 代码。
2. **PPTX → Theme 提取器**：从一份 .pptx 模板自动生成完整 SlideML theme（含 yaml layouts、tokens、meta、缩略图）。

两者强耦合：DSL 是提取器的输出格式；先做 DSL，提取器才能落地。

---

## 1. Declarative Layout DSL

### 1.1 设计目标

- **LLM 体验不变**：deck 作者还是写 `layout: <name>` + slot map。
- **Theme 作者赋能**：在自己 theme 包里加 yaml 文件就能定义新 layout，不必改 core。
- **声明式 + 受 schema 约束**：不是另一种编程语言；JSON Schema 在 theme load 时校验。
- **可组合**：能引用现有 region / component / chrome / inline-markdown，不是从零画图。
- **像 CSS Grid / SwiftUI**：用命名网格 + 分数单位，不写 EMU。

### 1.2 文件形态

`themes/<name>/layouts/<layout-name>.layout.yaml`：

```yaml
slidemlLayout: 1
name: cover-with-pull-quote
description: |
  Cover with an inset pull-quote on the right side. Uses `quote`
  and `attribution` from the deck's existing quote vocabulary.
slots:
  title:       { type: text,         maxChars: 60 }
  subtitle:    { type: text,         maxChars: 80, optional: true }
  quote:       { type: text-block,   maxChars: 200 }
  attribution: { type: text,         maxChars: 60 }
  portrait:    { type: image-ref,    optional: true }

# Geometry uses a named-grid system. All coordinates are fractions of slide
# width/height, named cells, OR absolute units like cm(N) / pt(N).
grid:
  cols: [ 1fr, 0.4fr ]                 # 60/40 split
  rows: [ 0.4fr, 1fr, 0.2fr ]
  gap: cm(0.6)
  margin: cm(2)
  areas:
    - [ titleArea,    quoteArea ]
    - [ subtitleArea, quoteArea ]
    - [ footerArea,   attribArea ]

elements:
  - at: titleArea
    kind: text
    content: { from: slot.title }
    style:
      size: hero               # semantic from theme.style.fontSizes
      weight: bold
      color: text-strong
      align: left
      valign: bottom

  - at: subtitleArea
    kind: text
    content: { from: slot.subtitle, fallback: "" }
    style: { size: lg, color: text-muted, italic: true }

  - at: quoteArea
    kind: card
    style: { fill: bg-card, cornerRadius: 0.04, padding: cm(0.8) }
    children:
      - kind: text
        content: { literal: "\u201C" }
        style: { size: 200, color: brand-primary, bold: true }
        position: { x: 0, y: 0, w: cm(1.2), h: cm(1.2) }
      - kind: text
        content: { from: slot.quote, parse: inline-markdown }
        style: { size: lg, italic: true, color: text-strong }
        position: { x: cm(0.4), y: cm(1.2), w: 1fr, h: 1fr }
      - kind: text
        content: { from: slot.attribution }
        style: { size: sm, color: text-muted, align: right }
        position: { x: 0, y: 100%, w: 1fr, h: cm(0.6), anchor: bottom }

  - at: { x: cm(2), y: cm(2), w: cm(3), h: cm(3) }
    when: { hasSlot: portrait }
    kind: image
    content: { from: slot.portrait }
    style: { shape: circle, border: { color: brand-primary, width: pt(2) } }
```

### 1.3 关键概念

| 名字 | 含义 |
|---|---|
| **named grid** | 像 CSS Grid `areas:` —— `at: titleArea` 引用网格区域名 |
| **fraction units** | `1fr` / `0.4fr` / `cm(N)` / `pt(N)` / `pct(N)` 用 mini-grammar 解析 |
| **content sources** | `{ from: slot.X }` / `{ literal: "..." }` / `{ from: slot.X, fallback: ... }` / `{ parse: inline-markdown }` |
| **transforms** | `{ from: slot.body, transform: firstChar }` / `transform: dropFirstChar` 等少量内置变换 |
| **conditional render** | `when: { hasSlot: X }` / `when: { eq: [slot.imageSide, "left"] }` |
| **child elements** | `kind: card / group` 节点可包含 `children:`，子元素 `position` 是相对父元素 |
| **kind 词汇表** | `text` / `image` / `shape` / `region-ref` / `component-ref` / `chrome-ref` / `repeat` / `card` / `group` |
| **repeat** | `kind: repeat, over: slot.bullets, as: item, template: { ... }` —— 让 array slot 渲染成 N 个子元素 |
| **style tokens** | size 用 `xs`/`sm`/`base`/`lg`/`xl`/`display`/`hero`，颜色用 token 名 |

### 1.4 Theme 怎么挂上自定义 layout

```jsonc
// theme.json
{
  "name": "editorial-paper",
  "layouts": [
    // 引用全局核心 layouts
    { "name": "cover", "module": "core" },
    { "name": "quote", "module": "core" },

    // theme-local 定义 —— "module" 字段指向一个 .layout.yaml 文件
    { "name": "cover-with-pull-quote", "module": "layouts/cover-with-pull-quote.layout.yaml" },

    // 同名覆盖 —— 这个 theme 的 hero-stat 长得不一样
    { "name": "hero-stat", "module": "layouts/hero-stat.layout.yaml" }
  ]
}
```

Loader 解析逻辑：
1. `module: "core"` → 从全局 `LAYOUT_REGISTRY` 取
2. `module: "...yaml"` → 加载 + validate + 包成同样的 `RegisteredLayout` (slots schema + render 函数)
3. 同名时 theme-local 优先 ("override" 语义)

LLM 通过 `list_slide_layouts(theme)` 看到的是该 theme 实际可用的 layouts 集合，包含 theme-local 定制的。每个 layout 在 `describe_slide_layout` 输出 `{ slots, description, thumbnail, source: "core" | "theme-local" }`。

### 1.5 解释器

新模块 `slideml/src/render/declarative-layout.ts`：

```ts
interface CompiledLayout {
  slots: Record<string, SlotSchema>;
  description: string;
  render: LayoutFn;        // 生成的 LayoutFn — 跟手写的同等 citizen
}

export function compileDeclarativeLayout(
  doc: DeclarativeLayoutDoc,        // 解析过的 yaml
): CompiledLayout {
  validateAgainstSchema(doc);       // schema 错误在 theme load 时暴露
  return {
    slots: doc.slots,
    description: doc.description,
    render: (ctx) => evaluate(doc, ctx),
  };
}

function evaluate(doc, ctx): ShapeList {
  const grid = resolveGrid(doc.grid, ctx.deck);   // 解算 fr / cm / pct
  const out: ShapeList = [];
  for (const el of doc.elements) {
    if (el.when && !evalCondition(el.when, ctx)) continue;
    const rect = resolveAt(el.at, grid, ctx);
    out.push(...renderElement(el, rect, ctx));
  }
  return out;
}
```

`renderElement` 内层 dispatch 直接复用现有 primitives：

- `kind: text` → 调 `parseInline` 然后构造 TextShape
- `kind: image` → 调 `imageOrPlaceholder`
- `kind: region-ref` → 调 `renderRegion`
- `kind: component-ref` → 调 component 注册表
- `kind: chrome-ref` → 调 chrome 注册表 (让 layout 自己嵌入 chrome 元素)
- `kind: repeat` → 对 array slot 循环展开，每次绑定 `as` 名字
- `kind: card / group` → 创建子坐标系，递归 children

DSL 是一个**薄包装**，不需要重新实现 text/image/region 渲染，只是声明"放在哪、放什么"。

### 1.6 安全约束

声明式 layout 是**输入**（来自 theme 包），跟来自 LLM 的 deck 一样需要严格 validate：

1. **JSON Schema** for `*.layout.yaml`（element kinds 是封闭枚举）。
2. **Token validation** 在 theme load 时：layout 引用的 token 必须在 theme.tokens 里存在。
3. **Slot referential integrity**：`{ from: slot.X }` 中 `X` 必须在 layout 自己 declared 的 slots 里。
4. **No code execution**：`when` 条件是封闭谓词集 (`hasSlot` / `eq` / `gt` / `not` / `and` / `or`)，不是 JS 表达式。
5. **Grid overflow check**：area names 在 grid.areas 里都要存在。
6. **Recursion guard**：DSL 不能引用另一个 declarative layout (避免递归地狱)；只能调 region / component / chrome / 内置 kind。

### 1.7 渐进引入

- **Phase 1.1 (foundation, ~1 周)**：解释器 + JSON Schema + loader 集成；实现核心 kinds (`text` / `image` / `shape` / `region-ref` / `repeat`) + grid 解析器。
- **Phase 1.2 (sugar, ~3 天)**：`kind: card`（带 padding/border 的 group） + `children:`、`kind: component-ref` + `kind: chrome-ref`、`when:` 条件谓词集。
- **Phase 1.3 (validate)**：`slideml validate-layout file.layout.yaml --theme X` CLI 命令；boundary lint：theme 包不许 `import` ts 代码（强制走 DSL）。
- **Phase 1.4 (showcase)**：在 `editorial-paper` theme 写 2–3 个 yaml-only layout（`pull-quote-spread` / `drop-cap-essay`）；在 `technical-blue` 写一个 `kpi-with-sparkline-trio` 验证密集型。

### 1.8 风险 / 取舍

- **DSL 复杂度蠕变**：每个新需求都想加 `kind:`。纪律：先用现有 region/component 组合，实在不行再扩 kind。
- **Theme 作者门槛**：YAML 比 ts 友好但仍要懂 grid / token / slot。要写一篇好的 "theme author handbook"。
- **调试**：YAML 编译失败时的报错位置必须清晰（行号、area 名字、token 名字）。Validator 错误信息是一等公民。
- **代码 vs 数据**：极复杂的 layout（matrix-2x2 那种带条件分支的）可能仍然适合写 ts；DSL 不必覆盖 100% case，覆盖 80% 视觉变化就赢了。
- **版本化**：DSL 自身要 `slidemlLayout: 1` 的版本字段，未来 schema 演进有迁移路径。

### 1.9 完整 demo 例子

`themes/editorial-paper/layouts/drop-cap-essay.layout.yaml`：

```yaml
slidemlLayout: 1
name: drop-cap-essay
description: |
  Long-form essay slide. Big drop-cap on the first letter of the body,
  optional pull-quote in a side column. Editorial-paper exclusive.
slots:
  title:    { type: text,       maxChars: 80 }
  body:     { type: text-block, maxChars: 800 }
  pullQuote: { type: text,      maxChars: 120, optional: true }

grid:
  cols: [ 1fr, 0.35fr ]
  rows: [ cm(2), 1fr ]
  gap: cm(1.2)
  margin: cm(2.5)
  areas:
    - [ titleArea, titleArea ]
    - [ bodyArea,  pullArea  ]

elements:
  - at: titleArea
    kind: text
    content: { from: slot.title, parse: inline-markdown }
    style: { size: xl, weight: bold, color: text-strong, align: left, valign: bottom }

  # Drop cap: first character of body in huge serif, floated.
  - at: { x: 0, y: 0, w: cm(3), h: cm(3), parent: bodyArea }
    kind: text
    content: { from: slot.body, transform: firstChar }
    style: { size: 180, weight: bold, color: brand-primary, fontFamily: serif }

  # Body, with the first character clipped (transform: dropFirstChar).
  - at: { x: 0, y: 0, w: 1fr, h: 1fr, parent: bodyArea, padding: { left: cm(3.2) } }
    kind: text
    content: { from: slot.body, transform: dropFirstChar, parse: inline-markdown }
    style: { size: base, color: text-strong, lineHeight: 1.6, columns: 1 }

  - at: pullArea
    when: { hasSlot: pullQuote }
    kind: card
    style: { fill: bg-card, borderLeft: { color: brand-primary, width: pt(3) }, padding: cm(0.6) }
    children:
      - kind: text
        content: { from: slot.pullQuote, parse: inline-markdown }
        style: { size: lg, italic: true, color: text-strong, align: left }
```

LLM 看到的是 `layout: drop-cap-essay`，slots `{ title, body, pullQuote? }` —— 和它写其他 layout 完全一样的体验。但 editorial-paper 借此实现了一个**只属于它自己**的杂志感 drop-cap 排版。

---

## 2. PPTX → SlideML Theme 提取器

### 2.1 战略价值

> "看到一个好看的模板，5 分钟变成自己 deck 能用的 SlideML theme。"

把 SlideML 从 *作者必须懂 token / grid / OOXML* 推进到 *任何能找到一份好 PPTX 的人都能拿到一个不错的 theme*。配合 declarative DSL 形成完整闭环：

```
.pptx 模板 ──extract──> theme.json + theme.md + N × *.layout.yaml + thumbnails/
                                                                     │
                                              human review / refine ─┘
                                                                     │
                                                              SlideML decks
```

LLM 几乎没改动 —— 它仍然只用语义层。新工具是一个 **theme bootstrapping pipeline**。

### 2.2 输入与输出

| 输入 | 形态 |
|---|---|
| `.pptx` 文件 | 用户提供 (公司模板 / Keynote 导出 / Office store 下载) |
| 可选: 参考 deck | 几张已用该模板做好的内容页，用来推理 layout 语义 |
| 可选: 用户描述 | "这是给投行季度汇报用的，比较克制" → 喂给 LLM 推理 meta |

| 输出 | 路径 |
|---|---|
| `<themeName>/theme.json` | tokens / meta / style / oxml |
| `<themeName>/theme.md` | per-layout 描述 + Components / Tokens 章节 |
| `<themeName>/layouts/*.layout.yaml` | 用 declarative DSL 表达的 N 个 layout |
| `<themeName>/thumbnails/*.png` | 重新渲染的缩略图 (round-trip 验证) |
| `<themeName>/EXTRACTION_REPORT.md` | 提取置信度 + 待人工 review 的清单 |

### 2.3 PPTX 内含信息层

| 层 | 提取难度 | 价值 |
|---|---|---|
| `theme1.xml` (clrScheme + fontScheme) | **easy** — 直接 XML 解析 | 直接对应 SlideML tokens / oxml |
| `slideMaster1.xml` + `slideLayout*.xml` | medium | OOXML 自带 24+ 内置版式 |
| `slide*.xml` (实际用过的页面) | medium-hard | 真实使用的版面、字体、间距、色彩 |
| `theme1.xml` 的 `<a:objectDefaults>` | easy | shape / line / text 默认样式 |
| `media/` 目录 | easy | 图片资源；判断有没有 logo / pattern |
| 字号 / 行距统计 | easy | 反推 fontSizes 比例 |
| 图形几何 (位置 / 大小簇) | **hard** | 推理 layout grid、margin、cell 划分 |
| 命名 (`<p:cSld name="封面页">`) | easy | 推理 layout 语义 (cover / 数据页 / 致谢) |
| 占位符 (placeholder type=`title` / `body`) | easy | 推理 slot 语义 |

OOXML 提供的"原料"非常充足。挑战在**从坐标→语义**的反推。

### 2.4 Pipeline

```
.pptx
  │
  ▼
[1] 解包 + XML 解析 ──→ in-memory 模型 (master / layouts / slides / theme1)
  │
  ▼
[2] Tokens 提取 ──→ 12 个色 + 2-3 个字 + 字号谱
  │
  ▼
[3] Layout 簇分析 ──→ 由 OOXML layouts + 实际用过的 slides 聚类，得到 N 个独特版面
  │     └─ ✦ VLM 验证「这两个版式视觉上真的是同一个吗？」
  │
  ▼
[4] Layout → DSL 翻译 ──→ 为每个簇生成一个 *.layout.yaml
  │  ├─ 几何 → grid (带 LLM-aided 命名)
  │  ├─ 占位符 → slots
  │  ├─ 装饰 shapes → 内联到 elements[]
  │  ├─ ✦ VLM: 给每个元素打 "role" 标签 (title / body / decoration / cta / icon / divider)
  │  ├─ ✦ VLM: 验证推理出的 grid 是否符合视觉对齐
  │  └─ ✦ VLM: 识别"这个色块是装饰还是承载意义"
  │
  ▼
[5] LLM/VLM 语义层
  │  ├─ ✦ VLM: 给每个 layout 起语义名 (cover / hero-stat / data-table / ...)
  │  ├─ ✦ VLM: 写 description + guidance
  │  ├─ ✦ VLM: 推理 theme.meta (audiences / industries / moods / antiPatterns)
  │  └─ ✦ VLM: 写 imagery.guidance (基于色板和字体推断风格描述)
  │
  ▼
[6] Round-trip 验证
  │  ├─ 用提取的 theme 重新渲染合成 deck，与原 PPTX 视觉 diff
  │  ├─ 给每个 layout 一个 fidelity score
  │  └─ ✦ VLM: 像素 diff 之外，让 VLM 比对"视觉上一致吗" (仅黄区)
  │
  ▼
[7] EXTRACTION_REPORT.md
     ├─ 哪些 layout fidelity > 0.85 (绿) —— 直接可用
     ├─ 哪些 0.6-0.85 (黄) —— 建议 review
     └─ 哪些 < 0.6 (红) —— 大概率需要手调或丢弃
```

### 2.5 每一步细节

#### Step 1: XML 解析

用 JSZip 解包，xmldom / fast-xml-parser 解析。**不要**直接抓字符串 —— OOXML 命名空间多，要走真正的 DOM。

中间表示：

```ts
interface PptxModel {
  theme: { clrScheme: Record<string, hex>, fontScheme: { major, minor } };
  master: { background, placeholders, defaultText };
  layouts: Array<{
    name: string;
    type: string;                // OOXML "title" / "obj" / "twoObj" 等
    placeholders: Placeholder[];
    decorations: Shape[];        // 母版上画的装饰元素
    backgroundOverride?: Fill;
  }>;
  slidesUsing: Map<layoutId, Slide[]>;  // 哪些实际页用了这个 layout
}
```

#### Step 2: Tokens 提取

```
# 直接映射
bg-canvas       <- master background fill (hex)
brand-primary   <- clrScheme.accent1
brand-deep      <- clrScheme.accent2 (or darker derivation of accent1)
text-strong     <- clrScheme.tx1
text-muted      <- clrScheme.tx2 (or 0.6 * tx1)
accent          <- clrScheme.accent3
divider         <- clrScheme.bg2 darkened, or pull from line defaults
font-latin      <- fontScheme.major.latin → 优先选；加 macOS/Windows fallback
font-cjk        <- fontScheme.major.ea → 加常见 CJK fallback chain
font-mono       <- 静态 [JetBrains Mono, Menlo, Consolas]

# fontSizes 反推：统计所有 placeholder 的 sz 属性
# 取 modes：title sz mode → display；body sz mode → base；
#          caption mode → sm；headline mode → hero
```

**WCAG 反向校验**：如果对比度不达标，给 `EXTRACTION_REPORT.md` 列出，**不**自动修 —— 保留模板的真实风格，让人决定。

#### Step 3: Layout 簇

OOXML 自带 24 个 slideLayout，但模板设计师会魔改。识别策略：

1. 从 `slideLayouts/` 拿到所有版式（含装饰元素 + 占位符布局）。
2. **过滤无用的**：很多模板留着 PowerPoint 默认的 24 个但只魔改 4-5 个；统计实际使用的（哪些 slides 引用过哪个 layout）。
3. **几何聚类**：对装饰 + 占位符的 (x, y, w, h) 向量做 hash 化（量化到 5% 网格），找重复/近似版式。
4. **每簇代表 = 1 个 SlideML layout**。

#### Step 4: 几何 → DSL 翻译（核心难点）

对一个 OOXML layout 的所有元素：

**4a. 推理 grid**
- 收集所有元素的 x 边界（左右）和 y 边界（上下），找出"列槽"和"行槽"。
- 用最少能解释所有元素的网格 = `cols / rows / areas`。
- 例：3 个元素 x=0/0.33/0.66, w=0.33 → cols: [1fr, 1fr, 1fr]。

**4b. 占位符 → slots**

| OOXML placeholder type | 语义 slot 名 + type |
|---|---|
| `title` / `ctrTitle` | `title: text` |
| `subTitle` | `subtitle: text` |
| `body` | `body: text-block` |
| `pic` | `image: image-ref` |
| `tbl` | `table: table` |
| `chart` | `chart: chart-spec` |
| `clipArt` / `dgm` | 当成 `image-ref`，警告 |
| 自定义 named placeholder | 名字直接当 slot 名 |

`maxChars` 推理：取占位符默认字号 + 框尺寸 → 估容量（粗，但够 starting point）。

**4c. 装饰 shapes → element 数组**
- 母版上的装饰元素（color bar / logo bg / page number area）翻成 declarative `kind: shape` 元素，position 用解算好的 grid。
- 颜色尽量映射回 token 名（`fill: { hex: "0F1340" } → fill: brand-deep` if match）。

#### Step 5: LLM/VLM 语义层

PPTX 自带的命名往往是中文或产品名（"封面"/"分章页"），需要：

- **Layout 命名**：拿每个 layout 的（slot 集合 + 装饰摘要 + 缩略图）问 VLM："这看起来像 SlideML 哪个语义 layout？" 答案是 SlideML 32 个 core layout 之一，或 `theme-local-<descriptive-name>`。优先复用 core 名字（让 deck 跨 theme 可移植）。

- **theme.md 草稿**：VLM 收到色板 hex + 字体 + 缩略图，生成 description / when to use / when NOT to use。

- **theme.meta 推理**：相同输入，生成 audiences / industries / moods / antiPatterns。

- **imagery.guidance**：基于色板 + 几张样张生成图像生成提示词。

VLM 的所有输出都标记为 *suggested*，写进 `EXTRACTION_REPORT.md` 让人决定是否接受。**不要自动覆盖人工校对过的字段。**

#### Step 6: Round-trip 验证

最重要的一步 —— 证明提取的 theme 是**忠实的**：

1. 用提取的 theme 渲染一组合成 deck（每个 layout 一页，slot 填占位文字）。
2. 用原 PPTX 的同等版式渲染同样的内容（保留模板原渲染）。
3. 对每页做**像素级 diff**（OpenCV / sharp 或者更简单的 perceptual hash）。
4. fidelity score = `1 - normalized_diff`。

阈值：
- ≥ 0.85 → 绿（直接可用）
- 0.6–0.85 → 黄（建议人工 review 此 layout 的 yaml）
- < 0.6 → 红（很可能 grid 推理失败，需要重做）

#### Step 7: EXTRACTION_REPORT.md

人工 review 的入口。每个 layout 一节：

```markdown
### cover (fidelity 0.92 ✓)
- Inferred from slideLayout1.xml ("封面")
- Slots: title (text, ≤60), subtitle (text, ≤80, optional), eyebrow (text, ≤32, optional)
- Tokens used: bg-canvas, brand-primary, text-strong
- VLM-suggested name: "cover" (matched core layout)
- ⚠ Original used custom font "Noto Sans HK" — fell back to font-cjk chain
- Round-trip diff: thumbnails/cover.diff.png

### kpi-grid (fidelity 0.71 ⚠)
- Inferred from slideLayout7.xml ("数据展示")
- Grid: 3×2, but element widths vary 31% / 35% / 34% → unsure if 1fr/1fr/1fr or weighted
- Suggested fix: open layouts/kpi-grid.layout.yaml and adjust `cols:` if needed
```

### 2.6 CLI

```bash
# Basic
slideml extract-theme path/to/template.pptx --out ~/.cowork/themes/my-brand

# With reference deck for slot-name inference
slideml extract-theme template.pptx --reference example-deck.pptx --out ./themes/my-brand

# Use VLM for naming + role (requires API key)
slideml extract-theme template.pptx --vlm sonnet --out ./themes/my-brand

# Skip LLM/VLM (deterministic, names will be "layout-1", "layout-2", ...)
slideml extract-theme template.pptx --vlm none --out ./themes/my-brand

# Partial — only re-extract tokens (preserve existing layout files)
slideml extract-theme template.pptx --tokens-only --out ./themes/existing
```

### 2.7 工程拆分

| 模块 | 内容 | 估算 |
|---|---|---|
| `extractor/parse.ts` | OOXML XML → in-memory PptxModel | 3 天 |
| `extractor/tokens.ts` | clrScheme + fontScheme + fontSizes 推理 | 1 天 |
| `extractor/layouts.ts` | 簇 + 几何分析 + DSL 生成 | 5 天（最难）|
| `extractor/llm.ts` | LLM/VLM 包装：role / 命名 / 描述 / meta / imagery | 4 天 |
| `extractor/roundtrip.ts` | 渲染对比 + fidelity score | 2 天 |
| `extractor/report.ts` | EXTRACTION_REPORT.md 生成 | 1 天 |
| CLI + 测试 | `slideml extract-theme` 命令 + fixtures | 2 天 |
| `--vlm` flag + cost telemetry | role 中间产物 + 编辑工具 | 2 天 |
| **总计** | | **~20 天** |

依赖于 declarative layout DSL（不然 layouts/*.yaml 没地方落）。

### 2.8 风险 / 取舍

| 风险 | 缓解 |
|---|---|
| **OOXML 千奇百怪** —— PPT、Keynote 导出、第三方模板差异巨大 | 给每个 layout fidelity score；< 0.6 的明确告诉用户"建议手工编辑" |
| **几何反推 grid 出错** | 提供"explicit positioning"逃生：DSL 允许 `at: { x, y, w, h }` 直接给绝对值；提取器对低置信度 layout 直接 fall back 到绝对定位 |
| **字体不可用** | 不修，按 token 链放进 fallback；`EXTRACTION_REPORT.md` 列出原始 family 和回退 |
| **VLM 命名跑偏** | 全部 suggested，落到 report 不写进 theme.json；用户接受才提交 |
| **自动生成的 yaml 难维护** | 每个生成元素附 `# from: slideLayout5.xml shape "Rectangle 12"` 注释，人工编辑时知道源头 |
| **版权 / 模板使用许可** | 工具明确告诉用户提取出的 theme 不规避原模板的许可证；EXTRACTION_REPORT 顶部加一个 "License of source: please check" 提醒 |
| **PPT 自定义动画 / 过渡丢失** | SlideML 当前不支持动画 —— 这条限制变成 README 第一条 known limitation |

---

## 3. VLM 的具体角色

### 3.1 OOXML vs VLM —— 各擅长什么

| 任务 | OOXML 解析 | VLM | 谁赢 |
|---|---|---|---|
| 取颜色 hex | 精确到位 | 截屏 + 取色，会 +/-2 | OOXML |
| 取字体名 | 精确 | 看不出 family，只能猜 serif/sans | OOXML |
| 取占位符位置 (EMU) | 精确 | 像素估算，~5-10% 误差 | OOXML |
| 字号 | 精确（half-pt）| 像素估算 | OOXML |
| **判断"哪个是标题、哪个是装饰"** | 占位符 type 有限，自定义元素分不清 | 一眼能分 | VLM |
| **判断 layout 语义** (cover / divider / dashboard) | 命名"封面"/"slide 5"模糊 | 看截图就懂 | VLM |
| **判断 grid 是 1fr/1fr/1fr 还是加权** | 几何聚类有歧义 | 视觉对齐感天然 | VLM |
| **识别"这是装饰元素，不是内容"** | 难 | 能区分背景色块 vs 内容卡片 | VLM |
| **判断 overall mood / industry / when-to-use** | 完全做不到 | 内行 | VLM |
| **判断装饰元素的视觉重要性** (删掉行不行) | 做不到 | 行 | VLM |

简单原则：**结构 / 数值用 OOXML；语义 / 意图用 VLM**。

### 3.2 三个 VLM 真正解决的硬问题

#### 3.2.1 元素 role 分类（最高 ROI）

OOXML 知道 "shape at (x, y, w, h) with fill #0F1340"，**不知道**这个 shape 是：
- 装饰背景？
- 标题强调条？
- KPI 卡片背景？
- logo 容器？
- divider？

判断错 → 生成的 yaml 里这个元素位置不对、token 不对、最坏情况整个 layout 像素差很大。

VLM 解法（**用一次调用解决整个 layout**）：

```
Prompt 给 VLM：
[图]: layout 缩略图
[结构化]: 每个元素的 (x, y, w, h)、fill、text-content、index 编号
[问题]: 给每个 index 标 role：one of
  title | subtitle | eyebrow | body | bullet-block | image | image-frame
  | kpi-card | kpi-value | kpi-label | logo | decoration-bg | accent-bar
  | divider | page-number | footer-text | section-marker | table | chart
  | callout | watermark
返回 JSON: { 1: "title", 2: "decoration-bg", 3: "accent-bar", ... }
```

这一步把 OOXML 的"原始几何"提升到 SlideML 的"语义元素"，**直接喂给 DSL 生成器**。

#### 3.2.2 Grid 推理验证

几何聚类会输出候选 grid（"看起来像 cols: [1fr, 1fr, 1fr]"），但常常在边界 case 上猜错。VLM 解法：把候选 grid 渲染成示意图（每个 cell 用色块），和原图并排让 VLM 选：

```
Prompt:
[原图]
[候选 A: 视觉化 cols: [1fr, 1fr, 1fr]]
[候选 B: 视觉化 cols: [2fr, 1fr, 1fr]]
[候选 C: 视觉化 cols: [1fr, 1fr] / rows: [1fr, 1fr]]
[问题]: 哪个候选最贴合原图的视觉对齐？
返回: "B" + 1 句解释
```

这是 **VLM 做选择题** 而不是 **VLM 自由生成** —— 准确率高很多。

#### 3.2.3 装饰 vs 内容的语义边界

很多模板的母版上画了大量装饰（背景渐变、品牌色块、logo 水印）。OOXML 把它们和真正的内容元素混在一起。判断哪些应该 promotion 到 SlideML 的 `chrome` 模块、哪些写进 `theme.background`、哪些保留在 layout 的 `elements[]`，VLM 一眼能看出来。

```
For each shape in master/layout:
  1. OOXML 给出: kind, position, fill, has-text
  2. 渲染该 shape 单独高亮的图片
  3. VLM: "这个高亮元素属于哪类：
        background   (该写进 theme.background.image)
        chrome-page  (page-number / brand-bar 等每页重复)
        decoration   (layout 自身的装饰，写进 elements[])
        content      (会被实际 slide 替换的占位符)"
```

### 3.3 不要让 VLM 做的事

负面清单（避免触雷）：

- ❌ **直接生成 yaml**：会拼写错 token 名、写错 schema、坐标全是想象的整数。
- ❌ **测量像素**：让它估"这个 padding 是 cm(0.6)"会不准。这种活给 OOXML。
- ❌ **给颜色取 hex**：截屏取色误差大。直接读 clrScheme。
- ❌ **判断字体 family**：VLM 看不出 Inter 和 Helvetica Neue 的区别。
- ❌ **从图直接判断 fontSize 半点**：让 OOXML 解析 `<a:rPr sz="2400">` 即可。
- ❌ **替代 fidelity score**：VLM 比对鲁棒，但代价高；先用 perceptual hash 过滤，VLM 只复核黄区 layout。

### 3.4 工程实现注意事项

#### A. 给 VLM 的 prompt 要带"结构 + 视觉"双通道

VLM 单看图能判断意图但坐标不准；OOXML 单纯结构没视觉感。**两个一起喂**：

```
你看到的图: [缩略图 1024px PNG]
你看到的结构: [JSON: {elements: [{idx, kind, x_pct, y_pct, w_pct, h_pct, fill, text}]}]
请把每个 idx 标 role: ...
```

VLM 把图当"对齐参考"，把结构当"事实清单"，输出"事实 + 标签"。

#### B. 多模型分工

| 任务 | 模型选择 |
|---|---|
| 元素 role 分类（结构化输出 + 准确率优先）| Sonnet 或更强 |
| Layout 命名 / description / mood | Sonnet（创造性 + 准确）|
| Grid 候选选择题 | Haiku（简单选择）|
| Round-trip 视觉一致性复核 | Sonnet（视觉判断）|

成本：一个典型 PPTX（10–20 个独特 layout）端到端 < $0.5 USD。

#### C. 关键工程化技巧：每个 VLM 步骤都要可关闭

`slideml extract-theme template.pptx --vlm none|haiku|sonnet|opus` —— 让用户在成本和准确率之间选。`--vlm none` 时 fallback 到纯几何 + 启发式命名（"layout-1" / "layout-2"），保持 pipeline 能跑。

#### D. 可解释性

每个 VLM 决策写进 `EXTRACTION_REPORT.md`：

```markdown
### kpi-grid (fidelity 0.78 ⚠)
- VLM role classification (sonnet, conf: high):
  - elem 3 (rect at 0.12, 0.30) → "kpi-card-bg"
  - elem 4 (text "85%")        → "kpi-value"
  - elem 7 (rect at 0, 0)      → "decoration-bg" (✱ promoted to background)
- VLM grid choice (haiku, conf: medium):
  - chose [1fr, 1fr, 1fr] over weighted variants
  - reason: "all three KPI cards visually equal-width"
- VLM layout naming (sonnet):
  - suggested: "kpi-grid-3"
  - matched core SlideML layout: stat-grid-3
  - description: see theme.md
```

让用户能追溯每个判断、必要时手动覆盖。

#### E. 防止"VLM 错位累加"

如果 role 分类错了，下游 grid 推理也会错。架构上要：

1. **先所有 layout 跑 role 分类，落到中间文件供 review。**
2. 用户可以编辑 role 文件再继续。
3. **role 错误的 layout 单独标 ⚠ 不影响其他 layout。**

把 VLM 决策当成可审阅的中间产物，而不是隐形的内部状态。

### 3.5 准确率档位

| 模式 | 输入 | layout 命名 | role 分类 | grid 选择 | 估时 | 估成本 |
|---|---|---|---|---|---|---|
| `--vlm none` | OOXML only | "layout-N" | 启发式（占位符 type）| 几何聚类 | 5s | $0 |
| `--vlm haiku` | OOXML + Haiku | LLM 命名 | Haiku | Haiku 选择题 | 30s | $0.05 |
| `--vlm sonnet` *（推荐默认）* | OOXML + Sonnet | Sonnet | Sonnet | Haiku | 1-2min | $0.20 |
| `--vlm opus` | OOXML + Opus | Opus | Opus | Sonnet | 3-5min | $1.50 |

实测中 sonnet 档应该能让 fidelity > 0.85 的 layout 比例从（纯几何）~50% 提升到 ~80%+。

### 3.6 如果只能选一个 VLM 用法

**元素 role 分类**。这一个能力把所有下游推理变成"基于事实"而不是"基于猜测"。其他 VLM 用途（命名 / mood / grid 选择题）都是 nice-to-have；role 分类是骨架。

### 3.7 一个具体的 prompt 模板

给一个 layout 截图 + 它的元素结构，让 sonnet 输出 role 标签：

```
你将看到一张 PowerPoint 单页版式的截图，以及该页面上每个图形元素的结构化数据
（位置、填充、文字内容）。请为每个元素标记它的"语义角色"。

【可选 role】（必须从这 18 个里选，不要发明新名字）：
title | subtitle | eyebrow | body | bullet-block | image | image-frame
| kpi-card-bg | kpi-value | kpi-label | logo | decoration-bg | accent-bar
| divider | page-number | footer-text | section-marker | other-decoration

【判断要点】：
- decoration-bg = 纯装饰的大色块或纹理，没有承载内容
- accent-bar = 强调用的细色条 (通常 < 5% 高度，brand 色)
- kpi-card-bg = 包含数字 + 说明的卡片背景
- "看起来像背景"的不一定就是 decoration-bg —— 如果是品牌色块，标 accent-bar

【元素列表】：
[结构化 JSON 略]

【截图】：
[1024px PNG]

请用 JSON 返回：{ "<idx>": "<role>", ... }，每个元素都要有标签。
```

这种"从受限词表里选"的 prompt 比"自由描述"准确率高得多，也更容易下游消费。

---

## 4. 长期愿景

```
slideml extract-theme bain-template.pptx        # 5 分钟拿到 theme
slideml refine-theme  ./themes/bain --from-deck slides.pptx  # 用真实 deck 反向校准
slideml share-theme   ./themes/bain             # 推到一个公共 theme registry
slideml use-theme     bain                      # 别的项目一行引入
```

theme 变成一种**社区资产**：营销机构、咨询公司、设计师可以发布 theme 包，公司用户挑一个就能用 LLM 写出风格统一的 deck。SlideML 就从一个 *单工具* 变成一个 *生态*。

---

## 5. 推荐实施顺序（最稳路径）

```
Week 1.0–1.5   Phase 1.1 + 1.2     Declarative DSL foundation + sugar
Week 1.5–2.0   Phase 1.3 + 1.4     Validate CLI + showcase yaml layouts
                                   (在 editorial-paper 加 2-3 个 yaml-only layout)
Week 2.0–3.0   Extractor MVP        纯 OOXML，无 VLM —— 能产出 theme.json + tokens
                                   layout 用占位符 type 命名
Week 3.0–3.5   VLM role 分类        fidelity 立即跳一档
Week 3.5–4.5   完整 grid 推理 + DSL  几何反推那块（最难）
                                   生成
Week 4.5–5.0   VLM 命名 + meta +    最后的打磨
                                   round-trip + report
```

每周末都有可演示的中间产物：

- W1 末：DSL 解释器跑通，能 load yaml-only layout
- W1.5：editorial-paper 里有真实的 yaml-only layout 在用
- W2：`slideml extract-theme --tokens-only` 能用
- W3：role 分类把 fidelity 提升可见
- W4：完整 yaml layouts 输出
- W5：生产可用 + report 闭环

---

## 6. 各阶段 deliverables 一览

| 阶段 | 交付物 |
|---|---|
| Phase 1.1 | `slideml/src/render/declarative-layout.ts` + JSON Schema + loader 集成 |
| Phase 1.2 | `card` / `group` / `chrome-ref` / `component-ref` / `when:` 谓词集 |
| Phase 1.3 | `slideml validate-layout` CLI + boundary lint 强化 |
| Phase 1.4 | `editorial-paper/layouts/{drop-cap-essay,pull-quote-spread}.layout.yaml` + 一个 technical-blue 密集型示例 |
| Extractor 1 | `slideml/src/extractor/{parse,tokens,report}.ts` + `slideml extract-theme --tokens-only` |
| Extractor 2 | `extractor/llm.ts` (role 分类) + role 中间产物 |
| Extractor 3 | `extractor/layouts.ts` 几何 → DSL 生成 |
| Extractor 4 | `extractor/roundtrip.ts` + fidelity score + EXTRACTION_REPORT.md |
| Extractor 5 | VLM 命名 + meta + imagery + 完整 CLI |

---

## 7. 待决问题（开始实施前需要 align）

1. **LLM/VLM provider 抽象**：用 cowork 现有的 agent / model 接口，还是 extractor 自带一套薄包装？
2. **theme 包是单文件 .pptx-style zip 还是目录树？** 当前是目录；提取器输出也保持目录，分发可以另外打包。
3. **Round-trip 渲染 PPTX 用什么？** 用 LibreOffice headless 还是引入一个 pptx 直接到 image 的库？前者在仓库已有依赖。
4. **VLM 调用的并发 / 缓存策略**：role 分类是 N 次调用；要不要按 layout content hash 做磁盘缓存避免 re-extract 时重新调用。
5. **DSL `freeform` 与现有 `freeform` layout 的关系**：现有 freeform 是 agent 输入；DSL element 数组是 theme 作者输入；schema 上能否复用 element subset？

---

## 8. 一句话总结

> Declarative DSL 让 theme 作者表达力十倍化；extractor 让"做一个 theme"
> 的门槛下降十倍；VLM 让 extractor 从"几何对了就行"提升到"真的能用"。
> 三件事按这个顺序做，每件事独立有价值，组合起来形成 SlideML 的下一代
> 形态：**LLM 写语义 + theme 决定外观 + 任何 .pptx 都能变成 theme**。
