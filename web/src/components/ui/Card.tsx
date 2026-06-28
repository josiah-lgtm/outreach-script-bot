// Card surface. Replaces the legacy `.card / .client-hero / .v9-card2 / .icp-card`
// surfaces. `interactive` adds the hover-border affordance the legacy cards had;
// `as` lets a card render as a Link/anchor (the V9 client cards were real links).

"use client";

import { type ElementType, type ReactNode } from "react";
import { cn } from "./cn";

export interface CardProps {
  as?: ElementType;
  interactive?: boolean;
  selected?: boolean;
  className?: string;
  children?: ReactNode;
  // passthrough (href, onClick, draggable handlers, …)
  [key: string]: unknown;
}

export function Card({ as, interactive, selected, className, children, ...rest }: CardProps) {
  const Cmp = (as || "div") as ElementType;
  return (
    <Cmp
      className={cn(
        "bg-bg2 border rounded-xl",
        selected ? "border-accent" : "border-border",
        interactive && "cursor-pointer transition-colors duration-150 hover:border-accent no-underline text-inherit",
        className,
      )}
      {...rest}
    >
      {children}
    </Cmp>
  );
}

export function CardHeader({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div className={cn("flex items-center justify-between gap-2 px-3.5 py-3 border-b border-border", className)}>
      {children}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children?: ReactNode }) {
  return <div className={cn("p-3.5", className)}>{children}</div>;
}
