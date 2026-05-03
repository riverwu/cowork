import type { DomNode } from "./types.js";

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
      { id: `${slideId}.${id}.label`, type: "text", text: label, style: "metric-label", color: labelColor, align: "center", valign: "top", layoutWeight: 1 },
    ],
  };
}

export function stepCard(slideId: string, id: string, step: string, title: string, body: string): DomNode {
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.25,
    role: "step-card",
    children: [
      { id: `${slideId}.${id}.step`, type: "text", text: step, style: "numbered-step", color: "brand.primary", minHeight: 0.42, autoFit: "shrink" },
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
      { id: `${slideId}.${id}.title`, type: "text", text: title, style: "card-title", color: "brand.primary", minHeight: 0.6, autoFit: "shrink" },
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

export function quoteBlock(slideId: string, id: string, text: string, source?: string): DomNode {
  const children: DomNode[] = [
    { id: `${slideId}.${id}.text`, type: "text", text: `\u201C${text}\u201D`, style: "quote", align: "left", valign: "middle" },
  ];
  if (source && source.trim()) {
    children.push({ id: `${slideId}.${id}.source`, type: "text", text: `\u2014 ${source.trim()}`, style: "quote-source", align: "left", minHeight: 0.4, autoFit: "shrink" });
  }
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.3,
    role: "quote",
    children,
  };
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

export function timelineBlock(slideId: string, id: string, options: {
  items: Array<{ time?: string; title: string; body?: string }>;
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

function timelineStep(slideId: string, id: string, index: number, item: { time?: string; title: string; body?: string }, direction: "horizontal" | "vertical"): DomNode {
  const dense = direction === "horizontal";
  // 2pmnxh fix: previous defaults (color:"brand.primary" on the time label,
  // style:"caption" on the body — caption resolves to text.muted) repeatedly
  // failed contrast on dark deck themes the agent provided. brand.primary is
  // an accent color, not guaranteed to pass 4.5:1 against either light or
  // dark surfaces; text.muted is by definition a low-contrast gray. Use
  // text.primary for both — that's the one token guaranteed to read against
  // the deck's actual surface (light theme picks dark, dark theme picks
  // light — that's exactly what text.primary is for). The time line keeps
  // its label style for typography but uses text.secondary (mid-contrast)
  // as a softer accent that still passes 4.5:1 on the default themes.
  const titleStyle = "card-title";
  const children: DomNode[] = [];
  if (item.time && item.time.trim()) {
    children.push({ id: `${slideId}.${id}.${index}.time`, type: "text", text: item.time.trim(), style: "label", color: "text.primary", minHeight: dense ? 0.32 : 0.4, autoFit: "shrink" });
  }
  children.push({ id: `${slideId}.${id}.${index}.title`, type: "text", text: item.title, style: titleStyle, color: "text.primary", minHeight: dense ? 0.42 : 0.5, autoFit: "shrink" });
  if (item.body && item.body.trim()) {
    children.push({ id: `${slideId}.${id}.${index}.body`, type: "text", text: item.body.trim(), style: "caption", color: "text.primary", valign: "top", minHeight: 0.4, autoFit: "shrink", optional: true });
  }
  return {
    id: `${slideId}.${id}.${index}`,
    type: "stack",
    direction: "vertical",
    gap: dense ? 0.08 : 0.1,
    role: "timeline-step",
    children,
  };
}

export function profileCard(slideId: string, id: string, options: { image: string; name: string; role?: string; bio?: string }): DomNode {
  const children: DomNode[] = [
    { id: `${slideId}.${id}.photo`, type: "image", src: options.image, alt: options.name, clip: "circle", fit: "cover", fixedWidth: 2.8, fixedHeight: 2.8 },
    { id: `${slideId}.${id}.name`, type: "text", text: options.name, style: "card-title", align: "center", minHeight: 0.6, autoFit: "shrink" },
  ];
  if (options.role && options.role.trim()) {
    children.push({ id: `${slideId}.${id}.role`, type: "text", text: options.role.trim(), style: "label", color: "brand.primary", align: "center", minHeight: 0.42, autoFit: "shrink" });
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
  if (options.accent && options.accent.trim()) {
    children.push({ id: `${slideId}.${id}.accent`, type: "text", text: options.accent.trim(), style: "label", color: "brand.primary", align: "left", minHeight: 0.42, autoFit: "shrink" });
  }
  children.push({ id: `${slideId}.${id}.title`, type: "text", text: options.title, style: "deck-title", align: "left", color: "text.primary" });
  if (options.subtitle && options.subtitle.trim()) {
    children.push({ id: `${slideId}.${id}.subtitle`, type: "text", text: options.subtitle.trim(), style: "lead", align: "left", color: "text.muted" });
  }
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.4,
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

export function checklist(slideId: string, id: string, items: Array<{ text: string; status?: "checked" | "unchecked" | "warning" }>, density: "comfortable" | "compact" = "comfortable"): DomNode {
  const compact = density === "compact";
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
      return {
        id: `${slideId}.${id}.${index}`,
        type: "stack",
        direction: "horizontal",
        gap: 0.3,
        role: "checklist-item",
        align: "start",
        valign: "middle",
        fixedHeight: compact ? 0.5 : undefined,
        children: [
          { id: `${slideId}.${id}.${index}.mark`, type: "text", text: mark, style: compact ? "label" : "card-title", color: markColor, align: "center", valign: "middle", fixedWidth: compact ? 0.5 : 0.7 },
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
        { id: `${slideId}.${id}.step${index + 1}.title`, type: "text", text: step.title, style: "card-title", color: "brand.primary", align: "center", minHeight: dense || verticalDense ? 0.42 : 0.6, autoFit: "shrink" },
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

export function keyTakeaway(slideId: string, id: string, options: { headline: string; detail?: string; tone?: "brand" | "positive" | "warning" | "danger" }): DomNode {
  const tone = options.tone || "brand";
  const fillToken = tone === "brand" ? "brand.tint" : tone === "positive" ? "success.tint" : tone === "warning" ? "warning.tint" : "danger.tint";
  const accentToken = tone === "brand" ? "brand.primary" : tone === "positive" ? "success" : tone === "warning" ? "warning" : "danger";
  const children: DomNode[] = [
    {
      id: `${slideId}.${id}.accent`,
      type: "shape",
      preset: "rect",
      fill: accentToken,
      fixedHeight: 0.12,
      fixedWidth: 2.4,
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
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction: "vertical",
    gap: 0.3,
    role: "key-takeaway",
    fill: fillToken,
    line: accentToken,
    padding: 0.7,
    cornerRadius: 0.12,
    children,
  };
}

export function numberedGrid(slideId: string, id: string, options: { items: Array<{ title: string; body?: string }>; columns?: number; tone?: "brand" | "neutral" }): DomNode {
  const tone = options.tone || "brand";
  const accentColor = tone === "brand" ? "brand.primary" : "text.primary";
  const cols = options.columns && options.columns > 0
    ? options.columns
    : options.items.length <= 4
      ? options.items.length
      : options.items.length <= 6
        ? 3
        : 4;
  const dense = options.items.length >= 5;
  return {
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
        {
          id: `${slideId}.${id}.${index}.num`,
          type: "text",
          text: String(index + 1).padStart(2, "0"),
          style: "metric-value",
          color: accentColor,
          align: "left",
          valign: "bottom",
          minHeight: dense ? 0.6 : 0.9,
          autoFit: "shrink",
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
  };
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

export function legend(slideId: string, id: string, options: { items: Array<{ label: string; color: string }>; direction?: "horizontal" | "vertical" }): DomNode {
  const direction = options.direction === "vertical" ? "vertical" : "horizontal";
  return {
    id: `${slideId}.${id}`,
    type: "stack",
    direction,
    gap: direction === "horizontal" ? 0.55 : 0.25,
    role: "legend",
    align: "start",
    valign: "middle",
    children: options.items.map((item, index) => ({
      id: `${slideId}.${id}.${index}`,
      type: "stack",
      direction: "horizontal",
      gap: 0.2,
      align: "start",
      valign: "middle",
      children: [
        {
          id: `${slideId}.${id}.${index}.dot`,
          type: "shape",
          preset: "ellipse",
          fill: item.color,
          line: item.color,
          fixedWidth: 0.4,
          fixedHeight: 0.4,
          align: "center",
        },
        { id: `${slideId}.${id}.${index}.label`, type: "text", text: item.label, style: "label", color: "text.muted", align: "left", valign: "middle" },
      ],
    })),
  };
}

export function badge(slideId: string, id: string, options: { text: string; tone?: "brand" | "positive" | "warning" | "danger" | "neutral" }): DomNode {
  const tone = options.tone || "brand";
  const fillToken = tone === "brand" ? "brand.primary" : tone === "positive" ? "success" : tone === "warning" ? "warning" : tone === "danger" ? "danger" : "text.muted";
  const intrinsic = Math.max(1.6, Math.min(5, options.text.length * 0.36 + 0.9));
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
