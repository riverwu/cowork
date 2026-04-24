import type { Tool } from "./types";
import { writeFile } from "@/lib/tauri";
import { getCurrentLongTask } from "../task-context";

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
      "Update the visible progress for a long-running task and persist a task manifest in the run workspace. Use this at the start and end of each long-task phase.",
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
    const context = getCurrentLongTask();
    if (!context) {
      return "Task progress update ignored: no long task is active.";
    }

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
    await writeFile(manifestPath, JSON.stringify(progress, null, 2));

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
