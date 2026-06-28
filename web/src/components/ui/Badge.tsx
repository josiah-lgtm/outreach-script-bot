// Badge family — small status pills. Consolidates the legacy `.badge2`, `.v9-stage`,
// `.status-idea/.status-testing/.status-winning`, `.gp-badge.*` and niche tags.
//   • Badge        — generic toned pill
//   • StageBadge   — a client's pipeline stage (Testing | Proof of concept | Scaling)
//   • StatusBadge  — a script's kanban status (idea | testing | winning), clickable

"use client";

import { type ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "accent" | "green" | "amber" | "red";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-bg3 border-border text-subtle",
  accent: "bg-[var(--tint-accent)] border-[var(--tint-accent-ring)] text-accent2",
  green: "bg-[var(--tint-green)] border-[var(--tint-green-ring)] text-green",
  amber: "bg-[var(--tint-amber)] border-[var(--tint-amber-ring)] text-amber",
  red: "bg-[var(--tint-red)] border-[var(--tint-red-ring)] text-red",
};

export interface BadgeProps {
  tone?: BadgeTone;
  className?: string;
  children?: ReactNode;
}

export function Badge({ tone = "neutral", className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-medium px-2.5 py-0.5 rounded-full border whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const STAGE_TONE: Record<string, BadgeTone> = {
  Testing: "amber",
  "Proof of concept": "accent",
  Scaling: "green",
};

export function StageBadge({ stage, className }: { stage?: string; className?: string }) {
  if (!stage) return null;
  return (
    <Badge tone={STAGE_TONE[stage] ?? "neutral"} className={className}>
      {stage}
    </Badge>
  );
}

export type ScriptStatus = "idea" | "testing" | "winning";

const STATUS: Record<ScriptStatus, { tone: BadgeTone; label: string }> = {
  idea: { tone: "neutral", label: "Idea" },
  testing: { tone: "amber", label: "Testing" },
  winning: { tone: "green", label: "Winning" },
};

export function StatusBadge({
  status,
  onClick,
  className,
}: {
  status: ScriptStatus;
  onClick?: () => void;
  className?: string;
}) {
  const s = STATUS[status] ?? STATUS.idea;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("cursor-pointer", !onClick && "pointer-events-none", className)}
    >
      <Badge tone={s.tone}>{s.label}</Badge>
    </button>
  );
}
