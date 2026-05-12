import type { Tool } from "./types";
import { slideml2CreateDeck } from "@/lib/tauri";

export const createDeckTool: Tool = {
  definition: {
    name: "create_deck",
    description:
      `Create a fresh SlideML2 source deck JSON file at \`deckPath\`. Use once at the start of a deck task; the JSON is the source of truth.

Do not call \`create_deck\` until you have saved a complete markdown planning archive, usually next to the deck as \`deck_plan.md\`, with \`write_file\`. That plan should include the deck contract, storyline, theme plan, slide-by-slide component plan, asset/icon plan, and exact icon/image/chart placements. \`create_deck\` starts implementation from that archived plan; it is not the planning step.

The deck-level visual identity should be installed in this initial call via \`themeOverride\`: pass colors (\`brand.primary\`, \`background\`, \`surface\`, \`text.primary\`, \`divider\`, ...), text styles (\`slide-title\`, \`section-title\`, \`card-title\`, \`paragraph\`, \`bullet\`, \`caption\`, \`label\`, \`table-header\`, \`table-cell\`, \`metric-value\`, \`metric-label\`), component tuning (\`card\`, \`panel\`, including surface fields like \`fillOpacity\`, \`lineOpacity\`, \`shadow\`, \`gradient\`), effective layout fields (\`pageMarginX\`, \`titleTop\`, \`titleHeight\`, \`contentTop\`, \`contentBottom\`, \`defaultGap\`, \`areas\`), fonts, and chrome (\`brandMark\`, \`pageNumber\`). If the deck needs enterprise/template semantics, pass \`master:{layout?,placeholders?}\` here; placeholders use cm rectangles such as \`{type:"title",x,y,w,h}\` and are emitted into the OOXML master/layout. \`contentTop\` and \`contentBottom\` are content-area y-coordinates; on 16:9, \`contentBottom\` is usually 13.0-13.5cm and content height is \`contentBottom - contentTop\`. Use \`size\` for the canvas (\`16x9\`, \`16x10\`, \`4x3\`, or \`wide\`) and \`validation\` for \`standard\`/\`strict\`/\`experimental\` policy. Put reusable business/science data in \`dataSources\` when it is known at creation time; supported sources are inline JSON rows, inline CSV text, local \`file-csv\` paths relative to the deck JSON, and computed sources. Put reusable citations in \`references\` and deck-level footnotes in \`footnotes\` so rich \`{kind:"cite"}\`, table \`footnoteRefs\`, and \`bibliography\` can validate and auto-number. Read the slideml2 SKILL.md for the style brief structure to derive these from the source content. For business/research-report decks, also read business.md completely first; its default is light analytical pages, not a full-deck dark theme.

After this call, add slides one at a time via \`replace_slide\` (when slideId equals current slide count, it appends). \`replace_slide\` runs per-slide validation and only commits a slide when it passes, so repair any rejected slide before authoring the next. After all slides are added, call \`validate_render({deckPath,render:true})\` once to render/export the full PPTX and run final deck QA. Use \`patch_deck\` only for focused deck-level or ordering edits, not as the normal slide authoring path.`,
    parameters: {
      type: "object",
      properties: {
        deckPath: { type: "string", description: "Absolute path for the deck JSON file (e.g. /abs/path/deck.json)." },
        title: { type: "string", description: "Deck title; sets initial deck.title." },
        size: { type: "string", enum: ["16x9", "16x10", "4x3", "wide"], description: "Deck canvas size. Default 16x9." },
        theme: { type: "string", description: "Base theme scaffold name. Default 'default' (a neutral theme; use themeOverride to install a real visual identity)." },
        brand: {
          type: "object",
          description: "Brand identity.",
          properties: {
            name: { type: "string" },
            primary: { type: "string", description: "6-char hex without #." },
            logo: { type: "string", description: "Absolute path or URL." },
          },
        },
        themeOverride: {
          type: "object",
          description: "Deck.themeOverride installed immediately: colors, text, component, layout (including areas), fonts, chart, chrome, sizeScale, guidance.",
        },
        validation: {
          type: "object",
          description: "Optional deck.validation policy: {mode:'standard'|'strict'|'experimental', allowUnknownComponents?, maxTextLength?, requireAlt?, requireSources?}.",
        },
        master: {
          type: "object",
          description: "Optional deck.master contract for OOXML slide master/layout semantics, e.g. {layout:'analysis', placeholders:[{type:'title',x:0.9,y:0.55,w:14,h:1.0},{type:'body',x:0.9,y:2.0,w:14,h:10.2}]}.",
        },
        dataSources: {
          type: "object",
          description: "Optional deck.dataSources registry. Use {type:'inline-json', rows:[...]}, {type:'inline-csv', csv:'col,value\\nA,1'}, {type:'file-csv', path:'data/file.csv'}, or computed sources relative to deckPath.",
        },
        references: {
          type: "array",
          description: "Optional deck.references array for citations: [{id,title?,authors?,year?,venue?,doi?,url?,citation?}]. Cite with rich runs {kind:'cite',refId:'id'} and list with bibliography.",
        },
        footnotes: {
          type: "array",
          description: "Optional deck.footnotes array: [{id,text}]. Reference with {kind:'footnoteRef',footnoteId:'id'} or table cell footnoteRefs:['id'].",
        },
      },
      required: ["deckPath"],
    },
  },

  async execute(input) {
    const deckPath = String(input.deckPath || "").trim();
    if (!deckPath) return "Error: deckPath is required.";
    // 288ryd log: LLMs sometimes serialize themeOverride/brand as JSON strings
    // (the schema declares them as objects, but the model emits a string after
    // a long generation). Auto-parse before passing to native code so the
    // override actually takes effect instead of being silently dropped.
    const autoNotes: string[] = [];
    const parsedThemeOverride = parseMaybeJsonObject(input.themeOverride, "themeOverride", autoNotes);
    if (typeof parsedThemeOverride === "string") return parsedThemeOverride;
    const themeOverride = normalizeThemeOverride(parsedThemeOverride, autoNotes);
    if (typeof themeOverride === "string") return themeOverride;
    const brand = parseMaybeJsonObject(input.brand, "brand", autoNotes);
    if (typeof brand === "string") return brand;
    const validation = parseMaybeJsonObject(input.validation, "validation", autoNotes);
    if (typeof validation === "string") return validation;
    const master = parseMaybeJsonObject(input.master, "master", autoNotes);
    if (typeof master === "string") return master;
    const dataSources = parseMaybeJsonObject(input.dataSources, "dataSources", autoNotes);
    if (typeof dataSources === "string") return dataSources;
    const references = parseMaybeJsonArray(input.references, "references", autoNotes);
    if (typeof references === "string") return references;
    const footnotes = parseMaybeJsonArray(input.footnotes, "footnotes", autoNotes);
    if (typeof footnotes === "string") return footnotes;
    const size = input.size === undefined || input.size === null || input.size === ""
      ? undefined
      : String(input.size);
    if (size !== undefined && !SLIDEML2_SIZE_VALUES.has(size)) {
      return `Error: size must be one of ${Array.from(SLIDEML2_SIZE_VALUES).join(", ")}.`;
    }
    try {
      const result = await slideml2CreateDeck(deckPath, {
        title: typeof input.title === "string" ? input.title : undefined,
        size: size as "16x9" | "16x10" | "4x3" | "wide" | undefined,
        theme: typeof input.theme === "string" ? input.theme : undefined,
        brand: brand && typeof brand === "object" ? brand as never : undefined,
        themeOverride,
        validation: validation && typeof validation === "object" ? validation : undefined,
        master: master && typeof master === "object" ? master as never : undefined,
        dataSources: dataSources && typeof dataSources === "object" ? dataSources : undefined,
        references: Array.isArray(references) ? references : undefined,
        footnotes: Array.isArray(footnotes) ? footnotes : undefined,
      });
      const record = result as Record<string, unknown>;
      if (record.ok === false) {
        return [
          "Error: create_deck failed; deck file was not written.",
          typeof record.error === "string" ? record.error : "Deck creation was rejected by SlideML2 validation.",
          formatCreateDeckValidation(record.validation),
          "Fix the create_deck options and call create_deck again with the same deckPath. Do not use write_file/run_node/run_python to create or mutate the SlideML2 deck JSON.",
        ].filter(Boolean).join("\n");
      }
      const notePrefix = autoNotes.length > 0 ? `${autoNotes.join("\n")}\n` : "";
      return `${notePrefix}Deck created at ${result.deckPath}. Add slides one at a time via replace_slide (slideId = current slide count appends and only commits after per-slide validation).`;
    } catch (err) {
      return `Error: create_deck failed.\n${err instanceof Error ? err.message : String(err)}`;
    }
  },

  historySummarizer(rawResult, status) {
    if (status === "fail") return rawResult;
    const m = /created at (\S+)/.exec(rawResult);
    return m ? `→ deck ${m[1]}` : rawResult.slice(0, 160);
  },
};

