// Toggle switch — the legacy `.toggle` slider. ToggleRow wraps it with a label in the
// boxed row layout the settings screens used (`.toggle-row`).

"use client";

import { type ReactNode } from "react";
import { cn } from "./cn";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
}

export function Toggle({ checked, onChange, disabled, className, ...rest }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative w-[34px] h-[18px] rounded-full transition-colors duration-200 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer",
        checked ? "bg-accent" : "bg-border",
        className,
      )}
      {...rest}
    >
      <span
        className={cn(
          "absolute top-[3px] left-[3px] w-3 h-3 rounded-full bg-white transition-transform duration-200",
          checked && "translate-x-4",
        )}
      />
    </button>
  );
}

export function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
  className,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex items-center justify-between gap-3 px-[11px] py-2 bg-bg2 border border-border rounded-md cursor-pointer",
        className,
      )}
    >
      <span className="text-xs text-subtle">{label}</span>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </label>
  );
}
