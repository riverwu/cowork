import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { contentRect, slideTitle } from "../render/primitives.js";

/**
 * `roadmap` — Gantt-style time-bucketed plan. Renders N work-stream
 * tracks as horizontal lanes, each carrying 1+ phase bars that span
 * one or more time buckets across the top axis.
 *
 * Use this for product roadmaps, project schedules, release plans —
 * anywhere the "what runs in which quarter / month / sprint" is the
 * point. Distinct from:
 *   - `timeline` — single-track sequence of POINT events (no duration).
 *   - `process-flow` — linear stages with no time axis.
 *   - `data-table` — works as a fallback but loses the visual bar /
 *     duration / lane semantic.
 *
 * Bar color is theme-coordinated:
 *   - When `status` is set on a bar, the semantic palette decides:
 *       planned     → semantic.neutral
 *       in-progress → semantic.info
 *       done        → semantic.positive
 *       at-risk     → semantic.warning
 *       blocked     → semantic.negative
 *   - Otherwise each track inherits a color from
 *     `style.dataviz.categorical[trackIndex]` so lanes stay visually
 *     distinct.
 */
export const slots: Record<string, SlotSchema> = {
  title:   { type: "text",    maxChars: 42, optional: true },
  // Period labels along the top axis: 3-12 entries (e.g. quarters or
  // months). Length determines the number of columns.
  periods: { type: "bullets", min: 3, max: 12, itemMaxChars: 24 },
  // 1-7 tracks (work-stream lanes). Each carries 1+ phase bars.
  tracks:  { type: "bullets", min: 1, max: 7, itemMaxChars: 600 },
  // "Today" marker — vertical accent line drawn through the grid at the
  // given period. Accepts either a 0-based index or a period name (e.g.
  // "Q2 2026") that matches one of the period labels. Off-by-one is
  // expensive in agent-emitted decks; the string form is a safer DX.
  today:   { type: "text",    maxChars: 24, optional: true },
  // Point-in-time milestone markers — diamond glyph at the centre of
  // a specific period, with optional label. Independent of tracks so a
  // single milestone (e.g. "Public Launch ◆ Q3") can render above the
  // top axis without polluting any one lane.
  milestones: { type: "bullets", min: 1, max: 8, itemMaxChars: 56, optional: true },
};

// Canonical statuses + the synonyms agents reach for from training
// data. Mapping is one-way (input → canonical) so the renderer's color
// switch stays small and the schema stays predictable.
const STATUS_SYNONYMS: Record<string, BarStatus> = {
  // Canonical
  "planned": "planned", "in-progress": "in-progress", "done": "done",
  "at-risk": "at-risk", "blocked": "blocked",
  // Common synonyms
  "pending": "planned", "upcoming": "planned", "todo": "planned", "future": "planned",
  "ongoing": "in-progress", "wip": "in-progress", "active": "in-progress",
  "in_progress": "in-progress", "inprogress": "in-progress", "current": "in-progress",
  "complete": "done", "completed": "done", "finished": "done", "shipped": "done", "delivered": "done",
  "risk": "at-risk", "warning": "at-risk", "delayed": "at-risk", "slipping": "at-risk",
  "stopped": "blocked", "halted": "blocked", "cancelled": "blocked", "canceled": "blocked",
};
type BarStatus = "planned" | "in-progress" | "done" | "at-risk" | "blocked";

interface BarRaw {
  // Period index (0-based) the bar starts at. May ALSO be a string
  // matching one of the period labels (e.g. "Q1 2026") — the renderer
  // resolves it. Synonyms: from, period (when end is omitted).
  start?: number | string;
  from?: number | string;
  period?: number | string;
  // Period index (0-based) the bar ends at, INCLUSIVE. Synonyms: to,
  // until, end. When omitted, bar spans `start` only (single period).
  end?: number | string;
  to?: number | string;
  until?: number | string;
  // Optional text overlaid on the bar (3-12 chars typical).
  label?: string;
  text?: string;
  name?: string;
  // Status drives the semantic color when set; otherwise the bar uses
  // the track's categorical color. See STATUS_SYNONYMS for accepted
  // input forms (ongoing/wip/active/etc all map to in-progress).
  status?: string;
  // Explicit color override — token name ("brand-primary") OR 6-char
  // hex. Wins over status / track-categorical when set.
  color?: string;
}

