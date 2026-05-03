import type { DomNode } from "./types.js";

/**
 * Agent-facing surface customization. ANY composite component accepts these
 * options as `options.surface` (or top-level shortcuts `fill`, `border`,
 * `elevation`, `accent`) and the helper below applies them to the
 * component's outer wrapper. Lets agents personalize line / color / radius
 * on every component without each component re-declaring 8 fields.
 */
export interface AgentBorder {
  color?: string;
  /** Border width in cm. */
  width?: number;
  style?: "solid" | "dash" | "dashDot" | "dot";
  radius?: number;
}

export interface AgentSurface {
  fill?: string;
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
  // Apply flat shorthand first so the object form (`surface.border:{...}`)
  // can override on conflict — the object form is the explicit-wins variant.
  if (typeof merged.borderColor === "string") out.line = merged.borderColor;
  if (typeof merged.borderWidth === "number") out.lineWidth = merged.borderWidth;
  if (merged.borderStyle && merged.borderStyle !== "solid") out.dash = merged.borderStyle;
  if (typeof merged.cornerRadius === "number") out.cornerRadius = merged.cornerRadius;
  if (merged.border && typeof merged.border === "object") {
    if (typeof merged.border.color === "string") out.line = merged.border.color;
    if (typeof merged.border.width === "number") out.lineWidth = merged.border.width;
    if (merged.border.style && merged.border.style !== "solid") out.dash = merged.border.style;
    if (typeof merged.border.radius === "number") out.cornerRadius = merged.border.radius;
  } else if (typeof merged.border === "string") {
    out.line = merged.border;
  }
  if (typeof merged.padding === "number") out.padding = merged.padding;
  if (merged.elevation) out.elevation = merged.elevation;
  if (merged.accent && merged.accent !== "none") out.accent = merged.accent;
  if (typeof merged.accentColor === "string") out.accentColor = merged.accentColor;
  if (typeof merged.accentWidth === "number") out.accentWidth = merged.accentWidth;
  return out as T;
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
  options: { unit?: string; trend?: "up" | "down" | "flat" } = {},
): DomNode {
  const trend = options.trend;
  const unit = options.unit && options.unit.trim() ? options.unit.trim() : "";
  // Trend semantics are conveyed by *coloring* the value (and label) — no
  // extra glyph, so narrow cards never have to make room for an arrow that
  // would otherwise force the value text to wrap.
  const valueColor = trend === "up" ? "success" : trend === "down" ? "danger" : trend === "flat" ? "text.muted" : "brand.primary";
  const labelColor = trend === "up" ? "success" : trend === "down" ? "danger" : "text.muted";
  // If a unit string was supplied, suffix it inline as a muted run so the
  // raw value stays the dominant character — but no separate column.
  const content: Array<Record<string, unknown>> = unit
    ? [{ text: value, color: valueColor }, { text: ` ${unit}`, color: "text.muted" }]
    : [];
  const valueNode: DomNode = {
    id: `${slideId}.${id}.value`,
    type: "text",
    text: value,
    style: "metric-value",
    color: valueColor,
    align: "center",
    valign: "bottom",
    layoutWeight: 2,
    autoFit: "shrink",
    ...(content.length > 0 ? { content } : {}),
  };
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.18,
    role: "metric-card",
    children: [
      valueNode,
      // 761q1u: 5 metric-cards in one row only get ~1cm height each;
      // making the label optional lets the layout drop it instead of
      // SQUASHED+FALLBACK_FAILED. Agents can still read the value (the
      // primary signal) on tight grids.
      { id: `${slideId}.${id}.label`, type: "text", text: label, style: "metric-label", color: labelColor, align: "center", valign: "top", layoutWeight: 1, autoFit: "shrink", optional: true },
    ],
  };
}

