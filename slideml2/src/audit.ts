import { flatten } from "./inspect.js";
import type { AgentTask, AuditIssue, AuditReport, RenderedDeck } from "./types.js";

export function auditDeck(deck: RenderedDeck, task: AgentTask = {}): AuditReport {
  const issues: AuditIssue[] = [];
  for (const slide of deck.slides) {
    const nodes = flatten(slide.dom);
    if (task.requireBrandLogoBottomRight) {
      const logo = nodes.find((node) => node.id === `${slide.id}.brandLogo`);
      if (!logo) {
        issues.push({ code: "MISSING_BRAND_LOGO", slideId: slide.id, message: "Slide is missing brand logo node." });
      } else if (logo.anchor !== "bottom-right") {
        issues.push({ code: "BRAND_LOGO_POSITION", slideId: slide.id, nodeName: logo.id, message: "Brand logo must be anchored bottom-right." });
      }
    }
    if (task.requireCoverBrandBackground && slide.layout === "cover" && slide.dom.background !== "brand.primary") {
      issues.push({ code: "COVER_BACKGROUND", slideId: slide.id, nodeName: slide.dom.id, message: "Cover background must use brand.primary." });
    }
    if (task.requireBusinessBullets && slide.id === "business") {
      const hasBusinessBullets = nodes.some((node) => node.type === "bullets" && node.id === "business.businessLines");
      if (!hasBusinessBullets) {
        issues.push({ code: "MISSING_BUSINESS_BULLETS", slideId: slide.id, message: "Business slide needs a business-lines bullets node." });
      }
    }
    if (task.requireCompanyOverviewLayout?.slideId === slide.id) {
      const overview = nodes.find((node) => node.id === `${slide.id}.overviewLayout`);
      const metricGrid = nodes.find((node) => node.id === `${slide.id}.metricGrid`);
      const requiredIds = [`${slide.id}.company-summary`, `${slide.id}.business-lines`, `${slide.id}.hero-visual`, `${slide.id}.metric-revenue`, `${slide.id}.metric-profit`, `${slide.id}.metric-users`];
      const hasRequiredNodes = requiredIds.every((id) => nodes.some((node) => node.id === id));
      const hasThreeMetricCards = nodes.filter((node) => node.role === "metric-card").length === 3;
      if (!overview || overview.type !== "grid" || overview.columns !== 2 || metricGrid?.columns !== 3 || !hasRequiredNodes || !hasThreeMetricCards) {
        issues.push({
          code: "MISSING_COMPANY_OVERVIEW_LAYOUT",
          slideId: slide.id,
          message: "Slide needs a component-built company overview layout with narrative, visual, and metrics regions.",
        });
      }
    }
  }
  return { ok: issues.length === 0, issues };
}
