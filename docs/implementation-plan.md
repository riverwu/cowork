# Cowork — Implementation Plan

## Architecture Principle

**Webview 不与网络交互。** Webview 层（React）只负责界面渲染和用户交互。所有网络请求、文件系统操作、数据库访问等 I/O 行为都通过 Rust 应用层（Tauri Commands）完成。

- 禁止在前端代码中使用 `fetch`、`XMLHttpRequest` 等浏览器网络 API
- LLM API 调用 → Rust `http_stream_post` / `http_post` command
- 文件读写 → Rust `scan_directory` / `parse_document` command
- 数据库 → Tauri SQL plugin（经过 Rust 层）
- 这确保了：无 CORS 问题、可审计的网络出口、一致的 I/O 路径

## Architecture Overview

桌面应用，macOS + Windows 双平台。本地优先，无需服务器。

```
┌─────────────────────────────────────────────┐
│                  Tauri 2 Shell               │
│  ┌────────────────────┐  ┌────────────────┐ │
│  │   React + Vite     │  │  Rust Backend  │ │
│  │   (Frontend UI)    │  │  (Native Ops)  │ │
│  │                    │  │                │ │
│  │  · Components      │  │  · File system │ │
│  │  · AI Agent Loop   │  │  · SQLite      │ │
│  │  · State mgmt      │  │  · HTTP proxy  │ │
│  │  · Streaming UI    │  │  · Native dialog│ │
│  │  · NO network I/O  │  │  · Doc parsing │ │
│  └────────┬───────────┘  └───────┬────────┘ │
│           │    Tauri Commands    │          │
│           └──────────────────────┘          │
└─────────────────────────────────────────────┘
         │                          │
         ▼                          ▼
   LLM APIs (cloud)          Local SQLite DB
   Claude / OpenAI            + Vector Search
```

**两层分工：**
- **Rust 层**：文件系统访问、SQLite 数据库、文件监听、文档解析（CPU 密集型）、原生对话框
- **TypeScript 层**：UI 渲染、AI Agent Loop、LLM API 调用（网络 IO 密集型）、流式展示

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Desktop Shell | **Tauri 2** | 比 Electron 轻 10x+，原生 WebView，Rust 后端高性能，macOS/Windows 双平台 |
| Frontend | **React 19 + Vite + TypeScript** | 不需要 Next.js（无 SSR 需求），Vite 开发体验快 |
| UI | **shadcn/ui + Tailwind CSS v4** | 可组合的无样式组件，自由定制 |
| Rich Text | **Tiptap** | Artifact 查看/编辑，可扩展 |
| Client State | **Zustand** | 轻量，管理面板状态、会话状态 |
| Router | **TanStack Router** | 类型安全的客户端路由，桌面应用不需要文件系统路由 |
| Database | **SQLite**（通过 Tauri SQL plugin） | 本地优先，零配置，单文件数据库 |
| Vector Search | **SQLite + 自定义余弦相似度** | Phase 1 用 JSON 存向量 + JS 计算；后续可换 sqlite-vec |
| AI Agent | **自定义 Agent Loop** | 直接用 LLM SDK，async generator yield 事件，完全可控，无框架依赖 |
| LLM Provider | **Anthropic SDK + OpenAI SDK + thin adapter** | 自建 provider 抽象层（~100 行），统一 tool calling 接口 |
| Embeddings | **OpenAI text-embedding-3-small** | 1536 维，存入 SQLite |
| Doc Parsing | **Rust 侧**：PDF/DOCX/XLSX 解析 | CPU 密集型工作交给 Rust，不阻塞 UI |
| File Watch | **Tauri fs-watch plugin** | 监听知识库目录变化，自动更新索引 |
| Job Scheduling | **进程内调度器**（croner） | 轻量 cron 库，无需 Redis/BullMQ |

### 为什么不用 Electron

| | Tauri 2 | Electron |
|--|---------|----------|
| 安装包大小 | ~3-8 MB | ~150+ MB |
| 内存占用 | ~30-50 MB | ~200+ MB |
| 启动速度 | 快 | 慢 |
| 原生能力 | Rust，高性能 | Node.js |
| 安全性 | 沙盒模型，权限控制 | 完整 Node.js 访问 |

### Agent Loop：自定义 Loop + 直接 SDK

Cowork 的核心原则是"用户定义意图，AI 决定执行方式"——AI 在运行时自主选择 Skill、自动循环调用直到任务完成。Agent loop 是产品最核心的代码，必须完全可控。

**架构：**

