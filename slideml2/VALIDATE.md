# SlideML2 Validate / Render QA 诊断与改进计划

本文档审阅当前 `slideml2/src/validate.ts`、`slideml2/src/render.ts`、
`slideml2/src/diagnostics.ts` 以及 agent 工具层的 `replace_slide` /
`validate_render` 使用方式，整理现有校验策略、算法边界和后续计划。

核心目标：让 SlideML2 在生成 PPTX 前尽可能发现 **覆盖、溢出、空数据、不可读、
不可打开、组件误用** 等交付风险；同时把错误信息做成类似编译器诊断，能指导
agent 保留原语义并修正布局，而不是简单降级组件。

---

## 1. 当前校验链路

当前 validate 不是单一算法，而是四层 gate：

1. **Source validation**：`validateDeck` / `validateSlide` 对 JSON 源做结构、
   schema、theme、data、reference、component contract 校验。
2. **Measurement validation**：`validateLayout` 调用 `measureDeck`，基于
   layout solver 得到每个 node 的 slot rect，检查画布越界和顶层区域覆盖。
3. **Render diagnostics**：`renderToAst` / `renderToPptx` 在实际生成 AST 时
   触发布局容量、文本、表格、图表、颜色、可见性、title occlusion 等诊断。
4. **Tool blocking gate**：`replace_slide` 先跑整 deck source validation，再
   对候选单页执行 `renderToAst` 并读取 `getRenderDiagnostics()`；有 blocking
   diagnostic 时不写入 deck。最终 `validate_render({render:true})` 输出 PPTX、
   render-tree 和 diagnostics JSON。

这意味着：

- `validate.ts` 负责源级合法性和部分几何校验。
- `render.ts` 负责更接近最终输出的容量与视觉诊断。
- agent 实际看到的失败，往往来自 `render.ts` 的 diagnostics，而不是
  `ValidationReport.errors`。

---

## 2. Source Validation 现状

`validateDeck` / `validateSlide` 目前覆盖：

- deck 顶层字段、`slideml2:2`、`deck.size`、`deck.validation.mode`。
- theme override：`colors`、`text`、`component`、`tone`、`layout`、`fonts`、
  `chart`、`chrome`、`imageGrowWeight`、`sizeScale`、`guidance`。
- layout contract：`contentTop/contentBottom`、footer chrome 侵入、named
  `layout.areas`、保留名 `content/full`。
- slide 结构：`id`、`children`、重复 hero/title、顶层 `area` 引用。
- node 结构：缺失/未知 `type`、style-as-type、unknown fields、非法 enum、
  原始字体和颜色误用。
- component contract：required fields、alias fields、嵌套 DomNode 递归校验、
  data-bound required fields。
- data / provenance：dataSources、computed fields、binding/encoding 字段引用、
  references、footnotes、inline citation/math/code extras。
- strict mode：图片 alt、chart/table source metadata。

有效性：

- 对 agent 常见 schema 误用、字段拼错、组件 required 字段缺失、data binding
  错配已经比较有效。
- 对 `themeOverride.layout.contentBottom` 这类“语义容易误解”的字段有明确错误。
- 对 table/chart 绑定字段有源级检查，但真正“渲染后有没有数据”仍由 render
  diagnostics 兜底。

局限：

- schema allowlist、component registry、node-types、SPEC、SKILL 仍然是多处
  同步，虽然已有 registry 基线，但还不是完全单源生成。
- `validateSlide` 的单页 layout pass 使用单页 rendered deck，无法发现跨页
  资产使用、最终完整 deck chrome、全局数据诊断等问题。
- source validation 无法知道 PowerPoint/LibreOffice 的真实排版结果，只能
  验证输入契约。

---

## 3. Layout / Measurement 现状

### 3.1 测量入口

`measureDeck(deck)`：

1. `materializeAndCompactify` 把 source/rendered DOM 物化，组件已经在更早阶段
   展开为 DomNode。
2. `layoutSlide` 解析 slide root，先测 flow 和 slide-level overlay，再测
   `anchorTo` overlay。
3. `measureSubtree` 递归记录 `MeasuredNode {id,type,rect}`。
4. stack/grid/panel/card/band/frame/inset 递归测量子节点。
5. 测量完成后运行 `detectCollisionsForSlide`。

