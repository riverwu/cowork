const GREEK_AND_SYMBOLS: Record<string, string> = {
  alpha: "\u03B1",
  beta: "\u03B2",
  gamma: "\u03B3",
  delta: "\u03B4",
  epsilon: "\u03B5",
  zeta: "\u03B6",
  eta: "\u03B7",
  theta: "\u03B8",
  iota: "\u03B9",
  kappa: "\u03BA",
  lambda: "\u03BB",
  mu: "\u03BC",
  nu: "\u03BD",
  xi: "\u03BE",
  pi: "\u03C0",
  rho: "\u03C1",
  sigma: "\u03C3",
  tau: "\u03C4",
  upsilon: "\u03C5",
  phi: "\u03C6",
  chi: "\u03C7",
  psi: "\u03C8",
  omega: "\u03C9",
  Gamma: "\u0393",
  Delta: "\u0394",
  Theta: "\u0398",
  Lambda: "\u039B",
  Xi: "\u039E",
  Pi: "\u03A0",
  Sigma: "\u03A3",
  Phi: "\u03A6",
  Psi: "\u03A8",
  Omega: "\u03A9",
  pm: "\u00B1",
  times: "\u00D7",
  cdot: "\u00B7",
  le: "\u2264",
  leq: "\u2264",
  ge: "\u2265",
  geq: "\u2265",
  neq: "\u2260",
  approx: "\u2248",
  infty: "\u221E",
  sum: "\u2211",
  int: "\u222B",
  partial: "\u2202",
  degree: "\u00B0",
  implies: "\u21D2",
  to: "\u2192",
  rightarrow: "\u2192",
  leftarrow: "\u2190",
  leftrightarrow: "\u2194",
  qquad: " ",
  quad: " ",
};

const LATEX_FUNCTION_NAMES = ["sin", "cos", "tan", "cot", "sec", "csc", "log", "ln", "exp", "lim", "min", "max"];
const LATEX_FUNCTION_PATTERN = LATEX_FUNCTION_NAMES.join("|");
const SCRIPT_CHARS = "\u00B9\u00B2\u00B3\u2070\u2074-\u207F\u2080-\u209F";

const SUPER: Record<string, string> = {
  "0": "\u2070",
  "1": "\u00B9",
  "2": "\u00B2",
  "3": "\u00B3",
  "4": "\u2074",
  "5": "\u2075",
  "6": "\u2076",
  "7": "\u2077",
  "8": "\u2078",
  "9": "\u2079",
  "+": "\u207A",
  "-": "\u207B",
  "=": "\u207C",
  "(": "\u207D",
  ")": "\u207E",
  n: "\u207F",
  i: "\u2071",
};

const SUB: Record<string, string> = {
  "0": "\u2080",
  "1": "\u2081",
  "2": "\u2082",
  "3": "\u2083",
  "4": "\u2084",
  "5": "\u2085",
  "6": "\u2086",
  "7": "\u2087",
  "8": "\u2088",
  "9": "\u2089",
  "+": "\u208A",
  "-": "\u208B",
  "=": "\u208C",
  "(": "\u208D",
  ")": "\u208E",
  a: "\u2090",
  e: "\u2091",
  h: "\u2095",
  i: "\u1D62",
  j: "\u2C7C",
  k: "\u2096",
  l: "\u2097",
  m: "\u2098",
  n: "\u2099",
  o: "\u2092",
  p: "\u209A",
  r: "\u1D63",
  s: "\u209B",
  t: "\u209C",
  u: "\u1D64",
  v: "\u1D65",
  x: "\u2093",
};

