import { describe, expect, it } from "vitest";
import { COMPONENT_DEFINITIONS, describeComponents } from "./component-registry.js";
import { sourceToRenderedDeck } from "./source-deck.js";
import { renderToAst } from "./render.js";
import {
  clearRenderDiagnostics,
  getRenderDiagnostics,
  type LayoutDiagnostic,
} from "./diagnostics.js";
import { validateDeck } from "./validate.js";
import type { DomNode, Slideml2SourceDeck } from "./types.js";

/**
 * Component-isolation baseline: every COMPONENT_DEFINITIONS entry must render
 * cleanly under three usage profiles — minimum required fields, typical fields,
 * and dense (upper-bound items / long copy). The contract is that an LLM that
 * produces ONLY the documented field set, with reasonable values, never trips a
 * blocking diagnostic.
 *
 * Blocking codes considered here: schema validation errors (validate.ts) and
 * render diagnostics: FALLBACK_FAILED, COLLISION, TINY_RECT, SQUASHED, DROP,
 * LOW_CONTRAST (clustered), UNKNOWN_COLOR, UNKNOWN_STYLE.
 *
 * If a fixture below fails, the fix belongs inside the component's fallback in
 * components.ts / component-registry.ts (saner defaults, autoFit shrink, optional
 * children, larger min-height) — not in the test fixture.
 */

const BLOCKING_CODES: ReadonlySet<LayoutDiagnostic["code"]> = new Set<LayoutDiagnostic["code"]>([
  "FALLBACK_FAILED",
  "COLLISION",
  "TINY_RECT",
  "SQUASHED",
  "LOW_CONTRAST",
  "UNKNOWN_COLOR",
  "UNKNOWN_STYLE",
]);

const PARAGRAPH_SHORT = "短句证据，一行可读完。";
const PARAGRAPH_MID = "中等密度的解释文本，一两行覆盖关键判断。";
const PARAGRAPH_LONG = "稍微长一点的解释文本，但不应超过两行：核心判断 + 关键依据 + 一个补充说明，避免逐字读。";

const LIGHT_BRAND_OVERRIDE: Slideml2SourceDeck["deck"]["themeOverride"] = {
  colors: {
    brand: { primary: "C41E3A" },
    background: "FDF6E3",
    surface: "FFFFFF",
    text: { primary: "1A1A1A", secondary: "555555", muted: "888888" },
  } as never,
};

const DARK_OVERRIDE: Slideml2SourceDeck["deck"]["themeOverride"] = {
  colors: {
    brand: { primary: "C0392B" },
    background: "0D1117",
    surface: "161B22",
    text: { primary: "F0F6FC", secondary: "8B949E", muted: "8B949E", inverse: "0D1117" },
  } as never,
};

interface Profile {
  name: "minimum" | "typical" | "dense";
  build: (componentName: string, schema: Record<string, unknown>) => Record<string, unknown> | null;
}

