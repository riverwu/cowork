import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { DataAggregateOp, DataColumnEncodingSpec, DataBindSpec, DataComputedExpressionSpec, DataEncodingSpec, DataSourceSpec, DataStatItemEncodingSpec, DataViewSpec, DomNode, Slideml2SourceDeck, SlideV2 } from "./types.js";

type DataRow = Record<string, unknown>;
type BoundTableCell = string | { text: string; align?: "left" | "center" | "right" };
type BoundTableColumn = DataColumnEncodingSpec & { label: string; inferred?: boolean };
type ChartSeriesOption = NonNullable<DataEncodingSpec["seriesOptions"]>[string];
type BoundChartSeries = { name: string; values: number[]; type?: "bar" | "line"; axis?: "primary" | "secondary"; trendLine?: ChartSeriesOption["trendLine"]; errorBars?: ChartSeriesOption["errorBars"] };
type BoundChartData = { labels: string[]; series: BoundChartSeries[]; orientation?: "vertical" | "horizontal" };

export interface DataColumnSchema {
  key: string;
  type: NonNullable<DataColumnEncodingSpec["type"]>;
  label?: string;
}

export interface DataBindingOptions {
  baseDir?: string;
}

export interface ResolvedDataSource {
  id: string;
  type: NonNullable<DataSourceSpec["type"]>;
  rows: DataRow[];
  path?: string;
  source?: string;
  sourceLabel?: string;
  citation?: string;
  accessedAt?: string;
  lineage?: Array<{ source: string; type: NonNullable<DataSourceSpec["type"]>; rowCount: number; path?: string }>;
}

export function resolveDataBindings(source: Slideml2SourceDeck, options: DataBindingOptions = {}): Slideml2SourceDeck {
  const sources = resolveDataSources(source.deck.dataSources, options);
  if (sources.size === 0) return source;
  return {
    ...source,
    slides: source.slides.map((slide) => resolveSlideBindings(slide, sources)),
  };
}

export function resolveDataSources(dataSources: unknown, options: DataBindingOptions = {}): Map<string, ResolvedDataSource> {
  const specs = dataSourceSpecMap(dataSources);
  const resolved = new Map<string, ResolvedDataSource>();
  if (!specs) return resolved;
  for (const id of Object.keys(specs)) {
    try {
      resolveDataSourceById(id, specs, resolved, new Set<string>(), options);
    } catch {
      // Validation reports malformed sources. Rendering keeps the authored node
      // unchanged rather than crashing.
    }
  }
  return resolved;
}

export function resolveDataSourceRows(spec: DataSourceSpec, options: DataBindingOptions = {}): DataRow[] {
  return resolveDataSource(spec, options).rows;
}

export function resolveDataSourceRowsById(dataSources: unknown, sourceId: string, options: DataBindingOptions = {}): DataRow[] {
  const specs = dataSourceSpecMap(dataSources);
  if (!specs) return [];
  return resolveDataSourceById(sourceId, specs, new Map<string, ResolvedDataSource>(), new Set<string>(), options).rows;
}

function dataSourceSpecMap(dataSources: unknown): Record<string, unknown> | null {
  if (!dataSources || typeof dataSources !== "object" || Array.isArray(dataSources)) return null;
  return dataSources as Record<string, unknown>;
}

function resolveDataSourceById(
  id: string,
  specs: Record<string, unknown>,
  cache: Map<string, ResolvedDataSource>,
  resolving: Set<string>,
  options: DataBindingOptions,
): ResolvedDataSource {
  const cached = cache.get(id);
  if (cached) return cached;
  if (!(id in specs)) throw new Error(`missing data source: ${id}`);
  if (resolving.has(id)) throw new Error(`cyclic computed data source: ${Array.from(resolving).concat(id).join(" -> ")}`);
  resolving.add(id);
  const raw = specs[id] as DataSourceSpec;
  const type = raw?.type || inferDataSourceType(raw);
  const resolved = type === "computed"
    ? resolveComputedDataSource(id, raw, specs, cache, resolving, options)
    : { id, ...resolveDataSource(raw, options) };
  cache.set(id, resolved);
  resolving.delete(id);
  return resolved;
}

function resolveDataSource(spec: DataSourceSpec, options: DataBindingOptions = {}): Omit<ResolvedDataSource, "id"> {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new Error("data source must be an object");
  }
  const type = spec.type || inferDataSourceType(spec);
  if (type === "inline-csv") {
    return withSourceMetadata(spec, { type, rows: parseCsvRows(String(spec.csv ?? spec.text ?? ""), spec.delimiter || ",") });
  }
  if (type === "file-csv") {
    const rawPath = firstString(spec.path, spec.file);
    if (!rawPath) throw new Error("file-csv data source requires path");
    if (/^[a-z]+:\/\//i.test(rawPath)) throw new Error("file-csv path must be a local filesystem path, not a URL");
    const filePath = isAbsolute(rawPath) ? rawPath : resolve(options.baseDir || process.cwd(), rawPath);
    const text = readFileSync(filePath, "utf8");
    return withSourceMetadata(spec, { type, path: filePath, rows: parseCsvRows(text, spec.delimiter || ",") });
  }
  if (type === "computed") {
    throw new Error("computed data source must be resolved by id so its source can be found");
  }
  if (type !== "inline-json") {
    throw new Error(`unsupported data source type: ${String(type)}`);
  }
  const raw = spec.rows ?? spec.data ?? spec.json;
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { rows?: unknown }).rows)
      ? (raw as { rows: unknown[] }).rows
      : [];
  return withSourceMetadata(spec, { type, rows: rows.map((row) => normalizeRow(row)).filter((row) => Object.keys(row).length > 0) });
}

