import type { LLMMessage } from "./providers/types";
import type { Message } from "@/types";

export interface TaskBoundaryDecision {
  shouldIsolate: boolean;
  confidence: number;
  reason: string;
}

const CONTINUATION_PATTERNS = [
  /(继续|接着|沿用|基于|按照|参考|上面|上一|前面|刚才|这个|这些|该|其|它|它们|原来|已有|当前)/,
  /(修改|调整|优化|修复|重做|重新|再渲染|重新render|rerender|render|review|检查|对照|采纳|实现这些|这些问题)/i,
  /(第\s*\d+\s*(页|张)|slide\s*\d+|page\s*\d+)/i,
  /(same|previous|above|earlier|current|existing|revise|update|fix|continue|iterate|rerender|re-render)/i,
];

const NEW_TASK_PATTERNS = [
  /(新建|新的|另一个|另外一个|重新开始|从头|全新|换一个|再做一个|创建一个新的)/,
  /(生成|创建|制作|做一个|帮我写|产出|输出).*(ppt|pptx|slide deck|presentation|演示文稿|幻灯片|报告|文档|docx|pdf|网站|网页|应用|dashboard|看板)/i,
  /\b(create|generate|build|produce|write)\b.*\b(ppt|pptx|presentation|deck|report|document|docx|pdf|website|app|dashboard)\b/i,
  /(调研|研究|分析|总结|梳理|写一份|做一份).*(报告|调研|分析|方案|综述|ppt|演示文稿)?/,
];

const DELIVERABLE_TERMS = /(ppt|pptx|slide deck|presentation|演示文稿|幻灯片|报告|文档|docx|pdf|网站|网页|应用|dashboard|看板|调研|研究|分析)/i;

export function detectTaskBoundary(messages: Message[], currentContent: string): TaskBoundaryDecision {
  const current = currentContent.trim();
  if (!current) return noIsolation("empty message");

  const previousUsers = messages.filter((m) => m.role === "user").map((m) => m.content);
  if (previousUsers.length === 0) return noIsolation("first user message");

  const explicitFresh = /(新建|新的|另一个|另外一个|重新开始|从头|全新|换一个|再做一个|创建一个新的)/.test(current);
  if (explicitFresh) {
    return {
      shouldIsolate: true,
      confidence: 0.92,
      reason: "explicit fresh-task wording",
    };
  }

  if (CONTINUATION_PATTERNS.some((pattern) => pattern.test(current))) {
    return noIsolation("current message appears to continue or revise the active task");
  }

  const asksForNewTask = NEW_TASK_PATTERNS.some((pattern) => pattern.test(current));
  if (!asksForNewTask) return noIsolation("no strong new-task signal");

  const priorWindow = messages.slice(-8).map((m) => m.content).join("\n");
  const priorHasDeliverable = DELIVERABLE_TERMS.test(priorWindow);
  const currentHasDeliverable = DELIVERABLE_TERMS.test(current);

  if (priorHasDeliverable && currentHasDeliverable) {
    return {
      shouldIsolate: true,
      confidence: 0.78,
      reason: "new deliverable/research request after a prior deliverable task",
    };
  }

  return {
    shouldIsolate: true,
    confidence: 0.66,
    reason: "new standalone task request",
  };
}

export function buildTaskIsolationPrompt(reason?: string): string {
  return `## Task Isolation

This turn starts a fresh task boundary${reason ? ` (${reason})` : ""}.

- Treat earlier conversation turns, prior generated files, prior deck styles, prior research topics, prior images, and prior intermediate specs as out of scope unless the current user message explicitly asks to reuse them.
- Do not copy a previous PPT's visual language, palette, layout rhythm, title style, or illustration strategy by default.
- Only global long-term preferences/stable facts may be present in memory for this isolated run. Do not infer prior task choices from habit, old file paths, old deck names, old generated images, or old tool sequences.
- Active skills start empty for this task. Re-read any needed SKILL.md in the current request before relying on it.
- If the current request is ambiguous, ask one concise clarifying question instead of silently inheriting assumptions from the previous task.`;
}

export function isIsolatedAgentRun(messages: LLMMessage[]): boolean {
  const userMessages = messages.filter((m) => m.role === "user");
  return userMessages.length <= 1;
}

function noIsolation(reason: string): TaskBoundaryDecision {
  return { shouldIsolate: false, confidence: 0, reason };
}
