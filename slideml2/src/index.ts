export { auditDeck } from "./audit.js";
export {
  clearRenderDiagnostics,
  getDiagnosticsByCode,
  getDiagnosticsBySeverity,
  getRenderDiagnostics,
} from "./diagnostics.js";
export type { LayoutDiagnostic } from "./diagnostics.js";
export {
  BLOCKING_RENDER_DIAGNOSTIC_CODES,
  QUALITY_RENDER_DIAGNOSTIC_CODES,
  RENDER_DIAGNOSTIC_CODES,
  isBlockingRenderDiagnostic,
  isQualityRenderDiagnostic,
} from "./diagnostic-codes.js";
export type { RenderDiagnosticCode } from "./diagnostic-codes.js";
export { applyEdits } from "./edit.js";
export { inspectDeck } from "./inspect.js";
export { inspectLayout } from "./layout-inspect.js";
export type { InspectedLayoutNode, InspectedSlideLayout } from "./layout-inspect.js";
export { buildDom, getSlide } from "./layouts.js";
export { renderToAst, renderToPptx } from "./render.js";
export { buildTheme } from "./theme.js";
export type { ThemeOverride } from "./types.js";
export { runSimpleAgentLoop } from "./agent/loop.js";
export { deckFromComponentPlan, generateWithComponentAgent, planWithComponentAgent } from "./agent/component-agent.js";
export { generateDeckWithBatchAgent, generateOneSlideWithLlm } from "./agent/batch-agent.js";
export { buildAgentPromptPack, getAgentSystemPrompt } from "./agent-disclosure.js";
export { designComparisonSlide, designComplexDeck, designDashboardSlide, designDeckFromBrief, designSlideFromBrief, designTimelineSlide } from "./agent/page-designer.js";
export {
  badge, barList, bulletList, checklist, companyOverviewLayout, comparisonCard, ctaButton,
  featureCard, flowArrow, heroStat, iconText, imageBlock, imageWithCaptionPanel, insightCallout,
  keyTakeaway, kpiGrid, legend, logoStrip, metricCard, numberedGrid, numberedList, paragraphText,
  pricingCard, processFlow, profileCard, progressBar, prosCons, quoteBlock, sectionBreak,
  statComparison, statStrip, stepCard, swotMatrix, tagList, timelineBlock, titleText,
} from "./components.js";
export { listComponents, describeComponents } from "./component-registry.js";
export type { DescribeComponentsResult } from "./component-registry.js";
export { describeDeck } from "./deck-disclosure.js";
export type { DeckDescription, DeckFieldDescription } from "./deck-disclosure.js";
export { listTextKinds, describeTextKind } from "./text-kinds.js";
export { describeNodeType, listNodeTypes } from "./node-types.js";
export { DECK_SIZE_VALUES, VALIDATION_MODE_VALUES, DATA_SOURCE_TYPE_VALUES, DATA_AGGREGATE_OP_VALUES, DATA_COLUMN_TYPE_VALUES, DATA_COLUMN_ALIGN_VALUES, DATA_BIND_FIELDS, DATA_ENCODING_FIELDS } from "./schema.js";
export type { ValidationMode } from "./schema.js";
export { resolveDataBindings, resolveDataSourceRows, resolveDataSources } from "./data-binding.js";
export { listPaletteColors, listSizeNames, listThemes } from "./theme.js";
export type { PaletteColorName, SizeName } from "./theme.js";
export { createDeck, setDeckProps, appendSlide, insertSlide, replaceSlide, deleteSlide, validateDeckPath, renderDeck, readDeck, writeDeck } from "./deck-ops.js";
export { createSourceDeck, normalizeSlide, sourceToRenderedDeck } from "./source-deck.js";
export { validateDeck, validateSlide } from "./validate.js";
export { generateBriefLayoutDemo, generateComplexLayoutDemo, generateComponentLayoutDemo } from "./demo.js";
export type {
  AgentTask,
  AuditIssue,
  AuditReport,
  BrandSpec,
  DeckValidationSpec,
  DeckSpec,
  DataAggregateOp,
  DataAggregateSpec,
  DataBindSpec,
  DataColumnEncodingSpec,
  DataColumnType,
  DataEncodingSpec,
  DataSourceKind,
  DataSourceSpec,
  DomNode,
  EditOp,
  FootnoteSpec,
  InsertPosition,
  LayoutName,
  NodeType,
  ReferenceSpec,
  RenderedDeck,
  RenderedSlide,
  RichTextRun,
  SlideSize,
  SlideSpec,
  Slideml2Deck,
  SurfaceOverride,
  ThemeLayoutArea,
} from "./types.js";
export type { AgentComponentNode, AgentNode, AgentPrimitiveNode, ComponentAgentPlan, ComponentAgentResult, ComponentAgentSlidePlan } from "./agent/component-agent.js";
export type { BatchAgentResult } from "./agent/batch-agent.js";
export type { AgentPromptPackOptions } from "./agent-disclosure.js";
export type { ComponentDefinition, ComponentDescription, ComponentSummary } from "./component-registry.js";
export type { ValidationReport, ValidationIssue } from "./validate.js";