`MeasuredNode.rect` 的语义是 **layout slot**，不是最终文字/图形 ink box。

### 3.2 坐标和区域

`rectForSlideChild` 支持：

- 默认 title：`slide-title` 占用 `titleTop/titleHeight`。
- `area:"content"`：有默认 title 时使用 protected content rect，自动避开
  title band；无 `slide.title` 时可从 `contentTop` 开始用于全页布局。
- `area:"full"`：全画布。
- named `themeOverride.layout.areas`：支持 `{x,y,w,h}` 和
  `{left,top,right,bottom}`。
- `anchor` / `offsetX/Y` / `width/height`。
- `at:[x,y,w,h]` slide-relative absolute rect。
- `anchorTo`：第二 pass 根据目标 node rect 定位。

### 3.3 Fallback ladder

`applyFallbackLadder` 在 stack/grid flow 子项最小需求超过可用空间时运行：

1. solver shrink：flex child 缩到 min。
2. demote density/style：bullets comfortable -> compact，paragraph -> caption。
3. drop optional：移除 `optional:true` 子项。
4. truncate/autofit：给 text/bullets 加 `autoFit:"shrink"`。
5. hard fail：发 `FALLBACK_FAILED`，携带 `measured` 和可能的 `constrainedBy`。

现在的建议已针对关键 component 做语义保留引导：

- `chart-card`：扩大 chart body、调 ratio/rail、先减 labels/legend/series。
- `table-card`：保留表格，调整区域、列宽、density、rowHeights 或分页。
- `code-block`：分页、columns、tiny density、fontSize；`maxLines` 只用于摘要。
- `process-flow`、`evidence-layout`、`donut-summary`、`equation` 等也有专门建议。

有效性：

- 对“内容确实塞不下”的组件，能给出较明确的修复方向。
- `constrainedBy` 对 fixedHeight/fixedWidth 导致的失败有帮助。
- 对 table/code/chart 这类大组件的容量诊断已经比通用碰撞检测可靠。

局限：

- fallback 仍是单次布局过程中的局部修正，但 Stage 4 `autoFit:"shrink"` 已进入
  同一次 child sizing 与 `measureSubtree`：文本 min-height 不再假定 shrink 后
  一定单行，而是按 shrink 后字号下限重新估算高度，再进入碰撞检测。
- autoFit shrink 后的估算字体变化已用于 `inkRect/visualRect`；如果 70% 字号
  下限仍然不能容纳文本，会继续暴露为 `FALLBACK_FAILED` 或真实 ink overlap，
  而不是被错误当作“已单行压缩成功”。
- `DROP` 只是 warn，但可能导致业务内容丢失；当前只能靠 agent 判断其重要性。

---

## 4. Render Diagnostics 现状

`renderToAst` / `renderNode` 触发的诊断包括：

| 类别 | code | 触发点 |
|---|---|---|
| 容量 | `FALLBACK_FAILED` | fallback ladder 或 text/table/bullets fit 失败 |
| 容量 | `CODE_BLOCK_OVERFLOW` | code-block table 行数/高度超过可读容量 |
| 几何 | `COLLISION` | 非 overlay、非容器 leaf 的 visual/ink rect 相交 |
| 几何 | `SIBLING_INK_OVERLAP` | 同 parent flow leaf 的 visual/ink rect 相交 |
| 几何 | `STRUCTURAL_OVERLAP` | sibling container 的可见背景/边框区域相交 |
| 几何 | `OVERLAY_OCCLUDES_FLOW` | slide-level overlay 覆盖正文/图表/表格等 flow 内容 |
| 几何 | `DECORATIVE_OVERLAP` | 明确装饰性节点与内容相交，默认 info |
| 几何 | `TITLE_OCCLUDED` | slide title 被后续 solid shape 覆盖 |
| 几何 | `TINY_RECT` | rect 小到物理上不可读/不可渲染 |
| 几何 | `SQUASHED` | 内容测量确认不可用时为 error；启发式可读性不足时为 warn |
| 数据 | `EMPTY_CHART_DATA` | chart binding/encoding 后无可渲染数据 |
| 数据 | `EMPTY_TABLE_DATA` | object rows 未映射到 body cell 文本 |
| 图表 | `PIE_LABELS_HIDDEN` | pie/doughnut 隐藏 slice label，作为质量告警 |
| 图表 | `SQUASHED` | chart body 小于类型相关建议尺寸，作为质量告警 |
| 可读性 | `LOW_CONTRAST` / `_FIXED` | 文本与背景 contrast 不足或已自动修正 |
| 可见性 | `SHAPE_INVISIBLE` / `_FIXED` | 形状与背景过于接近 |
| token | `UNKNOWN_COLOR` / `UNKNOWN_STYLE` | theme token 无法解析 |
| 软适配 | `OVERFLOW` / `DEMOTED` / `TRUNCATED` / `DROP` | 非阻断修复或质量提示 |