function inferDataSourceType(spec: DataSourceSpec): DataSourceSpec["type"] {
  if (typeof spec?.source === "string" || spec?.computed || spec?.columns || spec?.postComputed || spec?.view) return "computed";
  if (typeof spec.csv === "string" || typeof spec.text === "string") return "inline-csv";
  if (typeof spec.path === "string" || typeof spec.file === "string") return "file-csv";
  return "inline-json";
}

function withSourceMetadata(spec: DataSourceSpec, resolved: Omit<ResolvedDataSource, "id">): Omit<ResolvedDataSource, "id"> {
  return {
    ...resolved,
    ...(typeof spec.sourceLabel === "string" && spec.sourceLabel.trim() ? { sourceLabel: spec.sourceLabel.trim() } : {}),
    ...(typeof spec.citation === "string" && spec.citation.trim() ? { citation: spec.citation.trim() } : {}),
    ...(typeof spec.accessedAt === "string" && spec.accessedAt.trim() ? { accessedAt: spec.accessedAt.trim() } : {}),
  };
}

function resolveComputedDataSource(
  id: string,
  spec: DataSourceSpec,
  specs: Record<string, unknown>,
  cache: Map<string, ResolvedDataSource>,
  resolving: Set<string>,
  options: DataBindingOptions,
): ResolvedDataSource {
  const sourceId = firstString(spec.source, (spec as Record<string, unknown>).from);
  if (!sourceId) throw new Error("computed data source requires source");
  const source = resolveDataSourceById(sourceId, specs, cache, resolving, options);
  let rows = source.rows.map((row) => ({ ...row }));
  rows = applyComputedColumns(rows, computedColumns(spec.computed ?? spec.columns));
  if (spec.view && typeof spec.view === "object" && !Array.isArray(spec.view)) {
    rows = applyDataView(rows, dataView(spec.view));
  }
  rows = applyComputedColumns(rows, computedColumns(spec.postComputed));
  const lineage = [
    ...(source.lineage || [{ source: source.id, type: source.type, rowCount: source.rows.length, ...(source.path ? { path: source.path } : {}) }]),
    { source: id, type: "computed" as const, rowCount: rows.length },
  ];
  return withSourceMetadata(spec, {
    type: "computed",
    source: sourceId,
    rows,
    sourceLabel: spec.sourceLabel || source.sourceLabel,
    citation: spec.citation || source.citation,
    accessedAt: spec.accessedAt || source.accessedAt,
    lineage,
  }) as ResolvedDataSource;
}

function resolveSlideBindings(slide: SlideV2, sources: Map<string, ResolvedDataSource>): SlideV2 {
  return {
    ...slide,
    children: slide.children.map((node) => resolveNodeBindings(node, sources)),
  };
}

function resolveNodeBindings(node: DomNode, sources: Map<string, ResolvedDataSource>): DomNode {
  const withSlots = resolveNodeBindingSlots(node, sources);
  const bind = dataBind(withSlots.bind);
  if (!bind) return withSlots;
  const source = sources.get(bind.source);
  if (!source) {
    return {
      ...withSlots,
      dataLineage: { source: bind.source, status: "missing-source" },
    };
  }
  const rows = applyDataView(source.rows, bind);
  return bindNodeData(withSlots, bind, dataEncoding(withSlots.encoding), rows, source);
}

const NODE_OBJECT_SLOT_KEYS = [
  "evidence",
  "rail",
  "left",
  "right",
  "hero",
  "insight",
] as const;

const NODE_ARRAY_SLOT_KEYS = [
  "children",
  "annotations",
  "supports",
] as const;

function resolveNodeBindingSlots(node: DomNode, sources: Map<string, ResolvedDataSource>): DomNode {
  let out: DomNode | undefined;
  const copy = () => out ??= { ...node };
  for (const key of NODE_OBJECT_SLOT_KEYS) {
    const value = node[key];
    if (isDomNodeLike(value)) copy()[key] = resolveNodeBindings(value, sources);
  }
  for (const key of NODE_ARRAY_SLOT_KEYS) {
    const value = node[key];
    if (!Array.isArray(value)) continue;
    const mapped = value.map((item) => isDomNodeLike(item) ? resolveNodeBindings(item, sources) : item);
    if (mapped.some((item, index) => item !== value[index])) copy()[key] = mapped;
  }
  return out || node;
}

function isDomNodeLike(value: unknown): value is DomNode {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof (value as { type?: unknown }).type === "string");
}

