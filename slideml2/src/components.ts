import type { DomNode, SurfaceOverride } from "./types.js";

/**
 * Agent-facing surface customization. ANY composite component accepts these
 * options as `options.surface` (or top-level shortcuts `fill`, `border`,
 * `elevation`, `accent`) and the helper below applies them to the
 * component's outer wrapper. Lets agents personalize line / color / cornerRadius
 * on every component without each component re-declaring 8 fields.
 */
export interface AgentBorder {
  color?: string;
  /** Border width in cm. */
  width?: number;
  style?: "solid" | "dash" | "dashDot" | "dot";
  cornerRadius?: number;
}

export interface AgentSurface extends SurfaceOverride {
  fill?: string;
  fillOpacity?: number;
  line?: string;
  lineOpacity?: number;
  lineWidth?: number;
  lineDash?: "solid" | "dash" | "dashDot" | "dot";
  border?: AgentBorder | string;
  /** Shorthand for border.color when only the color matters. */
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: "solid" | "dash" | "dashDot" | "dot";
  cornerRadius?: number;
  padding?: number;
  elevation?: "flat" | "raised" | "floating" | "outlined";
  accent?: "none" | "left" | "top";
  accentColor?: string;
  accentWidth?: number;
}

export type FeatureCardLayout = "vertical" | "horizontal";
export type FeatureCardDecorationKind = "image" | "shape" | "marker" | "none";

export interface FeatureCardDecoration {
  kind?: FeatureCardDecorationKind;
  src?: string;
  iconSrc?: string;
  shape?: string;
  icon?: string;
  marker?: DecorationMarkerInput;
  size?: DecorationMarkerSize;
  color?: string;
  background?: string;
  tone?: DecorationMarkerTone;
  variant?: DecorationMarkerVariant;
}

export type DecorationMarkerShape =
  | "dot"
  | "ring"
  | "square"
  | "rounded-square"
  | "diamond"
  | "side-bar"
  | "slash"
  | "index-chip";

export type DecorationMarkerVariant = "tint" | "solid" | "outline" | "ghost" | "ring" | "badge";
export type DecorationMarkerTone = "brand" | "neutral" | "muted" | "positive" | "warning" | "danger";
export type DecorationMarkerSize = "xs" | "sm" | "md" | "lg" | "xl" | number;
export type DecorationMarkerInput =
  | DecorationMarkerShape
  | string
  | {
      shape?: DecorationMarkerShape | string;
      marker?: DecorationMarkerShape | string;
      preset?: DecorationMarkerShape | string;
      type?: DecorationMarkerShape | string;
      content?: string;
      glyph?: string;
      text?: string;
      tone?: DecorationMarkerTone;
      variant?: DecorationMarkerVariant;
      size?: DecorationMarkerSize;
    };

const DECORATION_MARKER_SHAPES = new Set<string>([
  "dot", "ring", "square", "rounded-square", "diamond", "side-bar", "slash", "index-chip",
]);

type NormalizedDecorationMarker = {
  shape: DecorationMarkerShape;
  tone: DecorationMarkerTone;
  variant: DecorationMarkerVariant;
  size: DecorationMarkerSize;
  content?: string;
};

function decorationMarkerNode(
  slideId: string,
  id: string,
  marker: DecorationMarkerInput | undefined,
  defaults: { shape?: DecorationMarkerShape; tone?: DecorationMarkerTone; variant?: DecorationMarkerVariant; size?: DecorationMarkerSize; valign?: "top" | "middle" | "bottom" } = {},
): DomNode | undefined {
  const spec = normalizeDecorationMarker(marker, defaults);
  if (!spec) return undefined;
  const dims = decorationMarkerDimensionsCm(spec.shape, markerSizeCm(spec.size), spec.content);
  return {
    id: `${slideId}.${id}`,
    type: "shape",
    role: "item-marker",
    marker: spec,
    fixedWidth: dims.w,
    fixedHeight: dims.h,
    align: "start",
    valign: defaults.valign || "middle",
    optional: true,
    ...(spec.content
      ? {
          text: spec.content,
          style: "label",
          bold: true,
          color: decorationMarkerContentColor(spec.tone, spec.variant),
          autoFit: "shrink",
          noWrap: true,
        }
      : {}),
  };
}

function normalizeDecorationMarker(
  marker: DecorationMarkerInput | undefined,
  defaults: { shape?: DecorationMarkerShape; tone?: DecorationMarkerTone; variant?: DecorationMarkerVariant; size?: DecorationMarkerSize },
): NormalizedDecorationMarker | null {
  if (marker === undefined) return null;
  const rawShape = typeof marker === "string"
    ? marker
    : marker?.shape ?? marker?.marker ?? marker?.preset ?? marker?.type ?? defaults.shape;
  const shape = normalizeDecorationMarkerShape(rawShape);
  const explicitContent = typeof marker === "object"
    ? marker.content ?? marker.glyph ?? marker.text
    : undefined;
  const content = normalizeDecorationMarkerContent(explicitContent ?? (shape ? undefined : rawShape));
  const fallbackShape = normalizeDecorationMarkerShape(defaults.shape) || "rounded-square";
  const resolvedShape = shape || (content ? fallbackShape : null);
  if (!resolvedShape) return null;
  const explicitVariant = typeof marker === "object" ? marker.variant : undefined;
  return {
    shape: resolvedShape,
    tone: (typeof marker === "object" ? marker.tone : undefined) || defaults.tone || "brand",
    variant: explicitVariant || (content ? "badge" : defaults.variant) || "tint",
    size: (typeof marker === "object" ? marker.size : undefined) || defaults.size || "sm",
    ...(content ? { content } : {}),
  };
}

function normalizeDecorationMarkerShape(value: unknown): DecorationMarkerShape | null {
  if (typeof value !== "string") return null;
  const normalized =
    value === "rect" ? "square" :
    value === "roundRect" || value === "roundedSquare" || value === "round-square" || value === "rounded-rect" ? "rounded-square" :
    value === "ellipse" ? "dot" :
    value === "bar" || value === "stripe" || value === "side-rail" ? "side-bar" :
    value === "chip" || value === "index" ? "index-chip" :
    value;
  return DECORATION_MARKER_SHAPES.has(normalized) ? normalized as DecorationMarkerShape : null;
}

function normalizeDecorationMarkerContent(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const glyphs = Array.from(trimmed);
  if (glyphs.length > 3) return undefined;
  return trimmed;
}

function decorationMarkerContentColor(tone: DecorationMarkerTone, variant: DecorationMarkerVariant): string {
  if (tone === "neutral" || tone === "muted") return "text.primary";
  if (variant === "solid" || variant === "badge") return "text.inverse";
  if (tone === "positive") return "success";
  if (tone === "warning") return "warning";
  if (tone === "danger") return "danger";
  return "brand.primary";
}

function markerSizeCm(value: DecorationMarkerSize | undefined): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.max(0.12, Math.min(0.9, value));
  if (value === "xs") return 0.18;
  if (value === "sm") return 0.28;
  if (value === "lg") return 0.52;
  if (value === "xl") return 0.68;
  return 0.38;
}

function decorationMarkerDimensionsCm(shape: DecorationMarkerShape, size: number, content?: string): { w: number; h: number } {
  if (content) {
    const glyphSize = Math.max(0.42, size);
    const widthMultiplier = Math.max(1, Math.min(1.6, Array.from(content).length * 0.62));
    return { w: glyphSize * widthMultiplier, h: glyphSize };
  }
  if (shape === "side-bar") return { w: Math.max(0.06, size * 0.22), h: Math.max(0.55, size * 1.9) };
  if (shape === "slash") return { w: Math.max(0.5, size * 1.55), h: Math.max(0.16, size * 0.32) };
  if (shape === "index-chip") return { w: size * 1.35, h: size };
  return { w: size, h: size };
}

export function textChipWidthCm(text: string, options: { min?: number; max?: number; padding?: number; cjk?: number; latin?: number } = {}): number {
  const min = options.min ?? 1.0;
  const max = options.max ?? 4.2;
  const padding = options.padding ?? 0.62;
  const cjk = options.cjk ?? 0.34;
  const latin = options.latin ?? 0.18;
  let width = padding;
  for (const ch of text) {
    if (/\s/.test(ch)) width += latin * 0.55;
    else width += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? cjk : isWideVisualSymbol(ch) ? cjk * 1.06 : latin;
  }
  return Math.max(min, Math.min(max, width));
}

function isWideVisualSymbol(ch: string): boolean {
  return /[\u2605\u2606\u2713\u2714\u2717\u2715\u2716\u26a0\u25cf\u25cb\u25c6\u25c7\u25a0\u25a1\u25b2\u25b3\u25b6\u25b7\u25bc\u25bd]/.test(ch);
}

/**
 * Merge agent-supplied surface options into a wrapper node. Only fields the
 * agent set are applied — defaults already on the wrapper survive.
 *
 * Two shapes accepted:
 *   ```
 *   { surface: { fill, border:{color,width}, elevation } }
 *   { fill, borderColor, borderWidth, elevation, accent, accentColor }
 *   ```
 * Both forms can coexist; the explicit `surface:` block wins on conflict
 * because the agent had to type it deliberately.
 */
export function applyAgentSurface<T extends DomNode>(node: T, options: { surface?: AgentSurface } & AgentSurface = {}): T {
  const merged: AgentSurface = { ...options, ...(options.surface || {}) };
  const out = { ...(node as DomNode) } as DomNode;
  if (typeof merged.fill === "string") out.fill = merged.fill;
  if (typeof merged.fillOpacity === "number") out.fillOpacity = merged.fillOpacity;
  if (typeof merged.line === "string") out.line = merged.line;
  if (typeof merged.lineOpacity === "number") out.lineOpacity = merged.lineOpacity;
  if (typeof merged.lineWidth === "number") out.lineWidth = merged.lineWidth;
  if (merged.lineDash) {
    out.lineDash = merged.lineDash;
    if (merged.lineDash === "solid") delete out.dash;
    else out.dash = merged.lineDash;
  }
  // Apply flat shorthand first so the object form (`surface.border:{...}`)
  // can override on conflict — the object form is the explicit-wins variant.
  if (typeof merged.borderColor === "string") out.line = merged.borderColor;
  if (typeof merged.borderWidth === "number") out.lineWidth = merged.borderWidth;
  if (merged.borderStyle) {
    out.borderStyle = merged.borderStyle;
    if (merged.borderStyle === "solid") delete out.dash;
    else out.dash = merged.borderStyle;
  }
  if (typeof merged.cornerRadius === "number") out.cornerRadius = merged.cornerRadius;
  if (merged.border && typeof merged.border === "object") {
    if (typeof merged.border.color === "string") out.line = merged.border.color;
    if (typeof merged.border.width === "number") out.lineWidth = merged.border.width;
    if (merged.border.style) {
      out.borderStyle = merged.border.style;
      if (merged.border.style === "solid") delete out.dash;
      else out.dash = merged.border.style;
    }
    if (typeof merged.border.cornerRadius === "number") out.cornerRadius = merged.border.cornerRadius;
  } else if (typeof merged.border === "string") {
    out.line = merged.border;
  }
  if (typeof merged.padding === "number") out.padding = merged.padding;
  if (merged.elevation) out.elevation = merged.elevation;
  if (merged.shadow && typeof merged.shadow === "object") out.shadow = merged.shadow;
  if (merged.gradient && typeof merged.gradient === "object") out.gradient = merged.gradient;
  if (merged.accent === "none" || merged.accent === "left" || merged.accent === "top") out.accent = merged.accent;
  if (typeof merged.accentColor === "string") out.accentColor = merged.accentColor;
  if (typeof merged.accentWidth === "number") out.accentWidth = merged.accentWidth;
  return out as T;
}

type RichContentRun = Record<string, unknown>;

function richContent(value: unknown): RichContentRun[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const runs = value.filter((run): run is RichContentRun => {
    if (!run || typeof run !== "object" || Array.isArray(run)) return false;
    const rec = run as Record<string, unknown>;
    if (typeof rec.text === "string") return true;
    return rec.kind === "math" || rec.kind === "cite" || rec.kind === "footnoteRef" || rec.kind === "icon" || rec.kind === "token";
  });
  return runs.length ? runs : undefined;
}

function textWithRichContent(text: string, content?: unknown): { text: string; content?: RichContentRun[] } {
  const runs = richContent(content);
  return runs ? { text, content: runs } : { text };
}

function toneColor(tone: unknown, fallback = "brand.primary"): string {
  if (tone === "positive" || tone === "success" || tone === "good") return "success";
  if (tone === "warning" || tone === "caution" || tone === "warn") return "warning";
  if (tone === "danger" || tone === "error" || tone === "bad" || tone === "negative") return "danger";
  if (tone === "neutral" || tone === "muted") return "text.muted";
  if (tone === "flat") return "text.muted";
  return fallback;
}

function toneAccentColor(tone: unknown, fallback = "brand.primary"): string {
  if (tone === "positive" || tone === "success" || tone === "good") return "success.accent";
  if (tone === "warning" || tone === "caution" || tone === "warn") return "warning.accent";
  if (tone === "danger" || tone === "error" || tone === "bad" || tone === "negative") return "danger.accent";
  if (tone === "neutral" || tone === "muted" || tone === "flat") return "divider";
  return fallback;
}

export function titleText(slideId: string, id: string, text: string): DomNode {
  return { id: `${slideId}.${id}`, type: "slide-title", text, align: "left" };
}

export function paragraphText(slideId: string, id: string, text: string): DomNode {
  return { id: `${slideId}.${id}`, type: "text", text, align: "left", style: "paragraph" };
}

export function bulletList(slideId: string, id: string, items: string[], density: "comfortable" | "compact" = "comfortable"): DomNode {
  return { id: `${slideId}.${id}`, type: "bullets", items, density };
}

export function imageBlock(slideId: string, id: string, src: string, alt: string, fit: "cover" | "contain" | "fill" = "cover"): DomNode {
  return { id: `${slideId}.${id}`, type: "image", src, alt, fit };
}

export function imageWithCaptionPanel(slideId: string, imageSrc: string, imageTitle: string): DomNode {
  const image = { ...imageBlock(slideId, "brief-image", imageSrc, imageTitle, "contain"), caption: imageTitle };
  return {
    id: `${slideId}.visualPanel`,
    type: "stack",
    direction: "vertical",
    gap: 0.3,
    role: "image-with-caption",
    children: [
      { ...image, layoutWeight: 1, minHeight: 6.8 },
    ],
  };
}

export function metricCard(
  slideId: string,
  id: string,
  value: string,
  label: string,
  options: {
    unit?: string;
    trend?: "up" | "down" | "flat";
    delta?: string;
    status?: "positive" | "warning" | "danger" | "neutral" | "brand";
    source?: string;
    comparison?: string;
    sparkline?: Array<number | string>;
    variant?: "plain" | "card" | "compact";
    density?: "comfortable" | "compact";
    peerAligned?: boolean;
  } & { surface?: AgentSurface } & AgentSurface = {},
): DomNode {
  const trend = options.trend;
  const unit = options.unit && options.unit.trim() ? options.unit.trim() : "";
  // Trend semantics are conveyed by *coloring* the value (and label) — no
  // extra glyph, so narrow cards never have to make room for an arrow that
  // would otherwise force the value text to wrap.
  const statusColor = toneColor(options.status, "");
  const valueColor = statusColor || (trend === "up" ? "success" : trend === "down" ? "danger" : trend === "flat" ? "text.muted" : "brand.primary");
  const labelColor = statusColor || (trend === "up" ? "success" : trend === "down" ? "danger" : "text.muted");
  const dense = options.density === "compact" || options.variant === "compact";
  // If a unit string was supplied, suffix it inline as a muted run so the
  // raw value stays the dominant character — but no separate column.
  const content: Array<Record<string, unknown>> = unit
    ? [{ text: value, color: valueColor }, { text: ` ${unit}`, color: "text.muted" }]
    : [];
  // Cap the value's vertical demand. With 3-col KPI rows on tall content
  // areas (96vi8n slide 8/15/18/20) the metric-value's autoFit:"shrink"
  // would let the digits fill ~3.6cm — single short numbers ("23:1",
  // "78%") at 100pt+ look bloated and leave the rest of the card empty.
  //
  // maxHeight on a flex (layoutWeight) child is unreliable in this
  // solver — the same pattern silently failed in `outline.num` (96vi8n
  // slide 3 review). We use a wrapping container with fixedHeight: 2.4
  // so the cap is actually enforced by layout, not just intent. The
  // value text inside still autoFit-shrinks to fit short strings.
  const valueSize = metricValueSize(value, dense);
  const peerAligned = options.peerAligned === true;
  const valueBandHeight = peerAligned ? (dense ? 0.74 : 1.65) : undefined;
  const labelBandHeight = peerAligned ? (dense ? 0.34 : 1.05) : undefined;
  const deltaBandHeight = peerAligned ? (dense ? 0.3 : 0.36) : undefined;
  const valueNode: DomNode = {
    id: `${slideId}.${id}.value`,
    type: "text",
    text: value,
    style: "metric-value",
    color: valueColor,
    align: "center",
    valign: "bottom",
    autoFit: "shrink",
    noWrap: true,
    ...(valueSize ? { size: valueSize } : {}),
    ...(dense && peerAligned ? { fontScale: 0.82 } : {}),
    ...(content.length > 0 ? { content } : {}),
  };
  // maxHeight on the wrap stack flexes downward — tight rows (timeline
  // cells with metric-card content, 5-up KPI grids) get the cell's
  // actual height; tall 3-up cells stop at 2.4cm so the digit doesn't
  // balloon to 3.6cm. fixedHeight here would force a hard 2.4cm demand
  // and break dense layouts (timeline-content tests caught this).
  const valueWrap: DomNode = {
    id: `${slideId}.${id}.value-wrap`,
    type: "stack",
    direction: "vertical",
    gap: 0,
    align: "center",
    valign: "bottom",
    ...(valueBandHeight !== undefined
      ? { fixedHeight: valueBandHeight, maxHeight: valueBandHeight }
      : { maxHeight: dense ? 1.55 : metricValueNeedsCompactScale(value) ? 1.85 : 2.4, layoutWeight: 2 }),
    children: [valueNode],
  };
  const spark = (options.sparkline || []).map((v) => typeof v === "number" ? v : Number.parseFloat(String(v))).filter((v) => Number.isFinite(v));
  const sparkMax = Math.max(1, ...spark);
  const sparkNodes: DomNode[] = spark.slice(0, 12).map((v, idx) => ({
    id: `${slideId}.${id}.spark.${idx}`,
    type: "shape",
    preset: "rect",
    fill: valueColor,
    line: valueColor,
    layoutWeight: 1,
    fixedHeight: Math.max(0.1, Math.min(0.42, (v / sparkMax) * 0.42)),
    valign: "bottom",
  }));
  const children: DomNode[] = [
    valueWrap,
    {
      id: `${slideId}.${id}.label`,
      type: "text",
      text: label,
      style: "metric-label",
      color: labelColor,
      align: "center",
      valign: "top",
      ...(labelBandHeight !== undefined ? { fixedHeight: labelBandHeight } : { layoutWeight: 1 }),
      autoFit: "shrink",
      optional: true,
    },
  ];
  if (options.delta || options.comparison) {
    children.push({
      id: `${slideId}.${id}.delta`,
      type: "text",
      text: [options.delta, options.comparison].filter(Boolean).join(" · "),
      style: "label",
      color: valueColor,
      align: "center",
      ...(deltaBandHeight !== undefined ? { fixedHeight: deltaBandHeight } : { minHeight: dense ? 0.25 : 0.35 }),
      autoFit: "shrink",
      optional: true,
    });
  }
  if (sparkNodes.length >= 2) {
    children.push({
      id: `${slideId}.${id}.spark`,
      type: "stack",
      direction: "horizontal",
      gap: 0.04,
      align: "center",
      valign: "bottom",
      fixedHeight: 0.45,
      optional: true,
      children: sparkNodes,
    });
  }
  if (options.source) {
    children.push({ id: `${slideId}.${id}.source`, type: "text", text: options.source, style: "caption", color: "text.muted", align: "center", minHeight: 0.25, autoFit: "shrink", optional: true });
  }
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: dense ? 0.1 : 0.18,
    role: "metric-card",
    valign: "middle",
    ...(options.variant === "card" ? { fill: "surface", line: "divider", padding: 0.45, cornerRadius: 0.1 } : {}),
    children,
  } as DomNode, options);
}

function metricValueNeedsCompactScale(value: string): boolean {
  const weighted = weightedTextLength(value);
  const cjkCount = Array.from(value).filter((char) => /[\u4e00-\u9fff]/.test(char)).length;
  return weighted >= 4.2 || (cjkCount >= 2 && weighted >= 3.0) || /^[-+]/.test(value.trim());
}

function metricValueSize(value: string, dense: boolean): "xs" | "sm" | undefined {
  if (dense) return "xs";
  return metricValueNeedsCompactScale(value) ? "sm" : undefined;
}

export function stepCard(
  slideId: string,
  id: string,
  step: string,
  title: string,
  body: string,
  options: {
    content?: unknown;
    bullets?: string[];
    icon?: string;
    marker?: DecorationMarkerInput;
    status?: "positive" | "warning" | "danger" | "neutral" | "brand";
    owner?: string;
    time?: string;
    variant?: "plain" | "card" | "compact";
    density?: "comfortable" | "compact";
  } & { surface?: AgentSurface } & AgentSurface = {},
): DomNode {
  // umzrkm fix: step label defaulted to brand.primary, which fails 4.5:1
  // contrast on mid-saturation brand themes (e.g. teal 5B8A8A on light
  // E8F3F3 ≈ 3.4:1). Use text.primary so the label always reads; the step
  // number is still bold + prominent via the numbered-step style. Agents
  // who want a colored label can override `color` directly.
  const dense = options.density === "compact" || options.variant === "compact";
  const status = toneColor(options.status, "text.primary");
  const iconFill = status === "text.primary" ? "surface.subtle" : status;
  const meta = [options.owner, options.time].filter(Boolean).join(" · ");
  const marker = decorationMarkerNode(slideId, `${id}.marker`, options.marker, {
    shape: "dot",
    tone: options.status || "brand",
    variant: "tint",
    size: dense ? "xs" : "sm",
  });
  const titleRowChildren: DomNode[] = [
    ...(marker ? [marker] : options.icon ? [{ id: `${slideId}.${id}.icon`, type: "shape" as const, preset: options.icon, fill: iconFill, line: status, fixedWidth: 0.55, fixedHeight: 0.55, align: "start" as const }] : []),
    { id: `${slideId}.${id}.title`, type: "text" as const, text: title, style: "card-title" as const, minHeight: 0.65, autoFit: "shrink" as const, layoutWeight: 1 },
  ];
  const children: DomNode[] = [
    { id: `${slideId}.${id}.step`, type: "text", text: step, style: "numbered-step", color: status, minHeight: 0.42, autoFit: "shrink" },
    {
      id: `${slideId}.${id}.titleRow`,
      type: "stack",
      direction: "horizontal",
      gap: 0.2,
      valign: "middle",
      children: titleRowChildren,
    },
  ];
  if (meta) children.push({ id: `${slideId}.${id}.meta`, type: "text", text: meta, style: "label", color: "text.muted", minHeight: 0.35, autoFit: "shrink", optional: true });
  if (body || richContent(options.content)) {
    children.push({ id: `${slideId}.${id}.body`, type: "text", ...textWithRichContent(body, options.content), style: "caption", valign: "top", autoFit: "shrink", optional: dense });
  }
  if (options.bullets && options.bullets.length) children.push({ ...bulletList(slideId, `${id}.bullets`, options.bullets.slice(0, 4), "compact"), optional: true });
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: dense ? 0.14 : 0.25,
    role: "step-card",
    ...(options.variant === "card" ? { fill: "surface", line: "divider", padding: 0.5, cornerRadius: 0.1 } : {}),
    children,
  } as DomNode, options);
}

