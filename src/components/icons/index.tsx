/**
 * Centralized SVG icon library for Cowork.
 *
 * Rules:
 * - All icons are SVG-based React components
 * - NO emoji allowed anywhere in the codebase
 * - Icons use currentColor to inherit parent text color
 * - Default size: 18x18, adjustable via size prop
 * - Stroke-based style, 1.5px weight
 */

interface IconProps {
  size?: number;
  className?: string;
}

interface FileTypeIconProps {
  filename?: string;
  path?: string;
  size?: number;
  className?: string;
}

const defaults = (props: IconProps) => ({
  width: props.size || 18,
  height: props.size || 18,
  viewBox: "0 0 18 18",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: props.className,
});

// ---- Navigation Icons ----

export function IconHome(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M3 7.5L9 2.5L15 7.5V14.5C15 15.05 14.55 15.5 14 15.5H4C3.45 15.5 3 15.05 3 14.5V7.5Z" />
      <path d="M7 15.5V10H11V15.5" />
    </svg>
  );
}

export function IconBook(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M2.5 13.5V4C2.5 3.17 3.17 2.5 4 2.5H7.5C8.33 2.5 9 3.17 9 4V15" />
      <path d="M15.5 13.5V4C15.5 3.17 14.83 2.5 14 2.5H10.5C9.67 2.5 9 3.17 9 4" />
      <path d="M2.5 13.5C2.5 14.33 3.17 15 4 15H14C14.83 15 15.5 14.33 15.5 13.5" />
    </svg>
  );
}

export function IconChannel(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M6.5 2.5V15.5" />
      <path d="M11.5 2.5V15.5" />
      <path d="M2.5 6.5H15.5" />
      <path d="M2.5 11.5H15.5" />
    </svg>
  );
}

export function IconActivity(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M15.5 9H12.5L10.5 15L7.5 3L5.5 9H2.5" />
    </svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M3 5H15" />
      <path d="M3 9H15" />
      <path d="M3 13H15" />
      <circle cx="6.2" cy="5" r="1.35" fill="var(--surface-lowest)" />
      <circle cx="11.8" cy="9" r="1.35" fill="var(--surface-lowest)" />
      <circle cx="8.1" cy="13" r="1.35" fill="var(--surface-lowest)" />
    </svg>
  );
}

// ---- Content Icons ----

export function IconDocument(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M10.5 2.5H5C4.17 2.5 3.5 3.17 3.5 4V14C3.5 14.83 4.17 15.5 5 15.5H13C13.83 15.5 14.5 14.83 14.5 14V6.5L10.5 2.5Z" />
      <path d="M10.5 2.5V6.5H14.5" />
    </svg>
  );
}

