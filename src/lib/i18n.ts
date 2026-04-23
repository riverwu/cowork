const zh: Record<string, string> = {
  // Sidebar
  "nav.home": "首页",
  "nav.knowledge": "知识库",
  "nav.channels": "通道",
  "nav.activity": "运行监控",
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

  // Suggestions
  "suggestion.summarize": "总结最近文档",
  "suggestion.summarize.text": "帮我总结一下知识库中最近的文档",
  "suggestion.draft": "起草报告",
  "suggestion.draft.text": "帮我基于最近的工作起草一份报告",
  "suggestion.analyze": "分析数据",
  "suggestion.analyze.text": "帮我分析一些数据",

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
  "nav.knowledge": "Knowledge",
  "nav.channels": "Channels",
  "nav.activity": "Activity",
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

  "suggestion.summarize": "Summarize recent docs",
  "suggestion.summarize.text": "Summarize the most recent documents in my knowledge base",
  "suggestion.draft": "Draft a report",
  "suggestion.draft.text": "Help me draft a report based on my recent work",
  "suggestion.analyze": "Analyze data",
  "suggestion.analyze.text": "Help me analyze some data",

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