function bindNodeData(node: DomNode, bind: DataBindSpec, encoding: DataEncodingSpec, rows: DataRow[], source: ResolvedDataSource): DomNode {
  const kind = componentKind(node);
  const lineage = {
    source: bind.source,
    sourceType: source.type,
    ...(source.path ? { sourcePath: source.path } : {}),
    ...(source.source ? { computedFrom: source.source } : {}),
    ...(source.sourceLabel ? { sourceLabel: source.sourceLabel } : {}),
    ...(source.citation ? { citation: source.citation } : {}),
    ...(source.accessedAt ? { accessedAt: source.accessedAt } : {}),
    ...(source.lineage ? { lineage: source.lineage } : {}),
    baseRowCount: source.rows.length,
    rowCount: rows.length,
    fields: Object.keys(rows[0] || {}),
  };
  const resolvedData = { rows, schema: inferDataSchema(rows) };
  if (kind === "chart-card" || kind === "chart") {
    const chartData = chartDataFromRows(rows, encoding, node);
    return {
      ...node,
      data: chartData,
      labels: node.labels ?? chartData.labels,
      series: node.series ?? chartData.series,
      ...(node.orientation === undefined && chartData.orientation ? { orientation: chartData.orientation } : {}),
      dataLineage: lineage,
      resolvedData,
    };
  }
  if (kind === "table-card" || kind === "table") {
    const tableData = tableDataFromRows(rows, bind, encoding);
    return {
      ...node,
      data: tableData,
      headers: node.headers ?? tableData.headers,
      rows: node.rows ?? tableData.rows,
      columns: node.columns ?? tableData.columns,
      dataLineage: lineage,
      resolvedData,
    };
  }
  if (kind === "metric-card" || kind === "hero-stat") {
    const first = rows[0] || {};
    const valueKey = firstString(encoding.value, singleString(encoding.y), "value");
    const labelKey = firstString(encoding.label, encoding.x, "label");
    const deltaKey = firstString(encoding.delta, "delta");
    return {
      ...node,
      value: node.value ?? formatDataValue(first[valueKey]),
      label: node.label ?? formatDataValue(first[labelKey]),
      ...(node.delta === undefined && first[deltaKey] !== undefined ? { delta: formatDataValue(first[deltaKey]) } : {}),
      dataLineage: lineage,
      resolvedData,
    };
  }
  if (kind === "stat-strip") {
    return {
      ...node,
      items: node.items ?? statStripItemsFromRows(rows, encoding),
      dataLineage: lineage,
      resolvedData,
    };
  }
  return { ...node, dataLineage: lineage, resolvedData };
}

function dataBind(value: unknown): DataBindSpec | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.source !== "string" || !rec.source.trim()) return null;
  return {
    source: rec.source.trim(),
    select: Array.isArray(rec.select)
      ? rec.select.map(String).filter(Boolean)
      : rec.select && typeof rec.select === "object"
        ? Object.fromEntries(Object.entries(rec.select as Record<string, unknown>).map(([key, val]) => [key, String(val)]))
        : undefined,
    filter: rec.filter && typeof rec.filter === "object" && !Array.isArray(rec.filter) ? rec.filter as Record<string, unknown> : undefined,
    groupBy: Array.isArray(rec.groupBy)
      ? rec.groupBy.map(String).filter(Boolean)
      : typeof rec.groupBy === "string" && rec.groupBy.trim()
        ? rec.groupBy.trim()
        : undefined,
    aggregate: aggregateSpec(rec.aggregate),
    pivot: pivotSpec(rec.pivot),
    sort: typeof rec.sort === "string"
      ? rec.sort
      : rec.sort && typeof rec.sort === "object" && !Array.isArray(rec.sort)
        ? rec.sort as DataBindSpec["sort"]
        : undefined,
    limit: typeof rec.limit === "number" && Number.isFinite(rec.limit) && rec.limit > 0 ? Math.floor(rec.limit) : undefined,
  };
}

function dataView(value: unknown): DataViewSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const rec = value as Record<string, unknown>;
  return {
    select: Array.isArray(rec.select)
      ? rec.select.map(String).filter(Boolean)
      : rec.select && typeof rec.select === "object"
        ? Object.fromEntries(Object.entries(rec.select as Record<string, unknown>).map(([key, val]) => [key, String(val)]))
        : undefined,
    filter: rec.filter && typeof rec.filter === "object" && !Array.isArray(rec.filter) ? rec.filter as Record<string, unknown> : undefined,
    groupBy: Array.isArray(rec.groupBy)
      ? rec.groupBy.map(String).filter(Boolean)
      : typeof rec.groupBy === "string" && rec.groupBy.trim()
        ? rec.groupBy.trim()
        : undefined,
    aggregate: aggregateSpec(rec.aggregate),
    pivot: pivotSpec(rec.pivot),
    sort: typeof rec.sort === "string"
      ? rec.sort
      : rec.sort && typeof rec.sort === "object" && !Array.isArray(rec.sort)
        ? rec.sort as DataBindSpec["sort"]
        : undefined,
    limit: typeof rec.limit === "number" && Number.isFinite(rec.limit) && rec.limit > 0 ? Math.floor(rec.limit) : undefined,
  };
}

function dataEncoding(value: unknown): DataEncodingSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const rec = value as Record<string, unknown>;
  return {
    x: typeof rec.x === "string" ? rec.x : undefined,
    y: Array.isArray(rec.y) ? rec.y.map(String).filter(Boolean) : typeof rec.y === "string" ? rec.y : undefined,
    orientation: rec.orientation === "horizontal" || rec.orientation === "vertical" ? rec.orientation : undefined,
    series: typeof rec.series === "string" ? rec.series : undefined,
    label: typeof rec.label === "string" ? rec.label : undefined,
    value: typeof rec.value === "string" ? rec.value : undefined,
    delta: typeof rec.delta === "string" ? rec.delta : undefined,
    items: dataStatItemEncodingSpecs(rec.items),
    columns: Array.isArray(rec.columns)
      ? rec.columns.map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const column = item as Record<string, unknown>;
          const key = firstString(column.key, column.field, column.name, column.id, column.accessor, column.value);
          if (!key) return "";
          return {
            key,
            label: firstString(column.label, column.header, column.title, column.name) || undefined,
            type: isColumnType(column.type) ? column.type : undefined,
            format: typeof column.format === "string" ? column.format : undefined,
            align: isColumnAlign(column.align) ? column.align : undefined,
            width: typeof column.width === "number" && Number.isFinite(column.width) && column.width > 0 ? column.width : undefined,
          };
        }
        return "";
      }).filter((item) => typeof item === "string" ? item : item.key)
      : undefined,
    seriesName: typeof rec.seriesName === "string" ? rec.seriesName : undefined,
    seriesOptions: seriesOptionsSpec(rec.seriesOptions),
  };
}