export function richInlinePlainText(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return String(raw);
  if (typeof raw !== "object" || Array.isArray(raw)) return "";
  const rec = raw as Record<string, unknown>;
  const kind = typeof rec.kind === "string" ? rec.kind : "text";
  if (kind === "math") return latexToMathText(typeof rec.latex === "string" ? rec.latex : String(rec.text ?? ""));
  if (kind === "cite") return typeof rec.text === "string" ? rec.text : `[${String(rec.refId ?? "?")}]`;
  if (kind === "footnoteRef") return typeof rec.text === "string" ? rec.text : `[${String(rec.footnoteId ?? "?")}]`;
  if (kind === "icon") return typeof rec.alt === "string" ? rec.alt : typeof rec.marker === "string" ? rec.marker : "";
  if (kind === "token") return typeof rec.text === "string" ? rec.text : formatRichToken(rec.value, rec.format);
  return typeof rec.text === "string" ? rec.text : "";
}

export function richRunsPlainText(runs: unknown[] | undefined): string {
  if (!Array.isArray(runs)) return "";
  const parts: string[] = [];
  for (const run of runs) {
    if (run && typeof run === "object" && !Array.isArray(run) && (run as Record<string, unknown>).breakLine === true && parts.length > 0) parts.push("\n");
    parts.push(richInlinePlainText(run));
  }
  return parts.join("");
}

