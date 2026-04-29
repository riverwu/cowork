/**
 * Theme design-quality audit.
 *
 * Goes beyond the load-time `auditThemeContrast` (token pairings) by
 * checking the FULL extended style surface (semantic palette, dataviz
 * palette, surface tokens, typography scale, bullets/chips/numbering,
 * image/chart/table policies) for design issues that hurt deck quality.
 *
 * Two-mode output:
 *   - `audit(theme)`        → structured report
 *   - `formatAudit(report)` → human-readable text
 *
 * Suggestions include auto-fixes (e.g. "darken text-muted from #X to #Y
 * to meet AA on bg-canvas"). Used by `slideml audit-theme <name>`.
 */
import type { ThemeManifest } from "./types.js";
import { contrastRatio, relativeLuminance } from "./contrast.js";

export interface AuditFinding {
  severity: "error" | "warning" | "info";
  category:
    | "contrast"
    | "semantic"
    | "dataviz"
    | "surface"
    | "typography"
    | "glyph"
    | "table"
    | "image"
    | "consistency";
  message: string;
  /** Optional auto-fix proposal — value the theme could adopt. */
  suggestion?: { path: string; from?: string; to: string };
}

export interface AuditReport {
  themeName: string;
  ok: boolean;
  score: number;          // 0–100, weighted by severity
  findings: AuditFinding[];
  summary: { errors: number; warnings: number; infos: number };
}

const HEX_RE = /^[0-9a-fA-F]{6}$/;

const isHex = (v: unknown): v is string => typeof v === "string" && HEX_RE.test(v);

const get = (tokens: Record<string, unknown>, name: string): string | undefined => {
  const v = tokens[name];
  return isHex(v) ? v : undefined;
};

/** Adjust a hex color's lightness toward (light=true) white or (light=false) black. */
function shiftLightness(hex: string, deltaPct: number): string {
  // Simple HSL shift via decomposition; deltaPct in -100..100.
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  const newL = Math.min(1, Math.max(0, l + deltaPct / 100));
  return hslToHex(h, s, newL);
}