function dataStatItemEncodingSpecs(value: unknown): DataEncodingSpec["items"] {
  if (!Array.isArray(value)) return undefined;
  const items: DataStatItemEncodingSpec[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const rec = raw as Record<string, unknown>;
    const valueKey = firstString(rec.value, rec.key, rec.field);
    if (!valueKey) continue;
    items.push({
      value: valueKey,
      ...(typeof rec.key === "string" && rec.key.trim() ? { key: rec.key.trim() } : {}),
      ...(typeof rec.field === "string" && rec.field.trim() ? { field: rec.field.trim() } : {}),
      ...(typeof rec.label === "string" ? { label: rec.label } : {}),
      ...(typeof rec.labelField === "string" && rec.labelField.trim() ? { labelField: rec.labelField.trim() } : {}),
      ...(typeof rec.valueLabel === "string" ? { valueLabel: rec.valueLabel } : {}),
      ...(typeof rec.tone === "string" && rec.tone.trim() ? { tone: rec.tone.trim() } : {}),
      ...(isColumnType(rec.type) ? { type: rec.type } : {}),
      ...(typeof rec.format === "string" && rec.format.trim() ? { format: rec.format.trim() } : {}),
    });
  }
  return items.length ? items : undefined;
}

function seriesOptionsSpec(value: unknown): DataEncodingSpec["seriesOptions"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: NonNullable<DataEncodingSpec["seriesOptions"]> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const rec = raw as Record<string, unknown>;
    out[key] = {
      ...(typeof rec.name === "string" && rec.name.trim() ? { name: rec.name.trim() } : {}),
      ...(rec.type === "bar" || rec.type === "line" ? { type: rec.type } : {}),
      ...(rec.axis === "primary" || rec.axis === "secondary" ? { axis: rec.axis } : {}),
      ...(rec.trendLine === true || rec.trendLine === false || isPlainObject(rec.trendLine) ? { trendLine: rec.trendLine as ChartSeriesOption["trendLine"] } : {}),
      ...(isPlainObject(rec.errorBars) ? { errorBars: errorBarsSpec(rec.errorBars) } : {}),
    };
  }
  return Object.keys(out).length ? out : undefined;
}