```
Provider Adapter（~100 行）
  统一 Claude/OpenAI 的 tool calling 接口差异
      ↓
Agent Loop（~200 行）
  async generator，yield 每一步事件给 UI
      ↓
Skill Registry
  注册可用 Skills，转换为 LLM tool 定义
```

**核心代码结构：**

```typescript
// Provider 抽象 — 统一两家的 API 差异
interface LLMProvider {
  stream(params: {
    system: string;
    messages: Message[];
    tools: ToolDefinition[];
  }): AsyncIterable<StreamEvent>;
}

// Agent Loop — async generator yield 事件
async function* runAgent(params: {
  messages: Message[];
  tools: Record<string, Skill>;
  knowledgeContext: string;
  maxSteps?: number;
}): AsyncGenerator<AgentEvent> {
  const provider = getConfiguredProvider();
  let currentMessages = [...params.messages];

  for (let step = 0; step < (params.maxSteps ?? 10); step++) {
    // 1. 调用 LLM
    for await (const event of provider.stream({
      system: buildSystemPrompt(params.knowledgeContext),
      messages: currentMessages,
      tools: Object.values(params.tools).map(s => s.definition),
    })) {
      yield event; // 流式 token 直接 yield 给 UI
    }

    const response = /* 收集最终响应 */;

    // 2. 没有 tool call → 完成
    if (!response.hasToolCalls) break;

    // 3. 执行 Skills
    for (const call of response.toolCalls) {
      yield { type: 'skill-start', skill: call.name, input: call.input };
      const result = await params.tools[call.name].execute(call.input);
      yield { type: 'skill-done', skill: call.name, result };
      currentMessages.push(/* tool result message */);
    }
  }
}
```

**为什么不用框架：**
- Vercel AI SDK：`useChat` hook 需要 HTTP 服务端，桌面应用没有；核心函数做的事不复杂，自己写更直接
- LangChain：太重，抽象过多，Cowork 的 agent 模型很直接不需要 chain/agent/memory 层层包装
- 自定义 loop 代码量只有 200-300 行，但完全可控——agent 行为的每个细节都可以调整

## Project Structure

```
cowork/
├── docs/                              # 设计文档（已有）
│
├── src-tauri/                         # Tauri Rust 后端
│   ├── src/
│   │   ├── main.rs                    # 入口
│   │   ├── lib.rs
│   │   ├── commands/                  # Tauri Commands（前端可调用）
│   │   │   ├── mod.rs
│   │   │   ├── fs.rs                  # 文件系统操作：扫描目录、读取文件
│   │   │   ├── documents.rs           # 文档解析：PDF、DOCX、XLSX → 纯文本
│   │   │   └── dialog.rs              # 原生对话框：选择文件夹
│   │   ├── db/
│   │   │   ├── mod.rs
│   │   │   ├── migrations.rs          # Schema migrations
│   │   │   └── queries.rs             # 常用查询
│   │   └── watcher.rs                 # 文件系统监听
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── capabilities/                  # Tauri 2 权限声明
│
├── src/                               # React 前端 + AI 逻辑
│   ├── main.tsx                       # 入口
│   ├── App.tsx                        # 根组件 + 路由
│   │
│   ├── routes/                        # 页面
│   │   ├── home.tsx                   # 首页（Command Bar + App 卡片 + 待处理）
│   │   ├── session.$id.tsx            # Instant Session 工作区
│   │   ├── apps.$id.tsx               # App Detail
│   │   ├── apps.$id.runs.$runId.tsx   # 运行详情 / 产出物查看
│   │   ├── knowledge.tsx              # 知识库
│   │   ├── knowledge.$sourceId.tsx    # 文件浏览器
│   │   ├── channels.tsx               # 通道管理
│   │   ├── explore.tsx                # 发现（Phase 5）
│   │   ├── activity.tsx               # 运行监控
│   │   └── settings.tsx               # 设置（LLM provider 配置等）
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── sidebar.tsx            # 左侧导航
│   │   │   └── header.tsx
│   │   ├── chat/
│   │   │   ├── command-bar.tsx        # 核心输入框
│   │   │   ├── message-list.tsx
│   │   │   ├── message-bubble.tsx
│   │   │   └── execution-steps.tsx    # 步骤进度展示
│   │   ├── views/                     # 浮现视图面板
│   │   │   ├── view-container.tsx     # 管理钉住/全屏/关闭
│   │   │   ├── data-table-view.tsx
│   │   │   ├── report-view.tsx        # Tiptap 富文本
│   │   │   └── chart-view.tsx
│   │   ├── apps/
│   │   │   ├── app-card.tsx
│   │   │   └── app-definition.tsx
│   │   ├── knowledge/
│   │   │   ├── source-card.tsx
│   │   │   └── file-browser.tsx
│   │   └── onboarding/
│   │       └── welcome.tsx            # 首次使用引导
│   │
│   ├── lib/
│   │   ├── ai/
│   │   │   ├── agent.ts               # Agent loop（自定义 async generator）
│   │   │   ├── providers/
│   │   │   │   ├── types.ts           # LLMProvider 接口定义
│   │   │   │   ├── anthropic.ts       # Claude adapter
│   │   │   │   ├── openai.ts          # OpenAI adapter
│   │   │   │   └── index.ts           # getConfiguredProvider()
│   │   │   ├── system-prompt.ts       # System prompt 构建
│   │   │   └── skills/                # Skill 定义（注册为 tool definitions）
│   │   │       ├── registry.ts
│   │   │       ├── types.ts           # Skill 接口
│   │   │       ├── search-knowledge.ts
│   │   │       ├── analyze-data.ts
│   │   │       ├── generate-report.ts
│   │   │       └── read-document.ts
│   │   ├── knowledge/
│   │   │   ├── indexer.ts             # 文档分块 + 嵌入
│   │   │   ├── retriever.ts           # RAG 检索
│   │   │   └── embeddings.ts          # 调用 embedding API
│   │   ├── db/
│   │   │   ├── client.ts             # SQLite 连接（通过 Tauri SQL plugin）
│   │   │   ├── schema.ts             # 建表语句
│   │   │   └── queries.ts            # TypeScript 查询封装
│   │   ├── scheduler.ts              # 进程内定时任务调度
│   │   └── tauri.ts                  # Tauri Command 调用封装
│   │
│   ├── stores/
│   │   ├── session-store.ts           # 当前会话状态
│   │   ├── view-store.ts             # 浮现视图状态
│   │   └── settings-store.ts         # 用户设置（LLM provider 等）
│   │
│   └── types/                        # 共享类型定义
│       ├── app.ts
│       ├── run.ts
│       ├── knowledge.ts
│       ├── channel.ts
│       └── artifact.ts
│
├── package.json
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── README.md
```

