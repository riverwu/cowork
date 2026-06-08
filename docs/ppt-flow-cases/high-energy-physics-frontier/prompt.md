“高能物理实验已经发展到实验跟不上理论的程度。”制作一个杂志风格的高能物理前沿状态科普 PPT，可以加入合适的插图，关键概念需要有高质量的文字介绍。允许你自行规划结构、叙事和视觉风格。

工作流要求：
- 必须先用 `read_file` 读取 `/Users/river/.cowork/skills/slideml2/SKILL.md`，严格按其中的 manifest + CLI 工作流执行；不要使用旧的 `create_deck` / `replace_slide` / `validate_render` 工具。
- 在正式生成前写 `plan.md`，说明每页目标、视觉方向、图文混排方式，以及可能出现的组件挤压或信息密度风险。
- 使用 SKILL.md 中的 CLI 初始化 `deck-config.json`；每次只写一个 `slides/*.json`，立刻运行 `validate-slide`。若失败，只修正同一个 slide 文件并重跑 `validate-slide`，通过后再写下一页。
- 全部页面通过后，写 `manifest.json` 控制页序，运行 `validate-manifest`，最后用 `compose --out {{outputPath}}` 生成 PPTX。
- 最终 PPTX 输出到：{{outputPath}}

内容与质量要求：
- 建议 6–8 页，面向对前沿科学感兴趣的普通读者，不要做成学术论文摘要或商业汇报。
- 需要解释高能物理前沿为什么会出现“理论想象走在实验可验证性前面”的状态，并清楚介绍标准模型、对撞机、探测器、暗物质/中微子/超对称或其他你认为必要的关键概念。
- 版面应有杂志感、节奏感和留白；请主动控制文本密度，避免卡片堆砌、组件挤压、图文互相压住或段落过长。
- 如果生成或引用图片、图标、粒子轨迹、探测器剖面、能标阶梯等视觉资产，必须实际放入 deck 中，不能只生成不用。
- 每次 `validate-slide` 后根据 validation/render diagnostics 修正当前页面；最终 `validate-manifest` 和 `compose` 必须成功，确保 blocking diagnostics 为 0。