function errorBarsSpec(value: unknown): NonNullable<ChartSeriesOption["errorBars"]> {
  const rec = isPlainObject(value) ? value as Record<string, unknown> : {};
  return {
    ...(rec.type === "fixed" || rec.type === "percent" || rec.type === "stdDev" || rec.type === "stdErr" ? { type: rec.type } : {}),
    ...(typeof rec.value === "number" && Number.isFinite(rec.value) ? { value: rec.value } : {}),
    ...(rec.direction === "x" || rec.direction === "y" || rec.direction === "both" ? { direction: rec.direction } : {}),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function applyDataView(rows: DataRow[], bind: DataBindSpec | DataViewSpec): DataRow[] {
  let out = rows.slice();
  if (bind.filter) out = out.filter((row) => rowMatchesFilter(row, bind.filter!));
  if (bind.groupBy || bind.aggregate) out = aggregateRows(out, bind);
  if (bind.pivot) out = pivotRows(out, bind.pivot);
  if (bind.sort) out = sortRows(out, bind.sort);
  if (bind.limit !== undefined) out = out.slice(0, bind.limit);
  return out;
}

function pivotSpec(value: unknown): DataBindSpec["pivot"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const rec = value as Record<string, unknown>;
  const index = Array.isArray(rec.index)
    ? rec.index.map(String).filter(Boolean)
    : typeof rec.index === "string" && rec.index.trim()
      ? rec.index.trim()
      : undefined;
  const columns = typeof rec.columns === "string" && rec.columns.trim() ? rec.columns.trim() : "";
  const values = typeof rec.values === "string" && rec.values.trim() ? rec.values.trim() : "";
  if (!index || !columns || !values) return undefined;
  return {
    index,
    columns,
    values,
    aggregate: isAggregateOp(rec.aggregate) ? rec.aggregate : "sum",
    ...(rec.fill === undefined || typeof rec.fill === "string" || typeof rec.fill === "number" ? { fill: rec.fill as string | number | undefined } : {}),
  };
}

function aggregateSpec(value: unknown): DataBindSpec["aggregate"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: NonNullable<DataBindSpec["aggregate"]> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string" && isAggregateOp(raw)) {
      out[key] = raw;
      continue;
    }
    if (raw && typeof raw === "object" && !Array.isArray(raw) && isAggregateOp((raw as { op?: unknown }).op)) {
      const field = (raw as { field?: unknown }).field;
      out[key] = {
        op: (raw as { op: DataAggregateOp }).op,
        ...(typeof field === "string" && field.trim() ? { field: field.trim() } : {}),
      };
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function aggregateRows(rows: DataRow[], bind: DataBindSpec | DataViewSpec): DataRow[] {
  const groupKeys = groupByKeys(bind.groupBy);
  const aggregations = aggregateEntries(bind.aggregate);
  if (!groupKeys.length && !aggregations.length) return rows;
  const groups = new Map<string, DataRow[]>();
  for (const row of rows) {
    const key = groupKeys.length ? JSON.stringify(groupKeys.map((groupKey) => row[groupKey] ?? null)) : "__all__";
    const group = groups.get(key);
    if (group) {
      group.push(row);
    } else {
      groups.set(key, [row]);
    }
  }
  return Array.from(groups.values()).map((group) => {
    const first = group[0] || {};
    const out: DataRow = {};
    for (const key of groupKeys) out[key] = first[key];
    if (aggregations.length === 0) {
      return { ...first, ...out };
    }
    for (const aggregation of aggregations) {
      out[aggregation.output] = aggregateValue(group, aggregation.op, aggregation.field ?? (aggregation.op === "count" ? "" : aggregation.output));
    }
    return out;
  });
}

function groupByKeys(value: DataBindSpec["groupBy"]): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function aggregateEntries(value: DataBindSpec["aggregate"]): Array<{ output: string; op: DataAggregateOp; field?: string }> {
  if (!value) return [];
  const out: Array<{ output: string; op: DataAggregateOp; field?: string }> = [];
  for (const [output, raw] of Object.entries(value)) {
    if (!output.trim()) continue;
    if (typeof raw === "string" && isAggregateOp(raw)) {
      out.push({ output, op: raw });
      continue;
    }
    if (raw && typeof raw === "object" && isAggregateOp(raw.op)) {
      out.push({ output, op: raw.op, field: raw.field });
    }
  }
  return out;
}

function aggregateValue(rows: DataRow[], op: DataAggregateOp, field: string): unknown {
  if (op === "count") {
    if (!field) return rows.length;
    return rows.filter((row) => row[field] !== undefined && row[field] !== null && String(row[field]).trim() !== "").length;
  }
  if (op === "first") return rows[0]?.[field] ?? "";
  if (op === "last") return rows[rows.length - 1]?.[field] ?? "";
  const values = rows.map((row) => row[field]);
  if (op === "min") return minMaxValue(values, "min");
  if (op === "max") return minMaxValue(values, "max");
  const numbers = values.map((value) => numericValue(value)).filter((value): value is number => value !== null);
  if (op === "sum") return numbers.reduce((sum, value) => sum + value, 0);
  if (op === "avg") return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : "";
  return "";
}

function computedColumns(value: unknown): Record<string, DataComputedExpressionSpec> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, DataComputedExpressionSpec> = {};
  for (const [key, expr] of Object.entries(value as Record<string, unknown>)) {
    if (!key.trim()) continue;
    out[key] = expr as DataComputedExpressionSpec;
  }
  return Object.keys(out).length ? out : undefined;
}

function applyComputedColumns(rows: DataRow[], columns: Record<string, DataComputedExpressionSpec> | undefined): DataRow[] {
  if (!columns) return rows;
  return rows.map((row) => {
    const out: DataRow = { ...row };
    for (const [key, expr] of Object.entries(columns)) {
      out[key] = computeExpression(expr, out);
    }
    return out;
  });
}

function computeExpression(expr: DataComputedExpressionSpec, row: DataRow): unknown {
  if (!expr || typeof expr !== "object" || Array.isArray(expr)) return operandValue(expr, row);
  const rec = expr as Record<string, unknown>;
  const op = typeof rec.op === "string" ? rec.op : "field";
  if (op === "literal") return rec.value;
  if (op === "field") return typeof rec.field === "string" ? row[rec.field] : operandValue(rec.value, row);
  if (op === "concat") {
    const values = Array.isArray(rec.values) ? rec.values : [];
    const separator = typeof rec.separator === "string" ? rec.separator : "";
    return values.map((item) => formatDataValue(operandValue(item, row))).join(separator);
  }
  if (op === "coalesce") {
    const values = Array.isArray(rec.values) ? rec.values : [];
    for (const item of values) {
      const value = operandValue(item, row);
      if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
    return rec.empty ?? "";
  }
  if (op === "negate" || op === "abs" || op === "round") {
    const numeric = numericValue(operandValue(rec.value ?? rec.left, row));
    if (numeric === null) return rec.empty ?? "";
    if (op === "negate") return -numeric;
    if (op === "abs") return Math.abs(numeric);
    const digits = typeof rec.digits === "number" && Number.isFinite(rec.digits) ? Math.max(0, Math.min(8, Math.floor(rec.digits))) : 0;
    const scale = 10 ** digits;
    return Math.round(numeric * scale) / scale;
  }
  const values = Array.isArray(rec.values) ? rec.values.map((item) => numericValue(operandValue(item, row))).filter((value): value is number => value !== null) : [];
  if (op === "sum" || op === "add") {
    if (values.length) return values.reduce((sum, value) => sum + value, 0);
    return binaryNumeric(rec.left, rec.right, row, (left, right) => left + right, rec.empty);
  }
  if (op === "subtract" || op === "sub") return binaryNumeric(rec.left, rec.right, row, (left, right) => left - right, rec.empty);
  if (op === "multiply" || op === "mul") {
    if (values.length) return values.reduce((product, value) => product * value, 1);
    return binaryNumeric(rec.left, rec.right, row, (left, right) => left * right, rec.empty);
  }
  if (op === "divide" || op === "div" || op === "ratio") return binaryNumeric(rec.left, rec.right, row, (left, right) => right === 0 ? null : left / right, rec.empty);
  if (op === "percent-change" || op === "percentChange") {
    const current = rec.current ?? rec.left;
    const previous = rec.previous ?? rec.right;
    return binaryNumeric(current, previous, row, (left, right) => right === 0 ? null : (left - right) / Math.abs(right), rec.empty);
  }
  return rec.empty ?? "";
}

function binaryNumeric(leftRaw: unknown, rightRaw: unknown, row: DataRow, fn: (left: number, right: number) => number | null, empty: unknown): unknown {
  const left = numericValue(operandValue(leftRaw, row));
  const right = numericValue(operandValue(rightRaw, row));
  if (left === null || right === null) return empty ?? "";
  const value = fn(left, right);
  return value === null || !Number.isFinite(value) ? empty ?? "" : value;
}

function operandValue(value: unknown, row: DataRow): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    if (typeof rec.field === "string") return row[rec.field];
    if ("value" in rec) return rec.value;
  }
  if (typeof value === "string" && Object.prototype.hasOwnProperty.call(row, value)) return row[value];
  return value;
}

function pivotRows(rows: DataRow[], pivot: NonNullable<DataBindSpec["pivot"]>): DataRow[] {
  const indexKeys = groupByKeys(pivot.index);
  if (!indexKeys.length || !pivot.columns || !pivot.values) return rows;
  const columnLabels = uniqueOrdered(rows.map((row) => formatDataValue(row[pivot.columns])).filter((label) => label.trim() !== ""));
  const groups = new Map<string, DataRow[]>();
  for (const row of rows) {
    const key = JSON.stringify(indexKeys.map((indexKey) => row[indexKey] ?? null));
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return Array.from(groups.values()).map((group) => {
    const first = group[0] || {};
    const out: DataRow = {};
    for (const indexKey of indexKeys) out[indexKey] = first[indexKey];
    for (const label of columnLabels) {
      const matching = group.filter((row) => formatDataValue(row[pivot.columns]) === label);
      out[label] = matching.length > 0
        ? aggregateValue(matching, pivot.aggregate || "sum", pivot.values)
        : pivot.fill ?? 0;
    }
    return out;
  });
}

function minMaxValue(values: unknown[], op: "min" | "max"): unknown {
  const present = values.filter((value) => value !== undefined && value !== null && String(value).trim() !== "");
  if (!present.length) return "";
  return present.reduce((selected, value) => compareValues(value, selected) * (op === "min" ? 1 : -1) < 0 ? value : selected);
}

function isAggregateOp(value: unknown): value is DataAggregateOp {
  return value === "sum" || value === "avg" || value === "min" || value === "max" || value === "count" || value === "first" || value === "last";
}

function rowMatchesFilter(row: DataRow, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = row[key];
    if (Array.isArray(expected)) return expected.map((item) => String(item)).includes(String(actual ?? ""));
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      return Object.entries(expected as Record<string, unknown>).every(([op, value]) => compareFilter(actual, op, value));
    }
    return String(actual ?? "") === String(expected ?? "");
  });
}

