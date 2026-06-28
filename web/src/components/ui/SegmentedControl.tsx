// SegmentedControl — the legacy `.seg` (joined buttons, one active). Generic over the
// option value so callers get a typed onChange. Used for variant counts, board export
// scope, wizard channel toggles, etc.

"use client";

import { cn } from "./cn";

export interface SegmentOption<T extends string | number> {
  value: T;
  label: React.ReactNode;
  title?: string;
}

export interface SegmentedControlProps<T extends string | number> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
}

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  size = "md",
  className,
}: SegmentedControlProps<T>) {
  const pad = size === "sm" ? "px-3.5 py-1.5 text-[11px]" : "px-[18px] py-[7px] text-xs";
  return (
    <div className={cn("inline-flex border border-border rounded-lg overflow-hidden", className)}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              "font-semibold cursor-pointer transition-colors duration-150",
              pad,
              i > 0 && "border-l border-border",
              on ? "bg-accent text-white" : "bg-bg2 text-muted hover:text-text",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