export function FileTypeIcon({ filename, path, size = 28, className }: FileTypeIconProps) {
  const name = filename || path?.split("/").pop() || "";
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const meta = fileTypeMeta(ext);
  const iconSize = Math.max(12, Math.round(size * 0.5));

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-lg ring-1 ring-black/[0.05] ${meta.bg} ${meta.fg} ${className || ""}`}
      style={{ width: size, height: size }}
      title={meta.label}
    >
      {meta.kind === "sheet" ? (
        <IconChart size={iconSize} />
      ) : meta.kind === "slides" ? (
        <IconReport size={iconSize} />
      ) : meta.kind === "folder" ? (
        <IconFolder size={iconSize} />
      ) : (
        <svg
          width={iconSize}
          height={iconSize}
          viewBox="0 0 18 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10.5 2.5H5C4.17 2.5 3.5 3.17 3.5 4V14C3.5 14.83 4.17 15.5 5 15.5H13C13.83 15.5 14.5 14.83 14.5 14V6.5L10.5 2.5Z" />
          <path d="M10.5 2.5V6.5H14.5" />
          {meta.kind === "pdf" ? <path d="M6 11.5H12" /> : null}
          {meta.kind === "text" ? <><path d="M6 8.5H12" /><path d="M6 11.5H10.5" /></> : null}
          {meta.kind === "code" ? <><path d="M7 8L5.5 9.5L7 11" /><path d="M11 8L12.5 9.5L11 11" /></> : null}
          {meta.kind === "image" ? <><path d="M6 12L8 9.8L9.4 11.2L10.5 10L12.5 12" /><circle cx="7" cy="7.8" r="0.6" fill="currentColor" stroke="none" /></> : null}
          {meta.kind === "archive" ? <><path d="M8 5.5H10" /><path d="M8 7.5H10" /><path d="M8 9.5H10" /></> : null}
        </svg>
      )}
    </span>
  );
}

function fileTypeMeta(ext: string): { kind: string; label: string; bg: string; fg: string } {
  if (ext === "pdf") return { kind: "pdf", label: "PDF", bg: "bg-red-50", fg: "text-red-600" };
  if (ext === "doc" || ext === "docx") return { kind: "text", label: "Word document", bg: "bg-blue-50", fg: "text-blue-700" };
  if (ext === "xls" || ext === "xlsx" || ext === "csv") return { kind: "sheet", label: "Spreadsheet", bg: "bg-emerald-50", fg: "text-emerald-700" };
  if (ext === "ppt" || ext === "pptx") return { kind: "slides", label: "Presentation", bg: "bg-orange-50", fg: "text-orange-700" };
  if (["png", "jpg", "jpeg", "gif", "svg"].includes(ext)) return { kind: "image", label: "Image", bg: "bg-fuchsia-50", fg: "text-fuchsia-700" };
  if (["js", "jsx", "ts", "tsx", "py", "rs", "go", "java", "html", "css", "sql", "sh"].includes(ext)) return { kind: "code", label: "Code file", bg: "bg-slate-100", fg: "text-slate-700" };
  if (["zip", "tar", "gz"].includes(ext)) return { kind: "archive", label: "Archive", bg: "bg-violet-50", fg: "text-violet-700" };
  if (["md", "txt", "json", "yaml", "yml", "toml", "xml"].includes(ext)) return { kind: "text", label: "Text file", bg: "bg-sky-50", fg: "text-sky-700" };
  return { kind: "text", label: "File", bg: "bg-gray-100", fg: "text-gray-700" };
}

export function IconReport(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M3 15V3H15V15H3Z" />
      <path d="M6 7H12" />
      <path d="M6 9.5H12" />
      <path d="M6 12H9.5" />
    </svg>
  );
}

export function IconFolder(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M2.5 5.5V13.5C2.5 14.33 3.17 15 4 15H14C14.83 15 15.5 14.33 15.5 13.5V7C15.5 6.17 14.83 5.5 14 5.5H9L7.5 3.5H4C3.17 3.5 2.5 4.17 2.5 5V5.5Z" />
    </svg>
  );
}

export function IconChart(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M3 15V6" />
      <path d="M7 15V3" />
      <path d="M11 15V8" />
      <path d="M15 15V5" />
    </svg>
  );
}

export function IconMail(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M3 4.5H15C15.55 4.5 16 4.95 16 5.5V13C16 13.55 15.55 14 15 14H3C2.45 14 2 13.55 2 13V5.5C2 4.95 2.45 4.5 3 4.5Z" />
      <path d="M16 5.5L9 10L2 5.5" />
    </svg>
  );
}

export function IconTrend(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M2.5 13L6.5 8.5L9.5 11L15.5 4" />
      <path d="M11 4H15.5V8.5" />
    </svg>
  );
}

export function IconTaskList(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M4 5L5.5 6.5L8 4" />
      <path d="M10 5.5H15" />
      <path d="M4 9.5L5.5 11L8 8.5" />
      <path d="M10 10H15" />
      <path d="M4 14H5.5" />
      <path d="M10 14H15" />
    </svg>
  );
}

// ---- Action Icons ----

export function IconPlus(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M9 4V14" />
      <path d="M4 9H14" />
    </svg>
  );
}

export function IconClock(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <circle cx="9" cy="9" r="6.5" />
      <path d="M9 5.5V9L11.5 10.5" />
    </svg>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M5 3.5L14.5 9L5 14.5V3.5Z" />
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M3.5 9.5L7 13L14.5 5.5" />
    </svg>
  );
}

export function IconWarning(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M9 2L16.5 15H1.5L9 2Z" />
      <path d="M9 7V10" />
      <circle cx="9" cy="12.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconArrowLeft(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M11 4L5 9L11 14" />
    </svg>
  );
}

export function IconUndo(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M7 5H3V1" />
      <path d="M3.5 5.5C4.8 3.9 6.8 3 9 3C12.3 3 15 5.7 15 9C15 12.3 12.3 15 9 15C6.8 15 4.9 13.9 3.8 12.2" />
    </svg>
  );
}

export function IconRedo(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M11 5H15V1" />
      <path d="M14.5 5.5C13.2 3.9 11.2 3 9 3C5.7 3 3 5.7 3 9C3 12.3 5.7 15 9 15C11.2 15 13.1 13.9 14.2 12.2" />
    </svg>
  );
}

export function IconSend(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M2 14L14 8L2 2V6.5L10 8L2 9.5V14Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <circle cx="7.5" cy="7.5" r="5" />
      <path d="M11.5 11.5L15.5 15.5" />
    </svg>
  );
}

export function IconPackage(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M2.5 5.5L9 2L15.5 5.5V12.5L9 16L2.5 12.5V5.5Z" />
      <path d="M9 9V16" />
      <path d="M2.5 5.5L9 9L15.5 5.5" />
    </svg>
  );
}

export function IconBolt(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M10 2L4 10H9L8 16L14 8H9L10 2Z" />
    </svg>
  );
}

export function IconPin(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M9 2V10" />
      <path d="M5 6L9 10L13 6" />
      <path d="M4 15H14" />
      <path d="M9 10V15" />
    </svg>
  );
}

export function IconExpand(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M3 7V3H7" />
      <path d="M11 3H15V7" />
      <path d="M15 11V15H11" />
      <path d="M7 15H3V11" />
    </svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M4 4L14 14" />
      <path d="M14 4L4 14" />
    </svg>
  );
}

export function IconWave(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M2 9C4 5 6 5 7 9C8 13 10 13 11 9C12 5 14 5 16 9" />
    </svg>
  );
}

export function IconServer(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <rect x="3" y="2" width="12" height="5" rx="1" />
      <rect x="3" y="11" width="12" height="5" rx="1" />
      <path d="M9 7V11" />
      <circle cx="6" cy="4.5" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="6" cy="13.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconPuzzle(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M7 3H4C3.45 3 3 3.45 3 4V7.5H4.5C5.05 3.5 6 4 6 5C6 6 5.05 6.5 4.5 6.5H3V10C3 10.55 3.45 11 4 11H7.5V9.5C7.5 8.95 8 8 9 8C10 8 10.5 8.95 10.5 9.5V11H14C14.55 11 15 10.55 15 10V7H13.5C12.95 7 12 6.5 12 5.5C12 4.5 12.95 4 13.5 4H15V4C15 3.45 14.55 3 14 3H10.5V4.5C10.5 5.05 10 6 9 6C8 6 7.5 5.05 7.5 4.5V3H7Z" />
    </svg>
  );
}

export function IconSpinner(props: IconProps) {
  return (
    <svg {...defaults(props)} className={`animate-spin ${props.className || ""}`}>
      <path d="M9 2.5A6.5 6.5 0 1 0 15.5 9" strokeLinecap="round" />
    </svg>
  );
}
