生成一个 4 页办公室经营结构说明 PPT，读取 {{inputsDir}}/brief.md。

必须先读取 /Users/river/.cowork/skills/slideml2/SKILL.md，并使用 SlideML2 manifest + CLI 工作流：
- 先 init-deck。
- 每页写入 slides/*.json 后立即 validate-slide。
- 最后 validate-manifest，再 compose 到 {{outputPath}}，并写出 build/deck.json。

必须包含：
- 第 2 页使用 `org-chart`，slide id 为 `org-pyramid-org`，组件 id 必须为 `org-pyramid-org.diagram`。
- 第 3 页使用 `pyramid`，slide id 为 `org-pyramid-pyramid`，组件 id 必须为 `org-pyramid-pyramid.diagram`。
- `org-chart` 节点需要有不同内容量：有的节点只有角色，有的节点包含 role、people、badge、icon、surface 设置。
- `pyramid` 每层需要使用不同 widthRatio/height 或 heightWeight，并包含 title、body/items/contents、icon、badge/badges；需要展示一层内多个水平内容块时使用 `contents: [{title, content}]`；业务数字放入 body/items/contents，不使用独立 metric 字段。
- 两个组件都要使用 themeOverride 中定义的 text style key，不要在节点中硬编码字体族。

页面建议：
1. 封面：客户运营经营结构复盘。
2. 组织图：客户运营组织与经营看板。
3. 金字塔：经营成熟度金字塔。
4. 收束页：关键落地检查点。

视觉要求：商务办公风格，浅背景，清晰层级，连接线和层级边界可见，但不要用装饰性渐变或大面积营销风 hero。