export function comparisonCard(
  slideId: string,
  id: string,
  title: string,
  points: string[],
  options: {
    subtitle?: string;
    badge?: string;
    body?: string;
    content?: unknown;
    metrics?: Array<{ label: string; value: string; tone?: "brand" | "positive" | "warning" | "danger" | "neutral" }>;
    pros?: string[];
    cons?: string[];
    score?: string;
    winner?: boolean;
    footer?: string;
    variant?: "plain" | "card" | "compact";
    density?: "comfortable" | "compact";
  } & { surface?: AgentSurface } & AgentSurface = {},
): DomNode {
  const dense = options.density === "compact" || options.variant === "compact";
  const crowded = points.length + (options.pros?.length || 0) + (options.cons?.length || 0) + (options.metrics?.length || 0) + (options.body ? 1 : 0) + (options.score ? 1 : 0) > 8;
  const visiblePoints = points.slice(0, crowded ? 3 : 6);
  const children: DomNode[] = [
    ...(options.badge ? [{ id: `${slideId}.${id}.badge`, type: "text" as const, text: options.badge, style: "label" as const, uppercase: true, color: options.winner ? "text.inverse" : "text.primary", fill: options.winner ? "brand.primary" : "surface.subtle", cornerRadius: 0.18, align: "center" as const, fixedHeight: 0.42, fixedWidth: textChipWidthCm(options.badge, { min: 1.2, max: 4.6, padding: 0.6 }), autoFit: "shrink" as const, noWrap: true }] : []),
    { id: `${slideId}.${id}.title`, type: "text", text: title, style: "card-title", color: "text.primary", minHeight: 0.6, autoFit: "shrink" },
    ...(options.subtitle && !crowded ? [{ id: `${slideId}.${id}.subtitle`, type: "text" as const, text: options.subtitle, style: "label" as const, color: "text.muted", minHeight: 0.32, autoFit: "shrink" as const }] : []),
  ];
  if (options.score) children.push({ id: `${slideId}.${id}.score`, type: "text", text: options.score, style: crowded ? "label" : "metric-value", color: options.winner ? "brand.primary" : "text.primary", align: "left", minHeight: crowded ? 0.34 : 0.7, autoFit: "shrink" });
  if ((options.body || richContent(options.content)) && !crowded) children.push({ id: `${slideId}.${id}.body`, type: "text", ...textWithRichContent(options.body || "", options.content), style: "caption", color: "text.primary", autoFit: "shrink", minHeight: 0.45 });
  if (visiblePoints.length) children.push({ ...bulletList(slideId, `${id}-points`, visiblePoints, "compact"), maxHeight: crowded ? 1.55 : undefined });
  if (options.metrics && options.metrics.length) {
    children.push({
      id: `${slideId}.${id}.metrics`,
      type: "stack",
      direction: "horizontal",
      gap: 0.2,
      fixedHeight: 0.5,
      children: options.metrics.slice(0, crowded ? 2 : 3).map((m, index) => ({
        id: `${slideId}.${id}.metric${index + 1}`,
        type: "text" as const,
        text: `${m.label}: ${m.value}`,
        style: "label" as const,
        color: toneColor(m.tone, "text.primary"),
        fill: "surface.subtle",
        cornerRadius: 0.12,
        align: "center" as const,
        valign: "middle" as const,
        autoFit: "shrink" as const,
        layoutWeight: 1,
      })),
    });
  }
  if ((options.pros && options.pros.length) || (options.cons && options.cons.length)) {
    const prosText = (options.pros || []).slice(0, crowded ? 1 : 2).join(" / ");
    const consText = (options.cons || []).slice(0, crowded ? 1 : 2).join(" / ");
    children.push({
      id: `${slideId}.${id}.tradeoff`,
      type: "grid",
      columns: 2,
      gap: 0.2,
      fixedHeight: crowded ? 0.48 : 0.72,
      children: [
        { id: `${slideId}.${id}.pros`, type: "text", text: prosText ? `+ ${prosText}` : "+", style: "caption", color: "success", autoFit: "shrink", valign: "middle" },
        { id: `${slideId}.${id}.cons`, type: "text", text: consText ? `- ${consText}` : "-", style: "caption", color: "danger", autoFit: "shrink", valign: "middle" },
      ],
    });
  }
  if (options.footer && !crowded) children.push({ id: `${slideId}.${id}.footer`, type: "text", text: options.footer, style: "caption", color: "text.muted", minHeight: 0.35, autoFit: "shrink" });
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: dense ? 0.16 : 0.25,
    role: "comparison-card",
    ...(options.variant === "card" || options.winner ? { fill: options.winner ? "brand.tint" : "surface", line: options.winner ? "brand.primary" : "divider", padding: 0.5, cornerRadius: 0.1 } : {}),
    children,
  } as DomNode, options);
}

export function insightCallout(slideId: string, id: string, text: string): DomNode {
  // minHeight + autoFit: long callout text (a sentence or two) was being
  // clipped at 1.45cm. The 1.45 floor still yields a tall callout block when
  // text is short.
  return { id: `${slideId}.${id}`, type: "text", text, style: "callout", role: "callout", minHeight: 1.0, autoFit: "shrink" };
}

export interface NumberedListItem {
  text?: string;
  title?: string;
  headline?: string;
  label?: string;
  name?: string;
  body?: string;
  detail?: string;
  description?: string;
}

function numberedListItem(item: string | NumberedListItem): string | { text: string; runs: Array<{ text: string; marks?: string[] }> } {
  if (typeof item === "string") return item.trim();
  const title = String(item.title ?? item.headline ?? item.label ?? item.name ?? item.text ?? "").trim();
  const body = String(item.body ?? item.detail ?? item.description ?? "").trim();
  if (title && body) {
    const separator = /[\u4e00-\u9fff\uff00-\uffef]$/.test(title) ? "\uff1a" : ": ";
    return {
      text: `${title}${separator}${body}`,
      runs: [
        { text: title, marks: ["bold"] },
        { text: `${separator}${body}` },
      ],
    };
  }
  if (title) return { text: title, runs: [{ text: title, marks: ["bold"] }] };
  return body;
}

export function numberedList(slideId: string, id: string, items: Array<string | NumberedListItem>, density: "comfortable" | "compact" = "comfortable"): DomNode {
  return { id: `${slideId}.${id}`, type: "bullets", items: items.map(numberedListItem).filter(Boolean), density, numbered: true };
}

export function quoteBlock(
  slideId: string,
  id: string,
  text: string,
  source?: string,
  opts: { ornament?: boolean } & { surface?: AgentSurface } & AgentSurface = {},
): DomNode {
  const textWeight = weightedTextLength(text);
  const hasSource = Boolean(source && source.trim());
  const compact = textWeight > 42 || (hasSource && textWeight > 32);
  const veryCompact = textWeight > 64;
  const quotePadding = veryCompact ? 0.28 : compact ? 0.36 : 0.48;
  const quoteFontScale = veryCompact ? 0.72 : compact ? 0.82 : undefined;
  const quoteMinHeight = veryCompact
    ? (hasSource ? 2.0 : 1.55)
    : compact
      ? (hasSource ? 1.75 : 1.35)
      : (hasSource ? 1.55 : 1.15);
  // Decorative oversized opening quote glyph (❝). Reads as typographic
  // ornament without an extra image. Suppress with `ornament:false`.
  // It is intentionally layered behind the text so it never consumes vertical
  // flow space or squeezes the actual quote/source out of the component.
  const wantOrnament = opts.ornament !== false;
  const children: DomNode[] = [];
  if (wantOrnament) {
    children.push({
      id: `${slideId}.${id}.ornament`,
      type: "text",
      text: "\u201C",
      // Display-tier glyph in muted accent — visually subordinate to the
      // quote text itself.
      style: "hero",
      color: "brand.primary",
      align: "left",
      valign: "top",
      layer: "behind",
      autoFit: "shrink",
      optional: true,
    });
  }
  children.push({
    id: `${slideId}.${id}.text`,
    type: "text",
    text: `\u201C${text}\u201D`,
    style: "quote",
    align: "left",
    valign: "middle",
    autoFit: "shrink",
    minHeight: compact ? 0.62 : 0.75,
    ...(quoteFontScale ? { fontScale: quoteFontScale } : {}),
  });
  if (hasSource) {
    children.push({ id: `${slideId}.${id}.source`, type: "text", text: `\u2014 ${source!.trim()}`, style: "quote-source", align: "left", minHeight: 0.32, autoFit: "shrink", optional: true });
  }
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.12,
    role: "quote",
    padding: quotePadding,
    minHeight: quoteMinHeight,
    children,
  } as DomNode, opts);
}

export function iconText(slideId: string, id: string, options: { icon: string; text: string; iconColor?: string; iconBackground?: string; tone?: string }): DomNode {
  const iconPreset = options.icon || "ellipse";
  const iconColor = options.iconColor || "brand.primary";
  const iconBackground = options.iconBackground || "brand.tint";
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "horizontal",
    gap: 0.4,
    role: "icon-text",
    align: "start",
    valign: "middle",
    children: [
      {
        id: `${slideId}.${id}.icon`,
        type: "shape",
        preset: iconPreset,
        fill: iconBackground,
        line: iconColor,
        fixedWidth: 1.15,
        fixedHeight: 1.15,
      },
      { id: `${slideId}.${id}.text`, type: "text", text: options.text, style: "card-title", align: "left", valign: "middle", color: options.tone || "text.primary" },
    ],
  };
}

/**
 * timeline — chronological event sequence. Each item is a (time-label
 * marker, optional sub-headline, optional content) tuple. Content can
 * be either:
 *   - simple text via `body` (back-compat with the original API)
 *   - any DomNode via `content` (a metric-card, image, insight-card,
 *     quote, stack of multiple blocks, etc.) — the renderer expands
 *     components recursively, so anything registered with the engine
 *     is fair game inside a timeline cell.
 *
 * Notes for horizontal layout: each cell is roughly (slideWidth - margins)
 * / itemCount cm wide — at 5 items that's ~4cm. Rich content (metric-card
 * with bold value, short callout) fits; long bullet lists / kpi-grids
 * do not. Use vertical timeline for content-heavy items.
 */
type TimelineTone = "brand" | "positive" | "warning" | "danger" | "neutral";
type TimelineItem = {
  time?: string;
  title?: string;
  body?: string;
  tone?: TimelineTone;
  content?: DomNode;
  shape?: string;
  icon?: string;
  iconSrc?: string;
};

export function timelineBlock(slideId: string, id: string, options: {
  items: TimelineItem[];
  direction?: "horizontal" | "vertical";
  gap?: number;
}): DomNode {
  const requested = options.direction === "horizontal" ? "horizontal" : "vertical";
  const items = options.items;
  const itemCount = items.length;
  const simpleItems = items.every((item) => !item.content);
  const richCount = items.filter((item) => item.content).length;
  const rowGap = typeof options.gap === "number" && Number.isFinite(options.gap)
    ? Math.max(0, Math.min(1.4, options.gap))
    : 0.52;

  // Capacity decision tree (was: cap horizontal columns at 5 with no
  // overflow path; produced 5+3 misaligned grids and aggressive autoFit
  // shrink). Now:
  //   • >6 simple items (regardless of requested direction) → 4-col grid
  //     timeline. Vertical was the old fallback, but 7-8 short events stack
  //     vertically use too much height; the grid gives 2 rows of compact cells.
  //   • horizontal + rich content + items > 5 → flip to vertical (each row
  //     gets full slide width, content can breathe).
  //   • horizontal + simple items 5-6 → preserve auto 5-col single row
  //     for tight horizontal flows, but allow 3-col 2-row when itemCount > 4
  //     and < 7 — bigger cells, no shrink-to-7.2pt label.
  //   • vertical → unchanged single-column rich timeline.
  if (simpleItems && itemCount > 6) {
    const columns = 4;
    const rows: DomNode[] = [];
    for (let start = 0; start < itemCount; start += columns) {
      const rowIndex = Math.floor(start / columns);
      const rowItems = items.slice(start, start + columns);
      rows.push(timelineHorizontalRow(slideId, id, rowItems, start, columns, `${slideId}.${id}.row${rowIndex}`));
    }
    return {
      id: `${slideId}.${id}`,
      type: "stack",
      direction: "vertical",
      gap: rowGap,
      role: "timeline",
      children: rows,
    };
  }
  if (requested === "horizontal" && richCount > 0 && itemCount > 5) {
    return {
      id: `${slideId}.${id}`,
      type: "stack",
      direction: "vertical",
      gap: 0.22,
      role: "timeline",
      children: items.map((item, index) => timelineStep(slideId, id, index, item, "vertical")),
    };
  }
  if (requested === "horizontal") {
    return timelineHorizontalRow(slideId, id, items, 0, Math.max(1, Math.min(6, itemCount)), `${slideId}.${id}`, "timeline");
  }
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.22,
    role: "timeline",
    children: items.map((item, index) => timelineStep(slideId, id, index, item, "vertical")),
  };
}

function timelineHorizontalRow(
  slideId: string,
  id: string,
  items: TimelineItem[],
  startIndex: number,
  columns: number,
  nodeId: string,
  role: string = "timeline-row",
): DomNode {
  const markerGridId = role === "timeline" ? `${slideId}.${id}.markers` : `${nodeId}.markers`;
  const textGridId = role === "timeline" ? `${slideId}.${id}.items` : `${nodeId}.items`;
  return {
    id: nodeId,
    type: "stack",
    direction: "vertical",
    gap: 0.02,
    role,
    children: [
      {
        id: markerGridId,
        type: "grid",
        columns,
        gap: 0,
        role: "timeline-marker-row",
        minHeight: 1.2,
        children: items.map((item, localIndex) => timelineHorizontalMarker(slideId, id, startIndex + localIndex, item)),
      },
      {
        id: textGridId,
        type: "grid",
        columns,
        gap: columns >= 5 ? 0.2 : 0.3,
        role: "timeline-item-row",
        children: items.map((item, localIndex) => timelineStep(slideId, id, startIndex + localIndex, item, "horizontal")),
      },
    ],
  };
}

function timelineHorizontalMarker(
  slideId: string,
  id: string,
  index: number,
  item: TimelineItem,
): DomNode {
  const toneToken = timelineToneToken(item.tone);
  const shapePreset = item.shape || "ellipse";
  const visualChildren: DomNode[] = [{
    id: `${slideId}.${id}.${index}.halo`,
    type: "shape",
    preset: shapePreset,
    fill: "surface",
    line: toneToken,
    lineWidth: 0.018,
    fixedWidth: 0.7,
    fixedHeight: 0.7,
    optional: true,
  }];
  const iconLayer = timelineIconLayer(slideId, id, index, item, toneToken, 0.44);
  if (iconLayer) visualChildren.push(iconLayer);
  return {
    id: `${slideId}.${id}.${index}.marker`,
    type: "stack",
    direction: "vertical",
    gap: 0.02,
    role: "timeline-marker",
    align: "center",
    valign: "bottom",
    children: [
      {
        id: `${slideId}.${id}.${index}.visual`,
        type: "stack",
        direction: "horizontal",
        gap: 0.08,
        justify: "center",
        align: "center",
        valign: "middle",
        fixedHeight: 0.72,
        children: visualChildren,
      },
      {
        id: `${slideId}.${id}.${index}.leader`,
        type: "shape",
        preset: "rect",
        fill: "divider",
        line: "divider",
        fixedWidth: 0.04,
        fixedHeight: 0.16,
        optional: true,
      },
      {
        id: `${slideId}.${id}.${index}.axis`,
        type: "stack",
        direction: "horizontal",
        gap: 0,
        role: "timeline-axis-node",
        valign: "middle",
        fixedHeight: 0.2,
        children: [
          {
            id: `${slideId}.${id}.${index}.railLeft`,
            type: "shape",
            preset: "rect",
            fill: "brand.primary",
            line: "brand.primary",
            fixedHeight: 0.04,
            layoutWeight: 1,
          },
          {
            id: `${slideId}.${id}.${index}.dot`,
            type: "shape",
            preset: "ellipse",
            fill: "surface",
            line: toneToken,
            lineWidth: 0.035,
            fixedWidth: 0.18,
            fixedHeight: 0.18,
            optional: true,
          },
          {
            id: `${slideId}.${id}.${index}.railRight`,
            type: "shape",
            preset: "rect",
            fill: "brand.primary",
            line: "brand.primary",
            fixedHeight: 0.04,
            layoutWeight: 1,
          },
        ],
      },
    ],
  };
}

function timelineToneToken(tone: TimelineTone | undefined): string {
  switch (tone) {
    case "positive": return "success";
    case "warning": return "warning";
    case "danger": return "danger";
    case "neutral": return "text.muted";
    default: return "brand.primary";
  }
}

function timelineIconLayer(
  slideId: string,
  id: string,
  index: number,
  item: TimelineItem,
  toneToken: string,
  size: number,
): DomNode | null {
  const iconSrc = item.iconSrc?.trim();
  const iconPreset = item.icon?.trim();
  if (!iconSrc && !iconPreset) return null;
  return {
    id: `${slideId}.${id}.${index}.iconLayer`,
    type: "stack",
    direction: "horizontal",
    justify: "center",
    align: "center",
    valign: "middle",
    layer: "above",
    children: [
      iconSrc
        ? {
            id: `${slideId}.${id}.${index}.icon`,
            type: "image",
            src: iconSrc,
            alt: item.title || item.time || "timeline icon",
            fit: "contain",
            fixedWidth: size,
            fixedHeight: size,
            optional: true,
          }
        : {
            id: `${slideId}.${id}.${index}.icon`,
            type: "shape",
            preset: iconPreset || "ellipse",
            fill: toneToken,
            line: toneToken,
            lineWidth: 0.018,
            fixedWidth: size * 0.73,
            fixedHeight: size * 0.73,
            optional: true,
          },
    ],
  };
}

function timelineStep(
  slideId: string,
  id: string,
  index: number,
  item: TimelineItem,
  direction: "horizontal" | "vertical",
): DomNode {
  // Timeline typography resolves through centralized component text tokens.
  // Theme authors can control the whole component by changing label/caption
  // or the derived timeline-* tokens, without component-local font defaults.
  const toneToken = timelineToneToken(item.tone);

  // Stamp the content's id under the step's namespace if missing (so
  // layout / diagnostics can identify it).
  const content: DomNode | null = item.content && typeof item.content === "object"
    ? {
        ...(item.content as DomNode),
        id: typeof item.content.id === "string" && item.content.id ? item.content.id : `${slideId}.${id}.${index}.content`,
      }
    : null;

  /* ---------------- horizontal timeline (narrow cells) ---------------- */
  // The parent horizontal row owns the continuous rail and milestone markers.
  // Each step only renders the copy below that rail, so the timeline reads as
  // one connected axis instead of a list of cards.
  if (direction === "horizontal") {
    const children: DomNode[] = [];
    if (item.time && item.time.trim()) {
      children.push({
        id: `${slideId}.${id}.${index}.time`,
        type: "text",
        text: item.time.trim(),
        style: "timeline-time",
        color: item.tone ? toneToken : undefined,
        align: "center",
        minHeight: 0.3,
        autoFit: "shrink",
        optional: true,
      });
    }
    if (item.title && item.title.trim()) {
      children.push({ id: `${slideId}.${id}.${index}.title`, type: "text", text: item.title.trim(), style: "timeline-title", color: "text.primary", align: "center", minHeight: 0.48, autoFit: "shrink" });
    }
    if (content) {
      children.push(content);
    } else if (item.body && item.body.trim()) {
      children.push({ id: `${slideId}.${id}.${index}.body`, type: "text", text: item.body.trim(), style: "timeline-body", align: "center", valign: "top", minHeight: estimateTimelineBodyMinHeight(item.body, "horizontal"), autoFit: "shrink", optional: true });
    }
    return {
      id: `${slideId}.${id}.${index}`,
      type: "stack",
      direction: "vertical",
      gap: 0.08,
      role: "timeline-step",
      children,
    };
  }

  /* ---------------- vertical timeline (rich rows) ---------------- */
  // Each step is a horizontal row: [time-on-left | content-on-right].
  // This is the canonical timeline visual — time labels align in a
  // narrow column, content fills the remaining width. Critically, this
  // gives `content` the FULL row height (instead of having time/title
  // stacked above eat into vertical space, which made 5+ rich items
  // FALLBACK_FAILED on 8cm content area).
  const rightColChildren: DomNode[] = [];
  if (item.title && item.title.trim()) {
    rightColChildren.push({ id: `${slideId}.${id}.${index}.title`, type: "text", text: item.title.trim(), style: "timeline-title", color: "text.primary", minHeight: 0.5, autoFit: "shrink" });
  }
  if (content) {
    rightColChildren.push(content);
  } else if (item.body && item.body.trim()) {
    rightColChildren.push({ id: `${slideId}.${id}.${index}.body`, type: "text", text: item.body.trim(), style: "timeline-body", valign: "top", minHeight: estimateTimelineBodyMinHeight(item.body, "vertical"), autoFit: "shrink", optional: true });
  }
  // Edge case: no title, no body, no content — emit a tiny placeholder
  // so the row still renders (rare; agent passed only `time`).
  if (rightColChildren.length === 0) {
    rightColChildren.push({ id: `${slideId}.${id}.${index}.placeholder`, type: "spacer", fixedHeight: 0.1 });
  }
  const rowChildren: DomNode[] = [];
  if (item.time && item.time.trim()) {
    rowChildren.push({
      id: `${slideId}.${id}.${index}.time`,
      type: "text",
      text: item.time.trim(),
      style: "timeline-time",
      align: "right",
      valign: "top",
      // Fixed width keeps time labels aligned across rows. 2.5cm fits
      // most date strings ("2024 Q3", "March 2024", "公元前 221 年").
      fixedWidth: 2.5,
      minHeight: 0.4,
      autoFit: "shrink",
    });
  }
  // Visual spine: a brand-colored vertical line running through the row
  // with a dot at the top marking the event. Each row contributes its
  // own segment; stacked rows form a continuous spine — no overlay
  // primitives needed. Without this, vertical timelines read as plain
  // tables of {time, title, body}. (96vi8n slide 7 regression.)
  const verticalIconLayer = timelineIconLayer(slideId, id, index, item, toneToken, 0.3);
  const verticalDot: DomNode = {
    id: `${slideId}.${id}.${index}.dot`,
    type: "shape",
    preset: "ellipse",
    fill: verticalIconLayer ? "surface" : toneToken,
    line: toneToken,
    fixedWidth: verticalIconLayer ? 0.36 : 0.24,
    fixedHeight: verticalIconLayer ? 0.36 : 0.24,
  };
  const verticalMarker: DomNode = verticalIconLayer
    ? {
        id: `${slideId}.${id}.${index}.marker`,
        type: "stack",
        direction: "horizontal",
        justify: "center",
        align: "center",
        valign: "middle",
        fixedWidth: 0.4,
        fixedHeight: 0.4,
        children: [verticalDot, verticalIconLayer],
      }
    : verticalDot;
  rowChildren.push({
    id: `${slideId}.${id}.${index}.spine`,
    type: "stack",
    direction: "vertical",
    gap: 0,
    role: "timeline-spine",
    align: "center",
    valign: "top",
    fixedWidth: 0.4,
    children: [
      verticalMarker,
      {
        id: `${slideId}.${id}.${index}.line`,
        type: "shape",
        preset: "rect",
        // Per-row spine segment tracks the row's tone for visual coherence —
        // a danger row's dot+line are both red, not red dot + blue line.
        fill: toneToken,
        line: toneToken,
        fixedWidth: 0.03,
        layoutWeight: 1,
      },
    ],
  });
  rowChildren.push({
    id: `${slideId}.${id}.${index}.col`,
    type: "stack",
    direction: "vertical",
    gap: 0.1,
    valign: "top",
    layoutWeight: 1,
    children: rightColChildren,
  });
  return {
    id: `${slideId}.${id}.${index}`,
    type: "stack",
    direction: "horizontal",
    gap: 0.35,
    role: "timeline-step",
    align: "start",
    valign: "top",
    children: rowChildren,
  };
}

function estimateTimelineBodyMinHeight(text: string, direction: "horizontal" | "vertical"): number {
  const explicitLines = text.split(/\n+/).filter((line) => line.trim()).length;
  const weighted = weightedTextLength(text);
  const charsPerLine = direction === "horizontal" ? 22 : 46;
  const estimatedLines = Math.max(explicitLines || 1, Math.ceil(weighted / charsPerLine));
  const lineHeight = direction === "horizontal" ? 0.29 : 0.34;
  return Math.max(direction === "horizontal" ? 0.46 : 0.42, Math.min(direction === "horizontal" ? 1.2 : 1.2, estimatedLines * lineHeight + 0.12));
}

export function profileCard(slideId: string, id: string, options: { image: string; name: string; role?: string; bio?: string }): DomNode {
  const children: DomNode[] = [
    { id: `${slideId}.${id}.photo`, type: "image", src: options.image, alt: options.name, clip: "circle", fit: "cover", fixedWidth: 2.8, fixedHeight: 2.8 },
    { id: `${slideId}.${id}.name`, type: "text", text: options.name, style: "card-title", align: "center", minHeight: 0.6, autoFit: "shrink" },
  ];
  if (options.role && options.role.trim()) {
    // umzrkm: profile role label was brand.primary — contrast risk on
    // mid-saturation brand themes. Use text.muted (already passes against
    // light surfaces) and let agents override via the role field if they
    // want a colored kicker.
    children.push({ id: `${slideId}.${id}.role`, type: "text", text: options.role.trim(), style: "label", color: "text.muted", align: "center", minHeight: 0.42, autoFit: "shrink", tracking: "wide" } as DomNode);
  }
  if (options.bio && options.bio.trim()) {
    children.push({ id: `${slideId}.${id}.bio`, type: "text", text: options.bio.trim(), style: "caption", align: "center", valign: "top", minHeight: 0.45, autoFit: "shrink" });
  }
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.25,
    role: "profile-card",
    align: "center",
    children,
  };
}

export function kpiGrid(slideId: string, id: string, metrics: Array<{
  name?: string;
  value: string;
  label: string;
  unit?: string;
  trend?: "up" | "down" | "flat";
  delta?: string;
  status?: "positive" | "warning" | "danger" | "neutral" | "brand";
  source?: string;
  comparison?: string;
  sparkline?: Array<number | string>;
}>, columns?: number, options: { variant?: "plain" | "card" | "compact"; density?: "comfortable" | "compact" } & { surface?: AgentSurface } & AgentSurface = {}): DomNode {
  const cols = Math.max(1, columns || Math.min(4, metrics.length));
  const dense = options.density === "compact" || options.variant === "compact" || metrics.length >= 5;
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "grid",
    columns: cols,
    gap: dense ? 0.32 : 0.5,
    role: "kpi-grid",
    children: metrics.map((m, index) => metricCard(slideId, `${id}-m${index + 1}`, m.value, m.label, { unit: m.unit, trend: m.trend, delta: m.delta, status: m.status, source: m.source, comparison: m.comparison, sparkline: m.sparkline, variant: options.variant === "card" ? "card" : dense ? "compact" : "plain", density: dense ? "compact" : "comfortable", peerAligned: true })),
  } as DomNode, options);
}

