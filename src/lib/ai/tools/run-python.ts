import type { Tool, ProgressCallback } from "./types";
import { runPythonScript, initPythonEnv, installPythonPackage } from "@/lib/tauri";

export const runPython: Tool = {
  definition: {
    name: "run_python",
    description:
      `Execute Python code in an isolated environment. First use initializes ~/.cowork/python/.venv with: pandas, numpy, openpyxl, python-docx, matplotlib, seaborn, PyPDF2, Pillow, python-pptx.

Use this for:
- Data analysis and computation (pandas, numpy)
- Reading/writing Excel files (openpyxl)
- Generating/reading Word documents (python-docx)
- Generating/reading PowerPoint files (python-pptx)
- Inspecting structured Office/PDF files when hierarchy, tables, formatting, pages/slides/sheets, or metadata matter. Prefer this over read_file for DOCX/XLSX/PPTX/PDF analysis.
- Data charts plotted from real numbers (matplotlib, seaborn). For freeform illustrations/covers, \`image_gen\` is usually the better tool.
- Image processing (Pillow)
- PDF processing (PyPDF2)
- Any computation that benefits from Python

The script runs with a 30-second timeout by default. Print results to stdout.
If you need a package that's not pre-installed (e.g. plotly, scikit-learn), first call with install_package parameter.`,
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "Python code to execute. Use print() for output.",
        },
        install_package: {
          type: "string",
          description: "If set, install this pip package before running code. Leave empty if not needed.",
        },
        timeout: {
          type: "number",
          description: "Timeout in seconds (default: 30, max: 120)",
        },
      },
      required: ["code"],
    },
  },

  async execute(input: Record<string, unknown>, _onProgress?: ProgressCallback) {
    const code = input.code as string;
    const installPkg = input.install_package as string | undefined;
    const timeout = Math.min((input.timeout as number) || 30, 120);

    try {
      // Ensure Python env is initialized
      await initPythonEnv();

      // Install package if requested
      if (installPkg) {
        const installResult = await installPythonPackage(installPkg);
        // Continue to execute code after install
        if (isPythonInstallFailure(installResult)) {
          return `Package installation failed: ${installResult}`;
        }
      }

      // Execute the script
      const result = await runPythonScript(code, timeout);

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
      return `Python execution error: ${err}`;
    }
  },
};

function isPythonInstallFailure(output: string): boolean {
  const normalized = output.toLowerCase();
  const successSignals = [
    "installed ",
    "successfully installed",
    "requirement already satisfied",
    "already installed",
    "already initialized",
  ];
  if (successSignals.some((signal) => normalized.includes(signal))) {
    return false;
  }

  return [
    "failed",
    "error:",
    "traceback",
    "no matching distribution found",
    "could not find a version",
  ].some((signal) => normalized.includes(signal));
}
