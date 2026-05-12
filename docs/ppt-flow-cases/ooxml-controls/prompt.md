生成一个 5 页的商业/科研混合 PPT，主题是“AI 产品分析平台 Q4 发布准备度”。这个用例专门覆盖 SlideML2 新增的 OOXML 级能力，不要绕开这些能力。

输入文件：
- 读取 {{inputsDir}}/brief.md。

工作流要求：
- 先用 `write_file` 保存完整 `deck_plan.md`，说明每页目标、组件选择和新增 OOXML 能力覆盖点。
- 用 `create_deck` 创建 deck，必须在初始调用中设置 `themeOverride.layout.areas` 和 `master:{layout,placeholders}`。placeholder 至少包含 `title` 和 `body`。
- 逐页通过 `replace_slide` 生成，不要直接写 deck JSON。每次失败都根据 validation/diagnostics 修正同一个组件或布局，不要因为难通过而降级到普通文本。
- 最终调用 `validate_render({render:true})`，PPTX 输出到：{{outputPath}}。

必须覆盖的新增能力：
- 至少 2 页设置 `transition`。
- 至少 1 个 `chart-card` 使用：`xAxis`、`yAxis`、`secondaryYAxis`、`legend:{position:"right"}`、`plotArea:{x,y,w,h}`、`xAxis.gridlines:true` 或 `yAxis.gridlines:true`、series 级 `color`/`lineWidth`/`lineDash`/`marker`，并显示数据标签。
- 至少 1 个 `table-card` 使用：`cellPadding`、`borders` 或 per-side border、`borderDash`、`bandRows`/`bandCols`、`tableStyleId`，并在一个 cell 中使用 `padding`、`border` 或 `textRotation`。
- 至少 1 页使用 raw `shape` 的连接线能力：`preset:"straightConnector"` 或 `preset:"elbowConnector"`，并设置 `tailEnd:{type:"triangle"}`；同时使用一个扩展 shape preset，例如 `flowChartDecision`、`hexagon` 或 `gear6`。这一页不要用 `process-flow` 替代 raw shape；本测试要验证 raw OOXML connector 能力。为了避免工具参数过长，流程图控制在 5-7 个节点以内。
- 至少 1 处文本内链跳转到第 5 页，例如富文本 run 的 `link:"#slide5"`，或 markdown 链接 `[跳到附录](#slide5)`。

内容结构建议：
1. 标题页：发布准备度结论、master placeholder 生效、跳转附录链接。
2. 指标页：combo/chart-card 展示 adoption、latency、NPS 或 reliability，使用双轴和右侧图例。
3. 风险表页：table-card 展示 workstream 风险、owner、readiness、action，强调表格样式能力。
4. 发布流程页：用扩展 shape preset 和 connector arrow 表达质量门禁流程。
5. 附录页：列出数据假设、设计规范和复核结果。

视觉要求：
- 商业分析风格，浅色背景，高信息密度但不能拥挤。
- 不要把能力堆成 checklist；每页都要有明确叙事和可读的版面。
- 附录页如果用 `icon-text` 展示设计规范/能力覆盖点，必须至少使用 4 种不同的 `icon` preset，例如 `diamond`、`chevron`、`parallelogram`、`arrow-right`、`pentagon`、`cloud`；不要把所有项目都设为 `ellipse`。
- 所有图表、表格、流程图都必须能在最终 PPTX 中实际看见，不允许空白或溢出。