**不再需要的东西（对比 web 版）：**
- ❌ Docker / Postgres / Redis — 用 SQLite 替代
- ❌ Next.js — 桌面应用不需要 SSR，用 Vite 更快
- ❌ BullMQ — 用进程内调度器替代
- ❌ Hono channel service — Channel 输入暂时不需要独立服务
- ❌ Auth — 桌面应用，单用户
- ❌ Monorepo — 单仓库就够了，Tauri 天然分 Rust/TS 两层

## Implementation Phases

### Phase 1: Core Magic（3-4 周）

用户可以：打开应用 → 选择工作文件夹 → AI 扫描并建议任务 → 对话式执行任务 → 实时看到执行步骤 → 获得格式化的产出物 → AI 自动引用知识库。

覆盖：Flow 0（路径 A）+ Flow 1 + Knowledge RAG + Instant Session UI + 设置页（LLM provider 配置）。

### Phase 2: App 持久化与复用（2-3 周）

"保存为 App"可用。用户保存会话为 App，在首页看到 App 卡片，一键重跑，调参数，看运行历史。

覆盖：Flow 2 + Flow 3 + Home 页 App 卡片。

### Phase 3: 定时执行与输出通道（2-3 周）

App 可以定时运行。产出物可以通过邮件发送。Activity 页面。

覆盖：Flow 4（定时 + 邮件输出）+ Activity 页面。

### Phase 4: Channel 输入与外部集成（3-4 周）

Webhook 触发 App。飞书/Slack 集成。Channels 管理页面。

覆盖：Flow 4.5 + Channels 页面。

### Phase 5: 多用户与组织（需要云端，另行规划）

需要服务端才能实现共享、Explore 等组织级功能。到这个阶段再规划云端架构。

### Phase 6: 进阶功能

Setup 文档导入、SaaS 数据源连接器、系统建议优化、移动端。

## Phase 1 Detailed Breakdown

### Step 1: 项目脚手架（Day 1-2）

初始化 Tauri 2 + React + Vite + TypeScript 项目。

```bash
# 创建 Tauri 项目
pnpm create tauri-app cowork --template react-ts --manager pnpm

# 安装核心依赖
pnpm add @anthropic-ai/sdk openai                  # LLM SDKs (直接使用，无框架)
pnpm add zustand                                    # State management
pnpm add @tanstack/react-router                     # Client routing
pnpm add -D tailwindcss @tailwindcss/vite           # Styling
pnpm add -D @shadcn/ui                              # UI components

# Tauri plugins
cargo add tauri-plugin-sql --features sqlite        # SQLite
cargo add tauri-plugin-fs                            # File system access
cargo add tauri-plugin-dialog                        # Native dialogs
```

