生成一个 4 页商业/科研混合 PPT，用来覆盖 SlideML2 最新实现的组件能力。

要求：
- 读取输入文件：{{inputsDir}}/brief.md。
- 使用 SlideML2 创建 deck，并通过 replace_slide 逐页生成。
- 覆盖 dataSources、area 布局、chart-card、table-card、hero-stat、stat-strip、process-flow、timeline、equation、code-block、citation、footnote 和 bibliography。
- 版面要接近真实商业/科研汇报，不要做组件堆砌页。
- 每次 replace_slide 后根据工具返回的 validation/diagnostics 自我修正。
- 最终调用 validate_render(render:true)，并把 PPTX 输出到 {{outputPath}}。
