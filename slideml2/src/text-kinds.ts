export type TextKind =
  | "deck-title"
  | "slide-title"
  | "section-title"
  | "card-title"
  | "label"
  | "lead"
  | "paragraph"
  | "body-small"
  | "caption"
  | "figure-caption"
  | "footnote"
  | "bullet"
  | "bullet-compact"
  | "numbered-step"
  | "metric-value"
  | "metric-label"
  | "table-header"
  | "table-cell"
  | "axis-label"
  | "legend-label"
  | "callout"
  | "quote"
  | "quote-source"
  | "badge"
  | "tag"
  | "code"
  | "code-caption";

export interface TextKindDefinition {
  kind: TextKind;
  purpose: string;
  preferredLines?: { min?: number; max?: number };
  defaultWrap: boolean;
}

export const TEXT_KIND_DEFINITIONS: TextKindDefinition[] = [
  { kind: "deck-title", purpose: "Whole-deck title.", preferredLines: { max: 2 }, defaultWrap: true },
  { kind: "slide-title", purpose: "Slide title.", preferredLines: { max: 2 }, defaultWrap: true },
  { kind: "section-title", purpose: "Section heading inside a slide.", preferredLines: { max: 2 }, defaultWrap: true },
  { kind: "card-title", purpose: "Title inside a card.", preferredLines: { max: 2 }, defaultWrap: true },
  { kind: "label", purpose: "Short label or eyebrow.", preferredLines: { max: 1 }, defaultWrap: true },
  { kind: "lead", purpose: "Lead sentence or thesis.", preferredLines: { max: 3 }, defaultWrap: true },
  { kind: "paragraph", purpose: "Normal body paragraph.", preferredLines: { min: 1, max: 8 }, defaultWrap: true },
  { kind: "body-small", purpose: "Dense body copy.", preferredLines: { max: 10 }, defaultWrap: true },
  { kind: "caption", purpose: "Caption or source note.", preferredLines: { max: 3 }, defaultWrap: true },
  { kind: "figure-caption", purpose: "Image or chart caption.", preferredLines: { max: 2 }, defaultWrap: true },
  { kind: "footnote", purpose: "Footer, disclaimer, or source.", preferredLines: { max: 2 }, defaultWrap: true },
  { kind: "bullet", purpose: "Bullet item text.", preferredLines: { max: 3 }, defaultWrap: true },
  { kind: "bullet-compact", purpose: "Dense bullet item text.", preferredLines: { max: 2 }, defaultWrap: true },
  { kind: "numbered-step", purpose: "Step number or ordered item.", preferredLines: { max: 1 }, defaultWrap: false },
  { kind: "metric-value", purpose: "Prominent numeric value.", preferredLines: { max: 1 }, defaultWrap: false },
  { kind: "metric-label", purpose: "Short metric label.", preferredLines: { max: 2 }, defaultWrap: true },
  { kind: "table-header", purpose: "Table header cell.", preferredLines: { max: 2 }, defaultWrap: true },
  { kind: "table-cell", purpose: "Table body cell.", preferredLines: { max: 3 }, defaultWrap: true },
  { kind: "axis-label", purpose: "Chart axis label.", preferredLines: { max: 1 }, defaultWrap: true },
  { kind: "legend-label", purpose: "Chart legend label.", preferredLines: { max: 1 }, defaultWrap: true },
  { kind: "callout", purpose: "Highlighted insight or key message.", preferredLines: { max: 3 }, defaultWrap: true },
  { kind: "quote", purpose: "Quoted text.", preferredLines: { max: 5 }, defaultWrap: true },
  { kind: "quote-source", purpose: "Quote attribution.", preferredLines: { max: 1 }, defaultWrap: true },
  { kind: "badge", purpose: "Status badge.", preferredLines: { max: 1 }, defaultWrap: false },
  { kind: "tag", purpose: "Category tag.", preferredLines: { max: 1 }, defaultWrap: false },
  { kind: "code", purpose: "Code text.", preferredLines: { max: 12 }, defaultWrap: false },
  { kind: "code-caption", purpose: "Code block caption.", preferredLines: { max: 2 }, defaultWrap: true },
];

export function listTextKinds(): TextKindDefinition[] {
  return TEXT_KIND_DEFINITIONS;
}

export function describeTextKind(kind: string): TextKindDefinition | null {
  return TEXT_KIND_DEFINITIONS.find((item) => item.kind === kind) || null;
}

export function isTextKind(kind: unknown): kind is TextKind {
  return typeof kind === "string" && TEXT_KIND_DEFINITIONS.some((item) => item.kind === kind);
}
