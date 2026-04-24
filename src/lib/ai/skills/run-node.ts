import type { Skill, ProgressCallback } from "./types";
import { runNodeScript, initNodeEnv, installNodePackage } from "@/lib/tauri";

export const runNode: Skill = {
  definition: {
    name: "run_node",
    description:
      `Execute JavaScript code in an isolated Node.js environment (~/.cowork/node/). Packages installed here persist across calls.

Use this for:
- Generating PowerPoint presentations (pptxgenjs)
- Generating Word documents (docx)
- JSON/data processing
- Any task that benefits from Node.js libraries

The script runs with a 60-second timeout by default. Use console.log() for output.
If you need a package, use the install_package parameter — it installs to the isolated environment.

IMPORTANT: This is the correct way to run Node.js scripts. Do NOT use shell to run "node" directly.`,
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "JavaScript code to execute. Use console.log() for output. Use require() for packages.",
        },
        install_package: {
          type: "string",
          description: "If set, install this npm package before running code. E.g. \"pptxgenjs\" or \"docx\". Leave empty if not needed.",
        },
        cwd: {
          type: "string",
          description: "Working directory for file output (absolute path). Defaults to home directory.",
        },
        timeout: {
          type: "number",
          description: "Timeout in seconds (default: 60, max: 300)",
        },
      },
      required: ["code"],
    },
  },

  async execute(input: Record<string, unknown>, _onProgress?: ProgressCallback) {
    const code = input.code as string;
    const installPkg = input.install_package as string | undefined;
    const cwd = input.cwd as string | undefined;
    const timeout = Math.min((input.timeout as number) || 60, 300);

    try {
      // Ensure node env is initialized
      await initNodeEnv();

      // Install package if requested
      if (installPkg) {
        const installResult = await installNodePackage(installPkg);
        if (installResult.toLowerCase().includes("err")) {
          return `Package installation failed: ${installResult}`;
        }
      }

      // Execute the script
      const result = await runNodeScript(code, cwd, timeout);

      let output = "";
      if (result.stdout) {
        output += result.stdout;
      }
      if (result.stderr) {
        output += (output ? "\n\n" : "") + `stderr:\n${result.stderr}`;
      }
      if (result.exit_code !== 0) {
        output += (output ? "\n\n" : "") + `Process exited with code ${result.exit_code}`;
      }

      return output || "(no output)";
    } catch (err) {
      return `Node execution error: ${err}`;
    }
  },
};
