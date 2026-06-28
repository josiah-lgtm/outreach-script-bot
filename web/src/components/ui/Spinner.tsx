// Spinner + StepProgress. Spinner is the legacy `.loading-spinner` rotating ring.
// StepProgress is the `.loading-steps` list shown during AI generation: steps before
// `active` read as done (green), the `active` step highlights, the rest are pending.

import { cn } from "./cn";

const RING: Record<"sm" | "md" | "lg", string> = {
  sm: "w-4 h-4 border",
  md: "w-6 h-6 border-2",
  lg: "w-8 h-8 border-2",
};

export function Spinner({ size = "md", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block rounded-full border-border border-t-accent animate-[spin_0.8s_linear_infinite]",
        RING[size],
        className,
      )}
    />
  );
}

export interface StepProgressProps {
  steps: string[];
  /** Index of the in-flight step; everything before it is done. -1 = none yet. */
  active: number;
  className?: string;
}

export function StepProgress({ steps, active, className }: StepProgressProps) {
  return (
    <div className={cn("flex flex-col gap-1.5 text-center", className)}>
      {steps.map((label, i) => {
        const state = i < active ? "done" : i === active ? "active" : "pending";
        return (
          <div
            key={i}
            className={cn(
              "text-[11px] transition-colors duration-300",
              state === "done" && "text-green",
              state === "active" && "text-accent2",
              state === "pending" && "text-border",
            )}
          >
            {label}
          </div>
        );
      })}
    </div>
  );
}

/** Full-panel loading state: a spinner above an optional StepProgress. */
export function LoadingState({ steps, active, className }: { steps?: string[]; active?: number; className?: string }) {
  return (
    <div className={cn("h-full flex flex-col items-center justify-center gap-3.5", className)}>
      <Spinner size="lg" />
      {steps && steps.length > 0 && <StepProgress steps={steps} active={active ?? 0} />}
    </div>
  );
}
