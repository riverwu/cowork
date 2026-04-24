import type { LongTaskContext } from "./long-task";

let currentLongTask: LongTaskContext | null = null;

export function setCurrentLongTask(context: LongTaskContext | null): void {
  currentLongTask = context;
}

export function getCurrentLongTask(): LongTaskContext | null {
  return currentLongTask;
}
