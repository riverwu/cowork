import { comparisonCard, imageWithCaptionPanel, insightCallout, metricCard, paragraphText, stepCard, titleText } from "../components.js";
import type { BrandSpec, RenderedDeck, RenderedSlide } from "../types.js";

export interface PageBrief {
  slideId: string;
  title: string;
  body: string;
  imageSrc: string;
  imageTitle: string;
}

export interface DashboardBrief {
  slideId: string;
  title: string;
  summary: string;
  metrics: Array<{ name: string; value: string; label: string }>;
  bullets: string[];
  imageSrc: string;
  imageTitle: string;
}

export interface TimelineBrief {
  slideId: string;
  title: string;
  intro: string;
  steps: Array<{ title: string; body: string }>;
}

export interface ComparisonBrief {
  slideId: string;
  title: string;
  thesis: string;
  columns: Array<{ title: string; points: string[] }>;
}

export function designSlideFromBrief(brief: PageBrief): RenderedSlide {
  return {
    id: brief.slideId,
    layout: "image-and-text",
    dom: {
      id: `${brief.slideId}.root`,
      type: "slide",
      background: "background",
      children: [
        titleText(brief.slideId, "slide-title", brief.title),
        {
          id: `${brief.slideId}.contentLayout`,
          type: "grid",
          area: "content",
          columns: 2,
          columnWeights: [0.54, 0.46],
          gap: 0.55,
          role: "text-image-layout",
          children: [
            {
              id: `${brief.slideId}.textPanel`,
              type: "stack",
              direction: "vertical",
              gap: 0.3,
              children: [
                { ...paragraphText(brief.slideId, "body-text", brief.body), valign: "top" },
              ],
            },
            imageWithCaptionPanel(brief.slideId, brief.imageSrc, brief.imageTitle),
          ],
        },
      ],
    },
  };
}

export function designDeckFromBrief(brand: BrandSpec, brief: PageBrief): RenderedDeck {
  return {
    deck: { size: "16x9", theme: "simple", brand },
    slides: [designSlideFromBrief(brief)],
  };
}

export function designDashboardSlide(brief: DashboardBrief): RenderedSlide {
  return {
    id: brief.slideId,
    layout: "title-and-content",
    dom: {
      id: `${brief.slideId}.root`,
      type: "slide",
      background: "background",
      children: [
        titleText(brief.slideId, "slide-title", brief.title),
        {
          id: `${brief.slideId}.dashboard`,
          type: "stack",
          area: "content",
          direction: "vertical",
          gap: 0.4,
          children: [
            insightCallout(brief.slideId, "dashboard-summary", brief.summary),
            {
              id: `${brief.slideId}.metricStrip`,
              type: "grid",
              columns: 3,
              gap: 0.3,
              fixedHeight: 2.5,
              children: brief.metrics.map((metric) => metricCard(brief.slideId, metric.name, metric.value, metric.label)),
            },
            {
              id: `${brief.slideId}.detailGrid`,
              type: "grid",
              columns: 2,
              columnWeights: [0.46, 0.54],
              gap: 0.45,
              layoutWeight: 1,
              children: [
                {
                  id: `${brief.slideId}.bulletPanel`,
                  type: "stack",
                  direction: "vertical",
                  gap: 0.25,
                  fill: "surface",
                  line: "divider",
                  padding: 0.3,
                  children: [
                    { id: `${brief.slideId}.bulletHeading`, type: "text", text: "关键判断", style: "card-title", color: "brand.primary", fixedHeight: 0.65 },
                    { id: `${brief.slideId}.bulletList`, type: "bullets", items: brief.bullets, density: "compact", layoutWeight: 1 },
                  ],
                },
                imageWithCaptionPanel(brief.slideId, brief.imageSrc, brief.imageTitle),
              ],
            },
          ],
        },
      ],
    },
  };
}

export function designTimelineSlide(brief: TimelineBrief): RenderedSlide {
  return {
    id: brief.slideId,
    layout: "title-and-content",
    dom: {
      id: `${brief.slideId}.root`,
      type: "slide",
      background: "background",
      children: [
        titleText(brief.slideId, "slide-title", brief.title),
        {
          id: `${brief.slideId}.timelineLayout`,
          type: "stack",
          area: "content",
          direction: "vertical",
          gap: 0.4,
          children: [
            { ...paragraphText(brief.slideId, "timeline-intro", brief.intro), fixedHeight: 1.05, valign: "top" },
            {
              id: `${brief.slideId}.steps`,
              type: "grid",
              columns: brief.steps.length,
              gap: 0.3,
              fixedHeight: 6.2,
              children: brief.steps.map((step, index) => stepCard(brief.slideId, `step-${index + 1}`, `0${index + 1}`, step.title, step.body)),
            },
          ],
        },
      ],
    },
  };
}

export function designComparisonSlide(brief: ComparisonBrief): RenderedSlide {
  return {
    id: brief.slideId,
    layout: "title-and-content",
    dom: {
      id: `${brief.slideId}.root`,
      type: "slide",
      background: "background",
      children: [
        titleText(brief.slideId, "slide-title", brief.title),
        {
          id: `${brief.slideId}.comparisonLayout`,
          type: "stack",
          area: "content",
          direction: "vertical",
          gap: 0.4,
          children: [
            insightCallout(brief.slideId, "comparison-thesis", brief.thesis),
            {
              id: `${brief.slideId}.comparisonGrid`,
              type: "grid",
              columns: brief.columns.length,
              gap: 0.35,
              fixedHeight: 6.35,
              children: brief.columns.map((column, index) => comparisonCard(brief.slideId, `comparison-${index + 1}`, column.title, column.points)),
            },
          ],
        },
      ],
    },
  };
}

export function designComplexDeck(brand: BrandSpec, briefs: {
  dashboard: DashboardBrief;
  timeline: TimelineBrief;
  comparison: ComparisonBrief;
}): RenderedDeck {
  return {
    deck: { size: "16x9", theme: "simple", brand },
    slides: [
      designDashboardSlide(briefs.dashboard),
      designTimelineSlide(briefs.timeline),
      designComparisonSlide(briefs.comparison),
    ],
  };
}
