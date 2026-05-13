生成一个 4 页商业/科研混合 PPT，用来覆盖 SlideML2 最新实现的组件能力。

要求：
- 读取输入文件：{{inputsDir}}/brief.md。
- 必须先用 `read_file` 读取 `/Users/river/.cowork/skills/slideml2/SKILL.md`，严格按其中的 manifest + CLI 工作流执行；不要使用旧的 `create_deck` / `replace_slide` / `validate_render` 工具。
- 在正式生成前写 `plan.md`，说明每页目标、组件选择、dataSources、area 布局和密度风险。
- 使用 SKILL.md 中的 CLI 初始化 `deck-config.json`；每次只写一个 `slides/*.json`，立刻运行 `validate-slide`。若失败，只修正同一个 slide 文件并重跑 `validate-slide`，通过后再写下一页；创建期间和修改期间都不允许批量 validate 或批量生成后再回头修。
- 全部页面通过后，写 `manifest.json` 控制页序，运行 `validate-manifest`，最后用 `compose --write-source build/deck.json --out {{outputPath}}` 生成 PPTX。
- 覆盖 dataSources、area 布局、chart-card、table-card、hero-stat、stat-strip、process-flow、timeline、equation、code-block、citation、footnote 和 bibliography。
- 版面要接近真实商业/科研汇报，不要做组件堆砌页。
- 每次 `validate-slide` 后根据工具返回的 validation/diagnostics 自我修正。
- 最终 `validate-manifest` 和 `compose` 必须成功，并把 PPTX 输出到 {{outputPath}}。