`replace_slide` 和 `validate_render` 的 blocking 策略以工具层为准：

- 所有 `severity:"error"` 都是 blocker。
- 关键 code 即使是 warn 也会被视为 blocker，例如 `COLLISION`。
- `SQUASHED` 不再按 code 天然阻塞：文本/项目符号等真实内容测量失败时由
  `severity:"error"` 阻塞；容器宽度、图表建议尺寸等启发式不足只作为质量信息。
- `TRUNCATED` / `OVERFLOW` 属于 quality diagnostics，不应触发盲目降级组件。

已改进点：

- table 空数据、chart 空数据、code overflow 都已是面向最终产物的强诊断。
  pie label 和 chart 最小区域是质量诊断，默认引导 agent 保留 chart 语义并调整
  区域、ratio、label/legend 密度，而不是强制换组件。
- compiler-like diagnostic formatter 会把 `measured`、`constrainedBy`、
  `surfaceTrail`、component type 和建议结构化给 agent。
- 建议文本已经避免默认引导“换更容易过的组件”，优先建议保留现有语义并调整
  区域、ratio、density、分页。

局限：

- 诊断 code 与 blocking/quality code 已迁移到 `diagnostic-codes.ts` 单源；但
  SKILL/SPEC/tool description 仍需要人工同步，新增 code 时仍有文档漂移风险。
- render-tree 已保存 measured rect、layout decisions、diagnostics 和
  collisions；但这些仍是估算快照，不是 PowerPoint 最终渲染后的 bbox。
- render diagnostics 仍是内部估算 + OOXML AST 级判断，不是最终 PowerPoint
  实际渲染后的像素/文本盒判断。

---

## 5. 当前几何 / 碰撞算法

### 5.1 已有三条路径

| 路径 | 函数 | 范围 | 严重度 |
|---|---|---|---|
| leaf slot collision | `detectCollisionsForSlide` | 非 overlay、非 layered、非 caption、非容器、非祖孙节点两两 AABB | `COLLISION` warn，但工具层 blocker |
| sibling container overlap | `detectSiblingContainerOverlaps` | 同父容器的可见背景/边框区域，包含 slide root 直挂容器 | `STRUCTURAL_OVERLAP` error |
| overlay occlusion | `detectOverlayOcclusions` | slide-level `at/anchor/anchorTo/layer:"above"` overlay 覆盖 flow 内容 | `OVERLAY_OCCLUDES_FLOW` warn，但工具层 blocker |
| title occlusion | `runTitleOcclusionCheck` | slide title 被后续 solid shape 覆盖 | `TITLE_OCCLUDED` error |
| top-level region overlap | `validateTopLevelPlacementOverlaps` | 顶层 `area` region vs 顶层 `at/anchor/anchorTo` 或展开 overlay | `TOP_LEVEL_LAYOUT_OVERLAP` error |

外加 `NODE_OUT_OF_BOUNDS` 检查 measured slot 是否离开 slide 画布。

### 5.2 `detectCollisionsForSlide` 当前过滤

会跳过：

1. slide root；
2. leaf collision 池里的顶层 overlay：`anchor` / `anchorTo` / `at` / `layer`；
3. `relation:"caption-of"` 或 id 以 `.caption` 结尾的 caption；
4. leaf collision 池里的任意 `layer:"behind"|"above"`；
5. leaf collision 池里的任意有 children 的容器；容器背景/外框由 sibling container overlap 单独检测；
6. 祖孙关系。

剩下的 leaf 两两使用统一 `meaningfulOverlap`。当前主路径不再直接使用 layout
slot rect，而是优先使用 `visualRect`，其次 `inkRect`，最后才回退到 `rect`。
这样短文本、badge、marker、line、ellipse、container surface 等不会都被当成
完整 slot 参与碰撞；但文本实际高度超过 slot 时，`inkRect/visualRect` 会保留
溢出的视觉占用，用于发现 paragraph 下压覆盖下一段的问题。

