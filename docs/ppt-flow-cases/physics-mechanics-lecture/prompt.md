请基于输入文件制作一份图文并茂的高中/大学低年级物理力学讲义 PPT。

输入文件：
- {{inputsDir}}/物理力学提纲.md

目标：
- 面向课堂讲解，不是摘要报告。需要把长提纲压缩成结构清晰、可直接授课的讲义。
- 必须先用 `read_file` 读取 `/Users/river/.cowork/skills/slideml2/SKILL.md`，严格按其中的 manifest + CLI 工作流执行；不要使用旧的 `create_deck` / `replace_slide` / `validate_render` 工具。
- 在正式生成前写 `plan.md`，说明每页目标、组件选择、视觉说明和密度风险。
- 使用 SKILL.md 中的 CLI 初始化 `deck-config.json`；每次只写一个 `slides/*.json`，立刻运行 `validate-slide`。若失败，只修正同一个 slide 文件并重跑 `validate-slide`，通过后再写下一页；创建期间和修改期间都不允许批量 validate 或批量生成后再回头修。
- 全部页面通过后，写 `manifest.json` 控制页序，运行 `validate-manifest`，最后用 `compose --write-source build/deck.json --out {{outputPath}}` 生成 PPTX。至少 8 页。
- 最终 PPTX 输出到：{{outputPath}}

建议页数和结构：
1. 封面：课程主题和学习路径。
2. 牛顿三大定律：使用 process-flow 或 table-card 讲三条定律之间的关系，不要在同页再堆三张卡片。
3. 牛顿第二定律：突出 F=ma / F=dp/dt，并配一个力与加速度的示意图。
4. 冲量与动量：用流程图说明“力随时间累积 → 动量变化”。
5. 功、能量与守恒：用公式区块 + 简洁对比表。
6. 角动量与圆周运动：用圆周运动受力示意或 diagram/freeform。
7. 万有引力与轨道：用行星轨道插图 + 一条核心公式。
8. 振动与波动：用 timeline/process-flow 或表格说明简谐、阻尼、共振、波动。
9. 公式速查/解题框架：以 table-card 或 stat-strip 收束。

内容建议：
- 从牛顿三大定律开始，串联冲量/动量、能量、角动量、万有引力、圆周运动、振动波动、守恒定律应用框架。
- 每页只讲一个核心概念，公式要少而准，避免整页堆文本。
- 至少包含 3 个公式页面或公式区块，例如 F=ma、冲量动量定理、机械能守恒、万有引力、向心力。
- 至少包含 3 个视觉化说明：可以使用 process-flow、timeline、equation、table-card、diagram/freeform 组合、image-card 或生成的教学插图。
- 如果使用生成图片或图标，必须把生成的图片实际放进 deck；不要生成未使用的资产。
- 每个图示都应服务于教学，比如力与加速度关系图、动量/冲量流程图、圆周运动受力示意、行星轨道示意、守恒定律关系图。

质量要求：
- 主题风格应像现代物理讲义：高对比、留白充分、重点公式突出。
- 中文排版要可读，不能出现标题重复、段落重叠、公式溢出、代码/表格/图示压住正文。
- 每次 `validate-slide` 后认真阅读 validation/diagnostics，必要时重写同一个 slide 文件。
- 完成后必须 `validate-manifest` 并 `compose` 成功，确保 blocking diagnostics 为 0。
