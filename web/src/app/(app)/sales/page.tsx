// SALES PROSPECT PIPELINE — the 2-pane screen (left = prospect intake + pipeline form,
// right = the live personalised pitch doc). Replaces the ComingSoon stub. Faithful port of
// the legacy renderSales split (renderSalesForm + renderSalesPreview, :6591). Prospects live
// in config.prospects (distinct from clients); the ephemeral selection lives in the
// growthStore (mode='sales'). Reads `?prospect=<id>` on mount to choose the prospect.

"use client";

import { useEffect, useState } from "react";
import { useConfigStore } from "@/lib/store/configStore";
import { useGrowthStore, curProspect, type Prospect } from "@/lib/store/growthStore";
import { SalesForm } from "@/components/sales/SalesForm";
import { SalesDoc } from "@/components/sales/SalesDoc";

export default function SalesPage() {
  const booted = useConfigStore((s) => s.booted);
  // Subscribe to the prospect list so the panes re-render when config.prospects changes.
  const list = useConfigStore((s) => s.config.prospects) as Prospect[] | undefined;
  const prospectId = useGrowthStore((s) => s.prospectId);
  const selectProspect = useGrowthStore((s) => s.selectProspect);
  const [ready, setReady] = useState(false);

  // Mount init: pick the prospect from ?prospect=<id>, else the working selection if still
  // valid, else fall through to curProspect's first-prospect fallback. Inner-IIFE + alive
  // guard so a remount doesn't clobber an in-progress selection (react-hooks/set-state-in-effect).
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!booted) return;
      if (!alive) return;
      const prospects = (useConfigStore.getState().config.prospects || []) as Prospect[];
      const fromUrl = new URLSearchParams(window.location.search).get("prospect");
      const valid = prospects.find((x) => x.id === useGrowthStore.getState().prospectId);
      const pick = (fromUrl && prospects.find((x) => x.id === fromUrl)) || valid || prospects[0] || null;
      if (pick && pick.id !== useGrowthStore.getState().prospectId) selectProspect(pick.id);
      setReady(true);
    })();
    return () => { alive = false; };
    // run once boot completes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted]);

  const prospect = curProspect(prospectId);
  // `list` is read so this component re-renders on prospect edits; reference it to satisfy lint.
  void list;

  if (!ready) return <div className="h-full" />;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 h-full overflow-hidden">
      <div className="border-r border-border overflow-y-auto p-5">
        <SalesForm prospect={prospect} />
      </div>
      <div className="overflow-hidden hidden lg:block">
        <SalesDoc prospect={prospect} />
      </div>
    </div>
  );
}