function compareFilter(actual: unknown, op: string, expected: unknown): boolean {
  if (op === "eq") return String(actual ?? "") === String(expected ?? "");
  if (op === "ne") return String(actual ?? "") !== String(expected ?? "");
  if (op === "contains") return String(actual ?? "").includes(String(expected ?? ""));
  if (op === "in" && Array.isArray(expected)) return expected.map((item) => String(item)).includes(String(actual ?? ""));
  const a = numericValue(actual);
  const b = numericValue(expected);
  if (a === null || b === null) return false;
  if (op === "gt") return a > b;
  if (op === "gte") return a >= b;
  if (op === "lt") return a < b;
  if (op === "lte") return a <= b;
  return true;
}

function sortRows(rows: DataRow[], sort: NonNullable<DataBindSpec["sort"]>): DataRow[] {
  const by = typeof sort === "string" ? sort.replace(/^-/, "") : sort.by;
  const direction = typeof sort === "string"
    ? sort.startsWith("-") ? "desc" : "asc"
    : sort.direction === "desc" ? "desc" : "asc";
  if (!by) return rows;
  return rows.slice().sort((a, b) => compareValues(a[by], b[by]) * (direction === "desc" ? -1 : 1));
}

function compareValues(a: unknown, b: unknown): number {
  const an = numericValue(a);
  const bn = numericValue(b);
  if (an !== null && bn !== null) return an - bn;
  const am = monthValue(a);
  const bm = monthValue(b);
  if (am !== null && bm !== null) return am - bm;
  const ad = dateValue(a);
  const bd = dateValue(b);
  if (ad !== null && bd !== null) return ad - bd;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function chartDataFromRows(rows: DataRow[], encoding: DataEncodingSpec, node: DomNode): BoundChartData {
  const xKey = firstString(encoding.x, "label");
  const yKeys = Array.isArray(encoding.y) ? encoding.y : [firstString(encoding.y, "value")];
  const seriesKey = encoding.series;
  const chartKind = firstString(node.chartType, node.chart, "bar");
  const orientation = encoding.orientation || (node.orientation === "horizontal" || node.orientation === "vertical" ? node.orientation : undefined);
  if (!orientation && isBarLikeChart(chartKind) && yKeys.length === 1 && xKey && yKeys[0] && rows.length > 0) {
    const xSchema = inferColumnSchema(rows, xKey);
    const ySchema = inferColumnSchema(rows, yKeys[0]!);
    const xIsMeasure = xSchema.type === "number" || xSchema.type === "percent" || xSchema.type === "currency";
    if (xIsMeasure && ySchema.type === "text" && !seriesKey) {
      return {
        labels: rows.map((row) => formatDataValue(row[yKeys[0]!])),
        series: [{
          name: seriesOption(encoding, xKey)?.name || encoding.seriesName || humanizeFieldName(xKey),
          values: rows.map((row) => numericValue(row[xKey]) ?? 0),
          ...chartSeriesDecorations(seriesOption(encoding, xKey)),
        }],
        orientation: "horizontal",
      };
    }
  }
  const labels = uniqueOrdered(rows.map((row) => formatDataValue(row[xKey])));
  if (seriesKey && yKeys.length === 1) {
    const yKey = yKeys[0]!;
    const groups = uniqueOrdered(rows.map((row) => formatDataValue(row[seriesKey])));
    return {
      labels,
      series: groups.map((group) => ({
        name: seriesOption(encoding, group)?.name || group,
        values: labels.map((label) => {
          const row = rows.find((candidate) => formatDataValue(candidate[xKey]) === label && formatDataValue(candidate[seriesKey]) === group);
          return row ? numericValue(row[yKey]) ?? 0 : 0;
        }),
        ...chartSeriesDecorations(seriesOption(encoding, group)),
      })),
      ...(orientation ? { orientation } : {}),
    };
  }
  return {
    labels,
    series: yKeys.map((key) => ({
      name: seriesOption(encoding, key)?.name || (yKeys.length === 1 ? encoding.seriesName : undefined) || key,
      values: rows.map((row) => numericValue(row[key]) ?? 0),
      ...chartSeriesDecorations(seriesOption(encoding, key)),
    })),
    ...(orientation ? { orientation } : {}),
  };
}

function isBarLikeChart(chartKind: string): boolean {
  return chartKind === "bar" || chartKind === "stacked-bar";
}

function seriesOption(encoding: DataEncodingSpec, key: string): ChartSeriesOption | undefined {
  return encoding.seriesOptions?.[key];
}

function chartSeriesDecorations(option: ChartSeriesOption | undefined): Partial<BoundChartSeries> {
  return {
    ...(option?.type ? { type: option.type } : {}),
    ...(option?.axis ? { axis: option.axis } : {}),
    ...(option?.trendLine ? { trendLine: option.trendLine } : {}),
    ...(option?.errorBars ? { errorBars: option.errorBars } : {}),
  };
}

function tableDataFromRows(rows: DataRow[], bind: DataBindSpec, encoding: DataEncodingSpec): { headers: string[]; rows: BoundTableCell[][]; columns?: Array<{ header: string; width?: number }> } {
  const columns = tableColumns(rows, bind, encoding);
  return {
    headers: columns.map((column) => column.label),
    rows: rows.map((row) => columns.map((column) => formatTableCell(row[column.key], column))),
    ...(columns.some((column) => column.width !== undefined) ? { columns: columns.map((column) => ({
      header: column.label,
      ...(column.width !== undefined ? { width: column.width } : {}),
    })) } : {}),
  };
}

function tableColumns(rows: DataRow[], bind: DataBindSpec, encoding: DataEncodingSpec): BoundTableColumn[] {
  if (encoding.columns?.length) {
    return encoding.columns.map((column) => typeof column === "string"
      ? inferTableColumn(rows, { key: column, label: column })
      : inferTableColumn(rows, { ...column, label: column.label || humanizeFieldName(column.key) }));
  }
  if (Array.isArray(bind.select) && bind.select.length) return bind.select.map((key) => inferTableColumn(rows, { key, label: key }));
  if (bind.select && !Array.isArray(bind.select)) return Object.entries(bind.select).map(([label, key]) => inferTableColumn(rows, { key, label }));
  return Object.keys(rows[0] || {}).map((key) => inferTableColumn(rows, { key, label: key }));
}

function statStripItemsFromRows(rows: DataRow[], encoding: DataEncodingSpec): Array<{ value: string; label: string; tone?: string }> {
  if (encoding.items?.length) {
    const row = rows[0] || {};
    return encoding.items.map((item) => {
      const valueKey = firstString(item.value, item.key, item.field);
      const label = statItemLabel(row, item, valueKey);
      const column = inferTableColumn(rows, {
        key: valueKey,
        label,
        ...(item.type ? { type: item.type } : {}),
        ...(item.format ? { format: item.format } : {}),
      });
      return {
        value: typeof item.valueLabel === "string" ? item.valueLabel : formatColumnValue(row[valueKey], column),
        label,
        ...(item.tone ? { tone: item.tone } : {}),
      };
    });
  }
  const valueKey = firstString(encoding.value, singleString(encoding.y), "value");
  const labelKey = firstString(encoding.label, encoding.x, "label");
  return rows.map((row) => ({
    value: formatDataValue(row[valueKey]),
    label: formatDataValue(row[labelKey]),
  }));
}

function statItemLabel(row: DataRow, item: DataStatItemEncodingSpec, valueKey: string): string {
  if (item.labelField) return formatDataValue(row[item.labelField]);
  if (typeof item.label === "string" && item.label.trim()) return item.label.trim();
  return humanizeFieldName(valueKey);
}

function humanizeFieldName(field: string): string {
  const spaced = field.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
  return spaced ? spaced.replace(/\b\w/g, (char) => char.toUpperCase()) : "Value";
}

function inferTableColumn(rows: DataRow[], column: BoundTableColumn): BoundTableColumn {
  if (column.type) return column;
  const inferred = inferColumnSchema(rows, column.key);
  return {
    ...column,
    type: inferred.type,
    inferred: true,
    ...(column.align ? {} : { align: defaultAlignForType(inferred.type) }),
  };
}

function formatTableCell(value: unknown, column: BoundTableColumn): BoundTableCell {
  const text = formatColumnValue(value, column);
  const align = column.align || defaultColumnAlign(column);
  if (!align && (!column.type || column.type === "text") && !column.format) return text;
  return align ? { text, align } : { text };
}

function defaultColumnAlign(column: BoundTableColumn): "left" | "center" | "right" | undefined {
  if (column.type === "number" || column.type === "percent" || column.type === "currency") return "right";
  if (column.type === "date") return "center";
  return undefined;
}

function defaultAlignForType(type: NonNullable<DataColumnEncodingSpec["type"]>): "left" | "center" | "right" | undefined {
  if (type === "number" || type === "percent" || type === "currency") return "right";
  if (type === "date") return "center";
  return undefined;
}

function formatColumnValue(value: unknown, column: BoundTableColumn): string {
  if (column.type === "date") return formatDataValue(value);
  const numeric = numericValue(value);
  if (numeric === null) return formatDataValue(value);
  const format = column.format || column.type;
  if (format === "compact") return formatNumber(numeric, { compact: true });
  if (format === "currency" || column.type === "currency") return `$${formatNumber(numeric, { maxFractionDigits: format === "int" ? 0 : 2 })}`;
  if (format === "percent" || column.type === "percent") {
    const pct = Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
    return `${formatNumber(pct, { maxFractionDigits: format === "int" ? 0 : 1 })}%`;
  }
  if (format === "int") return formatNumber(numeric, { maxFractionDigits: 0 });
  if (format === "decimal") return formatNumber(numeric, { minFractionDigits: 1, maxFractionDigits: 2 });
  return formatDataValue(numeric);
}

function inferDataSchema(rows: DataRow[]): DataColumnSchema[] {
  const fields = dataFields(rows);
  return fields.map((key) => inferColumnSchema(rows, key));
}

function dataFields(rows: DataRow[]): string[] {
  const fields: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      fields.push(key);
    }
  }
  return fields;
}