export function sectionBreak(
  slideId: string,
  id: string,
  options: { title: string; subtitle?: string; accent?: string; tone?: "brand" | "neutral" | "inverse" },
): DomNode {
  const children: DomNode[] = [];
  // Resolve the rule + eyebrow colors from `tone`. Default = "brand".
  const tone = options.tone || "brand";
  const ruleColor = tone === "neutral" ? "divider" : tone === "inverse" ? "text.inverse" : "brand.primary";
  // Always emit a brand-color accent rule above the title so section
  // dividers feel like a real visual break, not just centered text. The
  // rule sits above the eyebrow accent string when both are present.
  children.push({
    id: `${slideId}.${id}.rule`,
    type: "shape",
    preset: "rect",
    fill: ruleColor,
    line: ruleColor,
    fixedHeight: 0.08,
    fixedWidth: 4.0,
    align: "start",
  });
  // Defensive: agents commonly mistype the `accent` field as a tone token
  // (e.g. `accent:"brand"`, `"primary"`, `"neutral"`) thinking it sets a
  // color. The renderer treats the field as a kicker label string, so the
  // word "brand" would otherwise appear as the eyebrow. (96vi8n log: 5
  // section-break slides each rendered the literal text "brand".)
  // Drop tone-keyword values silently — the agent meant a color, not a
  // string, and there's no useful eyebrow they intended.
  const accentText = (options.accent || "").trim();
  const isToneKeyword = /^(brand|primary|secondary|tertiary|neutral|positive|negative|warning|danger|caution|success|error|muted|subtle|info|inverse|tone|color)$/i.test(accentText);
  if (accentText && !isToneKeyword) {
    // The eyebrow stays brand-colored: it sits ABOVE the bold rule shape
    // which already establishes the brand-color claim. The eyebrow label
    // is short (a kicker word) so it can carry color without legibility
    // risk — but we still pick text.primary as the safer fallback when
    // the agent's brand color is muted. Agents who want a vivid eyebrow
    // can pass `color:` on the sectionBreak — but the surface here keeps
    // the safer default.
    children.push({ id: `${slideId}.${id}.accent`, type: "text", text: accentText, style: "label", color: "text.primary", align: "left", minHeight: 0.42, autoFit: "shrink", tracking: "wide" } as DomNode);
  }
  children.push({ id: `${slideId}.${id}.title`, type: "text", text: options.title, style: "deck-title", align: "left", color: "text.primary" });
  if (options.subtitle && options.subtitle.trim()) {
    children.push({ id: `${slideId}.${id}.subtitle`, type: "text", text: options.subtitle.trim(), style: "lead", align: "left", color: "text.muted" });
  }
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.32,
    role: "section-break",
    area: "content",
    // valign+justify both centered: section-break content was previously
    // top-aligned at y=3 leaving 5.5cm empty at the bottom (96vi8n slides
    // 4/9/13/17/21). justify:"center" centers the stack in the content
    // rect along its own main axis, valign:"middle" was effectively
    // unused for vertical stacks and stays for cross-axis alignment.
    justify: "center",
    valign: "middle",
    align: "start",
    children,
  };
}

export function swotMatrix(slideId: string, id: string, options: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] }): DomNode {
  const quadrant = (qid: string, title: string, points: string[], color: string) => ({
    id: `${slideId}.${id}.${qid}`,
    type: "stack" as const,
    direction: "vertical" as const,
    gap: 0.12,
    role: "swot-quadrant",
    children: [
      { id: `${slideId}.${id}.${qid}.title`, type: "text" as const, text: title, style: "card-title", color, minHeight: 0.46, autoFit: "shrink" as const },
      { ...bulletList(slideId, `${id}-${qid}`, points, "compact"), spaceAfter: 1 },
    ],
  });
  return {
    id: `${slideId}.${id}`,
    type: "grid",
    columns: 2,
    gap: 0.5,
    role: "swot-matrix",
    children: [
      quadrant("strengths", "Strengths", options.strengths, "success"),
      quadrant("weaknesses", "Weaknesses", options.weaknesses, "warning"),
      quadrant("opportunities", "Opportunities", options.opportunities, "brand.primary"),
      quadrant("threats", "Threats", options.threats, "danger"),
    ],
  };
}

export function ctaButton(slideId: string, id: string, options: { text: string; tone?: "brand" | "neutral" | "positive" | "warning" | "danger"; link?: string }): DomNode {
  const tone = options.tone || "brand";
  const fill = tone === "neutral" ? "surface" : tone === "brand" ? "brand.primary" : tone;
  const fg = tone === "neutral" ? "text.primary" : "text.inverse";
  const content = options.link
    ? [{ text: options.text, link: options.link }]
    : undefined;
  return {
    id: `${slideId}.${id}`,
    type: "text",
    text: options.text,
    style: "card-title",
    align: "center",
    valign: "middle",
    fill,
    color: fg,
    cornerRadius: 0.3,
    fixedHeight: 1.15,
    autoFit: "shrink",
    role: "cta",
    ...(content ? { content } : {}),
  };
}

export function featureCard(slideId: string, id: string, options: {
  icon?: string;
  iconSrc?: string;
  decoration?: FeatureCardDecoration;
  title: string;
  body?: string;
  content?: unknown;
  marker?: DecorationMarkerInput;
  iconColor?: string;
  iconBackground?: string;
  tone?: string;
  titleColor?: string;
  badge?: string;
  tags?: string[];
  metric?: { value: string; label: string; tone?: "brand" | "positive" | "warning" | "danger" | "neutral" };
  proof?: string;
  ctaText?: string;
  variant?: "plain" | "card" | "compact";
  density?: "comfortable" | "compact";
  layout?: FeatureCardLayout;
} & { surface?: AgentSurface } & AgentSurface): DomNode {
  const dense = options.density === "compact" || options.variant === "compact";
  const layout: FeatureCardLayout = options.layout === "horizontal" || (options.layout !== "vertical" && dense) ? "horizontal" : "vertical";
  const semanticTone = featureSemanticTone(options.tone);
  const iconColor = options.iconColor || featureAccentColor(semanticTone);
  const iconBackground = options.iconBackground || featureTintColor(semanticTone);
  const explicitTitleMarker = options.decoration?.kind === "marker" && layout === "vertical"
    ? featureMarkerInput(options.decoration.marker || options.decoration.shape || "rounded-square")
    : undefined;
  const titleMarkerBase = decorationMarkerNode(slideId, `${id}.marker`, options.marker || explicitTitleMarker, {
    shape: "rounded-square",
    tone: options.decoration?.tone || markerToneFromFeatureTone(semanticTone),
    variant: options.decoration?.variant || "tint",
    size: options.decoration?.size || (dense ? "xs" : "sm"),
  });
  const titleMarker = titleMarkerBase
    ? { ...titleMarkerBase, optional: false, __featureCardSemanticChild: true }
    : undefined;
  const decorationNode = featureCardDecorationNode(slideId, id, options, {
    layout,
    dense,
    semanticTone,
    iconColor,
    iconBackground,
    hasLegacyTitleMarker: !!titleMarker,
  });
  const titleNode: DomNode = { id: `${slideId}.${id}.title`, type: "text", text: options.title, style: "card-title", align: "left", color: options.titleColor || featureTitleColor(options.tone), minHeight: dense ? 0.42 : 0.5, autoFit: "shrink", layoutWeight: titleMarker ? 1 : undefined };
  const titleRow: DomNode = titleMarker
    ? {
        id: `${slideId}.${id}.titleRow`,
        type: "stack",
        direction: "horizontal",
        gap: dense ? 0.14 : 0.18,
        valign: "middle",
        children: [titleMarker, titleNode],
      }
    : titleNode;
  const leadingChildren: DomNode[] = [];
  if (options.badge) {
    leadingChildren.push({ id: `${slideId}.${id}.badge`, type: "text", text: options.badge, style: "label", color: "text.primary", fill: "surface.subtle", cornerRadius: 0.18, fixedHeight: 0.42, fixedWidth: textChipWidthCm(options.badge, { min: 1.0, max: 4.8, padding: 0.62 }), align: "center", autoFit: "shrink", noWrap: true });
  }
  const textChildren: DomNode[] = [
    ...leadingChildren,
    titleRow,
  ];
  const body = textWithRichContent(options.body?.trim() || "", options.content);
  if (body.text || body.content) {
    textChildren.push({
      id: `${slideId}.${id}.body`,
      type: "text",
      ...body,
      style: "caption",
      align: "left",
      valign: "top",
      minHeight: estimateFeatureBodyMinHeight(body.text, dense),
      autoFit: "shrink",
      __featureCardSemanticChild: true,
    });
  }
  if (options.metric) {
    textChildren.push({ ...featureMetricNode(slideId, id, options.metric, dense), optional: true });
  }
  if (options.proof) {
    textChildren.push({ id: `${slideId}.${id}.proof`, type: "text", text: options.proof, style: "label", color: "text.muted", minHeight: 0.34, autoFit: "shrink", optional: true });
  }
  if (options.tags && options.tags.length) {
    textChildren.push({ id: `${slideId}.${id}.tags`, type: "stack", direction: "horizontal", gap: 0.12, optional: true, children: options.tags.slice(0, 4).map((tag, index) => ({ id: `${slideId}.${id}.tag${index}`, type: "text" as const, text: String(tag), style: "label" as const, fill: "surface.subtle", color: "text.muted", cornerRadius: 0.16, fixedHeight: 0.42, autoFit: "shrink" as const, layoutWeight: 1 })) });
  }
  if (options.ctaText) {
    textChildren.push({ id: `${slideId}.${id}.cta`, type: "text", text: options.ctaText, style: "label", color: "text.inverse", fill: "brand.primary", cornerRadius: 0.2, align: "center", valign: "middle", fixedHeight: 0.46, autoFit: "shrink", optional: true });
  }
  const children: DomNode[] = layout === "horizontal" && decorationNode
    ? [
        decorationNode,
        {
          id: `${slideId}.${id}.content`,
          type: "stack",
          direction: "vertical",
          gap: dense ? 0.09 : 0.14,
          layoutWeight: 1,
          valign: "top",
          children: textChildren,
        },
      ]
    : [
        ...(decorationNode ? [decorationNode] : []),
        ...textChildren,
      ];
  const defaultSurface = featureCardDefaultSurface(options, dense);
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction: layout,
    gap: layout === "horizontal" ? (dense ? 0.28 : 0.36) : (dense ? 0.1 : 0.16),
    role: "feature-card",
    valign: "top",
    ...defaultSurface,
    children,
  } as DomNode, options);
}

function featureCardDefaultSurface(options: { variant?: "plain" | "card" | "compact"; surface?: AgentSurface } & AgentSurface, dense: boolean): Partial<DomNode> {
  const hasSurface = !!options.surface
    || typeof options.fill === "string"
    || typeof options.line === "string"
    || options.border !== undefined
    || typeof options.borderColor === "string"
    || typeof options.elevation === "string"
    || options.shadow !== undefined
    || options.gradient !== undefined;
  if (options.variant === "card") {
    return { fill: "surface", line: "divider", padding: dense ? 0.32 : 0.42, cornerRadius: 0.1 };
  }
  if (options.variant === "compact" || hasSurface) {
    return { padding: dense ? 0.28 : 0.36, cornerRadius: 0.08 };
  }
  return {};
}

function featureCardDecorationNode(
  slideId: string,
  id: string,
  options: {
    icon?: string;
    iconSrc?: string;
    decoration?: FeatureCardDecoration;
    marker?: DecorationMarkerInput;
  },
  ctx: {
    layout: FeatureCardLayout;
    dense: boolean;
    semanticTone: DecorationMarkerTone;
    iconColor: string;
    iconBackground: string;
    hasLegacyTitleMarker: boolean;
  },
): DomNode | undefined {
  const spec = options.decoration;
  const explicitKind = spec?.kind;
  if (explicitKind === "none") return undefined;
  const tone = spec?.tone || markerToneFromFeatureTone(ctx.semanticTone);
  const size = featureDecorationSizeCm(spec?.size, ctx.dense, ctx.layout);
  if (explicitKind === "marker") {
    if (ctx.layout === "vertical") return undefined;
    const markerNode = decorationMarkerNode(slideId, `${id}.decoration`, featureMarkerInput(spec?.marker || spec?.shape || "rounded-square"), {
      shape: "rounded-square",
      tone,
      variant: spec?.variant || "tint",
      size: spec?.size || (ctx.dense ? "sm" : "md"),
      valign: "top",
    });
    return markerNode ? { ...markerNode, optional: false, __featureCardSemanticChild: true } : undefined;
  }
  const src = spec?.src || spec?.iconSrc || options.iconSrc;
  if (explicitKind === "image" || src) {
    if (!src) return undefined;
    return {
      id: `${slideId}.${id}.icon`,
      type: "image",
      src,
      fit: "contain",
      fixedWidth: size,
      fixedHeight: size,
      align: "start",
      valign: "top",
      optional: true,
    };
  }
  if (ctx.hasLegacyTitleMarker && !spec) return undefined;
  const shape = spec?.shape || spec?.icon || options.icon || "ellipse";
  if (shape === "none") return undefined;
  return {
    id: `${slideId}.${id}.icon`,
    type: "shape",
    preset: shape,
    fill: spec?.background || ctx.iconBackground,
    line: spec?.color || ctx.iconColor,
    lineWidth: 0.04,
    fixedWidth: size,
    fixedHeight: size,
    align: "start",
    valign: "top",
    optional: true,
  };
}

function featureMarkerInput(value: DecorationMarkerInput | string | undefined): DecorationMarkerInput | undefined {
  return value as DecorationMarkerInput | undefined;
}

function featureDecorationSizeCm(size: DecorationMarkerSize | undefined, dense: boolean, layout: FeatureCardLayout): number {
  if (typeof size === "number" && Number.isFinite(size) && size > 0) return Math.max(0.24, Math.min(1.6, size));
  if (size === "xs") return 0.52;
  if (size === "sm") return 0.68;
  if (size === "lg") return 1.12;
  if (size === "xl") return 1.36;
  if (size === "md") return 0.9;
  if (layout === "horizontal") return dense ? 0.76 : 0.94;
  return dense ? 0.82 : 1.02;
}

function featureSemanticTone(tone: unknown): DecorationMarkerTone {
  if (tone === "positive" || tone === "success" || tone === "good") return "positive";
  if (tone === "warning" || tone === "caution" || tone === "warn") return "warning";
  if (tone === "danger" || tone === "error" || tone === "bad" || tone === "negative") return "danger";
  if (tone === "neutral" || tone === "muted" || tone === "flat") return "neutral";
  return "brand";
}

function markerToneFromFeatureTone(tone: DecorationMarkerTone): DecorationMarkerTone {
  return tone === "muted" ? "neutral" : tone;
}

function featureTitleColor(tone: unknown): string {
  if (tone === undefined || tone === null || tone === "") return "text.primary";
  if (tone === "brand") return "brand.primary";
  if (tone === "positive" || tone === "success" || tone === "good") return "success.accent";
  if (tone === "warning" || tone === "caution" || tone === "warn") return "warning.accent";
  if (tone === "danger" || tone === "error" || tone === "bad" || tone === "negative") return "danger.accent";
  if (tone === "neutral") return "text.primary";
  if (tone === "muted" || tone === "flat") return "text.muted";
  return String(tone);
}

function featureAccentColor(tone: unknown): string {
  if (tone === "brand") return "brand.primary";
  if (tone === "positive" || tone === "success" || tone === "good") return "success";
  if (tone === "warning" || tone === "caution" || tone === "warn") return "warning";
  if (tone === "danger" || tone === "error" || tone === "bad" || tone === "negative") return "danger";
  if (tone === "neutral") return "text.primary";
  if (tone === "muted" || tone === "flat") return "text.muted";
  return typeof tone === "string" && tone.trim() ? tone : "brand.primary";
}

function featureTintColor(tone: unknown): string {
  if (tone === "positive" || tone === "success" || tone === "good") return "success.tint";
  if (tone === "warning" || tone === "caution" || tone === "warn") return "warning.tint";
  if (tone === "danger" || tone === "error" || tone === "bad" || tone === "negative") return "danger.tint";
  if (tone === "neutral" || tone === "muted" || tone === "flat") return "surface.subtle";
  return "brand.tint";
}

function estimateFeatureBodyMinHeight(text: string, dense: boolean): number {
  const explicitLines = text.split(/\n+/).filter((line) => line.trim()).length;
  const estimatedLines = Math.max(explicitLines || 1, Math.ceil(weightedTextLength(text) / (dense ? 24 : 20)));
  return Math.max(dense ? 0.42 : 0.5, Math.min(dense ? 0.85 : 1.1, estimatedLines * (dense ? 0.34 : 0.4) + 0.14));
}

function featureMetricNode(
  slideId: string,
  id: string,
  metric: { value: string; label: string; tone?: "brand" | "positive" | "warning" | "danger" | "neutral" },
  dense: boolean,
): DomNode {
  if (isConciseNumericMetric(metric.value)) {
    return metricCard(slideId, `${id}.metric`, metric.value, metric.label, { variant: "compact", status: metric.tone });
  }
  const tone = featureAccentColor(metric.tone || "brand");
  const ratingLike = isRatingLikeMetric(metric.value);
  const valueLines = Math.max(1, Math.ceil(weightedTextLength(metric.value) / (dense ? 22 : 26)));
  return {
    id: `${slideId}.${id}.metric`,
    type: "stack",
    direction: "vertical",
    gap: 0.06,
    fill: "surface.subtle",
    line: "divider",
    padding: dense ? 0.14 : 0.18,
    cornerRadius: 0.08,
    children: [
      {
        id: `${slideId}.${id}.metric.value`,
        type: "text",
        text: metric.value,
        style: dense || ratingLike ? "label" : "card-title",
        color: tone,
        minHeight: Math.max(dense ? 0.32 : 0.42, Math.min(dense ? 0.78 : 0.95, valueLines * (dense ? 0.28 : 0.34) + 0.1)),
        autoFit: "shrink",
      },
      ...(metric.label ? [{
        id: `${slideId}.${id}.metric.label`,
        type: "text" as const,
        text: metric.label,
        style: "caption" as const,
        color: "text.muted",
        minHeight: dense ? 0.28 : 0.32,
        autoFit: "shrink" as const,
      }] : []),
    ],
  };
}

function isConciseNumericMetric(value: string): boolean {
  const text = value.trim();
  if (!text || isRatingLikeMetric(text)) return false;
  if (text.length > 14) return false;
  if (!/[0-9]/.test(text)) return false;
  return /^[+\-~≈¥$€£]?\s*\d[\d,.]*(?:\s*[-–]\s*\d[\d,.]*)?(?:\s*(?:%|x|X|k|K|m|M|b|B|万|亿|千|百|倍|人|家|项|年|月|天|小时|ms|s|秒|pt|pts))?\+?$/.test(text);
}

function isRatingLikeMetric(value: string): boolean {
  return /[\u2605\u2606]/.test(value);
}

export function checklist(slideId: string, id: string, items: Array<{ text: string; status?: "checked" | "unchecked" | "warning" }>, density: "comfortable" | "compact" = "comfortable", opts: { markStyle?: "chip" | "plain" } = {}): DomNode {
  const compact = density === "compact";
  // Chip-style marks (default): small rounded square with the tone color
  // as fill and white glyph on top — much louder than a bare colored
  // glyph, especially against a tinted card. `markStyle:"plain"` falls
  // back to the previous text-only rendering for tight contexts where
  // every cm matters.
  const chipStyle = opts.markStyle !== "plain";
  const markSize = compact ? 0.55 : 0.7;
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: compact ? 0.1 : 0.18,
    role: "checklist",
    children: items.map((item, index) => {
      const status = item.status === "warning" ? "warning" : item.status === "unchecked" ? "unchecked" : "checked";
      const mark = status === "checked" ? "✓" : status === "warning" ? "!" : "✗";
      const markColor = status === "checked" ? "success" : status === "warning" ? "warning" : "danger";
      const markNode: DomNode = chipStyle
        ? {
            id: `${slideId}.${id}.${index}.mark`,
            type: "text",
            text: mark,
            style: compact ? "label" : "card-title",
            color: "text.inverse",
            fill: markColor,
            align: "center",
            valign: "middle",
            fixedWidth: markSize,
            fixedHeight: markSize,
            cornerRadius: 0.18,
            weight: "bold",
          }
        : {
            id: `${slideId}.${id}.${index}.mark`,
            type: "text",
            text: mark,
            style: compact ? "label" : "card-title",
            color: markColor,
            align: "center",
            valign: "middle",
            fixedWidth: compact ? 0.5 : 0.7,
            weight: "bold",
          };
      return {
        id: `${slideId}.${id}.${index}`,
        type: "stack",
        direction: "horizontal",
        gap: 0.3,
        role: "checklist-item",
        align: "start",
        valign: "middle",
        fixedHeight: compact ? 0.6 : undefined,
        children: [
          markNode,
          { id: `${slideId}.${id}.${index}.text`, type: "text", text: item.text, style: compact ? "caption" : "paragraph", align: "left", valign: "middle", layoutWeight: 1, autoFit: compact ? "shrink" : undefined },
        ],
      };
    }),
  };
}

export function progressBar(slideId: string, id: string, options: { label: string; value: number; max?: number; valueLabel?: string; tone?: "brand" | "positive" | "warning" | "danger" }): DomNode {
  const max = options.max && options.max > 0 ? options.max : 100;
  const ratio = Math.max(0, Math.min(1, options.value / max));
  const tone = options.tone || "brand";
  const fillToken = tone === "brand" ? "brand.primary" : tone === "positive" ? "success" : tone === "warning" ? "warning" : "danger";
  const trackToken = "surface.subtle";
  const valueLabel = options.valueLabel || `${Math.round(ratio * 100)}%`;
  // Same continuous-track + safe value color treatment as bar-list
  // (96vi8n consolidation): single rounded backing + single rounded
  // fill (no seam); value uses text.primary so LOW_CONTRAST auto-fix
  // doesn't rewrite a tone-colored value to a sibling accent and
  // disconnect the number from its bar.
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.18,
    role: "progress-bar",
    children: [
      {
        id: `${slideId}.${id}.header`,
        type: "stack",
        direction: "horizontal",
        gap: 0.3,
        children: [
          { id: `${slideId}.${id}.label`, type: "text", text: options.label, style: "label", align: "left", layoutWeight: 5, minHeight: 0.32, autoFit: "shrink" },
          { id: `${slideId}.${id}.value`, type: "text", text: valueLabel, style: "label", color: "text.primary", align: "right", layoutWeight: 1, bold: true, minHeight: 0.32, autoFit: "shrink" },
        ],
        fixedHeight: 0.5,
      },
      {
        id: `${slideId}.${id}.track`,
        type: "stack",
        direction: "horizontal",
        gap: 0,
        fixedHeight: 0.4,
        fill: trackToken,
        cornerRadius: 0.5,
        padding: 0,
        children: [
          { id: `${slideId}.${id}.fill`, type: "shape", preset: "roundRect", fill: fillToken, cornerRadius: 0.5, layoutWeight: Math.max(0.001, ratio) },
          { id: `${slideId}.${id}.spacer`, type: "spacer", layoutWeight: Math.max(0.001, 1 - ratio) },
        ],
      },
    ],
  };
}

export function prosCons(slideId: string, id: string, options: { pros: string[]; cons: string[]; prosTitle?: string; consTitle?: string }): DomNode {
  return {
    id: `${slideId}.${id}`,
    type: "grid",
    columns: 2,
    gap: 0.5,
    role: "pros-cons",
    children: [
      {
        id: `${slideId}.${id}.pros`,
        type: "stack",
        direction: "vertical",
        gap: 0.25,
        role: "pros-column",
        children: [
          { id: `${slideId}.${id}.pros.title`, type: "text", text: options.prosTitle || "Pros", style: "card-title", color: "success", minHeight: 0.55, autoFit: "shrink" },
          checklist(slideId, `${id}-pros`, options.pros.map((text) => ({ text, status: "checked" }))),
        ],
      },
      {
        id: `${slideId}.${id}.cons`,
        type: "stack",
        direction: "vertical",
        gap: 0.25,
        role: "cons-column",
        children: [
          { id: `${slideId}.${id}.cons.title`, type: "text", text: options.consTitle || "Cons", style: "card-title", color: "danger", minHeight: 0.55, autoFit: "shrink" },
          checklist(slideId, `${id}-cons`, options.cons.map((text) => ({ text, status: "unchecked" }))),
        ],
      },
    ],
  };
}

