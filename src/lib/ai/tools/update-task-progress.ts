import type { Tool } from "./types";
import { writeFile } from "@/lib/tauri";
import { getOrBootstrapLongTask } from "../task-context";

interface TaskOutput {
  title: string;
  path?: string;
  kind?: "file" | "artifact" | "note";
}

interface TaskProgress {
  runId: string;
  workspaceDir: string;
  phase: string;
  status: "pending" | "running" | "done" | "failed";
  summary: string;
  outputs: TaskOutput[];
  updatedAt: number;
}

export const updateTaskProgress: Tool = {
  definition: {
    name: "update_task_progress",
    description:
      "Update the visible plan/progress panel for a multi-step task. Call once with phase=\"plan\" and a multi-line summary listing each step, file path, page/slide/image count, and assumptions. Call again with status=\"done\" at the end and pass every produced file path in `outputs[]` — those are what the user clicks in the result panel.",
    parameters: {
      type: "object",
      properties: {
        phase: {
          type: "string",
          description: "Current phase name, e.g. plan, inventory, extract, synthesize, generate, verify.",
        },
        status: {
          type: "string",
          enum: ["pending", "running", "done", "failed"],
          description: "Phase status.",
        },
        summary: {
          type: "string",
          description: "Concise user-facing progress summary.",
        },
        outputs: {
          type: "array",
          description: "Important files or artifacts produced in this phase.",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              path: { type: "string" },
              kind: { type: "string", enum: ["file", "artifact", "note"] },
            },
            required: ["title"],
          },
        },
      },
      required: ["phase", "status", "summary"],
    },
  },

  async execute(input) {
    // Bootstrap a long-task context if the agent calls this tool before
    // detection fired. The bootstrapped run is rooted at the active working
    // directory so progress, the plan, and the outputs panel still show up.
    const context = getOrBootstrapLongTask("Bootstrapped via update_task_progress");

    const progress: TaskProgress = {
      runId: context.runId,
      workspaceDir: context.workspaceDir,
      phase: String(input.phase || "unknown"),
      status: normalizeStatus(input.status),
      summary: String(input.summary || ""),
      outputs: normalizeOutputs(input.outputs),
      updatedAt: Math.floor(Date.now() / 1000),
    };

    const manifestPath = `${context.workspaceDir}/task-progress.json`;
    try {
      await writeFile(manifestPath, JSON.stringify(progress, null, 2));
    } catch {
      // Persisting the manifest is best-effort; never block the progress
      // event on a write failure (e.g. read-only working directory).
    }

    return `__TASK_PROGRESS__:${JSON.stringify(progress)}`;
  },
};

function normalizeStatus(value: unknown): TaskProgress["status"] {
  return value === "pending" || value === "running" || value === "done" || value === "failed"
    ? value
    : "running";
}

function normalizeOutputs(value: unknown): TaskOutput[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      title: String(item.title || item.path || "Output"),
      path: item.path ? String(item.path) : undefined,
      kind: item.kind === "artifact" || item.kind === "note" ? item.kind : "file",
    }));
}
