---
name: Cowork Workspace
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#434750'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#737781'
  outline-variant: '#c3c6d2'
  surface-tint: '#325ea0'
  primary: '#00346d'
  on-primary: '#ffffff'
  primary-container: '#1a4b8c'
  on-primary-container: '#99bdff'
  inverse-primary: '#aac7ff'
  secondary: '#006a61'
  on-secondary: '#ffffff'
  secondary-container: '#86f2e4'
  on-secondary-container: '#006f66'
  tertiary: '#313539'
  on-tertiary: '#ffffff'
  tertiary-container: '#474c4f'
  on-tertiary-container: '#b8bcc0'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d6e3ff'
  primary-fixed-dim: '#aac7ff'
  on-primary-fixed: '#001b3e'
  on-primary-fixed-variant: '#124687'
  secondary-fixed: '#89f5e7'
  secondary-fixed-dim: '#6bd8cb'
  on-secondary-fixed: '#00201d'
  on-secondary-fixed-variant: '#005049'
  tertiary-fixed: '#dfe3e7'
  tertiary-fixed-dim: '#c3c7cb'
  on-tertiary-fixed: '#171c1f'
  on-tertiary-fixed-variant: '#43474b'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  h1:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  h2:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
    letterSpacing: -0.01em
  h3:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.4'
    letterSpacing: '0'
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: '0'
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: '0'
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.4'
    letterSpacing: 0.02em
  code:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.5'
    letterSpacing: '0'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
  gutter: 20px
  margin-page: 40px
---

## 品牌与风格 (Brand & Style)

该设计系统致力于构建一个**专业 (Professional)**、**智能 (Intelligent)** 且 **高效 (Efficient)** 的 AI 原生办公环境。品牌核心传递出一种冷静的可靠感与前瞻的技术深度。

设计风格采用 **Modern Corporate (现代企业风)** 与 **Glassmorphism (玻璃拟态)** 的融合。整体界面保持极简，通过大量的留白确保在高密度数据下的呼吸感。在 AI 介入或瞬时交互的场景中，引入磨砂玻璃质感，以体现 AI 的灵动与辅助属性，从而在视觉上区分“工具层”与“智能助手层”。

- **核心价值：** 值得信赖、反应迅速、直观无碍。
- **视觉特征：** 细腻的阴影、深邃的蓝色调、半透明的覆盖层。

## 色彩 (Colors)

色彩体系旨在建立高度的专业信任感：

- **Primary (深专业蓝):** 使用 `#1A4B8C` 作为核心交互色，象征稳重与逻辑。
- **Success/AI (翠绿色/青色):** 使用 `#0D9488`。此颜色在系统中具有双重含义：一是作为传统操作成功反馈；二是作为 AI 正在思考或活跃状态的指示色。
- **Backgrounds (软灰):** 背景采用 `#F1F5F9` 及更浅的灰色分层，减少视觉疲劳，替代纯白。
- **Neutrals (中性色):** 用于正文与图标，确保在浅色背景上拥有极佳的对比度。

## 字体排印 (Typography)

字体选用 **Inter**，其极简的几何造型与极高的易读性非常适合处理大量文本和复杂的数据仪表盘。

- **层级设计：** 针对中文环境，适度增加行高（Line Height），确保在 14px 和 16px 的正文阅读时不会感到拥挤。
- **重点强调：** 关键数据或标题使用 600 或 700 的字重。
- **数据对齐：** 在表格数据展示中，优先确保数字与字符的等宽对齐感。

## 布局与间距 (Layout & Spacing)

采用 **Fluid Grid (流式网格)** 系统，以 4px 为基础原子单位。

- **网格系统：** 桌面端建议 12 列布局，列间距 (Gutter) 固定为 20px。
- **节奏感：** 遵循 8px 步进原则（8, 16, 24, 32...），用于定义容器内边距和组件间的垂直间距，以创造严谨的工业美感。
- **自适应：** 侧边栏通常保持 240px-280px 的固定宽度，而主工作区根据视口弹性伸缩。

## 深度与高度 (Elevation & Depth)

该设计系统通过以下两种方式建立视觉深度：

1.  **Tonal Layers (色调分层):** 背景层、内容层、浮动层通过微小的色彩差异（从 #F8FAFC 到 #FFFFFF）实现堆叠。
2.  **Ambient Shadows (环境阴影):** 避免使用高对比度阴影。阴影应是极低不透明度（5-10%）、大模糊半径的蓝色调或中性调，模拟柔和的自然光。
3.  **Glassmorphism (玻璃拟态):** 仅用于 AI 侧边栏、搜索弹窗或瞬时通知。背景模糊度（Backdrop Blur）设定在 12px-20px 之间，并带有 1px 的半透明浅色边框。

## 形状 (Shapes)

本系统采用中等圆角设计，以平衡“专业感”与“易用感”。

- **标准圆角 (8px):** 用于大多数按钮、输入框、卡片。
- **大圆角 (16px):** 用于对话框、大型容器及玻璃拟态浮层。
- **药丸圆角 (Full):** 用于状态标签（Chips/Tags），突出其可交互性。

## 组件 (Components)

- **按钮 (Buttons):** 主要动作采用深蓝色填充，文字白色；次要动作采用淡蓝底色或描边；AI 专用动作可带有微小的青色渐变边框。
- **输入框 (Input Fields):** 默认状态为浅灰填充，激活状态显示 1px 深蓝色边框，并带有极细的焦点阴影。
- **卡片 (Cards):** 白色背景，8px 圆角，配合微弱的 `box-shadow`。
- **AI 交互组件 (AI Elements):** 
    - **AI 气泡:** 带有高斯模糊的玻璃背景。
    - **流式输入指示:** 翠绿色的微动效，表示 AI 正在生成内容。
- **数据列表 (Lists):** 高度一致的行高（48px-56px），行间通过 1px 的极浅灰色线分隔，悬停时出现 `#F1F5F9` 背景高亮。