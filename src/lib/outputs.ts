import type { Artifact } from "@/types";

export interface StepLike {
  skill: string;
  status: "running" | "done";
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
const OUTPUT_CAPABLE_TOOLS = new Set(["write_file", "run_node", "run_python", "shell", "update_task_progress"]);
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
    if (step.status !== "done" || step.success === false || step.result == null) continue;
    if (NON_OUTPUT_TOOLS.has(step.skill)) continue;
    if (!OUTPUT_CAPABLE_TOOLS.has(step.skill)) continue;

    const text = typeof step.result === "string" ? step.result : JSON.stringify(step.result);
    for (const path of extractProducedFilePaths(text)) {
      if (seen.has(path)) continue;
      seen.add(path);
      outputs.push({
        id: `file:${path}`,
        title: path.split("/").pop() || path,
        kind: "file",
        path,
      });
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
