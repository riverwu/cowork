// ---- Settings ----

export interface Settings {
  llmProvider: "anthropic" | "openai";
  anthropicApiKey?: string;
  anthropicBaseUrl?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  modelId?: string;
}

// ---- Knowledge ----

export interface Source {
  id: string;
  type: "local_folder" | "upload";
  path: string | null;
  name: string;
  status: "active" | "indexing" | "error";
  privacy: "public" | "personal";
  createdAt: number;
}

export interface Document {
  id: string;
  sourceId: string;
  filename: string;
  filePath: string | null;
  contentText: string | null;
  status: "pending" | "indexed" | "excluded";
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
  | { type: "skill-start"; skill: string; input: unknown }
  | { type: "skill-done"; skill: string; result: unknown; durationMs: number }
  | { type: "artifact"; artifact: Artifact }
  | { type: "knowledge-ref"; refs: { documentId: string; filename: string; snippet: string }[] }
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
