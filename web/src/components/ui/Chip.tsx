// Chip — the legacy `.chip` (toggleable pill). Supports color variants for the
// "mixing board" chips (pain/outcome/guarantee/offer) and a star-prefixed favorite
// mode (the `.fav-chip` family). Controlled via `selected` + `onClick`.

"use client";

import { type ReactNode } from "react";
import { cn } from "./cn";
import { Icon } from "./Icon";

type ChipTone = "accent" | "green" | "amber" | "red";

const ON: Record<ChipTone, string> = {
  accent: "bg-accent border-accent text-white",
  green: "bg-[var(--tint-green)] border-green text-green",
  amber: "bg-[var(--tint-amber)] border-amber text-amber",
  red: "bg-[var(--tint-red)] border-red text-red",
};

export interface ChipProps {
  selected?: boolean;
  tone?: ChipTone;
  /** Render a leading favorite star that fills when selected. */
  star?: boolean;
  /** A trailing removable "×" (calls onRemove). */
  onRemove?: () => void;
  onClick?: () => void;
  className?: string;
  title?: string;
  children?: ReactNode;
}

export function Chip({ selected, tone = "accent", star, onRemove, onClick, className, title, children }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs cursor-pointer transition-colors duration-150 select-none",
        selected ? ON[tone] : "bg-bg2 border-border text-subtle hover:border-accent",
        className,
      )}
    >
      {star && (
        <Icon name="heart" size={12} className={selected ? "" : "opacity-60"} />
      )}
      {children}
      {onRemove && (
        <span
          role="button"
          aria-label="Remove"
          className="ml-0.5 opacity-70 hover:opacity-100 font-bold"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </span>
      )}
    </button>
  );
}
