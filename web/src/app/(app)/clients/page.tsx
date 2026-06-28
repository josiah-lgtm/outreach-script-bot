// Clients screen. The searchable/filterable client grid — legacy v9List :7197 / v9Card
// :7164 / v9Match :7186 / osBulk* :7676. Cards are real <Link>s into the client detail
// (native cmd/ctrl/middle-click new-tab) UNLESS select mode is on, when a click toggles
// selection (legacy osCardClick :7671). Filters are AND-wise with search; bulk ops route
// through the one config store update() so the CAS save queue stays correct.

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useConfigStore } from "@/lib/store/configStore";
import { useUiStore, STAGES } from "@/lib/store/uiStore";
import { primaryNicheId } from "@/lib/sync/wizard";
import type { Client, Niche } from "@/lib/sync/types";
import { Avatar, Badge, Button, Card, Chip, Icon, Input, StageBadge, EmptyState, cn } from "@/components/ui";
import { ClientEditor } from "@/components/ClientEditor";
import { notify } from "@/lib/notify";

function nicheNames(client: Client, niches: Niche[]): string[] {
  const byId = new Map(niches.map((n) => [n.id, n.name]));
  return (client.nicheIds || []).map((id: string) => byId.get(id)).filter(Boolean) as string[];
}

// v9Match :7186 — facet filters (primary niche / csm / stage / tag), then substring search.
function matches(c: Client, q: string, f: { niche: string; csm: string; stage: string; tag: string }): boolean {
  if (f.niche !== "All" && primaryNicheId(c) !== f.niche) return false;
  if (f.csm !== "All" && (c.csm || "") !== f.csm) return false;
  if (f.stage !== "All" && (c.stage || "") !== f.stage) return false;
  if (f.tag !== "All" && (c.tags || []).indexOf(f.tag) < 0) return false;
  if (q) {
    const hay = ((c.name || "") + " " + (c.contact || "") + " " + (c.meta || "")).toLowerCase();
    if (!hay.includes(q.toLowerCase())) return false;
  }
  return true;
}

// uniqVals :7195 — distinct non-empty values across all clients for a getter.
function uniqVals(clients: Client[], get: (c: Client) => string | string[] | undefined): string[] {
  const o: Record<string, 1> = {};
  clients.forEach((c) => {
    const v = get(c);
    (Array.isArray(v) ? v : [v]).forEach((x) => { if (x) o[x] = 1; });
  });
  return Object.keys(o);
}