function valuesForField(componentName: string, fieldName: string, fieldSchema: Record<string, unknown>, profile: Profile["name"]): unknown {
  const fieldType = String(fieldSchema.type || "");
  const enumValues = (fieldSchema.enum as string[] | undefined) || (fieldSchema.values as string[] | undefined) || [];
  if (fieldType === "image-ref") return "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iOTYiPjxyZWN0IHdpZHRoPSIyNDAiIGhlaWdodD0iOTYiIGZpbGw9IiMyNTYzZWIiLz48L3N2Zz4=";
  if (fieldType === "color-ref") return "brand.primary";
  if (fieldType === "boolean") return false;
  if (fieldType === "number") {
    if (componentName === "code-block" && fieldName === "columns") return profile === "dense" ? 2 : 1;
    if (componentName === "code-block" && fieldName === "fontSize") return profile === "dense" ? 6.5 : 8;
    if (componentName === "code-block" && fieldName === "maxLines") return profile === "dense" ? 18 : 8;
    if (componentName === "equation" && fieldName === "fontSize") return profile === "dense" ? 11 : 14;
    if (fieldName === "value") return profile === "dense" ? 92 : 60;
    if (fieldName === "max") return 100;
    if (fieldName === "columns") return profile === "dense" ? 4 : 3;
    if (fieldName === "rows") return 2;
    if (fieldName === "length") return 4;
    if (fieldName === "thickness") return 0.06;
    return 1;
  }
  if (fieldType === "enum" && enumValues.length > 0) {
    if (fieldName === "tone") {
      const safe = enumValues.find((value) => value !== "inverse");
      return safe || enumValues[0];
    }
    return enumValues[0];
  }
  if (fieldType === "array") {
    const count = profile === "dense" ? 6 : profile === "typical" ? 3 : 2;
    if (componentName === "code-block" && fieldName === "highlightLines") return profile === "dense" ? [2, { start: 4, end: 6 }] : [1];
    return arrayValueFor(componentName, fieldName, count);
  }
  if (fieldType === "object") {
    if (fieldName === "data" && componentName === "chart-card") return { labels: ["A", "B", "C"], series: [{ name: "Series", values: [10, 20, 30] }] };
    if (fieldName === "data" && componentName === "table-card") return { headers: ["Name", "Value"], rows: [["A", "1"], ["B", "2"]] };
    if (fieldName === "left") return { id: "iso.left", type: "text", text: "Left", style: "paragraph" };
    if (fieldName === "right") return { id: "iso.right", type: "text", text: "Right", style: "paragraph" };
    if (fieldName === "hero") return { id: "iso.hero", type: "key-takeaway", headline: "核心主张", detail: "主区域负责承载页面的中心判断。" };
    if (fieldName === "evidence") return { id: "iso.evidence", type: "image-card", src: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iOTYiPjxyZWN0IHdpZHRoPSIyNDAiIGhlaWdodD0iOTYiIGZpbGw9IiMyNTYzZWIiLz48L3N2Zz4=", title: "Evidence" };
    if (fieldName === "insight") return { id: "iso.insight", type: "insight-card", headline: "核心判断", detail: "证据说明。" };
    if (fieldName === "rail") return { id: "iso.rail", type: "side-rail", title: "解读", body: "解释证据的含义。" };
    if (fieldName === "visual") return { src: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iOTYiPjxyZWN0IHdpZHRoPSIyNDAiIGhlaWdodD0iOTYiIGZpbGw9IiMyNTYzZWIiLz48L3N2Zz4=", fit: "cover" };
    if (fieldName === "heroStat") return { value: "72%", label: "完成度", caption: "+12pp" };
    return {};
  }
  if (fieldName === "text") return profile === "dense" ? PARAGRAPH_LONG : PARAGRAPH_SHORT;
  if (fieldName === "title") return profile === "dense" ? "稍长一些的标题文本以测试自适应" : "标题示例";
  if (fieldName === "subtitle") return "副标题简短一句";
  if (fieldName === "label" || fieldName === "name" || fieldName === "term") return profile === "dense" ? "较长的标签文本" : "标签";
  if (fieldName === "value" || fieldName === "afterValue" || fieldName === "beforeValue") return profile === "dense" ? "1234.5%" : "60%";
  if (fieldName === "headline") return "核心判断一句话讲清楚";
  if (fieldName === "definition") return PARAGRAPH_MID;
  if (fieldName === "body" || fieldName === "description" || fieldName === "bio" || fieldName === "caption" || fieldName === "detail") return PARAGRAPH_MID;
  if (componentName === "code-block" && fieldName === "code") {
    return [
      "function score(items) {",
      "  return items",
      "    .filter((item) => item.active)",
      "    .map((item) => item.value)",
      "    .reduce((sum, value) => sum + value, 0);",
      "}",
    ].join("\n");
  }
  if (componentName === "equation" && fieldName === "latex") return "\\tan\\alpha = \\frac{\\sin\\alpha}{\\cos\\alpha}";
  if (componentName === "equation" && fieldName === "style") return "body";
  if (componentName === "equation" && fieldName === "size") return "md";
  if (componentName === "equation" && fieldName === "align") return "center";
  if (fieldName === "source" || fieldName === "code") return "来源 / 引用";
  if (fieldName === "step" || fieldName === "number") return "01";
  if (fieldName === "plan") return "Pro";
  if (fieldName === "price") return "¥99";
  if (fieldName === "period") return "/ mo";
  if (fieldName === "ctaText") return "立即开始";
  if (fieldName === "language") return "ts";
  if (fieldName === "valueLabel") return "60%";
  if (fieldName === "icon") return "ellipse";
  if (fieldName === "iconBackground") return "brand.tint";
  if (fieldName === "iconColor") return "brand.primary";
  if (fieldName === "tone") {
    // "inverse" only makes sense on a dark surface; the bare slide test deck is
    // light, so prefer the first non-"inverse" option to keep contrast valid.
    const safe = enumValues.find((value) => value !== "inverse");
    return safe || enumValues[0] || "brand";
  }
  if (fieldName === "src" || fieldName === "image") return "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iOTYiPjxyZWN0IHdpZHRoPSIyNDAiIGhlaWdodD0iOTYiIGZpbGw9IiMyNTYzZWIiLz48L3N2Zz4=";
  if (fieldName === "alt") return "示例图片";
  if (fieldName === "link") return "https://example.com";
  if (fieldName === "role") return "工程师";
  if (fieldName === "accent" || fieldName === "eyebrow") return "前言";
  return profile === "dense" ? PARAGRAPH_LONG : PARAGRAPH_SHORT;
}

function arrayValueFor(componentName: string, fieldName: string, count: number): unknown[] {
  const titleAt = (i: number) => `条目 ${i + 1}`;
  const bodyAt = (i: number) => `条目 ${i + 1} 的简短说明文字。`;
  const dateAt = (i: number) => `2026-${String(i + 1).padStart(2, "0")}`;
  if ((componentName === "org-chart" || componentName === "tree-chart" || componentName === "decision-tree") && fieldName === "nodes") {
    const root = componentName === "org-chart" ? "总经理" : componentName === "decision-tree" ? "入口判断" : "一级分类";
    return [
      { id: "root", title: root, role: "Owner", level: 0, tone: "brand" },
      { id: "left", title: "分支 A", parent: "root", level: 1, tone: "positive" },
      { id: "right", title: "分支 B", parent: "root", level: 1, tone: "warning" },
      ...Array.from({ length: Math.max(0, count - 3) }, (_, i) => ({ id: `extra${i}`, title: `子项 ${i + 1}`, parent: i % 2 === 0 ? "left" : "right", level: 2, tone: i % 2 === 0 ? "neutral" : "danger" })),
    ];
  }
  if ((componentName === "org-chart" || componentName === "tree-chart" || componentName === "decision-tree") && fieldName === "links") return [{ source: "root", target: "left" }, { source: "root", target: "right" }];
  if ((componentName === "roadmap-plan" || componentName === "gantt-chart") && fieldName === "periods") return ["Q1", "Q2", "Q3", "Q4"];
  if (componentName === "roadmap-plan" && fieldName === "lanes") {
    return Array.from({ length: Math.min(count, 4) }, (_, i) => ({ label: `工作流 ${i + 1}`, items: [{ title: `里程碑 ${i + 1}`, start: "Q1", end: i % 2 === 0 ? "Q2" : "Q3", tone: i % 2 === 0 ? "brand" : "positive" }] }));
  }
  if (componentName === "gantt-chart" && fieldName === "tasks") {
    return Array.from({ length: Math.min(count, 6) }, (_, i) => ({ title: `任务 ${i + 1}`, start: i % 4, end: Math.min(3, i % 4 + 1), owner: `负责人 ${i + 1}`, tone: i % 2 === 0 ? "brand" : "positive" }));
  }
  if (componentName === "cycle-diagram" && fieldName === "steps") return Array.from({ length: Math.min(count, 5) }, (_, i) => ({ title: `循环 ${i + 1}`, body: bodyAt(i) }));
  if (componentName === "hub-spoke" && fieldName === "items") return Array.from({ length: Math.min(count, 8) }, (_, i) => ({ title: `支撑 ${i + 1}`, body: bodyAt(i) }));
  if (componentName === "stakeholder-map" && fieldName === "items") return Array.from({ length: Math.min(count, 6) }, (_, i) => ({ label: `干系人 ${i + 1}`, influence: i % 2 === 0 ? "high" : "low", interest: i % 3 === 0 ? "high" : "low", tone: i % 2 === 0 ? "brand" : "neutral" }));
  if (componentName === "raci-matrix" && fieldName === "roles") return ["Owner", "PM", "Legal", "Ops"].slice(0, Math.min(count, 4));
  if (componentName === "raci-matrix" && fieldName === "tasks") return Array.from({ length: Math.min(count, 5) }, (_, i) => ({ title: `任务 ${i + 1}`, assignments: ["A", "R", "C", "I"] }));
  if (componentName === "raci-matrix" && fieldName === "assignments") return Array.from({ length: Math.min(count, 5) }, () => ["A", "R", "C", "I"]);
  if (componentName === "kanban-board" && fieldName === "columns") return ["待办", "进行中", "完成"].map((title, i) => ({ title, items: [{ title: `卡片 ${i + 1}`, owner: "团队" }] }));
  if (componentName === "pyramid" && fieldName === "levels") return Array.from({ length: Math.min(count, 5) }, (_, i) => ({ label: `层级 ${i + 1}`, body: bodyAt(i) }));
  if (componentName === "funnel" && fieldName === "stages") {
    return Array.from({ length: Math.min(count, 5) }, (_, i) => ({
      label: `阶段 ${i + 1}`,
      value: Math.max(120, 1200 - i * 220),
      valueLabel: `${Math.max(120, 1200 - i * 220)}`,
      body: bodyAt(i),
      tone: i % 2 === 0 ? "brand" : "positive",
    }));
  }
  if (componentName === "venn-diagram" && fieldName === "sets") return Array.from({ length: Math.min(count, 3) }, (_, i) => ({ label: `集合 ${i + 1}`, body: bodyAt(i) }));
  if (componentName === "venn-diagram" && fieldName === "intersections") return [{ label: "共同机会" }, { label: "重叠能力" }];
  if (componentName === "value-chain" && fieldName === "stages") return Array.from({ length: Math.min(count, 5) }, (_, i) => ({ title: `环节 ${i + 1}`, body: bodyAt(i) }));
  if (componentName === "architecture-map" && fieldName === "layers") return Array.from({ length: Math.min(count, 4) }, (_, i) => ({ label: `架构层 ${i + 1}`, services: [`服务 ${i + 1}.1`, `服务 ${i + 1}.2`] }));
  if (componentName === "geo-region-map" && fieldName === "regions") return Array.from({ length: Math.min(count, 8) }, (_, i) => ({ label: `区域 ${i + 1}`, value: `${(i + 1) * 12}%`, tone: i % 2 === 0 ? "positive" : "warning" }));
  if (componentName === "geo-region-map" && fieldName === "legend") return [{ label: "达标", tone: "positive" }, { label: "关注", tone: "warning" }];
  if (componentName === "calendar-plan" && fieldName === "weekdays") return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  if (componentName === "calendar-plan" && fieldName === "events") return Array.from({ length: Math.min(count, 6) }, (_, i) => ({ day: i * 4 + 2, title: `会议 ${i + 1}`, tone: i % 2 === 0 ? "brand" : "positive" }));
  if (componentName === "sankey" && fieldName === "nodes") return [{ id: "in", label: "输入", stage: "Input" }, { id: "mid", label: "处理", stage: "Review" }, { id: "out", label: "输出", stage: "Output" }];
  if (componentName === "sankey" && fieldName === "links") return [{ source: "in", target: "mid", value: 120 }, { source: "mid", target: "out", value: 72 }];
  if (componentName === "sankey" && fieldName === "stages") return ["Input", "Review", "Output"];
  if (componentName === "kpi-grid" && (fieldName === "metrics" || fieldName === "items")) {
    return Array.from({ length: count }, (_, i) => ({ value: `${(i + 1) * 12}%`, label: `指标 ${i + 1}`, trend: i % 2 === 0 ? "up" : "down" }));
  }
  if (componentName === "stat-strip" && fieldName === "items") {
    return Array.from({ length: Math.min(count, 4) }, (_, i) => ({ value: `${(i + 1) * 18}%`, label: `维度 ${i + 1}` }));
  }
  if (componentName === "checklist" && fieldName === "items") {
    return Array.from({ length: count }, (_, i) => ({ text: `检查项 ${i + 1}`, status: i % 3 === 0 ? "checked" : i % 3 === 1 ? "warning" : "unchecked" }));
  }
  if ((componentName === "process-flow" || componentName === "step-card") && (fieldName === "steps" || fieldName === "items")) {
    return Array.from({ length: count }, (_, i) => ({ title: titleAt(i), body: bodyAt(i) }));
  }
  if (componentName === "probe-flow" && (fieldName === "steps" || fieldName === "items")) {
    return Array.from({ length: count }, (_, i) => ({ title: titleAt(i), body: bodyAt(i) }));
  }
  if (componentName === "factorial-matrix" && fieldName === "rows") return Array.from({ length: Math.min(count, 3) }, (_, i) => `行 ${i + 1}`);
  if (componentName === "factorial-matrix" && fieldName === "columns") return Array.from({ length: Math.min(count, 3) }, (_, i) => `列 ${i + 1}`);
  if (componentName === "factorial-matrix" && fieldName === "cells") {
    const n = Math.min(count, 3);
    return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => ({ text: `${r + 1}-${c + 1}`, tone: (r + c) % 3 === 0 ? "positive" : "neutral" })));
  }
  if (componentName === "failure-taxonomy" && fieldName === "items") {
    return Array.from({ length: Math.min(count, 3) }, (_, i) => ({ title: `失败类型 ${i + 1}`, rate: `${(i + 1) * 12}%`, examples: [`案例 ${i + 1}.1`, `案例 ${i + 1}.2`] }));
  }
  if (componentName === "hero-and-support" && (fieldName === "supports" || fieldName === "items")) {
    return Array.from({ length: Math.min(count, 4) }, (_, i) => ({ title: `支撑点 ${i + 1}`, body: bodyAt(i), tone: i % 2 === 0 ? "brand" : "neutral" }));
  }
  if (componentName === "chart-with-rail" && fieldName === "items") {
    return Array.from({ length: Math.min(count, 4) }, (_, i) => `解读 ${i + 1}`);
  }
  if (componentName === "snapshot-callouts" && (fieldName === "callouts" || fieldName === "items")) {
    return Array.from({ length: Math.min(count, 4) }, (_, i) => ({ title: `标注 ${i + 1}`, body: bodyAt(i), tone: i % 2 === 0 ? "brand" : "neutral" }));
  }
  if (componentName === "evidence-layout" && fieldName === "annotations") {
    return [{ id: "iso.annotation", type: "pointer-arrow", label: "关键变化", anchor: "middle-right", direction: "left" }];
  }
  if (componentName === "timeline" && fieldName === "items") {
    return Array.from({ length: count }, (_, i) => ({ time: dateAt(i), title: titleAt(i), body: bodyAt(i) }));
  }
  if (componentName === "axis-ruler" && fieldName === "items") {
    return Array.from({ length: count }, (_, i) => ({ label: titleAt(i), body: bodyAt(i) }));
  }
  if (componentName === "logo-strip" && (fieldName === "logos" || fieldName === "items" || fieldName === "images")) {
    return Array.from({ length: count }, (_, i) => ({ src: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iOTYiPjxyZWN0IHdpZHRoPSIyNDAiIGhlaWdodD0iOTYiIGZpbGw9IiMyNTYzZWIiLz48L3N2Zz4=", alt: `Logo ${i + 1}` }));
  }
  if (componentName === "pricing-card" && fieldName === "features") {
    return Array.from({ length: count }, (_, i) => `特性 ${i + 1}`);
  }
  if (componentName === "bar-list" && fieldName === "items") {
    return Array.from({ length: count }, (_, i) => ({ label: `项 ${i + 1}`, value: (count - i) * 10 }));
  }
  if (componentName === "legend" && fieldName === "items") {
    const palette = ["brand.primary", "success", "warning", "danger", "blue", "purple"];
    return Array.from({ length: count }, (_, i) => ({ label: `类别 ${i + 1}`, color: palette[i % palette.length] }));
  }
  if (fieldName === "pros") return Array.from({ length: count }, (_, i) => `优点 ${i + 1}`);
  if (fieldName === "cons") return Array.from({ length: count }, (_, i) => `缺点 ${i + 1}`);
  if (fieldName === "strengths") return Array.from({ length: count }, (_, i) => `优势 ${i + 1}`);
  if (fieldName === "weaknesses") return Array.from({ length: count }, (_, i) => `劣势 ${i + 1}`);
  if (fieldName === "opportunities") return Array.from({ length: count }, (_, i) => `机会 ${i + 1}`);
  if (fieldName === "threats") return Array.from({ length: count }, (_, i) => `威胁 ${i + 1}`);
  if (fieldName === "labels") return Array.from({ length: count }, (_, i) => `标签 ${i + 1}`);
  if (fieldName === "headers") return Array.from({ length: count }, (_, i) => `列 ${i + 1}`);
  if (fieldName === "rows") return Array.from({ length: count }, (_, i) => Array.from({ length: 2 }, (__, j) => `r${i + 1}c${j + 1}`));
  if (fieldName === "series") return [{ name: "Series", values: Array.from({ length: count }, (_, i) => (i + 1) * 10) }];
  if (fieldName === "items" || fieldName === "points" || fieldName === "bullets") return Array.from({ length: count }, (_, i) => `要点 ${i + 1}`);
  if (fieldName === "paragraphs") return Array.from({ length: count }, (_, i) => `段落 ${i + 1}：${PARAGRAPH_MID}`);
  return Array.from({ length: count }, (_, i) => `元素 ${i + 1}`);
}

const PROFILES: Profile[] = [
  {
    name: "minimum",
    build: (componentName, schema) => {
      const fields: Record<string, unknown> = {};
      for (const [key, def] of Object.entries(schema)) {
        const detail = def as Record<string, unknown>;
        if (detail.required || isMinimumOneOf(componentName, key)) {
          fields[key] = valuesForField(componentName, key, detail, "minimum");
        }
      }
      return fields;
    },
  },
  {
    name: "typical",
    build: (componentName, schema) => {
      const fields: Record<string, unknown> = {};
      for (const [key, def] of Object.entries(schema)) {
        const detail = def as Record<string, unknown>;
        if (detail.required || optionalShouldBeIncluded(componentName, key)) {
          fields[key] = valuesForField(componentName, key, detail, "typical");
        }
      }
      return fields;
    },
  },
  {
    name: "dense",
    build: (componentName, schema) => {
      const fields: Record<string, unknown> = {};
      for (const [key, def] of Object.entries(schema)) {
        const detail = def as Record<string, unknown>;
        fields[key] = valuesForField(componentName, key, detail, "dense");
      }
      return fields;
    },
  },
];

/**
 * Some components have "one of" semantic requirements not expressed by the
 * schema (article needs text OR paragraphs; label needs text; etc.). The
 * minimum-profile fixture must still pick at least one to validate cleanly.
 */
function isMinimumOneOf(componentName: string, fieldName: string): boolean {
  if (componentName === "article" && fieldName === "text") return true;
  if (componentName === "label" && fieldName === "text") return true;
  if (componentName === "callout" && fieldName === "text") return true;
  // matrix-2x2 needs items OR quadrantLabels — exercise items in the
  // minimum fixture so the validator's "either-or" rule passes.
  if (componentName === "matrix-2x2" && fieldName === "items") return true;
  return false;
}

function optionalShouldBeIncluded(componentName: string, fieldName: string): boolean {
  if (fieldName === "tone" || fieldName === "subtitle" || fieldName === "caption" || fieldName === "body" || fieldName === "description" || fieldName === "trend") return true;
  if (componentName === "chart-card" && (fieldName === "showLegend" || fieldName === "showValues")) return true;
  if (fieldName === "rule" && (componentName === "title-lockup" || componentName === "eyebrow")) return true;
  // article without text/paragraphs is not a useful fixture; opt the typical
  // profile in too so the test exercises the actual flow.
  if (componentName === "article" && fieldName === "text") return true;
  // matrix-2x2 schema accepts items OR quadrantLabels (label-only mode); the
  // typical profile must include items so the validator passes.
  if (componentName === "matrix-2x2" && fieldName === "items") return true;
  return false;
}

const COMPONENT_SKIPLIST: ReadonlySet<string> = new Set<string>();

function nodeForComponent(componentName: string, slideId: string, fields: Record<string, unknown>): DomNode {
  const node = {
    id: `${slideId}.${componentName}`,
    type: componentName as DomNode["type"],
    ...fields,
  } as DomNode;
  const definition = COMPONENT_DEFINITIONS.find((item) => item.name === componentName);
  if (definition?.children.required && (!Array.isArray(node.children) || node.children.length === 0)) {
    node.children = requiredChildFixture(componentName, slideId);
  }
  return node;
}

function requiredChildFixture(componentName: string, slideId: string): DomNode[] {
  if (componentName === "freeform-group") {
    return [{
      id: `${slideId}.${componentName}.mark`,
      type: "shape",
      preset: "ellipse",
      anchor: "top-left",
      offsetX: 1,
      offsetY: 1,
      width: 0.7,
      height: 0.7,
      fill: "brand.primary",
      fillOpacity: 0.18,
      line: "brand.primary",
    } as DomNode];
  }
  return [{ id: `${slideId}.${componentName}.body`, type: "text", text: "Supporting context." } as DomNode];
}

function buildSourceDeck(slideId: string, child: DomNode, fillContent = true, themeOverride?: Slideml2SourceDeck["deck"]["themeOverride"]): Slideml2SourceDeck {
  const children: DomNode[] = fillContent ? [child] : [child];
  return {
    slideml2: 2,
    deck: {
      size: "16x9",
      theme: "default",
      brand: { name: "Test", primary: "2563EB" },
      themeOverride,
    },
    slides: [{
      id: slideId,
      // Intentionally omit slide.title so hero-title components (deck-title /
      // section-break / title-lockup) don't trip DUPLICATE_HERO_TITLE. The
      // fixture's job is to prove the component renders cleanly on its own.
      children,
    }],
  };
}

function blockingDiagnostics(diags: LayoutDiagnostic[]): LayoutDiagnostic[] {
  return diags.filter((d) => BLOCKING_CODES.has(d.code) && d.severity !== "info");
}

function describeFailure(componentName: string, profile: Profile["name"], deck: Slideml2SourceDeck, diags: LayoutDiagnostic[], validationErrors: string[] = []): string {
  const diagSummary = diags.map((d) => `[${d.code} on ${d.nodeId || "?"}] ${d.message}`).join("\n");
  const valSummary = validationErrors.length > 0 ? `\nValidation errors:\n${validationErrors.join("\n")}` : "";
  return `\n${componentName} (${profile}) produced blocking diagnostics:\n${diagSummary}${valSummary}\nSlide JSON:\n${JSON.stringify(deck.slides[0], null, 2)}`;
}

describe("component-isolation baseline", () => {
  const semanticNames = COMPONENT_DEFINITIONS
    .map((definition) => definition.name)
    .filter((name) => !COMPONENT_SKIPLIST.has(name));

  for (const name of semanticNames) {
    const definition = describeComponents([name]).found[name];
    if (!definition) continue;
    const schema = definition.fields as Record<string, unknown>;

    for (const profile of PROFILES) {
      it(`${name} renders cleanly (${profile.name})`, () => {
        clearRenderDiagnostics();
        const fields = profile.build(name, schema);
        if (!fields) return;
        const slideId = `iso-${name}-${profile.name}`.replace(/[^a-z0-9-]/g, "_");
        const child = nodeForComponent(name, slideId, fields);
        const source = buildSourceDeck(slideId, child);
        const validation = validateDeck(source);
        const validationDescriptions = validation.errors.map((e) => `[${e.code}${e.path ? ` ${e.path}` : ""}] ${e.message}${e.suggestedFix ? ` :: ${e.suggestedFix}` : ""}`);
        expect(validation.errors, describeFailure(name, profile.name, source, [], validationDescriptions)).toHaveLength(0);
        renderToAst(sourceToRenderedDeck(source));
        const blocking = blockingDiagnostics(getRenderDiagnostics());
        expect(blocking, describeFailure(name, profile.name, source, blocking, validationDescriptions)).toHaveLength(0);
      });
    }

    for (const themeCase of [
      { name: "light-brand", override: LIGHT_BRAND_OVERRIDE },
      { name: "dark", override: DARK_OVERRIDE },
    ] as const) {
      it(`${name} renders cleanly (typical, ${themeCase.name} theme)`, () => {
        clearRenderDiagnostics();
        const fields = PROFILES[1].build(name, schema);
        if (!fields) return;
        const slideId = `iso-${name}-typical-${themeCase.name}`.replace(/[^a-z0-9-]/g, "_");
        const child = nodeForComponent(name, slideId, fields);
        const source = buildSourceDeck(slideId, child, true, themeCase.override);
        const validation = validateDeck(source);
        const validationDescriptions = validation.errors.map((e) => `[${e.code}${e.path ? ` ${e.path}` : ""}] ${e.message}${e.suggestedFix ? ` :: ${e.suggestedFix}` : ""}`);
        expect(validation.errors, describeFailure(name, "typical", source, [], validationDescriptions)).toHaveLength(0);
        renderToAst(sourceToRenderedDeck(source));
        const blocking = blockingDiagnostics(getRenderDiagnostics());
        expect(blocking, describeFailure(name, "typical", source, blocking, validationDescriptions)).toHaveLength(0);
      });
    }
  }
});