export function formatRichToken(value: unknown, format: unknown): string {
  if (value === undefined || value === null) return "";
  const fmt = typeof format === "string" ? format : "plain";
  if (typeof value === "number" && Number.isFinite(value)) {
    if (fmt === "int") return Math.round(value).toLocaleString("en-US");
    if (fmt === "decimal" || fmt === "number") return value.toLocaleString("en-US", { maximumFractionDigits: fmt === "decimal" ? 2 : 1 });
    if (fmt === "percent") {
      const pct = Math.abs(value) <= 1 ? value * 100 : value;
      return `${pct.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
    }
    if (fmt === "currency") return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  return String(value);
}

export function latexToMathText(latex: string): string {
  let text = String(latex || "");
  text = text.replace(/\r\n/g, "\n");
  text = replaceEnvironment(text);
  text = replaceKnownSymbolCommands(text);
  text = replaceCommandWithTwoArgs(text, "\\frac", formatFractionText);
  text = replaceCommandWithOneArg(text, "\\sqrt", (a) => `\u221A(${latexToMathText(a)})`);
  text = replaceCommandWithOneArg(text, "\\boxed", (a) => latexToMathText(a));
  text = replaceCommandWithOneArg(text, "\\text", (a) => a);
  text = replaceCommandWithOneArg(text, "\\mathrm", (a) => a);
  text = replaceCommandWithOneArg(text, "\\vec", (a) => `${latexToMathText(a)}\u20D7`);
  text = replaceCommandWithOneArg(text, "\\bar", (a) => `${latexToMathText(a)}\u0305`);
  text = replaceCommandWithOneArg(text, "\\hat", (a) => `${latexToMathText(a)}\u0302`);
  text = replaceSuperSubscripts(text);
  text = text
    .replace(/\\left|\\right/g, "")
    .replace(/\\,/g, " ")
    .replace(/\\;/g, " ")
    .replace(/\\:/g, " ")
    .replace(/\\!/g, "")
    .replace(/\\\\/g, "\n");
  text = text.replace(/\\([A-Za-z]+)/g, (_match, name: string) => GREEK_AND_SYMBOLS[name] || name);
  text = text.replace(/[{}]/g, "");
  return normalizeMathSpacing(text);
}

function replaceKnownSymbolCommands(input: string): string {
  const names = Object.keys(GREEK_AND_SYMBOLS).sort((a, b) => b.length - a.length).join("|");
  return input.replace(new RegExp(`\\\\(${names})`, "g"), (_match, name: string) => GREEK_AND_SYMBOLS[name] || name);
}

function formatFractionText(a: string, b: string): string {
  const numerator = latexToMathText(a);
  const denominator = latexToMathText(b);
  return `${fractionPart(numerator)}/${fractionPart(denominator)}`;
}

function fractionPart(value: string): string {
  const clean = value.trim();
  if (!clean) return clean;
  if (isSimpleFractionPart(clean)) return clean;
  return `(${clean})`;
}

function isSimpleFractionPart(value: string): boolean {
  const atom = "[A-Za-z0-9\\u0370-\\u03FF\\u2070-\\u209F.]+";
  if (new RegExp(`^${atom}$`).test(value)) return true;
  return new RegExp(`^(?:${LATEX_FUNCTION_PATTERN})\\s+${atom}$`).test(value);
}

function normalizeMathSpacing(input: string): string {
  let text = input;
  text = text.replace(new RegExp(`([0-9A-Za-z\\u0370-\\u03FF${SCRIPT_CHARS}])(?=(?:${LATEX_FUNCTION_PATTERN})\\b)`, "g"), "$1 ");
  text = text.replace(new RegExp(`\\b(${LATEX_FUNCTION_PATTERN})([${SCRIPT_CHARS}]*)\\s*`, "g"), "$1$2 ");
  text = text.replace(new RegExp(`\\b(${LATEX_FUNCTION_PATTERN})([${SCRIPT_CHARS}]*)\\s+\\(`, "g"), "$1$2(");
  text = text.replace(/\s*([=+±])\s*/g, " $1 ");
  text = text.replace(/\s*-\s*/g, " - ");
  text = text.replace(/\s*\/\s*/g, "/");
  text = text.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
  text = text.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
  return text;
}

function replaceEnvironment(input: string): string {
  return input.replace(/\\begin\{(matrix|pmatrix|bmatrix|cases)\}([\s\S]*?)\\end\{\1\}/g, (_match, env: string, body: string) => {
    const rows = body.split(/\\\\/g).map((row) => row.split("&").map((cell) => latexToMathText(cell.trim())).join("  "));
    const joined = rows.join("; ");
    if (env === "pmatrix") return `(${joined})`;
    if (env === "bmatrix") return `[${joined}]`;
    return joined;
  });
}

function replaceCommandWithOneArg(input: string, command: string, format: (a: string) => string): string {
  let text = input;
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf(command, cursor);
    if (start < 0) break;
    const a = readLatexGroup(text, start + command.length);
    if (!a) {
      cursor = start + command.length;
      continue;
    }
    text = `${text.slice(0, start)}${format(a.value)}${text.slice(a.end)}`;
    cursor = start + 1;
  }
  return text;
}

function replaceCommandWithTwoArgs(input: string, command: string, format: (a: string, b: string) => string): string {
  let text = input;
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf(command, cursor);
    if (start < 0) break;
    const a = readLatexGroup(text, start + command.length);
    const b = a ? readLatexGroup(text, a.end) : null;
    if (!a || !b) {
      cursor = start + command.length;
      continue;
    }
    text = `${text.slice(0, start)}${format(a.value, b.value)}${text.slice(b.end)}`;
    cursor = start + 1;
  }
  return text;
}

function replaceSuperSubscripts(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch !== "^" && ch !== "_") {
      out += ch;
      continue;
    }
    const group = readLatexGroup(input, i + 1);
    if (group) {
      out += mapScript(group.value, ch === "^" ? SUPER : SUB);
      i = group.end - 1;
      continue;
    }
    const next = input[i + 1] || "";
    out += mapScript(next, ch === "^" ? SUPER : SUB);
    i += next ? 1 : 0;
  }
  return out;
}

function mapScript(value: string, table: Record<string, string>): string {
  let out = "";
  for (const ch of value) {
    out += table[ch] || ch;
  }
  return out;
}

function readLatexGroup(input: string, index: number): { value: string; end: number } | null {
  let i = index;
  while (/\s/.test(input[i] || "")) i++;
  if (input[i] !== "{") return null;
  let depth = 0;
  let value = "";
  for (; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === "{") {
      if (depth > 0) value += ch;
      depth++;
      continue;
    }
    if (ch === "}") {
      depth--;
      if (depth === 0) return { value, end: i + 1 };
      value += ch;
      continue;
    }
    value += ch;
  }
  return null;
}
