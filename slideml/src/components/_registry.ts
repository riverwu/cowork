/**
 * Component registry — single source of truth for theme-independent
 * components (kpi-tile, header, footer, takeaway-callout). Layouts
 * import these directly via name lookup.
 */

import type { LayoutContext } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";

import footer,           { slots as footerSlots }           from "./footer.js";
import header,           { slots as headerSlots }           from "./header.js";
import kpiTile,          { slots as kpiTileSlots }          from "./kpi-tile.js";
import takeawayCallout,  { slots as takeawayCalloutSlots }  from "./takeaway-callout.js";

export interface RegisteredComponent {
  name: string;
  slots: Record<string, SlotSchema>;
  render: (ctx: LayoutContext) => ShapeList;
}

const ENTRIES: RegisteredComponent[] = [
  { name: "footer",           slots: footerSlots,           render: footer           as RegisteredComponent["render"] },
  { name: "header",           slots: headerSlots,           render: header           as RegisteredComponent["render"] },
  { name: "kpi-tile",         slots: kpiTileSlots,          render: kpiTile          as RegisteredComponent["render"] },
  { name: "takeaway-callout", slots: takeawayCalloutSlots,  render: takeawayCallout  as RegisteredComponent["render"] },
];

export const COMPONENT_REGISTRY: ReadonlyMap<string, RegisteredComponent> = new Map(
  ENTRIES.map((e) => [e.name, e]),
);

export function getComponent(name: string): RegisteredComponent | undefined {
  return COMPONENT_REGISTRY.get(name);
}
