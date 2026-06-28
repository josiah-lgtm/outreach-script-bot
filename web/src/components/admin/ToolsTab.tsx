// Admin → Tools knowledge base tab. Port of the legacy adminToolsKB() screen
// (index.html:3707-3750) plus its handlers adminEditTool (:3752), saveTool (:3754)
// and deleteTool (:3773). The list cost label mirrors gpToolCostLabel (:5346).
//
// Data shape (read verbatim from DEFAULT_TOOLS_KB in lib/sync/configClient.ts):
//   tool = { id, name, category, channels[], link, costModel, cost, inPerM, outPerM, why }
//   category ∈ TOOL_CATS · costModel ∈ COST_MODELS
//   cost-model conditional (legacy :3735-3741): when costModel === 'tokens' the
//   per-million token fields (inPerM/outPerM) show and the flat Cost ($) field hides;
//   every other model shows Cost ($) and hides the token fields.
//
// Editing is local React state (the open draft, id "__new__" for a new tool). All config
// writes go through useConfigStore.getState().update() so the single save queue stays correct.

"use client";

import { useState } from "react";
import {
  Button, IconButton, Card, CardBody, Chip, Input, Select, Textarea, FormField, Grid2, Icon,
  EmptyState,
} from "@/components/ui";
import { useConfigStore } from "@/lib/store/configStore";
import { uid } from "@/lib/text-utils";
import { notify } from "@/lib/notify";

// Legacy: TOOL_CATS (:3704), COST_MODELS (:3705), CH_LABEL (:4934).
const TOOL_CATS = ["scraping", "verification", "sending", "personalization", "reply-agent", "other"];
const COST_MODELS: [string, string][] = [
  ["flat", "$ / month (flat)"],
  ["per_1k_leads", "$ per 1,000 leads"],
  ["per_1k_verified", "$ per 1,000 verified"],
  ["tokens", "per-token (Gemini etc.)"],
];
const CH_LABEL: Record<string, string> = { email: "📧 Email", linkedin: "🔗 LinkedIn" };
const CHANNELS = ["email", "linkedin"];

interface Tool {
  id: string;
  name: string;
  category: string;
  channels: string[];
  link?: string;
  costModel: string;
  cost?: number;
  inPerM?: number;
  outPerM?: number;
  why?: string;
}

interface Draft {
  id: string; // "__new__" for a new tool
  name: string;
  category: string;
  channels: string[];
  link: string;
  costModel: string;
  cost: number;
  inPerM: number;
  outPerM: number;
  why: string;
}

const NEW_ID = "__new__";

// Port of gpMoney (legacy :4931): rounded, locale-grouped dollars.
const gpMoney = (n: unknown): string => "$" + Math.round(Number(n) || 0).toLocaleString();

// Port of gpToolCostLabel (legacy :5346): the cost summary shown in each list row.
function gpToolCostLabel(t: Tool): string {
  if (t.costModel === "flat") return gpMoney(t.cost) + "/mo";
  if (t.costModel === "per_1k_leads") return gpMoney(t.cost) + " / 1K leads";
  if (t.costModel === "per_1k_verified") return "$" + t.cost + " / 1K verified";
  if (t.costModel === "tokens") return `$${t.inPerM}/1M in · $${t.outPerM}/1M out`;
  return "";
}