产出：空项目可以跑起来，macOS + Windows 双平台构建通过。

### Step 2: 数据库 Schema + 基础数据层（Day 2-3）

SQLite schema：

```sql
-- 用户设置
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 知识库文档来源
CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,          -- 'local_folder' | 'upload'
  path TEXT,                   -- 本地路径
  name TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  privacy TEXT DEFAULT 'public', -- 'public' | 'personal'
  created_at INTEGER NOT NULL
);

-- 文档
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  filename TEXT NOT NULL,
  file_path TEXT,
  content_text TEXT,            -- 提取的纯文本
  status TEXT DEFAULT 'pending', -- 'pending' | 'indexed' | 'excluded'
  file_modified_at INTEGER,
  created_at INTEGER NOT NULL
);

-- 文档分块 + 向量
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  content TEXT NOT NULL,
  embedding TEXT,               -- JSON array of floats (Phase 1)
  metadata TEXT,                -- JSON: { position, heading, ... }
  created_at INTEGER NOT NULL
);

-- 会话
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  status TEXT DEFAULT 'active',  -- 'active' | 'archived'
  created_at INTEGER NOT NULL
);

-- 消息
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,             -- 'user' | 'assistant' | 'system' | 'tool'
  content TEXT NOT NULL,
  metadata TEXT,                  -- JSON: tool calls, view signals, etc.
  created_at INTEGER NOT NULL
);

-- 产出物
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  app_id TEXT,
  run_id TEXT,
  type TEXT NOT NULL,             -- 'report' | 'table' | 'email' | 'action_list'
  title TEXT NOT NULL,
  content TEXT NOT NULL,           -- Markdown or JSON
  metadata TEXT,
  created_at INTEGER NOT NULL
);

-- App（Phase 2 用，但 schema 先建好）
CREATE TABLE apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  definition TEXT NOT NULL,        -- JSON: goal, data_scope, quality, output, triggers, trust
  status TEXT DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 运行记录
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  app_id TEXT REFERENCES apps(id),
  session_id TEXT REFERENCES sessions(id),
  status TEXT DEFAULT 'pending',   -- 'pending' | 'running' | 'completed' | 'failed'
  steps TEXT,                      -- JSON array of step logs
  trigger_type TEXT,               -- 'manual' | 'schedule' | 'channel'
  started_at INTEGER,
  completed_at INTEGER
);
```

产出：数据层可用，TypeScript 查询封装完成。

### Step 3: LLM Provider 配置 + 设置页（Day 3-4）

- Settings 页面：选择 LLM provider（Claude / OpenAI），输入 API Key
- API Key 存储在 SQLite settings 表中（或系统 keychain）
- Provider 抽象层：统一的调用接口

```typescript
// src/lib/ai/providers.ts
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';

export function getProvider() {
  const settings = getSettings();
  switch (settings.provider) {
    case 'anthropic':
      return anthropic(settings.anthropicApiKey);
    case 'openai':
      return openai(settings.openaiApiKey);
  }
}

export function getModel() {
  const settings = getSettings();
  const provider = getProvider();
  return provider(settings.modelId); // e.g., 'claude-sonnet-4-20250514' or 'gpt-4o'
}
```

产出：用户可以在设置页配置 LLM，应用可以调通 LLM API。

### Step 4: 文件系统操作 + Rust Commands（Day 4-5）

Rust 侧实现：
- `scan_directory(path)` — 扫描目录，返回文件列表（名、大小、修改时间）
- `read_file_text(path)` — 读取文件内容，支持 txt/md
- `parse_document(path)` — 解析 PDF/DOCX/XLSX 为纯文本（用 Rust crates）
- `watch_directory(path)` — 监听目录变化

前端封装：
```typescript
// src/lib/tauri.ts
import { invoke } from '@tauri-apps/api/core';

export async function scanDirectory(path: string) {
  return invoke<FileInfo[]>('scan_directory', { path });
}

export async function parseDocument(path: string) {
  return invoke<string>('parse_document', { path });
}
```

产出：可以选文件夹、扫描文件、解析文档内容。

### Step 5: Knowledge RAG Pipeline（Day 5-7）

1. **索引流程**：文档纯文本 → 分块（1000 字符 / 200 重叠）→ 调用 Embedding API → 存入 chunks 表
2. **检索流程**：用户 query → embedding → 跟所有 chunks 计算余弦相似度 → 返回 top-K
3. **自动索引**：添加文件夹后后台逐个索引文档
4. **产出物回流**：每次产出的 artifact 也被索引

