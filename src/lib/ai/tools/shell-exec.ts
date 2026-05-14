import type { Tool, ProgressCallback } from "./types";
import { shellExec, shellExecStream, getNodePath, installNodePackage, initNodeEnv } from "@/lib/tauri";

export const shellExecSkill: Tool = {
  definition: {
    name: "shell",
    description:
      `Execute a shell command on the user's machine. Use this for:
- Running build tools (npm, cargo, make, etc.)
- Git operations (git status, git diff, git commit, etc.)
- Running tests (pytest, jest, cargo test, etc.)
- System commands (ls, cat, find, curl, etc.)

The command runs with expanded PATH and NODE_PATH set to the isolated package environment.
Output (stdout + stderr) is captured and returned.
Default timeout: 30 seconds (configurable up to 120s).

IMPORTANT:
- Do NOT run "npm install" in the user's working directory. Use the install_package parameter instead, which installs to an isolated environment (~/.cowork/node/).
- Do NOT use shell to run generated Node.js deliverable scripts such as pptxgenjs deck builders. Use run_node instead.
- It is correct to use shell for installed skill CLI entrypoints explicitly documented as CLI commands, such as \`node .../runtime/bin/slideml2.js ...\`; this keeps each toolchain result visible.
- Be careful with destructive commands. Prefer reading/checking before writing/deleting.`,
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "array",
          items: { type: "string" },
          description: "Command as argv array, e.g. [\"git\", \"status\"] or [\"node\", \"script.js\"]",
        },
        install_package: {
          type: "string",
          description: "If set, install this npm package to the isolated environment before running the command. E.g. \"pptxgenjs\" or \"chart.js\". Do NOT use npm install directly.",
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
    const installPkg = input.install_package as string | undefined;
    const timeoutMs = Math.min((input.timeout_ms as number) || 30000, 120000);

    if (!command || command.length === 0) {
      return "Error: empty command";
    }

    try {
      // Install npm package to isolated environment if requested
      if (installPkg) {
        onProgress?.(`Installing ${installPkg}...`);
        await initNodeEnv();
        const installResult = await installNodePackage(installPkg);
        onProgress?.(installResult);
      }

      // Inject NODE_PATH so node/npm commands can find packages from ~/.cowork/node/
      let env: Record<string, string> | undefined;
      try {
        const nodePath = await getNodePath();
        env = { NODE_PATH: nodePath };
      } catch { /* node env not initialized yet, fine */ }

      // Use streaming exec if progress callback is provided
      const params = { command, cwd, timeout_ms: timeoutMs, env };
      const result = onProgress
        ? await shellExecStream(params, onProgress)
        : await shellExec(params);

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
