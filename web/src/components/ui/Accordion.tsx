// Accordion — a single collapsible section (the legacy `.angle-acc`, `details.personalize`,
// `.v9-bucket`). Controlled (`open` + `onToggle`) so parents can manage exclusive-open
// groups; a rotating chevron mirrors the legacy arrow.

"use client";

import { type ReactNode } from "react";
import { cn } from "./cn";
import { Icon } from "./Icon";

export interface AccordionProps {
  title: ReactNode;
  /** Right-aligned meta (counts, badges). */
  meta?: ReactNode;
  open: boolean;
  onToggle: () => void;
  className?: string;
  children?: ReactNode;
}

export function Accordion({ title, meta, open, onToggle, className, children }: AccordionProps) {
  return (
    <div className={cn("mb-2 border border-border rounded-lg overflow-hidden bg-bg2", open && "border-accent", className)}>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left cursor-pointer transition-colors duration-150 select-none",
          open ? "bg-[var(--tint-accent)]" : "bg-bg3 hover:bg-bg2",
        )}
      >
        <span className="text-[13px] font-semibold text-text">{title}</span>
        <span className="flex items-center gap-2 text-[11px] text-muted">
          {meta}
          <Icon name="chevron-down" size={14} className={cn("transition-transform duration-200", open && "rotate-180")} />
        </span>
      </button>
      {open && <div className="border-t border-border p-3">{children}</div>}
    </div>
  );
}
