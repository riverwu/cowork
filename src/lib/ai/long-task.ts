import type { LLMMessage } from "./providers/types";

export interface LongTaskContext {
  runId: string;
  workspaceDir: string;
  reason: string;
}

const LONG_TASK_PATTERNS = [
  /\b\d{2,}\s*(files?|documents?|docs?|pdfs?|ppts?|pptx|slides?|pages?|reports?)\b/i,
  /\b(batch|bulk|many|large|directory|folder|corpus|dataset)\b/i,
  /\b(10\+|20\+|30\+|50\+|100\+)\b/i,
  /(大量|批量|很多|目录|文件夹|几十|上百|多份|长报告|大文件)/,
  /(10|20|30|50|100)\s*(页|个|份|篇|张)/,
  /(ppt|pptx|slide deck|presentation|报告|文档).*(10|20|30|50|100)\s*(页|pages?|slides?)/i,
];

const ATTACHMENT_PATTERNS = [
  /Attached files?:/i,
  /\[File:\s*[^\]]+\]\([^)]+\)/i,
  /(附件|附加文件|这个文件|这些文件|根据.*文件|参考.*文件)/,
];

const FILE_DELIVERABLE_PATTERNS = [
  /(生成|创建|制作|输出|写|帮我写|做一个|产出).*(ppt|pptx|slide deck|presentation|演示文稿|幻灯片)/i,
  /(生成|创建|制作|输出|写|帮我写|做一个|产出).*(报告|文档|docx|pdf|白皮书|方案|分析)/i,
  /(生成|创建|制作|输出|写|帮我写|做一个|产出).*(网站|网页|应用|dashboard|看板|代码|项目)/i,
  /\b(create|generate|write|build|produce)\b.*\b(ppt|pptx|presentation|slide deck|report|document|docx|pdf|website|app|dashboard)\b/i,
];

const DECK_STYLE_PATTERNS = [
  /(Apple Design Guidelines|San Francisco|Product-centric|Photorealistic|Zen minimalist|typeface|typography)/i,
  /(风格|视觉|设计规范|排版|字体|产品中心|极简|摄影|图片)/,
];

export function detectLongTask(messages: LLMMessage[], workingDirectory?: string): LongTaskContext | null {
  const current = [...messages].reverse().find((m) => m.role === "user")?.content || "";
  const explicitScaleScore = LONG_TASK_PATTERNS.reduce((count, pattern) => count + (pattern.test(current) ? 1 : 0), 0);
  const hasAttachment = ATTACHMENT_PATTERNS.some((pattern) => pattern.test(current));
  const createsFileDeliverable = FILE_DELIVERABLE_PATTERNS.some((pattern) => pattern.test(current));
  const hasDesignHeavyDeckRequirements = DECK_STYLE_PATTERNS.some((pattern) => pattern.test(current))
    && /(ppt|pptx|slide deck|presentation|演示文稿|幻灯片)/i.test(current);
  const score = explicitScaleScore
    + (hasAttachment && createsFileDeliverable ? 2 : 0)
    + (hasDesignHeavyDeckRequirements ? 1 : 0)
    + (createsFileDeliverable && /(ppt|pptx|slide deck|presentation|演示文稿|幻灯片)/i.test(current) ? 1 : 0);

  if (score === 0) return null;

  const runId = `run_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${Math.random().toString(36).slice(2, 8)}`;
  const baseDir = workingDirectory || "/tmp";
  return {
    runId,
    workspaceDir: `${baseDir.replace(/\/$/, "")}/.cowork-runs/${runId}`,
    reason: buildReason({ explicitScaleScore, hasAttachment, createsFileDeliverable, hasDesignHeavyDeckRequirements, score }),
  };
}

function buildReason(signals: {
  explicitScaleScore: number;
  hasAttachment: boolean;
  createsFileDeliverable: boolean;
  hasDesignHeavyDeckRequirements: boolean;
  score: number;
}): string {
  const reasons: string[] = [];
  if (signals.explicitScaleScore > 0) reasons.push("explicit large-scale input or output was requested");
  if (signals.hasAttachment && signals.createsFileDeliverable) reasons.push("the task creates a file deliverable from attached source material");
  if (signals.hasDesignHeavyDeckRequirements) reasons.push("the deck has substantial design and generation requirements");
  if (reasons.length === 0 && signals.score > 0) reasons.push("the request may exceed a single model response");
  return `Long-task mode enabled because ${reasons.join(", ")}.`;
}

export function buildLongTaskPrompt(context: LongTaskContext): string {
  return `## Long Task Execution Framework

This request is in long-task mode.

Run workspace: \`${context.workspaceDir}\`
Run id: \`${context.runId}\`
Reason: ${context.reason}

Use the workspace as durable scratch space for plans, extracted source summaries, intermediate specs, scripts, logs, and final deliverables.

Required workflow:
1. Call \`update_task_progress\` first with phase \`plan\`, status \`running\`. Include a concise \`summary\` and a \`steps[]\` checklist of concrete execution steps. The UI shows \`steps[]\` as the live task list, so keep it current and keep exactly one step \`running\` while work is active. Do not rely on chat prose to communicate task status.
2. For large inputs, build an inventory before analysis. Save it as \`${context.workspaceDir}/inventory.json\` or \`${context.workspaceDir}/inventory.md\`.
3. Summarize source files in batches. Save per-source and aggregate summaries in the workspace; do not load all raw content into chat at once.
4. For large outputs, write a compact specification first, such as \`${context.workspaceDir}/deck_spec.json\`, \`report_outline.md\`, or \`site_spec.json\`.
5. For PowerPoint/deck tasks, prefer the active deck skill or toolchain. When SlideML2 is active, write \`deck_plan.md\`, then use its direct CLI/tool calls one slide at a time; do not wrap that CLI loop in generated scripts.
6. Use generic pptxgenjs/\`run_node\` scripts only when no deck skill/toolchain is active or when the user explicitly asks for that custom path.
7. Keep each \`write_file\` content payload under 12,000 characters. If a generated script is large, write it in chunks with \`write_file\`: first chunk uses mode \`overwrite\`, later chunks use mode \`append\`. Keep chunks ordered as imports/helpers, content/layout sections, then final writeFile call.
8. Execute generated Node scripts with \`run_node\` using a short loader such as \`require("${context.workspaceDir}/scripts/build_deck.js")\`. Do not use \`shell\` to run \`node\` for generated deliverables; installed skill CLIs documented as shell commands are not generated deliverable scripts.
9. Generate final deliverables from the saved spec using tools. Prefer templates, arrays, helper functions, and loops over repeated generated code.
10. Call \`update_task_progress\` whenever a step starts or finishes. Always send the full current \`steps[]\` list with updated statuses, and include any important output paths.
11. Before final response, verify final files exist or were successfully written, then report only the useful paths and completion status.

Do not put large source extracts, giant scripts, or full generated documents in assistant text. Store them in workspace files and only summarize progress to the user.`;
}
