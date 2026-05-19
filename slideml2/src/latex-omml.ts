import { xmlEscape } from "./emitter/xml.js";

const COMMAND_SYMBOLS: Record<string, string> = {
  "%": "%",
  "&": "&",
  "$": "$",
  "#": "#",
  "_": "_",
  "{": "{",
  "}": "}",
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
};

const FUNCTION_NAMES = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "log", "ln", "exp", "lim", "min", "max"]);
const IGNORED_COMMANDS = new Set(["left", "right", "quad", "qquad", ",", ";", ":", "!"]);

type Atom =
  | { kind: "seq"; items: Atom[] }
  | { kind: "text"; text: string }
  | { kind: "frac"; num: Atom; den: Atom }
  | { kind: "sqrt"; body: Atom }
  | { kind: "box"; body: Atom }
  | { kind: "accent"; char: string; body: Atom }
  | { kind: "sup"; base: Atom; sup: Atom }
  | { kind: "sub"; base: Atom; sub: Atom }
  | { kind: "subsup"; base: Atom; sub: Atom; sup: Atom };

export interface LatexOmmlResult {
  ok: boolean;
  omml?: string;
  mathText?: string;
  unsupported: string[];
}

export function latexToOmml(latex: string, options: { align?: "left" | "center" | "right" } = {}): LatexOmmlResult {
  const parser = new LatexParser(String(latex || ""));
  const ast = parser.parse();
  if (parser.unsupported.size > 0) return { ok: false, unsupported: [...parser.unsupported].sort() };
  const omath = `<m:oMath>${atomToOmml(ast)}</m:oMath>`;
  const jc = options.align ? `<m:oMathParaPr><m:jc m:val="${options.align === "center" ? "center" : options.align === "right" ? "right" : "left"}"/></m:oMathParaPr>` : "";
  return {
    ok: true,
    unsupported: [],
    omml: `<m:oMathPara>${jc}${omath}</m:oMathPara>`,
  };
}

export function unsupportedLatexCommands(latex: string): string[] {
  const parser = new LatexParser(String(latex || ""));
  parser.parse();
  return [...parser.unsupported].sort();
}

class LatexParser {
  index = 0;
  unsupported = new Set<string>();

  constructor(private readonly source: string) {}

  parse(): Atom {
    return this.parseExpression();
  }

  private parseExpression(stop = ""): Atom {
    const items: Atom[] = [];
    while (this.index < this.source.length) {
      if (stop && this.source[this.index] === stop) {
        this.index++;
        break;
      }
      const atom = this.parseScriptedAtom();
      if (atom) items.push(atom);
    }
    return { kind: "seq", items };
  }

  private parseScriptedAtom(): Atom | null {
    let base = this.parseAtom();
    if (!base) return null;
    let sub: Atom | undefined;
    let sup: Atom | undefined;
    while (this.peek() === "_" || this.peek() === "^") {
      const marker = this.source[this.index++]!;
      const script = this.parseScriptArgument();
      if (marker === "_") sub = script;
      else sup = script;
    }
    if (sub && sup) return { kind: "subsup", base, sub, sup };
    if (sub) return { kind: "sub", base, sub };
    if (sup) return { kind: "sup", base, sup };
    return base;
  }

  private parseAtom(): Atom | null {
    const ch = this.source[this.index];
    if (ch === undefined) return null;
    if (ch === "{") {
      this.index++;
      return this.parseExpression("}");
    }
    if (ch === "}") {
      this.index++;
      return null;
    }
    if (ch === "\\") return this.parseCommand();
    this.index++;
    return { kind: "text", text: ch };
  }

