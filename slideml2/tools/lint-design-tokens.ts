/**
 * Lint design-token usage.
 *
 * Scans component bodies for upgraded components and flags any literal numeric
 * value still being passed to a spacing / radius / rail property — including
 * literals inside ternaries and helper variable declarations. Migrated
 * components must consume `spacing()` / `radius()` / `rail()` tokens (or the
 * literal 0), nothing else.
 *
 * Migrated components (must be token-only):
 *   - quoteBlockPlain / Pull / Card / Editorial / Portrait / AvatarNode (components.ts)
 *   - keyTakeawayPanel / Banner / Minimal / Metric / Grid / GridMini (components.ts)
 *   - comparison-list helpers + variants (component-registry.ts)
 *   - fact-list helpers + variants (component-registry.ts)
 *
 * Pending migration (not yet enforced):
 *   - other components in components.ts
 *   - other helpers in component-registry.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Window = { label: string; start: string; end: string | null };

const FILES: Array<{ path: string; windows: Window[] }> = [
  {
    path: "src/components.ts",
    windows: [
      { label: "quoteBlockPlain", start: "function quoteBlockPlain", end: "function quoteBlockPull" },
      { label: "quoteBlockPull", start: "function quoteBlockPull", end: "function quoteBlockCard" },
      { label: "quoteBlockCard", start: "function quoteBlockCard", end: "function quoteBlockEditorial" },
      { label: "quoteBlockEditorial", start: "function quoteBlockEditorial", end: "function quoteBlockPortrait" },
      { label: "quoteBlockPortrait", start: "function quoteBlockPortrait", end: "function quoteAvatarNode" },
      { label: "quoteAvatarNode", start: "function quoteAvatarNode", end: "export function " },
      { label: "keyTakeawayPanel", start: "function keyTakeawayPanel", end: "function keyTakeawayBanner" },
      { label: "keyTakeawayBanner", start: "function keyTakeawayBanner", end: "function keyTakeawayMinimal" },
      { label: "keyTakeawayMinimal", start: "function keyTakeawayMinimal", end: "function keyTakeawayMetric" },
      { label: "keyTakeawayMetric", start: "function keyTakeawayMetric", end: "function keyTakeawayGridMini" },
      { label: "keyTakeawayGridMini", start: "function keyTakeawayGridMini", end: "function keyTakeawayGrid" },
      { label: "keyTakeawayGrid", start: "function keyTakeawayGrid", end: "function weightedTextLength" },
    ],
  },
  {
    path: "src/component-registry.ts",
    windows: [
      { label: "comparison-list", start: "function comparisonHeaderNode", end: "function factSourcesRow" },
      { label: "fact-list", start: "function factListListNode", end: "function executiveSummaryNode" },
    ],
  },
];

/**
 * Spatial / chrome properties we enforce as token-only.
 *
 * Scope discipline:
 *   - `padding`, `gap`, `cornerRadius`, `accentWidth` are pure structural
 *     spacing. They MUST come from spacing()/radius()/rail() tokens.
 *   - `fixedWidth` / `fixedHeight` / `minHeight` are content-driven (icon size,
 *     avatar diameter, hero metric column width, text capacity). They're
 *     allowed to stay literal — they're not really "spacing".
 *   - `lineWidth` is a stroke thickness, not spacing. Not enforced here.
 *
 * If we later want a `border` token scale, we can add `lineWidth` back.
 */
const ENFORCED_PROPS = [
  "padding",
  "gap",
  "cornerRadius",
  "accentWidth",
];

/** Variable names that carry spatial values; their RHS must be token-derived. */
const ENFORCED_VAR_NAMES = [
  "padding",
  "outerPadding",
  "innerPadding",
  "cellPadding",
  "gap",
  "innerGap",
  "outerGap",
  "rowGap",
  "columnGap",
  "cornerRadius",
  "accentWidth",
  "railWidth",
];

const PROP_RE = new RegExp(`\\b(${ENFORCED_PROPS.join("|")})\\s*:`, "g");
const VAR_DECL_RE = new RegExp(`^\\s*const\\s+(${ENFORCED_VAR_NAMES.join("|")})\\s*=`, "");
const DECIMAL_RE = /\b\d+\.\d+\b/g;

/**
 * Strip token-helper calls and string literals from a snippet so the residue
 * can be searched for stray numeric literals.
 */