function formatCreateDeckValidation(validation: unknown): string {
  if (!validation || typeof validation !== "object") return "";
  const errors = (validation as { errors?: unknown }).errors;
  if (!Array.isArray(errors) || errors.length === 0) return "";
  const compact = errors.slice(0, 12).map((err) => {
    if (!err || typeof err !== "object") return err;
    const record = err as Record<string, unknown>;
    return {
      code: record.code,
      path: record.path,
      message: record.message,
      suggestedFix: record.suggestedFix,
    };
  });
  const more = errors.length > compact.length ? ` (${errors.length - compact.length} more)` : "";
  return `validationErrors=${JSON.stringify(compact, null, 2)}${more}`;
}

/**
 * Accept either an object (preferred) or a JSON-encoded string. Strings get
 * parsed and a soft note is appended so the agent learns the canonical shape.
 * On parse failure this returns an Error string. Silently dropping a malformed
 * themeOverride lets the agent continue with the wrong visual system and
 * makes later render failures much harder to repair.
 */
function parseMaybeJsonObject(value: unknown, fieldName: string, notes: string[]): unknown | string {
  if (value == null) return undefined;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{")) {
      return `Error: ${fieldName} arrived as a non-JSON string. Pass an object literal, or a valid JSON object string starting with "{".`;
    }
    try {
      const parsed = JSON.parse(trimmed);
      notes.push(`Note: ${fieldName} arrived as a JSON string and was auto-parsed; pass it as an object literal next time to skip this rescue.`);
      return parsed;
    } catch (err) {
      return `Error: ${fieldName} string was not valid JSON (${err instanceof Error ? err.message : String(err)}). Re-emit ${fieldName} as a JSON object literal instead of a string.`;
    }
  }
  return undefined;
}

