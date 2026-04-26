import type { LongTaskContext } from "./long-task";

let currentLongTask: LongTaskContext | null = null;
let currentWorkingDirectory: string | null = null;

export function setCurrentLongTask(context: LongTaskContext | null): void {
  currentLongTask = context;
}

export function getCurrentLongTask(): LongTaskContext | null {
  return currentLongTask;
}

/**
 * Track the active turn's working directory so that tools called outside an
 * explicit long task (e.g. `update_task_progress` invoked when long-task
 * detection didn't fire) can still bootstrap a sensible workspace path.
 */
export function setCurrentWorkingDirectory(dir: string | null): void {
  currentWorkingDirectory = dir && dir.length > 0 ? dir : null;
}

export function getCurrentWorkingDirectory(): string | null {
  return currentWorkingDirectory;
}

/**
 * Return the active long task, or lazily create one rooted at the current
 * working directory. Used when a long-task tool is called without prior
 * detection so the user-visible plan/progress panel still materializes.
 */
export function getOrBootstrapLongTask(reason: string): LongTaskContext {
  if (currentLongTask) return currentLongTask;
  const baseDir = (currentWorkingDirectory || "/tmp").replace(/\/$/, "");
  const runId = `run_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${Math.random().toString(36).slice(2, 8)}`;
  const bootstrapped: LongTaskContext = {
    runId,
    workspaceDir: `${baseDir}/.cowork-runs/${runId}`,
    reason,
  };
  currentLongTask = bootstrapped;
  return bootstrapped;
}
