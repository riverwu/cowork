/**
 * Chrome registry — single source of truth for slide-decoration modules.
 * Themes opt in by listing names in `theme.json → chrome[]`; the loader
 * resolves names against this registry instead of importing from the
 * theme directory.
 */

import type { ChromeFn } from "../render/chrome.js";

import brandBar     from "./brand-bar.js";
import pageFooter   from "./page-footer.js";
import pageHeader   from "./page-header.js";
import pageNumber   from "./page-number.js";

export const CHROME_REGISTRY: ReadonlyMap<string, ChromeFn> = new Map<string, ChromeFn>([
  ["brand-bar",   brandBar     as ChromeFn],
  ["page-footer", pageFooter   as ChromeFn],
  ["page-header", pageHeader   as ChromeFn],
  ["page-number", pageNumber   as ChromeFn],
]);

export function getChrome(name: string): ChromeFn | undefined {
  return CHROME_REGISTRY.get(name);
}
