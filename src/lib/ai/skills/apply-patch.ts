import type { Skill } from "./types";
import { readFileText, writeFile } from "@/lib/tauri";

/**
 * Apply patch tool — modeled after Codex CLI's patch format.
 *
 * Patch format:
 * *** Begin Patch
 * *** Update File: path/to/file.ts
 * @@ context_line_to_find
 *  context_line (unchanged)
 * -old_line (to remove)
 * +new_line (to add)
 *  context_line (unchanged)
 * *** Add File: path/to/new_file.ts
 * +line1
 * +line2
 * *** Delete File: path/to/remove.ts
 * *** End Patch
 */
export const applyPatchSkill: Skill = {
  definition: {
    name: "apply_patch",
    description:
      `Apply a patch to create, modify, or delete files. Use this instead of write_file when you need to make targeted changes to existing files.

Patch format:
\`\`\`
*** Begin Patch
*** Update File: path/to/file.ts
@@ context_line_to_anchor
 unchanged_line
-line_to_remove
+line_to_add
 unchanged_line
*** Add File: path/to/new.ts
+new file content line 1
+new file content line 2
*** Delete File: path/to/old.ts
*** End Patch
\`\`\`

Rules:
- Lines starting with ' ' (space) are context (unchanged)
- Lines starting with '-' are removed
- Lines starting with '+' are added
- The @@ line finds the anchor position in the file
- Multiple @@ sections can appear in one file update
- Use "Add File" for new files, "Delete File" to remove files`,
    parameters: {
      type: "object",
      properties: {
        patch: {
          type: "string",
          description: "The patch content in the format described above",
        },
      },
      required: ["patch"],
    },
  },

  async execute(input) {
    const patch = input.patch as string;
    try {
      const results = await applyPatch(patch);
      return results.join("\n");
    } catch (err) {
      return `Patch failed: ${err}`;
    }
  },
};

interface PatchAction {
  type: "add" | "update" | "delete";
  path: string;
  content: string; // raw patch content for this file
}

function parsePatch(patch: string): PatchAction[] {
  const actions: PatchAction[] = [];
  const lines = patch.split("\n");

  let currentAction: PatchAction | null = null;
  let contentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("*** Begin Patch") || line.startsWith("*** End Patch")) {
      if (currentAction) {
        currentAction.content = contentLines.join("\n");
        actions.push(currentAction);
        currentAction = null;
        contentLines = [];
      }
      continue;
    }

    if (line.startsWith("*** Add File: ")) {
      if (currentAction) {
        currentAction.content = contentLines.join("\n");
        actions.push(currentAction);
        contentLines = [];
      }
      currentAction = { type: "add", path: line.slice("*** Add File: ".length).trim(), content: "" };
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      if (currentAction) {
        currentAction.content = contentLines.join("\n");
        actions.push(currentAction);
        contentLines = [];
      }
      currentAction = { type: "update", path: line.slice("*** Update File: ".length).trim(), content: "" };
      continue;
    }

    if (line.startsWith("*** Delete File: ")) {
      if (currentAction) {
        currentAction.content = contentLines.join("\n");
        actions.push(currentAction);
        contentLines = [];
      }
      actions.push({ type: "delete", path: line.slice("*** Delete File: ".length).trim(), content: "" });
      currentAction = null;
      continue;
    }

    if (currentAction) {
      contentLines.push(line);
    }
  }

  if (currentAction) {
    currentAction.content = contentLines.join("\n");
    actions.push(currentAction);
  }

  return actions;
}

async function applyPatch(patch: string): Promise<string[]> {
  const actions = parsePatch(patch);
  const results: string[] = [];

  for (const action of actions) {
    switch (action.type) {
      case "add": {
        // Extract lines starting with +
        const content = action.content
          .split("\n")
          .filter((l) => l.startsWith("+"))
          .map((l) => l.slice(1))
          .join("\n");
        await writeFile(action.path, content);
        results.push(`Created: ${action.path}`);
        break;
      }

      case "delete": {
        // Use writeFile to create empty (effectively delete)
        // In practice we'd want a delete command, but this works
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          // Try to delete via shell
          await invoke("shell_exec", {
            params: { command: ["rm", "-f", action.path] },
          });
          results.push(`Deleted: ${action.path}`);
        } catch {
          results.push(`Failed to delete: ${action.path}`);
        }
        break;
      }

      case "update": {
        try {
          const originalContent = await readFileText(action.path);
          const originalLines = originalContent.split("\n");
          const updatedLines = applyHunks(originalLines, action.content);
          await writeFile(action.path, updatedLines.join("\n"));
          results.push(`Updated: ${action.path}`);
        } catch (err) {
          results.push(`Failed to update ${action.path}: ${err}`);
        }
        break;
      }
    }
  }

  return results;
}

