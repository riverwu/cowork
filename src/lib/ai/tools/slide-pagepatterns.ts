export type SlidePagePattern = {
  name: string;
  purpose: string;
  titlePolicy: "none" | "optional" | "required" | "component";
  regions: string[];
  optionalRegions?: string[];
  bestFor: string[];
  defaultPolicy: {
    emphasis: "balanced" | "main" | "supporting";
    density: "sparse" | "medium" | "dense";
    overflow: "shrink" | "clip" | "split";
  };
  guidance: string;
  example: Record<string, unknown>;
};

export const SLIDE_PAGE_PATTERNS: SlidePagePattern[] = [
  {
    name: "single-focus",
    purpose: "One dominant content component with maximum visual clarity.",
    regions: ["main"],
    bestFor: ["cover", "closing", "quote", "hero-stat", "title-only", "image-full-bleed"],
    titlePolicy: "component",
    defaultPolicy: { emphasis: "main", density: "sparse", overflow: "shrink" },
    guidance: "Use when the slide has one idea. Prefer a high-impact component and keep supporting text inside that component's props.",
    example: {
      pattern: "single-focus",
      title: "Q2 Strategy",
      regions: { main: { component: "cover", props: { title: "Q2 Strategy", subtitle: "Three bets for durable growth" } } },
    },
  },
  {
    name: "title-content",
    purpose: "A titled slide with one standard body component.",
    titlePolicy: "required",
    regions: ["main"],
    bestFor: ["agenda", "executive-summary", "article-flow", "visual-with-text", "data-table"],
    defaultPolicy: { emphasis: "balanced", density: "medium", overflow: "shrink" },
    guidance: "Use for ordinary content pages where the title frames a single body component.",
    example: {
      pattern: "title-content",
      title: "Executive Summary",
      regions: { main: { component: "executive-summary", props: { title: "Executive Summary", bullets: ["Revenue grew 18%", "Retention improved"] } } },
    },
  },
  {
    name: "main-plus-sidebar",
    purpose: "A dominant main region plus a smaller explanatory or evidence sidebar.",
    titlePolicy: "optional",
    regions: ["main", "sidebar"],
    bestFor: ["timeline + quote", "chart-with-takeaway + key-point", "visual-with-text + stat-grid-3", "data-table + takeaway"],
    defaultPolicy: { emphasis: "main", density: "medium", overflow: "split" },
    guidance: "Use when one component carries the story and the second adds interpretation, caveat, quote, KPI, or evidence.",
    example: {
      pattern: "main-plus-sidebar",
      title: "Launch Timeline",
      regions: {
        main: { component: "timeline", props: { items: [{ when: "Q1", title: "Pilot" }, { when: "Q2", title: "Scale" }] } },
        sidebar: { component: "quote", props: { quote: "Adoption follows workflow fit.", attribution: "Research" } },
      },
      policy: { emphasis: "main", density: "medium", overflow: "split" },
    },
  },
  {
    name: "two-column",
    purpose: "Two balanced regions for comparison or paired arguments.",
    titlePolicy: "optional",
    regions: ["left", "right"],
    optionalRegions: ["main", "sidebar"],
    bestFor: ["key-point + key-point", "quote + quote", "definition + visual", "article-flow + image"],
    defaultPolicy: { emphasis: "balanced", density: "medium", overflow: "shrink" },
    guidance: "Use when both sides have similar importance. Prefer left/right region names for clarity.",
    example: {
      pattern: "two-column",
      title: "Build vs. Buy",
      regions: {
        left: { component: "key-point", props: { title: "Build", body: "Maximum control, slower time to market." } },
        right: { component: "key-point", props: { title: "Buy", body: "Faster launch, lower differentiation." } },
      },
    },
  },
  {
    name: "hero-plus-supporting",
    purpose: "A hero region with a compact support strip for evidence or next actions.",
    titlePolicy: "optional",
    regions: ["main", "supporting"],
    bestFor: ["hero-stat + stat-grid-3", "image-full-bleed + quote", "visual-with-caption + takeaway"],
    defaultPolicy: { emphasis: "main", density: "medium", overflow: "split" },
    guidance: "Use when the audience should first read one large visual/stat, then scan secondary evidence.",
    example: {
      pattern: "hero-plus-supporting",
      regions: {
        main: { component: "hero-stat", props: { value: "42%", label: "faster onboarding" } },
        supporting: { component: "stat-grid-3", props: { stats: [{ value: "18%", label: "ARR" }, { value: "9pt", label: "NPS" }, { value: "3", label: "markets" }] } },
      },
    },
  },
  {
    name: "top-bottom",
    purpose: "Two stacked regions for setup/result or narrative/evidence.",
    titlePolicy: "optional",
    regions: ["top", "bottom"],
    optionalRegions: ["main", "supporting"],
    bestFor: ["process-flow + takeaway", "chart-with-takeaway + data-table", "article-flow + quote"],
    defaultPolicy: { emphasis: "balanced", density: "medium", overflow: "split" },
    guidance: "Use when vertical order matters more than side-by-side comparison.",
    example: {
      pattern: "top-bottom",
      title: "Operating Model",
      regions: {
        top: { component: "process-flow", props: { steps: [{ title: "Capture" }, { title: "Route" }, { title: "Resolve" }] } },
        bottom: { component: "takeaway-callout", props: { title: "Takeaway", body: "Routing quality drives cycle time." } },
      },
    },
  },
  {
    name: "grid",
    purpose: "Multiple equally scannable regions for small modules.",
    titlePolicy: "optional",
    regions: ["top", "left", "right", "bottom"],
    optionalRegions: ["main"],
    bestFor: ["kpi tiles", "image-grid", "matrix-2x2", "team-grid", "content-grid"],
    defaultPolicy: { emphasis: "balanced", density: "dense", overflow: "clip" },
    guidance: "Use for small, parallel content. Avoid long prose; each region should be compact.",
    example: {
      pattern: "grid",
      title: "Market Signals",
      regions: {
        top: { component: "key-point", props: { title: "Demand", body: "Enterprise pull is rising." } },
        left: { component: "key-point", props: { title: "Supply", body: "Vendors consolidate." } },
        right: { component: "key-point", props: { title: "Pricing", body: "Seat expansion slows." } },
        bottom: { component: "key-point", props: { title: "Risk", body: "Procurement cycles lengthen." } },
      },
    },
  },
  {
    name: "dashboard",
    purpose: "Dense executive/data view with several metrics, charts, or tables.",
    titlePolicy: "optional",
    regions: ["main", "top", "left", "right"],
    optionalRegions: ["bottom", "sidebar"],
    bestFor: ["stat-grid-3 + data-table", "hero-stat + visual-with-caption", "quote + roadmap", "mixed KPI/chart/table/text"],
    defaultPolicy: { emphasis: "balanced", density: "dense", overflow: "clip" },
    guidance: "Use only when the slide is meant for scanning. Keep each component concise and numeric.",
    example: {
      pattern: "dashboard",
      title: "Q2 Health",
      regions: {
        main: { component: "stat-grid-3", props: { stats: [{ value: "$12.4M", label: "ARR" }, { value: "118%", label: "NRR" }, { value: "3.1%", label: "Churn" }] } },
        top: { component: "hero-stat", props: { value: "18%", label: "YoY growth" } },
        left: { component: "data-table", props: { columns: ["Metric", "Value"], rows: [["Pipeline", "$4.2M"], ["Win rate", "31%"]] } },
        right: { component: "quote", props: { quote: "Expansion quality is improving." } },
      },
    },
  },
  {
    name: "full-bleed-visual",
    purpose: "Visual-first page where the image or visual treatment dominates the slide.",
    titlePolicy: "none",
    regions: ["main"],
    bestFor: ["image-full-bleed", "hero-image-overlay", "visual-with-caption"],
    defaultPolicy: { emphasis: "main", density: "sparse", overflow: "clip" },
    guidance: "Use for image-led storytelling. Put only essential text in the component props.",
    example: {
      pattern: "full-bleed-visual",
      regions: { main: { component: "image-full-bleed", props: { image: { src: "/absolute/path/image.jpg", alt: "Factory floor" }, caption: "Automation line" } } },
    },
  },
  {
    name: "section-divider",
    purpose: "Section break or chapter marker.",
    titlePolicy: "component",
    regions: ["main"],
    bestFor: ["section-divider", "title-only"],
    defaultPolicy: { emphasis: "main", density: "sparse", overflow: "shrink" },
    guidance: "Use sparingly to separate major narrative sections. It also drives deck section tracking.",
    example: {
      pattern: "section-divider",
      regions: { main: { component: "section-divider", props: { eyebrow: "Part 2", title: "Execution Plan" } } },
    },
  },
];

export function findSlidePagePattern(name: string): SlidePagePattern | undefined {
  return SLIDE_PAGE_PATTERNS.find((pattern) => pattern.name === name);
}
