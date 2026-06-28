// Button + IconButton. Consolidates the legacy `.btn/.btn-primary/.btn-secondary`,
// `.mini-btn`, `.v9-newbtn`, `.copy-btn` and `.modal-close` button families into one
// variant API. A loading button shows a spinner and disables itself.

"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";
import { Icon } from "./Icon";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "mini";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-accent text-white border border-transparent hover:bg-accent2 disabled:opacity-40",
  secondary:
    "bg-transparent text-subtle border border-border hover:border-accent hover:text-text disabled:opacity-40",
  ghost:
    "bg-transparent text-muted border border-transparent hover:bg-bg3 hover:text-text disabled:opacity-40",
  danger:
    "bg-transparent text-muted border border-border hover:border-red hover:text-red disabled:opacity-40",
  mini:
    "bg-transparent text-muted border border-border hover:border-accent hover:text-text disabled:opacity-40",
};

const SIZE: Record<Size, string> = {
  sm: "text-[11px] px-2.5 py-1 rounded-md gap-1",
  md: "text-[13px] px-4 py-2 rounded-md gap-1.5",
  lg: "text-[13px] px-4 py-2.5 rounded-md gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Show a spinner and disable. */
  loading?: boolean;
  /** Legacy `ti-*` icon name rendered before the label. */
  icon?: string;
  /** Stretch to fill the container (legacy `.btn` was full-width). */
  block?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, block, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center font-semibold cursor-pointer transition-[background,border-color,color,opacity] duration-150 disabled:cursor-not-allowed select-none",
        VARIANT[variant],
        SIZE[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? <Icon name="loader-2" className="animate-[spin_0.8s_linear_infinite]" /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, "icon" | "children"> {
  icon: string;
  /** Accessible label (icon-only buttons have no text). */
  label: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = "ghost", size = "md", className, ...rest },
  ref,
) {
  const pad = size === "sm" ? "p-1" : size === "lg" ? "p-2.5" : "p-2";
  return (
    <Button
      ref={ref}
      variant={variant}
      aria-label={label}
      title={label}
      className={cn("!px-0 !py-0 aspect-square", pad, className)}
      {...rest}
    >
      <Icon name={icon} size={size === "sm" ? 15 : 18} />
    </Button>
  );
});
