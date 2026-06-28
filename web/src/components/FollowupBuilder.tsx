// Follow-up sequence builder — port of the legacy follow-up modal (index.html:6463
// openFollowups / 6484 renderFollowupModal / 6536 fuGenerate / 6567 fuSave). Drives the
// `generate_followups` server action and saves a sequence onto client.followups in the
// exact shape the overview card, board badge, growth-plan attach and Notion export read:
//   { id, parentLabel, parentText, icpId, gapDays, items:[{day,framework,text}], createdAt }
//
// Launched from a board script card ("↪ Follow-ups") and from the create-script wizard's
// "Follow-up sequence" flow. All config writes go through useConfigStore.update() so the
// single save queue / CAS stays correct.

"use client";

import { useState, type ReactNode } from "react";
import {
  Modal, Button, Chip, Select, Textarea, NumberInput, FormField, Hint,
} from "@/components/ui";
import { ScriptEditModal } from "@/components/ScriptEditModal";
import { useConfigStore } from "@/lib/store/configStore";
import { getAdminKey } from "@/lib/sync/adminKey";
import { api } from "@/lib/sync/api";
import { notify } from "@/lib/notify";
import { uid } from "@/lib/text-utils";
import { clientPains, clientDesires, dedupeStr } from "@/lib/sync/wizard";
import type { Client, Niche } from "@/lib/sync/types";

interface FuFramework {
  id: string;
  name: string;
  template: string;
}
interface FuItem {
  day: number;
  framework: string;
  text: string;
}
interface FuIcp {
  id: string;
  title: string;
  jobTitles?: string[];
  niche?: string;
}

// Port of legacy clientAnglePool (index.html:4939): niche angles + transcript angles + saved.
function anglePool(c: Client, niches: Niche[]): string[] {
  const fromNiches = ((c.nicheIds as string[]) || []).flatMap(
    (id) => ((niches.find((n) => n.id === id)?.angles as string[]) || []),
  );
  const fromTranscripts = ((c.transcripts as Array<{ angles?: string[] }>) || []).flatMap((t) => t.angles || []);
  const custom = ((c.savedAngles as Array<{ text?: string }>) || []).map((x) => x.text || "");
  return dedupeStr([...fromNiches, ...fromTranscripts, ...custom]);
}

