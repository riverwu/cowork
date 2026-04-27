/**
 * Chrome registry — single source of truth for slide-decoration modules.
 * Themes opt in by listing names in `theme.json → chrome[]`; the loader
 * resolves names against this registry instead of importing from the
 * theme directory.
 */

import type { ChromeFn } from "../render/chrome.js";

import brandBar      from "./brand-bar.js";
import hairline      from "./hairline.js";
import pageFooter    from "./page-footer.js";
import pageHeader    from "./page-header.js";
import pageNumber    from "./page-number.js";
import progressBar   from "./progress-bar.js";
import sectionMarker from "./section-marker.js";
import watermark     from "./watermark.js";

export const CHROME_REGISTRY: ReadonlyMap<string, ChromeFn> = new Map<string, ChromeFn>([
  ["brand-bar",      brandBar      as ChromeFn],
  ["hairline",       hairline      as ChromeFn],
  ["page-footer",    pageFooter    as ChromeFn],
  ["page-header",    pageHeader    as ChromeFn],
  ["page-number",    pageNumber    as ChromeFn],
  ["progress-bar",   progressBar   as ChromeFn],
  ["section-marker", sectionMarker as ChromeFn],
  ["watermark",      watermark     as ChromeFn],
]);

export function getChrome(name: string): ChromeFn | undefined {
  return CHROME_REGISTRY.get(name);
}