  private parseCommand(): Atom | null {
    this.index++;
    const start = this.index;
    while (/[A-Za-z]/.test(this.source[this.index] || "")) this.index++;
    const name = this.source.slice(start, this.index) || this.source[this.index++] || "";
    if (IGNORED_COMMANDS.has(name)) return { kind: "text", text: name === "quad" || name === "qquad" || name === "," || name === ";" || name === ":" ? " " : "" };
    if (name === "\\") return { kind: "text", text: "\n" };
    if (name === " " || name === "~") return { kind: "text", text: " " };
    if (name === "frac") return { kind: "frac", num: this.readRequiredGroup(name), den: this.readRequiredGroup(name) };
    if (name === "sqrt") return { kind: "sqrt", body: this.readRequiredGroup(name) };
    if (name === "boxed") return { kind: "box", body: this.readRequiredGroup(name) };
    if (name === "vec") return { kind: "accent", char: "\u20D7", body: this.readRequiredGroup(name) };
    if (name === "bar") return { kind: "accent", char: "\u0305", body: this.readRequiredGroup(name) };
    if (name === "hat") return { kind: "accent", char: "\u0302", body: this.readRequiredGroup(name) };
    if (name === "text" || name === "mathrm") return { kind: "text", text: atomPlainText(this.readRequiredGroup(name)) };
    if (FUNCTION_NAMES.has(name)) return { kind: "text", text: name };
    if (COMMAND_SYMBOLS[name]) return { kind: "text", text: COMMAND_SYMBOLS[name] };
    this.unsupported.add(`\\${name}`);
    return { kind: "text", text: "" };
  }

  private parseScriptArgument(): Atom {
    if (this.peek() === "{") {
      this.index++;
      return this.parseExpression("}");
    }
    return this.parseAtom() || { kind: "text", text: "" };
  }

  private readRequiredGroup(command: string): Atom {
    this.skipSpaces();
    if (this.peek() !== "{") {
      const atom = this.parseAtom();
      if (atom) return atom;
      this.unsupported.add(`\\${command} missing-group`);
      return { kind: "text", text: "" };
    }
    this.index++;
    return this.parseExpression("}");
  }

  private skipSpaces(): void {
    while (/\s/.test(this.source[this.index] || "")) this.index++;
  }

  private peek(): string | undefined {
    return this.source[this.index];
  }
}

function atomToOmml(atom: Atom): string {
  switch (atom.kind) {
    case "seq":
      return atom.items.map(atomToOmml).join("");
    case "text":
      return atom.text ? `<m:r><m:t xml:space="preserve">${xmlEscape(atom.text)}</m:t></m:r>` : "";
    case "frac":
      return `<m:f><m:fPr><m:type m:val="bar"/></m:fPr><m:num>${atomToOmml(atom.num)}</m:num><m:den>${atomToOmml(atom.den)}</m:den></m:f>`;
    case "sqrt":
      return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${atomToOmml(atom.body)}</m:e></m:rad>`;
    case "box":
      return `<m:borderBox><m:e>${atomToOmml(atom.body)}</m:e></m:borderBox>`;
    case "accent":
      return `<m:acc><m:accPr><m:chr m:val="${xmlEscape(atom.char)}"/></m:accPr><m:e>${atomToOmml(atom.body)}</m:e></m:acc>`;
    case "sup":
      return `<m:sSup><m:e>${atomToOmml(atom.base)}</m:e><m:sup>${atomToOmml(atom.sup)}</m:sup></m:sSup>`;
    case "sub":
      return `<m:sSub><m:e>${atomToOmml(atom.base)}</m:e><m:sub>${atomToOmml(atom.sub)}</m:sub></m:sSub>`;
    case "subsup":
      return `<m:sSubSup><m:e>${atomToOmml(atom.base)}</m:e><m:sub>${atomToOmml(atom.sub)}</m:sub><m:sup>${atomToOmml(atom.sup)}</m:sup></m:sSubSup>`;
  }
}

function atomPlainText(atom: Atom): string {
  switch (atom.kind) {
    case "seq":
      return atom.items.map(atomPlainText).join("");
    case "text":
      return atom.text;
    case "frac":
      return `${atomPlainText(atom.num)}/${atomPlainText(atom.den)}`;
    case "sqrt":
      return `sqrt(${atomPlainText(atom.body)})`;
    case "box":
      return atomPlainText(atom.body);
    case "accent":
      return atomPlainText(atom.body);
    case "sup":
      return `${atomPlainText(atom.base)}^${atomPlainText(atom.sup)}`;
    case "sub":
      return `${atomPlainText(atom.base)}_${atomPlainText(atom.sub)}`;
    case "subsup":
      return `${atomPlainText(atom.base)}_${atomPlainText(atom.sub)}^${atomPlainText(atom.sup)}`;
  }
}
