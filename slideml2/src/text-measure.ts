import { preferredFont, resolveFontWeight, type FontWeight, type SimpleTheme } from "./theme.js";
import { FONT_METRICS_PACK } from "./font-metrics-pack.js";

export const PT_TO_CM = 0.0353;

export interface TextWrapMetrics {
  lines: number;
  widthCm: number;
  unbreakableCm: number;
}

export interface TextMeasurer {
  glyphAdvance(ch: string, fontPt: number, weight?: FontWeight): number;
  lineHeight(fontPt: number, lineHeight: number, family?: string): number;
  wrapLines(text: string, fontPt: number, weight: FontWeight | undefined, maxWidthCm: number): TextWrapMetrics;
  ascentDescent(fontPt: number, family?: string): { ascentCm: number; descentCm: number };
  textWidth(text: string, fontPt: number, weight?: FontWeight): number;
  unbreakableWidth(text: string, fontPt: number, weight?: FontWeight): number;
}

export function createHeuristicTextMeasurer(theme: SimpleTheme): TextMeasurer {
  return new HeuristicTextMeasurer(theme);
}

export function createMetricPackTextMeasurer(theme: SimpleTheme): TextMeasurer {
  return new MetricPackTextMeasurer(theme, createHeuristicTextMeasurer(theme));
}

export function createTextMeasurer(theme: SimpleTheme): TextMeasurer {
  return createMetricPackTextMeasurer(theme);
}

class HeuristicTextMeasurer implements TextMeasurer {
  constructor(private readonly theme: SimpleTheme) {}

