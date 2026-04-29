/**
 * Layout registry — single source of truth for all SlideML layouts.
 *
 * Phase A re-architecture: layouts are no longer per-theme TS modules
 * dynamically imported by the loader. They are global, theme-independent
 * implementations registered here. The renderer looks up by name; themes
 * declare which layouts they recommend (separate concern).
 *
 * Adding a new layout: implement the LayoutFn module, then add an
 * import + entry below.
 */

import type { LayoutFn } from "../render/layout-context.js";
import type { SlotSchema } from "../theme/types.js";
import { PURPOSES } from "./_purposes.js";

import agenda,             { slots as agendaSlots }            from "./agenda.js";
import articleFlow,        { slots as articleFlowSlots }       from "./article-flow.js";
import closing,            { slots as closingSlots }           from "./closing.js";
import codeBlock,          { slots as codeBlockSlots }         from "./code-block.js";
import compareTwoColumns,  { slots as compareTwoColumnsSlots } from "./compare-two-columns.js";
import contentGrid,        { slots as contentGridSlots }       from "./content-grid.js";
import cover,              { slots as coverSlots }             from "./cover.js";
import dashboard,          { slots as dashboardSlots }         from "./dashboard.js";
import dataTable,          { slots as dataTableSlots }         from "./data-table.js";
import definition,         { slots as definitionSlots }        from "./definition.js";
import executiveSummary,   { slots as executiveSummarySlots }  from "./executive-summary.js";
import framed,             { slots as framedSlots }            from "./framed.js";
import freeform,           { slots as freeformSlots }          from "./freeform.js";
import funnel,             { slots as funnelSlots }            from "./funnel.js";
import glossary,           { slots as glossarySlots }          from "./glossary.js";
import heroImageOverlay,   { slots as heroImageOverlaySlots }  from "./hero-image-overlay.js";
import heroStat,           { slots as heroStatSlots }          from "./hero-stat.js";
import imageFullBleed,     { slots as imageFullBleedSlots }    from "./image-full-bleed.js";
import imageGrid,          { slots as imageGridSlots }         from "./image-grid.js";
import keyPoint,           { slots as keyPointSlots }          from "./key-point.js";
import letter,             { slots as letterSlots }            from "./letter.js";
import matrix2x2,          { slots as matrix2x2Slots }         from "./matrix-2x2.js";
import outline,            { slots as outlineSlots }           from "./outline.js";
import pricingTable,       { slots as pricingTableSlots }      from "./pricing-table.js";
import processFlow,        { slots as processFlowSlots }       from "./process-flow.js";
import questionList,       { slots as questionListSlots }      from "./q-and-a.js";
import quote,              { slots as quoteSlots }             from "./quote.js";
import roadmap,            { slots as roadmapSlots }           from "./roadmap.js";
import sectionDivider,     { slots as sectionDividerSlots }    from "./section-divider.js";
import split,              { slots as splitSlots }             from "./split.js";
import statGrid3,          { slots as statGrid3Slots }         from "./stat-grid-3.js";
import swot,               { slots as swotSlots }              from "./swot.js";
import teamGrid,           { slots as teamGridSlots }          from "./team-grid.js";
import timeline,           { slots as timelineSlots }          from "./timeline.js";
import titleOnly,          { slots as titleOnlySlots }         from "./title-only.js";
import visualWithCaption,  { slots as visualWithCaptionSlots } from "./visual-with-caption.js";
import visualWithText,     { slots as visualWithTextSlots }    from "./visual-with-text.js";

/** A registered layout — slot schema + render function + agent-facing purpose. */
export interface RegisteredLayout {
  name: string;
  slots: Record<string, SlotSchema>;
  render: LayoutFn;
  /**
   * One-line agent-facing purpose. Surfaced by `summarizeLayouts` and
   * `describeLayout`. Convention: ≤ 100 chars, says what the layout is
   * FOR + (when relevant) capacity hint or "use X instead when …".
   */
  purpose?: string;
}

const ENTRIES: RegisteredLayout[] = [
  { name: "agenda",              slots: agendaSlots,              render: agenda },
  { name: "article-flow",        slots: articleFlowSlots,         render: articleFlow },
  { name: "closing",             slots: closingSlots,             render: closing },
  { name: "code-block",          slots: codeBlockSlots,           render: codeBlock },
  { name: "compare-two-columns", slots: compareTwoColumnsSlots,   render: compareTwoColumns },
  { name: "content-grid",        slots: contentGridSlots,         render: contentGrid },
  { name: "cover",               slots: coverSlots,               render: cover },
  { name: "dashboard",           slots: dashboardSlots,           render: dashboard },
  { name: "data-table",          slots: dataTableSlots,           render: dataTable },
  { name: "definition",          slots: definitionSlots,          render: definition },
  { name: "executive-summary",   slots: executiveSummarySlots,    render: executiveSummary },
  { name: "framed",              slots: framedSlots,              render: framed },
  { name: "freeform",            slots: freeformSlots,            render: freeform },
  { name: "funnel",              slots: funnelSlots,              render: funnel },
  { name: "glossary",            slots: glossarySlots,            render: glossary },
  { name: "hero-image-overlay",  slots: heroImageOverlaySlots,    render: heroImageOverlay },
  { name: "hero-stat",           slots: heroStatSlots,            render: heroStat },
  { name: "image-full-bleed",    slots: imageFullBleedSlots,      render: imageFullBleed },
  { name: "image-grid",          slots: imageGridSlots,           render: imageGrid },
  { name: "key-point",           slots: keyPointSlots,            render: keyPoint },
  { name: "letter",              slots: letterSlots,              render: letter },
  { name: "matrix-2x2",          slots: matrix2x2Slots,           render: matrix2x2 },
  { name: "outline",             slots: outlineSlots,             render: outline },
  { name: "pricing-table",       slots: pricingTableSlots,        render: pricingTable },
  { name: "process-flow",        slots: processFlowSlots,         render: processFlow },
  { name: "question-list",       slots: questionListSlots,        render: questionList },
  { name: "quote",               slots: quoteSlots,               render: quote },
  { name: "roadmap",             slots: roadmapSlots,             render: roadmap },
  { name: "section-divider",     slots: sectionDividerSlots,      render: sectionDivider },
  { name: "split",               slots: splitSlots,               render: split },
  { name: "stat-grid-3",         slots: statGrid3Slots,           render: statGrid3 },
  { name: "swot",                slots: swotSlots,                render: swot },
  { name: "team-grid",           slots: teamGridSlots,            render: teamGrid },
  { name: "timeline",            slots: timelineSlots,            render: timeline },
  { name: "title-only",          slots: titleOnlySlots,           render: titleOnly },
  { name: "visual-with-caption", slots: visualWithCaptionSlots,   render: visualWithCaption },
  { name: "visual-with-text",    slots: visualWithTextSlots,      render: visualWithText },
];

// Stamp purposes from the centralised _purposes.ts table onto each entry
// so both summarizeLayouts and describeLayout surface the same one-liner.
for (const e of ENTRIES) {
  if (PURPOSES[e.name]) e.purpose = PURPOSES[e.name];
}

export const LAYOUT_REGISTRY: ReadonlyMap<string, RegisteredLayout> = new Map(
  ENTRIES.map((e) => [e.name, e]),
);

export function getLayout(name: string): RegisteredLayout | undefined {
  return LAYOUT_REGISTRY.get(name);
}

export function listLayoutNames(): string[] {
  return [...LAYOUT_REGISTRY.keys()];
}
