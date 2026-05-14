请收集公开信息，并生成一份精美的有道公司介绍 PPT。

目标公司：
- 有道 / 网易有道 / Youdao, Inc.

工作流要求：
- 使用 web_search 收集公开信息，优先官方来源：公司官网、投资者关系、年度报告/财报、新闻稿、产品页面。
- 对关键来源使用 web_fetch 获取正文或网页内容；不要只依赖搜索摘要。
- 必须先用 `read_file` 读取 `/Users/river/.cowork/skills/slideml2/SKILL.md`，严格按其中的 manifest + CLI 工作流执行；不要使用旧的 `create_deck` / `replace_slide` / `validate_render` 工具。
- 将调研来源、关键事实、取舍判断写入运行工作区的 `source_notes.md` 或 `plan.md`。
- 使用 SKILL.md 中的 CLI 初始化 `deck-config.json`；每次只写一个 `slides/*.json`，立刻运行 `validate-slide`。若失败，只修正同一个 slide 文件并重跑 `validate-slide`，通过后再写下一页；创建期间和修改期间都不允许批量 validate 或批量生成后再回头修。
- 全部页面通过后，写 `manifest.json` 控制页序，运行 `validate-manifest`，最后用 `compose --write-source build/deck.json --out {{outputPath}}` 生成 PPTX。
- 最终 PPTX 输出到：{{outputPath}}

内容要求：
- 生成 7-9 页公司介绍 PPT，面向投资人、合作伙伴或新员工介绍场景。
- 建议结构：封面、公司概览、发展历程、核心业务/产品矩阵、技术与 AI 能力、商业模式与财务/经营亮点、竞争与市场定位、未来机会与风险、结尾总结。
- 必须标明关键信息来源，优先在页脚、脚注、speaker notes 或结尾来源页中呈现。
- 如果公开信息不足，不要编造；用“公开资料未披露/需进一步核验”表达。

设计要求：
- 风格应精美、现代、商业化，适合公司介绍或路演。
- 避免大段文字堆叠；使用 chart-card、table-card、timeline、stat-strip、feature-card、process-flow、callout 等组件组织信息。
- 可以使用品牌感配色，但不要复制或伪造官方商标资产；需要图标或插图时，必须把生成/引用的资产实际放进 deck。
- 完成后必须 `validate-manifest` 并 `compose` 成功，确保 blocking diagnostics 为 0。
