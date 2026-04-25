import type { CSSProperties } from "react";
import type { ElementIR, ImageStyleIR, ShapeStyleIR, SlideDLIR, TableStyleIR } from "@/lib/document/presentation-dlir";
import type { LineStyle } from "@/lib/document/presentation-model";

interface PresentationSlideViewProps {
  slide: SlideDLIR;
  pageSize: { w: number; h: number };
  zoom: "fit" | number;
  selectedElementId?: string | null;
  onSelectElement?: (elementId: string) => void;
}

export function PresentationSlideView({ slide, pageSize, zoom, selectedElementId, onSelectElement }: PresentationSlideViewProps) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-low)] p-4 shadow-[var(--shadow-sm)] overflow-auto">
      <div
        className="relative bg-white shadow-[var(--shadow-md)] ring-1 ring-black/[0.05] overflow-hidden"
        style={{
          aspectRatio: `${pageSize.w} / ${pageSize.h}`,
          width: zoom === "fit" ? "min(100%, 900px)" : `${Math.round(pageSize.w * 96 * zoom)}px`,
          maxWidth: zoom === "fit" ? undefined : "none",
          backgroundColor: slide.background?.color || "#ffffff",
        }}
      >
        {slide.elements.map((element) => (
          <button
            key={element.id}
            type="button"
            onClick={() => onSelectElement?.(element.id)}
            className={`absolute overflow-hidden text-left transition border-0 p-0 bg-transparent ${element.role === "title" ? "font-semibold" : "font-normal"} ${selectedElementId === element.id ? "ring-2 ring-[var(--primary-accent)] ring-offset-1 ring-offset-white" : "hover:ring-1 hover:ring-[var(--primary-accent)]/40"}`}
            style={{
              left: `${(element.bbox.x / pageSize.w) * 100}%`,
              top: `${(element.bbox.y / pageSize.h) * 100}%`,
              width: `${(element.bbox.w / pageSize.w) * 100}%`,
              height: `${(element.bbox.h / pageSize.h) * 100}%`,
            }}
            title={`${element.id} · ${element.role}`}
          >
            {element.type === "text" ? (
              <div
                className="h-full w-full whitespace-pre-wrap flex"
                style={textStyle(element)}
              >
                <span className="block w-full">
                  {element.layout?.bullet ? bulletText(element.text || "") : element.text}
                </span>
              </div>
            ) : element.type === "image" ? (
              imageDataUri(element) ? (
                <img
                  src={imageDataUri(element) || ""}
                  alt={element.textSummary || element.id}
                  className="h-full w-full object-cover"
                  draggable={false}
                  style={imageStyle(element)}
                />
              ) : (
                <div className="h-full w-full rounded bg-sky-50 border border-sky-100 flex items-center justify-center text-[11px] text-sky-700">
                  image
                </div>
              )
            ) : element.type === "table" ? (
              <TableElementView element={element} />
            ) : (
              <div
                className="h-full w-full rounded"
                style={shapeStyle(element)}
              />
            )}
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[12px] font-semibold text-[var(--on-surface)]">Slide {slide.index}</span>
        <span className="text-[12px] text-[var(--on-surface-tertiary)] truncate">{slide.summary}</span>
      </div>
    </div>
  );
}

function TableElementView({ element }: { element: ElementIR }) {
  const style = element.style as TableStyleIR | undefined;
  const columns = style?.columns?.length ? style.columns : inferColumns(style);
  return (
    <div className="h-full w-full overflow-hidden rounded-[3px] border border-black/10 bg-white">
      <div
        className="grid h-full w-full"
        style={{
          gridTemplateColumns: columns.map((column) => `${Math.max(column, 0.1)}fr`).join(" "),
          gridAutoRows: style?.rows?.some((row) => row.height) ? undefined : "1fr",
        }}
      >
        {(style?.rows || []).flatMap((row, rowIndex) =>
          row.cells.map((cell, cellIndex) => (
            <div
              key={`${rowIndex}-${cellIndex}`}
              className="min-w-0 overflow-hidden px-1.5 py-1 text-[10px] leading-tight"
              style={{
                background: cell.fill?.type === "solid" ? cell.fill.color || undefined : undefined,
                color: cell.textStyle?.color || "#1d1d1f",
                fontFamily: cell.textStyle?.fontFace || undefined,
                fontWeight: cell.textStyle?.bold ? 650 : undefined,
                gridColumn: cell.colSpan ? `span ${cell.colSpan}` : undefined,
                gridRow: cell.rowSpan ? `span ${cell.rowSpan}` : undefined,
                textAlign: cell.layout?.horizontalAlign === "justify" ? "justify" : cell.layout?.horizontalAlign || "left",
                ...tableCellBorderStyle(cell.borders),
              }}
            >
              {cell.text}
            </div>
          )),
        )}
      </div>
    </div>
  );
}

function tableCellBorderStyle(borders: TableStyleIR["rows"][number]["cells"][number]["borders"]): CSSProperties {
  if (!borders) {
    return {
      borderRight: "1px solid rgba(0,0,0,.08)",
      borderBottom: "1px solid rgba(0,0,0,.08)",
    };
  }
  return {
    borderTop: borderCss(borders.top),
    borderRight: borderCss(borders.right) || "1px solid rgba(0,0,0,.08)",
    borderBottom: borderCss(borders.bottom) || "1px solid rgba(0,0,0,.08)",
    borderLeft: borderCss(borders.left),
  };
}

function borderCss(line: LineStyle | null | undefined): string | undefined {
  if (!line) return undefined;
  return `${Math.max(1, line.width || 1)}px ${line.dash && line.dash !== "solid" ? "dashed" : "solid"} ${line.color || "rgba(0,0,0,.12)"}`;
}

function inferColumns(style: TableStyleIR | undefined): number[] {
  const count = Math.max(...(style?.rows || []).map((row) => row.cells.length), 1);
  return Array.from({ length: count }, () => 1);
}

function textStyle(element: ElementIR): CSSProperties {
  const style = element.style && "fontSize" in element.style ? element.style : null;
  return {
    color: style?.color || "#1d1d1f",
    fontWeight: style?.bold || element.role === "title" ? 650 : 400,
    fontSize: style?.fontSize ? `${Math.max(8, style.fontSize * 1.2)}px` : element.role === "title" ? "clamp(18px, 2.4vw, 34px)" : "clamp(10px, 1.2vw, 16px)",
    fontFamily: style?.fontFace || undefined,
    textAlign: element.layout?.horizontalAlign === "justify" ? "justify" : element.layout?.horizontalAlign || "left",
    alignItems: element.layout?.verticalAlign === "middle" ? "center" : element.layout?.verticalAlign === "bottom" ? "flex-end" : "flex-start",
    lineHeight: element.layout?.lineSpacing || 1.1,
    paddingLeft: element.layout?.marginLeft ? `${element.layout.marginLeft * 96}px` : undefined,
    paddingRight: element.layout?.marginRight ? `${element.layout.marginRight * 96}px` : undefined,
    paddingTop: element.layout?.marginTop ? `${element.layout.marginTop * 96}px` : undefined,
    paddingBottom: element.layout?.marginBottom ? `${element.layout.marginBottom * 96}px` : undefined,
  };
}

function bulletText(text: string): string {
  return text.split("\n").map((line) => line.trim() ? `• ${line}` : line).join("\n");
}

function imageDataUri(element: ElementIR): string | null {
  const style = element.style as ImageStyleIR | undefined;
  return style?.dataUri || null;
}

function imageStyle(element: ElementIR): CSSProperties {
  const style = element.style as ImageStyleIR | undefined;
  const crop = style?.crop;
  return {
    opacity: style?.opacity ?? undefined,
    transform: transformCss(style?.transform),
    clipPath: crop ? `inset(${pct(crop.top)} ${pct(crop.right)} ${pct(crop.bottom)} ${pct(crop.left)})` : undefined,
  };
}

function pct(value: number | null | undefined): string {
  return `${Math.round((value || 0) * 100)}%`;
}

function shapeStyle(element: ElementIR): CSSProperties {
  const style = element.style as ShapeStyleIR | undefined;
  const fill = style?.fill;
  const line = style?.line;
  const shadow = style?.effects?.shadow;
  const transform = style?.transform;
  return {
    background: fill?.type === "gradient" ? gradientCss(fill.stops || [], fill.angle) : fill?.type === "none" ? "transparent" : fill?.color || "#f3f4f6",
    border: line ? `${Math.max(1, line.width || 1)}px ${line.dash && line.dash !== "solid" ? "dashed" : "solid"} ${line.color || "rgba(0,0,0,.14)"}` : fill?.type === "none" ? "1px solid rgba(0,0,0,.12)" : "none",
    boxShadow: shadow ? shadowCss(shadow) : undefined,
    transform: transformCss(transform),
  };
}

function gradientCss(stops: Array<{ position: number; color: string }>, angle?: number | null): string {
  if (stops.length === 0) return "#f3f4f6";
  const cssStops = stops.map((stop) => `${stop.color} ${Math.round(stop.position * 100)}%`).join(", ");
  return `linear-gradient(${angle ?? 90}deg, ${cssStops})`;
}

function shadowCss(shadow: NonNullable<ShapeStyleIR["effects"]>["shadow"]): string | undefined {
  if (!shadow) return undefined;
  const distance = shadow.distance || 2;
  const direction = ((shadow.direction || 45) * Math.PI) / 180;
  const x = Math.cos(direction) * distance;
  const y = Math.sin(direction) * distance;
  return `${x.toFixed(1)}px ${y.toFixed(1)}px ${shadow.blur || 4}px ${shadow.color || "rgba(0,0,0,.25)"}`;
}

function transformCss(transform: ShapeStyleIR["transform"]): string | undefined {
  if (!transform) return undefined;
  const parts = [];
  if (transform.rotation) parts.push(`rotate(${transform.rotation}deg)`);
  if (transform.flipH) parts.push("scaleX(-1)");
  if (transform.flipV) parts.push("scaleY(-1)");
  return parts.length ? parts.join(" ") : undefined;
}
