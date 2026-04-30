import type { Tool } from "./types";
import { SLIDE_PAGE_PATTERNS } from "./slide-pagepatterns";

export const listSlidePagePatternsTool: Tool = {
  definition: {
    name: "list_slide_pagepatterns",
    description:
      `List SlideML PagePatterns — the page-level geometry choices agents combine with ContentComponents.

Call this before authoring a deck. Pick a PagePattern for each slide, then fill its named \`regions\` with ContentComponents from \`list_content_components\`.

Returns compact summaries:
- \`name\`: value for \`slides[].pattern\`
- \`titlePolicy\`: how \`slides[].title\` is handled (\`required\`, \`optional\`, \`component\`, or \`none\`)
- \`regions\`: required region names available on that pattern
- \`optionalRegions\`: additional accepted region aliases
- \`bestFor\`: typical component combinations
- \`defaultPolicy\`: recommended \`policy\` defaults`,
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },

  async execute() {
    const summaries = SLIDE_PAGE_PATTERNS.map(({ name, purpose, titlePolicy, regions, optionalRegions, bestFor, defaultPolicy }) => ({
      name,
      purpose,
      titlePolicy,
      regions,
      optionalRegions,
      bestFor,
      defaultPolicy,
    }));
    return JSON.stringify(summaries, null, 2);
  },

  historySummarizer(rawResult, status) {
    if (status === "fail") return rawResult;
    try {
      const arr = JSON.parse(rawResult) as Array<{ name?: string }>;
      return `→ ${arr.length} PagePatterns (${arr.map((p) => p.name).filter(Boolean).join(", ")})`;
    } catch {
      return rawResult.slice(0, 200);
    }
  },
};
