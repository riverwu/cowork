export { auditDeck } from "./audit.js";
export { designComparisonSlide, designComplexDeck, designDashboardSlide, designDeckFromBrief, designSlideFromBrief, designTimelineSlide } from "./agent/page-designer.js";
export { deckFromComponentPlan, generateWithComponentAgent, planWithComponentAgent } from "./agent/component-agent.js";
export { generateDeckWithBatchAgent, generateOneSlideWithLlm } from "./agent/batch-agent.js";
export { buildAgentPromptPack } from "./agent-disclosure.js";
export { listComponents, describeComponents } from "./component-registry.js";
export { describeDeck } from "./deck-disclosure.js";
export { listTextKinds, describeTextKind } from "./text-kinds.js";
export { listThemes } from "./theme.js";
export { createDeck, setDeckProps, appendSlide, insertSlide, replaceSlide, deleteSlide, validateDeckPath, renderDeck } from "./deck-ops.js";
export { createSourceDeck, normalizeSlide, sourceToRenderedDeck } from "./source-deck.js";
export { validateDeck, validateSlide } from "./validate.js";
export { bulletList, companyOverviewLayout, comparisonCard, imageBlock, imageWithCaptionPanel, insightCallout, metricCard, paragraphText, stepCard, titleText } from "./components.js";
export { applyEdits } from "./edit.js";
export {
  clearRenderDiagnostics,
  getDiagnosticsByCode,
  getDiagnosticsBySeverity,
  getRenderDiagnostics,
} from "./diagnostics.js";
export type { LayoutDiagnostic } from "./diagnostics.js";
export { findNode as findNodeForTest } from "./inspect.js";
export { inspectLayout } from "./layout-inspect.js";
export { buildDom } from "./layouts.js";
export { describeNodeType, listNodeTypes as listNodeTypesForTest } from "./node-types.js";
export { measureDeck, renderToAst, renderToPptx } from "./render.js";
export { runSimpleAgentLoop } from "./agent/loop.js";
export type { AgentTask, Slideml2Deck } from "./types.js";
