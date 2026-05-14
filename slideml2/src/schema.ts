import { SLIDE_SIZES, type DeckSize } from "./units.js";

export const DECK_SIZE_VALUES = Object.keys(SLIDE_SIZES) as DeckSize[];
export const VALIDATION_MODE_VALUES = ["strict", "standard", "experimental"] as const;
export const DATA_SOURCE_TYPE_VALUES = ["inline-json", "inline-csv", "file-csv", "computed"] as const;
export const DATA_AGGREGATE_OP_VALUES = ["sum", "avg", "min", "max", "count", "first", "last"] as const;
export const DATA_COLUMN_TYPE_VALUES = ["text", "number", "percent", "currency", "date"] as const;
export const DATA_COLUMN_ALIGN_VALUES = ["left", "center", "right"] as const;

export type ValidationMode = typeof VALIDATION_MODE_VALUES[number];

export const THEME_OVERRIDE_FIELDS = [
  "colors",
  "text",
  "component",
  "tone",
  "layout",
  "fonts",
  "chart",
  "chrome",
  "imageGrowWeight",
  "sizeScale",
  "guidance",
] as const;

export const THEME_TEXT_STYLE_FIELDS = [
  "fontSize",
  "weight",
  "fontWeight",
  "color",
  "lineHeight",
  "lineSpacing",
  "margin",
  "letterSpacing",
  "fontFamily",
  "fontFeatures",
  "bold",
  "uppercase",
  "italic",
] as const;

export const THEME_LAYOUT_FIELDS = [
  "slideWidthCm",
  "slideHeightCm",
  "pageMarginX",
  "titleTop",
  "titleHeight",
  "contentTop",
  "contentBottom",
  "defaultGap",
  "columnGap",
  "cardPadding",
  "areas",
] as const;

export const SURFACE_FIELDS = [
  "fill",
  "fillOpacity",
  "line",
  "lineOpacity",
  "lineWidth",
  "lineDash",
  "border",
  "borderColor",
  "borderWidth",
  "borderStyle",
  "cornerRadius",
  "padding",
  "elevation",
  "shadow",
  "gradient",
  "accent",
  "accentColor",
  "accentWidth",
] as const;

export const DATA_BIND_FIELDS = [
  "source",
  "select",
  "filter",
  "groupBy",
  "aggregate",
  "pivot",
  "sort",
  "limit",
] as const;

export const DATA_ENCODING_FIELDS = [
  "x",
  "y",
  "orientation",
  "series",
  "label",
  "value",
  "delta",
  "items",
  "columns",
  "seriesName",
  "seriesOptions",
] as const;

export const THEME_COMPONENT_STYLE_FIELDS = [
  "fill",
  "fillOpacity",
  "line",
  "lineOpacity",
  "lineWidth",
  "lineDash",
  "borderColor",
  "borderWidth",
  "borderStyle",
  "padding",
  "cornerRadius",
  "elevation",
  "shadow",
  "gradient",
  "accent",
  "accentColor",
  "accentWidth",
  "surface",
] as const;

export const THEME_CHROME_FIELDS = [
  "brandMark",
  "pageNumber",
  "footerText",
  "footerLine",
  "footerHeight",
  "footerPadding",
] as const;

export const THEME_FONT_FIELDS = ["latin", "cjk", "mono"] as const;
export const THEME_SCRIPT_FONT_FIELDS = ["display", "text"] as const;

export function isDeckSize(value: unknown): value is DeckSize {
  return typeof value === "string" && (DECK_SIZE_VALUES as readonly string[]).includes(value);
}

export function normalizeValidationMode(value: unknown): ValidationMode {
  return (typeof value === "string" && (VALIDATION_MODE_VALUES as readonly string[]).includes(value))
    ? value as ValidationMode
    : "standard";
}

export const THEME_OVERRIDE_FIELD_SET = new Set<string>(THEME_OVERRIDE_FIELDS);
export const THEME_TEXT_STYLE_FIELD_SET = new Set<string>(THEME_TEXT_STYLE_FIELDS);
export const THEME_LAYOUT_FIELD_SET = new Set<string>(THEME_LAYOUT_FIELDS);
export const THEME_COMPONENT_STYLE_FIELD_SET = new Set<string>(THEME_COMPONENT_STYLE_FIELDS);
export const THEME_CHROME_FIELD_SET = new Set<string>(THEME_CHROME_FIELDS);
export const THEME_FONT_FIELD_SET = new Set<string>(THEME_FONT_FIELDS);
export const THEME_SCRIPT_FONT_FIELD_SET = new Set<string>(THEME_SCRIPT_FONT_FIELDS);
