const zh: Record<string, string> = {
  // Sidebar
  "nav.home": "首页",
  "nav.apps": "应用",
  "nav.knowledge": "知识库",
  "nav.channels": "通道",
  "nav.settings": "设置",

  // Home
  "home.greeting.morning": "早上好，今天需要什么帮助？",
  "home.greeting.afternoon": "下午好，有什么需要协助的吗？",
  "home.greeting.evening": "晚上好，在处理什么工作？",
  "home.input.placeholder": "告诉我你想做什么...",
  "home.input.thinking": "思考中...",
  "home.pending": "待处理",
  "home.recentOutputs": "最近产出",
  "home.myApps": "我的应用",
  "home.createApp": "创建应用",
  "home.noPending": "暂无待处理事项",
  "home.noOutputs": "暂无产出记录",
  "home.configHint": "前往设置页面配置 LLM API 密钥即可开始使用。",
  "home.knowledgeHint": "在知识库页面添加工作文件夹，让 AI 了解你的工作内容。",
  "home.backToHome": "返回首页",
  "home.clearConversation": "开始新话题",

  // Suggestions
  "suggestion.summarize": "总结最近文档",
  "suggestion.summarize.text": "帮我总结一下知识库中最近的文档",
  "suggestion.draft": "起草报告",
  "suggestion.draft.text": "帮我基于最近的工作起草一份报告",
  "suggestion.analyze": "分析数据",
  "suggestion.analyze.text": "帮我分析一些数据",

  // Apps
  "apps.title": "应用",
  "apps.myApps": "我的应用",
  "apps.create": "创建应用",
  "apps.noApps": "还没有应用。通过对话完成任务后，可以保存为可复用的应用。",
  "apps.run": "运行",
  "apps.edit": "编辑",
  "apps.delete": "删除",
  "apps.deleteConfirm": "确定要删除这个应用吗？",
  "apps.lastRun": "上次运行",
  "apps.never": "从未运行",
  "apps.name": "应用名称",
  "apps.goal": "目标",
  "apps.goalPlaceholder": "描述这个应用要做什么...",
  "apps.schedule": "定时执行",
  "apps.save": "保存",
  "apps.cancel": "取消",

  // Connections (MCP)
  "connections.title": "已连接的服务",
  "connections.add": "添加连接",
  "connections.noConnections": "还没有连接外部服务。",
  "connections.noConnectionsHint": "连接外部服务（数据库、API、文件系统等）让应用获得更多能力。",
  "connections.tools": "个工具",
  "connections.connected": "已连接",
  "connections.disconnected": "未连接",
  "connections.remove": "移除",
  "connections.reconnect": "重新连接",
  "connections.disable": "停用",
  "connections.enable": "启用",
  "connections.disabled": "已停用",
  "connections.connecting": "连接中...",
  "connections.builtin": "内置",
  "connections.presets": "推荐服务",
  "connections.custom": "自定义",
  "connections.command": "启动命令",
  "connections.commandPlaceholder": "例如: npx -y @modelcontextprotocol/server-filesystem /path",
  "connections.id": "服务名称",
  "connections.idPlaceholder": "例如: filesystem",

  // Knowledge
  "knowledge.title": "知识库",
  "knowledge.addFolder": "添加文件夹",
  "knowledge.adding": "添加中...",
  "knowledge.noSources": "还没有知识来源。",
  "knowledge.addHint": "添加工作文件夹，让 AI 了解你的工作。",
  "knowledge.myDocs": "我的文档",
  "knowledge.outputs": "Cowork 产出",
  "knowledge.knowledgeSource": "知识来源",
  "knowledge.files": "个文件",
  "knowledge.exclude": "排除",
  "knowledge.include": "包含",

  // Settings
  "settings.title": "设置",
  "settings.provider": "LLM 服务商",
  "settings.apiKey": "API 密钥",
  "settings.baseUrl": "API 地址",
  "settings.baseUrl.optional": "（可选）",
  "settings.baseUrl.hint": "自定义接口地址，兼容 Ollama、vLLM、Azure OpenAI 等。",
  "settings.model": "模型",
  "settings.customModel": "使用自定义模型 ID",
  "settings.presetModel": "从预设中选择",
  "settings.save": "保存",
  "settings.saving": "保存中...",
  "settings.saved": "已保存",

  // General
  "coming_soon": "即将推出",
  "starting": "启动中...",
  "db.error": "数据库初始化失败",
};