/**
 * Apply diff hunks to file lines.
 * Follows Codex's matching strategy:
 * 1. Use @@ anchor to find position
 * 2. Match context lines
 * 3. Apply removals and additions
 * 4. Process hunks in reverse order to avoid index shifting
 */
function applyHunks(fileLines: string[], patchContent: string): string[] {
  const result = [...fileLines];
  const hunks = parseHunks(patchContent);

  // Apply in reverse order to avoid index shifting
  const resolvedHunks = hunks
    .map((hunk) => ({
      ...hunk,
      startIndex: findHunkPosition(result, hunk),
    }))
    .filter((h) => h.startIndex >= 0)
    .sort((a, b) => b.startIndex - a.startIndex);

  for (const hunk of resolvedHunks) {
    const { startIndex, oldLines, newLines } = hunk;
    result.splice(startIndex, oldLines.length, ...newLines);
  }

  return result;
}

interface Hunk {
  anchor: string;
  oldLines: string[];
  newLines: string[];
}

function parseHunks(content: string): Hunk[] {
  const lines = content.split("\n");
  const hunks: Hunk[] = [];
  let currentAnchor = "";
  let oldLines: string[] = [];
  let newLines: string[] = [];
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith("@@ ")) {
      // Save previous hunk
      if (inHunk && (oldLines.length > 0 || newLines.length > 0)) {
        hunks.push({ anchor: currentAnchor, oldLines, newLines });
      }
      currentAnchor = line.slice(3).trim();
      oldLines = [];
      newLines = [];
      inHunk = true;
      continue;
    }

    if (!inHunk) continue;

    if (line.startsWith("-")) {
      oldLines.push(line.slice(1));
    } else if (line.startsWith("+")) {
      newLines.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      // Context line — appears in both old and new
      oldLines.push(line.slice(1));
      newLines.push(line.slice(1));
    }
  }

  // Save last hunk
  if (inHunk && (oldLines.length > 0 || newLines.length > 0)) {
    hunks.push({ anchor: currentAnchor, oldLines, newLines });
  }

  return hunks;
}

/**
 * Find where a hunk should be applied in the file.
 * Progressive matching: exact → trimmed → fuzzy
 */
function findHunkPosition(fileLines: string[], hunk: Hunk): number {
  if (hunk.oldLines.length === 0) {
    // Pure addition — find anchor position
    if (hunk.anchor) {
      const idx = fileLines.findIndex((l) => l.trim() === hunk.anchor.trim());
      return idx >= 0 ? idx + 1 : fileLines.length;
    }
    return fileLines.length;
  }

  // 1. Exact match near anchor
  if (hunk.anchor) {
    const anchorIdx = fileLines.findIndex((l) => l.trim() === hunk.anchor.trim());
    if (anchorIdx >= 0) {
      // Search near anchor
      for (let i = anchorIdx; i < Math.min(anchorIdx + 20, fileLines.length); i++) {
        if (matchesSequence(fileLines, i, hunk.oldLines)) return i;
      }
    }
  }

  // 2. Exact match anywhere
  for (let i = 0; i < fileLines.length; i++) {
    if (matchesSequence(fileLines, i, hunk.oldLines)) return i;
  }

  // 3. Trimmed match
  for (let i = 0; i < fileLines.length; i++) {
    if (matchesSequenceTrimmed(fileLines, i, hunk.oldLines)) return i;
  }

  return -1; // Not found
}

function matchesSequence(fileLines: string[], start: number, pattern: string[]): boolean {
  if (start + pattern.length > fileLines.length) return false;
  return pattern.every((p, i) => fileLines[start + i] === p);
}

function matchesSequenceTrimmed(fileLines: string[], start: number, pattern: string[]): boolean {
  if (start + pattern.length > fileLines.length) return false;
  return pattern.every((p, i) => fileLines[start + i].trim() === p.trim());
}
