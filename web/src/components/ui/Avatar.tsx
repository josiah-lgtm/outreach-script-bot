// Avatar — initials in a circle (the legacy `.cl-av / .v9-av / .avatar`). Derives up to
// two initials from a name. `square`+`accent` reproduce the builder hero avatar.

import { cn } from "./cn";

function initials(name: string): string {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SIZE: Record<"sm" | "md" | "lg", string> = {
  sm: "w-[30px] h-[30px] text-[11px]",
  md: "w-[34px] h-[34px] text-xs",
  lg: "w-[46px] h-[46px] text-[15px]",
};

export interface AvatarProps {
  name: string;
  size?: "sm" | "md" | "lg";
  /** Filled-accent square style (the builder hero) instead of the muted circle. */
  accent?: boolean;
  className?: string;
}

export function Avatar({ name, size = "md", accent, className }: AvatarProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center font-semibold shrink-0 select-none",
        SIZE[size],
        accent ? "rounded-[9px] bg-accent text-white" : "rounded-full bg-bg3 text-subtle",
        className,
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
