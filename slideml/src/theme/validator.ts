/**
 * theme.md structural validator.
 *
 * SPEC.md → "theme.md structure" defines the required section layout. We
 * parse the markdown into level-2 sections (key = lowercased heading) and
 * level-3 subsections under "Layout reference" / "Components". The loader
 * then asserts that each layout/component declared in theme.json has a
 * matching subsection with the required fields.
 *
 * We don't run a full markdown parser — line-based scanning is enough and
 * dependency-free.
 */

export interface ThemeMdSections {
  /** Top-level title (level-1 heading). */
  title: string;
  /** Map of level-2 heading slug → raw section text (excluding the heading itself). */
  byHeading: Record<string, string>;
  /** Map of layout name → first-paragraph description from its subsection. */
  layoutDescriptions: Record<string, string>;
  /** Map of layout name → subsection raw text. */
  layoutSubsections: Record<string, string>;
  /** Map of component name → subsection raw text. */
  componentSubsections: Record<string, string>;
}

const REQUIRED_TOP_SECTIONS = [
  "when to use this theme",
  "when not to use",
  "layout reference",
  "tokens",
];

/**
 * Parse a `theme.md` document into the structured shape above.
 * Throws on missing required sections.
 */
export function parseThemeMd(md: string): ThemeMdSections {
  const lines = md.split(/\r?\n/);

  let title = "";
  const byHeading: Record<string, string> = {};
  const layoutSubsections: Record<string, string> = {};
  const layoutDescriptions: Record<string, string> = {};
  const componentSubsections: Record<string, string> = {};

  let i = 0;
  // Title (first level-1 heading).
  while (i < lines.length) {
    const m = /^#\s+(.+?)\s*$/.exec(lines[i] ?? "");
    if (m) { title = m[1]!; i++; break; }
    i++;
  }
  if (!title) {
    throw new Error("theme.md must start with a level-1 heading (\"# Display Name\").");
  }

  // Walk for level-2 sections.
  let currentH2: string | null = null;
  let currentBody: string[] = [];
  const flush = () => {
    if (currentH2 !== null) {
      byHeading[currentH2] = currentBody.join("\n").trim();
    }
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const m2 = /^##\s+(.+?)\s*$/.exec(line);
    if (m2) {
      flush();
      currentH2 = m2[1]!.trim().toLowerCase();
      currentBody = [];
      i++;
      continue;
    }
    if (currentH2 !== null) currentBody.push(line);
    i++;
  }
  flush();

  for (const required of REQUIRED_TOP_SECTIONS) {
    if (!(required in byHeading)) {
      throw new Error(`theme.md missing required section "## ${capitalize(required)}".`);
    }
  }

  // Walk Layout reference / Components for level-3 subsections.
  for (const [topKey, store, descStore] of [
    ["layout reference", layoutSubsections, layoutDescriptions],
    ["components", componentSubsections, undefined],
  ] as const) {
    const body = byHeading[topKey];
    if (!body) continue;
    const subsections = splitH3(body);
    for (const [name, subBody] of Object.entries(subsections)) {
      store[name] = subBody;
      if (descStore) {
        descStore[name] = firstParagraph(subBody);
      }
    }
  }

  return {
    title,
    byHeading,
    layoutDescriptions,
    layoutSubsections,
    componentSubsections,
  };
}

/**
 * Final validation: every layout/component declared in theme.json must have
 * a matching `### <name>` subsection containing a thumbnail reference.
 */
export function validateThemeStructure(
  sections: ThemeMdSections,
  expectations: { layoutNames: string[]; componentNames: string[] },
): void {
  for (const layoutName of expectations.layoutNames) {
    const sub = sections.layoutSubsections[layoutName];
    if (!sub) {
      throw new Error(
        `theme.md has no "### ${layoutName}" subsection under "## Layout reference" ` +
          `(layout declared in theme.json).`,
      );
    }
    if (!/!\[[^\]]*\]\(thumbnails\/[^)]+\)/.test(sub)) {
      throw new Error(
        `theme.md → "### ${layoutName}" must include a thumbnail reference ` +
          `like ![${layoutName}](thumbnails/${layoutName}.png).`,
      );
    }
    if (!sub.includes("`") && !sub.toLowerCase().includes("slot")) {
      throw new Error(
        `theme.md → "### ${layoutName}" should describe slot constraints ` +
          `(use backticks around slot names).`,
      );
    }
  }
  for (const componentName of expectations.componentNames) {
    if (!sections.componentSubsections[componentName]) {
      throw new Error(
        `theme.md has no "### ${componentName}" subsection under "## Components" ` +
          `(component declared in theme.json).`,
      );
    }
  }
}

function splitH3(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = body.split(/\r?\n/);
  let currentName: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (currentName) out[currentName] = buf.join("\n").trim();
  };
  for (const line of lines) {
    const m = /^###\s+`?([^`\s]+)`?\s*$/.exec(line);
    if (m) {
      flush();
      currentName = m[1]!.trim();
      buf = [];
    } else if (currentName) {
      buf.push(line);
    }
  }
  flush();
  return out;
}

function firstParagraph(text: string): string {
  const trimmed = text.trim();
  const idx = trimmed.indexOf("\n\n");
  return (idx > 0 ? trimmed.slice(0, idx) : trimmed).trim();
}

/**
 * Extract the body of a `**Guidance:**` marker in a layout subsection.
 * Convention: a line starting with `**Guidance:**` (with optional `>`
 * blockquote prefix); content runs until the next blank line OR the
 * next markdown heading. Returns undefined when no marker is present.
 */
export function extractGuidance(subsectionBody: string): string | undefined {
  const lines = subsectionBody.split(/\r?\n/);
  let inGuidance = false;
  const collected: string[] = [];
  for (const line of lines) {
    if (!inGuidance) {
      const m = /^>?\s*\*\*Guidance:\*\*\s*(.*)$/.exec(line);
      if (m) {
        inGuidance = true;
        if (m[1]!.trim()) collected.push(m[1]!.trim());
      }
      continue;
    }
    // Stop on blank line, heading, or thumbnail image.
    if (line.trim() === "" || /^#+\s/.test(line) || /^!\[/.test(line.trim())) {
      break;
    }
    // Strip leading `>` (blockquote continuation).
    collected.push(line.replace(/^>\s?/, "").trim());
  }
  if (collected.length === 0) return undefined;
  return collected.join(" ").trim();
}

function capitalize(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
