import type { Tool } from "./types";
import { slideml2PatchDeck, slideml2ReadDeck, type Slideml2JsonPatchOp } from "@/lib/tauri";
import { recordSlideWrite, slideAuthoringCheckpointHint, slideSemanticLayoutHint } from "./slideml2-authoring-state";

/**
 * patch_deck v2 — unified DOM-edit primitive.
 *
 * The previous RFC 6902 array shape (`patch: [{op,path,value}, ...]`) was
 * removed because LLMs generate that nested array-of-object structure
 * unreliably: stringification frequently corrupts brace balance, and the
 * `op` field carries no information the agent can vary meaningfully —
 * agents picked "add" vs "replace" at random. The new interface uses a
 * top-level OBJECT keyed by intent ("set", "unset", "insert", "move",
 * "copy"), and inside each group the values are path→value maps or
 * string arrays. No agent ever has to write an array-of-object literal.
 *
 * Operation order: unset → set → insert → move → copy.
 */
export const patchDeckTool: Tool = {
  definition: {
    name: "patch_deck",
    description: `Edit any part of the deck DOM by JSON Pointer path. Unified primitive for theme tokens, brand fields, chrome settings, slide content, slide ordering, and slide insertion/deletion.

Use patch_deck for focused repairs, deck-level theme/chrome edits, reorder/delete operations, and occasional slide replacement. Do not use it to bulk-author the full deck in one call; author 1-2 slides with replace_slide/insert_slide, run validate_render, then continue. If a whole-slide patch is mostly manually positioned \`text\`, the result includes a non-blocking semantic layout warning with better component candidates.

You no longer write {op,path,value} ops. Put paths into the group whose name expresses the intent:

- \`set\`: path → value map. Sets each path. Creates missing intermediate object keys. For an array path that already has an element at that index, the element is REPLACED in place (position unchanged, neighbours unaffected). Use for theme/brand/chrome edits, replacing a whole slide, editing one slide field, or appending via /arr/- path.
- \`unset\`: array of paths to delete. Array elements are spliced out (subsequent elements shift up).
- \`insert\`: path → value map for splice-inserting into arrays. New value goes AT the path's slot, shifting the existing element and everything after by one. Path forms: /arr/N (index), /arr/- (append), /arr/before:<id>, /arr/after:<id>.
- \`move\`: from-path → to-path map. Reorders array elements or moves nodes between containers. To-path supports the same forms as insert.
- \`copy\`: from-path → to-path map. Deep-copies the value at from-path; from-path unaffected.

Common paths:
- /deck/themeOverride/colors/brand.primary
- /deck/themeOverride/text/slide-title/fontSize
- /deck/themeOverride/component/card/cornerRadius
- /deck/themeOverride/chrome/brandMark
- /deck/brand/logo
- /slides/3            (whole slide)
- /slides/3/title      (one field)
- /slides/3/children/0 (one block)
- /slides/-            (append)
- /slides/after:cover  (semantic anchor by id)

Examples:
{ "set": { "/slides/3/title": "Intro" } }                     // edit one field
{ "set": { "/slides/3": { ...new slide... } } }               // replace slide in place
{ "insert": { "/slides/after:cover": { ...new slide... } } }  // splice in after cover
{ "unset": ["/slides/8"] }                                    // delete a slide
{ "move": { "/slides/5": "/slides/1" } }                      // reorder

The whole deck is re-validated after each call; failed validation rolls back without touching the file. The legacy array form ({patch:[{op,path,value}]}) is rejected — the error message includes a translation to the new shape.`,
    parameters: {
      type: "object",
      properties: {
        deckPath: { type: "string" },
        set: {
          type: "object",
          description: "Path → value map. Sets each path; replaces in place when the array index already exists.",
          additionalProperties: true,
        },
        unset: {
          type: "array",
          items: { type: "string" },
          description: "List of paths to remove.",
        },
        insert: {
          type: "object",
          description: "Path → value map. Splice-insert into arrays. Path forms: /arr/N, /arr/-, /arr/before:<id>, /arr/after:<id>.",
          additionalProperties: true,
        },
        move: {
          type: "object",
          description: "from-path → to-path map. Move array elements or move nodes between containers.",
          additionalProperties: { type: "string" },
        },
        copy: {
          type: "object",
          description: "from-path → to-path map. Deep-copy a sub-tree to a new path.",
          additionalProperties: { type: "string" },
        },
      },
      required: ["deckPath"],
    },
  },

  async execute(input) {
    const deckPath = String(input.deckPath || "").trim();
    if (!deckPath) return "Error: deckPath is required.";

    // Reject the legacy array form. Agents trained on RFC 6902 reach for
    // `patch: [...]` reflexively; we redirect with a clear translation.
    if ("patch" in input) {
      return rejectLegacyArrayForm(input.patch);
    }

    // Coerce stringified inputs to objects (LLMs sometimes wrap a JSON
    // object as a string in tool args). Each group gets its own coercion
    // so a malformed `set` doesn't tank `unset` / `insert`.
    const set = coerceObject(input.set, "set");
    if (typeof set === "string") return set;
    const unsetArr = coerceStringArray(input.unset, "unset");
    if (typeof unsetArr === "string") return unsetArr;
    const insertObj = coerceObject(input.insert, "insert");
    if (typeof insertObj === "string") return insertObj;
    const moveObj = coerceStringValueObject(input.move, "move");
    if (typeof moveObj === "string") return moveObj;
    const copyObj = coerceStringValueObject(input.copy, "copy");
    if (typeof copyObj === "string") return copyObj;

    if (!set && !unsetArr && !insertObj && !moveObj && !copyObj) {
      return "Error: patch_deck needs at least one of {set, unset, insert, move, copy}. Each group expresses one kind of edit; pass the paths you want to change inside the matching group.";
    }

    // Read deck once so we can resolve semantic anchors (before:<id> /
    // after:<id>) and detect whether a `set` path lands on an existing
    // array element (= in-place replace) vs a missing slot (= rejected,
    // agent should use insert or /arr/-).
    let deck: { slides?: Array<{ id?: string }>; deck?: unknown } | null = null;
    try {
      deck = await slideml2ReadDeck(deckPath) as { slides?: Array<{ id?: string }>; deck?: unknown };
    } catch (err) {
      return `Error: patch_deck could not read deck.\n${err instanceof Error ? err.message : String(err)}`;
    }

    // Translate the high-level groups into RFC 6902 ops the engine accepts.
    const ops: Slideml2JsonPatchOp[] = [];
    const errors: string[] = [];

    // 1. unset → remove
    if (unsetArr) {
      for (const path of unsetArr) {
        const validation = validateJsonPointer(path);
        if (validation) { errors.push(`unset["${path}"]: ${validation}`); continue; }
        ops.push({ op: "remove", path });
      }
    }

    // 2. set → add or replace, depending on whether path resolves
    if (set) {
      for (const [path, value] of Object.entries(set)) {
        const validation = validateJsonPointer(path);
        if (validation) { errors.push(`set["${path}"]: ${validation}`); continue; }
        // Reject set into an out-of-range array index (agents who wanted
        // append should use /arr/- or insert).
        const arrayCheck = checkArrayIndexInBounds(deck, path);
        if (arrayCheck === "out-of-range") {
          errors.push(`set["${path}"]: array index is out of range. Use "/arr/-" to append or move existing elements first with "move".`);
          continue;
        }
        // Both add and replace use jsonPointerSet which is permissive;
        // the engine picks the right semantics. We emit "replace" when
        // the slot exists (so RFC 6902 strict readers also accept) and
        // "add" otherwise.
        const opName: "add" | "replace" = arrayCheck === "exists-in-array" ? "replace" : "add";
        ops.push({ op: opName, path, value });
      }
    }

    // 3. insert → add (splice into array)
    if (insertObj) {
      for (const [pathRaw, value] of Object.entries(insertObj)) {
        const resolved = resolveSemanticArrayPath(pathRaw, deck);
        if (typeof resolved === "string" && resolved.startsWith("ERR:")) {
          errors.push(`insert["${pathRaw}"]: ${resolved.slice(4)}`);
          continue;
        }
        const validation = validateJsonPointer(resolved as string);
        if (validation) { errors.push(`insert["${pathRaw}"]: ${validation}`); continue; }
        ops.push({ op: "add", path: resolved as string, value });
      }
    }

    // 4. move
    if (moveObj) {
      for (const [from, toRaw] of Object.entries(moveObj)) {
        const fromValidation = validateJsonPointer(from);
        if (fromValidation) { errors.push(`move["${from}"]: from-path: ${fromValidation}`); continue; }
        const to = resolveSemanticArrayPath(toRaw, deck);
        if (typeof to === "string" && to.startsWith("ERR:")) {
          errors.push(`move["${from}" → "${toRaw}"]: ${to.slice(4)}`);
          continue;
        }
        const toValidation = validateJsonPointer(to as string);
        if (toValidation) { errors.push(`move["${from}" → "${toRaw}"]: to-path: ${toValidation}`); continue; }
        ops.push({ op: "move", from, path: to as string });
      }
    }

    // 5. copy
    if (copyObj) {
      for (const [from, toRaw] of Object.entries(copyObj)) {
        const fromValidation = validateJsonPointer(from);
        if (fromValidation) { errors.push(`copy["${from}"]: from-path: ${fromValidation}`); continue; }
        const to = resolveSemanticArrayPath(toRaw, deck);
        if (typeof to === "string" && to.startsWith("ERR:")) {
          errors.push(`copy["${from}" → "${toRaw}"]: ${to.slice(4)}`);
          continue;
        }
        const toValidation = validateJsonPointer(to as string);
        if (toValidation) { errors.push(`copy["${from}" → "${toRaw}"]: to-path: ${toValidation}`); continue; }
        ops.push({ op: "copy", from, path: to as string });
      }
    }

    if (errors.length > 0) {
      return `Patch rejected (deck unchanged): ${errors.length} path error(s).\n${errors.map((e) => `  - ${e}`).join("\n")}`;
    }

    if (ops.length === 0) {
      return "Patch contained no operations after parsing. Add at least one entry to set / unset / insert / move / copy.";
    }

    try {
      const result = await slideml2PatchDeck(deckPath, ops);
      if (!result.ok) {
        return `Patch rejected (deck unchanged): ${result.error}\n${JSON.stringify(result.validation, null, 2)}`;
      }
      const counts: string[] = [];
      if (set) counts.push(`set=${Object.keys(set).length}`);
      if (unsetArr) counts.push(`unset=${unsetArr.length}`);
      if (insertObj) counts.push(`insert=${Object.keys(insertObj).length}`);
      if (moveObj) counts.push(`move=${Object.keys(moveObj).length}`);
      if (copyObj) counts.push(`copy=${Object.keys(copyObj).length}`);
      const slideTargets = slideTargetsTouchedByOps(ops);
      const semanticHints = semanticHintsForSlideOps(ops);
      const slideWriteLine = slideTargets.length > 0
        ? patchSlideWriteLine(deckPath, slideTargets, semanticHints)
        : "";
      return `Patch applied (${counts.join(", ")}). slideCount=${result.summary.slideCount}.${slideWriteLine}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: patch_deck failed.\n${message}`;
    }
  },

  historySummarizer(rawResult, status) {
    if (status === "fail") return rawResult;
    return rawResult.slice(0, 200);
  },
};

