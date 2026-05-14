仔细思考，帮我做一个介绍香格里拉的ppt。要求文字优美丰富，排版富有创意，图文混排，杂志级别水平。仔细思考，反复规划，做出好的ppt规划和排版规划，并且最终生成ppt。

工作流要求：
- 必须先用 `read_file` 读取 `/Users/river/.cowork/skills/slideml2/SKILL.md`，严格按其中的 manifest + CLI 工作流执行；不要使用旧的 `create_deck` / `replace_slide` / `validate_render` 工具。
- 在正式生成前，把内容规划、视觉主题、图文混排方式、每页主要组件和密度风险写入运行工作区的 `plan.md`。
- 使用 SKILL.md 中的 CLI 初始化 `deck-config.json`；每次只写一个 `slides/*.json`，立刻运行 `validate-slide`。若失败，只修正同一个 slide 文件并重跑 `validate-slide`，通过后再写下一页；创建期间和修改期间都不允许批量 validate 或批量生成后再回头修。
- 全部页面通过后，写 `manifest.json` 控制页序，运行 `validate-manifest`，最后用 `compose --write-source build/deck.json --out {{outputPath}}` 生成 PPTX。
- 这是一个相对自由的创意排版压力测试：不要把页面做成普通文字列表；优先使用图文混排、非对称版面、局部留白、引文、路线/地理/文化叙事、图片或插画资产、卡片、时间线、stat-strip、feature-card、process-flow、callout、image-card 等适合内容的组件。
- 如果使用图片、图标或插画资产，必须实际放入 deck 中，不能只生成不用。
- 每次 `validate-slide` 后根据 validation/render diagnostics 修正当前页面，再继续下一页。
- 最终 `validate-manifest` 和 `compose` 必须成功，确保 blocking diagnostics 为 0。
- 最终 PPTX 输出到：{{outputPath}}

内容方向建议：
- 面向对自然、文化、旅行美学感兴趣的读者，像一本精致旅行杂志的专题开篇。
- 可以围绕“高原天空、雪山峡谷、藏地文化、松赞林寺、普达措、独克宗古城、梅里雪山眺望、季节与路线、旅行方式”等展开，但请自行规划取舍，不要机械堆砌景点。
- 文字要有画面感和节奏感，同时保持信息准确、可读、适合展示。
