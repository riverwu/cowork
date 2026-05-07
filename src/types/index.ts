// ---- Settings ----

export interface Settings {
  llmProvider: "anthropic" | "openai";
  anthropicApiKey?: string;
  anthropicBaseUrl?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  modelId?: string;
  /** Total context window of the configured chat model, in tokens.
   *  Defaults to 32_000 (a conservative value that covers Doubao, MiniMax,
   *  Qwen, GPT-4o-mini, and older Claude). Set to 128_000 for GPT-4o /
   *  GPT-4-turbo / Claude 4 Sonnet/Opus, or 200_000 for full Claude 4. */
  modelContextTokens?: number;
  /** Maximum tokens reserved for the assistant's reply. Defaults to 4_096.
   *  Lower values free more room for tool definitions and history; higher
   *  values give the model more headroom for long single-turn answers. */
  modelMaxOutputTokens?: number;

  /** Image generation settings (currently only Doubao Seedream). */
  imageProvider?: "doubao";
  imageApiKey?: string;
  imageBaseUrl?: string;
  imageModel?: string;

  /** When true, the agent loop writes a per-request JSONL log under
   *  `~/.cowork/debug-logs/<request-id>/` containing every LLM
   *  send/receive, every tool call's input/output, and a copy of every
   *  file the tools produced. Off by default — toggle from the chat
   *  composer's `+` menu. */
  debugLogEnabled?: boolean;
}

// ---- Knowledge ----

export interface Source {
  id: string;
  type: "local_folder" | "upload" | "confluence" | "erp" | "crm" | "im" | "mcp" | "database" | "api";
  path: string | null;
  name: string;
  status: "active" | "indexing" | "error";
  privacy: "public" | "personal";
  connectorId?: string | null;
  externalId?: string | null;
  syncPolicy?: "manual" | "periodic" | "realtime";
  lastSyncedAt?: number | null;
  metadata?: Record<string, unknown> | null;
  createdAt: number;
}

export interface Document {
  id: string;
  sourceId: string;
  filename: string;
  filePath: string | null;
  contentText: string | null;
  status: "pending" | "indexed" | "excluded" | "error" | "deleted";
  embeddingStatus?: "pending" | "embedded" | "partial" | "failed" | "none";
  contentHash?: string | null;
  size?: number | null;
  errorMessage?: string | null;
  lastIndexedAt?: number | null;
  fileModifiedAt: number | null;
  createdAt: number;
}

export interface Chunk {
  id: string;
  documentId: string;
  content: string;
  embedding: number[] | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

export interface SourceCapability {
  id: string;
  sourceId: string;
  capabilityType: "search" | "read" | "query" | "analyze" | "sync" | "write";
  toolName: string | null;
  description: string | null;
  inputSchema: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

export interface SourceEntity {
  id: string;
  sourceId: string;
  entityType: string;
  name: string;
  externalId: string | null;
  summary: string | null;
  schema: Record<string, unknown> | null;
  sample: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  updatedAt: number | null;
  createdAt: number;
}

// ---- Sessions ----

export interface Session {
  id: string;
  title: string | null;
  status: "active" | "archived";
  createdAt: number;
}

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

// ---- Skills (unified: apps + tool-skills) ----

export type SkillType = "app" | "skill";

export interface SkillDefinition {
  /** What this skill does. */
  purpose: string;
  /** Detailed instructions for the agent when executing this skill. */
  instructions?: string[];
  /** For apps: data sources, quality standards, output format, etc. */
  dataScope?: string;
  qualityStandards?: string[];
  outputRequirements?: string;
  /** Configurable parameters. */
  parameters?: Record<string, { description: string; default?: string }>;
  /** Required config (e.g., API keys). Key → description. */
  requiredConfig?: Record<string, string>;
}

export interface SkillRecord {
  id: string;
  name: string;
  type: SkillType;
  version: number;
  definition: SkillDefinition;
  /** Stored config values (API keys, etc.). */
  config: Record<string, string>;
  status: "active" | "archived";
  createdAt: number;
  updatedAt: number;
}

/** @deprecated Use SkillDefinition instead */
export type AppDefinition = SkillDefinition;
/** @deprecated Use SkillRecord instead */
export type App = SkillRecord;

// ---- Runs ----

export type RunStatus = "pending" | "running" | "completed" | "failed" | "needs_review";

export interface RunStep {
  type: "skill-start" | "skill-done" | "text" | "error";
  skill?: string;
  input?: unknown;
  result?: unknown;
  text?: string;
  error?: string;
  timestamp: number;
  durationMs?: number;
}

export interface Run {
  id: string;
  appId: string | null;
  sessionId: string | null;
  status: RunStatus;
  steps: RunStep[];
  triggerType: "manual" | "schedule" | "channel";
  startedAt: number | null;
  completedAt: number | null;
}

// ---- Artifacts ----

export type ArtifactType = "report" | "table" | "email" | "action_list";

export interface Artifact {
  id: string;
  sessionId: string | null;
  appId: string | null;
  runId: string | null;
  type: ArtifactType;
  title: string;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

// ---- Agent Events (for streaming) ----

export type AgentEvent =
  | { type: "text-delta"; text: string }
  | { type: "thinking"; active: boolean }
  | { type: "long-task-start"; runId: string; workspaceDir: string; reason: string }
  | { type: "long-task-progress"; runId: string; workspaceDir: string; phase: string; status: "pending" | "running" | "done" | "failed"; summary: string; steps?: { title: string; status: "pending" | "running" | "done" | "failed" }[]; outputs: { title: string; path?: string; kind?: "file" | "artifact" | "note" }[]; updatedAt: number }
  | { type: "skill-start"; skill: string; input: unknown; toolCallId: string }
  | { type: "skill-progress"; skill: string; output: string }
  | { type: "skill-done"; skill: string; result: unknown; durationMs: number; success: boolean; toolCallId: string }
  | { type: "artifact"; artifact: Artifact }
  | { type: "knowledge-ref"; refs: { documentId: string; filename: string; snippet: string }[] }
  | { type: "context-dump"; content: string }
  | { type: "compacted"; summary: string; preservedUserMessages: number; estimatedTokens: number; reason?: string }
  | { type: "error"; error: string }
  | { type: "done" };

// ---- Memory ----

export interface CoreFact {
  key: string;
  value: string;
  category: "preference" | "context" | "entity" | "general";
  source: "auto" | "user" | "reflection";
  updatedAt: number;
}

export type MemoryType = "insight" | "preference" | "pattern" | "entity" | "correction";

export interface Memory {
  id: string;
  content: string;
  memoryType: MemoryType;
  embedding: number[] | null;
  importance: number;
  accessCount: number;
  sessionId: string | null;
  createdAt: number;
  lastAccessedAt: number | null;
}

export type EpisodeOutcome = "success" | "partial" | "failure" | "cancelled";

export interface Episode {
  id: string;
  sessionId: string | null;
  taskSummary: string;
  outcome: EpisodeOutcome;
  reflection: string | null;
  skillsUsed: string[] | null;
  createdAt: number;
}

// ---- File system (from Rust commands) ----

export interface FileInfo {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified_at: number;
  extension: string;
}