function patchSlideWriteLine(deckPath: string, slideTargets: string[], semanticHints: string[] = []): string {
  let writes = 0;
  for (const target of slideTargets) {
    writes = recordSlideWrite(deckPath, target);
  }
  const bulkHint = slideTargets.length > 2
    ? ` Bulk slide patch touched ${slideTargets.length} slide targets; next time write only 1-2 slides, validate, then continue.`
    : "";
  const semanticHint = semanticHints.length > 0 ? `\n${[...new Set(semanticHints)].slice(0, 3).join("\n")}` : "";
  return ` unvalidatedSlideWrites=${writes}.${bulkHint}${semanticHint}\n${slideAuthoringCheckpointHint(deckPath, writes)}`;
}

function semanticHintsForSlideOps(ops: Slideml2JsonPatchOp[]): string[] {
  const hints: string[] = [];
  for (const op of ops) {
    if (!("value" in op)) continue;
    if (!isWholeSlidePath(op.path)) continue;
    const hint = slideSemanticLayoutHint(op.value);
    if (hint) hints.push(hint);
  }
  return hints;
}

function isWholeSlidePath(path: string): boolean {
  return path === "/slides/-" || /^\/slides\/(?:\d+|before:[^/]+|after:[^/]+)$/.test(path);
}

function slideTargetsTouchedByOps(ops: Slideml2JsonPatchOp[]): string[] {
  const targets = new Set<string>();
  for (const op of ops) {
    for (const path of [op.path, "from" in op ? op.from : undefined]) {
      const target = typeof path === "string" ? slideTargetFromPath(path) : null;
      if (target) targets.add(target);
    }
  }
  return [...targets];
}

