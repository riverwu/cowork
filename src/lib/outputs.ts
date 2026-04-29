import type { Artifact } from "@/types";

export interface StepLike {
  skill: string;
  status: "running" | "done";
  input?: unknown;
  result?: unknown;
  success?: boolean;
}

export interface ProducedOutput {
  id: string;
  title: string;
  kind: "artifact" | "file";
  path?: string;
  artifact?: Artifact;
  failed?: boolean;
}

const FILE_PATH_RE = /((?:~|\/)[^\n\r"'<>`]+?\.[A-Za-z0-9]+)/g;
const FILE_EXTENSIONS = /\.(txt|md|py|ts|tsx|js|jsx|rs|go|java|json|yaml|yml|toml|csv|xml|html|css|sql|sh|pdf|docx|xlsx|pptx|png|jpg|jpeg|gif|svg|mp4|mp3|zip|tar|gz)$/i;
const USER_FACING_OUTPUT_EXTENSIONS = /\.(txt|md|csv|html|pdf|docx|xlsx|pptx|png|jpg|jpeg|svg|zip)$/i;
const NON_OUTPUT_TOOLS = new Set([
  "search_knowledge",
  "read_file",
  "list_directory",
  "grep",
  "list_knowledge_sources",
  "get_source_catalog",
  "web_search",
  "web_fetch",
]);
const OUTPUT_CUE_RE = /(输出文件|最终文件|任务产出|产出|已创建|已生成|已保存|已写入|已导出|创建完成|生成完成|保存到|写入到|导出到|created|generated|saved|written|exported|output file|final file|file written successfully|file appended successfully|successfully (created|generated|saved|wrote|written|exported))/i;

export function extractFilePaths(text: string): string[] {
  const paths: string[] = [];
  let match;
  FILE_PATH_RE.lastIndex = 0;
  while ((match = FILE_PATH_RE.exec(text)) !== null) {
    const path = cleanExtractedPath(match[1]);
    if (FILE_EXTENSIONS.test(path) && !paths.includes(path)) {
      paths.push(path);
    }
  }
  return paths;
}

function cleanExtractedPath(path: string): string {
  return path.trim().replace(/[),.;:，。；：）】\]]+$/g, "");
}

export function outputsFromSteps(steps: StepLike[]): ProducedOutput[] {
  const outputs: ProducedOutput[] = [];
  const seen = new Set<string>();

  for (const step of steps) {
    if (step.status !== "done" || step.success === false) continue;
    if (NON_OUTPUT_TOOLS.has(step.skill)) continue;

    for (const output of structuredOutputsFromStep(step)) {
      const key = output.path || output.id;
      if (seen.has(key)) continue;
      seen.add(key);
      outputs.push(output);
    }
  }

  return outputs;
}

export function outputsFromText(text: string): ProducedOutput[] {
  return extractProducedFilePaths(text).map((path) => ({
    id: `file:${path}`,
    title: path.split("/").pop() || path,
    kind: "file",
    path,
  }));
}

export function outputsFromArtifacts(artifacts: Artifact[]): ProducedOutput[] {
  return artifacts.map((artifact) => ({
    id: `artifact:${artifact.id}`,
    title: artifact.title,
    kind: "artifact",
    artifact,
  }));
}

function extractProducedFilePaths(text: string): string[] {
  const paths: string[] = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const context = [lines[i - 1] || "", line, lines[i + 1] || ""].join("\n");
    if (!OUTPUT_CUE_RE.test(context)) continue;

    for (const path of extractFilePaths(line)) {
      if (!isMeaningfulProducedFilePath(path)) continue;
      if (!paths.includes(path)) paths.push(path);
    }
  }

  return paths;
}

function structuredOutputsFromStep(step: StepLike): ProducedOutput[] {
  const input = asRecord(step.input);
  if (!input) return [];

  if (step.skill === "update_task_progress") {
    return outputsFromTaskProgressInput(input);
  }

  if (step.skill === "browser") {
    return outputsFromBrowserResult(step.result);
  }

  if (step.skill === "render_slideml" || step.skill === "edit_slideml" || step.skill === "image_gen") {
    const path = stringValue(input.output_path);
    return path ? fileOutput(path) : [];
  }

  if (step.skill === "write_file") {
    const path = stringValue(input.path);
    return path ? fileOutput(path) : [];
  }

  return [];
}

function outputsFromTaskProgressInput(input: Record<string, unknown>): ProducedOutput[] {
  if (!Array.isArray(input.outputs)) return [];
  const outputs: ProducedOutput[] = [];
  for (const item of input.outputs) {
    const record = asRecord(item);
    if (!record) continue;
    const kind = record.kind === "artifact" ? "artifact" : record.kind === "note" ? "note" : "file";
    if (kind !== "file") continue;
    const path = stringValue(record.path);
    if (!path) continue;
    const title = stringValue(record.title) || path.split("/").pop() || path;
    const output = fileOutput(path, title);
    if (output.length > 0) outputs.push(output[0]);
  }
  return outputs;
}

function outputsFromBrowserResult(result: unknown): ProducedOutput[] {
  const parsed = typeof result === "string" ? parseJson(result) : result;
  const steps = Array.isArray(parsed) ? parsed : [];
  const outputs: ProducedOutput[] = [];
  for (const step of steps) {
    const record = asRecord(step);
    const action = stringValue(record?.action);
    const actionResult = asRecord(record?.result);
    if (!actionResult) continue;
    if (action === "screenshot" || action === "pdf" || (action === "cookies" && stringValue(actionResult.path))) {
      const path = stringValue(actionResult.path);
      if (!path) continue;
      const output = fileOutput(path);
      if (output.length > 0) outputs.push(output[0]);
    }
    if (action === "downloads" && Array.isArray(actionResult.downloads)) {
      for (const download of actionResult.downloads) {
        const downloadRecord = asRecord(download);
        const path = stringValue(downloadRecord?.path);
        if (!path) continue;
        const output = fileOutput(path, stringValue(downloadRecord?.suggestedFilename));
        if (output.length > 0) outputs.push(output[0]);
      }
    }
  }
  return outputs;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function fileOutput(path: string, title?: string): ProducedOutput[] {
  if (!isMeaningfulProducedFilePath(path)) return [];
  return [{
    id: `file:${path}`,
    title: title || path.split("/").pop() || path,
    kind: "file",
    path,
  }];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function isMeaningfulProducedFilePath(path: string): boolean {
  if (!USER_FACING_OUTPUT_EXTENSIONS.test(path)) return false;

  const normalized = path.replace(/\\/g, "/");
  if (
    normalized.includes("/.cowork-runs/") ||
    normalized.includes("/.cowork/skills/") ||
    normalized.includes("/node_modules/") ||
    normalized.includes("/src/") ||
    normalized.includes("/src-tauri/") ||
    normalized.includes("/dist/")
  ) {
    return false;
  }

  return true;
}
