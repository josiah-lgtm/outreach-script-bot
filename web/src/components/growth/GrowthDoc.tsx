// The right pane — the live growth-plan document with an action bar (Edit doc / Save /
// Export to Notion). Ports the legacy renderGrowthPreview (:5693) + gpEnterEdit / gpRegenDoc
// / gpExportNotion (:5712, :5719, :6422).
//
// EDIT ↔ EXPORT SWITCH (the contract):
//   • NOT edited (g.docJson == null): the live <DocContent> is shown. Export builds blocks
//     deterministically with buildGrowthPlanBlocks(...).
//   • Edited (g.docJson != null): the Tiptap editor is shown and its JSON is the source of
//     truth. "Edit doc" seeds Tiptap from the serialized live preview (renderToStaticMarkup);
//     on every keystroke setDocJson(json) runs. Export then uses blocksFromEditorDoc(json).
//   • "Regenerate from form" sets docJson = null → back to the live preview / deterministic
//     export.

"use client";

import { useMemo, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, Icon, Spinner } from "@/components/ui";
import { api } from "@/lib/sync/api";
import { getAdminKey } from "@/lib/sync/adminKey";
import { notify } from "@/lib/notify";
import { useConfigStore } from "@/lib/store/configStore";
import {
  useGrowthStore,
  asPlanState,
  includedTools,
  activeFollowups,
  type GrowthWorking,
} from "@/lib/store/growthStore";
import {
  buildGrowthPlanBlocks,
  blocksFromEditorDoc,
  type EditorNode,
} from "@/lib/sync/notion-blocks";
import { computeChannel, computeReverse, type Channel } from "@/lib/funnel-math";
import { DocContent } from "./docContent";
import { DocStyles } from "./docStyles";
import { GrowthEditor } from "./GrowthEditor";
import type { GpClient, GpConfig } from "./types";

const CH_LABEL: Record<string, string> = { email: "📧 Email", linkedin: "🔗 LinkedIn" };

interface GrowthDocProps {
  client: GpClient;
}