function slideTargetFromPath(path: string): string | null {
  if (path === "/slides") return "/slides";
  const match = /^\/slides\/([^/]+)/.exec(path);
  if (!match) return null;
  return `/slides/${match[1]}`;
}

/* --------------------------- coercion helpers --------------------------- */

function coerceObject(raw: unknown, groupName: string): Record<string, unknown> | null | string {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      raw = JSON.parse(trimmed);
    } catch (err) {
      const balance = balanceHint(trimmed);
      return [
        `Error: ${groupName} arrived as a string but is not valid JSON.`,
        `Parse error: ${err instanceof Error ? err.message : String(err)}`,
        balance ? `Brace/bracket check: ${balance}` : "",
        `Re-emit ${groupName} as a JSON literal object — e.g. { "/path/to/key": value }.`,
      ].filter(Boolean).join("\n");
    }
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return `Error: ${groupName} must be an object mapping JSON Pointer paths to values (got ${Array.isArray(raw) ? "array" : typeof raw}).`;
  }
  return raw as Record<string, unknown>;
}

function coerceStringArray(raw: unknown, groupName: string): string[] | null | string {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      raw = JSON.parse(trimmed);
    } catch (err) {
      return `Error: ${groupName} arrived as a string but is not valid JSON.\nParse error: ${err instanceof Error ? err.message : String(err)}\nRe-emit ${groupName} as an array of path strings — e.g. ["/slides/3", "/slides/8"].`;
    }
  }
  if (!Array.isArray(raw)) {
    return `Error: ${groupName} must be an array of path strings.`;
  }
  for (const item of raw) {
    if (typeof item !== "string") {
      return `Error: ${groupName} array entries must be strings (JSON Pointer paths).`;
    }
  }
  return raw as string[];
}

