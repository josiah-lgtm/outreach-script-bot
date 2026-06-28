// Admin → Winning Scripts tab. Port of the legacy adminWinning() screen
// (index.html:3859-3909) plus addWinningScript (:3911), deleteWinningScript (:3923),
// extractFrameworkFrom (:3929) and acceptExtracted (:3952).
//
// Paste a script that got replies; the AI reverse-engineers it into a reusable
// framework, which you review and then accept into cfg.frameworks.
//
// Data shape (per the new-app contract):
//   winningScript = { id, name, script, nicheIds? }
//   nicheIds = niche scope; empty/absent = global (works across the board).
// The accepted framework INHERITS the winning script's scope (nicheIds copied over).
//
// extract_framework response (web/src/server/outreach.ts:99-123):
//   { ok: true, name, category, template, rules, analysis }
// api() throws on { ok:false }, so a resolved result is always a successful extraction.

"use client";

import { useState } from "react";
import {
  Button, IconButton, Card, CardBody, Input, Select, Textarea, FormField, Grid2, Icon, Hint,
} from "@/components/ui";
import { useConfigStore } from "@/lib/store/configStore";
import { api } from "@/lib/sync/api";
import { uid } from "@/lib/text-utils";
import { notify } from "@/lib/notify";

const GLOBAL = "global"; // <select> sentinel for "🌐 generic, all niches"

interface WinningScript {
  id: string;
  name?: string;
  script: string;
  nicheIds?: string[];
}

interface Niche {
  id: string;
  name: string;
}

// The AI-extracted framework awaiting approval — the extract_framework payload plus the
// scope (nicheIds) inherited from the winning script it came from.
interface Extracted {
  name: string;
  category: string;
  template: string;
  rules: string;
  analysis?: string;
  nicheIds: string[];
}