const en: Record<string, string> = {
  "nav.home": "Home",
  "nav.apps": "Apps",
  "nav.knowledge": "Knowledge",
  "nav.channels": "Channels",
  "nav.settings": "Settings",

  "home.greeting.morning": "Good morning, what do you need today?",
  "home.greeting.afternoon": "Good afternoon, what can I help with?",
  "home.greeting.evening": "Good evening, what are you working on?",
  "home.input.placeholder": "Tell me what you want to do...",
  "home.input.thinking": "Thinking...",
  "home.pending": "Pending",
  "home.recentOutputs": "Recent Outputs",
  "home.myApps": "My Apps",
  "home.createApp": "Create App",
  "home.noPending": "No pending items",
  "home.noOutputs": "No recent outputs yet",
  "home.configHint": "Go to Settings to configure your LLM API key and start working.",
  "home.knowledgeHint": "Add a work folder in Knowledge to give AI context about your work.",
  "home.backToHome": "Back to Home",
  "home.clearConversation": "Start new topic",

  "suggestion.summarize": "Summarize recent docs",
  "suggestion.summarize.text": "Summarize the most recent documents in my knowledge base",
  "suggestion.draft": "Draft a report",
  "suggestion.draft.text": "Help me draft a report based on my recent work",
  "suggestion.analyze": "Analyze data",
  "suggestion.analyze.text": "Help me analyze some data",

  "apps.title": "Apps",
  "apps.myApps": "My Apps",
  "apps.create": "Create App",
  "apps.noApps": "No apps yet. Complete a task via conversation, then save it as a reusable app.",
  "apps.run": "Run",
  "apps.edit": "Edit",
  "apps.delete": "Delete",
  "apps.deleteConfirm": "Are you sure you want to delete this app?",
  "apps.lastRun": "Last run",
  "apps.never": "Never",
  "apps.name": "App Name",
  "apps.goal": "Goal",
  "apps.goalPlaceholder": "Describe what this app should do...",
  "apps.schedule": "Schedule",
  "apps.save": "Save",
  "apps.cancel": "Cancel",

  "connections.title": "Connected Services",
  "connections.add": "Add Connection",
  "connections.noConnections": "No external services connected.",
  "connections.noConnectionsHint": "Connect external services (databases, APIs, file systems) to give apps more capabilities.",
  "connections.tools": "tools",
  "connections.connected": "Connected",
  "connections.disconnected": "Disconnected",
  "connections.remove": "Remove",
  "connections.reconnect": "Reconnect",
  "connections.disable": "Disable",
  "connections.enable": "Enable",
  "connections.disabled": "Disabled",
  "connections.connecting": "Connecting...",
  "connections.builtin": "Built-in",
  "connections.presets": "Recommended",
  "connections.custom": "Custom",
  "connections.command": "Start command",
  "connections.commandPlaceholder": "e.g. npx -y @modelcontextprotocol/server-filesystem /path",
  "connections.id": "Service name",
  "connections.idPlaceholder": "e.g. filesystem",

  "knowledge.title": "Knowledge",
  "knowledge.addFolder": "Add Folder",
  "knowledge.adding": "Adding...",
  "knowledge.noSources": "No knowledge sources yet.",
  "knowledge.addHint": "Add a work folder to give AI context about your work.",
  "knowledge.myDocs": "My Documents",
  "knowledge.outputs": "Cowork Outputs",
  "knowledge.knowledgeSource": "Knowledge source",
  "knowledge.files": "files",
  "knowledge.exclude": "Exclude",
  "knowledge.include": "Include",

  "settings.title": "Settings",
  "settings.provider": "LLM Provider",
  "settings.apiKey": "API Key",
  "settings.baseUrl": "API Base URL",
  "settings.baseUrl.optional": "(optional)",
  "settings.baseUrl.hint": "Custom endpoint for proxies or compatible services (e.g. Ollama, vLLM, Azure OpenAI).",
  "settings.model": "Model",
  "settings.customModel": "Use custom model ID",
  "settings.presetModel": "Choose from presets",
  "settings.save": "Save",
  "settings.saving": "Saving...",
  "settings.saved": "Saved",

  "coming_soon": "Coming soon",
  "starting": "Starting...",
  "db.error": "Failed to initialize database",
};

let currentLocale: "zh" | "en" = "en";

export function initLocale() {
  const lang = navigator.language.toLowerCase();
  currentLocale = lang.startsWith("zh") ? "zh" : "en";
}

export function t(key: string): string {
  const dict = currentLocale === "zh" ? zh : en;
  return dict[key] || key;
}

export function getLocale(): "zh" | "en" {
  return currentLocale;
}
