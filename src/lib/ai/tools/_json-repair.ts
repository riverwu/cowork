/**
 * Best-effort repair for agent-emitted "JSON-stringified array" arguments
 * that fail strict `JSON.parse`. Centralized so append_slides /
 * replace_slide / future tools share one robust implementation.
 *
 * Most common failure mode (observed in MiniMax + Codex format):
 *   The agent emits a string containing literal control characters
 *   (newlines, tabs) inside string values, e.g.
 *     `[{"body": "line 1
 *       line 2"}]`
 *   These are illegal inside JSON string values — the parser bails with
 *   "Expected double-quoted property name" or "Bad control character".
 *
 * Repair strategy: walk the string with a tiny state machine tracking
 * in-string state, and replace raw control chars (only when inside a
 * string) with their JSON escapes. Outside strings, raw whitespace is
 * already legal — leave it alone.
 *
 * Returns the parsed value on success, or throws an Error whose message
 * includes both the original failure and a snippet of the input around
 * the failure position so the caller (or the agent) can self-correct.
 */
export function parseJsonLenient<T = unknown>(input: string): T {
  // Fast path — strict parse first.
  try {
    return JSON.parse(input) as T;
  } catch (firstErr) {
    // Repair pass.
    const repaired = escapeRawControlsInsideStrings(input);
    if (repaired !== input) {
      try {
        return JSON.parse(repaired) as T;
      } catch {
        // fall through to error reporting using ORIGINAL error
      }
    }
    const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
    const pos = extractPosition(msg);
    const snippet = pos !== null ? snippetAround(input, pos, 60) : "";
    throw new Error(snippet ? `${msg}. Near position ${pos}: …${snippet}…` : msg);
  }
}

/**
 * State-machine pass: when inside a JSON string, replace raw control
 * characters with their escape sequences. Tracks string boundaries via
 * `"` toggles, respecting `\` escapes so an escaped quote `\"` doesn't
 * end the string.
 */
function escapeRawControlsInsideStrings(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inString) {
      if (escaped) {
        // The previous char was a backslash; emit ch verbatim.
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        out += ch;
        inString = false;
        continue;
      }
      // Raw control characters → escape them so JSON.parse accepts.
      const code = ch.charCodeAt(0);
      if (code === 0x0a) { out += "\\n"; continue; }
      if (code === 0x0d) { out += "\\r"; continue; }
      if (code === 0x09) { out += "\\t"; continue; }
      if (code === 0x08) { out += "\\b"; continue; }
      if (code === 0x0c) { out += "\\f"; continue; }
      if (code < 0x20) { out += `\\u${code.toString(16).padStart(4, "0")}`; continue; }
      out += ch;
    } else {
      if (ch === "\"") inString = true;
      out += ch;
    }
  }
  return out;
}

function extractPosition(message: string): number | null {
  const m = /position (\d+)/.exec(message);
  return m ? parseInt(m[1]!, 10) : null;
}

function snippetAround(input: string, pos: number, radius: number): string {
  const start = Math.max(0, pos - radius);
  const end = Math.min(input.length, pos + radius);
  return input.slice(start, end).replace(/\s+/g, " ");
}
