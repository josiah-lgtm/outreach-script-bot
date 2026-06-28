// Tooltip — hover/focus popover (the legacy `.v9-tip / .v9-fwtip / .v9-snif .tip`
// pattern: an absolutely-positioned card revealed on hover). Lightweight, no portal;
// the trigger is positioned relative and the bubble is shown on group-hover/focus.
// `content` preserves whitespace (framework templates were shown pre-wrapped).

"use client";

import { type ReactNode } from "react";
import { cn } from "./cn";

export interface TooltipProps {
  content: ReactNode;
  /** Where the bubble anchors relative to the trigger. */
  side?: "bottom" | "top";
  /** Max width of the bubble (px). */
  width?: number;
  className?: string;
  children: ReactNode;
}

export function Tooltip({ content, side = "bottom", width = 280, className, children }: TooltipProps) {
  if (content == null || content === "") return <>{children}</>;
  return (
    <span className={cn("relative inline-flex group/tt", className)}>
      {children}
      <span
        role="tooltip"
        style={{ width }}
        className={cn(
          "pointer-events-none absolute left-0 z-30 hidden group-hover/tt:block group-focus-within/tt:block",
          side === "bottom" ? "top-full mt-1" : "bottom-full mb-1",
          "whitespace-pre-wrap bg-bg2 border border-border rounded-lg px-3 py-2.5 text-[11px] leading-relaxed text-subtle shadow-[var(--shadow-md)] max-h-80 overflow-auto",
        )}
      >
        {content}
      </span>
    </span>
  );
}
