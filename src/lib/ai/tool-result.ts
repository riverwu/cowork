const FAILURE_PATTERNS = [
  /^Error\b/i,
  /\nError\b/i,
  /\bfailed\b/i,
  /\berror code\b/i,
  /\bnpm error\b/i,
  /\bNode execution error\b/i,
  /\bPython execution error\b/i,
  /\bTool execution error\b/i,
  /\bProcess exited with code\s+([1-9]\d*)\b/i,
];

export function isToolResultFailure(result: string): boolean {
  if (!result) return false;
  return FAILURE_PATTERNS.some((pattern) => pattern.test(result));
}