export function stepCard(slideId: string, id: string, step: string, title: string, body: string): DomNode {
  // umzrkm fix: step label defaulted to brand.primary, which fails 4.5:1
  // contrast on mid-saturation brand themes (e.g. teal 5B8A8A on light
  // E8F3F3 ≈ 3.4:1). Use text.primary so the label always reads; the step
  // number is still bold + prominent via the numbered-step style. Agents
  // who want a colored label can override `color` directly.
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.25,
    role: "step-card",
    children: [
      { id: `${slideId}.${id}.step`, type: "text", text: step, style: "numbered-step", color: "text.primary", minHeight: 0.42, autoFit: "shrink" },
      { id: `${slideId}.${id}.title`, type: "text", text: title, style: "card-title", minHeight: 0.65, autoFit: "shrink" },
      { id: `${slideId}.${id}.body`, type: "text", text: body, style: "caption", valign: "top" },
    ],
  };
}

export function comparisonCard(slideId: string, id: string, title: string, points: string[]): DomNode {
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.25,
    role: "comparison-card",
    children: [
      // umzrkm: use text.primary for the title; brand color is reserved
      // for accent shapes / chips. Mid-saturation brand colors fail 4.5:1.
      { id: `${slideId}.${id}.title`, type: "text", text: title, style: "card-title", color: "text.primary", minHeight: 0.6, autoFit: "shrink" },
      bulletList(slideId, `${id}-points`, points, "compact"),
    ],
  };
}

export function insightCallout(slideId: string, id: string, text: string): DomNode {
  // minHeight + autoFit: long callout text (a sentence or two) was being
  // clipped at 1.45cm. The 1.45 floor still yields a tall callout block when
  // text is short.
  return { id: `${slideId}.${id}`, type: "text", text, style: "callout", role: "callout", minHeight: 1.0, autoFit: "shrink" };
}

export function numberedList(slideId: string, id: string, items: string[], density: "comfortable" | "compact" = "comfortable"): DomNode {
  return { id: `${slideId}.${id}`, type: "bullets", items, density, numbered: true };
}

export function quoteBlock(
  slideId: string,
  id: string,
  text: string,
  source?: string,
  opts: { ornament?: boolean } & { surface?: AgentSurface } & AgentSurface = {},
): DomNode {
  // Decorative oversized opening quote glyph (❝). Reads as typographic
  // ornament without an extra image. Suppress with `ornament:false`.
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
      fixedHeight: 1.4,
      autoFit: "shrink",
    });
  }
  children.push({ id: `${slideId}.${id}.text`, type: "text", text: `\u201C${text}\u201D`, style: "quote", align: "left", valign: "middle" });
  if (source && source.trim()) {
    children.push({ id: `${slideId}.${id}.source`, type: "text", text: `\u2014 ${source.trim()}`, style: "quote-source", align: "left", minHeight: 0.4, autoFit: "shrink" });
  }
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.18,
    role: "quote",
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
export function timelineBlock(slideId: string, id: string, options: {
  items: Array<{ time?: string; title?: string; body?: string; content?: DomNode }>;
  direction?: "horizontal" | "vertical";
}): DomNode {
  const direction = options.direction === "horizontal" ? "horizontal" : "vertical";
  if (direction === "horizontal") {
    return {
      id: `${slideId}.${id}`,
      type: "grid",
      columns: Math.max(1, Math.min(5, options.items.length)),
      gap: options.items.length >= 5 ? 0.24 : 0.32,
      role: "timeline",
      children: options.items.map((item, index) => timelineStep(slideId, id, index, item, "horizontal")),
    };
  }
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.22,
    role: "timeline",
    children: options.items.map((item, index) => timelineStep(slideId, id, index, item, "vertical")),
  };
}

