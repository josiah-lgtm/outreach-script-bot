// Temporary placeholder for screens not yet ported (Phase 6 fan-out). Keeps every route
// reachable from the shell so the foundation is fully navigable and the build stays green.
"use client";

import { EmptyState } from "@/components/ui";

export function ComingSoon({ screen, note }: { screen: string; note?: string }) {
  return (
    <div className="h-full">
      <EmptyState
        icon="wand"
        title={`${screen} — coming soon`}
        description={note || "This screen is being rebuilt on the new design system."}
      />
    </div>
  );
}
