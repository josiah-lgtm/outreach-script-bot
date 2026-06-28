// Tabs — horizontal tab bar (the legacy `.tab-btn`, `.admin-tabs`, `.etabs`,
// `.v9-secnav`). Controlled. `variant="pill"` is the filled-accent active style;
// `variant="soft"` is the subtle bg3 active style used by admin/section nav.

"use client";

import { type ReactNode } from "react";
import { cn } from "./cn";
import { Icon } from "./Icon";

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  /** Optional leading `ti-*` icon. */
  icon?: string;
  /** Optional trailing count badge. */
  count?: number;
}

export interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  variant?: "pill" | "soft";
  /** Vertical layout (section nav). */
  vertical?: boolean;
  className?: string;
}

export function Tabs<T extends string>({ items, value, onChange, variant = "pill", vertical, className }: TabsProps<T>) {
  return (
    <div className={cn("flex gap-1.5", vertical ? "flex-col" : "flex-wrap items-center", className)}>
      {items.map((it) => {
        const on = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            onClick={() => onChange(it.value)}
            className={cn(
              "inline-flex items-center gap-2 text-[13px] font-medium cursor-pointer transition-colors duration-150",
              vertical ? "w-full text-left px-3 py-2 rounded-lg" : "px-3 py-1.5 rounded-md",
              on
                ? variant === "pill"
                  ? "bg-accent text-white"
                  : "bg-bg3 text-text border border-border"
                : "text-muted hover:text-text hover:bg-bg3 border border-transparent",
            )}
          >
            {it.icon && <Icon name={it.icon} size={16} />}
            {it.label}
            {it.count != null && <span className={cn("text-[11px] font-semibold", on ? "" : "text-amber")}>{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
