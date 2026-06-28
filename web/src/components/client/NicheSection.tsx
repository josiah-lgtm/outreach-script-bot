// Client-detail "ICP" (niche) section. Faithful port of legacy v9Section niche branch
// :7295 + v9IcpDetail :7236 + v9NicheDetail :7246 + v9AddNiche :7256 and their os* /
// osIcp* / osND* / osAddNiche* handlers. Three sub-views (list / ICP detail / niche
// detail / add) driven by local state; all mutations go through the config store
// update() so the save queue + lens stay correct. Niche creation reuses/merges by name
// (v9CreateNiche :7702).

"use client";

import { useState } from "react";
import { useConfigStore } from "@/lib/store/configStore";
import { uid } from "@/lib/text-utils";
import { api } from "@/lib/sync/api";
import { notify } from "@/lib/notify";
import type { Client, Niche } from "@/lib/sync/types";
import { Button, Card, Badge, Icon, Input, Textarea, EmptyState } from "@/components/ui";

type Icp = { id: string; title?: string; description?: string; niche?: string; score?: number; jobTitles?: string[]; locations?: string[]; employeeSize?: string; revenue?: string; marketSize?: string; why?: string; desires?: string[]; objections?: string[]; [k: string]: unknown };

type View =
  | { kind: "list" }
  | { kind: "icp"; id: string }
  | { kind: "niche"; id: string }
  | { kind: "add" };