### 5.3 几何原语分散

当前仍有多份几何函数：

- `diagnostics.ts`：保留兼容导出的 `rectsOverlap`，底层复用统一几何实现。
- `validate.ts`：`intersectionRect`、`rectContains`。
- `render.ts`：`fillCoversText`、`rectOverlapArea` 已逐步改为调用统一几何基础。

这些函数的 epsilon、最小面积、覆盖率阈值不同，导致不同诊断对“什么算重叠”
的口径不完全一致。

---

## 6. 有效性判断

当前 validate/render 对以下问题已经比较有效：

- 字段错误、未知组件、required 字段缺失、style/type 混淆。
- `contentBottom` 当成 margin、footer chrome 侵入、未知 named area。
- table-card object rows 映射为空。
- chart-card binding 后无 labels/series。
- pie/doughnut 无 slice label 会给出质量告警，优先恢复/调整标签而不是换组件。
- chart body 低于建议可读尺寸会给出质量告警，优先扩大图表区域、调 ratio 或减少
  label/legend/series 密度。
- code-block 内容超过可显示行数。
- 普通正文、paragraph、bullets、table cell 的估算高度明显不够。
- title 被后续 solid shape 覆盖。
- 低对比度、不可见装饰形状、未知颜色/style token。

但它还不能可靠保证：

- PowerPoint 最终实际换行和估算完全一致。
- 所有文本 ink box 不覆盖相邻文本。
- 所有 overlay 不遮挡正文、chart、table、card。
- 容器外框/card 背景之间无重叠。
- 复杂图形、线、箭头、形状的真实可见部分参与碰撞判断。
- 最终 PPTX 在 PowerPoint、LibreOffice、Keynote 中渲染完全一致。

---

## 7. 主要局限

### L1. slot rect 不是 ink rect

`MeasuredNode.rect` 是布局槽位，不是最终渲染后的文字/图形 bounding box。
文本居中、autoFit、PowerPoint 实际换行、形状 preset 都会让真实 ink 与 slot
差异很大。

影响：

- slot 重叠但视觉不重叠会误报。
- slot 不重叠但文本真实溢出会漏报。
- line / arrow / ellipse / diamond 这种非矩形元素无法准确判断。

### L2. 容器整体碰撞漏检

早期 `collectContainerIds` 直接跳过所有容器。两张 card/panel/container 的
背景或外框重叠时，只比较内部 leaf，可能漏掉“卡片压卡片”的真实视觉问题。
当前已用 `detectSiblingContainerOverlaps` 补上同父容器的 `visualRect` 检测，
并覆盖 slide root 直挂容器。

### L3. overlay 逻辑不统一

overlay 大多从碰撞池排除，只有 title occlusion 和顶层 area overlap 被特判。
因此：

- slide-level `at/anchor/anchorTo` 与嵌套 `layer:"above"` 覆盖 flow 内容会进入
  overlay occlusion 检测。
- `zIndex<0` 或 `layer:"behind"` 会作为背景层豁免；低 alpha overlay 会降级为
  `DECORATIVE_OVERLAP` info。
- pointer-arrow、annotation 的几何语义仍然主要依赖其 `visualRect`，还没有做
  真实矢量路径级覆盖模型。

### L4. 文本估算仍无法等同 PowerPoint

现有估算已经按 CJK/Latin glyph、hard line break、rich runs、paragraph
spacing、table cell padding 做了大量校准，但仍缺少：

- 真实字体 fallback / font substitution。
- PowerPoint text box 内边距、paragraph spacing、baseline 的完整模型。
- OMML equation 的真实高度和 inline baseline。
- chart/table 内部 OOXML 渲染后的真实 label/cell box。

### L5. 几何诊断不够语义化

`COLLISION` 仍然是一种大桶 code，根因可能是：

- sibling gap 太小；
- fixedHeight/fixedWidth 把内容压坏；
- overlay 错位；
- decorative rule 横压正文；
- container/card 背景相交。

agent 需要更明确的 `location`、`related`、`overlapArea`、`overlapRatio`、
`constrainedBy`、parent/ancestor 信息。