function inferColumnSchema(rows: DataRow[], key: string): DataColumnSchema {
  const values = rows.map((row) => row[key]).filter((value) => value !== undefined && value !== null && String(value).trim() !== "");
  const label = humanizeFieldLabel(key);
  if (!values.length) return { key, label, type: "text" };
  if (values.every((value) => dateValue(value) !== null || monthValue(value) !== null)) return { key, label, type: "date" };
  const numericValues = values.map((value) => numericValue(value));
  const numericCount = numericValues.filter((value): value is number => value !== null).length;
  if (numericCount >= Math.max(1, values.length * 0.8)) {
    const nums = numericValues.filter((value): value is number => value !== null);
    if (isPercentField(key, nums, values)) return { key, label, type: "percent" };
    if (isCurrencyField(key)) return { key, label, type: "currency" };
    return { key, label, type: "number" };
  }
  return { key, label, type: "text" };
}

function isPercentField(key: string, nums: number[], values: unknown[]): boolean {
  const normalized = key.toLowerCase();
  if (/(pct|percent|percentage|rate|ratio|margin|share|conversion|retention|churn)/.test(normalized)) return true;
  if (values.some((value) => typeof value === "string" && value.trim().endsWith("%"))) return true;
  return nums.length > 0 && nums.every((value) => Math.abs(value) <= 1) && /(growth|delta|change|uplift)/.test(normalized);
}

