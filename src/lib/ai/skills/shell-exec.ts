import type { Skill, ProgressCallback } from "./types";
import { shellExec, shellExecStream } from "@/lib/tauri";

export const shellExecSkill: Skill = {
  definition: {
    name: "shell",
    description:
      `Execute a shell command on the user's machine. Use this for:
- Running build tools (npm, cargo, make, etc.)
- Git operations (git status, git diff, git commit, etc.)
- Installing dependencies (pip install, npm install, etc.)
- Running tests (pytest, jest, cargo test, etc.)
- System commands (ls, cat, find, curl, etc.)
- Any command-line tool available on the system

The command runs with the system's PATH plus common tool locations.
Output (stdout + stderr) is captured and returned.
Default timeout: 30 seconds (configurable up to 120s).

IMPORTANT: Be careful with destructive commands. Prefer reading/checking before writing/deleting.`,
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "array",
          items: { type: "string" },
          description: "Command as argv array, e.g. [\"git\", \"status\"] or [\"npm\", \"test\"]",
        },
        cwd: {
          type: "string",
          description: "Working directory (absolute path). Defaults to user's home if not specified.",
        },
        timeout_ms: {
          type: "number",
          description: "Timeout in milliseconds (default: 30000, max: 120000)",
        },
      },
      required: ["command"],
    },
  },

  async execute(input: Record<string, unknown>, onProgress?: ProgressCallback) {
    const command = input.command as string[];
    const cwd = input.cwd as string | undefined;
    const timeoutMs = Math.min((input.timeout_ms as number) || 30000, 120000);

    if (!command || command.length === 0) {
      return "Error: empty command";
    }

    try {
      // Use streaming exec if progress callback is provided
      const result = onProgress
        ? await shellExecStream({ command, cwd, timeout_ms: timeoutMs }, onProgress)
        : await shellExec({ command, cwd, timeout_ms: timeoutMs });

      let output = "";
      if (result.stdout) output += result.stdout;
      if (result.stderr) output += (output ? "\n\nstderr:\n" : "stderr:\n") + result.stderr;
      if (result.timed_out) output += `\n\n[Timed out after ${timeoutMs}ms]`;
      if (result.exit_code !== 0 && !result.timed_out) {
        output += `\n\n[Exit code: ${result.exit_code}]`;
      }

      return output || "(no output)";
    } catch (err) {
      return `Command execution error: ${err}`;
    }
  },
};