export function processFlow(slideId: string, id: string, options: {
  steps: Array<{
    title: string;
    body?: string;
    status?: string;
    owner?: string;
    time?: string;
    icon?: string;
    iconSrc?: string;
    bullets?: string[];
    step?: string;
    number?: string;
    marker?: "auto" | "number" | "dot" | "icon" | "none";
    accentColor?: string;
  }>;
  direction?: "horizontal" | "vertical";
  variant?: "plain" | "cards";
  density?: "comfortable" | "compact";
  marker?: "auto" | "number" | "dot" | "icon" | "none";
  showNumbers?: boolean;
  connector?: "arrow" | "chevron" | "line" | "none";
  connectorDash?: "solid" | "dash" | "dot";
  connectorColor?: string;
  placement?: "center" | "top";
  spread?: "compact" | "balanced" | "fill";
  stepAccent?: "none" | "top";
  stepSurface?: AgentSurface;
} & { surface?: AgentSurface } & AgentSurface): DomNode {
  // direction "auto" or undefined defers to layout: a hint we read at
  // measure time and flip to vertical when the flow is squeezed into a
  // narrow column.
  const direction = options.direction === "vertical" ? "vertical" : "horizontal";
  const arrow = direction === "horizontal" ? "arrow-right" : "arrow-down";
  const compact = options.density === "compact";
  const dense = compact || options.steps.length >= 5;
  const cardVariant = options.variant === "cards";
  const markerMode = options.marker === "number" || options.marker === "dot" || options.marker === "icon" || options.marker === "none" ? options.marker : "auto";
  const connectorMode = options.connector === "chevron" || options.connector === "line" || options.connector === "none" ? options.connector : "arrow";
  const connectorDash = options.connectorDash === "dash" || options.connectorDash === "dot" ? options.connectorDash : undefined;
  const connectorColor = typeof options.connectorColor === "string" && options.connectorColor.trim() ? options.connectorColor.trim() : "brand.primary";
  const placement = options.placement === "center" || options.placement === "top" ? options.placement : cardVariant ? "top" : "center";
  const spread = options.spread === "fill" || options.spread === "compact" || options.spread === "balanced"
    ? options.spread
    : cardVariant ? "balanced" : "compact";
  const stepAccent = options.stepAccent === "none" ? "none" : "top";
  const items: DomNode[] = [];
  // Vertical process-flow stacks step + arrow + step + arrow ... in one column
  // and competes with the slide's slide-title placeholder for the ~10cm content
  // area. Density adapts to step count so 4-6 vertical steps fit without
  // FALLBACK_FAILED on a default deck.
  const verticalDense = direction === "vertical" && (compact || options.steps.length >= 4);
  let horizontalBandMaxHeight = 0;
  let horizontalBandMinHeight = 0;
  let hasRichHorizontalCard = false;
  options.steps.forEach((step, index) => {
    const statusColor = toneColor(step.status, "text.primary");
    const iconFill = statusColor === "text.primary" ? "surface.subtle" : statusColor;
    const accentColor = typeof step.accentColor === "string" && step.accentColor.trim()
      ? step.accentColor.trim()
      : statusColor === "text.primary"
        ? "brand.primary"
        : statusColor === "text.muted"
          ? "divider"
          : statusColor;
    const richHorizontalCard = direction === "horizontal" && cardVariant && (
      Boolean(step.bullets && step.bullets.length) ||
      Boolean(step.owner || step.time) ||
      Boolean(step.body && (step.body.length > 28 || step.body.includes("\n")))
    );
    if (richHorizontalCard) hasRichHorizontalCard = true;
    const stepAlign = cardVariant ? "start" : "center";
    const textAlign = cardVariant ? "left" : "center";
    // Horizontal flow uses a maxHeight cap so the step card sizes to its
    // content (typical 1.7–2.5cm) instead of stretching to the parent row's
    // ~10cm cross axis. Without the cap, fill:"surface" painted a 10cm
    // grey card with title/body squeezed into 1.6cm of intrinsic content
    // centered in the middle, and the body's fixedHeight + autoFit:shrink
    // pushed body text down to ~8pt. Vertical flow keeps minHeight (it
    // grows with content vertically and competes with adjacent rows).
    const horizontalMaxHeight = richHorizontalCard
      ? (spread === "fill" ? 5.6 : spread === "balanced" ? 4.9 : 4.45)
      : cardVariant
        ? spread === "fill"
          ? (dense ? 4.2 : 4.6)
          : spread === "balanced"
            ? (dense ? 3.65 : 3.9)
            : (dense ? 3.2 : 3.5)
        : (dense ? 2.5 : 3.1);
    const horizontalMinHeight = richHorizontalCard
      ? (spread === "fill" ? 3.85 : spread === "balanced" ? 3.65 : 3.25)
      : cardVariant
        ? spread === "fill"
          ? (dense ? 2.85 : 3.15)
          : spread === "balanced"
            ? (dense ? 2.45 : 2.75)
            : (dense ? 2.25 : 2.55)
        : undefined;
    const verticalMinHeight = verticalDense ? 1.0 : 1.4;
    if (direction === "horizontal") {
      horizontalBandMaxHeight = Math.max(horizontalBandMaxHeight, horizontalMaxHeight);
      horizontalBandMinHeight = Math.max(horizontalBandMinHeight, horizontalMinHeight || 0);
    }
    const rawMarker = step.marker === "number" || step.marker === "dot" || step.marker === "icon" || step.marker === "none" ? step.marker : markerMode;
    const resolvedMarker = (() => {
      if (rawMarker !== "auto") return rawMarker;
      if (options.showNumbers === false) return step.icon || step.iconSrc ? "icon" : "none";
      if (step.icon || step.iconSrc) return "icon";
      if (options.showNumbers === true || cardVariant) return "number";
      return "none";
    })();
    const markerNode: DomNode | undefined = (() => {
      if (resolvedMarker === "none") return undefined;
      if (resolvedMarker === "icon" && step.iconSrc && step.iconSrc.trim()) {
        return {
          id: `${slideId}.${id}.step${index + 1}.icon`,
          type: "image",
          src: step.iconSrc.trim(),
          alt: step.title,
          fit: "contain",
          fixedWidth: cardVariant ? 0.64 : 0.48,
          fixedHeight: cardVariant ? 0.64 : 0.48,
          align: stepAlign,
          optional: true,
        };
      }
      if (resolvedMarker === "icon" && step.icon) {
        return {
          id: `${slideId}.${id}.step${index + 1}.icon`,
          type: "shape",
          preset: step.icon,
          fill: iconFill,
          line: statusColor,
          fixedWidth: cardVariant ? 0.58 : 0.46,
          fixedHeight: cardVariant ? 0.58 : 0.46,
          align: stepAlign as "start" | "center",
          optional: true,
        };
      }
      if (resolvedMarker === "dot") {
        return {
          id: `${slideId}.${id}.step${index + 1}.marker`,
          type: "shape",
          preset: "ellipse",
          fill: accentColor,
          line: accentColor,
          fixedWidth: cardVariant ? 0.34 : 0.28,
          fixedHeight: cardVariant ? 0.34 : 0.28,
          align: stepAlign as "start" | "center",
          optional: true,
        };
      }
      const label = (step.number || step.step || String(index + 1).padStart(options.steps.length >= 10 ? 2 : 2, "0")).trim();
      return {
        id: `${slideId}.${id}.step${index + 1}.number`,
        type: "text",
        text: label,
        style: "label",
        color: statusColor === "text.muted" ? "text.primary" : statusColor,
        align: "center",
        valign: "middle",
        fill: "surface.subtle",
        line: accentColor,
        fixedWidth: dense || verticalDense ? 0.68 : 0.78,
        fixedHeight: dense || verticalDense ? 0.42 : 0.5,
        noWrap: true,
        autoFit: "shrink",
        cornerRadius: 0.16,
        optional: true,
      };
    })();
    const stepNode: DomNode = {
      id: `${slideId}.${id}.step${index + 1}`,
      type: "stack",
      direction: "vertical",
      gap: dense || verticalDense ? 0.08 : 0.18,
      role: "process-step",
      // For a vertical stack the cross axis is horizontal; align="center"
      // centers the title/body horizontally inside the step. justify="center"
      // centers the WHOLE step content vertically inside its assigned slot —
      // without it, steps top-align in the slide content rect (~10cm) while
      // the arrows are vertically centered, creating disconnected layouts
      // (t25mft tang slide: steps at y=2.95, arrows at y=7.87).
      align: stepAlign,
      valign: "middle",
      justify: cardVariant ? "start" : "center",
      ...(direction === "horizontal" ? { maxHeight: horizontalMaxHeight, ...(horizontalMinHeight ? { minHeight: horizontalMinHeight } : {}) } : { minHeight: verticalMinHeight }),
      children: [
        ...(cardVariant && stepAccent !== "none" && !richHorizontalCard ? [{
          id: `${slideId}.${id}.step${index + 1}.accent`,
          type: "shape" as const,
          preset: "rect",
          fill: accentColor,
          line: accentColor,
          fixedHeight: dense || verticalDense ? 0.055 : 0.07,
          optional: true,
        }] : []),
        // umzrkm fix: step.title used brand.primary which fails 4.5:1 on
        // agent themes with mid-saturation brand colors (teal 5B8A8A on
        // E8F3F3 ≈ 3.4:1). Mirror the 2pmnxh fix that already moved
        // timeline-step to text.primary. The arrow shape between steps
        // still carries brand.primary so the visual claim is preserved.
        ...(markerNode ? [markerNode] : []),
        { id: `${slideId}.${id}.step${index + 1}.title`, type: "text", text: step.title, style: "card-title", color: statusColor, align: textAlign, minHeight: dense || verticalDense ? 0.42 : 0.6, autoFit: "shrink" },
        ...((step.owner || step.time) ? [{
          id: `${slideId}.${id}.step${index + 1}.meta`,
          type: "text" as const,
          text: [step.owner, step.time].filter(Boolean).join(" · "),
          style: "label",
          color: "text.muted",
          align: textAlign as "left" | "center",
          minHeight: 0.28,
          autoFit: "shrink" as const,
          optional: true,
        }] : []),
        // 96vi8n slide 20: body minHeight 0.4 → 0.7 fits 2 lines instead
        // of 1, matching typical step-description sentences. Body still
        // optional so dense rows can drop it.
        ...(step.body && step.body.trim() ? [{
          id: `${slideId}.${id}.step${index + 1}.body`,
          type: "text" as const,
          text: step.body.trim(),
          style: "caption",
          align: textAlign as "left" | "center",
          valign: "top" as const,
          // Horizontal: use min/max so the body grows for 1-2 lines instead
          // of being pinned to a fixed 0.9cm slot that forced autoFit:"shrink"
          // to drop body font to ~8pt. minHeight floor keeps 2-line bodies
          // (96vi8n regression: short bodies < 2 lines reverted to 0.4cm).
          // Combined with the step's maxHeight cap above, the card now sizes
          // to actual content instead of stretching the row.
          ...(direction === "horizontal"
            ? { minHeight: dense ? 0.5 : 0.9, maxHeight: dense ? 1.4 : 1.8 }
            : { minHeight: verticalDense ? 0.5 : 0.9 }),
          autoFit: "shrink" as const,
          optional: true,
        }] : []),
        ...(step.bullets && step.bullets.length ? [{ ...bulletList(slideId, `${id}.step${index + 1}.bullets`, step.bullets.slice(0, 3), "compact"), optional: true }] : []),
      ],
      layoutWeight: 4,
      ...(cardVariant ? { fill: "surface", line: "divider", padding: richHorizontalCard ? 0.34 : dense || verticalDense ? 0.26 : 0.35, cornerRadius: 0.08 } : {}),
    };
    items.push(cardVariant && options.stepSurface && typeof options.stepSurface === "object"
      ? applyAgentSurface(stepNode, options.stepSurface)
      : stepNode);
    if (index < options.steps.length - 1) {
      if (connectorMode === "none") return;
      // 96vi8n slide 20: 0.7×0.5cm chevrons were nearly invisible. Bumped
      // to 1.1×0.7cm (h-flow) / 0.7×0.55cm (v-flow). Arrow keeps its
      // brand.primary fill — the agent's chromatic claim is here, not on
      // the title text (which uses text.primary for contrast safety).
      const lineConnector = connectorMode === "line";
      const chevronConnector = connectorMode === "chevron";
      items.push(lineConnector ? {
        id: `${slideId}.${id}.arrow${index + 1}`,
        type: "shape",
        role: "process-connector",
        connector: "line",
        preset: "line",
        line: connectorColor,
        lineWidth: cardVariant ? 0.035 : 0.025,
        ...(connectorDash ? { lineDash: connectorDash } : {}),
        fixedWidth: direction === "horizontal" ? (dense ? 0.7 : 1.0) : 0.05,
        fixedHeight: direction === "horizontal" ? 0.05 : (verticalDense ? 0.46 : 0.6),
        layoutWeight: 1,
      } : {
        id: `${slideId}.${id}.arrow${index + 1}`,
        type: "shape",
        role: "process-connector",
        connector: chevronConnector ? "chevron" : "arrow",
        preset: chevronConnector && direction === "horizontal" ? "chevron" : arrow,
        fill: connectorColor,
        line: connectorColor,
        fixedWidth: direction === "horizontal" ? (dense ? 0.7 : chevronConnector ? 0.82 : 1.1) : (verticalDense ? 0.55 : 0.7),
        fixedHeight: direction === "horizontal" ? (dense ? 0.5 : chevronConnector ? 0.62 : 0.7) : (verticalDense ? 0.4 : 0.55),
        layoutWeight: 1,
      });
    }
  });
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction,
    gap: cardVariant && direction === "horizontal" ? (dense ? 0.24 : 0.32) : dense || verticalDense ? 0.18 : 0.4,
    role: "process-flow",
    align: "center",
    valign: "middle",
    ...(cardVariant && direction === "horizontal" && placement === "top" && horizontalBandMaxHeight > 0 && !(hasRichHorizontalCard && options.steps.length >= 4)
      ? {
          minHeight: horizontalBandMinHeight || undefined,
          maxHeight: horizontalBandMaxHeight,
        }
      : {}),
    children: items,
    // No outer fixedHeight: process-flow lets the container above decide.
    // Layout falls back to vertical orientation when the cross-axis cell is
    // too narrow (see autoOrientFlow in render.ts).
  } as DomNode, options);
}

export function logoStrip(slideId: string, id: string, logos: Array<{ src: string; alt?: string }>, options: { caption?: string; columns?: number } = {}): DomNode {
  const columns = options.columns && options.columns > 0 ? options.columns : Math.min(6, logos.length);
  const grid: DomNode = {
    id: `${slideId}.${id}.row`,
    type: "grid",
    columns,
    gap: 0.6,
    role: "logo-strip",
    children: logos.map((logo, index) => ({
      id: `${slideId}.${id}.logo${index + 1}`,
      type: "image",
      src: logo.src,
      alt: logo.alt || `logo-${index + 1}`,
      fit: "contain",
      fixedHeight: 1.4,
    })),
  };
  if (!options.caption) return grid;
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.25,
    role: "logo-strip",
    children: [
      grid,
      { id: `${slideId}.${id}.caption`, type: "text", text: options.caption, style: "caption", align: "center", color: "text.muted", minHeight: 0.4, autoFit: "shrink" },
    ],
  };
}

export function pricingCard(slideId: string, id: string, options: { plan: string; price: string; period?: string; features: string[]; tone?: "neutral" | "brand"; ctaText?: string }): DomNode {
  const tone = options.tone === "brand" ? "brand" : "neutral";
  const accent = tone === "brand" ? "brand.primary" : "text.primary";
  const surface = tone === "brand" ? "brand.tint" : "surface";
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.3,
    role: "pricing-card",
    fill: surface,
    line: tone === "brand" ? "brand.primary" : "divider",
    padding: 0.55,
    cornerRadius: 0.12,
    children: [
      { id: `${slideId}.${id}.plan`, type: "text", text: options.plan, style: "card-title", color: accent, minHeight: 0.6, autoFit: "shrink" },
      {
        id: `${slideId}.${id}.priceRow`,
        type: "stack",
        direction: "horizontal",
        gap: 0.2,
        align: "start",
        valign: "bottom",
        children: [
          { id: `${slideId}.${id}.price`, type: "text", text: options.price, style: "metric-value", color: accent, align: "left", valign: "bottom", layoutWeight: 5 },
          ...(options.period ? [{ id: `${slideId}.${id}.period`, type: "text" as const, text: options.period, style: "label", color: "text.muted", align: "left" as const, valign: "bottom" as const, minHeight: 0.45, autoFit: "shrink" as const, layoutWeight: 2 }] : []),
        ],
        fixedHeight: 1.4,
      },
      {
        id: `${slideId}.${id}.divider`,
        type: "divider",
        orientation: "horizontal",
        line: tone === "brand" ? "brand.primary" : "divider",
        fixedHeight: 0.05,
      },
      checklist(slideId, `${id}-features`, options.features.map((text) => ({ text, status: "checked" })), "compact"),
      ...(options.ctaText ? [{ id: `${slideId}.${id}.cta`, type: "text" as const, text: options.ctaText, style: "card-title" as const, align: "center" as const, valign: "middle" as const, fill: tone === "brand" ? "brand.primary" : "surface.subtle", color: tone === "brand" ? "text.inverse" : "text.primary", cornerRadius: 0.3, fixedHeight: 1, role: "cta" }] : []),
    ],
  };
}

function parsePercentValue(raw: string): number | null {
  // Only emit a progress bar when the value is a clean percent in
  // [0, 100]. Negative or >100% values are likely typos or growth/
  // delta metrics where a 0..100 ratio bar would be misleading; we
  // suppress the bar instead of clamping silently. The number text
  // still renders normally — only the optional progress affordance
  // is skipped.
  const m = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*%\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 100) return null;
  return n;
}

export function heroStat(slideId: string, id: string, options: { value: string; label: string; caption?: string; tone?: "brand" | "positive" | "warning" | "danger" | "neutral" }): DomNode {
  const tone = options.tone || "brand";
  const valueColor = tone === "positive" ? "success" : tone === "warning" ? "warning" : tone === "danger" ? "danger" : tone === "neutral" ? "text.primary" : "brand.primary";
  // 96vi8n slide 19: a single "66%" big-stat had no visual context for
  // the percentage. When the value parses as a percent (e.g. "66%",
  // "66.4%", "66 %"), append a thin progress bar below the label so
  // readers immediately see "this is 66 out of 100".
  const percent = parsePercentValue(options.value);
  const inner: DomNode[] = [
    {
      id: `${slideId}.${id}.value`,
      type: "text",
      text: options.value,
      style: "metric-value",
      size: "2xl",
      color: valueColor,
      align: "center",
      valign: "middle",
      autoFit: "shrink",
      minHeight: 1.3,
    },
    {
      id: `${slideId}.${id}.label`,
      type: "text",
      text: options.label,
      style: "card-title",
      size: "md",
      color: "text.primary",
      align: "center",
      valign: "top",
      minHeight: 0.55,
      autoFit: "shrink",
    },
  ];
  if (percent !== null) {
    const ratio = Math.max(0.001, Math.min(1, percent / 100));
    inner.push({
      id: `${slideId}.${id}.progress`,
      type: "stack",
      direction: "horizontal",
      gap: 0,
      fixedHeight: 0.28,
      fill: "surface.subtle",
      cornerRadius: 0.5,
      padding: 0,
      role: "hero-stat-progress",
      children: [
        { id: `${slideId}.${id}.progress.fill`, type: "shape", preset: "roundRect", fill: valueColor, cornerRadius: 0.5, layoutWeight: ratio },
        { id: `${slideId}.${id}.progress.spacer`, type: "spacer", layoutWeight: Math.max(0.001, 1 - ratio) },
      ],
      optional: true,
    } as DomNode);
  }
  if (options.caption && options.caption.trim()) {
    inner.push({
      id: `${slideId}.${id}.caption`,
      type: "text",
      text: options.caption.trim(),
      style: "caption",
      align: "center",
      valign: "top",
      color: "text.muted",
      minHeight: 0.45,
      autoFit: "shrink",
      optional: true,
    });
  }
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.25,
    role: "hero-stat",
    align: "center",
    justify: "center",
    children: inner,
  };
}

export type BarListTone = "brand" | "positive" | "warning" | "danger" | "neutral";
export type BarListDensity = "comfortable" | "compact";

function barListFillToken(tone: BarListTone | undefined): string {
  if (tone === "positive") return "success";
  if (tone === "warning") return "warning";
  if (tone === "danger") return "danger";
  if (tone === "neutral") return "divider";
  return "brand.primary";
}

export function barList(slideId: string, id: string, options: { items: Array<{ label: string; value: number; max?: number; valueLabel?: string; tone?: BarListTone }>; tone?: BarListTone; sort?: "desc" | "asc" | "none"; density?: BarListDensity }): DomNode {
  const tone = options.tone || "brand";
  const trackToken = "surface.subtle";
  const declaredMax = options.items.reduce((m, item) => Math.max(m, item.max ?? item.value), 0);
  const max = declaredMax > 0 ? declaredMax : 1;
  const sort = options.sort || "none";
  const sorted = sort === "none" ? options.items.slice() : options.items.slice().sort((a, b) => sort === "desc" ? b.value - a.value : a.value - b.value);
  const compact = options.density === "compact" || sorted.length >= 5;
  const labelHeight = compact ? 0.36 : 0.5;
  const rowHeight = compact ? 0.34 : 0.5;
  const trackHeight = compact ? 0.2 : 0.32;
  const rowGap = compact ? 0.24 : 0.4;
  const itemGap = compact ? 0.05 : 0.1;
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: compact ? 0.16 : 0.3,
    role: "bar-list",
    children: sorted.map((item, index) => {
      const ratio = Math.max(0.001, Math.min(1, item.value / max));
      const valueLabel = item.valueLabel || `${item.value}`;
      const fillToken = barListFillToken(item.tone || tone);
      // Estimate value-label width: ~0.34cm per CJK glyph, ~0.18cm per
      // ASCII char, +0.3cm padding. Bounded 1.0..3.6cm — short numeric
      // values like "100" no longer waste 1.6cm of bar space, while
      // long strings like "1,234,567" still get adequate room.
      const valueWidthCm = Math.max(1.0, Math.min(3.6, 0.3 + Array.from(valueLabel).reduce((w, ch) => w + (/[\u4e00-\u9fff]/.test(ch) ? 0.34 : 0.18), 0)));
      return {
        id: `${slideId}.${id}.${index}`,
        type: "stack",
        direction: "vertical",
        gap: itemGap,
        children: [
          // Label sits on its own row: full-width, left-aligned, no
          // floating value to compete for attention.
          { id: `${slideId}.${id}.${index}.label`, type: "text", text: item.label, style: "label", color: "text.primary", align: "left", valign: "middle", fixedHeight: labelHeight, size: compact ? "sm" : "md", autoFit: "shrink" },
          // Bar row: [track | value]. The value is a fixed-width column
          // *immediately after* the track, so it visually anchors to the
          // bar's right end zone — no longer floating at the slide's far
          // right disconnected from the actual fill end (96vi8n slide
          // 8/16/18). Value uses text.primary so it stays readable on
          // light surfaces (LOW_CONTRAST auto-fix would otherwise rewrite
          // a tone-colored value, breaking the bar↔number visual link).
          {
            id: `${slideId}.${id}.${index}.row`,
            type: "stack",
            direction: "horizontal",
            gap: rowGap,
            fixedHeight: rowHeight,
            valign: "middle",
            children: [
              // Continuous-track progress bar (qtt7dd slide 11): single
              // rounded backing + single rounded fill inside; no seam.
              {
                id: `${slideId}.${id}.${index}.track`,
                type: "stack",
                direction: "horizontal",
                gap: 0,
                fixedHeight: trackHeight,
                fill: trackToken,
                cornerRadius: 0.5,
                padding: 0,
                layoutWeight: 1,
                children: [
                  { id: `${slideId}.${id}.${index}.fill`, type: "shape", preset: "roundRect", fill: fillToken, cornerRadius: 0.5, basis: 0, minWidth: 0.02, layoutWeight: Math.max(0.001, ratio) },
                  { id: `${slideId}.${id}.${index}.spacer`, type: "spacer", basis: 0, minWidth: 0, layoutWeight: Math.max(0.001, 1 - ratio) },
                ],
              },
              { id: `${slideId}.${id}.${index}.value`, type: "text", text: valueLabel, style: "label", color: "text.primary", align: "right", valign: "middle", fixedWidth: valueWidthCm, fixedHeight: rowHeight, size: compact ? "sm" : "md", bold: true, autoFit: "shrink" },
            ],
          },
        ],
      };
    }),
  };
}

export function keyTakeaway(
  slideId: string,
  id: string,
  options: {
    headline: string;
    detail?: string;
    content?: unknown;
    bullets?: string[];
    tone?: "brand" | "positive" | "warning" | "danger" | "neutral";
    variant?: "panel" | "banner" | "minimal";
    density?: "comfortable" | "compact";
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const tone = options.tone || "brand";
  const fillToken = tone === "brand" ? "brand.tint" : tone === "positive" ? "success.tint" : tone === "warning" ? "warning.tint" : tone === "neutral" ? "surface.subtle" : "danger.tint";
  const accentToken = tone === "brand" ? "brand.primary" : tone === "positive" ? "success" : tone === "warning" ? "warning" : tone === "neutral" ? "divider" : "danger";
  const headline = options.headline.trim();
  const detail = textWithRichContent(options.detail?.trim() || "", options.content);
  const detailPlain = detail.text || richTextPlain(detail.content);
  const denseHeadline = options.density === "compact" || weightedTextLength(headline) > 46;
  const denseDetail = weightedTextLength(detailPlain) > 44 || (options.bullets || []).length >= 4;
  const compact = options.density === "compact" || denseHeadline || denseDetail;
  // Thicker accent bar (0.18cm vs the previous 0.12) + a longer rule
  // (3.2cm) to give the takeaway visual weight against a busy slide.
  const children: DomNode[] = [
    {
      id: `${slideId}.${id}.accent`,
      type: "shape",
      preset: "rect",
      fill: accentToken,
      fixedHeight: 0.18,
      fixedWidth: 3.2,
      align: "start",
    },
  ];
  if (headline) {
    children.push({
      id: `${slideId}.${id}.headline`,
      type: "text",
      text: headline,
      style: denseHeadline ? "lead" : "section-title",
      size: denseHeadline ? "md" : "lg",
      color: "text.primary",
      align: "left",
      autoFit: "shrink",
      minHeight: denseHeadline ? 0.55 : undefined,
    });
  }
  if (detail.text || detail.content) {
    children.push({
      id: `${slideId}.${id}.detail`,
      type: "text",
      ...detail,
      style: compact ? "paragraph" : "lead",
      color: "text.primary",
      align: "left",
      valign: "top",
      autoFit: "shrink",
      minHeight: estimateTakeawayDetailMinHeight(detailPlain, compact),
      optional: compact ? true : undefined,
    });
  }
  if (options.bullets && options.bullets.length) {
    children.push({ ...bulletList(slideId, `${id}.bullets`, options.bullets.slice(0, 5), compact ? "compact" : "comfortable"), spaceAfter: compact ? 1.2 : 2.0 });
  }
  const minimal = options.variant === "minimal";
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: compact ? 0.14 : 0.3,
    role: "key-takeaway",
    ...(!minimal ? { fill: fillToken, line: accentToken, padding: compact ? 0.38 : options.variant === "banner" ? 0.55 : 0.7, cornerRadius: 0.12, elevation: "raised" } : {}),
    children,
  } as DomNode, options);
}