export default function ClientsPage() {
  const clientsRaw = useConfigStore((s) => s.config.clients) as Client[] | undefined;
  const nichesRaw = useConfigStore((s) => s.config.niches) as Niche[] | undefined;
  const clients = useMemo(() => clientsRaw || [], [clientsRaw]);
  const niches = useMemo(() => nichesRaw || [], [nichesRaw]);

  const search = useUiStore((s) => s.search);
  const setSearch = useUiStore((s) => s.setSearch);
  const filterNiche = useUiStore((s) => s.filterNiche);
  const filterCsm = useUiStore((s) => s.filterCsm);
  const filterTag = useUiStore((s) => s.filterTag);
  const filterStage = useUiStore((s) => s.filterStage);
  const filterOpen = useUiStore((s) => s.filterOpen);
  const setFilter = useUiStore((s) => s.setFilter);
  const toggleFilterOpen = useUiStore((s) => s.toggleFilterOpen);
  const resetFilters = useUiStore((s) => s.resetFilters);
  const selectMode = useUiStore((s) => s.selectMode);
  const selected = useUiStore((s) => s.selected);
  const toggleSelectMode = useUiStore((s) => s.toggleSelectMode);
  const toggleSelected = useUiStore((s) => s.toggleSelected);
  const selectAllShown = useUiStore((s) => s.selectAllShown);
  const clearSelected = useUiStore((s) => s.clearSelected);

  const shown = useMemo(
    () => clients.filter((c) => matches(c, search, { niche: filterNiche, csm: filterCsm, stage: filterStage, tag: filterTag })),
    [clients, search, filterNiche, filterCsm, filterStage, filterTag],
  );

  const tags = useMemo(() => uniqVals(clients, (c) => c.tags), [clients]);
  const csms = useMemo(() => uniqVals(clients, (c) => c.csm), [clients]);
  const allStages = useMemo(
    () => [...STAGES, ...uniqVals(clients, (c) => c.stage).filter((s) => !STAGES.includes(s as (typeof STAGES)[number]))],
    [clients],
  );

  const fcount = [filterNiche, filterCsm, filterTag, filterStage].filter((v) => v !== "All").length;
  const allClear = fcount === 0;
  const selectedIds = Object.keys(selected);
  const nSel = selectedIds.length;

  const quickAll = () => { resetFilters(); }; // osQuickAll :7667 — clears all facets + search

  // osBulk* :7676 — each mutates the selected clients through the single store update().
  function bulkEach(fn: (c: Client) => void) {
    useConfigStore.getState().update((cfg) => {
      (cfg.clients || []).forEach((c: Client) => { if (selected[c.id]) fn(c); });
    });
  }
  const bulkStage = (s: string) => { bulkEach((c) => { c.stage = s; }); notify(`Stage set on ${nSel}`); };
  const [csmInput, setCsmInput] = useState("");
  const [tagInput, setTagInput] = useState("");
  // Open ClientEditor for "__new__" (add) — edit-by-id is reached from the client detail.
  const [editorFor, setEditorFor] = useState<string | null>(null);
  const bulkCsm = () => {
    const v = csmInput.trim(); if (!v) return;
    bulkEach((c) => { c.csm = v; }); setCsmInput(""); notify(`CSM assigned to ${nSel}`);
  };
  const bulkTag = () => {
    const v = tagInput.trim(); if (!v) return;
    bulkEach((c) => { if (!Array.isArray(c.tags)) c.tags = []; if (c.tags.indexOf(v) < 0) c.tags.push(v); });
    setTagInput(""); notify(`Tag added to ${nSel}`);
  };
  function bulkDelete() {
    if (!nSel) { notify("Select clients first", true); return; }
    const names = selectedIds.map((id) => clients.find((c) => c.id === id)?.name).filter(Boolean);
    if (!confirm(`Delete ${nSel} client${nSel > 1 ? "s" : ""}?\n\n${names.join(", ")}\n\nThis removes them and their scripts, ICPs and follow-ups. This cannot be undone.`)) return;
    useConfigStore.getState().update((cfg) => {
      cfg.clients = (cfg.clients || []).filter((c: Client) => !selected[c.id]);
    });
    clearSelected();
    if (selectMode) toggleSelectMode();
    notify(`${nSel} client${nSel > 1 ? "s" : ""} deleted`);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1100px] mx-auto px-6 py-6">
        <div className="flex items-start justify-between mb-4 gap-3">
          <div>
            <h1 className="text-lg font-semibold">Clients</h1>
            <p className="text-[13px] text-muted">All clients · filter by stage or tag below</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" icon="adjustments-horizontal" onClick={toggleFilterOpen}>
              Filter{fcount ? ` (${fcount})` : ""}
            </Button>
            <Button variant="secondary" size="sm" icon="checkbox" onClick={toggleSelectMode}>
              {selectMode ? "Done" : "Select"}
            </Button>
            <Button size="sm" icon="plus" onClick={() => setEditorFor("__new__")}>New client</Button>
          </div>
        </div>

        {editorFor && <ClientEditor clientId={editorFor} onClose={() => setEditorFor(null)} />}

        {/* Search */}
        <div className="flex items-center gap-2 bg-bg2 border border-border rounded-[9px] px-3 py-2.5 mb-3 max-w-[480px]">
          <Icon name="search" size={16} className="text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients by name or contact…"
            className="flex-1 bg-transparent outline-none text-[14px] text-text placeholder:text-muted"
            autoComplete="off"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-muted hover:text-text cursor-pointer" aria-label="Clear search">
              <Icon name="x" size={16} />
            </button>
          )}
        </div>

        {/* Quick-filter bar: All + stages + tag chips (legacy v9-quickbar :7204) */}
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <Chip selected={allClear} onClick={quickAll}>All</Chip>
          {STAGES.map((s) => (
            <Chip key={s} selected={filterStage === s} onClick={() => setFilter("filterStage", filterStage === s ? "All" : s)}>{s}</Chip>
          ))}
          {tags.length > 0 && <span className="w-px h-5 bg-border mx-1" />}
          {tags.map((t) => (
            <Chip key={t} selected={filterTag === t} tone="accent" onClick={() => setFilter("filterTag", filterTag === t ? "All" : t)}>{t}</Chip>
          ))}
        </div>

        {/* Expandable filter panel */}
        {filterOpen && (
          <Card className="p-3.5 mb-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="text-[13px] font-semibold">Filters</div>
              <Button variant="ghost" size="sm" onClick={quickAll}>Clear all</Button>
            </div>
            <FilterRow label="Niche" value={filterNiche} onPick={(v) => setFilter("filterNiche", v)}
              options={niches.map((n) => ({ value: n.id, label: n.name }))} />
            <FilterRow label="CSM" value={filterCsm} onPick={(v) => setFilter("filterCsm", v)}
              options={csms.map((c) => ({ value: c, label: c }))} />
            <FilterRow label="Tag" value={filterTag} onPick={(v) => setFilter("filterTag", v)}
              options={tags.map((t) => ({ value: t, label: t }))} />
            <FilterRow label="Stage" value={filterStage} onPick={(v) => setFilter("filterStage", v)}
              options={allStages.map((s) => ({ value: s, label: s }))} />
          </Card>
        )}

        {/* Bulk bar */}
        {selectMode && (
          <Card className="p-3.5 mb-4 flex flex-col gap-3 border-accent/40">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <b className="text-[14px]">{nSel} selected</b>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => selectAllShown(shown.map((c) => c.id))}>Select all</Button>
                <Button variant="secondary" size="sm" onClick={clearSelected}>Clear</Button>
                <Button variant="danger" size="sm" icon="trash" onClick={bulkDelete} disabled={!nSel}>
                  Delete{nSel ? ` (${nSel})` : ""}
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-muted w-12">Stage</span>
              {STAGES.map((s) => (
                <Chip key={s} onClick={() => { if (nSel) bulkStage(s); }} className={!nSel ? "opacity-40 pointer-events-none" : ""}>{s}</Chip>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted w-12">CSM</span>
              <Input value={csmInput} onChange={(e) => setCsmInput(e.target.value)} placeholder="Name" className="w-32" />
              <Button variant="secondary" size="sm" onClick={bulkCsm} disabled={!nSel || !csmInput.trim()}>Assign</Button>
              <span className="text-xs text-muted ml-3">Tag</span>
              <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="Tag" className="w-28" />
              <Button variant="secondary" size="sm" onClick={bulkTag} disabled={!nSel || !tagInput.trim()}>Add</Button>
            </div>
          </Card>
        )}

        {/* Grid / empties (3-way copy — legacy v9List :7215) */}
        {shown.length === 0 ? (
          clients.length === 0 ? (
            <EmptyState icon="inbox" title="No clients yet" description="Add one to get started." />
          ) : (
            <EmptyState
              icon="search"
              title="No clients match"
              description={search ? `Nothing matches “${search}”.` : "No clients match these filters."}
            />
          )
        ) : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
            {shown.map((c) => (
              <ClientCard
                key={c.id}
                client={c}
                niches={niches}
                selectMode={selectMode}
                selected={!!selected[c.id]}
                onToggle={() => toggleSelected(c.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterRow({ label, value, options, onPick }: {
  label: string; value: string; options: { value: string; label: string }[]; onPick: (v: string) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-xs text-muted w-14 pt-1.5 shrink-0">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        <Chip selected={value === "All"} onClick={() => onPick("All")}>All</Chip>
        {options.map((o) => (
          <Chip key={o.value} selected={value === o.value} onClick={() => onPick(value === o.value ? "All" : o.value)}>{o.label}</Chip>
        ))}
      </div>
    </div>
  );
}

function ClientCard({ client: c, niches, selectMode, selected, onToggle }: {
  client: Client; niches: Niche[]; selectMode: boolean; selected: boolean; onToggle: () => void;
}) {
  const tags = nicheNames(c, niches);
  const scriptCount = (c.scriptReservoir || []).length;
  const icpCount = (c.icps || []).length;
  const planCount = (c.growthPlans || []).length;

  const inner = (
    <>
      <div className="flex items-center gap-2.5">
        {selectMode && (
          <div className={cn("w-[18px] h-[18px] rounded-[5px] border flex items-center justify-center shrink-0",
            selected ? "bg-accent border-accent text-white" : "border-border")}>
            {selected && <Icon name="check" size={12} />}
          </div>
        )}
        <Avatar name={c.name} />
        <div className="min-w-0">
          <div className="font-semibold text-[14px] truncate">{c.name}</div>
          {c.meta && <div className="text-xs text-muted truncate">{c.meta}</div>}
        </div>
        {c.stage && <div className="ml-auto"><StageBadge stage={c.stage} /></div>}
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (<Badge key={t} tone="accent">{t}</Badge>))}
        </div>
      )}

      <div className="flex items-center gap-3.5 text-xs text-muted border-t border-border pt-2 mt-auto">
        <span className="inline-flex items-center gap-1"><Icon name="file-text" size={13} /><b className="text-text font-semibold">{scriptCount}</b> {scriptCount === 1 ? "script" : "scripts"}</span>
        <span className="inline-flex items-center gap-1"><Icon name="target" size={13} /><b className="text-text font-semibold">{icpCount}</b> {icpCount === 1 ? "ICP" : "ICPs"}</span>
        {planCount > 0 && <span className="inline-flex items-center gap-1"><Icon name="trending-up" size={13} /><b className="text-text font-semibold">{planCount}</b> {planCount === 1 ? "plan" : "plans"}</span>}
        {c.csm && <span className="ml-auto truncate" title="CSM">{c.csm}</span>}
      </div>
    </>
  );

  // In select mode, clicking toggles selection (no navigation); native modifier-clicks
  // still open a new tab via the underlying Link only when NOT selecting.
  if (selectMode) {
    return (
      <Card interactive selected={selected} onClick={onToggle} className="p-3.5 flex flex-col gap-2.5 cursor-pointer">
        {inner}
      </Card>
    );
  }
  return (
    <Card as={Link} href={`/client/${c.id}/overview`} interactive className="p-3.5 flex flex-col gap-2.5">
      {inner}
    </Card>
  );
}