interface MilestoneRaw {
  period?: number | string;
  at?: number | string;
  start?: number | string;
  label?: string;
  text?: string;
  name?: string;
}

interface TrackRaw {
  // Track / lane name shown in the left gutter.
  name?: string;
  label?: string;
  title?: string;
  track?: string;
  stream?: string;
  // Phase bars. Required; a track with zero bars renders as a label
  // with an empty lane.
  bars?: unknown[];
  phases?: unknown[];
  items?: unknown[];
}

interface Bar { start: number; end: number; label: string; status?: BarStatus; color?: string }
interface Milestone { period: number; label: string }
interface Track { name: string; bars: Bar[] }

/**
 * Resolve a period reference. Accepts:
 *   - 0-based integer index
 *   - case-insensitive exact match against a period label
 *   - case-insensitive prefix match (so "Q1" matches "Q1 2026")
 * Returns null when unresolvable; the caller emits a useful skip.
 */
function resolvePeriod(value: unknown, periods: string[]): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Math.max(0, Math.min(periods.length - 1, Math.floor(value)));
  }
  if (typeof value === "string") {
    const lc = value.trim().toLowerCase();
    if (!lc) return null;
    const exact = periods.findIndex((p) => p.toLowerCase() === lc);
    if (exact >= 0) return exact;
    const prefix = periods.findIndex((p) => p.toLowerCase().startsWith(lc));
    if (prefix >= 0) return prefix;
    const contains = periods.findIndex((p) => p.toLowerCase().includes(lc));
    if (contains >= 0) return contains;
    // Last resort: numeric string ("3", "0").
    const n = Number(lc);
    if (Number.isFinite(n)) return Math.max(0, Math.min(periods.length - 1, Math.floor(n)));
  }
  return null;
}

function normalizeBar(raw: unknown, periods: string[]): Bar | null {
  if (typeof raw === "string") return null;
  const o = (raw ?? {}) as BarRaw;
  const start = resolvePeriod(o.start ?? o.from ?? o.period, periods);
  if (start === null) return null;
  const endRef = o.end ?? o.to ?? o.until;
  const end = endRef !== undefined ? resolvePeriod(endRef, periods) : start;
  const eClamped = Math.max(start, end ?? start);
  const status = o.status ? STATUS_SYNONYMS[o.status.toLowerCase()] : undefined;
  return {
    start,
    end: eClamped,
    label: o.label ?? o.text ?? o.name ?? "",
    ...(status ? { status } : {}),
    ...(o.color ? { color: o.color } : {}),
  };
}

function normalizeMilestone(raw: unknown, periods: string[]): Milestone | null {
  if (typeof raw === "string") {
    // Bare string: try to parse as period reference.
    const idx = resolvePeriod(raw, periods);
    return idx === null ? null : { period: idx, label: raw };
  }
  const o = (raw ?? {}) as MilestoneRaw;
  const idx = resolvePeriod(o.period ?? o.at ?? o.start, periods);
  if (idx === null) return null;
  return { period: idx, label: o.label ?? o.text ?? o.name ?? "" };
}

function normalizeTrack(raw: unknown, periods: string[], idx: number): Track {
  if (typeof raw === "string") return { name: raw, bars: [] };
  const o = (raw ?? {}) as TrackRaw;
  const barsRaw = o.bars ?? o.phases ?? o.items ?? [];
  const bars = Array.isArray(barsRaw)
    ? barsRaw.map((b) => normalizeBar(b, periods)).filter((b): b is Bar => b !== null)
    : [];
  return {
    name: o.name ?? o.label ?? o.title ?? o.track ?? o.stream ?? `Track ${idx + 1}`,
    bars,
  };
}