function timelineStep(
  slideId: string,
  id: string,
  index: number,
  item: { time?: string; title?: string; body?: string; content?: DomNode },
  direction: "horizontal" | "vertical",
): DomNode {
  // 2pmnxh fix: time/title/body all use text.primary so contrast passes
  // on any agent-supplied theme.
  const titleStyle = "card-title";

  // Stamp the content's id under the step's namespace if missing (so
  // layout / diagnostics can identify it).
  const content: DomNode | null = item.content && typeof item.content === "object"
    ? {
        ...(item.content as DomNode),
        id: typeof item.content.id === "string" && item.content.id ? item.content.id : `${slideId}.${id}.${index}.content`,
      }
    : null;

  /* ---------------- horizontal timeline (narrow cells) ---------------- */
  // Each step is its own column (~4cm wide at 5 items). Stack everything
  // vertically inside the cell: time → title → content.
  if (direction === "horizontal") {
    const children: DomNode[] = [];
    if (item.time && item.time.trim()) {
      children.push({ id: `${slideId}.${id}.${index}.time`, type: "text", text: item.time.trim(), style: "label", color: "text.primary", minHeight: 0.32, autoFit: "shrink" });
    }
    if (item.title && item.title.trim()) {
      children.push({ id: `${slideId}.${id}.${index}.title`, type: "text", text: item.title.trim(), style: titleStyle, color: "text.primary", minHeight: 0.42, autoFit: "shrink" });
    }
    if (content) {
      children.push(content);
    } else if (item.body && item.body.trim()) {
      children.push({ id: `${slideId}.${id}.${index}.body`, type: "text", text: item.body.trim(), style: "caption", color: "text.primary", valign: "top", minHeight: 0.4, autoFit: "shrink", optional: true });
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
    rightColChildren.push({ id: `${slideId}.${id}.${index}.title`, type: "text", text: item.title.trim(), style: titleStyle, color: "text.primary", minHeight: 0.5, autoFit: "shrink" });
  }
  if (content) {
    rightColChildren.push(content);
  } else if (item.body && item.body.trim()) {
    rightColChildren.push({ id: `${slideId}.${id}.${index}.body`, type: "text", text: item.body.trim(), style: "caption", color: "text.primary", valign: "top", minHeight: 0.4, autoFit: "shrink", optional: true });
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
      style: "label",
      weight: "bold",
      color: "text.primary",
      align: "left",
      valign: "top",
      // Fixed width keeps time labels aligned across rows. 2.5cm fits
      // most date strings ("2024 Q3", "March 2024", "公元前 221 年").
      fixedWidth: 2.5,
      minHeight: 0.4,
      autoFit: "shrink",
    });
  }
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
    gap: 0.4,
    role: "timeline-step",
    align: "start",
    valign: "top",
    children: rowChildren,
  };
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
    children.push({ id: `${slideId}.${id}.bio`, type: "text", text: options.bio.trim(), style: "caption", align: "center", valign: "top" });
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

export function kpiGrid(slideId: string, id: string, metrics: Array<{ name?: string; value: string; label: string; unit?: string; trend?: "up" | "down" | "flat" }>, columns?: number): DomNode {
  const cols = Math.max(1, columns || Math.min(4, metrics.length));
  return {
    id: `${slideId}.${id}`,
    type: "grid",
    columns: cols,
    gap: 0.5,
    role: "kpi-grid",
    children: metrics.map((m, index) => metricCard(slideId, m.name || `${id}-m${index + 1}`, m.value, m.label, { unit: m.unit, trend: m.trend })),
  };
}