export function WinningTab() {
  const winningScripts = (useConfigStore((s) => s.config.winningScripts) ?? []) as WinningScript[];
  const niches = (useConfigStore((s) => s.config.niches) ?? []) as Niche[];

  // Add-script form (legacy #ws-name / #ws-scope / #ws-script).
  const [name, setName] = useState("");
  const [scope, setScope] = useState<string>(GLOBAL); // GLOBAL or a niche id
  const [script, setScript] = useState("");

  // Pending extraction + which script is currently being extracted.
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const nicheName = (id: string) => niches.find((n) => n.id === id)?.name || "unknown niche";

  // Scope label for a winning script (nicheIds → text). Empty = global.
  function scopeLabel(ids?: string[]): string {
    const list = ids || [];
    if (!list.length) return "🌐 Generic (all niches)";
    return list.map(nicheName).join(", ");
  }

  function addScript() {
    const s = script.trim();
    if (!s) {
      notify("Paste the script first", true);
      return;
    }
    const nicheIds = scope === GLOBAL ? [] : [scope];
    useConfigStore.getState().update((cfg) => {
      cfg.winningScripts = cfg.winningScripts || [];
      cfg.winningScripts.push({ id: uid("ws"), name: name.trim(), script: s, nicheIds });
    });
    setName("");
    setScope(GLOBAL);
    setScript("");
    notify("Winning script saved");
  }

  function deleteScript(w: WinningScript) {
    if (!window.confirm("Delete this winning script?")) return;
    useConfigStore.getState().update((cfg) => {
      cfg.winningScripts = (cfg.winningScripts || []).filter((x: WinningScript) => x.id !== w.id);
    });
    notify("Deleted");
  }

  async function extract(w: WinningScript) {
    if (busyId) return;
    setBusyId(w.id);
    try {
      const ctx =
        (w.name ? `This script won in: ${w.name}. ` : "") + `Scope: ${scopeLabel(w.nicheIds)}`;
      const r = await api({ action: "extract_framework", scripts: [w.script], context: ctx });
      setExtracted({
        name: String(r.name || ""),
        category: String(r.category || ""),
        template: String(r.template || ""),
        rules: String(r.rules || ""),
        analysis: r.analysis ? String(r.analysis) : "",
        nicheIds: [...(w.nicheIds || [])], // inherit the winning script's scope
      });
      notify("Framework extracted — review it below");
    } catch (e) {
      notify("Extraction failed: " + ((e as Error)?.message || ""), true);
    } finally {
      setBusyId(null);
    }
  }

  function acceptExtracted() {
    if (!extracted) return;
    const nm = extracted.name.trim();
    const template = extracted.template;
    if (!nm || !template.trim()) {
      notify("Name and template required", true);
      return;
    }
    useConfigStore.getState().update((cfg) => {
      cfg.frameworks = cfg.frameworks || [];
      cfg.frameworks.push({
        id: uid("fw"),
        name: nm,
        category: extracted.category.trim() || "Winning script",
        template,
        rules: extracted.rules.trim(),
        nicheIds: extracted.nicheIds, // scope inherited from the winning script
      });
    });
    setExtracted(null);
    notify("Framework added 🎉");
  }

  return (
    <div className="space-y-5">
      {/* Add a winning script */}
      <Card className="border-accent">
        <CardBody className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-text">
            <Icon name="trophy" />
            Add a winning script
          </div>
          <Hint className="mb-2">
            Paste a script that got replies. Mark it generic (works across the board) or tie it to a
            niche. Then let AI extract the reusable framework behind it.
          </Hint>

          <Grid2>
            <FormField label="Name (what campaign/client it won in)" htmlFor="ws-name">
              <Input
                id="ws-name"
                value={name}
                placeholder="e.g. SaaS audit opener — 12% reply"
                onChange={(e) => setName(e.target.value)}
              />
            </FormField>
            <FormField label="Scope" htmlFor="ws-scope">
              <Select id="ws-scope" value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value={GLOBAL}>🌐 Generic — works across the board</option>
                {niches.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </Grid2>

          <FormField label="The script" htmlFor="ws-script">
            <Textarea
              id="ws-script"
              value={script}
              placeholder="Paste the winning script exactly as it was sent…"
              onChange={(e) => setScript(e.target.value)}
              className="min-h-[110px] font-mono"
            />
          </FormField>

          <div className="flex justify-end">
            <Button variant="mini" size="sm" icon="device-floppy" onClick={addScript}>
              Save winning script
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Saved winning scripts */}
      {winningScripts.length === 0 ? (
        <Hint>No winning scripts saved yet.</Hint>
      ) : (
        <div className="space-y-2">
          {winningScripts.map((w) => (
            <Card key={w.id}>
              <CardBody className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] text-text">
                    <b>{w.name || "Untitled script"}</b>{" "}
                    <span className="text-xs text-subtle">{scopeLabel(w.nicheIds)}</span>
                  </div>
                  <div className="mt-1 text-xs text-subtle truncate max-w-[480px]">
                    {w.script.slice(0, 110)}…
                  </div>
                </div>
                <div className="flex gap-1.5 flex-shrink-0">
                  <Button
                    variant="mini"
                    size="sm"
                    icon="sparkles"
                    loading={busyId === w.id}
                    disabled={!!busyId && busyId !== w.id}
                    onClick={() => extract(w)}
                  >
                    Extract framework
                  </Button>
                  <IconButton
                    icon="trash"
                    label="Delete winning script"
                    size="sm"
                    variant="danger"
                    onClick={() => deleteScript(w)}
                  />
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* Extracted framework review panel */}
      {extracted && (
        <Card selected>
          <CardBody className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-text mb-2">
              <Icon name="wand" />
              Extracted framework — review, edit, approve
            </div>
            {extracted.analysis && (
              <Hint className="mb-2">Why it wins: {extracted.analysis}</Hint>
            )}

            <Grid2>
              <FormField label="Name" htmlFor="ex-name">
                <Input
                  id="ex-name"
                  value={extracted.name}
                  onChange={(e) => setExtracted({ ...extracted, name: e.target.value })}
                />
              </FormField>
              <FormField label="Category" htmlFor="ex-cat">
                <Input
                  id="ex-cat"
                  value={extracted.category}
                  onChange={(e) => setExtracted({ ...extracted, category: e.target.value })}
                />
              </FormField>
            </Grid2>

            <FormField label="Template (with {{variables}})" htmlFor="ex-template">
              <Textarea
                id="ex-template"
                value={extracted.template}
                onChange={(e) => setExtracted({ ...extracted, template: e.target.value })}
                className="min-h-[130px] font-mono"
              />
            </FormField>

            <FormField label="Rules" htmlFor="ex-rules">
              <Textarea
                id="ex-rules"
                value={extracted.rules}
                onChange={(e) => setExtracted({ ...extracted, rules: e.target.value })}
              />
            </FormField>

            <Hint className="mb-2">
              Scope: <b>{scopeLabel(extracted.nicheIds)}</b> (inherited from the winning script —
              change the script&apos;s scope to change this)
            </Hint>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" icon="x" onClick={() => setExtracted(null)}>
                Discard
              </Button>
              <Button variant="mini" size="sm" icon="check" onClick={acceptExtracted}>
                Add to frameworks
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
