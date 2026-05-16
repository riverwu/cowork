生成一个 5 页的商业/科研混合 PPT，主题是“AI 产品分析平台 Q4 发布准备度”。这个用例专门覆盖 SlideML2 新增的 OOXML 级能力，不要绕开这些能力。

输入文件：
- 读取 {{inputsDir}}/brief.md。

工作流要求：
- 必须先用 `read_file` 读取 `/Users/river/.cowork/skills/slideml2/SKILL.md`，严格按其中的 manifest + CLI 工作流执行；不要使用旧的 `create_deck` / `replace_slide` / `validate_render` 工具。
- 先用 `write_file` 保存完整 `plan.md`，说明每页目标、组件选择和新增 OOXML 能力覆盖点。
- 用 SKILL.md 中的 CLI `init-deck` 初始化 `deck-config.json`，并在 deck 配置中设置 `themeOverride.layout.areas`、`master:{layout,placeholders}` 和图表所需 `deck.dataSources`；如果初始化后还需要补充 deck-level 配置，再用 `set-deck` patch。placeholder 至少包含 `title` 和 `body`。
- 每次只写一个 `slides/*.json`，立刻运行 `validate-slide`。若失败，只修正同一个 slide 文件并重跑 `validate-slide`，通过后再写下一页；创建期间和修改期间都不允许批量 validate 或批量生成后再回头修。不要因为难通过而降级到普通文本。
- 严禁用 `run_node` / `run_python` / `write_file` 直接修改 `build/deck.json` 或绕过 CLI 写完整 deck。`write_file` 只用于 `plan.md`、`deck-init.json`、`deck-theme.json`、单页 `slides/*.json`、`manifest.json` 等 SKILL.md 允许的源文件。
- 全部页面通过后，写 `manifest.json` 控制页序，运行 `validate-manifest`，最后用 `compose --write-source build/deck.json --out {{outputPath}}` 生成 PPTX。
- 最终 `compose` 必须成功，PPTX 输出到：{{outputPath}}。

必须覆盖的新增能力：
- 至少 2 页设置 `transition`。
- 至少 1 个 `chart-card` 使用：`xAxis`、`yAxis`、`secondaryYAxis`、`legend:{position:"right"}`、`plotArea:{x:0.04,y:0.04,w:0.78,h:0.86}` 这类 0..1 factor、`xAxis.gridlines:true` 或 `yAxis.gridlines:true`、series 级 `color`/`lineWidth`/`lineDash`/`marker`，并显示数据标签。
- 至少 1 个 `table-card` 使用：`cellPadding`、`borders` 或 per-side border、`borderDash`、`bandRows`/`bandCols`、`tableStyleId`，并在一个 cell 中使用 `padding`、`border` 或 `textRotation`。
- `tableStyleId` 是本测试的硬性覆盖项，最终 `deck.json` 中必须保留 `"tableStyleId"` 字段；不要在修复布局时删除它。
- 至少 1 页使用 raw `shape` 的连接线能力：`preset:"straightConnector"` 或 `preset:"elbowConnector"`，并设置 `tailEnd:{type:"triangle"}`；同时使用一个扩展 shape preset，例如 `flowChartDecision`、`hexagon` 或 `gear6`。这一页不要用 `process-flow` 替代 raw shape；本测试要验证 raw OOXML connector 能力。为了避免工具参数过长，流程图控制在 5-7 个节点以内。如果用 `grid(columns:1)` 承载流程图，节点请设置 `fixedWidth`/`minHeight`，连接线设置 `fixedWidth`/`fixedHeight`，不要让每个 raw shape 占满整行。
- 至少 1 处文本内链跳转到第 5 页，例如富文本 run 的 `link:"#slide5"`，或 markdown 链接 `[跳到附录](#slide5)`。
- 内链也是硬性覆盖项，最终 PPTX XML 必须出现内部 slide jump；建议在标题页使用 `cover-composition.content:{runs:[{text:"跳到附录",link:"#slide5"}]}` 或普通 `text` rich runs，不要只在说明文字中写 `link:#slide5`。

内容结构建议：
1. 标题页：发布准备度结论、master placeholder 生效、跳转附录链接。
2. 指标页：combo/chart-card 展示 adoption、latency、NPS 或 reliability，使用双轴和右侧图例。
3. 准备度表页：table-card 展示 workstream、owner、readiness、attention、action，强调表格样式能力。
4. 发布流程页：用扩展 shape preset 和 connector arrow 表达质量检查流程。
5. 附录页：列出数据假设、设计规范和复核结果。

视觉要求：
- 商业分析风格，浅色背景，高信息密度但不能拥挤。
- 不要把能力堆成 checklist；每页都要有明确叙事和可读的版面。
- 附录页如果用 `icon-text` 展示设计规范/能力覆盖点，必须至少使用 4 种不同的 `icon` preset，例如 `diamond`、`chevron`、`parallelogram`、`arrow-right`、`pentagon`、`cloud`；不要把所有项目都设为 `ellipse`。
- 所有图表、表格、流程图都必须能在最终 PPTX 中实际看见，不允许空白或溢出。