export function GrowthDoc({ client }: GrowthDocProps) {
  const g = useGrowthStore((s) => s.g);
  const setNarrative = useGrowthStore((s) => s.setNarrative);
  const setNarrating = useGrowthStore((s) => s.setNarrating);
  const setDocJson = useGrowthStore((s) => s.setDocJson);
  const savePlan = useGrowthStore((s) => s.savePlan);
  const setNotionUrl = useGrowthStore((s) => s.setNotionUrl);
  const cfg = useConfigStore((s) => s.config) as GpConfig;

  const [drafting, setDrafting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [editorSeed, setEditorSeed] = useState<string>("");

  const edited = g.docJson != null;
  const rules = cfg.settings?.growthRules || "";

  // Serialize the live preview to HTML to seed Tiptap when entering edit mode.
  const enterEdit = () => {
    const html = renderToStaticMarkup(<DocContent g={g} client={client} />);
    setEditorSeed(html);
    // Setting docJson to a sentinel flips to edit mode; the editor seeds from this HTML
    // and immediately pushes its real JSON back up on mount.
    setDocJson({ type: "doc", content: [] });
  };

  const regenFromForm = () => {
    if (!window.confirm("Discard your edits and regenerate the doc from the form?")) return;
    setDocJson(null);
    setEditorSeed("");
  };

  // ── narrative (legacy gpComposeNarrative :6196) ──
  async function composeNarrative() {
    if (!getAdminKey()) { notify("No admin key", true); return; }
    setDrafting(true);
    setNarrating(true);
    try {
      const numbers = g.channels.map((ch) => ({
        channel: ch,
        ...(g.mode === "strategy"
          ? computeReverse(ch as Channel, g.assumptions[ch as Channel], g.targetBookings)
          : computeChannel(ch as Channel, g.assumptions[ch as Channel])),
      }));
      const r = await api({
        action: "compose_growth_plan",
        mode: g.mode,
        client: { name: client.name, proofLine: client.caseStudy?.proofLine || "", mechanism: client.caseStudy?.mechanism || "" },
        targets: g.targets.map((t) => ({ title: t.title, niche: t.niche, pains: t.pains, angles: t.angles, offer: t.offer })),
        numbers,
        channels: g.channels,
        targetBookings: g.targetBookings,
        nicheSize: g.nicheSize,
        rules,
      });
      setNarrative({ execSummary: r.execSummary || "", targetRationales: r.targetRationales || [], closing: r.closing || "" });
      notify("Narrative drafted");
    } catch (e) {
      notify("Draft failed: " + (e as Error).message, true);
    }
    setDrafting(false);
    setNarrating(false);
  }

  // ── export (legacy gpExportNotion :6422) ──
  function buildBlocks(working: GrowthWorking) {
    // Edited → export exactly what was edited; otherwise build deterministically from the form.
    if (working.docJson != null) return blocksFromEditorDoc(working.docJson as EditorNode);
    return buildGrowthPlanBlocks({
      growth: asPlanState(working),
      client: { name: client?.name, brief: client?.brief },
      includedTools: includedTools(working),
      followups: activeFollowups(working, client),
      channelLabels: CH_LABEL,
    });
  }

  async function exportNotion() {
    if (!getAdminKey()) { notify("No admin key", true); return; }
    if (!client) return;
    savePlan(); // legacy saved before exporting
    setExporting(true);
    notify("Exporting to Notion…");
    try {
      const r = await api({
        action: "export_notion",
        parentId: cfg.settings?.notionParentId,
        title: `Growth Plan — ${client.name} — ${
          g.mode === "sales" ? "Sales" : g.mode === "strategy" ? "Strategy" : "Scaling"
        } — ${new Date().toISOString().slice(0, 10)}`,
        blocks: buildBlocks(g),
      });
      setNotionUrl(r.url || "");
      notify(r.warning ? "⚠️ Exported, but truncated: " + r.warning : "✅ Exported to Notion", !!r.warning);
      if (r.url) window.open(r.url, "_blank");
    } catch (e) {
      notify("Notion export failed: " + (e as Error).message, true);
    }
    setExporting(false);
  }

  const docNode = useMemo(() => <DocContent g={g} client={client} />, [g, client]);

  return (
    <div className="flex flex-col h-full">
      <DocStyles />
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0 flex-wrap">
        {!edited && (
          <Button size="sm" variant="secondary" icon="edit" onClick={enterEdit}>
            Edit doc
          </Button>
        )}
        <Button size="sm" variant="secondary" icon="sparkles" onClick={composeNarrative} disabled={drafting}>
          {drafting ? "Drafting…" : g.narrative ? "Redraft narrative" : "Draft narrative"}
        </Button>
        <div className="flex-1" />
        <Button size="sm" variant="secondary" icon="device-floppy" onClick={() => { savePlan(); notify("Plan saved to client"); }}>
          Save
        </Button>
        <Button size="sm" variant="primary" icon="brand-notion" onClick={exportNotion} disabled={exporting}>
          {exporting ? <Spinner size="sm" /> : "Export to Notion"}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {edited ? (
          <>
            <div className="mb-3 flex items-center gap-2 text-[11px] text-amber bg-[var(--tint-amber)] border border-[var(--tint-amber-ring)] rounded-md px-3 py-2">
              <Icon name="edit" size={14} />
              <span>Editing the doc — select text to format or ask AI. Form changes are paused.</span>
              <button type="button" onClick={regenFromForm} className="ml-auto underline hover:text-text">
                ↺ Regenerate from form
              </button>
            </div>
            <GrowthEditor initialHtml={editorSeed} rules={rules} onChange={setDocJson} />
          </>
        ) : (
          <div className="gp-doc">{docNode}</div>
        )}
      </div>
    </div>
  );
}