function weightedTextLength(text: string): number {
  let length = 0;
  for (const char of text) {
    length += /[\u4e00-\u9fff]/.test(char) ? 1.05 : isWideVisualSymbol(char) ? 0.9 : 0.58;
  }
  return length;
}

function richTextPlain(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content.map((run) => {
    if (!run || typeof run !== "object") return "";
    const rec = run as Record<string, unknown>;
    if (typeof rec.text === "string") return rec.text;
    if (rec.kind === "math") return typeof rec.latex === "string" ? rec.latex : "";
    if (rec.kind === "cite") return "[cite]";
    if (rec.kind === "footnoteRef") return "[note]";
    if (rec.kind === "token") return String(rec.value ?? "");
    if (rec.kind === "icon") return typeof rec.alt === "string" ? rec.alt : "";
    return "";
  }).join("");
}

function estimateTakeawayDetailMinHeight(text: string, compact: boolean): number {
  const explicitLines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean).length;
  const weighted = weightedTextLength(text);
  const estimatedLines = Math.max(explicitLines || 1, Math.ceil(weighted / (compact ? 46 : 40)));
  const lineHeight = compact ? 0.46 : 0.58;
  return Math.max(compact ? 0.68 : 0.82, Math.min(compact ? 2.1 : 2.6, estimatedLines * lineHeight + 0.14));
}

export function numberedGrid(
  slideId: string,
  id: string,
  options: { items: Array<{ title: string; body?: string; marker?: DecorationMarkerInput; tone?: DecorationMarkerTone }>; columns?: number; tone?: "brand" | "neutral"; marker?: DecorationMarkerInput; numberStyle?: "chip" | "plain" } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const tone = options.tone || "brand";
  const accentColor = tone === "brand" ? "brand.primary" : "text.primary";
  // Number chip (default) gives the numeric prefix visual weight — circle
  // chip with brand fill + inverse text. `numberStyle:"plain"` falls back
  // to the previous oversized colored numeral.
  const chipStyle = options.numberStyle !== "plain";
  // 761q1u fix: 5 items in 2 cols → 3 rows (1.7cm/row) → body optional
  // gets dropped because chip(0.95)+title(0.55)+body(0.7) exceeds budget.
  // Auto-pick 3 cols (so 5 items = 2 rows of 3+2 ≈ 5cm/row) when columns
  // unset and items≥5. 7+ items still pick 4 cols.
  const cols = options.columns && options.columns > 0
    ? options.columns
    : options.items.length <= 4
      ? options.items.length
      : options.items.length <= 6
        ? 3
        : 4;
  const dense = options.items.length >= 5;
  // 4 items in 2 columns is a normal business slide pattern ("four bets",
  // "four principles", "four risks"). It creates two rows, so each item gets
  // roughly half the content height. Keep paragraph body text readable, but
  // use a smaller number chip and tighter internal rhythm so the component
  // fits without forcing agents to avoid a canonical 2x2 numbered grid.
  const twoByTwo = options.items.length === 4 && cols === 2;
  const compactCell = dense || twoByTwo;
  const bodyStyle = dense ? "caption" : "paragraph";
  const chipSize = dense ? 0.54 : twoByTwo ? 0.78 : 1.15;
  const cellGap = dense ? 0.10 : twoByTwo ? 0.16 : 0.25;
  const gridGap = dense ? 0.32 : twoByTwo ? 0.4 : 0.55;
  const titleMinHeight = dense ? 0.42 : twoByTwo ? 0.48 : 0.55;
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "grid",
    columns: cols,
    gap: gridGap,
    role: "numbered-grid",
    children: options.items.map((item, index) => {
      const itemTone = item.tone || (tone === "brand" ? "brand" : "neutral");
      const marker = dense && chipStyle ? null : decorationMarkerNode(slideId, `${id}.${index}.marker`, item.marker || options.marker, {
        shape: "dot",
        tone: itemTone,
        variant: "tint",
        size: compactCell ? "xs" : "sm",
      });
      const chipFill = dense ? toneAccentColor(itemTone, accentColor) : accentColor;
      const chipTextColor = dense && (itemTone === "neutral" || itemTone === "muted") ? "text.primary" : "text.inverse";
      const titleNode: DomNode = {
        id: `${slideId}.${id}.${index}.title`,
        type: "text",
        text: item.title,
        style: "card-title",
        color: "text.primary",
        align: "left",
        minHeight: titleMinHeight,
        autoFit: "shrink",
        layoutWeight: marker ? 1 : undefined,
      };
      return {
        id: `${slideId}.${id}.${index}`,
        type: "stack",
        direction: "vertical",
        gap: cellGap,
        role: "numbered-step",
        // 96vi8n slide 23: chip was visually centered above a left-aligned
        // title because the chip's own align:"center" (text-internal) was
        // also being read as the cross-axis positional alignment. Wrap
        // the chip in a left-anchored horizontal stack so the chip box
        // sits at cell-x and the digit inside the chip stays centered.
        align: "start" as const,
        children: [
          chipStyle
            ? {
                id: `${slideId}.${id}.${index}.num.wrap`,
                type: "stack" as const,
                direction: "horizontal" as const,
                gap: 0,
                align: "start" as const,
                valign: "top" as const,
                children: [
                  {
                    id: `${slideId}.${id}.${index}.num`,
                    type: "text" as const,
                    text: String(index + 1),
                    // Dense 5+ grids use a small chip; canonical 2x2 grids
                    // use a medium chip. Single-row hero-style grids keep the
                    // larger chip for visual weight.
                    style: compactCell ? "label" : "card-title",
                    weight: "bold" as const,
                    color: chipTextColor,
                    fill: chipFill,
                    align: "center" as const,
                    valign: "middle" as const,
                    cornerRadius: 0.5,
                    fixedWidth: chipSize,
                    fixedHeight: chipSize,
                  },
                  { id: `${slideId}.${id}.${index}.num.flex`, type: "spacer" as const, layoutWeight: 1 },
                ],
              }
            : {
                id: `${slideId}.${id}.${index}.num`,
                type: "text" as const,
                text: String(index + 1).padStart(2, "0"),
                style: "metric-value",
                color: accentColor,
                align: "left" as const,
                valign: "bottom" as const,
                minHeight: compactCell ? 0.6 : 0.9,
                autoFit: "shrink" as const,
              },
          ...(marker ? [{
            id: `${slideId}.${id}.${index}.titleRow`,
            type: "stack" as const,
            direction: "horizontal" as const,
            gap: compactCell ? 0.14 : 0.18,
            valign: "middle" as const,
            fixedHeight: compactCell ? titleMinHeight : undefined,
            children: [marker, titleNode],
          }] : [titleNode]),
          ...(item.body && item.body.trim() ? [{
            id: `${slideId}.${id}.${index}.body`,
            type: "text" as const,
            text: item.body.trim(),
            style: bodyStyle,
            align: "left" as const,
            valign: "top" as const,
            color: "text.muted",
            minHeight: numberedGridBodyMinHeight(item.body.trim(), dense, twoByTwo),
            layoutWeight: dense ? undefined : 1.4,
            autoFit: "shrink" as const,
            optional: dense,
          }] : []),
        ],
      };
    }),
  } as DomNode, options);
}

function numberedGridBodyMinHeight(text: string, dense: boolean, twoByTwo = false): number {
  const explicitLines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean).length;
  const estimatedLines = Math.max(explicitLines || 1, Math.ceil(weightedTextLength(text) / (dense ? 44 : twoByTwo ? 40 : 32)));
  const line = dense ? 0.32 : twoByTwo ? 0.42 : 0.5;
  return Math.max(dense ? 0.5 : twoByTwo ? 0.72 : 1.05, Math.min(dense ? 0.95 : twoByTwo ? 1.35 : 2.15, estimatedLines * line + 0.18));
}

export function statStrip(slideId: string, id: string, options: { items: Array<{ value: string; label: string; tone?: StatStripTone }>; tone?: StatStripTone }): DomNode {
  const stripTone: StatStripTone = options.tone || "brand";
  // Inline KPI row — no card chrome, just bold values + small labels separated
  // by thin vertical accent rules. Reads as a tighter alternative to kpi-grid
  // for the "headline numbers in one row" pattern (OOXML / consulting-deck
  // common shape).
  //
  // Per-item tone wins over the strip default — agents commonly mix
  // "78% positive / 65% warning / 43% danger" across one row to encode
  // a story arc, and silently coercing all three to brand.primary kills
  // that signal. (Bug seen in the bg.kpi log, May 2026.)
  const items: DomNode[] = [];
  options.items.forEach((item, index) => {
    const itemTone: StatStripTone = item.tone || stripTone;
    const valueColor = statStripToneColor(itemTone);
    if (index > 0) {
      items.push({
        id: `${slideId}.${id}.sep${index}`,
        type: "shape",
        preset: "rect",
        fill: "divider",
        fixedWidth: 0.04,
        fixedHeight: 1.35,
        align: "center",
        valign: "middle",
      });
    }
    items.push({
      id: `${slideId}.${id}.${index}`,
      type: "stack",
      direction: "vertical",
      gap: 0.15,
      align: "center",
      justify: "center",
      valign: "middle",
      fixedHeight: 2.05,
      layoutWeight: 4,
      children: [
        { id: `${slideId}.${id}.${index}.value`, type: "text", text: item.value, style: "metric-value", size: metricValueSize(item.value, false), color: valueColor, align: "center", valign: "bottom", autoFit: "shrink", minHeight: metricValueNeedsCompactScale(item.value) ? 1.0 : 0.9 },
        { id: `${slideId}.${id}.${index}.label`, type: "text", text: item.label, style: "metric-label", color: "text.muted", align: "center", valign: "top", uppercase: !/[\u4e00-\u9fff]/.test(item.label), letterSpacing: /[\u4e00-\u9fff]/.test(item.label) ? 0 : 60, autoFit: "shrink", minHeight: 0.36 },
      ],
    });
  });
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "horizontal",
    gap: 0.5,
    role: "stat-strip",
    align: "stretch",
    valign: "middle",
    minHeight: 2.05,
    maxHeight: 2.35,
    children: items,
  };
}

export type StatStripTone = "brand" | "positive" | "neutral" | "warning" | "danger";

function statStripToneColor(tone: StatStripTone): string {
  switch (tone) {
    case "positive": return "success";
    case "warning":  return "warning";
    case "danger":   return "danger";
    case "neutral":  return "text.primary";
    case "brand":
    default:         return "brand.primary";
  }
}

export function legend(slideId: string, id: string, options: { items: Array<{ label: string; color: string }>; direction?: "horizontal" | "vertical"; marker?: "dot" | "square" | "bar" }): DomNode {
  const direction = options.direction === "vertical" ? "vertical" : "horizontal";
  // Marker shape & size: 0.4cm dots were too small to read at slide
  // distance — bumped to 0.55cm. Agents can opt for a square or short bar
  // marker for chart-side legends where rectangles read as series chips.
  const marker = options.marker === "square" || options.marker === "bar" ? options.marker : "dot";
  const markerPreset = marker === "square" ? "rect" : marker === "bar" ? "rect" : "ellipse";
  const markerWidth = marker === "bar" ? 0.85 : 0.55;
  const markerHeight = marker === "bar" ? 0.22 : 0.55;
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction,
    gap: direction === "horizontal" ? 0.6 : 0.28,
    role: "legend",
    align: "start",
    valign: "middle",
    children: options.items.map((item, index) => ({
      id: `${slideId}.${id}.${index}`,
      type: "stack",
      direction: "horizontal",
      gap: 0.25,
      align: "start",
      valign: "middle",
      children: [
        {
          id: `${slideId}.${id}.${index}.dot`,
          type: "shape",
          preset: markerPreset,
          fill: item.color,
          line: item.color,
          cornerRadius: marker === "bar" ? 0.5 : marker === "square" ? 0.15 : undefined,
          fixedWidth: markerWidth,
          fixedHeight: markerHeight,
          align: "center",
        },
        // Label color upgraded text.muted → text.primary so legend items
        // read at the same priority as their colored markers. Muted gray
        // labels disappeared next to vivid dots (yajush log).
        { id: `${slideId}.${id}.${index}.label`, type: "text", text: item.label, style: "label", color: "text.primary", align: "left", valign: "middle", minHeight: 0.32, autoFit: "shrink" },
      ],
    })),
  };
}

export function badge(slideId: string, id: string, options: { text: string; tone?: "brand" | "positive" | "warning" | "danger" | "neutral" }): DomNode {
  const tone = options.tone || "brand";
  const fillToken = tone === "brand" ? "brand.primary" : tone === "positive" ? "success" : tone === "warning" ? "warning" : tone === "danger" ? "danger" : "text.muted";
  // umzrkm fix: previous estimate `text.length * 0.36 + 0.9` under-sized
  // CJK badges. CJK characters render about 0.55cm wide at the badge font
  // size while latin runs ~0.18cm. Mixed-script labels mid-truncate or
  // overflow when packed into 1.62cm. Estimate per-char so a 4-char CJK
  // label gets ~3cm and "粮食"-style 2-char labels get ~2.2cm.
  const intrinsic = textChipWidthCm(options.text, { min: 1.6, max: 6, padding: 0.9, cjk: 0.55, latin: 0.18 });
  return {
    id: `${slideId}.${id}`,
    type: "text",
    text: options.text,
    style: "label",
    size: "sm",
    weight: "bold",
    uppercase: true,
    letterSpacing: 80,
    color: "text.inverse",
    fill: fillToken,
    align: "center",
    valign: "middle",
    cornerRadius: 0.5,
    fixedHeight: 0.7,
    fixedWidth: intrinsic,
    autoFit: "shrink",
    noWrap: true,
    role: "badge",
  };
}

export function flowArrow(slideId: string, id: string, options: { label?: string; tone?: "brand" | "positive" | "warning" | "danger"; direction?: "right" | "down" }): DomNode {
  const tone = options.tone || "brand";
  const fillToken = tone === "brand" ? "brand.primary" : tone === "positive" ? "success" : tone === "warning" ? "warning" : "danger";
  const direction = options.direction === "down" ? "down" : "right";
  const preset = direction === "down" ? "arrow-down" : "arrow-right";
  // t25mft modern slide: a tiny flow-arrow above two cards looked like a
  // disconnected icon. Larger arrow + label that visually reads as a
  // "connector with caption". Keep right-direction arrow horizontal so it
  // sits inline next to a label.
  const children: DomNode[] = [
    {
      id: `${slideId}.${id}.arrow`,
      type: "shape",
      preset,
      fill: fillToken,
      line: fillToken,
      fixedWidth: direction === "right" ? 2.2 : 1.4,
      fixedHeight: direction === "right" ? 0.9 : 1.6,
      align: "center",
    },
  ];
  if (options.label && options.label.trim()) {
    children.push({
      id: `${slideId}.${id}.label`,
      type: "text",
      text: options.label.trim(),
      style: "label",
      color: fillToken,
      align: "center",
      valign: "middle",
      uppercase: true,
      letterSpacing: 80,
      minHeight: 0.5,
      autoFit: "shrink",
    });
  }
  // Snug cluster width: a flow-arrow with a label should read as ONE compact
  // unit (arrow + caption) centered in the parent's cross-axis, not as a
  // 22cm-wide caption row stretched across the slide. Without an explicit
  // width, the outer stack inherits the parent's full cross-axis size and
  // the label spans the slide. The label color is high-contrast and the
  // arrow shape is visible — but the layout looks like an orphan icon with
  // a banner caption. Constrain to the maximum of the arrow width and a
  // reasonable label allowance, then center within the parent.
  const labelWidth = options.label && options.label.trim() ? Math.max(3.5, Math.min(8, options.label.trim().length * 0.6)) : 0;
  const arrowWidth = direction === "right" ? 2.2 : 1.4;
  const clusterWidth = direction === "right"
    ? arrowWidth + 0.4 + labelWidth
    : Math.max(arrowWidth, labelWidth);
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction: direction === "right" ? "horizontal" : "vertical",
    gap: 0.18,
    role: "flow-arrow",
    align: "center",
    valign: "middle",
    justify: "center",
    fixedWidth: clusterWidth,
    children,
  };
}

export function tagList(slideId: string, id: string, options: { items: Array<string | { text: string; tone?: string }>; tone?: "neutral" | "brand" | "positive" | "warning" | "danger"; columns?: number }): DomNode {
  const defaultTone = options.tone || "neutral";
  const toneFill = (tone: string): { fill: string; color: string } => {
    if (tone === "brand") return { fill: "brand.tint", color: "brand.primary" };
    if (tone === "positive") return { fill: "success.tint", color: "success" };
    if (tone === "warning") return { fill: "warning.tint", color: "warning" };
    if (tone === "danger") return { fill: "danger.tint", color: "danger" };
    return { fill: "surface", color: "text.muted" };
  };
  const itemCount = options.items.length;
  // Arrange tags as an auto-wrapping grid; default to 4-6 per row depending
  // on item count, so a tight panel doesn't force tags off the edge.
  const columns = options.columns && options.columns > 0 ? options.columns : Math.min(6, Math.max(2, itemCount <= 4 ? itemCount : 4));
  return {
    id: `${slideId}.${id}`,
    type: "grid",
    columns,
    gap: 0.3,
    role: "tag-list",
    children: options.items.map((item, index) => {
      const text = typeof item === "string" ? item : (item && typeof item.text === "string" ? item.text : "");
      const tone = typeof item === "string" ? defaultTone : (item.tone || defaultTone);
      const { fill, color } = toneFill(tone);
      return {
        id: `${slideId}.${id}.${index}`,
        type: "text",
        text,
        style: "label",
        size: "sm",
        color,
        fill,
        align: "center",
        valign: "middle",
        cornerRadius: 0.4,
        minHeight: 0.55,
        autoFit: "shrink",
      };
    }),
  };
}

export function statComparison(slideId: string, id: string, options: { beforeLabel: string; beforeValue: string; afterLabel: string; afterValue: string; trend?: "up" | "down" | "flat"; deltaLabel?: string }): DomNode {
  const trend = options.trend || "up";
  const trendColor = trend === "up" ? "success" : trend === "down" ? "danger" : "text.muted";
  const arrow = trend === "up" ? "arrow-right" : trend === "down" ? "arrow-down" : "rect";
  return {
    id: `${slideId}.${id}`,
    type: "grid",
    columns: 3,
    columnWeights: [0.42, 0.16, 0.42],
    gap: 0.3,
    role: "stat-comparison",
    children: [
      {
        id: `${slideId}.${id}.before`,
        type: "stack",
        direction: "vertical",
        gap: 0.18,
        align: "center",
        valign: "middle",
        children: [
          { id: `${slideId}.${id}.before.label`, type: "text", text: options.beforeLabel, style: "label", color: "text.muted", align: "center", minHeight: 0.42, autoFit: "shrink" },
          { id: `${slideId}.${id}.before.value`, type: "text", text: options.beforeValue, style: "metric-value", color: "text.primary", align: "center", valign: "middle" },
        ],
      },
      {
        id: `${slideId}.${id}.delta`,
        type: "stack",
        direction: "vertical",
        gap: 0.15,
        align: "center",
        valign: "middle",
        children: [
          { id: `${slideId}.${id}.delta.arrow`, type: "shape", preset: arrow, fill: trendColor, line: trendColor, fixedHeight: 0.7, fixedWidth: 1.2 },
          ...(options.deltaLabel ? [{ id: `${slideId}.${id}.delta.label`, type: "text" as const, text: options.deltaLabel, style: "label", color: trendColor, align: "center" as const, minHeight: 0.42, autoFit: "shrink" as const }] : []),
        ],
      },
      {
        id: `${slideId}.${id}.after`,
        type: "stack",
        direction: "vertical",
        gap: 0.18,
        align: "center",
        valign: "middle",
        children: [
          { id: `${slideId}.${id}.after.label`, type: "text", text: options.afterLabel, style: "label", color: trendColor, align: "center", minHeight: 0.42, autoFit: "shrink" },
          { id: `${slideId}.${id}.after.value`, type: "text", text: options.afterValue, style: "metric-value", color: trendColor, align: "center", valign: "middle" },
        ],
      },
    ],
  };
}

/**
 * A flexible question card: prompt + optional multi-line content +
 * optional correctness highlight + optional explanation.
 *
 * Used for MCQ (with letter chips), short-answer hints, T/F, fill-in-
 * the-blank, classroom prompts, anything where one question is the
 * center of the card and trailing material supports it. Each item gets
 * its own row so layout never silently collapses (the bug 761q1u
 * documented for the prior "everything on one paragraph" pattern).
 *
 * Agent-facing fields:
 *   {
 *     id, type:"quiz-card",
 *     question:    string,                  // required prompt
 *     items?:      string[],                // optional trailing lines (options / hints)
 *     correct?:    string | number,         // letter "A".. or 0-based index — highlights matching item
 *     explanation?:string,                  // optional answer / rationale below items
 *     number?:     string,                  // optional "Q1" kicker
 *     questionType?:string,                 // optional "Inference" subtitle kicker
 *     tone?:       "brand"|"neutral"|"tinted",
 *   }
 *
 * Marker rules:
 *   - When `correct` is supplied, items render with letter chips A..E
 *     (because correct only makes sense with lettered options).
 *   - Otherwise items render with a small bullet dot — usable for
 *     short-answer hints, T/F prompts, or any free-form list.
 *   - 6 items max (renderer + readability cap).
 */
export function quizCard(
  slideId: string,
  id: string,
  options: {
    question: string;
    items?: string[];
    /** Legacy alias for `items` — accepted for back-compat. */
    options?: string[];
    correct?: string | number;
    explanation?: string;
    number?: string;
    questionType?: string;
    tone?: "brand" | "neutral" | "tinted";
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const tone = options.tone || "tinted";
  const fillToken = tone === "brand" ? "brand.tint" : tone === "neutral" ? "surface" : "surface.subtle";
  const accentToken = "brand.primary";
  const items = (options.items || options.options || []).slice(0, 6);
  // Letter-chip mode auto-enables when `correct` is supplied. Otherwise
  // we use a small bullet dot — items can be hints / sub-prompts / T-F
  // without forcing them to read as MCQ.
  const useLetterChips = options.correct !== undefined && options.correct !== null && options.correct !== "";
  const letters = ["A", "B", "C", "D", "E", "F"];
  const correctIndex = ((): number | null => {
    if (options.correct === undefined || options.correct === null || options.correct === "") return null;
    if (typeof options.correct === "number" && Number.isInteger(options.correct)) return options.correct;
    if (typeof options.correct === "string") {
      const trimmed = options.correct.trim();
      // Letter "A".."F" — case-insensitive
      if (/^[A-Fa-f]$/.test(trimmed)) return trimmed.toUpperCase().charCodeAt(0) - 65;
      // Numeric string fallback
      const n = Number(trimmed);
      if (Number.isInteger(n)) return n;
    }
    return null;
  })();
  // Stem header: optional Q-number + optional question-type kicker
  // prepended to the prompt: "Q1 · Inference — prompt text".
  const stemPrefix = (() => {
    const parts: string[] = [];
    if (options.number) parts.push(options.number);
    if (options.questionType) parts.push(options.questionType);
    return parts.join(" · ");
  })();
  const stemText = stemPrefix ? `${stemPrefix} — ${options.question}` : options.question;
  const itemRows: DomNode[] = items.map((text, idx) => {
    const isCorrect = correctIndex !== null && correctIndex === idx;
    const marker: DomNode = useLetterChips
      ? {
          id: `${slideId}.${id}.item${idx}.marker`,
          type: "text",
          text: letters[idx]!,
          style: "label",
          weight: "bold",
          color: isCorrect ? "text.inverse" : "text.primary",
          fill: isCorrect ? "success" : "surface",
          align: "center",
          valign: "middle",
          fixedWidth: 0.6,
          fixedHeight: 0.6,
          cornerRadius: 0.3,
        }
      : {
          // Bullet dot — small filled circle; muted unless this item is
          // marked correct (still works without letter chips, e.g. when
          // `correct` was passed as an index alongside non-MCQ items).
          id: `${slideId}.${id}.item${idx}.marker`,
          type: "shape",
          preset: "ellipse",
          fill: isCorrect ? "success" : "text.muted",
          line: isCorrect ? "success" : "text.muted",
          fixedWidth: 0.18,
          fixedHeight: 0.18,
          align: "center",
        };
    return {
      id: `${slideId}.${id}.item${idx}`,
      type: "stack",
      direction: "horizontal",
      gap: useLetterChips ? 0.25 : 0.3,
      role: "quiz-item",
      align: "start",
      valign: "middle",
      children: [
        marker,
        {
          id: `${slideId}.${id}.item${idx}.text`,
          type: "text",
          text,
          style: "paragraph",
          color: isCorrect ? "success" : "text.primary",
          weight: isCorrect ? "semibold" : undefined,
          align: "left",
          valign: "middle",
          layoutWeight: 1,
          minHeight: 0.45,
          autoFit: "shrink",
        },
      ],
    };
  });
  // Explanation block: rendered below items, separated by a thin divider.
  // Style is intentionally softer (paragraph + text.muted) so the eye
  // sees question → choices → "why" as a clear hierarchy.
  const explanationNodes: DomNode[] = options.explanation && options.explanation.trim()
    ? [
        {
          id: `${slideId}.${id}.divider`,
          type: "shape",
          preset: "rect",
          fill: "divider",
          fixedHeight: 0.02,
          align: "stretch",
        },
        {
          id: `${slideId}.${id}.explanation`,
          type: "text",
          text: options.explanation.trim(),
          style: "paragraph",
          color: "text.muted",
          align: "left",
          valign: "top",
          minHeight: 0.5,
          autoFit: "shrink",
        },
      ]
    : [];
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.18,
    role: "quiz-card",
    fill: fillToken,
    line: accentToken,
    lineWidth: 0.02,
    cornerRadius: 0.12,
    padding: 0.5,
    children: [
      {
        id: `${slideId}.${id}.stem`,
        type: "text",
        text: stemText,
        style: "h2",
        color: "text.primary",
        align: "left",
        minHeight: 0.7,
        autoFit: "shrink",
      },
      ...itemRows,
      ...explanationNodes,
    ],
  } as DomNode, options);
}

