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

import agenda,             { slots as agendaSlots }            from "./agenda.js";
import bulletWithImage,    { slots as bulletWithImageSlots }   from "./bullet-with-image.js";
import chartWithTakeaway,  { slots as chartWithTakeawaySlots } from "./chart-with-takeaway.js";
import closing,            { slots as closingSlots }           from "./closing.js";
import codeBlock,          { slots as codeBlockSlots }         from "./code-block.js";
import compareTwoColumns,  { slots as compareTwoColumnsSlots } from "./compare-two-columns.js";
import cover,              { slots as coverSlots }             from "./cover.js";
import dashboard,          { slots as dashboardSlots }         from "./dashboard.js";
import dataTable,          { slots as dataTableSlots }         from "./data-table.js";
import definition,         { slots as definitionSlots }        from "./definition.js";
import executiveSummary,   { slots as executiveSummarySlots }  from "./executive-summary.js";
import framed,             { slots as framedSlots }            from "./framed.js";
import freeform,           { slots as freeformSlots }          from "./freeform.js";
import glossary,           { slots as glossarySlots }          from "./glossary.js";
import heroImageOverlay,   { slots as heroImageOverlaySlots }  from "./hero-image-overlay.js";
import heroStat,           { slots as heroStatSlots }          from "./hero-stat.js";
import imageFullBleed,     { slots as imageFullBleedSlots }    from "./image-full-bleed.js";
import imageGrid2x2,       { slots as imageGrid2x2Slots }      from "./image-grid-2x2.js";
import imagePair,          { slots as imagePairSlots }         from "./image-pair.js";
import imageSplitText,     { slots as imageSplitTextSlots }    from "./image-split-text.js";
import imageWithCaption,   { slots as imageWithCaptionSlots }  from "./image-with-caption.js";
import keyPoint,           { slots as keyPointSlots }          from "./key-point.js";
import letter,             { slots as letterSlots }            from "./letter.js";
import matrix2x2,          { slots as matrix2x2Slots }         from "./matrix-2x2.js";
import outline,            { slots as outlineSlots }           from "./outline.js";
import pricingTable,       { slots as pricingTableSlots }      from "./pricing-table.js";
import processTimeline,    { slots as processTimelineSlots }   from "./process-timeline.js";
import prose,              { slots as proseSlots }             from "./prose.js";
import qAndA,              { slots as qAndASlots }             from "./q-and-a.js";
import quote,              { slots as quoteSlots }             from "./quote.js";
import quoteWithPortrait,  { slots as quoteWithPortraitSlots } from "./quote-with-portrait.js";
import sectionDivider,     { slots as sectionDividerSlots }    from "./section-divider.js";
import split2,             { slots as split2Slots }            from "./split-2.js";
import split3Horizontal,   { slots as split3HorizontalSlots }  from "./split-3-horizontal.js";
import split3Vertical,     { slots as split3VerticalSlots }    from "./split-3-vertical.js";
import statGrid3,          { slots as statGrid3Slots }         from "./stat-grid-3.js";
import teamGrid,           { slots as teamGridSlots }          from "./team-grid.js";
import timelineText,       { slots as timelineTextSlots }      from "./timeline-text.js";
import titleOnly,          { slots as titleOnlySlots }         from "./title-only.js";
import twoColTextImage,    { slots as twoColTextImageSlots }   from "./two-col-text-image.js";
import twoColumnProse,     { slots as twoColumnProseSlots }    from "./two-column-prose.js";

/** A registered layout — slot schema + render function. */
export interface RegisteredLayout {
  name: string;
  slots: Record<string, SlotSchema>;
  render: LayoutFn;
}

const ENTRIES: RegisteredLayout[] = [
  { name: "agenda",              slots: agendaSlots,              render: agenda },
  { name: "bullet-with-image",   slots: bulletWithImageSlots,     render: bulletWithImage },
  { name: "chart-with-takeaway", slots: chartWithTakeawaySlots,   render: chartWithTakeaway },
  { name: "closing",             slots: closingSlots,             render: closing },
  { name: "code-block",          slots: codeBlockSlots,           render: codeBlock },
  { name: "compare-two-columns", slots: compareTwoColumnsSlots,   render: compareTwoColumns },
  { name: "cover",               slots: coverSlots,               render: cover },
  { name: "dashboard",           slots: dashboardSlots,           render: dashboard },
  { name: "data-table",          slots: dataTableSlots,           render: dataTable },
  { name: "definition",          slots: definitionSlots,          render: definition },
  { name: "executive-summary",   slots: executiveSummarySlots,    render: executiveSummary },
  { name: "framed",              slots: framedSlots,              render: framed },
  { name: "freeform",            slots: freeformSlots,            render: freeform },
  { name: "glossary",            slots: glossarySlots,            render: glossary },
  { name: "hero-image-overlay",  slots: heroImageOverlaySlots,    render: heroImageOverlay },
  { name: "hero-stat",           slots: heroStatSlots,            render: heroStat },
  { name: "image-full-bleed",    slots: imageFullBleedSlots,      render: imageFullBleed },
  { name: "image-grid-2x2",      slots: imageGrid2x2Slots,        render: imageGrid2x2 },
  { name: "image-pair",          slots: imagePairSlots,           render: imagePair },
  { name: "image-split-text",    slots: imageSplitTextSlots,      render: imageSplitText },
  { name: "image-with-caption",  slots: imageWithCaptionSlots,    render: imageWithCaption },
  { name: "key-point",           slots: keyPointSlots,            render: keyPoint },
  { name: "letter",              slots: letterSlots,              render: letter },
  { name: "matrix-2x2",          slots: matrix2x2Slots,           render: matrix2x2 },
  { name: "outline",             slots: outlineSlots,             render: outline },
  { name: "pricing-table",       slots: pricingTableSlots,        render: pricingTable },
  { name: "process-timeline",    slots: processTimelineSlots,     render: processTimeline },
  { name: "prose",               slots: proseSlots,               render: prose },
  { name: "q-and-a",             slots: qAndASlots,               render: qAndA },
  { name: "quote",               slots: quoteSlots,               render: quote },
  { name: "quote-with-portrait", slots: quoteWithPortraitSlots,   render: quoteWithPortrait },
  { name: "section-divider",     slots: sectionDividerSlots,      render: sectionDivider },
  { name: "split-2",             slots: split2Slots,              render: split2 },
  { name: "split-3-horizontal",  slots: split3HorizontalSlots,    render: split3Horizontal },
  { name: "split-3-vertical",    slots: split3VerticalSlots,      render: split3Vertical },
  { name: "stat-grid-3",         slots: statGrid3Slots,           render: statGrid3 },
  { name: "team-grid",           slots: teamGridSlots,            render: teamGrid },
  { name: "timeline-text",       slots: timelineTextSlots,        render: timelineText },
  { name: "title-only",          slots: titleOnlySlots,           render: titleOnly },
  { name: "two-col-text-image",  slots: twoColTextImageSlots,     render: twoColTextImage },
  { name: "two-column-prose",    slots: twoColumnProseSlots,      render: twoColumnProse },
];

export const LAYOUT_REGISTRY: ReadonlyMap<string, RegisteredLayout> = new Map(
  ENTRIES.map((e) => [e.name, e]),
);

export function getLayout(name: string): RegisteredLayout | undefined {
  return LAYOUT_REGISTRY.get(name);
}

export function listLayoutNames(): string[] {
  return [...LAYOUT_REGISTRY.keys()];
}
