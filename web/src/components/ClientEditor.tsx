// ClientEditor — the full client-profile editor, shared by Admin → Clients, the
// client-detail "client" section ("Edit full profile"), and the clients-grid "New
// client" button. Faithful port of legacy adminClients :4050 + saveClient :4630 +
// the AI onboarding flows (scrape / research niche / competitors / ICP builder /
// transcripts / suggest offers). The legacy version used a global `editClient` object
// + DOM `__arr` tag containers; here all editable state lives in React state and the
// SAVE writes through the single config store update() so the CAS save queue stays
// correct. Niche creation persists immediately (it is global config); the rest of the
// profile stays in the draft until Save.

"use client";

import { useMemo, useState } from "react";
import { useConfigStore } from "@/lib/store/configStore";
import { uid } from "@/lib/text-utils";
import { clientPains, clientDesires, clientOffers, clientCaseStudies } from "@/lib/sync/wizard";
import { api } from "@/lib/sync/api";
import { notify } from "@/lib/notify";
import type { Client, Niche } from "@/lib/sync/types";
import {
  Modal, Button, Card, Chip, Icon, Input, Textarea, TagInput, FormField, Grid2, Badge, cn,
} from "@/components/ui";

type Competitor = { name: string; website?: string; offer?: string; mechanism?: string; results?: string; guarantee?: string };
type Transcript = { id: string; title: string; text: string; extractedAt: string; pains: string[]; desires: string[]; angles: string[]; offers: string[] };
type Icp = { id?: string; title?: string; niche?: string; score?: number; jobTitles?: string[]; locations?: string[]; employeeSize?: string; revenue?: string; marketSize?: string; why?: string; outboundNotes?: string; savedAt?: string; [k: string]: unknown };
type SuggestedOffer = string | { name?: string; description?: string };
type Source = { type: string; label: string };

const linesToArr = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const mergeUnique = (arr: string[], items: unknown): string[] => {
  if (!Array.isArray(items)) return arr;
  const next = [...arr];
  items.forEach((v) => { const s = String(v).trim(); if (s && !next.includes(s)) next.push(s); });
  return next;
};

