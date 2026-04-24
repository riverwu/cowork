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
    const text = typeof step.result === "string" ? step.result : JSON.stringify(step.result);
    for (const path of extractFilePaths(text)) {
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
  return extractFilePaths(text).map((path) => ({
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
