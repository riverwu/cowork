import { protectCjkLineBreakPunctuation, WORD_JOINER } from "../text-measure.js";
import type { TextRun } from "./types.js";

export function protectTextRunsForCjkLineBreaks(runs: TextRun[]): TextRun[] {
  let changed = false;
  const protectedRuns = runs.map((run, index) => {
    if (!run.text || run.mathOmml) return run;
    const text = protectCjkLineBreakPunctuation(run.text, {
      previous: previousRunChar(runs, index),
      next: nextRunChar(runs, index),
    });
    if (text === run.text) return run;
    changed = true;
    return { ...run, text };
  });
  return changed ? protectedRuns : runs;
}

function previousRunChar(runs: TextRun[], index: number): string | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const run = runs[i]!;
    if (run.breakLine) return undefined;
    const ch = lastVisibleChar(run.mathOmml ? "" : run.text);
    if (ch) return ch;
  }
  return undefined;
}

function nextRunChar(runs: TextRun[], index: number): string | undefined {
  if (runs[index]?.breakLine) return undefined;
  for (let i = index + 1; i < runs.length; i++) {
    const run = runs[i]!;
    const ch = firstVisibleChar(run.mathOmml ? "" : run.text);
    if (ch) return ch;
    if (run.breakLine) return undefined;
  }
  return undefined;
}

function firstVisibleChar(text: string): string | undefined {
  for (const ch of String(text || "")) {
    if (ch !== WORD_JOINER) return ch;
  }
  return undefined;
}

function lastVisibleChar(text: string): string | undefined {
  const chars = [...String(text || "")];
  for (let i = chars.length - 1; i >= 0; i--) {
    const ch = chars[i]!;
    if (ch !== WORD_JOINER) return ch;
  }
  return undefined;
}
