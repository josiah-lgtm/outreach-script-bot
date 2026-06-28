// Form primitives — the legacy `.form-group / .form-label / .form-input /
// .form-select / .form-textarea / .num-input / .hint` family. Inputs are uncontrolled-
// friendly native elements with the shared focus-border style. FormField composes a
// label + control + hint.

"use client";

import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

const BASE =
  "w-full bg-bg2 border border-border rounded-md text-text text-[13px] px-[11px] py-2 outline-none transition-colors duration-150 focus:border-accent placeholder:text-muted disabled:opacity-50";

export function Label({ className, children, htmlFor }: { className?: string; children?: ReactNode; htmlFor?: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn("block text-[10px] font-semibold text-muted tracking-wide uppercase mb-1.5", className)}
    >
      {children}
    </label>
  );
}

export function Hint({ className, children }: { className?: string; children?: ReactNode }) {
  return <p className={cn("text-[11px] text-muted leading-snug mt-1", className)}>{children}</p>;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(BASE, className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(BASE, "resize-y min-h-[60px] leading-relaxed", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cn(BASE, "cursor-pointer", className)} {...rest}>
      {children}
    </select>
  );
});

export interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "value"> {
  value: number | string;
  onValueChange?: (value: number) => void;
  /** Append a % suffix and treat the field as a percentage (display only). */
  percent?: boolean;
}

/** Compact right-aligned numeric input (the legacy `.num-input`). */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { className, value, onValueChange, percent, onBlur, ...rest },
  ref,
) {
  return (
    <span className="relative inline-flex items-center">
      <input
        ref={ref}
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onValueChange?.(Number(e.target.value))}
        onBlur={onBlur}
        className={cn(
          "w-24 bg-bg2 border border-border rounded-md text-text text-xs px-2 py-[5px] text-right outline-none tabular-nums focus:border-accent",
          percent && "pr-6",
          className,
        )}
        {...rest}
      />
      {percent && <span className="absolute right-2 text-xs text-muted pointer-events-none">%</span>}
    </span>
  );
});

export interface FormFieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

export function FormField({ label, hint, htmlFor, className, children }: FormFieldProps) {
  return (
    <div className={cn("mb-3", className)}>
      {label && <Label htmlFor={htmlFor}>{label}</Label>}
      {children}
      {hint && <Hint>{hint}</Hint>}
    </div>
  );
}

/** Two-column grid for paired fields (legacy `.grid2`). */
export function Grid2({ className, children }: { className?: string; children?: ReactNode }) {
  return <div className={cn("grid grid-cols-2 gap-2.5", className)}>{children}</div>;
}