### L6. 最终 render artifact 检查不足

当前 `snapshot:png` 可以通过 LibreOffice 导出 PNG，但主要是人工视觉回归；
没有稳定的自动像素断言、文本 bbox 断言或“空白/压扁/覆盖”检测。

### L7. 诊断信息重复维护

blocking code、quality code、diagnostic code 已迁移到 `diagnostic-codes.ts`
单源；SKILL/SPEC/tool description 仍需要人工同步，新增 code 时仍有文档漂移风险。

---

## 8. 改进计划

### P0. 统一诊断与几何基础

1. 新增 `src/layout/geometry.ts`：
   - `intersectionRect`
   - `overlapMetrics`
   - `meaningfulOverlap`
   - `rectContains`
   - `coverageRatio`
   - 统一 epsilon、最小面积、ratio 语义。

2. 新增 `diagnostic-codes.ts`：
   - 单源定义 render diagnostic code、blocking code、quality code。
   - `diagnostics.ts`、`validate_render`、tests、SKILL/SPEC disclosure 复用。

3. 把 `COLLISION` 诊断补齐机器字段：
   - `measured.rect`
   - `measured.other`
   - `overlapAreaCm2`
   - `overlapRatio`
   - `parentId`
   - `relationship`
   - `constrainedBy`（能推断时）。

验收：

- 现有 tests 通过。
- `validate_render` 和 live test runner 使用同一 blocking code source。
- 同一 overlap case 在 render/validate 中返回一致 metrics。

### P1. `inkRect` / `visualRect` 双轨测量

扩展 `MeasuredNode`：

```ts
interface MeasuredNode {
  id: string;
  type: string;
  rect: Rect;          // layout slot
  inkRect?: Rect;      // estimated visible ink
  visualRect?: Rect;   // collision / occlusion rect after role-specific adjustment
  visualRole?: string; // text | container-bg | chart-body | table-body | line | decoration
  alpha?: number;
  relation?: "caption-of" | "annotation-of" | "marker-of";
}
```

计算策略：

- text/bullets：用 `textNeededHeight` / `estimatedTextWidthCm` 反推高度和宽度，
  按 align/valign 放入 slot。
- table：区分 table body、caption、header/body rows 的 estimated rows。
- chart：记录 chart body rect，并保留 title/caption chrome。
- shape：line 使用 stroke capsule 的近似 bbox；ellipse/diamond/triangle 用
  缩小后的 visual bbox。
- container：同时记录 container background visual rect 和 child rect。

当前实现：

- `MeasuredNode` 已包含 `inkRect`、`visualRect`、`visualRole`、`relation`、
  `relatedTo`、`parentId`、`alpha`。
- text/bullets 会估算真实所需高度；高度不再被 slot 强行 clamp。
- 短文本会按 align/valign 得到更紧的视觉 rect，减少 false positive。
- 测量阶段会复用渲染阶段的 `autoFit:"shrink"` 预缩字号计算，但不会重复发
  `TRUNCATED` 诊断，从而避免 display/title/badge 类文本的误报碰撞。
- 普通未绘制背景的 text `inkRect` 只使用可见文字高度，不把 text box padding
  当作可见墨迹；有 fill/line/cornerRadius 的 text 才使用 painted surface。
- 多 paragraph 文本的 `inkRect.w` 取最宽段落/硬换行，而不是把所有段落拼接成
  一行估算，避免 paragraph-rich 内容被错误放大为整槽宽。
- 有 fill/line/cornerRadius 的 text badge/marker 使用其 painted surface 作为
  `visualRect`，避免把单字符 glyph 的字体盒误判为多行溢出。
- shape line/ellipse/diamond/triangle 使用更贴近可见区域的近似 bbox。
- 有 fill/line/gradient 的 stack/grid/panel/card/band/frame/inset 会记录
  container visual rect，用于发现卡片/容器背景相交。

验收：

- 对“两个 paragraph 实际高度重叠”增加回归用例。
- 对“card 背景重叠但 child 不重叠”增加回归用例。
- `COLLISION` / `SIBLING_INK_OVERLAP` / `STRUCTURAL_OVERLAP` 已使用
  `visualRect || inkRect || rect` 的统一碰撞矩形；其中结构性重叠为 error，
  同层 ink 重叠为 warn 但工具层 blocker。

### P2. 统一 occlusion / overlay 检测

