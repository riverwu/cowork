import type { Tool, ProgressCallback } from "./types";
import { runNodeScript, initNodeEnv, installNodePackage } from "@/lib/tauri";

export const runNode: Tool = {
  definition: {
    name: "run_node",
    description:
      `Execute JavaScript code in an isolated Node.js environment (~/.cowork/node/). Packages installed here persist across calls.

Use this for:
- JSON/data processing
- Generating Word documents (docx) — no built-in tool exists
- Custom data-shaping scripts that other tools don't cover
- Any task that benefits from a one-off Node.js library
- Generating files with JavaScript libraries when that is the most direct path for the current task

For standard editable PPTX authoring, prefer the SlideML2 tools because they provide schema validation and render diagnostics. Use \`run_node\` for PPTX only when the user asks for a custom script/library path, when an existing workflow already depends on it, or when SlideML2 is not the right fit for the requested output.

The script runs with a 60-second timeout by default. Use console.log() for output.
If you need packages, use the install_package parameter — it installs to the isolated environment. You may pass one package or a comma/space-separated list.

IMPORTANT: This is the correct way to run Node.js scripts. Do NOT use shell to run "node" directly.
IMPORTANT FOR LARGE OUTPUTS: Keep code compact and data-driven. Define arrays of data and helper functions, then loop. Do not pass thousands of lines of repeated code as a tool argument.
If a script is too large for one tool call, write it to a workspace file with write_file chunks, then call run_node with a short loader: require("/absolute/path/to/script.js").`,
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "JavaScript code to execute. Use console.log() for output. Use require() for packages.",
        },
        install_package: {
          type: "string",
          description: "If set, install npm package(s) before running code. Accepts one package or a comma/space-separated list. Leave empty if not needed.",
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
      const packages = parsePackageList(installPkg);
      for (const pkg of packages) {
        const installResult = await installNodePackage(pkg);
        if (installResult.toLowerCase().includes("err")) {
          return `Package installation failed for ${pkg}: ${installResult}`;
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

function parsePackageList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map((pkg) => pkg.trim())
    .filter(Boolean);
}
