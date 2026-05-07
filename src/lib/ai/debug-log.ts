import { debugLogAppend, debugLogCopyArtifact, debugLogInit } from "@/lib/tauri";
import type { LLMMessage, ToolDefinition, ToolCall, StreamEvent } from "./providers/types";

/**
 * Per-request debug logger.
 *
 * When the user enables `Debug Log` from the chat composer's `+` menu,
 * the session store creates one of these per submitted message and hands
 * it to `runAgent`. The logger writes a JSONL file under
 * `~/.cowork/debug-logs/<requestId>/request-<requestId>.log` with one
 * event per line, plus copies any file the tools produce into the same
 * directory so they survive even if the workspace is later cleaned.
 *
 * Failure policy: every method swallows its own errors and console-warns
 * — debug logging must never break the agent loop. If the very first
 * `init` fails, subsequent record* calls become no-ops (the logPath stays
 * null).
 */
export class DebugLogger {
  readonly requestId: string;
  private logPath: string | null = null;
  private requestDir: string | null = null;
  private seq = 0;
  private artifactSeq = 0;
  /** Source paths we've already copied — avoids re-copying the same .pptx
   *  every time validate_render returns it across iterations. */
  private copied = new Set<string>();

  constructor(requestId: string) {
    this.requestId = requestId;
  }

  static newRequestId(): string {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
    const rand = Math.random().toString(36).slice(2, 8);
    return `${ts}-${rand}`;
  }

  async init(meta: { sessionId: string; query: string; planMode: boolean; workingDirectory?: string }): Promise<void> {
    try {
      const result = await debugLogInit(this.requestId, {
        requestId: this.requestId,
        ...meta,
      });
      this.logPath = result.logPath;
      this.requestDir = result.requestDir;
    } catch (err) {
      console.warn("[DebugLog] init failed:", err);
      this.logPath = null;
      this.requestDir = null;
    }
  }

  get isActive(): boolean {
    return this.logPath !== null;
  }

  get directory(): string | null {
    return this.requestDir;
  }

  async recordSend(payload: {
    step: number;
    system: string;
    tools: ToolDefinition[];
    messages: LLMMessage[];
    estimatedInputTokens?: number;
    modelId?: string;
  }): Promise<void> {
    await this.append("llm-send", payload);
  }

  async recordResponse(payload: {
    step: number;
    text: string;
    toolCalls: ToolCall[];
    stopReason?: string;
    usage?: unknown;
  }): Promise<void> {
    await this.append("llm-response", payload);
  }

  async recordStreamEvent(event: StreamEvent): Promise<void> {
    // High-volume — only record terminal/structural events to keep the log
    // readable. text-delta is reconstructed from llm-response.text.
    if (event.type === "message-done") {
      await this.append("llm-stream-done", event);
    }
  }

  async recordToolStart(payload: {
    step: number;
    name: string;
    input: unknown;
    toolCallId: string;
  }): Promise<void> {
    await this.append("tool-start", payload);
  }

  async recordToolDone(payload: {
    step: number;
    name: string;
    toolCallId: string;
    result: string;
    success: boolean;
    durationMs: number;
  }): Promise<void> {
    const artifacts = await this.copyArtifactsFromResult(payload.name, payload.result);
    await this.append("tool-done", { ...payload, artifacts });
  }

  async recordError(payload: { step: number; error: string; phase: string }): Promise<void> {
    await this.append("error", payload);
  }

  async recordCompacted(payload: { summary: string; preservedUserMessages: number; estimatedTokens: number }): Promise<void> {
    await this.append("compacted", payload);
  }

  async recordCompleted(payload: { totalSteps: number; hitStepLimit: boolean; finalText: string }): Promise<void> {
    await this.append("completed", payload);
  }

  /** Scan a tool result string for absolute paths to known artifact
   *  extensions and copy each into the request directory. Returns the
   *  list of copied filenames (relative to the request dir). */
  private async copyArtifactsFromResult(toolName: string, result: string): Promise<string[]> {
    const candidates = extractArtifactPaths(result);
    if (candidates.length === 0) return [];
    const copied: string[] = [];
    for (const src of candidates) {
      if (!shouldCopyArtifact(toolName, src, this.copied)) continue;
      try {
        const label = `t${++this.artifactSeq}-${toolName}`;
        const r = await debugLogCopyArtifact(this.requestDir || "", src, label);
        if (r) copied.push(r.copiedAs);
      } catch (err) {
        console.warn(`[DebugLog] copy artifact ${src} failed:`, err);
      }
    }
    return copied;
  }

  private async append(event: string, payload: unknown): Promise<void> {
    if (!this.logPath) return;
    const line = JSON.stringify({
      seq: ++this.seq,
      at: Date.now(),
      event,
      payload,
    });
    try {
      await debugLogAppend(this.logPath, line);
    } catch (err) {
      console.warn(`[DebugLog] append failed (event=${event}):`, err);
    }
  }
}

/**
 * Find absolute paths to common artifact file types inside a tool result.
 *
 * Why a regex sweep instead of a structured "tool artifacts" field:
 *
 * - Most cowork tools already return human-readable strings with paths
 *   embedded ("SlideML compiled to /abs/path/foo.pptx ...", "Image saved
 *   to ..."). Threading a structured artifact field through every tool
 *   would touch every tool file and every test. The sweep gives us
 *   coverage with zero per-tool changes.
 * - We only copy paths that actually exist on disk (the IPC handler
 *   stat-checks before copying), so a false-positive match in a long
 *   error message is harmless.
 * - We dedupe within one logger instance to avoid copying the same .pptx
 *   on every step of an iterate-and-fix loop.
 */
function extractArtifactPaths(text: string): string[] {
  if (!text) return [];
  const pattern = /(?:^|[\s"'`(\[])((?:\/|~\/)[^\s"'`)\]]+\.(?:pptx|pdf|docx|xlsx|xls|png|jpg|jpeg|gif|webp|svg|json|md|html|htm|txt|csv|tsv|mp4|mov|wav|mp3))(?=[\s"'`)\].,;:!?]|$)/gi;
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    let p = m[1]!;
    if (p.startsWith("~/")) {
      // Renderer can't resolve $HOME; just skip — main process won't either,
      // since debugLogCopyArtifact stat-checks. Tools currently emit absolute
      // paths anyway.
      continue;
    }
    set.add(p);
  }
  return [...set];
}

function shouldCopyArtifact(toolName: string, src: string, copied: Set<string>): boolean {
  const isIterativeRenderArtifact = toolName === "validate_render" && /\.(?:pptx|render-tree\.json)$/i.test(src);
  if (isIterativeRenderArtifact) return true;
  if (copied.has(src)) return false;
  copied.add(src);
  return true;
}

export const __test = { extractArtifactPaths, shouldCopyArtifact };