export function sectionBreak(slideId: string, id: string, options: { title: string; subtitle?: string; accent?: string }): DomNode {
  const children: DomNode[] = [];
  // Always emit a brand-color accent rule above the title so section
  // dividers feel like a real visual break, not just centered text. The
  // rule sits above the eyebrow accent string when both are present.
  children.push({
    id: `${slideId}.${id}.rule`,
    type: "shape",
    preset: "rect",
    fill: "brand.primary",
    line: "brand.primary",
    fixedHeight: 0.08,
    fixedWidth: 4.0,
    align: "start",
  });
  if (options.accent && options.accent.trim()) {
    // The eyebrow stays brand-colored: it sits ABOVE the bold rule shape
    // which already establishes the brand-color claim. The eyebrow label
    // is short (a kicker word) so it can carry color without legibility
    // risk — but we still pick text.primary as the safer fallback when
    // the agent's brand color is muted. Agents who want a vivid eyebrow
    // can pass `color:` on the sectionBreak — but the surface here keeps
    // the safer default.
    children.push({ id: `${slideId}.${id}.accent`, type: "text", text: options.accent.trim(), style: "label", color: "text.primary", align: "left", minHeight: 0.42, autoFit: "shrink", tracking: "wide" } as DomNode);
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
    gap: 0.22,
    role: "swot-quadrant",
    children: [
      { id: `${slideId}.${id}.${qid}.title`, type: "text" as const, text: title, style: "card-title", color, minHeight: 0.55, autoFit: "shrink" as const },
      bulletList(slideId, `${id}-${qid}`, points, "compact"),
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
    role: "cta",
    ...(content ? { content } : {}),
  };
}

export function featureCard(slideId: string, id: string, options: { icon: string; title: string; body?: string; iconColor?: string; iconBackground?: string; tone?: string }): DomNode {
  const iconColor = options.iconColor || "brand.primary";
  const iconBackground = options.iconBackground || "brand.tint";
  const children: DomNode[] = [
    {
      id: `${slideId}.${id}.icon`,
      type: "shape",
      preset: options.icon || "ellipse",
      fill: iconBackground,
      line: iconColor,
      lineWidth: 0.04,
      fixedWidth: 0.95,
      fixedHeight: 0.95,
      // Without explicit align, the parent vertical stack stretches the icon
      // across the card width (cross-axis) and we get a flat banner instead
      // of a square glyph. Pin to start so fixedWidth is honored.
      align: "start",
    },
    { id: `${slideId}.${id}.title`, type: "text", text: options.title, style: "card-title", align: "left", color: options.tone || "text.primary", minHeight: 0.6, autoFit: "shrink" },
  ];
  if (options.body && options.body.trim()) {
    children.push({ id: `${slideId}.${id}.body`, type: "text", text: options.body.trim(), style: "caption", align: "left", valign: "top" });
  }
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.32,
    role: "feature-card",
    children,
  };
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
  const valueLabel = options.valueLabel || `${Math.round(ratio * 100)}%`;
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
          { id: `${slideId}.${id}.label`, type: "text", text: options.label, style: "label", align: "left", layoutWeight: 5 },
          { id: `${slideId}.${id}.value`, type: "text", text: valueLabel, style: "label", color: fillToken, align: "right", layoutWeight: 1 },
        ],
        fixedHeight: 0.5,
      },
      {
        id: `${slideId}.${id}.track`,
        type: "stack",
        direction: "horizontal",
        gap: 0,
        fixedHeight: 0.4,
        children: [
          { id: `${slideId}.${id}.fill`, type: "shape", preset: "roundRect", fill: fillToken, cornerRadius: 0.5, layoutWeight: Math.max(0.001, ratio) },
          { id: `${slideId}.${id}.empty`, type: "shape", preset: "roundRect", fill: "surface.subtle", cornerRadius: 0.5, layoutWeight: Math.max(0.001, 1 - ratio) },
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

export function processFlow(slideId: string, id: string, options: { steps: Array<{ title: string; body?: string }>; direction?: "horizontal" | "vertical" }): DomNode {
  // direction "auto" or undefined defers to layout: a hint we read at
  // measure time and flip to vertical when the flow is squeezed into a
  // narrow column.
  const direction = options.direction === "vertical" ? "vertical" : "horizontal";
  const arrow = direction === "horizontal" ? "arrow-right" : "arrow-down";
  const dense = options.steps.length >= 5;
  const items: DomNode[] = [];
  // Vertical process-flow stacks step + arrow + step + arrow ... in one column
  // and competes with the slide's slide-title placeholder for the ~10cm content
  // area. Density adapts to step count so 4-6 vertical steps fit without
  // FALLBACK_FAILED on a default deck.
  const verticalDense = direction === "vertical" && options.steps.length >= 4;
  options.steps.forEach((step, index) => {
    const stepMinHeight = direction === "horizontal"
      ? (dense ? 1.85 : 2.0)
      : (verticalDense ? 1.0 : 1.4);
    items.push({
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
      align: "center",
      valign: "middle",
      justify: "center",
      minHeight: stepMinHeight,
      children: [
        // umzrkm fix: step.title used brand.primary which fails 4.5:1 on
        // agent themes with mid-saturation brand colors (teal 5B8A8A on
        // E8F3F3 ≈ 3.4:1). Mirror the 2pmnxh fix that already moved
        // timeline-step to text.primary. The arrow shape between steps
        // still carries brand.primary so the visual claim is preserved.
        { id: `${slideId}.${id}.step${index + 1}.title`, type: "text", text: step.title, style: "card-title", color: "text.primary", align: "center", minHeight: dense || verticalDense ? 0.42 : 0.6, autoFit: "shrink" },
        ...(step.body && step.body.trim() ? [{ id: `${slideId}.${id}.step${index + 1}.body`, type: "text" as const, text: step.body.trim(), style: "caption", align: "center" as const, valign: "top" as const, minHeight: 0.4, autoFit: "shrink" as const, optional: true }] : []),
      ],
      layoutWeight: 4,
    });
    if (index < options.steps.length - 1) {
      items.push({
        id: `${slideId}.${id}.arrow${index + 1}`,
        type: "shape",
        preset: arrow,
        fill: "brand.primary",
        line: "brand.primary",
        fixedWidth: direction === "horizontal" ? (dense ? 0.48 : 0.7) : 0.5,
        fixedHeight: direction === "horizontal" ? (dense ? 0.36 : 0.5) : (verticalDense ? 0.3 : 0.4),
        layoutWeight: 1,
      });
    }
  });
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction,
    gap: dense || verticalDense ? 0.18 : 0.4,
    role: "process-flow",
    align: "center",
    valign: "middle",
    children: items,
    // No outer fixedHeight: process-flow lets the container above decide.
    // Layout falls back to vertical orientation when the cross-axis cell is
    // too narrow (see autoOrientFlow in render.ts).
  };
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

export function heroStat(slideId: string, id: string, options: { value: string; label: string; caption?: string; tone?: "brand" | "positive" | "warning" | "danger" | "neutral" }): DomNode {
  const tone = options.tone || "brand";
  const valueColor = tone === "positive" ? "success" : tone === "warning" ? "warning" : tone === "danger" ? "danger" : tone === "neutral" ? "text.primary" : "brand.primary";
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

export function barList(slideId: string, id: string, options: { items: Array<{ label: string; value: number; max?: number; valueLabel?: string }>; tone?: "brand" | "positive" | "warning" | "danger"; sort?: "desc" | "asc" | "none" }): DomNode {
  const tone = options.tone || "brand";
  const fillToken = tone === "brand" ? "brand.primary" : tone === "positive" ? "success" : tone === "warning" ? "warning" : "danger";
  const trackToken = "surface.subtle";
  const declaredMax = options.items.reduce((m, item) => Math.max(m, item.max ?? item.value), 0);
  const max = declaredMax > 0 ? declaredMax : 1;
  const sort = options.sort || "none";
  const sorted = sort === "none" ? options.items.slice() : options.items.slice().sort((a, b) => sort === "desc" ? b.value - a.value : a.value - b.value);
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.3,
    role: "bar-list",
    children: sorted.map((item, index) => {
      const ratio = Math.max(0.001, Math.min(1, item.value / max));
      const valueLabel = item.valueLabel || `${item.value}`;
      return {
        id: `${slideId}.${id}.${index}`,
        type: "stack",
        direction: "vertical",
        gap: 0.1,
        children: [
          {
            id: `${slideId}.${id}.${index}.header`,
            type: "stack",
            direction: "horizontal",
            gap: 0.2,
            fixedHeight: 0.5,
            children: [
              { id: `${slideId}.${id}.${index}.label`, type: "text", text: item.label, style: "label", color: "text.primary", align: "left", valign: "middle", layoutWeight: 5, size: "md" },
              { id: `${slideId}.${id}.${index}.value`, type: "text", text: valueLabel, style: "label", color: fillToken, align: "right", valign: "middle", layoutWeight: 1, size: "md" },
            ],
          },
          {
            id: `${slideId}.${id}.${index}.track`,
            type: "stack",
            direction: "horizontal",
            gap: 0,
            fixedHeight: 0.32,
            children: [
              { id: `${slideId}.${id}.${index}.fill`, type: "shape", preset: "roundRect", fill: fillToken, cornerRadius: 0.5, layoutWeight: ratio },
              { id: `${slideId}.${id}.${index}.empty`, type: "shape", preset: "roundRect", fill: trackToken, cornerRadius: 0.5, layoutWeight: 1 - ratio + 0.001 },
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
  options: { headline: string; detail?: string; tone?: "brand" | "positive" | "warning" | "danger" } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const tone = options.tone || "brand";
  const fillToken = tone === "brand" ? "brand.tint" : tone === "positive" ? "success.tint" : tone === "warning" ? "warning.tint" : "danger.tint";
  const accentToken = tone === "brand" ? "brand.primary" : tone === "positive" ? "success" : tone === "warning" ? "warning" : "danger";
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
    {
      id: `${slideId}.${id}.headline`,
      type: "text",
      text: options.headline,
      style: "section-title",
      size: "lg",
      color: accentToken,
      align: "left",
    },
  ];
  if (options.detail && options.detail.trim()) {
    children.push({
      id: `${slideId}.${id}.detail`,
      type: "text",
      text: options.detail.trim(),
      style: "lead",
      color: "text.primary",
      align: "left",
      valign: "top",
    });
  }
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.3,
    role: "key-takeaway",
    fill: fillToken,
    line: accentToken,
    padding: 0.7,
    cornerRadius: 0.12,
    elevation: "raised",
    children,
  } as DomNode, options);
}

export function numberedGrid(
  slideId: string,
  id: string,
  options: { items: Array<{ title: string; body?: string }>; columns?: number; tone?: "brand" | "neutral"; numberStyle?: "chip" | "plain" } & { surface?: AgentSurface } & AgentSurface,
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
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "grid",
    columns: cols,
    gap: dense ? 0.32 : 0.55,
    role: "numbered-grid",
    children: options.items.map((item, index) => ({
      id: `${slideId}.${id}.${index}`,
      type: "stack",
      direction: "vertical",
      gap: dense ? 0.14 : 0.25,
      role: "numbered-step",
      children: [
        chipStyle
          ? {
              id: `${slideId}.${id}.${index}.num`,
              type: "text" as const,
              text: String(index + 1),
              // 761q1u: dense (5+ items) shrinks chip to 0.7cm so body has
              // headroom in tight 2-col layouts where each row is only
              // ~2cm tall after gaps. Non-dense stays 1.15cm for visual
              // weight on hero-style 3-up layouts.
              style: dense ? "label" : "card-title",
              weight: "bold" as const,
              color: "text.inverse",
              fill: accentColor,
              align: "center" as const,
              valign: "middle" as const,
              cornerRadius: 0.5,
              fixedWidth: dense ? 0.7 : 1.15,
              fixedHeight: dense ? 0.7 : 1.15,
            }
          : {
              id: `${slideId}.${id}.${index}.num`,
              type: "text" as const,
              text: String(index + 1).padStart(2, "0"),
              style: "metric-value",
              color: accentColor,
              align: "left" as const,
              valign: "bottom" as const,
              minHeight: dense ? 0.6 : 0.9,
              autoFit: "shrink" as const,
            },
        {
          id: `${slideId}.${id}.${index}.title`,
          type: "text",
          text: item.title,
          style: "card-title",
          color: "text.primary",
          align: "left",
          minHeight: dense ? 0.42 : 0.55,
          autoFit: "shrink",
        },
        ...(item.body && item.body.trim() ? [{ id: `${slideId}.${id}.${index}.body`, type: "text" as const, text: item.body.trim(), style: "caption", align: "left" as const, valign: "top" as const, color: "text.muted", minHeight: dense ? 0.5 : 0.7, autoFit: "shrink" as const, optional: true }] : []),
      ],
    })),
  } as DomNode, options);
}

export function statStrip(slideId: string, id: string, options: { items: Array<{ value: string; label: string }>; tone?: "brand" | "positive" | "neutral" }): DomNode {
  const tone = options.tone || "brand";
  const valueColor = tone === "positive" ? "success" : tone === "neutral" ? "text.primary" : "brand.primary";
  // Inline KPI row — no card chrome, just bold values + small labels separated
  // by thin vertical accent rules. Reads as a tighter alternative to kpi-grid
  // for the "headline numbers in one row" pattern (OOXML / consulting-deck
  // common shape).
  const items: DomNode[] = [];
  options.items.forEach((item, index) => {
    if (index > 0) {
      items.push({
        id: `${slideId}.${id}.sep${index}`,
        type: "shape",
        preset: "rect",
        fill: "divider",
        fixedWidth: 0.04,
        fixedHeight: 1.6,
        align: "center",
      });
    }
    items.push({
      id: `${slideId}.${id}.${index}`,
      type: "stack",
      direction: "vertical",
      gap: 0.15,
      align: "center",
      valign: "middle",
      layoutWeight: 4,
      children: [
        { id: `${slideId}.${id}.${index}.value`, type: "text", text: item.value, style: "metric-value", color: valueColor, align: "center", valign: "bottom", autoFit: "shrink", minHeight: 0.85 },
        { id: `${slideId}.${id}.${index}.label`, type: "text", text: item.label, style: "metric-label", color: "text.muted", align: "center", valign: "top", uppercase: true, letterSpacing: 60 },
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
    children: items,
  };
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
        { id: `${slideId}.${id}.${index}.label`, type: "text", text: item.label, style: "label", color: "text.primary", align: "left", valign: "middle" },
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
  let charBudget = 0.9; // padding
  for (const ch of options.text) {
    charBudget += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 0.55 : 0.18;
  }
  const intrinsic = Math.max(1.6, Math.min(6, charBudget));
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
export function takeawayList(
  slideId: string,
  id: string,
  options: { items: Array<{ headline: string; detail?: string; tone?: "brand" | "positive" | "warning" | "danger" }>; tone?: "brand" | "positive" | "warning" | "danger" } & { surface?: AgentSurface } & AgentSurface,
): DomNode {
  const baseTone = options.tone || "brand";
  const items = (options.items || []).slice(0, 6);
  // Density adapts gap + accent thickness to item count so 5 takeaways
  // still fit in a typical 8cm content area.
  const dense = items.length >= 4;
  const itemNodes: DomNode[] = items.map((item, idx) => {
    const tone = item.tone || baseTone;
    const accent = tone === "brand" ? "brand.primary" : tone === "positive" ? "success" : tone === "warning" ? "warning" : "danger";
    const children: DomNode[] = [
      // Accent bar uses fixedWidth only — its height is decided by the
      // row's allocated cross-axis. Setting fixedHeight made every row
      // demand at least that much, blocking dense (5+) layouts.
      {
        id: `${slideId}.${id}.${idx}.bar`,
        type: "shape",
        preset: "rect",
        fill: accent,
        fixedWidth: dense ? 0.14 : 0.18,
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
            minHeight: dense ? 0.4 : 0.5,
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
      gap: 0.35,
      role: "takeaway-item",
      align: "start",
      valign: "top",
      children,
    };
  });
  return applyAgentSurface({
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: dense ? 0.25 : 0.5,
    role: "takeaway-list",
    children: itemNodes,
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
      // Reserve the number column on every row (even blank ones) so
      // titles stay aligned across items.
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
        autoFit: "shrink",
      });
    }
    const titleStack: DomNode = {
      id: `${slideId}.${id}.${idx}.col`,
      type: "stack",
      direction: "vertical",
      gap: compact ? 0.06 : 0.12,
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
          minHeight: veryCompact ? 0.4 : compact ? 0.5 : 0.6,
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
          minHeight: compact ? 0.42 : 0.5,
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
      type: "text",
      text: " ",
      style: "label",
      align: "left",
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
          color: "brand.primary",
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
          color: opt.recommended ? "brand.primary" : "text.primary",
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