把 `runTitleOcclusionCheck` 扩展为通用 `runOcclusionCheck`：

- 读取最终 shape order。
- 考虑 `zIndex`、`layer`、solid fill alpha、shape type。
- overlay 覆盖关键 flow 内容达到阈值时发：
  - `TITLE_OCCLUDED`：title 被挡，error。
  - `OVERLAY_OCCLUDES_FLOW`：正文/图表/表格被挡，warn 或 error。
  - `DECORATIVE_OVERLAP`：低 alpha / behind / 小装饰，info。

验收：

- `at` shape 覆盖 chart-card/table-card body 能被发现。
- background/behind 装饰不误报。
- pointer-arrow 只在大面积遮挡文本时报警。

当前实现：

- 已增加 `detectOverlayOcclusions`，对 slide-level `at/anchor/anchorTo` 与嵌套
  `layer:"above"` overlay 和 flow 内容做 `visualRect` 覆盖检测。
- `layer:"behind"` 与 slide-level `zIndex<0` 不进入遮挡检测。
- 明确装饰节点或低 alpha foreground overlay 走 `DECORATIVE_OVERLAP` info；
  普通 foreground overlay 覆盖 flow 内容走 `OVERLAY_OCCLUDES_FLOW`
  warn/blocking。
- 仍未实现 PowerPoint 最终 shape order 与 alpha compositing 的像素级验证；
  矢量路径级遮挡和真实渲染 artifact QA 属于 P4 或后续更深层能力。

### P3. 拆分 collision code

保留旧 `COLLISION` 作为兼容 alias，同时输出更具体 code：

| 新 code | 含义 |
|---|---|
| `STRUCTURAL_OVERLAP` | 顶层区域或 sibling container 背景重叠 |
| `SIBLING_INK_OVERLAP` | 同 parent flow leaf 的 ink 重叠 |
| `OVERLAY_OCCLUDES_FLOW` | overlay 遮挡 flow 内容 |
| `EDGE_CLIPPED` | node 部分越出画布或 chrome 区 |
| `OFF_SLIDE` | node 完全在画布外 |
| `TIGHT_GAP` | 未重叠但间距过小，info |

验收：

- compiler-like diagnostic 能把这些 code 映射到清晰的 repair strategy。
- agent 首选调整现有 component/area/ratio/gap/分页，不默认换 generic card。

当前实现：

- 已落地 `SIBLING_INK_OVERLAP`、`STRUCTURAL_OVERLAP`、
  `OVERLAY_OCCLUDES_FLOW`、`DECORATIVE_OVERLAP`。
- `COLLISION` 仍保留为跨 parent leaf overlap 的兼容 code。
- `EDGE_CLIPPED`、`OFF_SLIDE`、`TIGHT_GAP` 尚未拆分成独立 code；当前仍由
  `NODE_OUT_OF_BOUNDS`、`TINY_RECT`、`SQUASHED` 等既有诊断覆盖。

### P4. Render artifact 自动 QA（暂缓）

在当前 AST/XML 诊断之外增加可选的最终产物测试：

1. **PPTX package sanity**：
   - 用 unzip/JSZip 检查 OOXML package 结构。
   - 检查 slide rels、media 引用、chart parts、OMML XML 是否完整。

2. **LibreOffice PDF/PNG render gate**：
   - `soffice --headless` 导出 PDF/PNG。
   - 失败即 `PPTX_RENDER_FAILED`。

3. **PDF text bbox 检测**：
   - 用 `pdftotext -bbox-layout` 或等价库提取文本 bbox。
   - 检查文本 bbox 间实质重叠、过小字号、越界、footer/title 侵入。
   - 这是比纯像素更适合发现 paragraph 覆盖的路径。

4. **PNG 像素启发式**：
   - 检测大面积空白、极端压扁图表、空 chart/table 区域。
   - 对 chart/table/card 等 known component 区域计算非背景像素比例。
   - 只作为 quality 或 e2e test gate，不替代 source/render diagnostics。

风险：

- LibreOffice 与 PowerPoint 渲染不完全一致。
- PNG antialiasing 使像素级 golden 容易抖动。
- PDF bbox 对 chart/table/OMML 的结构还原有限。

原则：

- 本阶段暂不实施 P4；先把 source/render diagnostics、结构化几何和 render-tree
  观察能力做稳。
