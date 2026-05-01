import type { DomNode } from "./types.js";
import { isTextKind, type TextKind } from "./text-kinds.js";

export interface InferredTextKind {
  kind: TextKind;
  confidence: number;
  reason: string;
}

export function inferTextKind(node: DomNode, parent?: DomNode): InferredTextKind {
  if (isTextKind(node.style)) return { kind: node.style, confidence: 1, reason: "explicit style" };
  const name = node.id.toLowerCase();
  if (name.includes("slide-title")) return { kind: "slide-title", confidence: 0.95, reason: "node name is slide-title" };
  if (name.includes("caption") || name.includes("source")) return { kind: "caption", confidence: 0.8, reason: "node name suggests caption/source" };
  if (name.includes("label")) return { kind: "label", confidence: 0.75, reason: "node name suggests label" };
  if (name.includes("metric") && name.includes("value")) return { kind: "metric-value", confidence: 0.85, reason: "node name suggests metric value" };
  if (name.includes("metric") && name.includes("label")) return { kind: "metric-label", confidence: 0.85, reason: "node name suggests metric label" };
  if (name.includes("title") && parent?.role) return { kind: "card-title", confidence: 0.78, reason: "title inside component/card" };
  if (name.includes("title")) return { kind: "section-title", confidence: 0.68, reason: "node name suggests title" };
  if (name.includes("summary") || name.includes("thesis") || name.includes("insight")) return { kind: "lead", confidence: 0.7, reason: "node name suggests lead insight" };
  if (name.includes("quote")) return { kind: "quote", confidence: 0.75, reason: "node name suggests quote" };
  if (name.includes("code")) return { kind: "code", confidence: 0.75, reason: "node name suggests code" };
  const text = typeof node.text === "string" ? node.text.trim() : "";
  if (/^[¥$€]?\d[\d,.]*(%|\+|万|亿|k|m|b)?$/i.test(text)) return { kind: "metric-value", confidence: 0.7, reason: "text looks like a metric value" };
  if (/^(数据来源|来源|免责声明|注[:：])/.test(text)) return { kind: "footnote", confidence: 0.72, reason: "text looks like source or footnote" };
  if (text.length <= 16 && !/[。.!?]/.test(text)) return { kind: "label", confidence: 0.5, reason: "short label-like text" };
  return { kind: "paragraph", confidence: 0.45, reason: "fallback paragraph" };
}