/**
 * 761q1u: a multi-item Key Takeaways block. Each item gets a left
 * accent bar + bold headline + optional 1-line detail, stacked
 * vertically. This is the right component for a "summary / wrap-up"
 * slide where 3-5 short takeaways need to dominate the page —
 * `key-takeaway` is single-item, and `callout` reads as a side-note
 * rather than a numbered conclusion.
 *
 * Agent-facing fields:
 *   { id, type:"takeaway-list",
 *     items:[{ headline, detail?, tone? }, ...] }
 */
export type TakeawayTone = "brand" | "positive" | "warning" | "danger" | "neutral";

export function takeawayList(
  slideId: string,
  id: string,
  options: { title?: string; items: Array<{ headline: string; detail?: string; tone?: TakeawayTone; marker?: DecorationMarkerInput }>; tone?: TakeawayTone; marker?: DecorationMarkerInput } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const baseTone: TakeawayTone = options.tone || "brand";
  const items = (options.items || []).slice(0, 6);
  // Density adapts gap + accent thickness to item count so 5 takeaways
  // still fit in a typical 8cm content area.
  const dense = items.length >= 4;
  const detailedGrid = dense && items.some((item) => item.detail && item.detail.trim());
  const itemNodes: DomNode[] = items.map((item, idx) => {
    const tone: TakeawayTone = item.tone || baseTone;
    // Neutral lets the agent de-emphasize a less-load-bearing takeaway
    // alongside chromatic ones (e.g. "三个核心 finding + 一个 caveat" —
    // the caveat shouldn't compete with green/orange/brand). Maps to a
    // muted divider gray, not silently coerced to brand. (qyectb log,
    // slide 13: tone='neutral' was rendering as brand.primary.)
    const accent = tone === "brand" ? "brand.primary" : toneAccentColor(tone, "brand.primary");
    const marker = decorationMarkerNode(slideId, `${id}.${idx}.marker`, item.marker || options.marker, {
      shape: "side-bar",
      tone,
      variant: tone === "neutral" ? "outline" : "solid",
      size: dense ? "sm" : "md",
      valign: "top",
    });
    const children: DomNode[] = [
      marker || {
        // Accent bar uses fixedWidth only — its height is decided by the
        // row's allocated cross-axis. Setting fixedHeight made every row
        // demand at least that much, blocking dense (5+) layouts.
        // 96vi8n slides 2/22: dense=0.14cm read as a hairline at slide
        // distance. Both modes bumped to 0.18cm — visible without
        // dominating, and dense rows can absorb the extra 0.04cm with
        // no FALLBACK_FAILED.
        id: `${slideId}.${id}.${idx}.bar`,
        type: "shape",
        preset: "rect",
        fill: accent,
        fixedWidth: 0.18,
        align: "start",
      },
      {
        id: `${slideId}.${id}.${idx}.text`,
        type: "stack",
        direction: "vertical",
        gap: dense ? 0.04 : 0.1,
        valign: "top",
        layoutWeight: 1,
        children: [
          {
            id: `${slideId}.${id}.${idx}.headline`,
            type: "text",
            text: item.headline,
            style: dense ? "card-title" : "h2",
            color: "text.primary",
            align: "left",
            minHeight: dense ? 0.45 : 0.55,
            autoFit: "shrink",
          },
          ...(item.detail && item.detail.trim() ? [{
            id: `${slideId}.${id}.${idx}.detail`,
            type: "text" as const,
            text: item.detail.trim(),
            style: dense ? "caption" : "paragraph",
            color: "text.muted",
            align: "left" as const,
            valign: "top" as const,
            minHeight: estimateTakeawayDetailMinHeight(item.detail.trim(), dense),
            autoFit: "shrink" as const,
            optional: true,
          }] : []),
        ],
      },
    ];
    return {
      id: `${slideId}.${id}.${idx}`,
      type: "stack",
      direction: "horizontal",
      gap: 0.26,
      role: "takeaway-item",
      align: "start",
      valign: "top",
      children,
    };
  });
  const listNode: DomNode = {
    id: `${slideId}.${id}.items`,
    type: detailedGrid ? "grid" : "stack",
    ...(detailedGrid ? { columns: 2 } : { direction: "vertical" as const }),
    gap: detailedGrid ? 0.32 : dense ? 0.25 : 0.5,
    role: "takeaway-list-items",
    children: itemNodes,
  };
  const title = options.title?.trim();
  const children: DomNode[] = title
    ? [
        {
          id: `${slideId}.${id}.title`,
          type: "text",
          text: title,
          style: "card-title",
          color: baseTone === "neutral" ? "text.primary" : toneAccentColor(baseTone, "brand.primary"),
          minHeight: dense ? 0.38 : 0.48,
          autoFit: "shrink",
        },
        listNode,
      ]
    : [listNode];
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: title ? 0.16 : 0,
    role: "takeaway-list",
    children,
  } as DomNode, options);
}

/**
 * outline — Table of contents / agenda. N chapters, each:
 * `(number, title, optional body, optional page)`. Vertical flow with
 * editorial spacing; not a grid (numbered-grid is for parallel modules,
 * outline is for linear chapters).
 *
 * Density adapts to item count:
 *   1-5 items:  comfortable — body shown, h2 title
 *   6-9 items:  compact — body shown but smaller, card-title
 *   10-12:      very compact — body hidden, title-only
 *   >12:        clamped to 12 (caller should split into two slides)
 */
export function outline(
  slideId: string,
  id: string,
  options: {
    items: Array<{ number?: string; title: string; body?: string; page?: string | number; tone?: "brand" | "positive" | "warning" | "danger" }>;
    showPages?: boolean;
    density?: "comfortable" | "compact" | "auto";
    tone?: "brand" | "neutral";
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const baseTone = options.tone || "brand";
  const accentToken = baseTone === "brand" ? "brand.primary" : "text.primary";
  const items = (options.items || []).slice(0, 12);
  const showPages = options.showPages === true;
  const density = options.density === "comfortable" || options.density === "compact" ? options.density
    : items.length >= 10 ? "compact"
    : items.length >= 6 ? "compact"
    : "comfortable";
  const veryCompact = items.length >= 10;
  const compact = density === "compact";
  // The number column is reserved when ANY item supplies `number`.
  // Items without a number get a blank cell so the title column stays
  // aligned. (Previously we auto-padded "01","02",... but that
  // conflicted with agent-authored numbering schemes like "Ch 1",
  // "I/II/III", or sequence keyed off section ids.) Agents who want
  // numbered chapters must pass `number` explicitly.
  const anyNumbered = items.some((it) => typeof it.number === "string" && it.number.trim() !== "");
  const itemNodes: DomNode[] = items.map((item, idx) => {
    const numberText = typeof item.number === "string" ? item.number.trim() : "";
    const tone = item.tone;
    const numberColor = tone === "positive" ? "success" : tone === "warning" ? "warning" : tone === "danger" ? "danger" : accentToken;
    const rowChildren: DomNode[] = [];
    if (anyNumbered) {
      // Reserve the number column on every row (even blank ones) so titles
      // stay aligned across items. Keep it as a direct fixed-width text node:
      // wrapping it in a vertical stack lets container natural-size logic
      // expand the number column, creating a huge gap before the title.
      rowChildren.push({
        id: `${slideId}.${id}.${idx}.num`,
        type: "text",
        text: numberText,
        style: veryCompact ? "label" : "metric-label",
        weight: "bold",
        color: numberColor,
        align: "left",
        valign: "top",
        fixedWidth: veryCompact ? 0.8 : compact ? 1.0 : 1.4,
        fixedHeight: veryCompact ? 0.6 : compact ? 0.8 : 1.0,
        autoFit: "shrink",
      });
    }
    const titleStack: DomNode = {
      id: `${slideId}.${id}.${idx}.col`,
      type: "stack",
      direction: "vertical",
      gap: veryCompact ? 0.02 : compact ? 0.06 : 0.08,
      valign: "top",
      layoutWeight: 1,
      children: [
        {
          id: `${slideId}.${id}.${idx}.title`,
          type: "text",
          text: item.title,
          // very-compact (10-12 items) drops to label style + minimal
          // height so each row fits in ~0.7cm.
          style: veryCompact ? "label" : compact ? "card-title" : "h2",
          color: "text.primary",
          align: "left",
          minHeight: veryCompact ? 0.4 : compact ? 0.5 : 0.54,
          autoFit: "shrink",
        },
        ...((!veryCompact && item.body && item.body.trim()) ? [{
          id: `${slideId}.${id}.${idx}.body`,
          type: "text" as const,
          text: item.body.trim(),
          style: compact ? "caption" : "paragraph",
          color: "text.muted",
          align: "left" as const,
          valign: "top" as const,
          minHeight: 0.42,
          autoFit: "shrink" as const,
          optional: true,
        }] : []),
      ],
    };
    rowChildren.push(titleStack);
    if (showPages && (item.page !== undefined && item.page !== null && item.page !== "")) {
      rowChildren.push({
        id: `${slideId}.${id}.${idx}.page`,
        type: "text",
        text: `p.${String(item.page)}`,
        style: "caption",
        color: "text.muted",
        align: "right",
        valign: "top",
        fixedWidth: 1.4,
        autoFit: "shrink",
      });
    }
    return {
      id: `${slideId}.${id}.${idx}`,
      type: "stack",
      direction: "horizontal",
      gap: compact ? 0.3 : 0.5,
      role: "outline-item",
      align: "start",
      valign: "top",
      children: rowChildren,
    };
  });
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    // very-compact (10-12 items): 0.12cm gap → 12 × 0.4 + 11 × 0.12 ≈ 6.1cm fits 8cm
    gap: veryCompact ? 0.12 : compact ? 0.25 : 0.45,
    role: "outline",
    children: itemNodes,
  } as DomNode, options);
}

/**
 * glossary — Term + definition list. Different from `definition-card`
 * which is one card per term: glossary handles 6-15 terms in a single
 * coherent layout (single column or two-column), terms aligned, no
 * card chrome competing for attention.
 */
export function glossary(
  slideId: string,
  id: string,
  options: {
    items: Array<{ term: string; definition: string }>;
    layout?: "list" | "two-column";
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const items = (options.items || []).slice(0, 16);
  const layout = options.layout === "two-column" ? "two-column" : "list";
  // Density tiers — chosen so the natural per-item height stays under
  // (content_area / rows) for typical 8cm content area:
  //   list: 16 items max → 0.5cm/row
  //   two-col: 16 items / 2 = 8 rows → 1cm/row
  // very-dense kicks in at 12+ items so 16-term two-column fits.
  const veryDense = items.length >= 12;
  const dense = !veryDense && items.length >= 8;
  const renderItem = (item: { term: string; definition: string }, idx: number): DomNode => ({
    id: `${slideId}.${id}.${idx}`,
    type: "stack",
    direction: "vertical",
    gap: veryDense ? 0.02 : dense ? 0.05 : 0.1,
    role: "glossary-item",
    children: [
      {
        id: `${slideId}.${id}.${idx}.term`,
        type: "text",
        text: item.term,
        style: veryDense ? "label" : dense ? "card-title" : "h2",
        weight: "bold",
        color: "brand.primary",
        align: "left",
        minHeight: veryDense ? 0.32 : dense ? 0.45 : 0.55,
        autoFit: "shrink",
      },
      {
        id: `${slideId}.${id}.${idx}.def`,
        type: "text",
        text: item.definition,
        style: veryDense ? "caption" : dense ? "caption" : "paragraph",
        color: "text.primary",
        align: "left",
        valign: "top",
        minHeight: veryDense ? 0.32 : dense ? 0.45 : 0.55,
        autoFit: "shrink",
        optional: true,
      },
    ],
  });
  if (layout === "two-column") {
    return applyAgentSurface({
      id: `${slideId}.${id}`,
      type: "grid",
      columns: 2,
      gap: veryDense ? 0.18 : dense ? 0.35 : 0.55,
      role: "glossary",
      children: items.map(renderItem),
    } as DomNode, options);
  }
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: veryDense ? 0.1 : dense ? 0.22 : 0.35,
    role: "glossary",
    children: items.map(renderItem),
  } as DomNode, options);
}

/**
 * q-and-a — FAQ / interview / answer-page block. Multiple
 * (question, answer) pairs stacked vertically with clear Q/A chips
 * so the eye scans Q→A→Q→A. Not for testing (use quiz-card).
 */
export function qAndA(
  slideId: string,
  id: string,
  options: {
    items: Array<{ q: string; a: string }>;
    density?: "comfortable" | "compact";
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  // Clamp to 6 pairs max — beyond that a single slide can't read
  // comfortably, even at the densest mode. Agents should split into
  // two q-and-a slides when they have 7+ FAQs.
  const items = (options.items || []).slice(0, 6);
  const dense = options.density === "compact" || items.length >= 4;
  // Very dense: 5-6 pairs need shorter chips and tighter row heights so
  // a 5/6-FAQ slide doesn't FALLBACK_FAILED on the default 8cm content
  // area. Each pair is ~1.2cm at this density.
  const veryDense = items.length >= 5;
  const ultraDense = false; // No longer reachable with the 6-item cap.
  const itemNodes: DomNode[] = items.flatMap((item, idx) => [
    {
      id: `${slideId}.${id}.${idx}.q`,
      type: "stack",
      direction: "horizontal",
      gap: 0.25,
      align: "start",
      valign: "top",
      role: "qa-question",
      children: [
        {
          id: `${slideId}.${id}.${idx}.q.chip`,
          type: "text",
          text: "Q",
          style: "label",
          weight: "bold",
          color: "text.inverse",
          fill: "brand.primary",
          align: "center",
          valign: "middle",
          fixedWidth: ultraDense ? 0.4 : veryDense ? 0.45 : dense ? 0.55 : 0.7,
          fixedHeight: ultraDense ? 0.4 : veryDense ? 0.45 : dense ? 0.55 : 0.7,
          cornerRadius: 0.5,
        },
        {
          id: `${slideId}.${id}.${idx}.q.text`,
          type: "text",
          text: item.q,
          style: ultraDense ? "label" : veryDense ? "label" : dense ? "card-title" : "h2",
          weight: "bold",
          color: "text.primary",
          align: "left",
          valign: "middle",
          layoutWeight: 1,
          minHeight: ultraDense ? 0.38 : veryDense ? 0.45 : dense ? 0.5 : 0.6,
          autoFit: "shrink",
        },
      ],
    } as DomNode,
    {
      id: `${slideId}.${id}.${idx}.a`,
      type: "stack",
      direction: "horizontal",
      gap: 0.25,
      align: "start",
      valign: "top",
      role: "qa-answer",
      children: [
        {
          id: `${slideId}.${id}.${idx}.a.chip`,
          type: "text",
          text: "A",
          style: "label",
          weight: "bold",
          color: "text.inverse",
          fill: "text.muted",
          align: "center",
          valign: "middle",
          fixedWidth: ultraDense ? 0.4 : veryDense ? 0.45 : dense ? 0.55 : 0.7,
          fixedHeight: ultraDense ? 0.4 : veryDense ? 0.45 : dense ? 0.55 : 0.7,
          cornerRadius: 0.5,
        },
        {
          id: `${slideId}.${id}.${idx}.a.text`,
          type: "text",
          text: item.a,
          style: dense ? "caption" : "paragraph",
          color: "text.primary",
          align: "left",
          valign: "top",
          layoutWeight: 1,
          minHeight: ultraDense ? 0.38 : veryDense ? 0.42 : dense ? 0.5 : 0.7,
          autoFit: "shrink",
          // Answer is optional in ultra-dense (7+ pairs) so layout can drop
          // it for the densest pages where Q-only summaries still help.
          optional: veryDense,
        },
      ],
    } as DomNode,
  ]);
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: ultraDense ? 0.08 : veryDense ? 0.15 : dense ? 0.25 : 0.45,
    role: "q-and-a",
    children: itemNodes,
  } as DomNode, options);
}

/**
 * comparison-table — Multi-option comparison matrix. Features as rows,
 * options as columns. The recommended option's column gets a tinted
 * highlight band + "RECOMMENDED" badge. Different from `table-card`
 * (which is a generic data table without per-column visual emphasis)
 * and `comparison-card` (which is a single-option card in a peer set).
 */
export function comparisonTable(
  slideId: string,
  id: string,
  options: {
    features: string[];
    options: Array<{ name: string; values: string[]; recommended?: boolean }>;
    title?: string;
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const features = (options.features || []).slice(0, 8);
  const opts = (options.options || []).slice(0, 4);
  const colCount = opts.length + 1; // +1 for the feature label column
  // Header row: empty corner + option names
  const headerRow: DomNode[] = [
    {
      id: `${slideId}.${id}.h0`,
      type: "spacer",
      fixedHeight: 0.9,
    },
    ...opts.map((opt, idx) => ({
      id: `${slideId}.${id}.h${idx + 1}`,
      type: "stack" as const,
      direction: "vertical" as const,
      gap: 0.08,
      align: "center" as const,
      valign: "middle" as const,
      fixedHeight: 0.9,
      fill: opt.recommended ? "brand.tint" : undefined,
      cornerRadius: opt.recommended ? 0.08 : undefined,
      children: [
        ...(opt.recommended ? [{
          id: `${slideId}.${id}.h${idx + 1}.badge`,
          type: "text" as const,
          text: "RECOMMENDED",
          style: "label",
          weight: "bold" as const,
          color: "text.primary",
          align: "center" as const,
          tracking: "wide" as const,
          minHeight: 0.32,
          autoFit: "shrink" as const,
        }] : []),
        {
          id: `${slideId}.${id}.h${idx + 1}.name`,
          type: "text" as const,
          text: opt.name,
          style: "card-title",
          weight: "bold" as const,
          color: "text.primary",
          align: "center" as const,
          minHeight: 0.5,
          autoFit: "shrink" as const,
        },
      ],
    })),
  ];
  // Each feature row: feature label + per-option value cells
  const featureRows: DomNode[] = features.flatMap((feature, fIdx) => {
    const cells: DomNode[] = [
      {
        id: `${slideId}.${id}.r${fIdx}.f`,
        type: "text",
        text: feature,
        style: "card-title",
        weight: "semibold",
        color: "text.primary",
        align: "left",
        valign: "middle",
        fill: "surface.subtle",
        minHeight: 0.7,
        autoFit: "shrink",
      },
      ...opts.map((opt, oIdx) => {
        const raw = opt.values[fIdx];
        const cellText = raw === undefined || raw === null || raw === "" ? "—" : String(raw);
        const isCheck = /^(✓|yes|true|是|有)$/i.test(cellText);
        const isCross = /^(✗|×|no|false|否|无)$/i.test(cellText);
        return {
          id: `${slideId}.${id}.r${fIdx}.o${oIdx}`,
          type: "text" as const,
          text: cellText,
          style: "paragraph",
          color: isCheck ? "success" : isCross ? "danger" : "text.primary",
          weight: (isCheck || isCross ? "bold" : undefined) as ("bold" | undefined),
          align: "center" as const,
          valign: "middle" as const,
          fill: opt.recommended ? "brand.tint" : undefined,
          minHeight: 0.7,
          autoFit: "shrink" as const,
        };
      }),
    ];
    return cells;
  });
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "grid",
    columns: colCount,
    gap: 0.04,
    role: "comparison-table",
    children: [...headerRow, ...featureRows],
  } as DomNode, options);
}

/* ============================================================
   DATA-EXPRESSION COMPONENTS
   ============================================================ */

/**
 * scorecard — status-coded metric grid. Each item has value + label +
 * status (good/warning/danger/neutral) + optional delta. Use for
 * dashboards, project status, quarterly reviews. Different from
 * metric-card / kpi-grid (which have no health/status semantics) and
 * stat-strip (no per-item color coding).
 */
export function scorecard(
  slideId: string,
  id: string,
  options: {
    items: Array<{
      label: string;
      value: string;
      status?: "good" | "warning" | "danger" | "neutral";
      delta?: string;
      trend?: "up" | "down" | "flat";
    }>;
    columns?: number;
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const items = (options.items || []).slice(0, 8);
  const cols = options.columns && options.columns > 0 ? options.columns : Math.min(4, Math.max(2, items.length));
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "grid",
    columns: cols,
    gap: 0.4,
    role: "scorecard",
    children: items.map((item, idx) => {
      const status = item.status || "neutral";
      const accent = status === "good" ? "success" : status === "warning" ? "warning" : status === "danger" ? "danger" : "text.muted";
      const valueColor = status === "good" ? "success" : status === "warning" ? "warning" : status === "danger" ? "danger" : "text.primary";
      const deltaColor = item.trend === "up" ? "success" : item.trend === "down" ? "danger" : "text.muted";
      return {
        id: `${slideId}.${id}.${idx}`,
        type: "card",
        role: "scorecard-item",
        accent: "left",
        accentColor: accent,
        padding: 0.4,
        elevation: "raised",
        children: [{
          id: `${slideId}.${id}.${idx}.stack`,
          type: "stack",
          direction: "vertical",
          gap: 0.12,
          children: [
            { id: `${slideId}.${id}.${idx}.label`, type: "text", text: item.label, style: "metric-label", color: "text.muted", align: "left", minHeight: 0.4, autoFit: "shrink" },
            { id: `${slideId}.${id}.${idx}.value`, type: "text", text: item.value, style: "metric-value", color: valueColor, align: "left", autoFit: "shrink", minHeight: 0.85 },
            ...(item.delta && item.delta.trim() ? [{
              id: `${slideId}.${id}.${idx}.delta`,
              type: "text" as const,
              text: (item.trend === "up" ? "▲ " : item.trend === "down" ? "▼ " : "") + item.delta.trim(),
              style: "label",
              color: deltaColor,
              align: "left" as const,
              minHeight: 0.32,
              autoFit: "shrink" as const,
              optional: true,
            }] : []),
          ],
        }],
      } as unknown as DomNode;
    }),
  } as DomNode, options);
}

/**
 * funnel — conversion funnel, sales pipeline, traffic stages. Each
 * stage is a chevron whose width reflects relative magnitude. Drop %
 * vs the previous stage is shown to the right.
 */
export function funnel(
  slideId: string,
  id: string,
  options: {
    stages: Array<{ label: string; value: number; valueLabel?: string; tone?: "brand" | "positive" | "warning" | "danger" }>;
    showDrop?: boolean;
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const stages = (options.stages || []).slice(0, 6);
  const max = stages.reduce((m, s) => Math.max(m, s.value || 0), 1);
  const showDrop = options.showDrop !== false;
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.15,
    role: "funnel",
    children: stages.map((stage, idx) => {
      const ratio = max > 0 ? Math.max(0.18, (stage.value || 0) / max) : 0.18;
      const tone = stage.tone || "brand";
      const fillToken = tone === "brand" ? "brand.primary" : tone === "positive" ? "success" : tone === "warning" ? "warning" : "danger";
      const drop = showDrop && idx > 0 && stages[idx - 1]!.value
        ? `${Math.round(((stages[idx - 1]!.value - stage.value) / stages[idx - 1]!.value) * 100)}% drop`
        : "";
      const valueLabel = stage.valueLabel || String(stage.value);
      return {
        id: `${slideId}.${id}.${idx}`,
        type: "stack",
        direction: "horizontal",
        gap: 0.4,
        align: "start",
        valign: "middle",
        role: "funnel-stage",
        children: [
          {
            id: `${slideId}.${id}.${idx}.bar`,
            type: "stack",
            direction: "horizontal",
            gap: 0,
            align: "start",
            valign: "middle",
            layoutWeight: 4,
            children: [
              {
                id: `${slideId}.${id}.${idx}.fill`,
                type: "shape",
                preset: "chevron",
                fill: fillToken,
                line: fillToken,
                fixedHeight: 0.85,
                layoutWeight: Math.max(1, Math.round(ratio * 100)),
              },
              {
                id: `${slideId}.${id}.${idx}.empty`,
                type: "spacer",
                layoutWeight: Math.max(1, Math.round((1 - ratio) * 100)),
              },
            ],
          },
          {
            id: `${slideId}.${id}.${idx}.text`,
            type: "stack",
            direction: "vertical",
            gap: 0.04,
            valign: "middle",
            layoutWeight: 2,
            children: [
              { id: `${slideId}.${id}.${idx}.label`, type: "text", text: stage.label, style: "card-title", color: "text.primary", align: "left", minHeight: 0.45, autoFit: "shrink" },
              { id: `${slideId}.${id}.${idx}.value`, type: "text", text: drop ? `${valueLabel} · ${drop}` : valueLabel, style: "caption", color: "text.muted", align: "left", minHeight: 0.32, autoFit: "shrink", optional: true },
            ],
          },
        ],
      };
    }),
  } as DomNode, options);
}