function parseMaybeJsonArray(value: unknown, fieldName: string, notes: string[]): unknown[] | undefined | string {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("[")) {
      return `Error: ${fieldName} arrived as a non-JSON string. Pass an array literal, or a valid JSON array string starting with "[".`;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) return `Error: ${fieldName} string parsed successfully but did not produce an array.`;
      notes.push(`Note: ${fieldName} arrived as a JSON string and was auto-parsed; pass it as an array literal next time to skip this rescue.`);
      return parsed;
    } catch (err) {
      return `Error: ${fieldName} string was not valid JSON (${err instanceof Error ? err.message : String(err)}). Re-emit ${fieldName} as a JSON array literal instead of a string.`;
    }
  }
  return undefined;
}

const THEME_TEXT_STYLE_KEYS = new Set([
  "fontSize",
  "weight",
  "fontWeight",
  "color",
  "lineHeight",
  "margin",
  "letterSpacing",
  "fontFamily",
  "fontFeatures",
  "uppercase",
  "italic",
]);

const SLIDEML2_SIZE_VALUES = new Set(["16x9", "16x10", "4x3", "wide"]);

function normalizeThemeOverride(value: unknown, notes: string[]): unknown | string {
  if (value == null) return undefined;
  if (!isPlainObject(value)) return "Error: themeOverride must be an object literal.";
  const root = value as Record<string, unknown>;
  const text = root.text;
  if (text == null) return value;
  if (!isPlainObject(text)) return "Error: themeOverride.text must be an object keyed by text style name.";

  let rootOut: Record<string, unknown> | undefined;
  let textOut: Record<string, unknown> | undefined;
  const ensureTextOut = (): Record<string, unknown> => {
    if (!rootOut) rootOut = { ...root };
    if (!textOut) {
      textOut = { ...(text as Record<string, unknown>) };
      rootOut.text = textOut;
    }
    return textOut;
  };

  for (const [styleName, rawStyle] of Object.entries(text as Record<string, unknown>)) {
    if (rawStyle == null) continue;
    if (!isPlainObject(rawStyle)) {
      return `Error: themeOverride.text.${styleName} must be an object.`;
    }

    let style = rawStyle as Record<string, unknown>;
    if ("bold" in style) {
      const bold = style.bold;
      if (typeof bold === "boolean") {
        style = { ...style };
        delete style.bold;
        if (style.fontWeight == null && style.weight == null) style.fontWeight = bold ? "bold" : "normal";
        ensureTextOut()[styleName] = style;
        notes.push(`Note: themeOverride.text.${styleName}.bold was converted to fontWeight; use fontWeight next time.`);
      } else {
        return `Error: themeOverride.text.${styleName}.bold must be boolean when used. Prefer fontWeight:'bold' or weight:'bold'.`;
      }
    }
    if ("tracking" in style) {
      const tracking = style.tracking;
      if (typeof tracking === "number" && Number.isFinite(tracking)) {
        style = { ...style };
        delete style.tracking;
        if (style.letterSpacing == null) style.letterSpacing = tracking;
        ensureTextOut()[styleName] = style;
        notes.push(`Note: themeOverride.text.${styleName}.tracking was converted to letterSpacing; use letterSpacing next time.`);
      } else if (style.letterSpacing != null) {
        style = { ...style };
        delete style.tracking;
        ensureTextOut()[styleName] = style;
        notes.push(`Note: themeOverride.text.${styleName}.tracking was removed because letterSpacing is already set; theme text styles use letterSpacing, not tracking.`);
      } else {
        return `Error: themeOverride.text.${styleName}.tracking is not supported in deck theme text styles. Use numeric letterSpacing instead.`;
      }
    }

    const unknownKeys = Object.keys(style).filter((key) => !THEME_TEXT_STYLE_KEYS.has(key));
    if (unknownKeys.length > 0) {
      return [
        `Error: unsupported themeOverride text field(s): ${unknownKeys.map((key) => `themeOverride.text.${styleName}.${key}`).join(", ")}.`,
        "Use supported fields: fontSize, weight/fontWeight, color, lineHeight, margin, letterSpacing, fontFamily, fontFeatures, uppercase, italic. Boolean bold is accepted as an alias and converted to fontWeight.",
      ].join("\n");
    }
  }

  return rootOut || value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
