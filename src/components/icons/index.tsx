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
      <circle cx="9" cy="9" r="2.5" />
      <path d="M14.7 11.1C14.6 11.35 14.65 11.65 14.85 11.85L14.9 11.9C15.06 12.06 15.15 12.28 15.15 12.5C15.15 12.72 15.06 12.94 14.9 13.1C14.74 13.26 14.52 13.35 14.3 13.35C14.08 13.35 13.86 13.26 13.7 13.1L13.65 13.05C13.45 12.85 13.15 12.8 12.9 12.9C12.66 13 12.5 13.23 12.5 13.5V13.65C12.5 14.1 12.15 14.45 11.7 14.45H11.3C10.85 14.45 10.5 14.1 10.5 13.65V13.5C10.5 13.23 10.34 13 10.1 12.9C9.85 12.8 9.55 12.85 9.35 13.05L9.3 13.1C9.14 13.26 8.92 13.35 8.7 13.35C8.48 13.35 8.26 13.26 8.1 13.1C7.94 12.94 7.85 12.72 7.85 12.5C7.85 12.28 7.94 12.06 8.1 11.9L8.15 11.85C8.35 11.65 8.4 11.35 8.3 11.1C8.2 10.86 7.97 10.7 7.7 10.7H7.55C7.1 10.7 6.75 10.35 6.75 9.9V9.5C6.75 9.05 7.1 8.7 7.55 8.7H7.7C7.97 8.7 8.2 8.54 8.3 8.3C8.4 8.05 8.35 7.75 8.15 7.55L8.1 7.5C7.94 7.34 7.85 7.12 7.85 6.9C7.85 6.68 7.94 6.46 8.1 6.3C8.26 6.14 8.48 6.05 8.7 6.05C8.92 6.05 9.14 6.14 9.3 6.3L9.35 6.35C9.55 6.55 9.85 6.6 10.1 6.5H10.15C10.38 6.4 10.5 6.17 10.5 5.9V5.75C10.5 5.3 10.85 4.95 11.3 4.95H11.7C12.15 4.95 12.5 5.3 12.5 5.75V5.9C12.5 6.17 12.66 6.4 12.9 6.5C13.15 6.6 13.45 6.55 13.65 6.35L13.7 6.3C13.86 6.14 14.08 6.05 14.3 6.05C14.52 6.05 14.74 6.14 14.9 6.3C15.06 6.46 15.15 6.68 15.15 6.9C15.15 7.12 15.06 7.34 14.9 7.5L14.85 7.55C14.65 7.75 14.6 8.05 14.7 8.3V8.35C14.8 8.58 15.03 8.7 15.3 8.7H15.45C15.9 8.7 16.25 9.05 16.25 9.5V9.9C16.25 10.35 15.9 10.7 15.45 10.7H15.3C15.03 10.7 14.8 10.86 14.7 11.1Z" />
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

export function IconSpinner(props: IconProps) {
  return (
    <svg {...defaults(props)} className={`animate-spin ${props.className || ""}`}>
      <path d="M9 2.5A6.5 6.5 0 1 0 15.5 9" strokeLinecap="round" />
    </svg>
  );
}