- 默认交互式 `replace_slide` 仍以快速 source/render diagnostics 为主。
- e2e 覆盖测试和最终 `validate_render` 可开启 artifact QA。
- artifact QA 只补最终产物合法性，不把 agent 引导到绕过 SlideML2。

### P5. Render-tree 增强

让 `*.render-tree.json` 不只保存 materialized DOM，也保存：

- `measured.nodes[]`：slot rect、inkRect、visualRect、visualRole、relation。
- `layoutDecisions[]`：intrinsic、applied、notes。
- `diagnostics[]`：该 slide 相关 render diagnostics。
- `collisions[]`：结构化 overlap metrics。
- `dataLineage` / `resolvedData` 已有能力继续保留。

验收：

- debug log 中可以直接定位“第 N 页哪个 node 和哪个 node 重叠/溢出”。
- e2e test report 不需要重新解析 message。

当前实现：

- `*.render-tree.json` 已写入每页 `measured.nodes`，包含 `rect`、
  `inkRect`、`visualRect`、`visualRole`、`relation`、`parentId`。
- 已写入 `layoutDecisions`、slide scoped `diagnostics` 和结构化
  `collisions`。

### P6. 测试策略

新增/强化测试分三层：

1. **Unit fixture**：
   - text height：multi paragraph、CJK/Latin、rich runs、inline math。
   - table row height：object rows、runs、long cell、colWidths。
   - chart min area：pie/doughnut/bar/negative values。
   - code-block capacity。

2. **Collision fixture deck**：
   - tangent 不报。
   - sibling leaf overlap 报。
   - container/card overlap 报。
   - overlay 覆盖 title/chart/table 报。
   - behind/background 装饰不报。

3. **Rendered artifact fixture**：
   - 通过 LibreOffice 导出 PDF/PNG。
   - 文本 bbox 无实质重叠。
   - chart/table 区域非空且未被压扁。
   - package 可被解包并通过 OOXML 引用检查。

---

## 9. 批次安排

| 批次 | 内容 | 结果 |
|---|---|---|
| V1 | `geometry.ts` + diagnostic code 单源 + collision metrics | 统一口径，减少诊断漂移 |
| V2 | measured `inkRect/visualRole/relation` + render-tree measured snapshot | 让 validate 更接近真实视觉占用 |
| V3 | 通用 occlusion + collision 子码 + compiler diagnostic 映射 | agent 能根据根因修复，而不是降级组件 |
| V4（暂缓） | PDF text bbox + PPTX package sanity + PNG 启发式 QA | 捕捉最终产物层面的重叠、空白、压扁 |
| V5 | 全量 e2e report 接入 artifact QA 和改进计划生成 | 每次真实 LLM 运行都能产出可执行改进计划 |

每批次完成后必须：

- 跑 `pnpm --dir slideml2 test`。
- 跑相关 fixture / e2e case。
- 如新增 diagnostic code，同步 `diagnostics.ts`、tool blocking/quality code、
  SPEC、SKILL、compiler formatter。
- 不做针对单个 case 的 workaround；修复必须符合语义契约和组件接口。

当前实现状态：

- V1 已完成。
- V2 已完成到可作为 validate 主路径使用：碰撞、overlay occlusion、
  top-level overlap 均优先使用 `visualRect/inkRect`。
- V3 已完成主要 blocker code 和 compiler diagnostic 映射；`EDGE_CLIPPED` /
  `OFF_SLIDE` / `TIGHT_GAP` 仍保留为后续细分项。
- V4 明确暂缓。
- V5 的 e2e 报告与改进计划流程已有基础；artifact QA 接入等待 P4。

---

## 10. 结论

当前 SlideML2 validate 已经不只是 schema 检查：它包含 source contract、
layout solver、component capacity、render diagnostics、工具层 blocking gate。
最有效的部分是组件容量和数据合法性诊断；最薄弱的部分仍是 **最终视觉几何**：
slot 不等于 ink，overlay/容器碰撞不完整，且缺少自动 render artifact 检查。

下一阶段的关键不是继续堆单个组件规则，而是建立统一几何基础、结构化诊断、
`inkRect` 视觉占用模型，以及可选的 PDF/PNG 最终产物 QA。这样 agent 才能在
保留组件语义的前提下可靠修正排版。