export function ToolsTab() {
  const tools = (useConfigStore((s) => s.config.toolsKB) ?? []) as Tool[];

  const [draft, setDraft] = useState<Draft | null>(null);

  function openNew() {
    setDraft({
      id: NEW_ID,
      name: "",
      category: "other",
      channels: [],
      link: "",
      costModel: "flat",
      cost: 0,
      inPerM: 0,
      outPerM: 0,
      why: "",
    });
  }

  function openEdit(t: Tool) {
    setDraft({
      id: t.id,
      name: t.name || "",
      category: t.category || "other",
      channels: [...(t.channels || [])],
      link: t.link || "",
      costModel: t.costModel || "flat",
      cost: Number(t.cost) || 0,
      inPerM: Number(t.inPerM) || 0,
      outPerM: Number(t.outPerM) || 0,
      why: t.why || "",
    });
  }

  function toggleChannel(ch: string) {
    setDraft((d) =>
      d
        ? {
            ...d,
            channels: d.channels.includes(ch)
              ? d.channels.filter((x) => x !== ch)
              : [...d.channels, ch],
          }
        : d,
    );
  }

  function save() {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      notify("Name required", true);
      return;
    }
    const isNew = draft.id === NEW_ID;
    const obj: Tool = {
      id: isNew ? uid("tool") : draft.id,
      name,
      category: draft.category,
      channels: draft.channels,
      link: draft.link.trim(),
      costModel: draft.costModel,
      cost: Number(draft.cost) || 0,
      inPerM: Number(draft.inPerM) || 0,
      outPerM: Number(draft.outPerM) || 0,
      why: draft.why.trim(),
    };
    useConfigStore.getState().update((cfg) => {
      cfg.toolsKB = cfg.toolsKB || [];
      if (isNew) cfg.toolsKB.push(obj);
      else cfg.toolsKB = cfg.toolsKB.map((t: Tool) => (t.id === obj.id ? obj : t));
    });
    setDraft(null);
    notify("Tool saved");
  }

  function del(t: Tool) {
    if (!window.confirm("Delete this tool?")) return;
    useConfigStore.getState().update((cfg) => {
      cfg.toolsKB = (cfg.toolsKB || []).filter((x: Tool) => x.id !== t.id);
    });
    if (draft && draft.id === t.id) setDraft(null);
    notify("Tool deleted");
  }

  const editing = draft && draft.id !== NEW_ID ? draft : null;
  const isTokens = draft?.costModel === "tokens";

  return (
    <div className="space-y-5">
      <div className="info-block">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <Icon name="plug" />
          Tools knowledge base
        </div>
        <p className="mt-1 text-xs text-subtle">
          What we use, why, and the cost. These feed the Growth Plan Builder&apos;s tech-stack and
          cost breakdown automatically.
        </p>
      </div>

      <div className="flex justify-end">
        <Button variant="mini" size="sm" icon="plus" onClick={openNew} disabled={draft?.id === NEW_ID}>
          New tool
        </Button>
      </div>

      {tools.length === 0 && draft?.id !== NEW_ID ? (
        <EmptyState
          icon="plug"
          title="No tools yet"
          description="Add the tools your stack uses so the Growth Plan Builder can price them."
          action={
            <Button variant="mini" size="sm" icon="plus" onClick={openNew}>
              New tool
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {tools.map((t) => {
            const channelLabel = (t.channels || []).join(", ") || "any";
            return (
              <Card key={t.id} selected={editing?.id === t.id}>
                <CardBody className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] text-text">
                      <b>{t.name}</b>{" "}
                      <span className="text-xs text-subtle">
                        {t.category} · {channelLabel} · {gpToolCostLabel(t)}
                      </span>
                    </div>
                    {t.why ? (
                      <div className="mt-1 text-xs text-subtle truncate max-w-[520px]">{t.why}</div>
                    ) : null}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <IconButton icon="edit" label="Edit tool" size="sm" onClick={() => openEdit(t)} />
                    <IconButton
                      icon="trash"
                      label="Delete tool"
                      size="sm"
                      variant="danger"
                      onClick={() => del(t)}
                    />
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {draft && (
        <Card selected>
          <CardBody className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-text mb-2">
              <Icon name={draft.id === NEW_ID ? "plus" : "edit"} />
              {draft.id === NEW_ID ? "New tool" : `Edit: ${draft.name || "tool"}`}
            </div>

            <Grid2>
              <FormField label="Name" htmlFor="et-name">
                <Input
                  id="et-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </FormField>
              <FormField label="Category" htmlFor="et-cat">
                <Select
                  id="et-cat"
                  value={draft.category}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                >
                  {TOOL_CATS.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </Select>
              </FormField>
            </Grid2>

            <FormField label="Channels">
              <div className="flex flex-wrap gap-1.5">
                {CHANNELS.map((ch) => (
                  <Chip
                    key={ch}
                    selected={draft.channels.includes(ch)}
                    onClick={() => toggleChannel(ch)}
                  >
                    {CH_LABEL[ch]}
                  </Chip>
                ))}
              </div>
            </FormField>

            <FormField label="Link" htmlFor="et-link">
              <Input
                id="et-link"
                value={draft.link}
                placeholder="https://"
                onChange={(e) => setDraft({ ...draft, link: e.target.value })}
              />
            </FormField>

            <Grid2>
              <FormField label="Cost model" htmlFor="et-model">
                <Select
                  id="et-model"
                  value={draft.costModel}
                  onChange={(e) => setDraft({ ...draft, costModel: e.target.value })}
                >
                  {COST_MODELS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </FormField>
              {/* Cost-model conditional (legacy :3736): hidden when costModel === 'tokens'. */}
              {!isTokens && (
                <FormField label="Cost ($)" htmlFor="et-cost">
                  <Input
                    id="et-cost"
                    type="number"
                    step="0.01"
                    value={String(draft.cost)}
                    onChange={(e) => setDraft({ ...draft, cost: Number(e.target.value) })}
                  />
                </FormField>
              )}
            </Grid2>

            {/* Cost-model conditional (legacy :3738): per-1M token fields, shown only for 'tokens'. */}
            {isTokens && (
              <Grid2>
                <FormField label="$ / 1M input tokens" htmlFor="et-inperm">
                  <Input
                    id="et-inperm"
                    type="number"
                    step="0.01"
                    value={String(draft.inPerM)}
                    onChange={(e) => setDraft({ ...draft, inPerM: Number(e.target.value) })}
                  />
                </FormField>
                <FormField label="$ / 1M output tokens" htmlFor="et-outperm">
                  <Input
                    id="et-outperm"
                    type="number"
                    step="0.01"
                    value={String(draft.outPerM)}
                    onChange={(e) => setDraft({ ...draft, outPerM: Number(e.target.value) })}
                  />
                </FormField>
              </Grid2>
            )}

            <FormField label="Why we use it" htmlFor="et-why">
              <Textarea
                id="et-why"
                value={draft.why}
                onChange={(e) => setDraft({ ...draft, why: e.target.value })}
              />
            </FormField>

            <div className="flex justify-end gap-2 mt-2.5">
              <Button variant="ghost" size="sm" icon="x" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button variant="mini" size="sm" icon="device-floppy" onClick={save}>
                Save tool
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
