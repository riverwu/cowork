import type { MouseEvent, ReactNode } from "react";
import { startWindowDrag } from "@/lib/tauri";

interface WindowDragRegionProps {
  className?: string;
  children?: ReactNode;
}

export function WindowDragRegion({ className, children }: WindowDragRegionProps) {
  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (isInteractiveElement(event.target)) return;
    startWindowDrag().catch(() => {
      console.warn("Failed to start native window drag. Check Tauri window permissions.");
    });
  };

  return (
    <div
      className={className}
      data-tauri-drag-region
      onMouseDown={handleMouseDown}
      onDoubleClick={(event) => event.preventDefault()}
    >
      {children}
    </div>
  );
}

function isInteractiveElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("button, input, textarea, select, a, [role='button']"));
}