export function NicheSection({ client, clientId }: { client: Client; clientId: string }) {
  const niches = (useConfigStore((s) => s.config.niches) as Niche[] | undefined) || [];
  const [view, setView] = useState<View>({ kind: "list" });

  const icps = (client.icps as Icp[] | undefined) || [];
  const nicheIds = (client.nicheIds as string[] | undefined) || [];

  if (view.kind === "icp") {
    const ic = icps.find((x) => x.id === view.id);
    if (ic) return <IcpDetail client={client} clientId={clientId} icp={ic} onBack={() => setView({ kind: "list" })} />;
  }
  if (view.kind === "niche") {
    return <NicheDetail clientId={clientId} nicheId={view.id} onBack={() => setView({ kind: "list" })} />;
  }
  if (view.kind === "add") {
    return <AddNiche client={client} clientId={clientId} onDone={(nid) => setView(nid ? { kind: "niche", id: nid } : { kind: "list" })} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-[14px] font-semibold">Saved ICPs</div>
        <Button variant="secondary" size="sm" icon="plus" onClick={() => setView({ kind: "add" })}>Add ICP / niche</Button>
      </div>
      <div className="text-xs text-muted">Personas saved from the ICP builder. Click one to edit its name, description, desires and objections.</div>
      {icps.length ? (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
          {icps.map((ic) => {
            const d = (ic.description || "").replace(/\s+/g, " ").trim();
            const ds = d ? (d.length > 80 ? d.slice(0, 80) + "…" : d) : ((ic.jobTitles || []).slice(0, 2).join(", ") || "No description yet");
            return (
              <Card key={ic.id} interactive onClick={() => setView({ kind: "icp", id: ic.id })} className="p-3.5 flex flex-col gap-1 cursor-pointer">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-bg3 flex items-center justify-center shrink-0"><Icon name="target" size={18} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-[14px] truncate">{ic.title || "ICP"}</div>
                    <div className="text-xs text-muted truncate">{ds}</div>
                  </div>
                  {ic.score ? <Badge tone={Number(ic.score) >= 8 ? "green" : "neutral"}>fit {ic.score}/10</Badge> : null}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="text-xs text-muted">No saved ICPs yet — build them in “Edit full profile → ICP builder”, or add one below.</div>
      )}

      <div className="text-[13px] font-semibold mt-3">Niches</div>
      <div className="text-xs text-muted">Angles, trigger words and transcripts. Click to open.</div>
      {nicheIds.length ? (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
          {nicheIds.map((id) => {
            const n = niches.find((x) => x.id === id); if (!n) return null;
            return (
              <Card key={id} interactive onClick={() => setView({ kind: "niche", id })} className="p-3.5 flex flex-col gap-1.5 cursor-pointer">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-bg3 flex items-center justify-center shrink-0"><Icon name="crosshair" size={18} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-[14px] truncate">{n.name}</div>
                    <div className="text-xs text-muted">{(n.angles || []).length} angles · {(n.triggerWords || []).length} triggers</div>
                  </div>
                </div>
                {n.tag && <div><Badge tone="accent">{n.tag}</Badge></div>}
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState icon="crosshair" title="No niche linked yet" description="Add an ICP / niche above." />
      )}
    </div>
  );
}

function BackBtn({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <button onClick={onBack} className="inline-flex items-center gap-1.5 text-muted hover:text-text text-[13px] mb-1 cursor-pointer">
      <Icon name="arrow-left" size={15} /> {label}
    </button>
  );
}

// — ICP detail editor (v9IcpDetail :7236) —
function IcpDetail({ client, clientId, icp, onBack }: { client: Client; clientId: string; icp: Icp; onBack: () => void }) {
  // Back-fill desires/objections from the client case study on first open (osIcpOpen :7687).
  const cs = (client.caseStudy as { desires?: string[]; objections?: string[] }) || {};
  const [title, setTitle] = useState(icp.title || "");
  const [description, setDescription] = useState(icp.description || "");
  const [desires, setDesires] = useState<string[]>((icp.desires && icp.desires.length ? icp.desires : (cs.desires || [])).slice());
  const [objections, setObjections] = useState<string[]>((icp.objections && icp.objections.length ? icp.objections : (cs.objections || [])).slice());
  const [newDesire, setNewDesire] = useState("");
  const [newObjection, setNewObjection] = useState("");

  function patch(fn: (ic: Icp) => void) {
    useConfigStore.getState().update((cfg) => {
      const c = (cfg.clients || []).find((x: Client) => x.id === clientId); if (!c) return;
      const ic = (c.icps || []).find((x: Icp) => x.id === icp.id); if (!ic) return;
      fn(ic);
    });
  }
  const saveName = () => { const v = title.trim(); if (v) { patch((ic) => { ic.title = v; }); notify("ICP name saved"); } };
  const saveDesc = () => { patch((ic) => { ic.description = description.trim(); }); notify("Description saved"); };
  const addDesire = () => { const v = newDesire.trim(); if (!v) return; const next = desires.includes(v) ? desires : [...desires, v]; setDesires(next); patch((ic) => { ic.desires = next; }); setNewDesire(""); };
  const delDesire = (i: number) => { const next = desires.filter((_, idx) => idx !== i); setDesires(next); patch((ic) => { ic.desires = next; }); };
  const addObjection = () => { const v = newObjection.trim(); if (!v) return; const next = objections.includes(v) ? objections : [...objections, v]; setObjections(next); patch((ic) => { ic.objections = next; }); setNewObjection(""); };
  const delObjection = (i: number) => { const next = objections.filter((_, idx) => idx !== i); setObjections(next); patch((ic) => { ic.objections = next; }); };

  return (
    <div className="flex flex-col gap-3">
      <BackBtn onBack={onBack} label="ICPs" />
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-bg3 flex items-center justify-center"><Icon name="target" size={22} /></div>
        <div>
          <div className="text-[17px] font-semibold">{icp.title || "ICP"}</div>
          <div className="text-xs text-muted">{icp.niche || ""}{icp.score ? ` · fit ${icp.score}/10` : ""}</div>
        </div>
      </div>
      <Card className="p-3.5 flex flex-col gap-2">
        <div className="text-[13px] font-semibold">Name</div>
        <div className="flex gap-2"><Input value={title} onChange={(e) => setTitle(e.target.value)} className="flex-1" /><Button variant="secondary" size="sm" onClick={saveName}>Save</Button></div>
      </Card>
      <Card className="p-3.5 flex flex-col gap-2">
        <div className="text-[13px] font-semibold">Description</div>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[80px]" placeholder="Describe this ICP — who they are, why they fit, how to approach them…" />
        <div className="flex justify-end"><Button variant="secondary" size="sm" onClick={saveDesc}>Save description</Button></div>
      </Card>
      <Card className="p-3.5 flex flex-col gap-1.5">
        <div className="text-[13px] font-semibold">Profile</div>
        {(icp.jobTitles || []).length > 0 && <div className="flex flex-wrap gap-1 mb-1">{(icp.jobTitles || []).map((t) => <Badge key={t} tone="accent">{t}</Badge>)}</div>}
        <KV label="Employee size" value={`${icp.employeeSize || "—"}${icp.revenue ? " · " + icp.revenue : ""}`} />
        <KV label="Locations" value={(icp.locations || []).join(", ") || "—"} />
        {icp.marketSize && <KV label="Market size" value={icp.marketSize} />}
        {icp.why && <KV label="Why it fits" value={icp.why} />}
      </Card>
      <EditList title="Desires" items={desires} onAdd={addDesire} onDel={delDesire} draft={newDesire} setDraft={setNewDesire} placeholder="Add a desire…" />
      <EditList title="Objections" items={objections} onAdd={addObjection} onDel={delObjection} draft={newObjection} setDraft={setNewObjection} placeholder="Add an objection…" />
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-[13px] py-1 border-b border-border last:border-0">
      <span className="text-muted shrink-0">{label}</span><span className="text-right">{value}</span>
    </div>
  );
}

function EditList({ title, items, onAdd, onDel, draft, setDraft, placeholder }: {
  title: string; items: string[]; onAdd: () => void; onDel: (i: number) => void; draft: string; setDraft: (v: string) => void; placeholder: string;
}) {
  return (
    <Card className="p-3.5 flex flex-col gap-1.5">
      <div className="text-[13px] font-semibold">{title}</div>
      {items.length ? items.map((x, i) => (
        <div key={i} className="flex items-center justify-between gap-2 text-[13px] py-1 border-b border-border last:border-0">
          <span className="inline-flex items-center gap-1.5"><Icon name="point" size={14} className="text-muted" /> {x}</span>
          <Button variant="ghost" size="sm" onClick={() => onDel(i)}>Remove</Button>
        </div>
      )) : <div className="text-xs text-muted">None yet.</div>}
      <div className="flex gap-2 mt-1">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onAdd(); }} placeholder={placeholder} className="flex-1" />
        <Button variant="secondary" size="sm" onClick={onAdd}>Add</Button>
      </div>
    </Card>
  );
}

// — Niche detail (v9NicheDetail :7246) —
function NicheDetail({ clientId, nicheId, onBack }: { clientId: string; nicheId: string; onBack: () => void }) {
  const n = useConfigStore((s) => (s.config.niches || []).find((x: Niche) => x.id === nicheId)) as Niche | undefined;
  const client = useConfigStore((s) => (s.config.clients || []).find((c: Client) => c.id === clientId)) as Client | undefined;
  const [tag, setTag] = useState(n?.tag || "");
  const [newAngle, setNewAngle] = useState("");
  const [newTrig, setNewTrig] = useState("");
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<string[]>([]);

  if (!n) return <div><BackBtn onBack={onBack} label="Niches" /><div className="text-xs text-muted">Niche not found.</div></div>;

  function patch(fn: (nn: Niche) => void) {
    useConfigStore.getState().update((cfg) => {
      const nn = (cfg.niches || []).find((x: Niche) => x.id === nicheId); if (!nn) return;
      fn(nn);
    });
  }
  const angles = (n.angles as string[]) || [];
  const triggers = (n.triggerWords as string[]) || [];
  const transcripts = (n.transcripts as Array<{ at?: string; angles?: string[]; pains?: string[] }>) || [];

  const saveTag = () => { patch((nn) => { nn.tag = tag.trim(); }); notify("Niche tag saved"); };
  const addAngleManual = () => { const v = newAngle.trim(); if (!v) return; patch((nn) => { nn.angles = nn.angles || []; if (!nn.angles.includes(v)) nn.angles.push(v); }); setNewAngle(""); notify("Angle added"); };
  const addTrig = () => { const v = newTrig.trim(); if (!v) return; patch((nn) => { nn.triggerWords = nn.triggerWords || []; if (!nn.triggerWords.includes(v)) nn.triggerWords.push(v); }); setNewTrig(""); };
  const addFound = (i: number) => { const a = found[i]; if (!a) return; patch((nn) => { nn.angles = nn.angles || []; if (!nn.angles.includes(a)) nn.angles.push(a); }); setFound((f) => f.filter((_, idx) => idx !== i)); };

  async function findMore() {
    setBusy(true);
    try {
      const r = await api({ action: "suggest_angles", niche: n!.name, clientContext: [client?.name, ((client?.caseStudy as { mechanism?: string }) || {}).mechanism].filter(Boolean).join(" — "), prompt: "" });
      setFound(r.angles || []);
    } catch { notify("AI failed", true); }
    setBusy(false);
  }
  async function related(a: string) {
    setBusy(true);
    try {
      const r = await api({ action: "suggest_angles", niche: n!.name, clientContext: client?.name || "", prompt: `Find angles closely related to "${a}" — variations and adjacent angles.` });
      setFound(r.angles || []);
    } catch { notify("AI failed", true); }
    setBusy(false);
  }
  async function extract() {
    const t = transcript.trim(); if (!t) { notify("Paste a transcript first", true); return; }
    setBusy(true);
    try {
      const r = await api({ action: "extract_transcript", text: t });
      patch((nn) => {
        nn.angles = nn.angles || []; nn.transcripts = nn.transcripts || [];
        ([] as string[]).concat(r.angles || [], r.pains || []).forEach((a) => { if (!nn.angles.includes(a)) nn.angles.push(a); });
        nn.transcripts.push({ at: new Date().toISOString().slice(0, 10), angles: r.angles || [], pains: r.pains || [], text: t });
      });
      setTranscript(""); notify("Extracted into niche");
    } catch { notify("Extract failed", true); }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <BackBtn onBack={onBack} label="Niches" />
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-bg3 flex items-center justify-center"><Icon name="crosshair" size={22} /></div>
        <div className="flex-1">
          <div className="text-[17px] font-semibold">{n.name}</div>
          <div className="text-xs text-muted">{angles.length} angles · {triggers.length} triggers · {transcripts.length} transcripts</div>
        </div>
        {n.tag && <Badge tone="accent">{n.tag}</Badge>}
      </div>

      <Card className="p-3.5 flex flex-col gap-2">
        <div className="text-[13px] font-semibold">ICP / niche tag</div>
        <div className="flex gap-2"><Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. SaaS, Local business, B2B…" className="flex-1" /><Button variant="secondary" size="sm" onClick={saveTag}>Save</Button></div>
      </Card>

      <Card className="p-3.5 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="text-[13px] font-semibold">Angles / pain points</div>
          <Button variant="secondary" size="sm" icon="sparkles" loading={busy} disabled={busy} onClick={findMore}>Find more (AI)</Button>
        </div>
        <div className="text-xs text-muted">Click a bubble to find related angles.</div>
        <div className="flex flex-wrap gap-1.5">
          {angles.length ? angles.map((a) => (
            <button key={a} onClick={() => related(a)} className="text-[12px] px-2.5 py-1 rounded-full bg-bg3 hover:bg-bg2 border border-border cursor-pointer">{a}</button>
          )) : <span className="text-xs text-muted">None yet.</span>}
        </div>
        {found.length > 0 && (
          <div className="flex flex-col gap-1 mt-1">
            {found.map((a, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-[13px]"><span>{a}</span><Button variant="secondary" size="sm" onClick={() => addFound(i)}>+ Add</Button></div>
            ))}
          </div>
        )}
        <div className="flex gap-2 mt-1">
          <Input value={newAngle} onChange={(e) => setNewAngle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addAngleManual(); }} placeholder="Add an angle / pain…" className="flex-1" />
          <Button variant="secondary" size="sm" onClick={addAngleManual}>Add</Button>
        </div>
      </Card>

      <Card className="p-3.5 flex flex-col gap-2">
        <div className="text-[13px] font-semibold">Trigger words</div>
        <div className="flex flex-wrap gap-1.5">{triggers.length ? triggers.map((t) => <Badge key={t}>{t}</Badge>) : <span className="text-xs text-muted">None</span>}</div>
        <div className="flex gap-2"><Input value={newTrig} onChange={(e) => setNewTrig(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addTrig(); }} placeholder="Add a trigger word…" className="flex-1" /><Button variant="secondary" size="sm" onClick={addTrig}>Add</Button></div>
      </Card>

      <Card className="p-3.5 flex flex-col gap-2">
        <div className="text-[13px] font-semibold">Transcripts</div>
        {transcripts.length ? transcripts.map((t, i) => (
          <div key={i} className="text-[13px] inline-flex items-center gap-1.5"><Icon name="file-text" size={14} className="text-muted" /> {t.at || ""} — {((t.angles || []).length) + ((t.pains || []).length)} extracted</div>
        )) : <div className="text-xs text-muted">None yet.</div>}
        <Textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} className="min-h-[70px]" placeholder="Paste a call transcript — AI extracts pains/angles into this niche" />
        <div className="flex justify-end"><Button variant="secondary" size="sm" icon="wand" loading={busy} disabled={busy} onClick={extract}>Extract</Button></div>
      </Card>
    </div>
  );
}

// — Add ICP / niche (v9AddNiche :7256 + v9CreateNiche :7702) —
function AddNiche({ client, clientId, onDone }: { client: Client; clientId: string; onDone: (nicheId: string | null) => void }) {
  const [nm, setNm] = useState("");
  const [busy, setBusy] = useState(false);

  function createOrMerge(name: string, r: { angles?: string[]; triggerWords?: string[] }): string {
    let id = "";
    useConfigStore.getState().update((cfg) => {
      const list: Niche[] = cfg.niches || (cfg.niches = []);
      const existing = list.find((x) => (x.name || "").trim().toLowerCase() === name.toLowerCase());
      if (existing) {
        existing.angles = Array.from(new Set([...(existing.angles || []), ...(r.angles || [])]));
        existing.triggerWords = Array.from(new Set([...(existing.triggerWords || []), ...(r.triggerWords || [])]));
        id = existing.id;
      } else { const obj: Niche = { id: uid("niche"), name, angles: r.angles || [], triggerWords: r.triggerWords || [] }; list.push(obj); id = obj.id; }
      const c = (cfg.clients || []).find((x: Client) => x.id === clientId);
      if (c) { c.nicheIds = c.nicheIds || []; if (!c.nicheIds.includes(id)) c.nicheIds.push(id); }
    });
    return id;
  }

  async function research() {
    const v = nm.trim(); if (!v) { notify("Type a niche first", true); return; }
    setBusy(true);
    try {
      const cs = (client.caseStudy as { mechanism?: string; result?: string }) || {};
      const ctx = [client.name, cs.mechanism, cs.result].filter(Boolean).join(" — ");
      const r = await api({ action: "research_niche", niche: v, clientContext: ctx });
      const id = createOrMerge(v, r); notify("Niche created"); onDone(id);
    } catch { notify("Research failed", true); setBusy(false); }
  }
  async function fromSite() {
    const website = client.website as string | undefined;
    if (!website) { notify("No client website — add it in Edit profile", true); return; }
    setBusy(true);
    try {
      const r = await api({ action: "research_client_site", url: website });
      const name = nm.trim() || r.niche_guess || "";
      if (!name) { notify("Could not detect a niche — type one", true); setBusy(false); return; }
      const ctx = [client.name, r.mechanism, r.result].filter(Boolean).join(" — ");
      const r2 = await api({ action: "research_niche", niche: name, clientContext: ctx });
      const id = createOrMerge(name, r2); notify("Niche extracted from website: " + name); onDone(id);
    } catch { notify("Website research failed", true); setBusy(false); }
  }
  function manual() {
    const v = nm.trim(); if (!v) { notify("Type a niche name", true); return; }
    const id = createOrMerge(v, {}); onDone(id);
  }

  return (
    <div className="flex flex-col gap-3">
      <BackBtn onBack={() => onDone(null)} label="Cancel" />
      <div className="text-[15px] font-semibold">Add an ICP / niche</div>
      <div className="text-xs text-muted">Research it with the ICP builder, extract it from the client website, or add it manually.</div>
      <Card className="p-3.5 flex flex-col gap-2">
        <div className="text-[13px] font-semibold">Niche name</div>
        <Input value={nm} onChange={(e) => setNm(e.target.value)} placeholder="e.g. Med spas, HVAC contractors, PE-backed SaaS…" />
      </Card>
      <Card className="p-3.5 flex items-center justify-between gap-3">
        <div><div className="text-[13px] font-semibold">ICP builder (research it)</div><div className="text-xs text-muted">AI web-researches the niche → angles + trigger words.</div></div>
        <Button variant="secondary" size="sm" icon="wand" loading={busy} disabled={busy} onClick={research}>Research niche</Button>
      </Card>
      <Card className="p-3.5 flex items-center justify-between gap-3">
        <div><div className="text-[13px] font-semibold">Extract from the client website</div><div className="text-xs text-muted">{(client.website as string) || "No website on file — add it in Edit profile"}</div></div>
        <Button variant="secondary" size="sm" icon="world-search" loading={busy} disabled={busy} onClick={fromSite}>Extract from site</Button>
      </Card>
      <Card className="p-3.5 flex items-center justify-between gap-3">
        <div className="text-[13px] font-semibold">Add manually</div>
        <Button variant="secondary" size="sm" onClick={manual}>Create empty niche</Button>
      </Card>
    </div>
  );
}