function hslToHex(h: number, s: number, l: number): string {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0").toUpperCase();
  return `${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Iteratively darken/lighten until contrast meets target. Returns new hex or original on failure. */
function adjustForContrast(fg: string, bg: string, target: number, maxSteps = 30): string {
  let cur = fg;
  // Decide direction: shift fg AWAY from bg's luminance.
  const bgLum = relativeLuminance(bg);
  const direction = bgLum > 0.5 ? -1 : 1; // bg light → darken fg; bg dark → lighten
  for (let i = 0; i < maxSteps; i++) {
    if (contrastRatio(cur, bg) >= target) return cur;
    cur = shiftLightness(cur, direction * 5);
    if (cur === "000000" || cur === "FFFFFF") break;
  }
  return cur;
}

/** Color distance (CIE76 approximation in sRGB — sufficient for distinct-palette checks). */
function colorDistance(a: string, b: string): number {
  const ar = parseInt(a.slice(0, 2), 16), ag = parseInt(a.slice(2, 4), 16), ab = parseInt(a.slice(4, 6), 16);
  const br = parseInt(b.slice(0, 2), 16), bg = parseInt(b.slice(2, 4), 16), bb = parseInt(b.slice(4, 6), 16);
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

export function auditTheme(manifest: ThemeManifest): AuditReport {
  const findings: AuditFinding[] = [];
  const tokens = manifest.tokens as Record<string, unknown>;
  const style = manifest.style ?? {};

  // ── 1. Token contrast (semantic palette + dataviz on canvas) ────
  const bgCanvas = get(tokens, "bg-canvas");
  const bgCard = get(tokens, "bg-card");

  // Semantic palette: each color should reach ≥ 3.0:1 on bg-canvas (LARGE).
  const semantic = style.semantic ?? {};
  for (const kind of ["positive", "negative", "warning", "info", "neutral"] as const) {
    const c = semantic[kind];
    if (!c || !isHex(c)) continue;
    if (bgCanvas) {
      const r = contrastRatio(c, bgCanvas);
      if (r < 3.0) {
        const fix = adjustForContrast(c, bgCanvas, 3.0);
        findings.push({
          severity: "warning",
          category: "semantic",
          message: `semantic.${kind} (#${c}) contrast ${r.toFixed(2)}:1 on bg-canvas fails AA-large ≥3.0:1`,
          suggestion: { path: `style.semantic.${kind}`, from: c, to: fix },
        });
      }
    }
  }

  // ── 2. Dataviz palette distinctness ─────────────────────────────
  const dv = style.dataviz?.categorical ?? [];
  if (dv.length >= 2) {
    const minDistance = 60; // sRGB euclidean — distinguishable threshold
    for (let i = 0; i < dv.length - 1; i++) {
      for (let j = i + 1; j < dv.length; j++) {
        const a = dv[i]!;
        const b = dv[j]!;
        if (!isHex(a) || !isHex(b)) continue;
        const d = colorDistance(a, b);
        if (d < minDistance) {
          findings.push({
            severity: "warning",
            category: "dataviz",
            message: `dataviz.categorical[${i}] (#${a}) and [${j}] (#${b}) are too similar (distance ${d.toFixed(0)} < ${minDistance}). Charts will read as monochrome.`,
          });
        }
      }
    }
    if (bgCanvas) {
      dv.forEach((c, i) => {
        if (!isHex(c)) return;
        if (contrastRatio(c, bgCanvas) < 2.5) {
          findings.push({
            severity: "warning",
            category: "dataviz",
            message: `dataviz.categorical[${i}] (#${c}) doesn't separate from bg-canvas (contrast < 2.5:1). Series will be hard to see.`,
          });
        }
      });
    }
  } else if (style.dataviz === undefined) {
    findings.push({
      severity: "info",
      category: "dataviz",
      message: "No dataviz palette defined. Charts will use the default palette which may not match the brand.",
      suggestion: { path: "style.dataviz.categorical", to: "[brand-primary, accent, semantic-info, …]" },
    });
  }

  // ── 3. Surface design coherence ─────────────────────────────────
  const surface = style.surface;
  if (!surface) {
    findings.push({
      severity: "info",
      category: "surface",
      message: "No surface style defined — cards default to {radius:0.03, elevation:hairline, no stripe}. Pick deliberately.",
      suggestion: { path: "style.surface", to: "{ cornerRadius, elevation, accentStripe }" },
    });
  } else if (surface.elevation === "shadow" && surface.borderPolicy === "full") {
    findings.push({
      severity: "warning",
      category: "surface",
      message: "Combining elevation:shadow with borderPolicy:full reads as visually heavy — pick one.",
    });
  }

  // ── 4. Typography ───────────────────────────────────────────────
  const typo = style.typography;
  if (typo?.ratio && (typo.ratio < 1.1 || typo.ratio > 1.6)) {
    findings.push({
      severity: "warning",
      category: "typography",
      message: `typography.ratio ${typo.ratio} is outside the recommended 1.125–1.5 range. Consider 1.2 / 1.25 / 1.333.`,
    });
  }
  // Italic-CJK trap: most themes should set italicCjk:false explicitly.
  if (typo?.italicCjk === true) {
    findings.push({
      severity: "warning",
      category: "typography",
      message: "italicCjk:true — italic CJK falls back to a slanted serif on macOS/LO. Consider italicCjk:false.",
      suggestion: { path: "style.typography.italicCjk", to: "false" },
    });
  } else if (!typo) {
    findings.push({
      severity: "info",
      category: "typography",
      message: "No typography scale defined. Sizes use the legacy fontSizes table; consider migrating to {baseHalfPt, ratio} for a modular scale.",
    });
  }

  // ── 5. Glyph safety (no emoji surrogates in bullet/chip glyphs) ──
  const themeBullets = style.bullets ?? {};
  for (const key of ["glyph", "level1", "level2"] as const) {
    const g = themeBullets[key];
    if (g && containsEmoji(g)) {
      findings.push({
        severity: "warning",
        category: "glyph",
        message: `bullets.${key} ("${g}") contains an emoji codepoint → triggers system emoji-font fallback. Pick a BMP Unicode glyph (•, —, ›, ◆, etc).`,
      });
    }
  }
  for (const kind of ["up", "down", "flat", "ok", "warn", "bad", "highlight"] as const) {
    const g = style.chips?.[kind]?.glyph;
    if (g && containsEmoji(g)) {
      findings.push({
        severity: "warning",
        category: "glyph",
        message: `chips.${kind}.glyph ("${g}") contains emoji → font fallback. Use ▲▼→✓⚠✗● or similar BMP glyphs.`,
      });
    }
  }

  // ── 6. Table style sanity ───────────────────────────────────────
  const tbl = style.table;
  if (tbl?.headerFill) {
    const fillVal = tokens[tbl.headerFill];
    if (typeof fillVal === "string" && isHex(fillVal)) {
      const onWhiteR = contrastRatio("FFFFFF", fillVal);
      const onStrongR = bgCanvas ? contrastRatio(get(tokens, "text-strong") ?? "000000", fillVal) : 0;
      const best = Math.max(onWhiteR, onStrongR);
      if (best < 4.5) {
        findings.push({
          severity: "warning",
          category: "table",
          message: `table.headerFill "${tbl.headerFill}" (#${fillVal}) — neither white nor text-strong meets AA on this fill (best ${best.toFixed(2)}:1). Header text will be hard to read.`,
        });
      }
    }
  }

  // ── 7. Image style consistency ──────────────────────────────────
  if (style.image?.treatment === "duotone" && !style.dataviz) {
    findings.push({
      severity: "info",
      category: "image",
      message: "image.treatment:duotone is set but pptx is static — this only flows into image_gen guidance. Make sure style.imagery.guidance mentions the duotone palette.",
    });
  }

  // ── 8. Consistency cross-checks ─────────────────────────────────
  // Bullets glyph color references brand-primary by default, but if theme
  // doesn't define brand-primary we'd crash. Verify required tokens exist.
  if (!get(tokens, "brand-primary")) {
    findings.push({
      severity: "error",
      category: "consistency",
      message: "Missing required token brand-primary.",
    });
  }
  if (bgCanvas && bgCard && bgCanvas === bgCard) {
    findings.push({
      severity: "info",
      category: "consistency",
      message: "bg-canvas equals bg-card. Cards won't visually separate from the slide background — consider a small luminance offset.",
    });
  }

  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const infos = findings.filter((f) => f.severity === "info").length;
  // Score: start at 100, subtract 15 per error, 5 per warning, 1 per info.
  const score = Math.max(0, 100 - errors * 15 - warnings * 5 - infos * 1);

  return {
    themeName: manifest.name,
    ok: errors === 0,
    score,
    findings,
    summary: { errors, warnings, infos },
  };
}

