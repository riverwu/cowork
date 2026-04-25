export const EMU_PER_INCH = 914400;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PresentationModel {
  id: string;
  title: string;
  size: { width: number; height: number; unit: "in" };
  slides: SlideModel[];
  media: MediaAsset[];
}

export interface SlideModel {
  id: string;
  index: number;
  title: string | null;
  background?: SlideBackground;
  elements: SlideElement[];
  sourceRef: SourceRef;
}

export type SlideElement = TextElement | ShapeElement | ImageElement | TableElement;

export interface BaseElement {
  id: string;
  name: string;
  bbox: Box;
  sourceRef: SourceRef;
  inherited?: boolean;
}

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  placeholder?: string | null;
  placeholderIndex?: string | null;
  style: TextStyle;
  layout?: TextLayout;
}

export interface ShapeElement extends BaseElement {
  type: "shape";
  shapeType: string;
  placeholder?: string | null;
  placeholderIndex?: string | null;
  fill?: FillStyle | null;
  line?: LineStyle | null;
  effects?: ShapeEffects | null;
  transform?: ShapeTransform | null;
}

export interface ImageElement extends BaseElement {
  type: "image";
  relationshipId: string | null;
  mediaPath: string | null;
  dataUri?: string | null;
  crop?: ImageCrop | null;
  opacity?: number | null;
  transform?: ShapeTransform | null;
}

export interface TableElement extends BaseElement {
  type: "table";
  columns: number[];
  rows: TableRow[];
  style?: TableStyle | null;
}

export interface TextStyle {
  fontSize?: number | null;
  color?: string | null;
  bold?: boolean;
  fontFace?: string | null;
}

export interface TextLayout {
  horizontalAlign?: "left" | "center" | "right" | "justify" | null;
  verticalAlign?: "top" | "middle" | "bottom" | null;
  marginLeft?: number | null;
  marginRight?: number | null;
  marginTop?: number | null;
  marginBottom?: number | null;
  lineSpacing?: number | null;
  bullet?: boolean;
  autoFit?: "none" | "shrink" | "resize_shape" | null;
}

export interface SlideBackground {
  color?: string | null;
}

export interface FillStyle {
  type: "solid" | "gradient" | "none";
  color?: string | null;
  stops?: Array<{ position: number; color: string }>;
  angle?: number | null;
}

export interface LineStyle {
  color?: string | null;
  width?: number | null;
  dash?: string | null;
}

export interface ShapeEffects {
  shadow?: {
    color?: string | null;
    blur?: number | null;
    distance?: number | null;
    direction?: number | null;
  } | null;
}

export interface ShapeTransform {
  rotation?: number | null;
  flipH?: boolean;
  flipV?: boolean;
}

export interface ImageCrop {
  left?: number | null;
  right?: number | null;
  top?: number | null;
  bottom?: number | null;
}

export interface TableRow {
  height?: number | null;
  cells: TableCell[];
}

export interface TableCell {
  text: string;
  fill?: FillStyle | null;
  borders?: TableCellBorders | null;
  textStyle?: TextStyle | null;
  layout?: TextLayout | null;
  rowSpan?: number | null;
  colSpan?: number | null;
}

export interface TableCellBorders {
  top?: LineStyle | null;
  right?: LineStyle | null;
  bottom?: LineStyle | null;
  left?: LineStyle | null;
}

export interface TableStyle {
  firstRow?: boolean;
  bandRow?: boolean;
  borderColor?: string | null;
}

export interface MediaAsset {
  id: string;
  path: string;
  contentType?: string | null;
  dataUri?: string | null;
}

export interface SourceRef {
  packagePath: string;
  xmlPath?: string;
}

export function emuToInches(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value || 0);
  return Number((parsed / EMU_PER_INCH).toFixed(4));
}
