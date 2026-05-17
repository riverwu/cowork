请基于输入 Excel 中的数据以及图表，生成一份面向经营管理层的人力数据分析 PPT。

输入文件：
- {{inputsDir}}/25年上半年人力数据分析-V1.xlsx

工作流要求：
- 必须先用 `read_file` 读取 `/Users/river/.cowork/skills/slideml2/SKILL.md`，严格按其中的 manifest + CLI 工作流执行；不要使用旧的 `create_deck` / `replace_slide` / `validate_render` 工具。
- Excel 是结构化二进制文件，read_file 只能作为快速预览；必须通过 `shell` 运行 Python/openpyxl 或等价脚本读取工作表、单元格区域、公式结果和图表元数据，不要使用 `run_python` 或 `run_node` 绕过本 case 的标准 CLI 流程。
- 不允许使用 web_search / web_fetch；本测试只评估基于用户提供 Excel 的离线分析能力。
- 将你对 Excel 的结构理解、关键数值、图表重建方案和页结构写入工作区的 `plan.md` 或 `source_notes.md`。
- 使用 SKILL.md 中的 CLI 初始化 `deck-config.json`；每次只写一个 `slides/*.json`，立刻运行 `validate-slide`。若失败，只修正同一个 slide 文件并重跑 `validate-slide`，通过后再写下一页；创建期间和修改期间都不允许批量 validate 或批量生成后再回头修。
- 全部页面通过后，写 `manifest.json` 控制页序，运行 `validate-manifest`，最后用 `compose --out {{outputPath}}` 生成 PPTX；deck source sidecar 由 CLI 自动输出。
- 最终 PPTX 输出到：{{outputPath}}

已知输入结构（仍需你用 Python 核验）：
- 工作表“底表”：A1:S71，包含 2024.01 到 2025.06 的月度销售额、SI 收入、人力成本和人数等底层数据。
- 工作表“主要发现”：A1:M48，包含四块分析：YTD 各职能人力占比、半年度营收&人力同比、渠道分析、整体发现；其中包含一个标题为“各职能人力占比”的饼图。

内容要求：
- 生成 6-8 页中文管理汇报 PPT，主题是“2025 年上半年人力数据分析”。
- 必须真实使用 Excel 数据，不得编造或只复述 prompt。关键百分比、金额、人数、ROI 需来自工作簿或由工作簿数据计算得到。
- 至少包含 1 页对“各职能人力占比”的图表页：可以根据 Excel 饼图对应数据重建 chart-card/pie chart，并解释销售、研发、售后、市场等结构。
- 至少包含 1 页“半年度营收&人力同比”：展示 2024 H1 vs 2025 H1 的营收、人力成本、HC、人效、人力成本 ROI，并突出同比变化。
- 至少包含 1 页“渠道效率分析”：使用渠道表比较京东、天猫、抖音、达播、线下经销的收入同比、成本同比、ROI 变化和人员配置。
- 至少包含 1 页“管理动作建议”：围绕线下经销、京东、抖音/直播、研发效率、人力配置给出可执行建议。
- 至少包含一页清晰标注数据来源为该 Excel 文件和对应 sheet/range。

设计要求：
- 风格应像经营分析会材料：干净、商业化、数据优先，避免花哨装饰。
- 避免直接截图堆叠 Excel；需要把关键表格和图表转译成可读的 SlideML2 chart-card、table-card、stat-strip、kpi-grid、bar-list、callout 或 process-flow。
- 可以在少量页面使用 Excel 图表作为参考，但最终 PPT 中的图表必须可读，并且不能出现文字重叠、表格溢出、标题重复、页脚压正文。
- 若数据较密，主动分页；不要把整张渠道表硬塞进一页。
- 每次 `validate-slide` 后认真阅读 validation/diagnostics，必要时重写同一个 slide 文件。
- 完成后必须 `validate-manifest` 并 `compose` 成功，确保 blocking diagnostics 为 0。