function containsEmoji(s: string): boolean {
  // Detect any codepoint outside the BMP (>= 0x10000) which usually
  // indicates emoji — those trigger system font fallback in PPT/LO.
  for (const ch of s) {
    if ((ch.codePointAt(0) ?? 0) >= 0x10000) return true;
  }
  // Variation Selector-16 (U+FE0F) explicitly requests emoji presentation.
  return /\uFE0F/.test(s);
}

/**
 * Apply audit suggestions to a theme manifest in-place. Returns a patched
 * copy + the list of applied paths. Skips suggestions whose `to` value is
 * a placeholder (contains brackets or dots that look like instructions
 * rather than concrete values), so only mechanical fixes (color hex
 * changes, italicCjk:false, etc.) are applied.
 */
export function applyAuditSuggestions(manifest: ThemeManifest, report: AuditReport): {
  manifest: ThemeManifest;
  applied: Array<{ path: string; from?: string; to: string }>;
  skipped: Array<{ path: string; reason: string }>;
} {
  const out = JSON.parse(JSON.stringify(manifest)) as ThemeManifest;
  const applied: Array<{ path: string; from?: string; to: string }> = [];
  const skipped: Array<{ path: string; reason: string }> = [];

  for (const f of report.findings) {
    const s = f.suggestion;
    if (!s) continue;
    // Reject instructional placeholders (e.g. "{ cornerRadius, ... }").
    if (/[\[\]{}]/.test(s.to)) {
      skipped.push({ path: s.path, reason: "non-mechanical placeholder" });
      continue;
    }
    // Mechanical: hex colors and "false"/"true" booleans.
    let value: unknown = s.to;
    if (s.to === "false") value = false;
    else if (s.to === "true") value = true;
    else if (HEX_RE.test(s.to)) value = s.to.toUpperCase();
    setByPath(out as unknown as Record<string, unknown>, s.path, value);
    applied.push({ path: s.path, ...(s.from ? { from: s.from } : {}), to: s.to });
  }

  return { manifest: out, applied, skipped };
}

function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (cur[key] === undefined || cur[key] === null || typeof cur[key] !== "object") {
      cur[key] = {};
    }
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

/** Render an audit report as a multi-line human string. */
export function formatAudit(report: AuditReport): string {
  const lines: string[] = [];
  const status = report.ok ? "OK" : "ISSUES";
  lines.push(`Theme: ${report.themeName}   Score: ${report.score}/100   Status: ${status}`);
  lines.push(`Errors: ${report.summary.errors}   Warnings: ${report.summary.warnings}   Infos: ${report.summary.infos}`);
  lines.push("");
  if (report.findings.length === 0) {
    lines.push("No findings. Theme passes all audit checks.");
    return lines.join("\n");
  }
  for (const f of report.findings) {
    const prefix =
      f.severity === "error" ? "[ERROR]" :
      f.severity === "warning" ? "[WARN]" : "[INFO]";
    lines.push(`${prefix} (${f.category}) ${f.message}`);
    if (f.suggestion) {
      const fromStr = f.suggestion.from ? ` from "${f.suggestion.from}"` : "";
      lines.push(`        suggest: ${f.suggestion.path}${fromStr} → "${f.suggestion.to}"`);
    }
  }
  return lines.join("\n");
}
