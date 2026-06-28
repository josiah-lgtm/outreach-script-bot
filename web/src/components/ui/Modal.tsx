// Modal — overlay dialog (the legacy `.modal-overlay / .modal`). Portals to <body>,
// closes on Escape and overlay click (unless dismissible=false), and locks page scroll
// while open. The header/body/footer slots mirror `.modal-head/.modal-body/.modal-foot`.
// The ScriptEditModal composes on top of this (version rail goes in `children`).

"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";
import { Icon } from "./Icon";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  sub?: ReactNode;
  /** Footer content (buttons). Rendered in `.modal-foot`. */
  footer?: ReactNode;
  /** Constrain the box; defaults to a compact dialog. Pass a wider preset for editors. */
  size?: "sm" | "md" | "lg" | "xl";
  /** Allow Escape / overlay click to close (default true). */
  dismissible?: boolean;
  /** Remove body padding (for split layouts like the edit modal's rail). */
  flush?: boolean;
  className?: string;
  children?: ReactNode;
}

const SIZE: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "w-[min(420px,95vw)]",
  md: "w-[min(560px,95vw)]",
  lg: "w-[min(760px,95vw)]",
  xl: "w-[min(960px,95vw)] h-[min(680px,92vh)]",
};

export function Modal({
  open,
  onClose,
  title,
  sub,
  footer,
  size = "md",
  dismissible = true,
  flush,
  className,
  children,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && dismissible) onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, dismissible, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-[rgba(5,5,10,0.45)] backdrop-blur-[2px] p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissible) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "flex flex-col bg-bg2 border border-border rounded-2xl overflow-hidden shadow-[var(--shadow-modal)] max-h-[92vh]",
          SIZE[size],
          className,
        )}
      >
        {(title || sub) && (
          <div className="flex items-center justify-between gap-3 px-[18px] py-3.5 border-b border-border shrink-0">
            <div className="flex items-baseline gap-2.5 min-w-0">
              {title && <h2 className="text-[15px] font-bold truncate">{title}</h2>}
              {sub && <span className="text-[11px] text-muted truncate">{sub}</span>}
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="text-muted hover:text-text hover:bg-bg3 rounded-md p-1 leading-none cursor-pointer shrink-0"
            >
              <Icon name="x" size={18} />
            </button>
          </div>
        )}
        <div className={cn("flex-1 overflow-auto", flush ? "flex" : "p-[18px]")}>{children}</div>
        {footer && <div className="flex items-center gap-2 px-[18px] py-3 border-t border-border shrink-0">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
