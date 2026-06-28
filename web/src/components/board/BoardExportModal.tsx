// Notion script-board export. Port of legacy index.html:3020-3110 (openBoardExport /
// boardDoExport). Builds one row in the "clients script testing board" Notion database
// with the selected scripts in the page body, via the server's export_notion_db action.
// The block schema ({t,text}) is identical to server/notion.ts's toNotionBlock.

"use client";

import { useState } from "react";
import { Modal, Button, FormField, Input, Select, Grid2 } from "@/components/ui";
import { useConfigStore } from "@/lib/store/configStore";
import { api } from "@/lib/sync/api";
import { notify } from "@/lib/notify";
import type { Client } from "@/lib/sync/types";
import type { BoardScript } from "./types";

const BOARD_STATUS_LABEL: Record<string, string> = { idea: "Test idea", testing: "Testing", winning: "Winner" };

export interface BoardExportModalProps {
  open: boolean;
  onClose: () => void;
  client: Client;
  /** The selected scripts to export. */
  picks: BoardScript[];
  nicheName: string;
  /** Called after a successful export (so the caller can clear the board selection). */
  onExported: () => void;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// The Modal unmounts its children when closed, so ExportForm remounts on each open and
// its lazy useState initializers do the prefill — no effect/setState-in-effect needed.
export function BoardExportModal({ open, onClose, client, picks, nicheName, onExported }: BoardExportModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="📤 Export to Notion board"
      sub={`${picks.length} script${picks.length === 1 ? "" : "s"}`}
      size="md"
    >
      <ExportForm client={client} picks={picks} nicheName={nicheName} onClose={onClose} onExported={onExported} />
    </Modal>
  );
}

function ExportForm({
  client,
  picks,
  nicheName,
  onClose,
  onExported,
}: {
  client: Client;
  picks: BoardScript[];
  nicheName: string;
  onClose: () => void;
  onExported: () => void;
}) {
  const settings = useConfigStore((s) => s.config.settings) as Record<string, unknown> | undefined;

  const [clientName, setClientName] = useState(() => client.name || "");
  const [niche, setNiche] = useState(() => nicheName);
  const [date, setDate] = useState(today);
  const [tests, setTests] = useState(() => String(picks.length));
  const [target, setTarget] = useState(() => {
    const icps = (client.icps as Array<{ title?: string; description?: string }>) || [];
    return (icps[0] && (icps[0].title || icps[0].description)) || nicheName || "";
  });
  const [status, setStatus] = useState(() => {
    const tally: Record<string, number> = {};
    picks.forEach((p) => {
      const st = String(p.status || "idea");
      tally[st] = (tally[st] || 0) + 1;
    });
    return Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0] || "idea";
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ url?: string; warning?: string; error?: string } | null>(null);

  async function doExport() {
    if (!picks.length) return;
    const statusLabel = BOARD_STATUS_LABEL[status] || "Test idea";
    const title = `${clientName} — ${target || niche || "script testing"} (${date})`;
    const blocks: Array<{ t: string; text?: string }> = [
      {
        t: "callout",
        text: `Client: ${clientName}  ·  Niche: ${niche || "—"}  ·  Target: ${target || "—"}  ·  Tests: ${tests}  ·  Status: ${statusLabel}  ·  ${date}`,
      },
    ];
    picks.forEach((s, i) => {
      blocks.push({ t: "h3", text: `${i + 1}. ${s.framework || "Script"}${s.angle ? " · " + s.angle : ""}` });
      blocks.push({
        t: "bullet",
        text: `Status: ${BOARD_STATUS_LABEL[String(s.status)] || s.status || "—"}${s.savedAt ? "  ·  saved " + s.savedAt : ""}`,
      });
      String(s.script || "")
        .split(/\n{2,}/)
        .filter(Boolean)
        .forEach((para) => blocks.push({ t: "paragraph", text: para }));
      if (s.note) blocks.push({ t: "callout", text: `Note: ${s.note}` });
      blocks.push({ t: "divider" });
    });

    setBusy(true);
    setResult(null);
    try {
      const r = await api({
        action: "export_notion_db",
        databaseId: settings?.notionBoardDbId || "",
        databaseName: settings?.notionBoardName || "clients script testing board",
        title,
        fields: { client: clientName, niche, status: statusLabel, target, tests, date },
        blocks,
      });
      setResult({ url: r.url, warning: r.warning });
      notify(r.warning ? "⚠️ Exported, but truncated: " + r.warning : "✅ Exported to Notion board", !!r.warning);
      onExported();
    } catch (e) {
      setResult({ error: (e as Error).message });
      notify("Notion export failed: " + (e as Error).message, true);
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-muted">
        Adds one row to your <b className="text-text">clients script testing board</b> database with these scripts in the page.
      </p>
      <Grid2>
        <FormField label="Client">
          <Input value={clientName} onChange={(e) => setClientName(e.target.value)} />
        </FormField>
        <FormField label="Niche">
          <Input value={niche} onChange={(e) => setNiche(e.target.value)} />
        </FormField>
        <FormField label="Date">
          <Input value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
        <FormField label="# of tests">
          <Input type="number" value={tests} onChange={(e) => setTests(e.target.value)} />
        </FormField>
      </Grid2>
      <FormField label="Who we're targeting">
        <Input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="e.g. Heads of Sales at 50-200 person SaaS"
        />
      </FormField>
      <FormField label="Status">
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="idea">Test idea</option>
          <option value="testing">Testing</option>
          <option value="winning">Winner</option>
        </Select>
      </FormField>

      {result && (
        <div className="text-[12px]">
          {result.error ? (
            <span className="text-red">❌ {result.error}</span>
          ) : (
            <span className="text-muted">
              ✅ Added to Notion —{" "}
              <a href={result.url || "#"} target="_blank" rel="noreferrer" className="text-accent2 hover:underline">
                open ↗
              </a>
              {result.warning ? <span className="text-amber"> ⚠️ {result.warning}</span> : null}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" icon="brand-notion" loading={busy} onClick={doExport}>
          Export to Notion
        </Button>
      </div>
    </div>
  );
}
