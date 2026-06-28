// EmptyState — the legacy `.placeholder-state / .doc-empty / .v9-empty` centered
// placeholder with an icon, message and an optional action.

import { type ReactNode } from "react";
import { cn } from "./cn";
import { Icon } from "./Icon";

export interface EmptyStateProps {
  /** Legacy `ti-*` icon name. */
  icon?: string;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon = "inbox", title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("h-full flex flex-col items-center justify-center gap-3 text-center text-muted px-6 py-12", className)}>
      <Icon name={icon} size={38} className="opacity-40" />
      {title && <div className="text-[13px] text-text font-medium">{title}</div>}
      {description && <div className="text-[13px] max-w-[260px] leading-relaxed">{description}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
