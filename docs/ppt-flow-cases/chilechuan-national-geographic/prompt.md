创建一个图文并茂的 PPT，讲解一下古诗《敕勒川》，需要排版宏大，文字优美，国家地理杂志的风格。

原诗：

> 敕勒川，阴山下。  
> 天似穹庐，笼盖四野。  
> 天苍苍，野茫茫。  
> 风吹草低见牛羊。

工作流要求：
- 必须先用 `read_file` 读取 `/Users/river/.cowork/skills/slideml2/SKILL.md`，严格按其中的 manifest + CLI 工作流执行；不要使用旧的 `create_deck` / `replace_slide` / `validate_render` 工具。
- 在正式生成前，把内容规划、视觉主题、图文混排方式、每页主要组件、可能的密度/重叠风险写入运行工作区的 `plan.md`。
- 使用 SKILL.md 中的 CLI 初始化 `deck-config.json`；每次只写一个 `slides/*.json`，立刻运行 `validate-slide`。若失败，只修正同一个 slide 文件并重跑 `validate-slide`，通过后再写下一页；创建期间和修改期间都不允许批量 validate 或批量生成后再回头修。
- 全部页面通过后，写 `manifest.json` 控制页序，运行 `validate-manifest`，最后用 `compose --write-source build/deck.json --out {{outputPath}}` 生成 PPTX。
- 每次 `validate-slide` 后认真阅读 validation/render diagnostics。若失败，优先修正同一组件的布局、区域、比例、密度、分页或文案长度；不要为了通过 validation 降级为普通纯文本列表。
- 如果 validation 报错看起来像 false positive，需要在后续修正中保持原语义和视觉目标，尽量通过调整几何布局、宽高比、图片裁切、文本长度、区域分配来验证；不要删除关键内容来绕过。
- 最终 `compose` 必须成功，确保 blocking diagnostics 为 0。
- 最终 PPTX 输出到：{{outputPath}}

内容与审美方向：
- 面向高中语文、文学鉴赏或通识教育读者，既讲诗意，也讲地理空间、北朝民歌、游牧视角和宏大景观想象。
- 风格参考国家地理杂志：大幅风景图、沉稳标题、金色/黑色/草原绿色点缀、强烈空间尺度、地图感/地理剖面感、摄影说明式 caption。
- 请实际使用图片、插画或图像资产，不要只在文字里描述“有图片”。可以使用草原、阴山、穹庐、牛羊、风、天幕、古地图/地形等视觉意象。
- 文字要优美、有画面感，但每页信息密度要适合演示，不要把整篇讲稿塞进一页。

建议页数与结构：
1. 封面：用大图或插画建立“天幕压向草原”的宏大第一印象，标题突出《敕勒川》。
2. 原诗全景：逐句呈现原诗，并用空间层级解释“川、山、天、野”的镜头运动。
3. 地理与民族背景：解释敕勒川、阴山、北朝民歌、游牧生活，不做百科堆砌。
4. 诗句视觉化：围绕“天似穹庐，笼盖四野”做图文混排，强调穹庐/天幕/四野的空间隐喻。
5. 语言与节奏：讲叠词、短句、色彩、动静关系，以及“风吹草低见牛羊”的收束。
6. 课堂/讲解收束：给出 3–5 个可带走的鉴赏要点，保持杂志式视觉完整度。

组件使用建议：
- 可使用 `cover-composition`、`image-card`、`feature-card`、`quote-panel`、`timeline`、`map`/raw shape、`stat-strip`、`callout`、`comparison-list`、`evidence-layout`、`hero-and-support` 等适合图文叙事的组件。
- 如果使用 raw `shape` 表达地图、山脉、风向、视线或剖面，注意连接线、箭头和标签不能遮挡正文。
- 长段落应拆成 caption、callout、side note 或多页；不要让文本覆盖图片主体或互相重叠。