/**
 * gauge — single-value progress dial. Renders as a horizontal track
 * with threshold zones (color-banded background + value indicator).
 * For agent-friendly gauge semantics without OOXML arc complexity.
 */
export function gauge(
  slideId: string,
  id: string,
  options: {
    value: number;
    max?: number;
    label: string;
    unit?: string;
    thresholds?: Array<{ upTo: number; tone: "danger" | "warning" | "positive" | "brand"; label?: string }>;
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const max = options.max && options.max > 0 ? options.max : 100;
  const value = Math.max(0, Math.min(max, options.value || 0));
  const ratio = value / max;
  const thresholds = options.thresholds && options.thresholds.length > 0
    ? options.thresholds.slice().sort((a, b) => a.upTo - b.upTo)
    : [{ upTo: max, tone: "brand" as const }];
  // Find which threshold the current value falls into → that's the value color.
  const activeThreshold = thresholds.find((t) => value <= t.upTo) || thresholds[thresholds.length - 1]!;
  const valueTone = activeThreshold.tone;
  const valueColor = valueTone === "danger" ? "danger" : valueTone === "warning" ? "warning" : valueTone === "positive" ? "success" : "brand.primary";
  // Build the threshold-banded track: each threshold is a colored segment
  // proportional to its width along the 0..max range. Each band carries an
  // explicit fixedHeight so the parent horizontal-stack's height is pinned
  // (relying on the parent's fixedHeight alone wasn't reliable when sibling
  // children of the gauge container claim leftover layout space).
  const TRACK_HEIGHT = 0.45;
  let prevUpTo = 0;
  const trackChildren: DomNode[] = thresholds.map((t, idx) => {
    const widthRatio = Math.max(0.001, (t.upTo - prevUpTo) / max);
    const tToken = t.tone === "danger" ? "danger.tint" : t.tone === "warning" ? "warning.tint" : t.tone === "positive" ? "success.tint" : "brand.tint";
    prevUpTo = t.upTo;
    return {
      id: `${slideId}.${id}.t${idx}`,
      type: "shape",
      preset: "rect",
      fill: tToken,
      layoutWeight: Math.max(1, Math.round(widthRatio * 100)),
      fixedHeight: TRACK_HEIGHT,
    };
  });
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.2,
    role: "gauge",
    children: [
      {
        id: `${slideId}.${id}.value`,
        type: "text",
        text: `${value}${options.unit || ""}`,
        style: "metric-value",
        color: valueColor,
        align: "center",
        autoFit: "shrink",
        fixedHeight: 1.4,
      },
      {
        id: `${slideId}.${id}.label`,
        type: "text",
        text: options.label,
        style: "metric-label",
        color: "text.muted",
        align: "center",
        autoFit: "shrink",
        fixedHeight: 0.5,
      },
      {
        id: `${slideId}.${id}.track`,
        type: "stack",
        direction: "horizontal",
        gap: 0.04,
        fixedHeight: TRACK_HEIGHT,
        children: trackChildren,
      },
      // Pointer / marker showing where the value falls on the track. The
      // triangle is positioned via flanking spacers whose layoutWeights sum
      // to 100. Integer weights are honored more precisely than fractional
      // values by the layout solver.
      {
        id: `${slideId}.${id}.pointer-row`,
        type: "stack",
        direction: "horizontal",
        gap: 0,
        fixedHeight: 0.4,
        children: [
          // No fixedHeight on the spacers — they need to be pure flex for
          // layoutWeight to act as the sole sizing signal. With fixedHeight,
          // the layout solver was capping the weight contribution.
          { id: `${slideId}.${id}.pointer.l`, type: "spacer", layoutWeight: Math.max(1, Math.round(ratio * 100)) },
          { id: `${slideId}.${id}.pointer.tick`, type: "shape", preset: "triangle", fill: valueColor, line: valueColor, fixedWidth: 0.4, fixedHeight: 0.4 },
          { id: `${slideId}.${id}.pointer.r`, type: "spacer", layoutWeight: Math.max(1, Math.round((1 - ratio) * 100)) },
        ],
      },
    ],
  } as DomNode, options);
}

/**
 * heatmap — NxM grid of cells colored by value. Linear interpolation
 * on a color scale. Use for time × category, A/B matrices, activity
 * patterns. Not suitable for >12×12 (cells become unreadable).
 */
export function heatmap(
  slideId: string,
  id: string,
  options: {
    xLabels: string[];
    yLabels: string[];
    values: number[][]; // [row][col] = values[y][x]
    palette?: "warm" | "cool" | "diverging";
    showValues?: boolean;
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const xLabels = (options.xLabels || []).slice(0, 12);
  const yLabels = (options.yLabels || []).slice(0, 12);
  const palette = options.palette === "warm" ? "warm" : options.palette === "diverging" ? "diverging" : "cool";
  const values = options.values || [];
  const flat = values.flat().filter((v) => typeof v === "number");
  const min = flat.length ? Math.min(...flat) : 0;
  const max = flat.length ? Math.max(...flat) : 1;
  const range = max - min || 1;
  const showValues = options.showValues !== false && xLabels.length <= 8 && yLabels.length <= 8;
  // Header row: empty corner + xLabels
  const cellGap = 0.04;
  const headerRow: DomNode[] = [
    { id: `${slideId}.${id}.h0`, type: "spacer", fixedHeight: 0.45 },
    ...xLabels.map((lbl, x) => ({
      id: `${slideId}.${id}.hx${x}`,
      type: "text" as const,
      text: lbl,
      style: "label",
      color: "text.muted",
      align: "center" as const,
      valign: "middle" as const,
      autoFit: "shrink" as const,
      minHeight: 0.4,
    })),
  ];
  const dataRows: DomNode[] = [];
  for (let y = 0; y < yLabels.length; y++) {
    dataRows.push({
      id: `${slideId}.${id}.r${y}.lbl`,
      type: "text",
      text: yLabels[y]!,
      style: "label",
      color: "text.muted",
      align: "right",
      valign: "middle",
      autoFit: "shrink",
      minHeight: 0.4,
    });
    for (let x = 0; x < xLabels.length; x++) {
      const v = values[y]?.[x] ?? 0;
      const t = (v - min) / range;
      const fill = heatmapColor(palette, t);
      dataRows.push(showValues ? {
        id: `${slideId}.${id}.c${y}.${x}`,
        type: "text",
        text: String(v),
        style: "caption",
        color: t > 0.6 ? "text.inverse" : "text.primary",
        fill,
        align: "center",
        valign: "middle",
        cornerRadius: 0.05,
        minHeight: 0.5,
        autoFit: "shrink",
      } : {
        id: `${slideId}.${id}.c${y}.${x}`,
        type: "shape",
        preset: "rect",
        fill,
        line: fill,
        cornerRadius: 0.05,
      });
    }
  }
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "grid",
    columns: xLabels.length + 1,
    gap: cellGap,
    role: "heatmap",
    children: [...headerRow, ...dataRows],
  } as DomNode, options);
}

function heatmapColor(palette: "warm" | "cool" | "diverging", t: number): string {
  // t ∈ [0..1]. Returns 6-char hex.
  t = Math.max(0, Math.min(1, t));
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
  const hex = (r: number, g: number, b: number) => [r, g, b].map((n) => n.toString(16).padStart(2, "0").toUpperCase()).join("");
  if (palette === "warm") {
    // pale yellow → orange → red
    return hex(lerp(255, 178), lerp(247, 24), lerp(220, 43));
  }
  if (palette === "diverging") {
    // blue → white → red
    if (t < 0.5) {
      const u = t * 2;
      const lerp2 = (a: number, b: number) => Math.round(a + (b - a) * u);
      return hex(lerp2(33, 247), lerp2(102, 247), lerp2(172, 247));
    }
    const u = (t - 0.5) * 2;
    const lerp2 = (a: number, b: number) => Math.round(a + (b - a) * u);
    return hex(lerp2(247, 178), lerp2(247, 24), lerp2(247, 43));
  }
  // cool (default): pale cyan → deep blue
  return hex(lerp(247, 33), lerp(252, 102), lerp(253, 172));
}

/**
 * matrix-2x2 — 2×2 quadrant matrix with labeled axes and item bubbles
 * placed in quadrants. Use for risk-matrix (impact×probability),
 * priority (effort×value), Boston matrix, etc. Different from
 * swot-matrix which is fixed S/W/O/T semantics.
 */
export function matrix2x2(
  slideId: string,
  id: string,
  options: {
    xAxis: { low: string; high: string };
    yAxis: { low: string; high: string };
    items: Array<{ label: string; x: "low" | "high"; y: "low" | "high"; tone?: "brand" | "positive" | "warning" | "danger" }>;
    quadrantLabels?: { tl?: string; tr?: string; bl?: string; br?: string };
    quadrantTones?: { tl?: "brand" | "positive" | "warning" | "danger" | "neutral"; tr?: "brand" | "positive" | "warning" | "danger" | "neutral"; bl?: "brand" | "positive" | "warning" | "danger" | "neutral"; br?: "brand" | "positive" | "warning" | "danger" | "neutral" };
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const items = options.items || [];
  // Group items by quadrant — stack item labels inside each quadrant.
  const quadrants: Record<"tl" | "tr" | "bl" | "br", Array<{ label: string; tone: string }>> = { tl: [], tr: [], bl: [], br: [] };
  for (const it of items) {
    const key = `${it.y === "high" ? "t" : "b"}${it.x === "low" ? "l" : "r"}` as "tl" | "tr" | "bl" | "br";
    const tone = it.tone || "brand";
    quadrants[key]!.push({ label: it.label, tone });
  }
  const ql = options.quadrantLabels || {};
  const qt = options.quadrantTones || {};
  // Label-only mode: when no items are placed, the quadrantLabels become the
  // primary content of each cell — render them at section-title weight on a
  // tinted surface so the matrix communicates the four-quadrant story even
  // without per-item dots. Default per-quadrant tones differentiate the
  // cells visually (BCG / 2x2 priority conventions): top-right is the
  // headline quadrant (positive), top-left and bottom-right are caveats
  // (warning), bottom-left is the de-prioritized cell (neutral). Authors
  // override via quadrantTones.
  const labelOnly = items.length === 0;
  const tintFor = (tone: string | undefined): { fill: string; ink: string; line: string } => {
    if (tone === "positive") return { fill: "success.tint", ink: "success", line: "success" };
    if (tone === "warning") return { fill: "warning.tint", ink: "warning", line: "warning" };
    if (tone === "danger") return { fill: "danger.tint", ink: "danger", line: "danger" };
    if (tone === "neutral") return { fill: "surface.subtle", ink: "text.primary", line: "divider" };
    if (tone === "brand") return { fill: "brand.tint", ink: "brand.primary", line: "brand.primary" };
    return { fill: "surface.subtle", ink: "text.primary", line: "divider" };
  };
  const defaultLabelTone: Record<"tl" | "tr" | "bl" | "br", string> = {
    tl: "warning",
    tr: "positive",
    bl: "neutral",
    br: "warning",
  };
  const renderQuadrant = (key: "tl" | "tr" | "bl" | "br", qLabel?: string): DomNode => {
    const cellTone = qt[key] || (labelOnly ? defaultLabelTone[key] : undefined);
    const tint = labelOnly ? tintFor(cellTone) : { fill: "surface.subtle", ink: "text.primary", line: "divider" };
    return {
      id: `${slideId}.${id}.${key}`,
      type: "card",
      fill: tint.fill,
      line: tint.line,
      padding: 0.4,
      elevation: "flat",
      children: [{
        id: `${slideId}.${id}.${key}.stack`,
        type: "stack",
        direction: "vertical",
        gap: 0.15,
        align: labelOnly ? "center" as const : "start" as const,
        valign: labelOnly ? "middle" as const : "top" as const,
        children: [
          ...(qLabel ? [{
            id: `${slideId}.${id}.${key}.qlabel`,
            type: "text" as const,
            text: qLabel,
            style: labelOnly ? "section-title" : "label",
            color: labelOnly ? tint.ink : "text.muted",
            tracking: labelOnly ? undefined : "wide" as const,
            weight: labelOnly ? "semibold" as const : undefined,
            align: labelOnly ? "center" as const : "left" as const,
            minHeight: labelOnly ? 0.6 : 0.32,
            autoFit: "shrink" as const,
          }] : []),
          ...quadrants[key]!.map((it, idx) => {
            const tone = it.tone;
            const fill = tone === "positive" ? "success.tint" : tone === "warning" ? "warning.tint" : tone === "danger" ? "danger.tint" : "brand.tint";
            const color = tone === "positive" ? "success" : tone === "warning" ? "warning" : tone === "danger" ? "danger" : "brand.primary";
            return {
              id: `${slideId}.${id}.${key}.${idx}`,
              type: "text" as const,
              text: it.label,
              style: "label",
              weight: "semibold" as const,
              color,
              fill,
              align: "left" as const,
              cornerRadius: 0.08,
              minHeight: 0.45,
              autoFit: "shrink" as const,
            };
          }),
        ],
      }],
    } as unknown as DomNode;
  };
  // Y-axis labels rendered as a thin tinted band so they read as axis bands
  // rather than free-floating muted text. Previously a 4-char Chinese label
  // on a 22cm row read as a tiny caption that disappeared. The band uses
  // `surface.subtle` (not brand.tint) so it doesn't compete with quadrant
  // cards in label-only mode where the cells themselves are tone-tinted.
  const yAxisBand = (text: string, idSuffix: string): DomNode => ({
    id: `${slideId}.${id}.${idSuffix}`,
    type: "panel",
    fill: "surface.subtle",
    line: "divider",
    cornerRadius: 0.08,
    padding: 0.10,
    children: [{
      id: `${slideId}.${id}.${idSuffix}.text`,
      type: "text",
      text,
      style: "label",
      weight: "semibold",
      color: "text.primary",
      align: "center",
      tracking: "wide",
      minHeight: 0.36,
      autoFit: "shrink",
    }],
  } as unknown as DomNode);
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.18,
    role: "matrix-2x2",
    children: [
      yAxisBand(options.yAxis.high, "yhi"),
      {
        id: `${slideId}.${id}.grid`,
        type: "grid",
        columns: 2,
        gap: 0.25,
        layoutWeight: 1,
        children: [
          renderQuadrant("tl", ql.tl),
          renderQuadrant("tr", ql.tr),
          renderQuadrant("bl", ql.bl),
          renderQuadrant("br", ql.br),
        ],
      },
      yAxisBand(options.yAxis.low, "ylo"),
      // x-axis labels row
      {
        id: `${slideId}.${id}.x-axis`,
        type: "stack",
        direction: "horizontal",
        gap: 0.4,
        children: [
          { id: `${slideId}.${id}.xlo`, type: "text", text: options.xAxis.low, style: "label", color: "text.muted", align: "left", tracking: "wide", layoutWeight: 1, minHeight: 0.32, autoFit: "shrink" },
          { id: `${slideId}.${id}.xhi`, type: "text", text: options.xAxis.high, style: "label", color: "text.muted", align: "right", tracking: "wide", layoutWeight: 1, minHeight: 0.32, autoFit: "shrink" },
        ],
      },
    ],
  } as DomNode, options);
}

/**
 * trend-line — minimal sparkline visualization. A horizontal sequence
 * of bars whose height reflects the values, used as decoration next
 * to a metric or beneath a heading.
 */
export function trendLine(
  slideId: string,
  id: string,
  options: {
    values: number[];
    tone?: "brand" | "positive" | "warning" | "danger";
    height?: number;
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const values = (options.values || []).slice(0, 24);
  const max = values.length ? Math.max(...values) : 1;
  const min = values.length ? Math.min(...values) : 0;
  const range = max - min || 1;
  const tone = options.tone || "brand";
  const fillToken = tone === "brand" ? "brand.primary" : tone === "positive" ? "success" : tone === "warning" ? "warning" : "danger";
  const height = typeof options.height === "number" && options.height > 0 ? options.height : 1.0;
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "horizontal",
    gap: 0.05,
    role: "trend-line",
    fixedHeight: height,
    align: "stretch",
    valign: "bottom",
    children: values.map((v, idx) => {
      const ratio = Math.max(0.05, (v - min) / range);
      return {
        id: `${slideId}.${id}.${idx}`,
        type: "shape",
        preset: "rect",
        fill: fillToken,
        line: fillToken,
        layoutWeight: 1,
        fixedHeight: Math.max(0.1, height * ratio),
      };
    }),
  } as DomNode, options);
}

/**
 * stat-flow — horizontal sequence of stat blocks connected by
 * operator/connector text. Use for unit-economics derivation, formula
 * walkthroughs, KPI cause-effect chains.
 */
export function statFlow(
  slideId: string,
  id: string,
  options: {
    steps: Array<
      | { value: string; label: string; tone?: "brand" | "positive" | "warning" | "danger" | "neutral" }
      | { connector: string }
    >;
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const steps = (options.steps || []).slice(0, 10);
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "horizontal",
    gap: 0.3,
    role: "stat-flow",
    align: "center",
    valign: "middle",
    children: steps.map((step, idx) => {
      if ("connector" in step) {
        return {
          id: `${slideId}.${id}.${idx}.connector`,
          type: "text",
          text: step.connector,
          style: "card-title",
          color: "text.muted",
          align: "center",
          valign: "middle",
          fixedWidth: Math.max(1.2, step.connector.length * 0.4),
          autoFit: "shrink",
        };
      }
      const tone = step.tone || "neutral";
      const valueColor = tone === "positive" ? "success" : tone === "warning" ? "warning" : tone === "danger" ? "danger" : tone === "brand" ? "brand.primary" : "text.primary";
      return {
        id: `${slideId}.${id}.${idx}`,
        type: "stack",
        direction: "vertical",
        gap: 0.08,
        align: "center",
        valign: "middle",
        layoutWeight: 1,
        children: [
          { id: `${slideId}.${id}.${idx}.value`, type: "text", text: step.value, style: "metric-value", color: valueColor, align: "center", autoFit: "shrink", minHeight: 0.85 },
          { id: `${slideId}.${id}.${idx}.label`, type: "text", text: step.label, style: "metric-label", color: "text.muted", align: "center", minHeight: 0.32, autoFit: "shrink", optional: true },
        ],
      };
    }),
  } as DomNode, options);
}

/**
 * donut-summary — primary share + remainder legend. Use for "X% from Y"
 * stories where one slice dominates and 2-4 minor slices form a
 * legend. Different from chart-card pie which renders all slices
 * equally.
 */
export function donutSummary(
  slideId: string,
  id: string,
  options: {
    primary: { label: string; value: number };
    others?: Array<{ label: string; value: number }>;
    unit?: string;
    tone?: "brand" | "positive" | "warning" | "danger";
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const primary = options.primary;
  const others = (options.others || []).slice(0, 5);
  const unit = options.unit || "";
  const tone = options.tone || "brand";
  const accent = tone === "brand" ? "brand.primary" : tone === "positive" ? "success" : tone === "warning" ? "warning" : "danger";
  const allValues = [primary.value, ...others.map((o) => o.value)];
  const total = allValues.reduce((a, b) => a + b, 0) || 1;
  const entries = [primary, ...others];
  const palette = [
    accent,
    "text.muted",
    "brand.tint",
    "warning.tint",
    "success.tint",
    "danger.tint",
  ];
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "grid",
    columns: 2,
    gap: 0.5,
    role: "donut-summary",
    children: [
      // Left: ring with center number
      {
        id: `${slideId}.${id}.ring`,
        type: "stack",
        direction: "vertical",
        gap: 0.12,
        align: "center",
        valign: "middle",
        children: [
          {
            id: `${slideId}.${id}.chart`,
            type: "chart",
            chartType: "doughnut",
            labels: entries.map((entry) => entry.label),
            series: [{ name: primary.label, values: entries.map((entry) => entry.value) }],
            colors: palette.slice(0, entries.length),
            showLegend: false,
            showValues: false,
            layoutWeight: 1,
            minHeight: 2.2,
          },
          { id: `${slideId}.${id}.value`, type: "text", text: `${Math.round((primary.value / total) * 100)}%`, style: "hero", color: accent, align: "center", autoFit: "shrink", minHeight: 0.95 },
          { id: `${slideId}.${id}.label`, type: "text", text: primary.label, style: "card-title", color: "text.primary", align: "center", autoFit: "shrink", minHeight: 0.55 },
          ...(unit ? [{ id: `${slideId}.${id}.unit`, type: "text" as const, text: unit, style: "source-note", color: "text.muted", align: "center" as const, autoFit: "shrink" as const, optional: true }] : []),
        ],
      },
      // Right: legend of primary + others
      {
        id: `${slideId}.${id}.legend`,
        type: "stack",
        direction: "vertical",
        gap: 0.18,
        valign: "middle",
        children: entries.map((entry, idx) => {
          const isPrimary = idx === 0;
          const dotColor = isPrimary ? accent : palette[idx % palette.length];
          const pct = Math.round((entry.value / total) * 100);
          return {
            id: `${slideId}.${id}.legend.${idx}`,
            type: "stack",
            direction: "horizontal",
            gap: 0.25,
            align: "start",
            valign: "middle",
            children: [
              { id: `${slideId}.${id}.legend.${idx}.dot`, type: "shape", preset: "ellipse", fill: dotColor, line: dotColor, fixedWidth: 0.4, fixedHeight: 0.4 },
              { id: `${slideId}.${id}.legend.${idx}.label`, type: "text", text: `${entry.label} · ${pct}%`, style: "label", color: "text.primary", align: "left", layoutWeight: 1, valign: "middle", autoFit: "shrink" },
            ],
          };
        }),
      },
    ],
  } as DomNode, options);
}

/**
 * range-plot — horizontal range bars showing min..max (and optional
 * mid-point) per category. Use for salary bands, confidence intervals,
 * price ranges.
 */
export function rangePlot(
  slideId: string,
  id: string,
  options: {
    items: Array<{ label: string; min: number; max: number; point?: number; unit?: string }>;
    tone?: "brand" | "positive" | "warning" | "danger";
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const items = (options.items || []).slice(0, 8);
  const globalMin = items.length ? Math.min(...items.map((i) => i.min)) : 0;
  const globalMax = items.length ? Math.max(...items.map((i) => i.max)) : 1;
  const range = globalMax - globalMin || 1;
  const tone = options.tone || "brand";
  const fillToken = tone === "brand" ? "brand.primary" : tone === "positive" ? "success" : tone === "warning" ? "warning" : "danger";
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.35,
    role: "range-plot",
    children: items.map((item, idx) => {
      const startRatio = (item.min - globalMin) / range;
      const widthRatio = (item.max - item.min) / range;
      const beforeRatio = startRatio;
      const afterRatio = Math.max(0.001, 1 - startRatio - widthRatio);
      const pointRatio = typeof item.point === "number" ? (item.point - globalMin) / range : -1;
      return {
        id: `${slideId}.${id}.${idx}`,
        type: "stack",
        direction: "vertical",
        gap: 0.08,
        children: [
          { id: `${slideId}.${id}.${idx}.label`, type: "text", text: `${item.label}: ${item.min}–${item.max}${item.unit || ""}${typeof item.point === "number" ? ` (mid ${item.point}${item.unit || ""})` : ""}`, style: "label", color: "text.primary", align: "left", minHeight: 0.4, autoFit: "shrink" },
          {
            id: `${slideId}.${id}.${idx}.bar`,
            type: "stack",
            direction: "horizontal",
            gap: 0,
            fixedHeight: 0.3,
            children: [
              { id: `${slideId}.${id}.${idx}.b.before`, type: "spacer", layoutWeight: Math.max(1, Math.round(beforeRatio * 100)) },
              { id: `${slideId}.${id}.${idx}.b.range`, type: "shape", preset: "roundRect", fill: fillToken, cornerRadius: 0.5, layoutWeight: Math.max(5, Math.round(widthRatio * 100)), fixedHeight: 0.3 },
              { id: `${slideId}.${id}.${idx}.b.after`, type: "spacer", layoutWeight: Math.max(1, Math.round(afterRatio * 100)) },
            ],
          },
          ...(pointRatio >= 0 ? [{
            id: `${slideId}.${id}.${idx}.pointer-row`,
            type: "stack",
            direction: "horizontal",
            gap: 0,
            fixedHeight: 0.18,
            children: [
              { id: `${slideId}.${id}.${idx}.p.l`, type: "spacer", layoutWeight: Math.max(1, Math.round(pointRatio * 100)) },
              { id: `${slideId}.${id}.${idx}.p.dot`, type: "shape", preset: "ellipse", fill: "text.primary", line: "text.primary", fixedWidth: 0.18, fixedHeight: 0.18 },
              { id: `${slideId}.${id}.${idx}.p.r`, type: "spacer", layoutWeight: Math.max(1, Math.round((1 - pointRatio) * 100)) },
            ],
          }] : []),
        ],
      };
    }),
  } as DomNode, options);
}