const roadmap: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const periodsRaw = ctx.slot<unknown[]>("periods") ?? [];
  const periods = periodsRaw.map((p) => String(p));
  const tracksRaw = ctx.slot<unknown[]>("tracks") ?? [];
  const tracks = tracksRaw.map((t, i) => normalizeTrack(t, periods, i));
  const milestonesRaw = ctx.slot<unknown[]>("milestones") ?? [];
  const milestones = milestonesRaw.map((m) => normalizeMilestone(m, periods)).filter((m): m is Milestone => m !== null);
  const todayRaw = ctx.slot<unknown>("today");
  const todayIdx = todayRaw !== undefined ? resolvePeriod(todayRaw, periods) : null;
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");
  const datavizPalette = ctx.style.dataviz.categorical;

  if (title) out.push(...slideTitle(ctx, title));

  const top = title ? ctx.cm(4.4) : ctx.cm(2);
  const body = contentRect(ctx, { top, marginX: ctx.cm(2), bottom: ctx.cm(1.6) });

  // Layout: left gutter for track names, top row for period axis labels,
  // remaining grid for bars. Track gutter width scales with the longest
  // track name length (rough approximation — autoFit would be cleaner
  // but a fixed allowance keeps the bar grid predictable).
  const longestTrackName = Math.max(...tracks.map((t) => [...t.name].length), 4);
  const trackGutterW = Math.min(ctx.cm(4.5), Math.max(ctx.cm(2.2), ctx.cm(0.45 * longestTrackName)));
  // Reserve a milestone strip ABOVE the period axis when milestones are
  // supplied — keeps ◆ markers from colliding with axis labels and lets
  // them serve as headline callouts (which is how Gantts use them).
  const milestoneStripH = milestones.length > 0 ? ctx.cm(1.2) : 0;
  // Reserve a legend strip at the bottom when ≥2 distinct statuses
  // appear across all bars — explains the color semantics so the
  // viewer can decode at a glance.
  const usedStatuses = collectUsedStatuses(tracks);
  const legendStripH = usedStatuses.size >= 2 ? ctx.cm(0.9) : 0;
  const axisH = ctx.cm(0.9);
  const gridX = body.x + trackGutterW + ctx.cm(0.4);
  const gridW = body.width - trackGutterW - ctx.cm(0.4);
  const gridY = body.y + milestoneStripH + axisH + ctx.cm(0.2);
  const gridH = body.height - milestoneStripH - axisH - ctx.cm(0.2) - legendStripH;
  const colW = gridW / Math.max(1, periods.length);

  // Milestone strip — ◆ markers + labels above the period axis. Each
  // milestone sits at the centre of its target period column.
  milestones.forEach((m) => {
    const cx = gridX + m.period * colW + colW / 2;
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: cx - colW / 2, y: body.y + ctx.cm(0.05), cx: colW, cy: ctx.cm(0.5) },
      valign: "middle",
      paragraphs: [{
        align: "center",
        runs: [{ text: "\u25C6", sizeHalfPt: 28, color: ctx.color("brand-primary"), bold: true, fontFace: ctx.font("latin") }],
      }],
    });
    if (m.label) {
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: cx - ctx.cm(2.5), y: body.y + ctx.cm(0.6), cx: ctx.cm(5), cy: ctx.cm(0.55) },
        valign: "top",
        autoFit: "shrink",
        margin: { l: 0, t: 0, r: 0, b: 0 },
        paragraphs: [{
          align: "center",
          runs: [{ text: m.label, sizeHalfPt: 20, color: ctx.color("brand-primary"), bold: true, cjk: ctx.cjk, fontFace }],
        }],
      });
    }
  });

  // Period axis — labels centered in each column, with a thin bottom rule.
  const axisY = body.y + milestoneStripH;
  periods.forEach((label, idx) => {
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: gridX + idx * colW, y: axisY, cx: colW, cy: axisH },
      valign: "middle",
      autoFit: "shrink",
      paragraphs: [{
        align: "center",
        runs: [{
          text: label,
          sizeHalfPt: 22,
          color: ctx.color("text-muted"),
          bold: true,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
  });
  // Axis baseline rule (under the period labels).
  out.push({
    type: "shape",
    id: ctx.id(),
    preset: "rect",
    xfrm: { x: gridX, y: axisY + axisH, cx: gridW, cy: ctx.cm(0.04) },
    fill: { type: "solid", color: ctx.color("divider") },
    line: { color: ctx.color("divider"), width: 0 },
  });

  // Vertical column dividers (subtle) — drawn AFTER the bars would be
  // hidden by the bars; emit BEFORE bars so bars sit on top.
  for (let i = 1; i < periods.length; i++) {
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "rect",
      xfrm: { x: gridX + i * colW - ctx.cm(0.01), y: gridY, cx: ctx.cm(0.02), cy: gridH },
      fill: { type: "solid", color: ctx.color("divider"), alpha: 0.4 },
      line: { color: "FFFFFF", width: 0 },
    });
  }

  // Track rows. Each row = label on the left + bar lane on the right.
  const trackGap = ctx.cm(0.25);
  const rowH = (gridH - trackGap * (tracks.length - 1)) / Math.max(1, tracks.length);
  const barH = Math.min(ctx.cm(1.0), rowH * 0.55);
  const barInset = ctx.cm(0.1); // horizontal inset within each column so bars don't touch dividers

  tracks.forEach((track, trackIdx) => {
    const rowY = gridY + trackIdx * (rowH + trackGap);
    const barY = rowY + Math.floor((rowH - barH) / 2);

    // Track label in left gutter, vertically centered.
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: body.x, y: rowY, cx: trackGutterW, cy: rowH },
      valign: "middle",
      autoFit: "shrink",
      paragraphs: [{
        align: "right",
        runs: [{
          text: track.name,
          sizeHalfPt: 22,
          color: ctx.color("text-strong"),
          bold: true,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });

    // Subtle row background to help the eye scan across periods.
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "rect",
      xfrm: { x: gridX, y: rowY, cx: gridW, cy: rowH },
      fill: { type: "solid", color: ctx.color("bg-card"), alpha: 0.4 },
      line: { color: "FFFFFF", width: 0 },
    });

    // Bars.
    const trackColor = datavizPalette[trackIdx % datavizPalette.length] ?? ctx.color("brand-primary");
    track.bars.forEach((bar) => {
      const x = gridX + bar.start * colW + barInset;
      const w = (bar.end - bar.start + 1) * colW - barInset * 2;
      const fill = barColor(ctx, bar, trackColor);
      out.push({
        type: "shape",
        id: ctx.id(),
        preset: "roundRect",
        xfrm: { x, y: barY, cx: w, cy: barH },
        fill: { type: "solid", color: fill },
        line: { color: fill, width: 0 },
        cornerRadius: 0.25,
      });
      if (bar.label) {
        // Narrow-bar fallback: when a bar is too thin to legibly hold
        // its label inside, place the label OUTSIDE on the right. The
        // threshold (~2.4cm) is calibrated so 4-6 CJK chars at 9pt
        // would just fit inside before becoming illegible.
        const NARROW_THRESHOLD = ctx.cm(2.4);
        const labelOutside = w < NARROW_THRESHOLD;
        if (labelOutside) {
          // Right-of-bar — left-aligned, in text-strong, no white-on-fill needed.
          out.push({
            type: "text",
            id: ctx.id(),
            xfrm: { x: x + w + ctx.cm(0.15), y: barY, cx: ctx.cm(4), cy: barH },
            valign: "middle",
            autoFit: "shrink",
            margin: { l: 0, t: 0, r: 0, b: 0 },
            paragraphs: [{
              align: "left",
              runs: [{
                text: bar.label,
                sizeHalfPt: 16,
                color: ctx.color("text-strong"),
                bold: true,
                cjk: ctx.cjk,
                fontFace,
              }],
            }],
          });
        } else {
          out.push({
            type: "text",
            id: ctx.id(),
            xfrm: { x, y: barY, cx: w, cy: barH },
            valign: "middle",
            autoFit: "shrink",
            margin: { l: ctx.cm(0.2), t: 0, r: ctx.cm(0.2), b: 0 },
            paragraphs: [{
              align: "center",
              runs: [{
                text: bar.label,
                sizeHalfPt: 18,
                color: "FFFFFF",
                bold: true,
                cjk: ctx.cjk,
                fontFace,
              }],
            }],
          });
        }
      }
    });
  });

  // Today marker — vertical accent line from axis baseline to bottom of
  // grid, sitting in the centre of the resolved period. Drawn AFTER
  // bars so the line floats on top.
  if (todayIdx !== null) {
    const cx = gridX + todayIdx * colW + colW / 2;
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "rect",
      xfrm: { x: cx - ctx.cm(0.04), y: axisY + axisH, cx: ctx.cm(0.08), cy: gridH + ctx.cm(0.2) },
      fill: { type: "solid", color: ctx.color("brand-primary"), alpha: 0.85 },
      line: { color: ctx.color("brand-primary"), width: 0 },
    });
    // "TODAY" pill above the line.
    out.push({
      type: "shape",
      id: ctx.id(),
      preset: "roundRect",
      xfrm: { x: cx - ctx.cm(0.7), y: axisY + axisH - ctx.cm(0.35), cx: ctx.cm(1.4), cy: ctx.cm(0.5) },
      fill: { type: "solid", color: ctx.color("brand-primary") },
      line: { color: ctx.color("brand-primary"), width: 0 },
      cornerRadius: 0.5,
    });
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: cx - ctx.cm(0.7), y: axisY + axisH - ctx.cm(0.35), cx: ctx.cm(1.4), cy: ctx.cm(0.5) },
      valign: "middle",
      paragraphs: [{
        align: "center",
        runs: [{ text: ctx.cjk ? "今天" : "TODAY", sizeHalfPt: 14, color: "FFFFFF", bold: true, cjk: ctx.cjk, fontFace }],
      }],
    });
  }

  // Legend strip — emit only when the deck mixes ≥2 distinct statuses.
  // Reading the same palette three different ways (per-track / per-status
  // / explicit color) is hard for the viewer; the legend resolves it.
  if (legendStripH > 0) {
    const legendY = body.y + body.height - legendStripH + ctx.cm(0.15);
    const swatchW = ctx.cm(0.5);
    const swatchH = ctx.cm(0.4);
    const swatchToLabel = ctx.cm(0.15);
    const labelW = ctx.cm(2.4);
    const itemGap = ctx.cm(0.5);
    const itemAdvance = swatchW + swatchToLabel + labelW + itemGap;
    const labelMap: Record<BarStatus, string> = ctx.cjk
      ? { planned: "计划中", "in-progress": "进行中", done: "已完成", "at-risk": "风险", blocked: "受阻" }
      : { planned: "Planned", "in-progress": "In progress", done: "Done", "at-risk": "At risk", blocked: "Blocked" };
    const order: BarStatus[] = ["planned", "in-progress", "done", "at-risk", "blocked"];
    const items = order.filter((s) => usedStatuses.has(s));
    // Centre the legend horizontally under the bar grid so it reads as
    // a key, not as left-overflow.
    const totalW = items.length * itemAdvance - itemGap;
    let cursorX = gridX + Math.max(0, Math.floor((gridW - totalW) / 2));
    items.forEach((status) => {
      const color =
        status === "planned" ? ctx.semantic("neutral") :
        status === "in-progress" ? ctx.semantic("info") :
        status === "done" ? ctx.semantic("positive") :
        status === "at-risk" ? ctx.semantic("warning") :
        ctx.semantic("negative");
      out.push({
        type: "shape",
        id: ctx.id(),
        preset: "roundRect",
        xfrm: { x: cursorX, y: legendY + ctx.cm(0.1), cx: swatchW, cy: swatchH },
        fill: { type: "solid", color },
        line: { color, width: 0 },
        cornerRadius: 0.4,
      });
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: cursorX + swatchW + swatchToLabel, y: legendY, cx: labelW, cy: ctx.cm(0.6) },
        valign: "middle",
        autoFit: "shrink",
        margin: { l: 0, t: 0, r: 0, b: 0 },
        paragraphs: [{
          align: "left",
          runs: [{ text: labelMap[status], sizeHalfPt: 20, color: ctx.color("text-muted"), cjk: ctx.cjk, fontFace }],
        }],
      });
      cursorX += itemAdvance;
    });
  }

  return out;
};

function collectUsedStatuses(tracks: Track[]): Set<BarStatus> {
  const out = new Set<BarStatus>();
  for (const t of tracks) for (const b of t.bars) if (b.status) out.add(b.status);
  return out;
}

function barColor(ctx: LayoutContext, bar: Bar, trackColor: string): string {
  // Explicit per-bar color override wins (token name OR hex).
  if (bar.color) {
    if (/^[0-9A-Fa-f]{6}$/.test(bar.color)) return bar.color.toUpperCase();
    try { return ctx.color(bar.color); } catch { /* fall through */ }
  }
  if (!bar.status) return trackColor;
  switch (bar.status) {
    case "planned":     return ctx.semantic("neutral");
    case "in-progress": return ctx.semantic("info");
    case "done":        return ctx.semantic("positive");
    case "at-risk":     return ctx.semantic("warning");
    case "blocked":     return ctx.semantic("negative");
  }
}

export default roadmap;