Phase 1 向量搜索用纯 JS 计算（文档量小时够用）。后续换 sqlite-vec。

产出：Knowledge RAG 可用，AI 能基于用户文档回答问题。

### Step 6: Agent Loop + Skills（Day 6-9）

三层实现：

**1. Provider Adapter（~100 行）**

```typescript
// src/lib/ai/providers/types.ts
interface LLMProvider {
  stream(params: StreamParams): AsyncIterable<StreamEvent>;
}

type StreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; id: string; name: string; input: unknown }
  | { type: 'message-done'; message: AssistantMessage };

// src/lib/ai/providers/anthropic.ts
// 包装 @anthropic-ai/sdk，映射 stream events 为统一格式

// src/lib/ai/providers/openai.ts
// 包装 openai SDK，映射 stream events 为统一格式
```

**2. Agent Loop（~200 行）**

```typescript
// src/lib/ai/agent.ts
async function* runAgent(params): AsyncGenerator<AgentEvent> {
  // 1. 从知识库检索相关上下文
  // 2. 构建 system prompt
  // 3. 循环：调用 LLM → yield 流式 token → 执行 tool calls → yield skill 事件
  // 4. 直到 LLM 不再调用 tool → 完成
}
```

UI 层消费：
```typescript
// React component 中
for await (const event of runAgent({ messages, tools, knowledge })) {
  switch (event.type) {
    case 'text-delta': appendToMessage(event.text); break;
    case 'skill-start': addStep(event.skill); break;
    case 'skill-done': updateStep(event.skill, event.result); break;
    case 'artifact': showView(event.artifact); break;
  }
}
```

**3. Phase 1 Skills**

| Skill | 作用 | 实现 |
|-------|------|------|
| `search_knowledge` | RAG 检索，返回相关文档片段 | 调用 retriever.ts |
| `read_document` | 读取指定文档完整内容 | 调用 Tauri fs command |
| `analyze_data` | 对数据做统计分析 | JS 实现，基础统计 |
| `generate_report` | 生成结构化 Markdown 报告 | 格式化 LLM 输出 |

产出：AI 可以通过对话完成多步骤任务，自动调用 Skills，实时 yield 事件到 UI。

### Step 7: 前端 Layout + 导航（Day 7-8）

- 左侧边栏导航（Home、Knowledge、Channels、Explore、Activity、Settings）
- 响应式布局
- TanStack Router 配置

产出：应用有完整的页面结构和导航。

### Step 8: Home 页 + 首次体验（Day 8-10）

- 新用户：欢迎界面 + 选择文件夹（Tauri native dialog）+ AI 扫描建议
- 老用户：Command Bar + 最近活动
- Command Bar 输入触发 agent，内联展示结果

产出：用户首次打开可以走通 Flow 0 的魔法时刻。

### Step 9: Instant Session 工作区（Day 10-14）

最复杂的 UI 组件：
- 左栏：对话消息列表 + 流式文本 + 执行步骤指示
- 右栏：浮现视图面板（数据表格、报告预览）
- 视图可钉住/全屏/关闭
- 底部状态栏：Knowledge 引用、数据来源
- 从 Command Bar 内联结果自然过渡到全页面 Session

产出：完整的对话式工作区，AI 执行过程实时可见。

### Step 10: Knowledge 页面（Day 13-15）

- 来源列表（文件夹 + 文件数量 + 状态）
- 文件浏览器（排除/包含）
- Cowork 产出区域

产出：用户可以管理知识库。

### Step 11: 集成测试 + 打磨（Day 15-18）

端到端验证：
1. 首次打开 → 选文件夹 → AI 扫描建议 → 执行第一个任务
2. 对话中 AI 引用知识库文档 → 生成报告 → 视图浮现
3. 第二次任务引用第一次的产出（Knowledge 积累）
4. macOS + Windows 双平台构建和测试

## Phase 1 完成标准

用户可以：
1. ✅ 打开应用，在设置中配置 LLM（Claude 或 OpenAI）
2. ✅ 选择工作文件夹，AI 秒级扫描后给出具体的任务建议
3. ✅ 通过对话执行任务，实时看到 AI 的执行步骤
4. ✅ AI 自动从知识库中找到相关文档来参考
5. ✅ 获得格式化的产出物（报告、数据表格），在浮现视图中查看
6. ✅ 在知识库页面浏览和管理文档
7. ✅ 产出物自动回流为知识，第二次任务比第一次更有上下文
8. ✅ macOS 和 Windows 双平台可用
