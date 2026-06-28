// Growth Plan Builder — the 2-pane screen (left = form, right = live doc / Tiptap editor).
// Replaces the ComingSoon stub. Reads `?client=<id>` from the URL on mount to choose the
// client (defaults to the first client). Faithful port of the legacy renderGrowth split
// (renderGrowthForm + renderGrowthPreview), with the ephemeral plan in the growthStore.

"use client";

import { useEffect, useState } from "react";
import { useConfigStore } from "@/lib/store/configStore";
import { useGrowthStore } from "@/lib/store/growthStore";
import { GrowthForm } from "@/components/growth/GrowthForm";
import { GrowthDoc } from "@/components/growth/GrowthDoc";
import { EmptyState } from "@/components/ui";
import type { GpClient, GpConfig } from "@/components/growth/types";

export default function GrowthPage() {
  const cfg = useConfigStore((s) => s.config) as GpConfig;
  const booted = useConfigStore((s) => s.booted);
  const g = useGrowthStore((s) => s.g);
  const initGrowth = useGrowthStore((s) => s.initGrowth);
  const [ready, setReady] = useState(false);

  // Mount init: pick the client from ?client=<id>, else the working clientId if still valid,
  // else the first client. Guarded so a remount doesn't clobber an in-progress plan.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!booted) return;
      if (!alive) return;
      const clients: GpClient[] = cfg.clients || [];
      const fromUrl = new URLSearchParams(window.location.search).get("client");
      const existing = clients.find((c) => c.id === g.clientId);
      if (existing && !fromUrl) {
        setReady(true);
        return;
      }
      const pick = (fromUrl && clients.find((c) => c.id === fromUrl)) || clients[0] || null;
      initGrowth(pick?.id ?? null, "strategy");
      setReady(true);
    })();
    return () => { alive = false; };
    // run once boot completes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted]);

  const client = (cfg.clients || []).find((c) => c.id === g.clientId) || null;

  if (!ready) {
    return <div className="h-full" />;
  }

  if (!client) {
    return (
      <EmptyState
        icon="target"
        title="No clients yet"
        description="Add a client first, then build a growth plan for them."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 h-full overflow-hidden">
      <div className="border-r border-border overflow-y-auto p-5">
        <GrowthForm client={client} />
      </div>
      <div className="overflow-hidden hidden lg:block">
        <GrowthDoc client={client} />
      </div>
    </div>
  );
}
