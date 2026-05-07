/**
 * Small document API for the md2pptx agent loop.
 *
 * The LLM edits SlideML2 JSON directly. Tools are intentionally limited to:
 * schema disclosure, source IO, deck read/create, whole-slide replace,
 * JSON Patch for small deck edits, render validation, and stop.
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  buildTheme,
  clearRenderDiagnostics,
  createDeck,
  describeComponents,
  describeDeck,
  getRenderDiagnostics,
  listComponents,
  listNodeTypes,
  listPaletteColors,
  listTextKinds,
  listThemes,
  readDeck,
  renderToPptx,
  replaceSlide,
  sourceToRenderedDeck,
  validateDeck,
  validateSlide,
  writeDeck,
  type LayoutDiagnostic,
} from "../../src/index.js";
import type { Slideml2SourceDeck, SlideV2 } from "../../src/types.js";

export interface ToolContext {
  cwd: string;
  rootDir: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export const tools: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read a UTF-8 source file, usually the input markdown. This is general file IO; do not use it to mutate decks.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Absolute or root-relative file path." } },
      required: ["path"],
    },
  },
  {
    name: "describe_schema",
    description: "Return the SlideML2 authoring schema, deck rules, component index, optional detailed component schemas, text kinds, node types, theme tokens, and default theme scaffold. Call once before writing slides; call again with components for full field schemas.",
    input_schema: {
      type: "object",
      properties: {
        components: {
          type: "array",
          items: { type: "string" },
          description: "Optional component names to describe in detail.",
        },
      },
    },
  },
  {
    name: "create_deck",
    description: "Create a fresh SlideML2 source deck JSON. Use once at the start. Deck JSON remains the source of truth.",
    input_schema: {
      type: "object",
      properties: {
        deckPath: { type: "string" },
        title: { type: "string" },
        theme: { type: "string", description: "Usually 'default'." },
        brand: {
          type: "object",
          properties: {
            name: { type: "string" },
            primary: { type: "string", description: "6-char hex without #." },
            logo: { type: "string", description: "Absolute path or URL." },
          },
        },
        themeOverride: {
          type: "object",
          description: "Optional deck.themeOverride to install immediately: colors, text, component, layout, fonts, chart, chrome, sizeScale, guidance.",
        },
      },
      required: ["deckPath"],
    },
  },
  {
    name: "read_deck",
    description: "Read the current deck JSON. Use this before targeted edits or after validation failures.",
    input_schema: {
      type: "object",
      properties: { deckPath: { type: "string" } },
      required: ["deckPath"],
    },
  },
  {
    name: "replace_slide",
    description: "Replace one full slide by id or index. This is the primary edit primitive for authoring and layout repair. If the slide does not exist and slideId is a number equal to the slide count, it appends.",
    input_schema: {
      type: "object",
      properties: {
        deckPath: { type: "string" },
        slideId: { description: "Existing slide id, existing index, or append index equal to slideCount." },
        slide: { type: "object", description: "SlideML2 SlideV2 JSON: {id,title?,background?,children,notes?,metadata?}." },
      },
      required: ["deckPath", "slideId", "slide"],
    },
  },
  {
    name: "patch_deck",
    description: "Apply RFC6902-style JSON Patch operations to the deck for small edits: deck metadata/theme/chrome, slide reorder/delete, or adding slides at /slides/-. Prefer replace_slide for substantial slide layout changes.",
    input_schema: {
      type: "object",
      properties: {
        deckPath: { type: "string" },
        patch: {
          type: "array",
          items: { type: "object" },
          description: "Ops: add, replace, remove, move, copy, test. Paths use JSON Pointer, e.g. /deck/themeOverride/colors/background or /slides/-.",
        },
      },
      required: ["deckPath", "patch"],
    },
  },
  {
    name: "validate_render",
    description: "Validate the deck and optionally render to PPTX. Returns schema errors, render paths, diagnostics summary, and blocking diagnostics. Use after a batch of edits, then repair with replace_slide or patch_deck.",
    input_schema: {
      type: "object",
      properties: {
        deckPath: { type: "string" },
        outputPath: { type: "string", description: "Required when render=true." },
        render: { type: "boolean", description: "Default true. Set false for validation-only." },
      },
      required: ["deckPath"],
    },
  },
  {
    name: "stop",
    description: "Signal completion. This only succeeds after validate_render has produced no blocking diagnostics.",
    input_schema: {
      type: "object",
      properties: { summary: { type: "string", description: "1-3 sentence summary of the generated deck." } },
      required: ["summary"],
    },
  },
];

export interface ToolHandlerResult {
  ok: boolean;
  error?: string;
  data?: unknown;
}

export async function handleToolCall(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolHandlerResult> {
  try {
    switch (name) {
      case "read_file": {
        const path = resolvePath(ctx, String(input.path || ""));
        const content = await readFile(path, "utf8");
        const trimmed = content.length > 60_000 ? `${content.slice(0, 60_000)}\n\n...(truncated ${content.length - 60_000} chars)...\n` : content;
        return { ok: true, data: { path, content: trimmed, byteLength: Buffer.byteLength(content, "utf8") } };
      }
      case "describe_schema": {
        const components = Array.isArray(input.components) ? input.components.map(String) : [];
        return {
          ok: true,
          data: {
            deck: describeDeck(),
            components: {
              index: listComponents(),
              details: components.length ? describeComponents(components) : undefined,
            },
            nodeTypes: listNodeTypes().map((node) => ({ type: node.type, use: node.use })),
            textKinds: listTextKinds(),
            themes: listThemes(),
            palette: listPaletteColors(),
            defaultTheme: buildTheme(),
            authoringRules: [
              "Write component names directly in node.type; fields are flat, never props.",
              "Compose slide.children freely. area:'content' is a placement hint, not a required single root.",
              "Use semantic components for meaning, stack/grid/split/panel/card/band/frame/inset for organization.",
              "Plan a deck-level component mix; text/stack/grid/card alone are not enough for a substantial deck.",
              "Do substantial slide changes with replace_slide; use patch_deck for deck-level and small structural edits.",
              "Run validate_render after edits and repair blocking diagnostics.",
            ],
          },
        };
      }
      case "create_deck": {
        const deckPath = resolvePath(ctx, String(input.deckPath || ""));
        const result = await createDeck(deckPath, {
          title: typeof input.title === "string" ? input.title : undefined,
          theme: typeof input.theme === "string" ? input.theme : "default",
          brand: input.brand && typeof input.brand === "object" ? input.brand as never : undefined,
        });
        if (input.themeOverride && typeof input.themeOverride === "object") {
          const deck = await readDeck(deckPath);
          deck.deck.themeOverride = input.themeOverride as never;
          await writeDeck(deckPath, deck);
        }
        return { ok: true, data: { deckPath, ...result } };
      }
      case "read_deck": {
        const deckPath = resolvePath(ctx, String(input.deckPath || ""));
        return { ok: true, data: await readDeck(deckPath) };
      }
      case "replace_slide": {
        const deckPath = resolvePath(ctx, String(input.deckPath || ""));
        const deck = await readDeck(deckPath);
        const slide = coerceObject(input.slide, "slide") as unknown as SlideV2;
        const slideValidation = validateSlide(slide, deck);
        if (!slideValidation.ok) {
          return { ok: false, error: `Slide validation failed with ${slideValidation.errors.length} error(s).`, data: slideValidation };
        }
        const slideId = normalizeSlideId(input.slideId);
        if (typeof slideId === "number" && slideId === deck.slides.length) {
          deck.slides.push(slide);
          await writeDeck(deckPath, deck);
          return { ok: true, data: deckSummary(deck, { insertedAt: deck.slides.length - 1 }) };
        }
        const result = await replaceSlide(deckPath, slideId, slide);
        return result.ok ? { ok: true, data: result } : { ok: false, error: result.error, data: result };
      }
      case "patch_deck": {
        const deckPath = resolvePath(ctx, String(input.deckPath || ""));
        const patch = Array.isArray(input.patch) ? input.patch : [];
        const original = await readDeck(deckPath);
        const deck = deepClone(original);
        applyJsonPatch(deck as unknown, patch);
        const validation = validateDeck(deck);
        if (validation.ok) await writeDeck(deckPath, deck);
        return { ok: validation.ok, error: validation.ok ? undefined : `Deck validation failed with ${validation.errors.length} error(s).`, data: { summary: deckSummary(deck), validation } };
      }
      case "validate_render": {
        const deckPath = resolvePath(ctx, String(input.deckPath || ""));
        const shouldRender = input.render !== false;
        const deck = await readDeck(deckPath);
        const validation = validateDeck(deck);
        if (!validation.ok || !shouldRender) {
          return { ok: validation.ok, error: validation.ok ? undefined : `Deck validation failed with ${validation.errors.length} error(s).`, data: { validation } };
        }
        const outputPathRaw = typeof input.outputPath === "string" && input.outputPath ? input.outputPath : `${deckPath.replace(/\.json$/, "")}.pptx`;
        const outputPath = resolvePath(ctx, outputPathRaw);
        clearRenderDiagnostics();
        const result = await renderToPptx(sourceToRenderedDeck(deck), outputPath);
        const diagnostics = getRenderDiagnostics();
        const blocking = blockingDiagnostics(diagnostics);
        return {
          ok: blocking.length === 0,
          error: blocking.length ? `${blocking.length} blocking render diagnostic(s) remain.` : undefined,
          data: {
            outputPath: result.outputPath,
            domPath: result.domPath,
            validation,
            diagnostics: {
              count: diagnostics.length,
              summary: summarizeDiagnostics(diagnostics),
              blockingCount: blocking.length,
              blocking: blocking.slice(0, 60),
            },
          },
        };
      }
      case "stop": {
        const blocking = blockingDiagnostics(getRenderDiagnostics());
        if (blocking.length > 0) {
          return {
            ok: false,
            error: `Cannot stop: ${blocking.length} blocking render diagnostic(s) remain. Use validate_render output and replace_slide/patch_deck to repair.`,
            data: { blocking: blocking.slice(0, 60), summary: summarizeDiagnostics(blocking) },
          };
        }
        return { ok: true, data: { stopped: true, summary: String(input.summary || "") } };
      }
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function resolvePath(ctx: ToolContext, path: string): string {
  if (!path) throw new Error("Path is required");
  const abs = isAbsolute(path) ? path : resolve(ctx.cwd, path);
  if (!abs.startsWith(ctx.rootDir)) throw new Error(`Path '${path}' resolves outside the allowed root '${ctx.rootDir}'`);
  return abs;
}

function extractFirstJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1]! : text;
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) return JSON.parse(body.slice(start, i + 1));
    }
  }
  throw new Error("no balanced JSON object found in string");
}

function coerceObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const direct = JSON.parse(value);
      if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct as Record<string, unknown>;
    } catch {
      // fall through
    }
    const extracted = extractFirstJsonObject(value);
    if (extracted && typeof extracted === "object" && !Array.isArray(extracted)) return extracted as Record<string, unknown>;
  }
  throw new Error(`'${fieldName}' is required and must be a JSON object`);
}

interface PatchOp {
  op?: unknown;
  path?: unknown;
  from?: unknown;
  value?: unknown;
}

function applyJsonPatch(document: unknown, patch: unknown[]): void {
  for (const raw of patch) {
    const op = raw && typeof raw === "object" ? raw as PatchOp : {};
    const kind = String(op.op || "");
    const path = String(op.path || "");
    if (!path.startsWith("/")) throw new Error(`Invalid JSON Pointer path: ${path}`);
    if (kind === "add") setPointer(document, path, op.value, "add");
    else if (kind === "replace") setPointer(document, path, op.value, "replace");
    else if (kind === "remove") removePointer(document, path);
    else if (kind === "move") {
      const from = String(op.from || "");
      const value = deepClone(getPointer(document, from));
      removePointer(document, from);
      setPointer(document, path, value, "add");
    } else if (kind === "copy") {
      const from = String(op.from || "");
      setPointer(document, path, deepClone(getPointer(document, from)), "add");
    } else if (kind === "test") {
      const actual = getPointer(document, path);
      if (JSON.stringify(actual) !== JSON.stringify(op.value)) throw new Error(`JSON Patch test failed at ${path}`);
    } else {
      throw new Error(`Unsupported JSON Patch op: ${kind}`);
    }
  }
}

function pointerParts(path: string): string[] {
  if (path === "") return [];
  return path.split("/").slice(1).map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function getPointer(document: unknown, path: string): unknown {
  let current = document as any;
  for (const part of pointerParts(path)) {
    if (Array.isArray(current)) current = current[part === "-" ? current.length : Number(part)];
    else current = current?.[part];
  }
  return current;
}

function setPointer(document: unknown, path: string, value: unknown, mode: "add" | "replace"): void {
  const parts = pointerParts(path);
  if (parts.length === 0) throw new Error("Replacing the whole deck document is not supported; patch fields instead.");
  const key = parts.pop()!;
  const parent = getPointer(document, parentPointer(parts)) as any;
  if (parent === undefined || parent === null) throw new Error(`Path parent not found: ${path}`);
  if (Array.isArray(parent)) {
    if (key === "-") parent.push(value);
    else {
      const index = Number(key);
      if (!Number.isInteger(index)) throw new Error(`Invalid array index in path: ${path}`);
      if (mode === "add") parent.splice(index, 0, value);
      else {
        if (index < 0 || index >= parent.length) throw new Error(`Array index out of range: ${path}`);
        parent[index] = value;
      }
    }
  } else {
    if (mode === "replace" && !(key in parent)) throw new Error(`Replace path does not exist: ${path}`);
    parent[key] = value;
  }
}

function removePointer(document: unknown, path: string): void {
  const parts = pointerParts(path);
  if (parts.length === 0) throw new Error("Removing the whole deck document is not supported.");
  const key = parts.pop()!;
  const parent = getPointer(document, parentPointer(parts)) as any;
  if (Array.isArray(parent)) parent.splice(Number(key), 1);
  else if (parent && typeof parent === "object") delete parent[key];
  else throw new Error(`Path parent not found: ${path}`);
}

function escapePointer(part: string): string {
  return part.replace(/~/g, "~0").replace(/\//g, "~1");
}

function parentPointer(parts: string[]): string {
  return parts.length === 0 ? "" : `/${parts.map(escapePointer).join("/")}`;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeSlideId(value: unknown): string | number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return String(value || "");
}

function deckSummary(deck: Slideml2SourceDeck, extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    slideCount: deck.slides.length,
    slides: deck.slides.map((slide, index) => ({ index, id: slide.id, title: slide.title })),
  };
}

function summarizeDiagnostics(items: LayoutDiagnostic[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item.code] = (counts[item.code] || 0) + 1;
  return counts;
}

function blockingDiagnostics(items: LayoutDiagnostic[]): LayoutDiagnostic[] {
  const blockingCodes = new Set<LayoutDiagnostic["code"]>([
    "COLLISION",
    "UNKNOWN_COLOR",
    "UNKNOWN_STYLE",
    "TINY_RECT",
    "SQUASHED",
    "FALLBACK_FAILED",
    "TITLE_OCCLUDED",
    "LOW_CONTRAST",
    "SHAPE_INVISIBLE",
  ]);
  return items.filter((item) => item.severity === "error" || blockingCodes.has(item.code));
}