/* ============================================================
   DECORATION COMPONENTS
   ============================================================ */

/**
 * callout-marker — anchored bubble with text. Floats over slide content
 * (positioned via anchor). Use to point at a specific region of an
 * image, chart, or hero element.
 */
export function calloutMarker(
  slideId: string,
  id: string,
  options: {
    text: string;
    anchor?: "top-left" | "top-center" | "top-right" | "middle-left" | "middle-center" | "middle-right" | "bottom-left" | "bottom-center" | "bottom-right";
    tone?: "brand" | "positive" | "warning" | "danger" | "neutral";
    width?: number;
    height?: number;
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const tone = options.tone || "brand";
  const fillToken = tone === "brand" ? "brand.primary" : tone === "positive" ? "success" : tone === "warning" ? "warning" : tone === "danger" ? "danger" : "surface";
  const fgToken = tone === "neutral" ? "text.primary" : "text.inverse";
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "text",
    text: options.text,
    style: "label",
    weight: "bold",
    color: fgToken,
    fill: fillToken,
    align: "center",
    valign: "middle",
    cornerRadius: 0.15,
    role: "callout-marker",
    anchor: options.anchor || "top-right",
    width: options.width || 4,
    height: options.height || 1.2,
  } as unknown as DomNode, options);
}

/**
 * decoration-grid — geometric pattern background (dots, diagonals,
 * grid lines). Use as cover slide texture or section-break decoration.
 */
export function decorationGrid(
  slideId: string,
  id: string,
  options: {
    pattern?: "dots" | "diagonal-lines" | "grid";
    density?: "sparse" | "normal" | "dense";
    tone?: "muted" | "brand";
    rows?: number;
    columns?: number;
    /** When true (default), the grid is rendered as a slide-anchored
     *  background overlay (zIndex < 0) that sits behind content rather
     *  than competing for content space. Pass false to embed inline. */
    asBackground?: boolean;
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const pattern = options.pattern === "diagonal-lines" || options.pattern === "grid" ? options.pattern : "dots";
  const density = options.density === "sparse" ? "sparse" : options.density === "dense" ? "dense" : "normal";
  const rows = options.rows && options.rows > 0 ? options.rows : (density === "sparse" ? 5 : density === "dense" ? 12 : 8);
  const cols = options.columns && options.columns > 0 ? options.columns : (density === "sparse" ? 8 : density === "dense" ? 18 : 12);
  const tone = options.tone === "brand" ? "brand.tint" : "divider";
  // Background texture must read as texture, not as a set of content marks.
  // Keep default dots below 4pt and bind muted tone to divider instead of
  // text.muted so cover patterns do not become dark visible blocks.
  const dotSize = pattern === "dots"
    ? (density === "sparse" ? 0.12 : density === "dense" ? 0.08 : 0.10)
    : pattern === "diagonal-lines"
      ? 0.04
      : 0.08;
  const dotPreset: "ellipse" | "line" | "rect" = pattern === "dots" ? "ellipse" : pattern === "diagonal-lines" ? "line" : "rect";
  const cells: DomNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({
      id: `${slideId}.${id}.${r}.${c}`,
      type: "stack",
      direction: "vertical",
      gap: 0,
      align: "center",
      valign: "middle",
      optional: true,
      children: [{
          id: `${slideId}.${id}.${r}.${c}.dot`,
          type: "shape",
          preset: dotPreset,
          fill: tone,
          line: tone,
          fixedWidth: pattern === "diagonal-lines" ? 0.6 : dotSize,
          fixedHeight: pattern === "diagonal-lines" ? 0.04 : dotSize,
        }],
      });
    }
  }
  const grid: DomNode = {
    id: `${slideId}.${id}`,
    type: "grid",
    columns: cols,
    gap: density === "sparse" ? 0.5 : density === "dense" ? 0.2 : 0.32,
    role: "decoration-grid",
    children: cells,
  };
  // Default to background overlay so the decoration doesn't eat content
  // space. Agents can opt out with asBackground:false to embed inline
  // (e.g. as a designed band between content blocks). The fillSlide
  // sentinel lets the renderer expand the overlay to the actual canvas
  // dimensions (16:9, 4:3, or wide), instead of hardcoded 25.4×14.29.
  const isBackground = options.asBackground !== false;
  if (isBackground) {
    grid.anchor = "top-left";
    grid.offsetX = 0;
    grid.offsetY = 0;
    grid.fillSlide = true;
    grid.zIndex = -1;
  }
  return applyAgentSurface(grid, options);
}

/**
 * decorative-shapes — anchored vector motif made of lightweight shapes.
 * Use for background texture, corner ornaments, confetti, bubbles, abstract
 * blobs, or simple science/tech atmosphere without requiring generated images.
 */
export function decorativeShapes(
  slideId: string,
  id: string,
  options: {
    motif?: "bubbles" | "confetti" | "corner-blobs" | "sparkles" | "molecule";
    anchor?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "full";
    tone?: "muted" | "brand" | "accent" | "warning";
    count?: number;
    width?: number;
    height?: number;
    asBackground?: boolean;
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const motif = options.motif || "bubbles";
  const anchor = options.anchor || "top-right";
  const tone = options.tone || "muted";
  const count = Math.max(3, Math.min(40, Math.floor(options.count || (anchor === "full" ? 24 : motif === "corner-blobs" ? 6 : 12))));
  const columns = anchor === "full" ? Math.ceil(Math.sqrt(count * 1.7)) : Math.ceil(Math.sqrt(count * 1.4));
  const rows = Math.ceil(count / columns);
  const palette = decorativePalette(tone);
  const children: DomNode[] = Array.from({ length: count }, (_, index) => {
    const preset = decorativePreset(motif, index);
    const size = decorativeSize(motif, index);
    const token = palette[index % palette.length]!;
    const rotation = motif === "confetti" ? ((index % 5) - 2) * 17 : motif === "sparkles" ? (index % 2) * 18 : undefined;
    return {
      id: `${slideId}.${id}.${index}`,
      type: "stack",
      direction: "vertical",
      gap: 0,
      align: "center",
      valign: "middle",
      optional: true,
      children: [{
        id: `${slideId}.${id}.${index}.mark`,
        type: "shape",
        preset,
        fill: preset === "line" ? undefined : token,
        line: token,
        lineWidth: preset === "line" ? 0.035 : 0.018,
        fixedWidth: preset === "line" ? size * 1.8 : size,
        fixedHeight: preset === "line" ? 0.04 : size,
        ...(rotation !== undefined ? { rotation } : {}),
      }],
    };
  });
  const isFull = anchor === "full";
  const asBackground = options.asBackground !== false;
  const node: DomNode = {
    id: `${slideId}.${id}`,
    type: "grid",
    columns,
    rows,
    gap: motif === "corner-blobs" ? 0.1 : anchor === "full" ? 0.35 : 0.22,
    role: "decorative-shapes",
    children,
    anchor: isFull ? "top-left" : anchor,
    width: isFull ? undefined : options.width || 5.2,
    height: isFull ? undefined : options.height || 3.4,
    offsetX: isFull ? 0 : 0.35,
    offsetY: isFull ? 0 : 0.35,
    ...(isFull ? { fillSlide: true } : {}),
    zIndex: asBackground ? -1 : 2,
  };
  return applyAgentSurface(node, options);
}

function decorativePalette(tone: "muted" | "brand" | "accent" | "warning"): string[] {
  if (tone === "brand") return ["brand.primary", "brand.tint", "divider"];
  if (tone === "accent") return ["accent", "brand.primary", "success", "warning"];
  if (tone === "warning") return ["warning", "danger", "accent"];
  return ["divider", "text.muted", "surface.subtle"];
}

function decorativePreset(motif: string, index: number): "ellipse" | "rect" | "triangle" | "star-5" | "line" | "cloud" {
  if (motif === "confetti") return (["rect", "triangle", "line", "star-5"] as const)[index % 4]!;
  if (motif === "sparkles") return index % 3 === 0 ? "star-5" : "ellipse";
  if (motif === "molecule") return index % 4 === 3 ? "line" : "ellipse";
  if (motif === "corner-blobs") return index % 5 === 0 ? "cloud" : "ellipse";
  return "ellipse";
}

function decorativeSize(motif: string, index: number): number {
  if (motif === "corner-blobs") return [1.1, 0.75, 0.55, 0.9, 0.42, 0.65][index % 6]!;
  if (motif === "confetti") return [0.22, 0.3, 0.45, 0.26][index % 4]!;
  if (motif === "sparkles") return [0.32, 0.16, 0.22][index % 3]!;
  if (motif === "molecule") return [0.28, 0.18, 0.24, 0.5][index % 4]!;
  return [0.22, 0.34, 0.16, 0.42][index % 4]!;
}

/**
 * corner-mark — small ribbon/stamp/tag in a slide corner. Use for
 * draft markers, version labels, status badges that should not
 * compete with main content.
 */
export function cornerMark(
  slideId: string,
  id: string,
  options: {
    text: string;
    corner?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    tone?: "brand" | "warning" | "danger" | "neutral";
    style?: "ribbon" | "stamp" | "tag";
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const tone = options.tone || "warning";
  const fillToken = tone === "brand" ? "brand.primary" : tone === "warning" ? "warning" : tone === "danger" ? "danger" : "text.muted";
  const corner = options.corner || "top-right";
  const style = options.style || "tag";
  // Estimate width per char
  let width = 0.7;
  for (const ch of options.text) width += /[\u4e00-\u9fff]/.test(ch) ? 0.5 : 0.18;
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "text",
    text: options.text,
    style: "label",
    weight: "bold",
    uppercase: style !== "ribbon",
    letterSpacing: 80,
    color: "text.inverse",
    fill: fillToken,
    align: "center",
    valign: "middle",
    cornerRadius: style === "ribbon" ? 0 : style === "stamp" ? 0.2 : 0.08,
    fixedHeight: 0.7,
    fixedWidth: Math.max(2, Math.min(6, width)),
    role: "corner-mark",
    anchor: corner,
  } as unknown as DomNode, options);
}

/**
 * brand-mark — small brand/source label anchored to a slide corner.
 * Use for unobtrusive customer/source marks such as "Youdao" in a footer.
 */
export function brandMark(
  slideId: string,
  id: string,
  options: {
    text: string;
    corner?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    tone?: "muted" | "neutral" | "inverse" | "brand";
    width?: number;
    height?: number;
    offsetX?: number;
    offsetY?: number;
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const corner = options.corner || "bottom-right";
  const tone = options.tone || "muted";
  const color = tone === "inverse" ? "text.inverse"
    : tone === "brand" ? "brand.primary"
      : tone === "neutral" ? "text.secondary"
        : "text.muted";
  const align = corner.endsWith("-right") ? "right" : "left";
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "text",
    text: options.text,
    style: "label",
    color,
    align,
    valign: "middle",
    autoFit: "shrink",
    role: "brand-mark",
    anchor: corner,
    width: options.width || 3.2,
    height: options.height || 0.45,
    offsetX: options.offsetX ?? 0.75,
    offsetY: options.offsetY ?? 0.55,
    zIndex: 5,
  } as DomNode, options);
}

/**
 * bracket — geometric brace/bracket emphasizing a group of elements.
 * Renders a thin shape on one side; agents pair it with content via
 * sibling layout.
 */
export function bracket(
  slideId: string,
  id: string,
  options: {
    direction?: "left" | "right" | "top" | "bottom";
    label?: string;
    tone?: "brand" | "positive" | "warning" | "danger";
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const direction = options.direction === "right" || options.direction === "top" || options.direction === "bottom" ? options.direction : "left";
  const tone = options.tone || "brand";
  const lineColor = tone === "brand" ? "brand.primary" : tone === "positive" ? "success" : tone === "warning" ? "warning" : "danger";
  const isHorizontal = direction === "top" || direction === "bottom";
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction: isHorizontal ? "vertical" : "horizontal",
    gap: 0.25,
    role: "bracket",
    align: "center",
    valign: "middle",
    children: [
      {
        id: `${slideId}.${id}.line`,
        type: "shape",
        preset: "rect",
        fill: lineColor,
        line: lineColor,
        cornerRadius: 0.5,
        ...(isHorizontal ? { fixedHeight: 0.06, fixedWidth: 5 } : { fixedWidth: 0.06, fixedHeight: 5 }),
      },
      ...(options.label && options.label.trim() ? [{
        id: `${slideId}.${id}.label`,
        type: "text" as const,
        text: options.label.trim(),
        style: "label",
        // The bracket LINE carries the tone; the label stays
        // text.primary so it always reads on light surfaces. Tone-
        // colored labels (success/warning/brand on light bg) repeatedly
        // failed 4.5:1 and got LOW_CONTRAST'd to a sibling accent,
        // disconnecting the label from the bracket. Same pattern as
        // bar-list / progressBar value fix.
        color: "text.primary",
        align: isHorizontal ? "center" as const : "left" as const,
        valign: "middle" as const,
        minHeight: 0.4,
        autoFit: "shrink" as const,
      }] : []),
    ],
  } as DomNode, options);
}

/**
 * arrow-link — single directional connector between two entities.
 * MVP: inline horizontal arrow with optional label. Cross-element
 * absolute positioning is not yet supported.
 */
export function arrowLink(
  slideId: string,
  id: string,
  options: {
    fromLabel?: string;
    toLabel?: string;
    label?: string;
    direction?: "right" | "down";
    tone?: "brand" | "positive" | "warning" | "danger";
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const tone = options.tone || "brand";
  const accent = tone === "brand" ? "brand.primary" : tone === "positive" ? "success" : tone === "warning" ? "warning" : "danger";
  const direction = options.direction === "down" ? "down" : "right";
  const arrowPreset = direction === "down" ? "arrow-down" : "arrow-right";
  const children: DomNode[] = [];
  if (options.fromLabel) {
    children.push({
      id: `${slideId}.${id}.from`,
      type: "text",
      text: options.fromLabel,
      style: "card-title",
      color: "text.primary",
      align: direction === "right" ? "right" : "center",
      valign: "middle",
      autoFit: "shrink",
      minHeight: 0.5,
      layoutWeight: 1,
    });
  }
  children.push({
    id: `${slideId}.${id}.arrow`,
    type: "stack",
    direction: "vertical",
    gap: 0.04,
    align: "center",
    valign: "middle",
    children: [
      ...(options.label ? [{
        id: `${slideId}.${id}.label`,
        type: "text" as const,
        text: options.label,
        style: "label",
        color: accent,
        align: "center" as const,
        autoFit: "shrink" as const,
        minHeight: 0.32,
      }] : []),
      {
        id: `${slideId}.${id}.shape`,
        type: "shape",
        preset: arrowPreset,
        fill: accent,
        line: accent,
        fixedWidth: direction === "right" ? 2.0 : 0.8,
        fixedHeight: direction === "right" ? 0.6 : 1.2,
      },
    ],
  });
  if (options.toLabel) {
    children.push({
      id: `${slideId}.${id}.to`,
      type: "text",
      text: options.toLabel,
      style: "card-title",
      color: "text.primary",
      align: direction === "right" ? "left" : "center",
      valign: "middle",
      autoFit: "shrink",
      minHeight: 0.5,
      layoutWeight: 1,
    });
  }
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction: direction === "right" ? "horizontal" : "vertical",
    gap: 0.3,
    role: "arrow-link",
    align: "center",
    valign: "middle",
    children,
  } as DomNode, options);
}

/**
 * pointer-arrow — anchored overlay arrow for pointing at specific chart,
 * image, or diagram regions. Unlike arrow-link, it does not take layout
 * space in the main flow.
 */
export function pointerArrow(
  slideId: string,
  id: string,
  options: {
    label?: string;
    direction?: "right" | "left" | "down" | "up";
    anchor?: "top-left" | "top-center" | "top-right" | "middle-left" | "middle-center" | "middle-right" | "bottom-left" | "bottom-center" | "bottom-right";
    offsetX?: number;
    offsetY?: number;
    width?: number;
    height?: number;
    tone?: "brand" | "positive" | "warning" | "danger";
    style?: "solid" | "dashed";
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const direction = options.direction || "right";
  const tone = options.tone || "brand";
  const accent = tone === "brand" ? "brand.primary" : tone === "positive" ? "success" : tone === "warning" ? "warning" : "danger";
  const horizontal = direction === "right" || direction === "left";
  const hasLabel = Boolean(options.label && options.label.trim());
  const width = Math.max(options.width || (horizontal ? 3.4 : 1.6), horizontal ? (hasLabel ? 2.2 : 1.8) : 1.2);
  const height = Math.max(options.height || (horizontal ? (hasLabel ? 1.1 : 0.75) : 2.4), horizontal ? (hasLabel ? 1.4 : 0.85) : (hasLabel ? 2.8 : 2.1));
  const arrowPreset = horizontal ? "arrow-right" : "arrow-down";
  const arrow: DomNode = {
    id: `${slideId}.${id}.shape`,
    type: "shape",
    preset: arrowPreset,
    fill: accent,
    line: accent,
    lineWidth: 0.035,
    ...(options.style === "dashed" ? { lineDash: "dash" } : {}),
    fixedWidth: horizontal ? Math.max(1.2, width - 0.3) : 0.8,
    fixedHeight: horizontal ? 0.55 : Math.max(1.2, height - (hasLabel ? 0.72 : 0.3)),
    ...(direction === "left" ? { flipH: true } : {}),
    ...(direction === "up" ? { flipV: true } : {}),
  };
  const label = hasLabel ? {
    id: `${slideId}.${id}.label`,
    type: "text" as const,
    text: (options.label ?? "").trim(),
    style: "label",
    weight: "bold",
    color: accent,
    align: "center" as const,
    valign: "middle" as const,
    autoFit: "shrink" as const,
    minHeight: 0.35,
  } : null;
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.08,
    role: "pointer-arrow",
    align: "center",
    valign: "middle",
    anchor: options.anchor || "middle-center",
    offsetX: options.offsetX || 0,
    offsetY: options.offsetY || 0,
    width,
    height,
    zIndex: 3,
    children: label ? [label, arrow] : [arrow],
  } as DomNode, options);
}

/**
 * watermark — large semi-transparent text overlay. Use for DRAFT,
 * CONFIDENTIAL, sample marks. Anchored to slide center.
 */
export function watermark(
  slideId: string,
  id: string,
  options: {
    text: string;
    rotation?: number;
    tone?: "muted" | "danger" | "warning" | "brand";
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const tone = options.tone || "muted";
  const colorToken = tone === "danger" ? "danger" : tone === "warning" ? "warning" : tone === "brand" ? "brand.primary" : "text.muted";
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "text",
    text: options.text,
    style: "hero",
    weight: "bold",
    uppercase: true,
    letterSpacing: 200,
    color: colorToken,
    align: "center",
    valign: "middle",
    role: "watermark",
    anchor: "middle-center",
    width: 18,
    height: 4,
    autoFit: "shrink",
  } as unknown as DomNode, options);
}

/**
 * big-page-number — large decorative page number for cover/section
 * slides. Different from the chrome.pageNumber footer.
 */
export function bigPageNumber(
  slideId: string,
  id: string,
  options: {
    current: number | string;
    total?: number | string;
    corner?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    tone?: "brand" | "muted";
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const corner = options.corner || "top-right";
  const tone = options.tone || "brand";
  const colorToken = tone === "brand" ? "brand.primary" : "text.muted";
  const text = options.total !== undefined && options.total !== null && options.total !== ""
    ? `${String(options.current).padStart(2, "0")} / ${String(options.total).padStart(2, "0")}`
    : String(options.current).padStart(2, "0");
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "text",
    text,
    style: "hero",
    weight: "bold",
    color: colorToken,
    align: "center",
    valign: "middle",
    role: "big-page-number",
    anchor: corner,
    width: 4.5,
    height: 1.6,
    autoFit: "shrink",
  } as unknown as DomNode, options);
}

/**
 * timeline-axis-bar — section navigation bar. Shows N section dots
 * with current section highlighted; goes at top/bottom of section
 * break slides to communicate progress through deck.
 */
export function timelineAxisBar(
  slideId: string,
  id: string,
  options: {
    sections: string[];
    current: number;
    tone?: "brand" | "neutral";
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const sections = (options.sections || []).slice(0, 8);
  const current = Math.max(0, Math.min(sections.length - 1, options.current || 0));
  const tone = options.tone || "brand";
  const accent = tone === "brand" ? "brand.primary" : "text.primary";
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "horizontal",
    gap: 0.3,
    role: "timeline-axis-bar",
    align: "stretch",
    valign: "middle",
    fixedHeight: 0.85,
    children: sections.map((label, idx) => {
      const isActive = idx === current;
      const isPast = idx < current;
      const dotColor = isActive ? accent : isPast ? accent : "divider";
      const labelColor = isActive ? accent : "text.muted";
      return {
        id: `${slideId}.${id}.${idx}`,
        type: "stack",
        direction: "vertical",
        gap: 0.1,
        align: "center",
        valign: "middle",
        layoutWeight: 1,
        children: [
          { id: `${slideId}.${id}.${idx}.dot`, type: "shape", preset: "ellipse", fill: dotColor, line: dotColor, fixedWidth: isActive ? 0.4 : 0.25, fixedHeight: isActive ? 0.4 : 0.25 },
          { id: `${slideId}.${id}.${idx}.lbl`, type: "text", text: label, style: "label", weight: isActive ? "bold" : "normal", color: labelColor, align: "center", autoFit: "shrink", minHeight: 0.32 },
        ],
      };
    }),
  } as DomNode, options);
}

/**
 * scale-bar — horizontal numeric scale with tick marks. Use as
 * companion to images/charts/diagrams for measurement context.
 */
export function scaleBar(
  slideId: string,
  id: string,
  options: {
    min?: number;
    max: number;
    unit?: string;
    ticks?: number;
    tone?: "brand" | "neutral";
  } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const min = options.min || 0;
  const max = options.max;
  const tickCount = options.ticks && options.ticks >= 2 ? options.ticks : 5;
  const tone = options.tone || "neutral";
  const lineColor = tone === "brand" ? "brand.primary" : "text.muted";
  const labels: string[] = [];
  for (let i = 0; i < tickCount; i++) {
    const v = min + ((max - min) * i) / (tickCount - 1);
    labels.push(`${Math.round(v * 100) / 100}${options.unit || ""}`);
  }
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.08,
    role: "scale-bar",
    children: [
      // tick row: short vertical bars
      {
        id: `${slideId}.${id}.ticks`,
        type: "stack",
        direction: "horizontal",
        gap: 0,
        fixedHeight: 0.3,
        children: Array.from({ length: tickCount }, (_, i) => ({
          id: `${slideId}.${id}.tick${i}`,
          type: "stack" as const,
          direction: "vertical" as const,
          gap: 0,
          layoutWeight: 1,
          align: "center" as const,
          children: [
            { id: `${slideId}.${id}.tick${i}.bar`, type: "shape" as const, preset: "rect", fill: lineColor, line: lineColor, fixedWidth: 0.04, fixedHeight: 0.3 },
          ],
        })),
      },
      // base line
      { id: `${slideId}.${id}.line`, type: "shape", preset: "rect", fill: lineColor, line: lineColor, fixedHeight: 0.04 },
      // labels
      {
        id: `${slideId}.${id}.labels`,
        type: "stack",
        direction: "horizontal",
        gap: 0,
        children: labels.map((lbl, i) => ({
          id: `${slideId}.${id}.lbl${i}`,
          type: "text" as const,
          text: lbl,
          style: "caption",
          color: "text.muted",
          align: i === 0 ? "left" as const : i === labels.length - 1 ? "right" as const : "center" as const,
          autoFit: "shrink" as const,
          minHeight: 0.32,
          layoutWeight: 1,
        })),
      },
    ],
  } as DomNode, options);
}

export function companyOverviewLayout(options: {
  slideId: string;
  visualSrc: string;
  summary: string;
  businessLines: string[];
  metrics: Array<{ name: string; value: string; label: string }>;
}): DomNode {
  return {
    id: `${options.slideId}.overviewLayout`,
    type: "grid",
    area: "content",
    columns: 2,
    gap: 0.55,
    role: "company-overview-layout",
    children: [
      {
        id: `${options.slideId}.narrativeColumn`,
        type: "stack",
        direction: "vertical",
        gap: 0.3,
        children: [
          paragraphText(options.slideId, "company-summary", options.summary),
          bulletList(options.slideId, "business-lines", options.businessLines, "compact"),
        ],
      },
      {
        id: `${options.slideId}.visualColumn`,
        type: "stack",
        direction: "vertical",
        gap: 0.35,
        children: [
          imageBlock(options.slideId, "hero-visual", options.visualSrc, "Company visual", "cover"),
          {
            id: `${options.slideId}.metricGrid`,
            type: "grid",
            columns: 3,
            gap: 0.25,
            children: options.metrics.map((metric) => metricCard(options.slideId, metric.name, metric.value, metric.label)),
          },
        ],
      },
    ],
  };
}