function coerceStringValueObject(raw: unknown, groupName: string): Record<string, string> | null | string {
  const obj = coerceObject(raw, groupName);
  if (obj === null) return null;
  if (typeof obj === "string") return obj;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== "string") {
      return `Error: ${groupName}["${k}"] must be a string (the destination JSON Pointer path).`;
    }
  }
  return obj as Record<string, string>;
}

/* --------------------------- legacy rejection --------------------------- */

function rejectLegacyArrayForm(legacyPatch: unknown): string {
  // Translate the legacy array form to the new shape so the agent gets a
  // copy-pasteable fix instead of a generic "removed" message.
  let parsed: unknown = legacyPatch;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed.trim()); } catch { /* ignore — fall through */ }
  }
  if (Array.isArray(parsed)) {
    const set: Record<string, unknown> = {};
    const unset: string[] = [];
    const insert: Record<string, unknown> = {};
    const move: Record<string, string> = {};
    const copy: Record<string, string> = {};
    let ok = true;
    for (const op of parsed) {
      if (!op || typeof op !== "object") { ok = false; break; }
      const r = op as Record<string, unknown>;
      const opName = typeof r.op === "string" ? r.op : "";
      const path = typeof r.path === "string" ? r.path : "";
      if (!opName || !path) { ok = false; break; }
      if (opName === "replace" || opName === "add") set[path] = r.value;
      else if (opName === "remove") unset.push(path);
      else if (opName === "move" && typeof r.from === "string") move[r.from] = path;
      else if (opName === "copy" && typeof r.from === "string") copy[r.from] = path;
      else { ok = false; break; }
    }
    if (ok) {
      const translation: Record<string, unknown> = {};
      if (Object.keys(set).length > 0) translation.set = set;
      if (unset.length > 0) translation.unset = unset;
      if (Object.keys(insert).length > 0) translation.insert = insert;
      if (Object.keys(move).length > 0) translation.move = move;
      if (Object.keys(copy).length > 0) translation.copy = copy;
      return [
        "Error: the legacy `patch: [{op, path, value}, ...]` array form has been removed.",
        "Use the new top-level groups: set / unset / insert / move / copy.",
        "",
        "Your call translates to:",
        JSON.stringify(translation, null, 2),
        "",
        "Re-issue the call with this shape.",
      ].join("\n");
    }
  }
  return [
    "Error: the legacy `patch` argument has been removed.",
    "Use the new top-level groups: set / unset / insert / move / copy.",
    "Examples:",
    '  { "set":   { "/deck/themeOverride/colors/brand.primary": "7C3AED" } }',
    '  { "unset": ["/slides/8"] }',
    '  { "insert":{ "/slides/after:cover": { ...new slide... } } }',
    '  { "move":  { "/slides/5": "/slides/1" } }',
  ].join("\n");
}

/* --------------------------- path validation --------------------------- */

function validateJsonPointer(path: string): string | null {
  if (typeof path !== "string") return "path must be a string";
  if (path === "") return "empty path is not allowed (use a JSON Pointer like \"/slides/3\")";
  if (!path.startsWith("/")) return `path must start with "/" (got "${path}")`;
  // Reject \r and \n in paths — almost always a mistake from line-wrap.
  if (/[\r\n]/.test(path)) return "path contains a newline";
  return null;
}

