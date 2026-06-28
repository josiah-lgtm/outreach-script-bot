// MechanismBlock — the section-level "Mechanism — how we get the result" host used by
// the client-detail overview + client sections (legacy osMechBuild :7419 + the inline
// build/rebuild button at v9Section :7292/:7320). The MechanismCards renderer + the
// buildMechanism/pickMechanism engine are already ported; this just wires the
// build/rebuild button, busy/error state, and the active-mechanism selection.

"use client";

import { useState } from "react";
import { buildMechanism, pickMechanism } from "@/lib/sync/wizard";
import { MechanismCards } from "@/components/wizard/parts";
import { Button, Icon } from "@/components/ui";
import { notify } from "@/lib/notify";
import type { Client } from "@/lib/sync/types";
import type { Mechanism } from "@/lib/ai-json";

export function MechanismBlock({ client, clientId }: { client: Client; clientId: string }) {
  const mechs = (client.mechanisms as Mechanism[] | undefined) || [];
  const activeId = client.activeMechId as string | undefined;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function build() {
    setBusy(true); setError("");
    try {
      const { mechs: out } = await buildMechanism(clientId, null, null);
      if (!out.length) setError("The AI didn't return a usable mechanism. Try again.");
      else notify("Mechanism built");
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[13px] font-semibold">Mechanism — how we get the result</div>
        <Button variant="secondary" size="sm" icon="wand" loading={busy} disabled={busy} onClick={build}>
          {mechs.length ? "Rebuild (AI)" : "Build mechanism (AI)"}
        </Button>
      </div>
      <div className="text-xs text-muted">Built from this client&apos;s services + pains/desires. Saved here and used when writing scripts.</div>
      {error && (
        <div className="bg-bg2 border border-red rounded-lg p-3 text-xs text-red whitespace-pre-wrap flex gap-1.5">
          <Icon name="alert-triangle" size={14} /> {error}
        </div>
      )}
      {mechs.length ? (
        <MechanismCards
          mechs={mechs}
          activeId={activeId}
          helpLabel="How this helps"
          onPick={(id) => { const name = pickMechanism(clientId, id); notify(`Using “${name}” in scripts`); }}
        />
      ) : (
        <div className="text-xs text-muted">No mechanism built yet — tap “Build mechanism (AI)”.</div>
      )}
    </div>
  );
}