  glyphAdvance(ch: string, fontPt: number, weight?: FontWeight): number {
    if (ch === "\u2060") return 0;
    if (isCjkOrFullWidth(ch)) return fontPt * PT_TO_CM * 1.02;
    if (/\s/.test(ch)) return this.averageLatinAdvance(fontPt, weight) * 0.45;
    if (isWideVisualSymbol(ch)) return fontPt * PT_TO_CM * 0.9;
    if (/[ilI1|.,:;]/.test(ch)) return this.averageLatinAdvance(fontPt, weight) * 0.55;
    if (/[MW@#%&]/.test(ch)) return this.averageLatinAdvance(fontPt, weight) * 1.25;
    return this.averageLatinAdvance(fontPt, weight);
  }

  lineHeight(fontPt: number, lineHeight: number, family?: string): number {
    const metrics = this.ascentDescent(fontPt, family);
    const natural = normalizedNaturalLineHeightCm(fontPt, family, metrics);
    return Math.max(natural, fontPt * PT_TO_CM * lineHeight);
  }

  wrapLines(text: string, fontPt: number, weight: FontWeight | undefined, maxWidthCm: number): TextWrapMetrics {
    return measureWrappedText(text, fontPt, weight, maxWidthCm, this);
  }

  ascentDescent(fontPt: number, _family?: string): { ascentCm: number; descentCm: number } {
    const em = fontPt * PT_TO_CM;
    return { ascentCm: em * 0.8, descentCm: em * 0.2 };
  }

  textWidth(text: string, fontPt: number, weight?: FontWeight): number {
    let width = 0;
    for (const ch of text) width += this.glyphAdvance(ch, fontPt, weight);
    return width;
  }

  unbreakableWidth(text: string, fontPt: number, weight?: FontWeight): number {
    return unbreakableSegmentWidth(text, fontPt, weight, this);
  }

  private averageLatinAdvance(fontPt: number, weight?: FontWeight): number {
    const latin = preferredFont(this.theme, "latin").toLowerCase();
    // Calibrated against LibreOffice headless renders. Aptos/Calibri at small
    // body sizes is ~0.0185 cm/pt, while bold display text widens due to
    // heavier strokes and looser kerning in headless mode.
    const base = latin.includes("aptos") || latin.includes("calibri") ? 0.019 : latin.includes("arial") ? 0.0195 : 0.019;
    const bold = resolveFontWeight(weight).bold;
    const boldFactor = bold ? (fontPt >= 22 ? 1.18 : 1.10) : 1;
    return fontPt * base * boldFactor;
  }
}

class MetricPackTextMeasurer implements TextMeasurer {
  constructor(
    private readonly theme: SimpleTheme,
    private readonly fallback: TextMeasurer,
  ) {}

  glyphAdvance(ch: string, fontPt: number, weight?: FontWeight): number {
    const face = this.faceForChar(ch, weight);
    if (!face) return this.fallback.glyphAdvance(ch, fontPt, weight);
    return this.advanceEm(face, ch) * fontPt * PT_TO_CM;
  }

  lineHeight(fontPt: number, lineHeight: number, family?: string): number {
    const metrics = this.ascentDescent(fontPt, family);
    const natural = normalizedNaturalLineHeightCm(fontPt, family, metrics);
    return Math.max(natural, fontPt * PT_TO_CM * lineHeight);
  }

  wrapLines(text: string, fontPt: number, weight: FontWeight | undefined, maxWidthCm: number): TextWrapMetrics {
    return measureWrappedText(text, fontPt, weight, maxWidthCm, this);
  }

  ascentDescent(fontPt: number, family?: string): { ascentCm: number; descentCm: number } {
    const face = this.faceForFamily(family || preferredFont(this.theme, "latin"), "regular");
    if (!face) return this.fallback.ascentDescent(fontPt, family);
    return {
      ascentCm: Math.max(0, face.ascent) * fontPt * PT_TO_CM,
      descentCm: Math.abs(Math.min(0, face.descent)) * fontPt * PT_TO_CM,
    };
  }

  textWidth(text: string, fontPt: number, weight?: FontWeight): number {
    let widthCm = 0;
    let prev = "";
    let prevFaceKey = "";
    for (const ch of text) {
      const faceInfo = this.faceInfoForChar(ch, weight);
      if (!faceInfo) {
        widthCm += this.fallback.glyphAdvance(ch, fontPt, weight);
        prev = "";
        prevFaceKey = "";
        continue;
      }
      const { face, key } = faceInfo;
      if (prev && prevFaceKey === key) {
        widthCm += Number(face.kerning?.[`${prev}${ch}`] ?? 0) * fontPt * PT_TO_CM;
      }
      widthCm += this.advanceEm(face, ch) * fontPt * PT_TO_CM;
      prev = ch;
      prevFaceKey = key;
    }
    return widthCm;
  }

  unbreakableWidth(text: string, fontPt: number, weight?: FontWeight): number {
    return unbreakableSegmentWidth(text, fontPt, weight, this);
  }

  private faceForChar(ch: string, weight?: FontWeight): FontMetricFace | undefined {
    return this.faceInfoForChar(ch, weight)?.face;
  }

  private faceInfoForChar(ch: string, weight?: FontWeight): { key: string; face: FontMetricFace } | undefined {
    const family = isCjkOrFullWidth(ch)
      ? preferredFont(this.theme, "cjk")
      : preferredFont(this.theme, "latin");
    const key = this.faceKeyForFamily(family, resolveFontWeight(weight).bold ? "bold" : "regular");
    const face = key ? fontMetricFaces[key] : undefined;
    return key && face ? { key, face } : undefined;
  }

  private faceForFamily(family: string, weight: "regular" | "bold"): FontMetricFace | undefined {
    const key = this.faceKeyForFamily(family, weight);
    return key ? fontMetricFaces[key] : undefined;
  }

  private faceKeyForFamily(family: string, weight: "regular" | "bold"): string | undefined {
    const normalized = normalizeFontAlias(family);
    const mapped = fontMetricAliases[normalized]
      || (normalized.includes("cjk") || normalized.includes("pingfang") || normalized.includes("yahei") || normalized.includes("hiragino") || normalized === "system-ui" || normalized === "apple-system"
        ? fontMetricAliases["noto-sans-cjk-sc"]
        : fontMetricAliases.arial);
    return mapped?.[weight] || mapped?.regular;
  }

  private advanceEm(face: FontMetricFace, ch: string): number {
    const exact = face.advances?.[ch];
    if (typeof exact === "number") return exact;
    if (ch === "\u2060") return 0;
    if (isCjkOrFullWidth(ch)) return face.buckets?.cjk ?? 1.0;
    if (/\s/.test(ch)) return face.buckets?.space ?? 0.28;
    if (isWideVisualSymbol(ch)) return face.buckets?.symbol ?? 0.9;
    if (/[0-9]/.test(ch)) return face.buckets?.digit ?? face.buckets?.latin ?? 0.55;
    if (/[ilI1|.,:;]/.test(ch)) return face.buckets?.narrow ?? face.buckets?.latin ?? 0.35;
    if (/[MW@#%&]/.test(ch)) return face.buckets?.wide ?? face.buckets?.latin ?? 0.75;
    return face.buckets?.latin ?? 0.55;
  }
}

interface FontMetricFace {
  ascent: number;
  descent: number;
  buckets: Record<string, number>;
  advances: Record<string, number>;
  kerning: Record<string, number>;
}

const fontMetricFaces = FONT_METRICS_PACK.faces as unknown as Record<string, FontMetricFace>;
const fontMetricAliases = FONT_METRICS_PACK.aliases as unknown as Record<string, { regular: string; bold: string }>;

interface BreakSegment {
  text: string;
  whitespace?: boolean;
}

const LATIN_BREAK_AFTER = new Set(["-", "/", "\\", "_", "@", ".", ":", "+", "="]);
const PROHIBITED_LINE_START = new Set(["，", "。", "、", "；", "：", "！", "？", "）", "】", "》", "」", "』", "〉", ")", "]", "}", ",", ".", ";", ":", "!", "?"]);
const PROHIBITED_LINE_END = new Set(["（", "【", "《", "「", "『", "〈", "(", "[", "{"]);

function measureWrappedText(
  text: string,
  fontPt: number,
  weight: FontWeight | undefined,
  maxWidthCm: number,
  measurer: Pick<TextMeasurer, "textWidth">,
): TextWrapMetrics {
  const usable = Math.max(0.25, maxWidthCm * wrapSafetyFactor(text, weight));
  const hardLines = String(text || "").split(/\r?\n/);
  let lineCount = 0;
  let widthCm = 0;
  let unbreakableCm = 0;
  for (const line of hardLines) {
    const totalWidth = measurer.textWidth(line, fontPt, weight);
    const segments = breakSegments(line);
    const segmentWidths = segments.map((segment) => ({
      ...segment,
      width: measurer.textWidth(segment.text, fontPt, weight),
    }));
    widthCm = Math.max(widthCm, totalWidth);
    unbreakableCm = Math.max(
      unbreakableCm,
      ...segmentWidths.filter((segment) => !segment.whitespace).map((segment) => segment.width),
      0,
    );
    lineCount += greedyLineCount(segmentWidths, usable);
  }
  return { lines: lineCount, widthCm, unbreakableCm };
}

function wrapSafetyFactor(text: string, weight: FontWeight | undefined): number {
  const hasCjk = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(text);
  const hasLatin = /[A-Za-z0-9]/.test(text);
  if (hasCjk && hasLatin) return resolveFontWeight(weight).bold ? 0.94 : 0.96;
  return 1;
}

function unbreakableSegmentWidth(
  text: string,
  fontPt: number,
  weight: FontWeight | undefined,
  measurer: Pick<TextMeasurer, "textWidth">,
): number {
  return Math.max(
    0,
    ...breakSegments(text)
      .filter((segment) => !segment.whitespace)
      .map((segment) => measurer.textWidth(segment.text, fontPt, weight)),
  );
}

function greedyLineCount(segments: Array<BreakSegment & { width: number }>, usable: number): number {
  if (segments.length === 0) return 1;
  let lines = 1;
  let lineWidth = 0;
  for (const segment of segments) {
    if (segment.whitespace && lineWidth === 0) continue;
    if (segment.whitespace && lineWidth + segment.width > usable) {
      lines++;
      lineWidth = 0;
      continue;
    }
    if (lineWidth === 0) {
      if (segment.whitespace) {
        lineWidth = 0;
      } else if (segment.width > usable && segmentCanWrapInternally(segment.text)) {
        const forcedLines = Math.max(1, Math.ceil(segment.width / usable));
        lines += forcedLines - 1;
        lineWidth = residualWrappedWidth(segment.width, usable, forcedLines);
      } else {
        lineWidth = segment.width;
      }
      continue;
    }
    if (lineWidth + segment.width <= usable + 0.001) {
      lineWidth += segment.width;
      continue;
    }
    lines++;
    if (segment.whitespace) {
      lineWidth = 0;
    } else if (segment.width > usable && segmentCanWrapInternally(segment.text)) {
      const forcedLines = Math.max(1, Math.ceil(segment.width / usable));
      lines += forcedLines - 1;
      lineWidth = residualWrappedWidth(segment.width, usable, forcedLines);
    } else {
      lineWidth = segment.width;
    }
  }
  return lines;
}

function segmentCanWrapInternally(text: string): boolean {
  return /[\s\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(text);
}

function residualWrappedWidth(width: number, usable: number, lines: number): number {
  const residual = width - usable * Math.max(0, lines - 1);
  return residual <= 0.001 ? usable : Math.min(usable, residual);
}

function breakSegments(text: string): BreakSegment[] {
  const out: BreakSegment[] = [];
  let current = "";
  const flush = () => {
    if (!current) return;
    out.push({ text: current });
    current = "";
  };

  for (const ch of String(text || "")) {
    if (/\s/.test(ch)) {
      flush();
      out.push({ text: ch, whitespace: true });
      continue;
    }

    if (isCjkOrFullWidth(ch)) {
      flush();
      if (PROHIBITED_LINE_START.has(ch) && out.length > 0) {
        out[out.length - 1]!.text += ch;
      } else if (out.length > 0 && endsWithProhibitedLineEnd(out[out.length - 1]!.text)) {
        out[out.length - 1]!.text += ch;
      } else {
        out.push({ text: ch });
      }
      continue;
    }

    current += ch;
    if (LATIN_BREAK_AFTER.has(ch)) flush();
  }
  flush();
  return out;
}

function endsWithProhibitedLineEnd(text: string): boolean {
  const chars = [...text];
  const last = chars[chars.length - 1];
  return last !== undefined && PROHIBITED_LINE_END.has(last);
}

export function isCjkOrFullWidth(ch: string): boolean {
  return /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch);
}

export function isWideVisualSymbol(ch: string): boolean {
  return /[\u2605\u2606\u2713\u2714\u2717\u2715\u2716\u26a0\u25cf\u25cb\u25c6\u25c7\u25a0\u25a1\u25b2\u25b3\u25b6\u25b7\u25bc\u25bd]/.test(ch);
}

function normalizeFontAlias(value: string): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normalizedNaturalLineHeightCm(fontPt: number, family: string | undefined, metrics: { ascentCm: number; descentCm: number }): number {
  const raw = Math.max(0.01, metrics.ascentCm + metrics.descentCm);
  const normalizedFamily = family ? normalizeFontAlias(family) : "";
  const isCjkFamily = normalizedFamily.includes("cjk")
    || normalizedFamily.includes("pingfang")
    || normalizedFamily.includes("yahei")
    || normalizedFamily.includes("simsun")
    || normalizedFamily.includes("songti")
    || normalizedFamily.includes("hiragino");
  // Some CJK fonts report a very tall global bbox (PingFang is ~1.4em).
  // PowerPoint text boxes use a tighter renderer line box; using the full
  // font bbox as the natural line-height floor creates false-positive
  // SQUASHED/overflow diagnostics for normal 10-12pt labels.
  const cap = fontPt * PT_TO_CM * (isCjkFamily ? 1.12 : 1.16);
  return Math.min(raw, cap);
}