function isCurrencyField(key: string): boolean {
  return /(revenue|sales|cost|profit|arr|mrr|acv|booking|bookings|pipeline|amount|price|budget|spend|cash|ebitda|opex|capex)/i.test(key);
}

function humanizeFieldLabel(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function parseCsvRows(text: string, delimiter: string): DataRow[] {
  const records = parseCsvRecords(text, delimiter);
  if (records.length === 0) return [];
  const headers = records[0]!.map((header, index) => header.trim() || `field_${index + 1}`);
  return records.slice(1).map((record) => {
    const row: DataRow = {};
    headers.forEach((header, index) => {
      row[header] = parseScalar(record[index] ?? "");
    });
    return row;
  }).filter((row) => Object.values(row).some((value) => String(value ?? "").trim() !== ""));
}

function parseCsvRecords(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

function normalizeRow(row: unknown): DataRow {
  if (!row || typeof row !== "object" || Array.isArray(row)) return {};
  return Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, parseScalar(value)]));
}

function parseScalar(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return "";
  const numeric = numericValue(trimmed);
  return numeric === null ? trimmed : numeric;
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/,/g, "").replace(/%$/, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number, options: { minFractionDigits?: number; maxFractionDigits?: number; compact?: boolean } = {}): string {
  return new Intl.NumberFormat("en-US", {
    notation: options.compact ? "compact" : "standard",
    minimumFractionDigits: options.minFractionDigits,
    maximumFractionDigits: options.maxFractionDigits,
  }).format(value);
}

function isColumnType(value: unknown): value is NonNullable<DataColumnEncodingSpec["type"]> {
  return value === "text" || value === "number" || value === "percent" || value === "currency" || value === "date";
}

function isColumnAlign(value: unknown): value is NonNullable<DataColumnEncodingSpec["align"]> {
  return value === "left" || value === "center" || value === "right";
}

const MONTH_ORDER: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function monthValue(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/\.$/, "");
  return MONTH_ORDER[normalized] ?? null;
}

function dateValue(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(trimmed);
  if (!iso) return null;
  const year = Number(iso[1]);
  const month = Number(iso[2]);
  const day = iso[3] === undefined ? 1 : Number(iso[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return Date.UTC(year, month - 1, day);
}

function formatDataValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
  return String(value);
}

function componentKind(node: DomNode): string {
  return node.type === "component" && typeof node.component === "string" ? node.component : String(node.type || "");
}

function firstString(...values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function singleString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function uniqueOrdered(values: string[]): string[] {
  return Array.from(new Set(values));
}
