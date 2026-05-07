const unvalidatedSlideWrites = new Map<string, number>();
const unvalidatedSlideWriteTargets = new Map<string, Set<string>>();
const readRequiredBeforeWrite = new Map<string, string>();

const WEAK_LAYOUT_NODE_TYPES = new Set([
  "text",
  "shape",
  "line",
  "image",
  "stack",
  "grid",
  "split",
  "panel",
  "card",
  "frame",
  "inset",
  "band",
  "freeform-group",
  "decoration-grid",
  "decorative-shapes",
  "accent-rule",
]);

export function recordSlideWrite(deckPath: string, target?: string): number {
  const next = (unvalidatedSlideWrites.get(deckPath) ?? 0) + 1;
  unvalidatedSlideWrites.set(deckPath, next);
  if (target) {
    const targets = unvalidatedSlideWriteTargets.get(deckPath) ?? new Set<string>();
    targets.add(target);
    unvalidatedSlideWriteTargets.set(deckPath, targets);
  }
  return next;
}

export function slideAuthoringCheckpointHint(deckPath: string, writes = getUnvalidatedSlideWrites(deckPath)): string {
  if (writes < 2) {
    return "Recommended: run validate_render with render=true before treating the PPTX as final.";
  }
  return [
    `Checkpoint required: ${writes} SlideML2 slide write(s) have not been render-validated.`,
    "Call validate_render({deckPath, render:true}) now before adding more slides.",
    "Use the diagnostics from this early render to adjust the next 1-2 slides; do not wait until the whole deck is written.",
  ].join(" ");
}

export function slideSemanticLayoutHint(slide: unknown): string {
  const stats = collectSlideNodeStats(slide);
  const isManualTextLayout = stats.positionedTextNodes >= 4 || (stats.textNodes >= 6 && stats.strongSemanticNodes === 0);
  if (!isManualTextLayout) return "";
  const suggestions = suggestSemanticComponents(stats.textCorpus);
  const manualPhrase = stats.positionedTextNodes > 0
    ? `${stats.positionedTextNodes} manually positioned text node(s)`
    : `${stats.textNodes} text node(s)`;
  const semanticPhrase = stats.strongSemanticNodes === 0
    ? "no strong semantic component"
    : `only ${stats.strongSemanticNodes} strong semantic component(s)`;
  return [
    "Semantic layout warning:",
    `this slide has ${manualPhrase} and ${semanticPhrase}.`,
    `Prefer ${suggestions.join(", ")} before falling back to text+at.`,
    `Call describe_schema({components:${JSON.stringify(suggestions)}}) if any syntax is uncertain.`,
    "Use text+at mainly for labels, captions, precise overlays, or deliberate poster layouts.",
  ].join(" ");
}

export function getUnvalidatedSlideWrites(deckPath: string): number {
  return unvalidatedSlideWrites.get(deckPath) ?? 0;
}

export function hasUnvalidatedSlideWriteTarget(deckPath: string, target: string): boolean {
  return unvalidatedSlideWriteTargets.get(deckPath)?.has(target) ?? false;
}

export function resetSlideWritesAfterRender(deckPath: string): void {
  unvalidatedSlideWrites.delete(deckPath);
  unvalidatedSlideWriteTargets.delete(deckPath);
}

export function requireDeckReadBeforeWrite(deckPath: string, reason: string): void {
  readRequiredBeforeWrite.set(deckPath, reason);
}

export function clearDeckReadRequirement(deckPath: string): void {
  readRequiredBeforeWrite.delete(deckPath);
}

export function getDeckReadRequirement(deckPath: string): string | null {
  return readRequiredBeforeWrite.get(deckPath) ?? null;
}

export function resetAllSlideMl2AuthoringState(): void {
  unvalidatedSlideWrites.clear();
  unvalidatedSlideWriteTargets.clear();
  readRequiredBeforeWrite.clear();
}

function collectSlideNodeStats(value: unknown): {
  textNodes: number;
  positionedTextNodes: number;
  strongSemanticNodes: number;
  textCorpus: string;
} {
  let textNodes = 0;
  let positionedTextNodes = 0;
  let strongSemanticNodes = 0;
  const textParts: string[] = [];

  function walk(node: unknown): void {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : "";
    if (type) {
      if (type === "text") {
        textNodes += 1;
        if (Array.isArray(record.at)) positionedTextNodes += 1;
      } else if (!WEAK_LAYOUT_NODE_TYPES.has(type)) {
        strongSemanticNodes += 1;
      }
    }
    for (const [key, child] of Object.entries(record)) {
      if (typeof child === "string" && /^(title|headline|text|body|detail|description|label|caption|insight|value|source)$/i.test(key)) {
        textParts.push(child);
      }
      walk(child);
    }
  }

  walk(value);
  return {
    textNodes,
    positionedTextNodes,
    strongSemanticNodes,
    textCorpus: textParts.join(" ").slice(0, 4000),
  };
}

function suggestSemanticComponents(text: string): string[] {
  const lower = text.toLowerCase();
  if (/(timeline|roadmap|milestone|phase|date|year|quarter|时间|阶段|里程碑|路线图|进度|202\d|19\d\d|20\d\d)/i.test(text)) {
    return ["timeline", "process-flow", "axis-ruler"];
  }
  if (/(compare|comparison|versus|\bvs\b|competitor|benchmark|对比|比较|竞争|竞品|矩阵|优劣|差异)/i.test(text)) {
    return ["comparison-table", "comparison-list", "matrix-2x2"];
  }
  if (/(risk|mitigation|probability|impact|风险|缓解|概率|影响|预警|红线)/i.test(text)) {
    return ["failure-taxonomy", "matrix-2x2", "scorecard"];
  }
  if (/(process|workflow|pipeline|funnel|step|流程|链路|步骤|转化|漏斗)/i.test(text)) {
    return ["process-flow", "funnel", "stat-flow"];
  }
  if (/(%|\$|¥|亿|万|增长|下降|排名|份额|收入|利润|成本|kpi|metric|revenue|margin|growth|share)/i.test(text)) {
    return ["bar-list", "kpi-grid", "chart-with-rail"];
  }
  if (/(summary|conclusion|recommend|takeaway|结论|建议|摘要|判断|启示|核心)/i.test(text)) {
    return ["executive-summary", "key-takeaway", "takeaway-list"];
  }
  if (lower.includes("source") || /证据|来源|事实|案例|数据/.test(text)) {
    return ["evidence-layout", "fact-list", "chart-with-rail"];
  }
  return ["executive-summary", "explanation-block", "hero-and-support"];
}