/**
 * Check whether `set` on this path lands on:
 *   - "exists-in-array": an existing array index → emit RFC `replace`
 *   - "out-of-range":    array index past the end → reject (agent should use insert or /arr/-)
 *   - "free":            anywhere else (object key, /arr/-, missing intermediate) → emit RFC `add`
 */
function checkArrayIndexInBounds(deck: unknown, path: string): "exists-in-array" | "out-of-range" | "free" {
  const parts = jsonPointerParts(path);
  if (parts.length === 0) return "free";
  // Walk parents to verify whether the parent is an array AND the last
  // segment is a numeric index.
  let cur: unknown = deck;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur == null) return "free";
    if (Array.isArray(cur)) {
      const idx = Number(parts[i]);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return "free";
      cur = cur[idx];
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[parts[i]!];
    } else {
      return "free";
    }
  }
  const last = parts[parts.length - 1]!;
  if (Array.isArray(cur)) {
    if (last === "-") return "free"; // append
    const idx = Number(last);
    if (!Number.isInteger(idx)) return "free";
    if (idx < 0) return "out-of-range";
    if (idx < cur.length) return "exists-in-array";
    if (idx === cur.length) return "free"; // exactly-at-end is treated as append
    return "out-of-range";
  }
  return "free";
}

/**
 * Resolve semantic array anchors (`before:<id>` / `after:<id>`) to numeric
 * indices. Returns the path unchanged if no anchor is present, or
 * "ERR:<message>" when the anchor cannot be resolved.
 */
function resolveSemanticArrayPath(path: string, deck: unknown): string {
  if (typeof path !== "string") return "ERR:path must be a string";
  const m = path.match(/^(.*\/)(before|after):(.+)$/);
  if (!m) return path;
  const [, prefix, kind, id] = m as unknown as [string, string, "before" | "after", string];
  // Resolve prefix to the array.
  const parentParts = jsonPointerParts(prefix.replace(/\/$/, ""));
  let cur: unknown = deck;
  for (const seg of parentParts) {
    if (cur == null) return `ERR:cannot resolve "${kind}:${id}" — parent path "${prefix}" not found`;
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx)) return `ERR:cannot resolve "${kind}:${id}" — non-numeric segment "${seg}" inside array`;
      cur = cur[idx];
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return `ERR:cannot resolve "${kind}:${id}" — parent path "${prefix}" is not an object/array`;
    }
  }
  if (!Array.isArray(cur)) {
    return `ERR:semantic anchor "${kind}:${id}" requires an array at "${prefix}", got ${typeof cur}`;
  }
  const idx = (cur as Array<{ id?: unknown }>).findIndex((el) => el && typeof el === "object" && (el as { id?: unknown }).id === id);
  if (idx < 0) {
    const sample = (cur as Array<{ id?: unknown }>).slice(0, 6).map((el, i) => `${i}:${(el as { id?: unknown })?.id || "?"}`).join(", ");
    return `ERR:no element with id="${id}" in array at "${prefix}". First entries: [${sample}${cur.length > 6 ? ", ..." : ""}]`;
  }
  const target = kind === "before" ? idx : idx + 1;
  return `${prefix}${target}`;
}

function jsonPointerParts(ptr: string): string[] {
  if (ptr === "") return [];
  if (!ptr.startsWith("/")) return [];
  return ptr.split("/").slice(1).map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/**
 * Quick brace / bracket balance check for the most common LLM-emitted
 * malformed-JSON case (extra trailing `}` / unbalanced inner objects).
 */
function balanceHint(text: string): string {
  let openObj = 0, closeObj = 0, openArr = 0, closeArr = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === "\"") { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") openObj++;
    else if (c === "}") closeObj++;
    else if (c === "[") openArr++;
    else if (c === "]") closeArr++;
  }
  if (openObj === closeObj && openArr === closeArr) return "";
  const parts: string[] = [];
  if (openObj !== closeObj) {
    const delta = closeObj - openObj;
    parts.push(`${openObj} '{' vs ${closeObj} '}' (${delta > 0 ? `${delta} extra closing` : `${-delta} unclosed`} brace${Math.abs(delta) === 1 ? "" : "s"})`);
  }
  if (openArr !== closeArr) {
    const delta = closeArr - openArr;
    parts.push(`${openArr} '[' vs ${closeArr} ']' (${delta > 0 ? `${delta} extra closing` : `${-delta} unclosed`} bracket${Math.abs(delta) === 1 ? "" : "s"})`);
  }
  return parts.join("; ");
}
