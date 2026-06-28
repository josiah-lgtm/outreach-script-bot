// Pill + StatusDot. Pill is the legacy header `.pill` (status chip with a leading
// dot) — used for the save-status indicator. StatusDot is the standalone colored dot
// (`.dot` with .warn/.err/.searching states).

"use client";

import { type ReactNode } from "react";
import { cn } from "./cn";

type DotTone = "green" | "amber" | "red" | "muted";

const DOT: Record<DotTone, string> = {
  green: "bg-green",
  amber: "bg-amber",
  red: "bg-red",
  muted: "bg-muted",
};

export function StatusDot({ tone = "green", pulse, className }: { tone?: DotTone; pulse?: boolean; className?: string }) {
  return <span className={cn("inline-block w-[7px] h-[7px] rounded-full shrink-0", DOT[tone], pulse && "animate-pulse-dot", className)} />;
}

export interface PillProps {
  tone?: DotTone;
  pulse?: boolean;
  /** Hide the leading dot (plain pill). */
  noDot?: boolean;
  className?: string;
  children?: ReactNode;
}

export function Pill({ tone = "green", pulse, noDot, className, children }: PillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 bg-bg3 border border-border rounded-md px-2.5 py-1 text-[11px] text-muted whitespace-nowrap",
        className,
      )}
    >
      {!noDot && <StatusDot tone={tone} pulse={pulse} />}
      {children}
    </span>
  );
}
