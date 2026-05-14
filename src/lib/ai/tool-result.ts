/** Patterns that classify a stringly-returned tool result as a failure.
 *  We treat tool results as "successful unless proven failed", but agents
 *  routinely lie about success when the *real* result was a failure that
 *  these patterns missed — so this list errs on the side of catching more.
 *  When in doubt, add a pattern; false positives are far less harmful than
 *  the agent claiming "✓ done" on a failed run. */
const FAILURE_PATTERNS = [
  /^Error\b/i,
  /\nError\b/i,
  /^(?:Package installation|Browser|MCP tool|Tool call)\s+failed\b/i,
  /\bnpm install failed\b/i,
  /\berror code\b/i,
  /\bnpm error\b/i,
  /\bNode execution error\b/i,
  /\bPython execution error\b/i,
  /\bTool execution error\b/i,
  /\bProcess exited with code\s+([1-9]\d*)\b/i,
  /\[Exit code:\s*([1-9]\d*)\]/i,
  // SlideML / structured-validation failures
  /\bSLOT_REQUIRED\b/,
  /\bSLOT_TYPE_MISMATCH\b/,
  /\bEXTRA_KEY\b/,
  /\bPARSE_ERROR\b/,
  /Validation failed/i,
  // HTTP / network
  /\bHTTP\s+[45]\d\d\b/i,
  /\bAPI returned HTTP\s+[45]\d\d\b/i,
  /\bENOENT\b/,
  /\bECONNREFUSED\b/,
  /\bETIMEDOUT\b/,
  /\bENOTFOUND\b/,
  /fetch failed/i,
  // Timeouts
  /\btimed\s*out\b/i,
  /\bMCP request timeout\b/i,
  // Python / generic stack traces
  /Traceback \(most recent call last\)/,
  /SyntaxError:/,
  // MCP error envelope
  /\bMCP tool error\b/i,
];

export function isToolResultFailure(result: string): boolean {
  if (!result) return false;
  const structuredFailure = parseStructuredFailure(result);
  if (structuredFailure) return true;
  return FAILURE_PATTERNS.some((pattern) => pattern.test(result));
}

/** Extract the most informative one-line snippet from a noisy tool result —
 *  the first line matched by any failure pattern. Used to prepend a clear
 *  error summary so a model that only reads the first 200 chars still sees
 *  the failure cause. */
export function extractFailureSnippet(result: string): string | null {
  if (!result) return null;
  const structuredFailure = parseStructuredFailure(result);
  if (structuredFailure) return structuredFailure;
  const lines = result.split("\n");
  for (const line of lines) {
    if (FAILURE_PATTERNS.some((p) => p.test(line))) {
      return line.trim().slice(0, 240);
    }
  }
  return null;
}

function parseStructuredFailure(result: string): string | null {
  const trimmed = result.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  const candidates = [trimmed];
  if (trimmed.startsWith("{")) {
    const lastBrace = trimmed.lastIndexOf("}");
    if (lastBrace > 0) candidates.push(trimmed.slice(0, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        if (record.ok === false) {
          const message = typeof record.error === "string" && record.error.trim()
            ? record.error.trim()
            : typeof record.status === "string" && record.status.trim()
              ? `Structured tool result returned ok:false (${record.status.trim()})`
              : "Structured tool result returned ok:false";
          return message.slice(0, 240);
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}