export function FollowupBuilder({
  open,
  onClose,
  clientId,
  parentLabel,
  parentText,
}: {
  open: boolean;
  onClose: () => void;
  clientId: string;
  parentLabel: string;
  parentText: string;
}) {
  const client = useConfigStore((s) => (s.config.clients || []).find((c: Client) => c.id === clientId)) as
    | Client
    | undefined;
  const frameworks = (useConfigStore((s) => s.config.followupFrameworks) || []) as FuFramework[];
  const niches = (useConfigStore((s) => s.config.niches) || []) as Niche[];
  const rules =
    (useConfigStore((s) => s.config.settings) as { growthRules?: string } | undefined)?.growthRules || "";

  const icps = (client?.icps as FuIcp[]) || [];

  // Fresh state per open — the parent mounts this only while open (legacy fuState defaults).
  const [icpId, setIcpId] = useState<string>(icps[0]?.id || "");
  const [use, setUse] = useState({ pains: true, desires: true, angles: false });
  const [frameworkIds, setFrameworkIds] = useState<string[]>(frameworks.slice(0, 2).map((f) => f.id));
  const [gapDays, setGapDays] = useState(2);
  const [result, setResult] = useState<FuItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);

  if (!client) return null;

  function toggleFw(id: string) {
    setFrameworkIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  // Legacy fuGenerate (index.html:6536) — same request body and basis gathering.
  async function generate() {
    if (!getAdminKey()) {
      notify("No admin key", true);
      return;
    }
    if (!frameworkIds.length) {
      notify("Pick at least one framework", true);
      return;
    }
    const fws = frameworkIds
      .map((id) => frameworks.find((f) => f.id === id))
      .filter(Boolean) as FuFramework[];
    const icp = icps.find((i) => i.id === icpId);
    const basis = {
      pains: use.pains ? clientPains(client) : [],
      desires: use.desires ? clientDesires(client) : [],
      angles: use.angles ? anglePool(client!, niches) : [],
    };
    setBusy(true);
    try {
      const r = await api({
        action: "generate_followups",
        parentScript: parentText,
        frameworks: fws.map((f) => ({ name: f.name, template: f.template })),
        gapDays,
        icp: icp ? { title: icp.title, jobTitles: icp.jobTitles || [], niche: icp.niche } : undefined,
        client: { name: client!.name, caseStudy: client!.caseStudy || {} },
        basis,
        rules,
      });
      const items = ((r.followups as FuItem[]) || []).map((it) => ({
        day: it.day,
        framework: it.framework || "",
        text: it.text || "",
      }));
      setResult(items);
      notify(`✨ ${items.length} follow-up${items.length === 1 ? "" : "s"} written`);
    } catch (e) {
      notify("Generate failed: " + (e as Error).message, true);
    }
    setBusy(false);
  }

  // Legacy fuSave (index.html:6567) — push the sequence onto client.followups.
  function save() {
    if (!result?.length) {
      notify("Generate the follow-ups first", true);
      return;
    }
    useConfigStore.getState().update((cfg) => {
      const c = (cfg.clients || []).find((x: Client) => x.id === clientId);
      if (!c) return;
      c.followups = c.followups || [];
      c.followups.push({
        id: uid("seq"),
        parentLabel,
        parentText,
        icpId,
        gapDays,
        items: result.map((it) => ({ day: it.day, framework: it.framework || "", text: it.text || "" })),
        createdAt: new Date().toISOString().slice(0, 10),
      });
    });
    notify("↪ Follow-up sequence saved");
    onClose();
  }

  const cadence = frameworkIds.length
    ? "Cadence: " + frameworkIds.map((_, i) => "Day +" + gapDays * (i + 1)).join(" · ")
    : "Pick at least one framework.";

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="↪ Build follow-up sequence"
      sub={client.name}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" icon="device-floppy" disabled={!result?.length} onClick={save}>
            Save sequence
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <SubLabel>First script (these follow up on it)</SubLabel>
          <div className="bg-bg2 border border-border rounded-lg p-3 font-mono text-[12px] whitespace-pre-wrap max-h-[120px] overflow-auto">
            {parentText || (
              <span className="text-muted">No first script linked — follow-ups will stand alone.</span>
            )}
          </div>
        </div>

        {icps.length > 0 && (
          <FormField label="Target ICP">
            <Select value={icpId} onChange={(e) => setIcpId(e.target.value)}>
              <option value="">— none —</option>
              {icps.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title}
                </option>
              ))}
            </Select>
          </FormField>
        )}

        <div>
          <SubLabel>Base the follow-ups on</SubLabel>
          <div className="flex flex-wrap gap-1.5">
            <Chip tone="red" selected={use.pains} onClick={() => setUse((u) => ({ ...u, pains: !u.pains }))}>
              Pains
            </Chip>
            <Chip tone="green" selected={use.desires} onClick={() => setUse((u) => ({ ...u, desires: !u.desires }))}>
              Desires
            </Chip>
            <Chip tone="accent" selected={use.angles} onClick={() => setUse((u) => ({ ...u, angles: !u.angles }))}>
              Angles
            </Chip>
          </div>
        </div>

        <div>
          <SubLabel>Frameworks — pick in order (one follow-up each)</SubLabel>
          {frameworks.length ? (
            <div className="flex flex-wrap gap-1.5">
              {frameworks.map((f) => {
                const idx = frameworkIds.indexOf(f.id);
                return (
                  <Chip key={f.id} selected={idx > -1} onClick={() => toggleFw(f.id)}>
                    {idx > -1 ? `${idx + 1}. ` : ""}
                    {f.name}
                  </Chip>
                );
              })}
            </div>
          ) : (
            <Hint>No follow-up frameworks yet. Add them in Admin → Follow-ups.</Hint>
          )}
        </div>

        <FormField label="Days between follow-ups">
          <NumberInput value={gapDays} onValueChange={(v) => setGapDays(Math.max(1, v || 2))} />
        </FormField>
        <Hint>{cadence}</Hint>

        <Button
          variant="secondary"
          size="sm"
          icon="wand"
          loading={busy}
          disabled={busy || !frameworkIds.length}
          onClick={generate}
        >
          {result ? "Regenerate follow-ups" : "Generate follow-ups"}
        </Button>

        {result && (
          <div className="space-y-2.5 pt-1">
            <SubLabel>Generated follow-ups — edit inline, or open the full editor</SubLabel>
            {result.map((f, i) => (
              <div key={i} className="border border-border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between bg-bg2 px-3 py-1.5">
                  <span className="inline-flex items-center gap-2 text-[12px]">
                    <span className="inline-flex items-center rounded-full bg-accent2 text-white text-[10px] font-semibold px-2 py-0.5">
                      Day +{f.day}
                    </span>
                    <b>{f.framework}</b>
                  </span>
                  <Button variant="ghost" size="sm" icon="edit" onClick={() => setEditIdx(i)}>
                    Full editor
                  </Button>
                </div>
                <Textarea
                  value={f.text}
                  onChange={(e) =>
                    setResult((r) => (r || []).map((it, k) => (k === i ? { ...it, text: e.target.value } : it)))
                  }
                  className="min-h-[110px] font-mono border-0 rounded-none"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {editIdx != null && result?.[editIdx] && (
        <ScriptEditModal
          open
          onClose={() => setEditIdx(null)}
          title={`Day +${result[editIdx].day}`}
          sub={result[editIdx].framework || ""}
          initialText={result[editIdx].text}
          applyLabel="Save"
          onApply={(text) => {
            setResult((r) => (r || []).map((it, k) => (k === editIdx ? { ...it, text } : it)));
            setEditIdx(null);
          }}
        />
      )}
    </Modal>
  );
}

function SubLabel({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-semibold text-muted mb-1.5">{children}</div>;
}