function stripAllowed(expr: string): string {
  let out = expr;
  // Strip spacing("xxx") / radius("xxx") / rail("xxx") / pt(<num>) calls
  out = out.replace(/\b(spacing|radius|rail|pt)\s*\([^)]*\)/g, "");
  // Strip string literals (single, double, backtick) so the numbers inside
  // don't read as code values.
  out = out.replace(/"[^"]*"/g, "\"\"");
  out = out.replace(/'[^']*'/g, "''");
  out = out.replace(/`[^`]*`/g, "``");
  return out;
}

interface Violation {
  file: string;
  line: number;
  window: string;
  kind: "prop" | "var";
  prop: string;
  snippet: string;
}

function extractValueExpression(text: string, valueStart: number): string {
  let depth = 0;
  let i = valueStart;
  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && (ch === "," || ch === ";" || ch === "\n")) {
      break;
    }
  }
  return text.slice(valueStart, i);
}

function lineNumber(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

function lineSnippet(text: string, offset: number): string {
  const lineStart = text.lastIndexOf("\n", offset) + 1;
  const lineEnd = text.indexOf("\n", offset);
  return text.slice(lineStart, lineEnd > 0 ? lineEnd : text.length).trim();
}

const violations: Violation[] = [];
const root = resolve(process.cwd());

for (const file of FILES) {
  const absolutePath = resolve(root, file.path);
  const text = readFileSync(absolutePath, "utf-8");
  for (const window of file.windows) {
    const start = text.indexOf(window.start);
    if (start < 0) continue;
    const end = window.end ? text.indexOf(window.end, start + window.start.length) : -1;
    const sliceStart = start;
    const sliceEnd = end > 0 ? end : text.length;

    // Pass 1: property assignments. Walk each PROP_RE match, capture the value
    // expression that follows, and look for stray decimal literals after we
    // strip token calls / string literals.
    PROP_RE.lastIndex = sliceStart;
    let m: RegExpExecArray | null;
    while ((m = PROP_RE.exec(text)) !== null) {
      if (m.index >= sliceEnd) break;
      const propName = m[1]!;
      // Find the value expression after the colon.
      const colonIdx = text.indexOf(":", m.index);
      if (colonIdx < 0) continue;
      const valueStart = colonIdx + 1;
      const expr = extractValueExpression(text, valueStart);
      const residue = stripAllowed(expr);
      if (DECIMAL_RE.test(residue)) {
        violations.push({
          file: file.path,
          line: lineNumber(text, m.index),
          window: window.label,
          kind: "prop",
          prop: propName,
          snippet: lineSnippet(text, m.index),
        });
      }
      DECIMAL_RE.lastIndex = 0;
    }

    // Pass 2: variable declarations whose name suggests spatial intent.
    const slice = text.slice(sliceStart, sliceEnd);
    const lines = slice.split("\n");
    let runningOffset = sliceStart;
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]!;
      const match = line.match(VAR_DECL_RE);
      if (match) {
        // Capture the RHS through the next semicolon.
        const localOffset = slice.indexOf(line, runningOffset - sliceStart);
        const absOffset = sliceStart + localOffset;
        const eqIdx = text.indexOf("=", absOffset);
        if (eqIdx > 0) {
          const expr = extractValueExpression(text, eqIdx + 1);
          const residue = stripAllowed(expr);
          if (DECIMAL_RE.test(residue)) {
            violations.push({
              file: file.path,
              line: lineNumber(text, absOffset),
              window: window.label,
              kind: "var",
              prop: match[1]!,
              snippet: line.trim(),
            });
          }
          DECIMAL_RE.lastIndex = 0;
        }
      }
      runningOffset += line.length + 1;
    }
  }
}

if (violations.length > 0) {
  for (const v of violations) {
    const tag = v.kind === "prop" ? "literal prop value" : "literal value bound to spatial-named variable";
    console.error(`${v.file}:${v.line}  [${v.window}]  ${tag} (${v.prop}): use spacing()/radius()/rail() token`);
    console.error(`  ${v.snippet}`);
  }
  console.error(`\n${violations.length} design-token violation(s) found.`);
  process.exit(1);
}
console.log(`design-token lint: OK (scanned ${FILES.reduce((n, f) => n + f.windows.length, 0)} windows)`);