export function ClientEditor({ clientId, onClose }: { clientId: string | "__new__"; onClose: () => void }) {
  const isNew = clientId === "__new__";
  const niches = (useConfigStore((s) => s.config.niches) as Niche[] | undefined) || [];

  // Seed the draft once from the existing client (non-reactive — store changes must not
  // clobber in-progress edits).
  const seed = useMemo(() => {
    const c: Client | undefined = isNew
      ? undefined
      : (useConfigStore.getState().config.clients || []).find((x: Client) => x.id === clientId);
    const cs = (c?.caseStudy as Record<string, unknown>) || {};
    return {
      name: c?.name || "",
      meta: c?.meta || "",
      website: c?.website || "",
      size: (cs.size as string) || "",
      result: (cs.result as string) || "",
      mechanism: (cs.mechanism as string) || "",
      proofLine: (cs.proofLine as string) || "",
      offers: ((cs.offers as string[]) || []).join("\n"),
      caseStudies: ((cs.caseStudies as string[]) || []).join("\n"),
      pains: ((cs.pains as string[]) || []).slice(),
      objections: ((cs.objections as string[]) || []).slice(),
      desires: ((cs.desires as string[]) || []).slice(),
      avoid: ((c?.avoid as string[]) || []).slice(),
      guarantees: ((c?.guarantees as Array<{ text?: string } | string>) || []).map((g) => (typeof g === "string" ? g : g.text || "")).filter(Boolean),
      nicheIds: ((c?.nicheIds as string[]) || []).slice(),
      overrides: { ...((c?.frameworkOverrides as Record<string, string>) || {}) } as Record<string, string>,
      competitorIntel: structuredClone((c?.competitorIntel as Competitor[]) || []),
      transcripts: structuredClone((c?.transcripts as Transcript[]) || []),
      icps: structuredClone((c?.icps as Icp[]) || []),
      sources: { ...((c?.sources as Record<string, Source>) || {}) } as Record<string, Source>,
    };
  }, [clientId, isNew]);

  // Core fields
  const [name, setName] = useState(seed.name);
  const [meta, setMeta] = useState(seed.meta);
  const [website, setWebsite] = useState(seed.website);
  const [size, setSize] = useState(seed.size);
  const [result, setResult] = useState(seed.result);
  const [mechanism, setMechanism] = useState(seed.mechanism);
  const [proofLine, setProofLine] = useState(seed.proofLine);
  const [offers, setOffers] = useState(seed.offers);
  const [caseStudies, setCaseStudies] = useState(seed.caseStudies);
  // Tag editors
  const [pains, setPains] = useState<string[]>(seed.pains);
  const [objections, setObjections] = useState<string[]>(seed.objections);
  const [desires, setDesires] = useState<string[]>(seed.desires);
  const [avoid, setAvoid] = useState<string[]>(seed.avoid);
  const [guarantees, setGuarantees] = useState<string[]>(seed.guarantees);
  // Relations
  const [nicheIds, setNicheIds] = useState<string[]>(seed.nicheIds);
  const [overrides, setOverrides] = useState<Record<string, string>>(seed.overrides);
  const [competitorIntel, setCompetitorIntel] = useState<Competitor[]>(seed.competitorIntel);
  const [candidates, setCandidates] = useState<Competitor[]>([]);
  const [transcripts, setTranscripts] = useState<Transcript[]>(seed.transcripts);
  const [icps, setIcps] = useState<Icp[]>(seed.icps);
  const [icpCandidates, setIcpCandidates] = useState<Icp[]>([]);
  const [suggestedOffers, setSuggestedOffers] = useState<SuggestedOffer[]>([]);
  const sourcesRef = useState<Record<string, Source>>(seed.sources)[0]; // mutable accumulator
  // Inputs / busy
  const [newNiche, setNewNiche] = useState("");
  const [trTitle, setTrTitle] = useState("");
  const [trText, setTrText] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // which AI action is running
  const [status, setStatus] = useState("");

  function recordSrc(items: unknown, type: string, label: string) {
    if (!Array.isArray(items)) return;
    items.forEach((v) => { const t = String(v).trim(); if (t && !sourcesRef[t]) sourcesRef[t] = { type, label }; });
  }

  // — AI onboarding —
  async function scrapeSite() {
    const url = website.trim();
    if (!url) return notify("Enter the client website first", true);
    setBusy("scrape"); setStatus("🔍 Scraping client site + searching for case studies… (~20-40s)");
    try {
      const r = await api({ action: "research_client_site", url });
      if (r.name && !name.trim()) setName(r.name);
      if (r.meta && !meta.trim()) setMeta(r.meta);
      if (r.size && !size.trim()) setSize(r.size);
      if (r.result && !result.trim()) setResult(r.result);
      if (r.mechanism && !mechanism.trim()) setMechanism(r.mechanism);
      if (r.proofLine && !proofLine.trim()) setProofLine(r.proofLine);
      setOffers((o) => mergeUnique(linesToArr(o), r.offers).join("\n"));
      setCaseStudies((o) => mergeUnique(linesToArr(o), r.caseStudies).join("\n"));
      setPains((a) => mergeUnique(a, r.pains));
      setDesires((a) => mergeUnique(a, r.desires));
      setObjections((a) => mergeUnique(a, r.objections));
      const dom = String(r.url || url).replace(/^https?:\/\//, "").replace(/\/.*/, "");
      (["offers", "caseStudies", "pains", "desires", "objections"] as const).forEach((k) => recordSrc(r[k], "site", dom));
      if (r.niche_guess && !newNiche.trim()) setNewNiche(r.niche_guess);
      setStatus(`✅ Pulled from ${r.url || url}: ${r.summary || "data imported"}. Review the fields below, then Save.`);
      notify("Client site scraped");
    } catch (e) { setStatus("⚠️ " + (e as Error).message); notify("Scrape failed: " + (e as Error).message, true); }
    setBusy(null);
  }

  function createOrMergeNiche(nicheName: string, r: { angles?: string[]; triggerWords?: string[] }): string {
    let id = "";
    useConfigStore.getState().update((cfg) => {
      const list: Niche[] = cfg.niches || (cfg.niches = []);
      const existing = list.find((n) => (n.name || "").trim().toLowerCase() === nicheName.toLowerCase());
      if (existing) {
        existing.angles = Array.from(new Set([...(existing.angles || []), ...(r.angles || [])]));
        existing.triggerWords = Array.from(new Set([...(existing.triggerWords || []), ...(r.triggerWords || [])]));
        id = existing.id;
      } else {
        const obj: Niche = { id: uid("niche"), name: nicheName, angles: r.angles || [], triggerWords: r.triggerWords || [] };
        list.push(obj); id = obj.id;
      }
    });
    setNicheIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    return id;
  }

  async function researchNiche() {
    const nm = newNiche.trim();
    if (!nm) return notify("Type the niche first", true);
    setBusy("niche"); setStatus(`🔍 Researching "${nm}" — real web search incl. Reddit/forums… (~30-60s)`);
    try {
      const ctx = [name, mechanism, proofLine].map((s) => s.trim()).filter(Boolean).join(" — ");
      const r = await api({ action: "research_niche", niche: nm, clientContext: ctx });
      createOrMergeNiche(nm, r);
      setPains((a) => mergeUnique(a, r.pains));
      setDesires((a) => mergeUnique(a, r.desires));
      setObjections((a) => mergeUnique(a, r.objections));
      (["pains", "desires", "objections"] as const).forEach((k) => recordSrc(r[k], "research", nm));
      setNewNiche("");
      setStatus(`✅ Niche "${nm}" created: ${(r.angles || []).length} angles, ${(r.triggerWords || []).length} trigger words.`);
      notify("Niche created from research");
    } catch (e) { setStatus("⚠️ " + (e as Error).message); notify("Niche research failed: " + (e as Error).message, true); }
    setBusy(null);
  }

  async function findCompetitors() {
    if (!name.trim() && !website.trim()) return notify("Enter the client name or website first", true);
    setBusy("competitors"); setStatus("🏁 Searching for competitors and their offers… (~30-60s)");
    try {
      const nicheName = (niches.find((n) => n.id === nicheIds[0])?.name) || newNiche.trim();
      const r = await api({ action: "research_competitors", clientName: name.trim(), clientUrl: website.trim(), niche: nicheName });
      setCandidates(r.competitors || []);
      setStatus(`✅ Found ${(r.competitors || []).length} competitors. Click “Track” on the relevant ones.`);
      notify("Competitors found");
    } catch (e) { setStatus("⚠️ " + (e as Error).message); notify("Competitor research failed: " + (e as Error).message, true); }
    setBusy(null);
  }

  function trackCompetitor(x: Competitor) {
    setCompetitorIntel((t) => (t.some((y) => y.name === x.name) ? t : [...t, x]));
  }

  async function suggestOfferPackages() {
    if (!mechanism.trim() && !result.trim()) return notify("Add mechanism and result first", true);
    setBusy("offers");
    try {
      const context = [name, mechanism, result, proofLine, offers, caseStudies].filter((s) => s.trim()).join("\n");
      const r = await api({ action: "suggest_offers", context });
      setSuggestedOffers(r.offers || []);
      notify("Offer suggestions ready");
    } catch (e) { notify("Suggest failed: " + (e as Error).message, true); }
    setBusy(null);
  }

  function addSuggestedOffer(i: number) {
    const o = suggestedOffers[i]; if (o == null) return;
    const text = typeof o === "string" ? o : (o.name && o.description ? `${o.name} — ${o.description}` : o.name || o.description || "");
    if (text) { setOffers((cur) => mergeUnique(linesToArr(cur), [text]).join("\n")); recordSrc([text], "ai", "offer suggestion"); }
    setSuggestedOffers((arr) => arr.filter((_, idx) => idx !== i));
  }

  // — Transcripts —
  function addTranscript() {
    if (!trText.trim()) return notify("Paste the transcript text first", true);
    setTranscripts((l) => [...l, { id: uid("tr"), title: trTitle.trim() || "Untitled", text: trText.trim(), extractedAt: "", pains: [], desires: [], angles: [], offers: [] }]);
    setTrTitle(""); setTrText(""); notify("Transcript saved");
  }
  async function extractTranscript() {
    if (!trText.trim()) return notify("Paste transcript text first", true);
    setBusy("extract"); setStatus("🔍 AI reading transcript (~20s)…");
    try {
      const r = await api({ action: "extract_transcript", text: trText.trim() });
      const tr: Transcript = { id: uid("tr"), title: trTitle.trim() || "Untitled", text: trText.trim(), extractedAt: new Date().toISOString().slice(0, 10), pains: r.pains || [], desires: r.desires || [], angles: r.angles || [], offers: r.offers || [] };
      setTranscripts((l) => [...l, tr]);
      setPains((a) => mergeUnique(a, r.pains));
      setDesires((a) => mergeUnique(a, r.desires));
      setOffers((cur) => mergeUnique(linesToArr(cur), r.offers).join("\n"));
      (["pains", "desires", "offers"] as const).forEach((k) => recordSrc(r[k], "transcript", tr.title));
      setTrTitle(""); setTrText("");
      setStatus(`✅ Extracted: ${(r.pains || []).length} pains, ${(r.desires || []).length} desires, ${(r.angles || []).length} angles, ${(r.offers || []).length} offers — merged into profile.`);
      notify("Transcript extracted and merged");
    } catch (e) { setStatus("⚠️ " + (e as Error).message); notify("Extract failed: " + (e as Error).message, true); }
    setBusy(null);
  }

  // — ICP builder —
  function icpDossier(): string {
    const tags = (a: string[]) => a.join("; ");
    const lines: string[] = [];
    lines.push(`Client: ${name} (${meta})`);
    if (website) lines.push(`Website: ${website}`);
    if (size) lines.push(`Their size: ${size}`);
    if (mechanism) lines.push(`Mechanism (how they deliver results): ${mechanism}`);
    if (result) lines.push(`Headline result: ${result}`);
    if (proofLine) lines.push(`Proof line: ${proofLine}`);
    if (offers.trim()) lines.push(`Offers:\n${offers.trim()}`);
    if (caseStudies.trim()) lines.push(`Case studies:\n${caseStudies.trim()}`);
    if (pains.length) lines.push(`Customer pains they solve: ${tags(pains)}`);
    if (desires.length) lines.push(`Customer desires: ${tags(desires)}`);
    if (objections.length) lines.push(`Common objections: ${tags(objections)}`);
    transcripts.forEach((t) => {
      const bits: string[] = [];
      if ((t.pains || []).length) bits.push(`pains: ${t.pains.join("; ")}`);
      if ((t.desires || []).length) bits.push(`desires: ${t.desires.join("; ")}`);
      if ((t.offers || []).length) bits.push(`offer ideas: ${t.offers.join("; ")}`);
      if (bits.length) lines.push(`From call transcript "${t.title}": ${bits.join(" | ")}`);
    });
    if (competitorIntel.length) lines.push(`Competitors: ${competitorIntel.map((x) => `${x.name} (${x.offer || "?"})`).join("; ")}`);
    const en = nicheIds.map((id) => niches.find((n) => n.id === id)?.name).filter(Boolean);
    if (en.length) lines.push(`Niches already targeted: ${en.join(", ")}`);
    return lines.join("\n");
  }
  async function buildIcp() {
    const dossier = icpDossier();
    if (dossier.length < 80) return notify("Fill in (or scrape) the profile first — the ICP builder needs material to work with", true);
    setBusy("icp"); setStatus("🔍 Analyzing profile + sizing markets via web search… (~30-60s)");
    try {
      const r = await api({ action: "build_icp", context: dossier });
      setIcpCandidates(r.icps || []);
      setStatus(`✅ ${(r.icps || []).length} ICPs proposed. ${r.insights || ""}`);
      notify("ICPs built — review below");
    } catch (e) { setStatus("⚠️ " + (e as Error).message); notify("ICP build failed: " + (e as Error).message, true); }
    setBusy(null);
  }
  const icpCands = icpCandidates.filter((x) => !icps.some((s) => s.title === x.title));
  function saveIcp(cand: Icp) {
    setIcps((l) => [...l, { ...cand, id: uid("icp"), savedAt: new Date().toISOString().slice(0, 10) }]);
    notify("ICP saved to client");
  }
  function deleteIcp(i: number) { setIcps((l) => l.filter((_, idx) => idx !== i)); }
  function prefillNicheFromIcp(icp: Icp) {
    setNewNiche([icp.niche, (icp.jobTitles || [])[0], (icp.locations || [])[0]].filter(Boolean).join(" — "));
    notify("Niche prefilled — hit “Research & create” to build it");
  }

  function toggleNiche(id: string) {
    setNicheIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }
  function setOverride(nid: string, v: string) {
    setOverrides((o) => { const next = { ...o }; if (v.trim()) next[nid] = v; else delete next[nid]; return next; });
  }

  // — Save (load-bearing: preserve reservoir/savedAngles/favorites; prune favorites) —
  function save() {
    if (!name.trim()) return notify("Name required", true);
    const id = isNew ? uid("client") : (clientId as string);
    const existing: Client | undefined = (useConfigStore.getState().config.clients || []).find((c: Client) => c.id === id);
    const obj: Client = {
      id,
      name: name.trim(),
      meta: meta.trim(),
      website: website.trim(),
      nicheIds,
      caseStudy: {
        size: size.trim(), result: result.trim(), mechanism: mechanism.trim(), proofLine: proofLine.trim(),
        offers: linesToArr(offers), caseStudies: linesToArr(caseStudies),
        pains, objections, desires,
      },
      frameworkOverrides: overrides,
      competitorIntel,
      avoid,
      guarantees: guarantees.map((t) => ({ id: uid("g"), text: String(t).trim() })).filter((g) => g.text),
      transcripts,
      sources: sourcesRef,
      icps,
      // structuredClone — existing.* is immer-frozen; the prune loop below mutates favorites.
      scriptReservoir: structuredClone((existing?.scriptReservoir as unknown[]) || []),
      savedAngles: structuredClone((existing?.savedAngles as unknown[]) || []),
      favorites: structuredClone((existing?.favorites as Record<string, string[]>) || { pains: [], desires: [], caseStudies: [], offers: [] }),
    };
    // Prune favorites that no longer exist after the edit.
    const present: Record<string, Set<string>> = {
      pains: new Set(clientPains(obj)), desires: new Set(clientDesires(obj)),
      caseStudies: new Set(clientCaseStudies(obj)), offers: new Set(clientOffers(obj)),
    };
    (["pains", "desires", "caseStudies", "offers"] as const).forEach((k) => {
      obj.favorites[k] = (obj.favorites[k] || []).filter((t: string) => present[k].has(t));
    });
    useConfigStore.getState().update((cfg) => {
      if (!Array.isArray(cfg.clients)) cfg.clients = [];
      if (isNew) cfg.clients.push(obj);
      else cfg.clients = cfg.clients.map((c: Client) => (c.id === id ? obj : c));
    });
    notify("Client saved");
    onClose();
  }

  const sectionTitle = (icon: string, text: string) => (
    <div className="flex items-center gap-1.5 text-[13px] font-semibold mb-2"><Icon name={icon} size={15} /> {text}</div>
  );

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={isNew ? "New client" : `Edit: ${seed.name}`}
      footer={
        <div className="flex items-center gap-2 w-full">
          <Button icon="device-floppy" onClick={save}>Save client</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {status && <span className="text-xs text-muted ml-2 truncate">{status}</span>}
        </div>
      }
    >
      <div className="flex flex-col gap-4 w-full">
        {/* AI onboarding */}
        <Card className="p-3.5 border-accent/40 flex flex-col gap-3">
          {sectionTitle("wand", "AI onboarding — scrape it, don't type it")}
          <FormField label="Client website">
            <div className="flex gap-2">
              <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="myclient.com" className="flex-1" />
              <Button variant="secondary" size="sm" icon="world-search" loading={busy === "scrape"} disabled={!!busy} onClick={scrapeSite}>Scrape site</Button>
              <Button variant="secondary" size="sm" icon="flag" loading={busy === "competitors"} disabled={!!busy} onClick={findCompetitors}>Competitors</Button>
            </div>
          </FormField>
          <FormField label="Create a niche this client targets" hint="Real web search → niche with angles + trigger words, and suggested pains/desires/objections below.">
            <div className="flex gap-2">
              <Input value={newNiche} onChange={(e) => setNewNiche(e.target.value)} placeholder="e.g. medspa owners in Texas" className="flex-1" />
              <Button variant="secondary" size="sm" icon="search" loading={busy === "niche"} disabled={!!busy} onClick={researchNiche}>Research &amp; create</Button>
            </div>
          </FormField>
          {/* Competitors */}
          {(competitorIntel.length > 0 || candidates.length > 0) && (
            <div className="flex flex-col gap-2">
              {competitorIntel.length > 0 && (
                <>
                  <div className="text-xs font-semibold text-muted">Tracked competitor intel ({competitorIntel.length})</div>
                  {competitorIntel.map((x, i) => (
                    <div key={x.name + i} className="flex items-start justify-between gap-2 bg-bg3 rounded-md px-2.5 py-1.5">
                      <div className="min-w-0"><b className="text-[13px]">{x.name}</b> <span className="text-xs text-muted">{x.website || ""}</span>
                        <div className="text-xs text-muted truncate">{x.offer || ""}{x.guarantee ? " · " + x.guarantee : ""}</div></div>
                      <Button variant="ghost" size="sm" onClick={() => setCompetitorIntel((t) => t.filter((_, idx) => idx !== i))}>Remove</Button>
                    </div>
                  ))}
                </>
              )}
              {candidates.filter((x) => !competitorIntel.some((t) => t.name === x.name)).map((x, i) => (
                <div key={x.name + i} className="flex items-start justify-between gap-2 bg-bg3 rounded-md px-2.5 py-1.5">
                  <div className="min-w-0"><b className="text-[13px]">{x.name}</b> <span className="text-xs text-muted">{x.website || ""}</span>
                    <div className="text-xs text-muted truncate">offer: {x.offer || "?"} · {x.results || "?"}</div></div>
                  <Button variant="secondary" size="sm" onClick={() => trackCompetitor(x)}>Track</Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ICP builder */}
        <Card className="p-3.5 border-amber/40 flex flex-col gap-2">
          {sectionTitle("target", "ICP Builder — who should this client target?")}
          <div>
            <Button variant="secondary" size="sm" icon="target" loading={busy === "icp"} disabled={!!busy} onClick={buildIcp}>Build ICPs from this profile</Button>
          </div>
          {icps.length > 0 && <div className="text-xs font-semibold text-muted mt-1">Saved ICPs ({icps.length})</div>}
          {icps.map((icp, i) => <IcpCard key={icp.id || i} icp={icp} saved onResearch={() => prefillNicheFromIcp(icp)} onDelete={() => deleteIcp(i)} />)}
          {icpCands.length > 0 && <div className="text-xs font-semibold text-muted mt-1">Proposed — review and save the keepers</div>}
          {icpCands.map((icp, i) => <IcpCard key={"c" + i} icp={icp} onSave={() => saveIcp(icp)} onResearch={() => prefillNicheFromIcp(icp)} />)}
        </Card>

        {/* Core fields */}
        <Grid2>
          <FormField label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></FormField>
          <FormField label="Meta (shown under name)"><Input value={meta} onChange={(e) => setMeta(e.target.value)} /></FormField>
        </Grid2>
        <FormField label="Niches this client targets (toggle, or create one above)">
          {niches.length === 0 ? (
            <div className="text-xs text-muted">No niches exist yet — create one above.</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {niches.map((n) => <Chip key={n.id} selected={nicheIds.includes(n.id)} onClick={() => toggleNiche(n.id)}>{n.name}</Chip>)}
            </div>
          )}
        </FormField>
        <Grid2>
          <FormField label="Size"><Input value={size} onChange={(e) => setSize(e.target.value)} /></FormField>
          <FormField label="Headline result"><Input value={result} onChange={(e) => setResult(e.target.value)} /></FormField>
        </Grid2>
        <FormField label="Mechanism (how they get results)"><Input value={mechanism} onChange={(e) => setMechanism(e.target.value)} /></FormField>
        <FormField label="Proof line (1 sendable sentence)"><Textarea value={proofLine} onChange={(e) => setProofLine(e.target.value)} /></FormField>

        <FormField label="Niche pains"><TagInput value={pains} onChange={setPains} placeholder="add pain + Enter" /></FormField>
        <FormField label="Common objections"><TagInput value={objections} onChange={setObjections} placeholder="add objection + Enter" /></FormField>
        <FormField label="Prospect desires"><TagInput value={desires} onChange={setDesires} placeholder="add desire + Enter" /></FormField>
        <FormField label="🚫 Do NOT mention — things this client never wants in scripts" hint="Scripts are hard-blocked from using these.">
          <TagInput value={avoid} onChange={setAvoid} placeholder="add exclusion + Enter" />
        </FormField>
        <FormField label="✅ Guarantees / Risk reversals — weave into scripts when selected" hint="Appear as selectable chips in the builder.">
          <TagInput value={guarantees} onChange={setGuarantees} placeholder="add guarantee + Enter" />
        </FormField>

        {/* Offers */}
        <Card className="p-3.5 flex flex-col gap-2">
          {sectionTitle("bulb", "Offers — current offers & AI suggestions")}
          <Grid2>
            <FormField label="Offers (one per line)"><Textarea value={offers} onChange={(e) => setOffers(e.target.value)} className="min-h-[90px]" /></FormField>
            <FormField label="Case studies (one per line)"><Textarea value={caseStudies} onChange={(e) => setCaseStudies(e.target.value)} className="min-h-[90px]" /></FormField>
          </Grid2>
          <div><Button variant="secondary" size="sm" icon="bulb" loading={busy === "offers"} disabled={!!busy} onClick={suggestOfferPackages}>AI suggest offer packages</Button></div>
          {suggestedOffers.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {suggestedOffers.map((o, i) => (
                <div key={i} className="flex items-center justify-between gap-2 bg-bg3 rounded-md px-2.5 py-1.5 text-[12px]">
                  <span className="min-w-0">{typeof o === "string" ? o : <><b>{o.name}</b> — {o.description}</>}</span>
                  <Button variant="secondary" size="sm" onClick={() => addSuggestedOffer(i)}>Add</Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Transcripts */}
        <Card className="p-3.5 flex flex-col gap-2">
          {sectionTitle("file-text", "Call transcripts — paste recordings to extract angles & pains")}
          <Grid2>
            <FormField label="Transcript title"><Input value={trTitle} onChange={(e) => setTrTitle(e.target.value)} placeholder="e.g. Discovery call — June 2026" /></FormField>
            <div className="flex items-end gap-2 pb-1">
              <Button variant="secondary" size="sm" icon="device-floppy" onClick={addTranscript}>Save transcript</Button>
              <Button variant="secondary" size="sm" icon="wand" loading={busy === "extract"} disabled={!!busy} onClick={extractTranscript}>Save &amp; extract</Button>
            </div>
          </Grid2>
          <FormField label="Transcript text"><Textarea value={trText} onChange={(e) => setTrText(e.target.value)} className="min-h-[90px] text-[11px]" placeholder="Paste the full call transcript here…" /></FormField>
          {transcripts.length === 0 ? (
            <div className="text-xs text-muted">No transcripts saved yet.</div>
          ) : transcripts.map((t, i) => (
            <div key={t.id} className="flex items-start justify-between gap-2 bg-bg3 rounded-md px-2.5 py-1.5">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold truncate">{t.title}</div>
                <div className="text-xs text-muted">{t.extractedAt ? "🤖 Extracted " + t.extractedAt : "Not extracted yet"} · ~{Math.round((t.text || "").length / 4)} words</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setTranscripts((l) => l.filter((_, idx) => idx !== i))}>Delete</Button>
            </div>
          ))}
        </Card>

        {/* Per-niche overrides */}
        <FormField label="Framework overrides — this client's own framework/notes per targeted niche">
          {nicheIds.length === 0 ? (
            <div className="text-xs text-muted">Pick at least one niche to add per-niche overrides.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {nicheIds.map((id) => {
                const n = niches.find((x) => x.id === id); if (!n) return null;
                return (
                  <div key={id}>
                    <div className="text-xs text-muted mb-1">{n.name}</div>
                    <Textarea value={overrides[id] || ""} onChange={(e) => setOverride(id, e.target.value)} placeholder={`paste the client's framework/notes for ${n.name}…`} />
                  </div>
                );
              })}
            </div>
          )}
        </FormField>
      </div>
    </Modal>
  );
}

function IcpCard({ icp, saved, onSave, onResearch, onDelete }: {
  icp: Icp; saved?: boolean; onSave?: () => void; onResearch?: () => void; onDelete?: () => void;
}) {
  const score = Number(icp.score) || 0;
  return (
    <Card className={cn("p-3 flex flex-col gap-2", saved && "border-green/40")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">{saved ? "✅ " : ""}{icp.title || "ICP"}</div>
          <div className="text-xs text-muted">{icp.niche || ""}</div>
        </div>
        <Badge tone={score >= 8 ? "green" : "neutral"}>fit {score}/10</Badge>
      </div>
      {(icp.jobTitles || []).length > 0 && (
        <div className="flex flex-wrap gap-1">{(icp.jobTitles || []).map((t) => <Badge key={t} tone="accent">{t}</Badge>)}</div>
      )}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div><b className="text-muted">Locations</b><br />{(icp.locations || []).join(", ") || "—"}</div>
        <div><b className="text-muted">Employee size</b><br />{icp.employeeSize || "—"}{icp.revenue ? " · " + icp.revenue : ""}</div>
      </div>
      {icp.marketSize && <div className="text-xs">📊 <b>Market size:</b> {icp.marketSize}</div>}
      {icp.why && <div className="text-xs"><b>Why this fits:</b> {icp.why}</div>}
      <div className="flex gap-2">
        {saved ? (
          <>
            <Button variant="secondary" size="sm" icon="search" onClick={onResearch}>Research as niche</Button>
            <Button variant="ghost" size="sm" onClick={onDelete}>Remove</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" size="sm" icon="device-floppy" onClick={onSave}>Save ICP</Button>
            <Button variant="secondary" size="sm" icon="search" onClick={onResearch}>Research as niche</Button>
          </>
        )}
      </div>
    </Card>
  );
}
