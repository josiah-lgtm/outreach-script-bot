// Create-script wizard — the data layer + AI/store actions behind the 6-step wizard and
// swipe deck. Faithful port of legacy index.html: the niche/client data aggregators
// (1403-1418), builderButtons (1420-1431), wizCount/learnExamples/genOnce (7395-7440),
// localRegroup/wizRebucket (7352-7375), buildMechanismCore (7395), osWizGen (7601),
// osWizFilterStep (7480) and the keep-to-reservoir paths (osWizSwipe/osWizKeepAll, 7644).
//
// The legacy app mutated the live `config` object then called persistConfig(); here every
// persisted change goes through useConfigStore.getState().update(recipe) so the single save
// queue + lens refresh stay correct. Ephemeral wizard state (selections, deck, cursor) lives
// in React component state, not here. This module is data/logic only — no JSX.
//
// `any` is permitted here (sync/** lint scope): the config document is dynamically shaped,
// exactly as in the legacy untyped app.

import { api } from "./api";
import { getAdminKey } from "./adminKey";
import { composeLens } from "./systemFilter";
import { refineBatch, notifyFiltered } from "./lens";
import { useConfigStore } from "@/lib/store/configStore";
import { dedupeScripts } from "@/lib/dedupe";
import { parseMechanisms, mechToText, categorizeList, type Group, type Mechanism } from "@/lib/ai-json";
import { uid, nextScriptName } from "@/lib/text-utils";
import { MECHANISM_BUILDER } from "./engines";

export type { Group, Mechanism };

// ─── Types the wizard UI consumes ───────────────────────────────────────────
export type WizFlow = "new" | "angles" | "winning" | "followup";

export interface DeckCard {
  text: string;
  fw: string;
  angle: string;
  _desire?: string;
  _mech?: string;
  _hist?: string[];
  _hi?: number;
  // The persisted deck is dynamically shaped (legacy); the index signature also lets a
  // DeckCard satisfy dedupeScripts' ScriptItem constraint without a cast.
  [k: string]: unknown;
}

export interface BuilderButton {
  id: string;
  label: string;
  icon: string;
  keepStructure?: boolean;
  enabled?: boolean;
  examples?: string;
  prompt: string;
  model?: string;
}

export interface WizState {
  menu: boolean;
  flow: WizFlow | null;
  step: number; // 1..6
  niche: string | null;
  icpId: string | null;
  angles: string[]; // selected pains (max 3)
  desires: string[];
  offers: string[];
  guarantees: string[];
  caseStudies: string[];
  fws: Record<string, boolean>;
  variants: number;
  useP: boolean;
  useD: boolean;
  useM: boolean;
  openGroups: Record<string, boolean>;
  customPains: string[];
  aiPains: string[];
  customDesires: string[];
  customOffers: string[];
  aiOffers: string[];
  foundAngles: string[];
  transNote: string;
  deck: DeckCard[];
  i: number;
  kept: number;
  keptIds: string[];
  phase: "steps" | "swipe";
  generating: boolean;
  genError: string;
  dedupNote: string;
  editing: boolean;
  busy: boolean;
  mechError: string;
}

// ─── Store shortcuts ─────────────────────────────────────────────────────────
const cfg = () => useConfigStore.getState().config as any;
const upd = (recipe: (draft: any) => void) => useConfigStore.getState().update(recipe);
const findClient = (id: string) => (cfg().clients || []).find((c: any) => c.id === id);
const nicheById = (id: string | null | undefined) =>
  (cfg().niches || []).find((n: any) => n.id === id) || null;

// ─── Pure data aggregators (legacy 1403-1418) ────────────────────────────────
export const dedupeStr = (arr: any[]): string[] =>
  Array.from(new Set((arr || []).map((s) => String(s).trim()).filter(Boolean)));

export const primaryNicheId = (c: any): string | null => (c?.nicheIds || [])[0] || null;

const flatT = (c: any, key: string): any[] => (c?.transcripts || []).flatMap((t: any) => t[key] || []);

export const clientPains = (c: any) => dedupeStr([...(c?.caseStudy?.pains || []), ...flatT(c, "pains")]);
export const clientDesires = (c: any) => dedupeStr([...(c?.caseStudy?.desires || []), ...flatT(c, "desires")]);
export const clientOffers = (c: any) => dedupeStr([...(c?.caseStudy?.offers || []), ...flatT(c, "offers")]);
export const clientCaseStudies = (c: any) => dedupeStr(c?.caseStudy?.caseStudies || []);

// Non-mutating read of a niche bucket (for selectors/render).
const bucketOf = (c: any, nid: string | null) => {
  const b = (c?.nicheData || {})[nid as string] || {};
  return { pains: b.pains || [], desires: b.desires || [], offers: b.offers || [] };
};
// Mutating ensure (only inside update recipes) — mirrors legacy nicheBucket.
export function ensureBucket(c: any, nid: string | null) {
  c.nicheData = c.nicheData || {};
  if (!c.nicheData[nid as string]) c.nicheData[nid as string] = { pains: [], desires: [], offers: [] };
  const b = c.nicheData[nid as string];
  b.pains = b.pains || [];
  b.desires = b.desires || [];
  b.offers = b.offers || [];
  return b;
}
const nicheSavedAngles = (c: any, nid: string | null) =>
  (c?.savedAngles || []).filter((a: any) => a && a.text && a.nicheId === nid).map((a: any) => a.text);

export function nichePains(c: any, nid: string | null): string[] {
  if (!nid) return clientPains(c);
  const b = bucketOf(c, nid);
  let a = [...(b.pains || []), ...((nicheById(nid) || {}).angles || []), ...nicheSavedAngles(c, nid)];
  if (nid === primaryNicheId(c)) a = a.concat(clientPains(c));
  return dedupeStr(a);
}
export function nicheDesires(c: any, nid: string | null): string[] {
  if (!nid) return clientDesires(c);
  const b = bucketOf(c, nid);
  let a = [...(b.desires || [])];
  if (nid === primaryNicheId(c)) a = a.concat(clientDesires(c));
  return dedupeStr(a);
}
export function nicheOffers(c: any, nid: string | null): string[] {
  if (!nid) return clientOffers(c);
  const b = bucketOf(c, nid);
  let a = [...(b.offers || [])];
  if (nid === primaryNicheId(c)) a = a.concat(clientOffers(c));
  return dedupeStr(a);
}

// ─── Builder buttons (legacy 1420-1431) ──────────────────────────────────────
export function defaultBuilderButtons(): BuilderButton[] {
  return [
    { id: "shorten", label: "Shorten", icon: "ti-arrows-minimize", keepStructure: false, enabled: true, examples: "", prompt: "Make this shorter and more concise — cut filler and repetition, keep the core message and every {{merge_tag}}. Return only the script." },
    { id: "simpler", label: "Simpler", icon: "ti-mood-smile", keepStructure: true, enabled: true, examples: "", prompt: "Make this SIMPLER and easier to understand — clearer wording, shorter phrases, swap long/technical words for plain ones (a 12-year-old reads it easily). No jargon." },
    { id: "conversational", label: "Conversational", icon: "ti-message-circle", keepStructure: true, enabled: true, examples: "", prompt: "Make this more CONVERSATIONAL and human — like a real person talking, warm and natural, with everyday contractions and a relaxed opener. No stiff or robotic phrasing." },
    { id: "salesy", label: "Salesy", icon: "ti-trending-up", keepStructure: true, enabled: true, examples: "", prompt: "Make this more SALESY — more outcome-driven and direct. Emphasise desired outcomes (more revenue, more qualified inquiries, more booked calls, predictable growth), use stronger but truthful claims and specific numbers only if already supported by the offer. Do NOT invent claims or numbers." },
    { id: "softer", label: "Softer", icon: "ti-feather", keepStructure: true, enabled: true, examples: "", prompt: "Make this SOFTER and lower-pressure — less direct, less pushy. Reduce hard claims and aggressive language, soften the ask, make it feel relaxed and no-pressure." },
    { id: "reformat", label: "Reformat", icon: "ti-layout-list", keepStructure: false, enabled: true, examples: "", prompt: "Reformat this into a clean, easy-to-read layout: a short greeting line, the body broken into short readable lines / short paragraphs, and the CTA on its own line at the end. Keep the EXACT wording, message, offer and every {{merge_tag}} — only change spacing and line breaks." },
  ];
}
export function builderButtonsOf(): BuilderButton[] {
  const arr = cfg()?.settings?.builderButtons;
  return Array.isArray(arr) && arr.length ? arr : defaultBuilderButtons();
}

// ─── Variant matrix count (legacy wizCount 7397) ─────────────────────────────
export function wizCount(w: WizState, c: any) {
  const fw = Object.keys(w.fws || {}).filter((k) => w.fws[k]).length;
  const p = w.useP !== false ? Math.max(1, (w.angles || []).length) : 1;
  const d = w.useD !== false ? Math.max(1, (w.desires || []).length) : 1;
  const hasMech = !!(c && ((c.mechanisms || []).some((m: any) => m.id === c.activeMechId) || (c.caseStudy || {}).mechanism));
  const m = w.useM !== false && hasMech ? 1 : 0;
  const v = w.variants || 1;
  return { fw, p, d, m, v, total: fw * p * d * v };
}

// Feed the client's kept/winning/edited scripts in as style exemplars (legacy 7402).
function learnExamples(c: any): string {
  const R = c.scriptReservoir || [];
  const pool: any[] = [];
  R.forEach((s: any) => { if (s.status === "winning") pool.push(s); });
  R.forEach((s: any) => { if (s.status === "testing") pool.push(s); });
  R.forEach((s: any) => { if (s.versions && s.versions.length > 1 && pool.indexOf(s) < 0) pool.push(s); });
  (cfg().winningScripts || []).forEach((s: any) => pool.push({ script: (s && (s.script || s.text)) || s }));
  const exs: string[] = [];
  const seen: Record<string, number> = {};
  for (let i = 0; i < pool.length && exs.length < 4; i++) {
    const t = String((pool[i] && pool[i].script) || "").replace(/\s+/g, " ").trim();
    if (t && !seen[t]) { seen[t] = 1; exs.push(t.slice(0, 300)); }
  }
  return exs.length
    ? "\n\nSTYLE EXAMPLES — scripts we previously kept as winners/testing for this client. Match their voice, structure and phrasing (do NOT copy them verbatim):\n- " + exs.join("\n- ")
    : "";
}

// ─── Local regroup (legacy 7355) — fast, no AI ───────────────────────────────
const rgToks = (s: any): string[] =>
  String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3);

export function localRegroup(groups: Group[], items: string[]): Group[] {
  if (!groups || !groups.length) return groups;
  const present: Record<string, number> = {};
  (items || []).forEach((it) => { present[it] = 1; });
  groups.forEach((g) => { g.items = (g.items || []).filter((it) => present[it]); });
  const grouped: Record<string, number> = {};
  groups.forEach((g) => { (g.items || []).forEach((it) => { grouped[it] = 1; }); });
  const gToks = groups.map((g) => {
    const t: Record<string, number> = {};
    (g.items || []).concat([g.topic || ""]).forEach((it) => { rgToks(it).forEach((w) => { t[w] = (t[w] || 0) + 1; }); });
    return t;
  });
  (items || []).forEach((it) => {
    if (grouped[it]) return;
    const its = rgToks(it);
    let best = -1, bestScore = 0;
    for (let i = 0; i < groups.length; i++) {
      let sc = 0;
      its.forEach((w) => { if (gToks[i][w]) sc += gToks[i][w]; });
      if (sc > bestScore) { bestScore = sc; best = i; }
    }
    if (best >= 0 && bestScore > 0) { groups[best].items.push(it); grouped[it] = 1; }
  });
  return groups;
}

// Re-slot the current step's items into their existing themes (legacy wizRebucket 7369).
function rebucketInDraft(c: any, w: WizState) {
  const ic = (c.icps || []).find((x: any) => x.id === w.icpId);
  const target = ic || c;
  if (target.painGroups && target.painGroups.length) {
    const pitems = dedupeStr(([] as string[]).concat(nichePains(c, w.niche), (ic && ic.pains) || [], w.customPains || [], w.aiPains || []));
    localRegroup(target.painGroups, pitems);
  }
  if (target.desireGroups && target.desireGroups.length) {
    const ditems = dedupeStr(([] as string[]).concat(nicheDesires(c, w.niche), (ic && ic.desires) || [], nicheOffers(c, w.niche), w.customDesires || [], w.aiOffers || []));
    localRegroup(target.desireGroups, ditems);
  }
}

// ─── Manual add (legacy osWizAddPain/Desire 7475) ────────────────────────────
export function addPain(clientId: string, w: WizState, text: string): boolean {
  const v = String(text || "").trim();
  if (!v) return false;
  upd((draft) => {
    const c = draft.clients.find((x: any) => x.id === clientId); if (!c) return;
    c.caseStudy = c.caseStudy || {}; c.caseStudy.pains = c.caseStudy.pains || [];
    if (c.caseStudy.pains.indexOf(v) < 0) c.caseStudy.pains.push(v);
    const nb = ensureBucket(c, w.niche);
    if (nb.pains.indexOf(v) < 0) nb.pains.push(v);
    rebucketInDraft(c, w);
  });
  return true;
}
export function addDesire(clientId: string, w: WizState, text: string): boolean {
  const v = String(text || "").trim();
  if (!v) return false;
  upd((draft) => {
    const c = draft.clients.find((x: any) => x.id === clientId); if (!c) return;
    c.caseStudy = c.caseStudy || {}; c.caseStudy.desires = c.caseStudy.desires || [];
    if (c.caseStudy.desires.indexOf(v) < 0) c.caseStudy.desires.push(v);
    const nb = ensureBucket(c, w.niche);
    if (nb.desires.indexOf(v) < 0) nb.desires.push(v);
    rebucketInDraft(c, w);
  });
  return true;
}

// ─── AI suggest more pains / offers (legacy osWizMorePains/Offers 7476-7479) ──
export async function aiMorePains(clientId: string, w: WizState): Promise<string[]> {
  const c = findClient(clientId); const n = nicheById(w.niche);
  const seed = w.angles || [];
  const prompt = seed.length ? "More pain points closely related to these, going deeper or adjacent: " + seed.join("; ") : "";
  const r: any = await api({
    action: "suggest_angles",
    niche: (n || {}).name || "",
    clientContext: [c.name, c.caseStudy && c.caseStudy.mechanism, c.caseStudy && c.caseStudy.result].filter(Boolean).join(" — "),
    prompt,
  });
  const got: string[] = (r.angles || []).map((t: any) => String(t || "").trim()).filter(Boolean);
  upd((draft) => {
    const cd = draft.clients.find((x: any) => x.id === clientId); if (!cd) return;
    const icp = (cd.icps || []).find((x: any) => x.id === w.icpId);
    cd.caseStudy = cd.caseStudy || {}; cd.caseStudy.pains = cd.caseStudy.pains || [];
    const nb = ensureBucket(cd, w.niche);
    got.forEach((t) => {
      if (cd.caseStudy.pains.indexOf(t) < 0) cd.caseStudy.pains.push(t);
      if (nb.pains.indexOf(t) < 0) nb.pains.push(t);
      if (icp) { icp.pains = icp.pains || []; if (icp.pains.indexOf(t) < 0) icp.pains.push(t); }
    });
    rebucketInDraft(cd, w);
  });
  notifyFiltered();
  return got;
}

export async function aiMoreOffers(clientId: string, w: WizState): Promise<string[]> {
  const c = findClient(clientId);
  const ctx = [
    c.name, (c.caseStudy || {}).mechanism, (c.caseStudy || {}).result, (c.caseStudy || {}).proofLine,
    w.offers && w.offers.length ? "Expand on / find offers related to: " + w.offers.join("; ") : "",
  ].filter(Boolean).join("\n");
  const r: any = await api({ action: "suggest_offers", context: ctx });
  const offs: string[] = (r.offers || [])
    .map((o: any) => (typeof o === "string" ? o : o.name && o.description ? o.name + " — " + o.description : o.name || o.description || ""))
    .filter(Boolean);
  upd((draft) => {
    const cd = draft.clients.find((x: any) => x.id === clientId); if (!cd) return;
    const icp = (cd.icps || []).find((x: any) => x.id === w.icpId);
    cd.caseStudy = cd.caseStudy || {}; cd.caseStudy.offers = cd.caseStudy.offers || [];
    const nb = ensureBucket(cd, w.niche);
    offs.forEach((t) => {
      t = String(t || "").trim(); if (!t) return;
      if (cd.caseStudy.offers.indexOf(t) < 0) cd.caseStudy.offers.push(t);
      if (nb.offers.indexOf(t) < 0) nb.offers.push(t);
      if (icp) { icp.desires = icp.desires || []; if (icp.desires.indexOf(t) < 0) icp.desires.push(t); }
    });
    rebucketInDraft(cd, w);
  });
  notifyFiltered();
  return offs;
}

// ─── AI categorize into themed groups (legacy osWizCategorize* 7484-7485) ─────
export async function categorize(clientId: string, w: WizState, kind: "pain" | "outcome"): Promise<Group[] | null> {
  const c = findClient(clientId);
  const ic = (c.icps || []).find((x: any) => x.id === w.icpId);
  const items = kind === "pain"
    ? dedupeStr(([] as string[]).concat(nichePains(c, w.niche), (ic && ic.pains) || [], w.customPains || [], w.aiPains || []))
    : dedupeStr(([] as string[]).concat(nicheDesires(c, w.niche), (ic && ic.desires) || [], nicheOffers(c, w.niche), w.customDesires || [], w.aiOffers || []));
  if (!items.length) return null;
  const label = kind === "pain" ? "cold-outreach pain points" : "desired outcomes and offers";
  const gs = await categorizeList(items, label, api, uid);
  if (gs) {
    upd((draft) => {
      const cd = draft.clients.find((x: any) => x.id === clientId); if (!cd) return;
      const target = (cd.icps || []).find((x: any) => x.id === w.icpId) || cd;
      if (kind === "pain") target.painGroups = gs; else target.desireGroups = gs;
    });
    notifyFiltered();
  }
  return gs;
}

// More items inside one existing theme (legacy osWizMoreInTopic 7486).
export async function moreInTopic(clientId: string, w: WizState, kind: "pain" | "outcome", gid: string): Promise<number> {
  const c = findClient(clientId); const n = nicheById(w.niche);
  const ic = (c.icps || []).find((x: any) => x.id === w.icpId);
  const target = ic || c;
  const groups = kind === "outcome" ? target.desireGroups || [] : target.painGroups || [];
  const g = groups.find((x: any) => x.id === gid);
  if (!g) return 0;
  const label = kind === "outcome"
    ? "desired outcomes (what they want, plus offers that get them there)"
    : "cold-outreach pain points";
  const r: any = await api({
    action: "suggest_angles",
    niche: (n || {}).name || "",
    clientContext: [c.name, (c.caseStudy || {}).mechanism].filter(Boolean).join(" — "),
    prompt: 'Generate 5-6 more ' + label + ' specifically on this ONE theme: "' + g.topic + '". Stay tightly on this theme; build on these: ' + (g.items || []).slice(0, 6).join("; "),
  });
  const got: string[] = (r.angles || []).map((x: any) => String(x || "").trim()).filter(Boolean);
  upd((draft) => {
    const cd = draft.clients.find((x: any) => x.id === clientId); if (!cd) return;
    const icp = (cd.icps || []).find((x: any) => x.id === w.icpId);
    const tgt = icp || cd;
    const grp = (kind === "outcome" ? tgt.desireGroups || [] : tgt.painGroups || []).find((x: any) => x.id === gid);
    const nb = ensureBucket(cd, w.niche);
    cd.caseStudy = cd.caseStudy || {};
    got.forEach((t) => {
      if (grp && grp.items.indexOf(t) < 0) grp.items.push(t);
      if (kind === "outcome") {
        cd.caseStudy.desires = cd.caseStudy.desires || [];
        if (cd.caseStudy.desires.indexOf(t) < 0) cd.caseStudy.desires.push(t);
        if (nb.desires.indexOf(t) < 0) nb.desires.push(t);
        if (icp) { icp.desires = icp.desires || []; if (icp.desires.indexOf(t) < 0) icp.desires.push(t); }
      } else {
        cd.caseStudy.pains = cd.caseStudy.pains || [];
        if (cd.caseStudy.pains.indexOf(t) < 0) cd.caseStudy.pains.push(t);
        if (nb.pains.indexOf(t) < 0) nb.pains.push(t);
        if (icp) { icp.pains = icp.pains || []; if (icp.pains.indexOf(t) < 0) icp.pains.push(t); }
      }
    });
  });
  notifyFiltered();
  return got.length;
}

// ─── Mechanism builder (legacy buildMechanismCore 7395 / osWizBuildMechanism) ─
export async function buildMechanism(
  clientId: string,
  chosenP: string[] | null,
  chosenD: string[] | null,
): Promise<{ mechs: Mechanism[]; raw: string }> {
  const c = findClient(clientId);
  const n = nicheById(primaryNicheId(c));
  const services = clientOffers(c);
  const allP = dedupeStr(([] as string[]).concat(clientPains(c), chosenP || [])).slice(0, 20);
  const allD = dedupeStr(([] as string[]).concat(clientDesires(c), chosenD || [])).slice(0, 20);
  const cp = chosenP && chosenP.length ? chosenP : clientPains(c).slice(0, 5);
  const cd = chosenD && chosenD.length ? chosenD : clientDesires(c).slice(0, 5);
  const ctx =
    "CLIENT: " + (c.name || "") + (c.meta ? " — " + c.meta : "") +
    (n ? "\nNICHE: " + n.name : "") + (c.website ? "\nWEBSITE: " + c.website : "") +
    "\nSERVICES / OFFERS:\n- " + (services.length ? services.join("\n- ") : "(infer from the niche)") +
    "\nCHOSEN PAINS (connect to these):\n- " + (cp.length ? cp.join("\n- ") : "(infer)") +
    "\nCHOSEN DESIRED OUTCOMES (connect to these):\n- " + (cd.length ? cd.join("\n- ") : "(infer)") +
    "\nALL ICP PAINS:\n- " + (allP.length ? allP.join("\n- ") : "(infer)") +
    "\nALL ICP DESIRES:\n- " + (allD.length ? allD.join("\n- ") : "(infer)");
  const r: any = await api({ action: "refine_script", script: ctx, prompt: MECHANISM_BUILDER });
  const raw = (r && (r.script || r.text || r.result || r.content)) || "";
  const mechs = parseMechanisms(r, uid) || [];
  if (mechs.length) {
    upd((draft) => {
      const cd2 = draft.clients.find((x: any) => x.id === clientId); if (!cd2) return;
      cd2.mechanisms = mechs;
      cd2.caseStudy = cd2.caseStudy || {};
      cd2.activeMechId = mechs[0].id;
      cd2.caseStudy.mechanism = mechToText(mechs[0]);
    });
  }
  return { mechs, raw: String(raw) };
}

// Select which built mechanism is used in scripts (legacy osMechPick 7393).
export function pickMechanism(clientId: string, mechId: string): string {
  let name = "mechanism";
  upd((draft) => {
    const c = draft.clients.find((x: any) => x.id === clientId); if (!c) return;
    const m = (c.mechanisms || []).find((x: any) => x.id === mechId); if (!m) return;
    name = m.name || "mechanism";
    c.activeMechId = mechId;
    c.caseStudy = c.caseStudy || {};
    c.caseStudy.mechanism = mechToText(m);
  });
  return name;
}

export function saveMechanismSummary(clientId: string, text: string) {
  upd((draft) => {
    const c = draft.clients.find((x: any) => x.id === clientId); if (!c) return;
    c.caseStudy = c.caseStudy || {};
    c.caseStudy.mechanism = String(text || "").trim();
  });
}

// ─── System-filter pass over this step's data (legacy osWizFilterStep 7480) ───
export interface FilterStats { changed: number; unchanged: number; failed: number; lastErr: string; total: number; error?: "admin" | "lens" | "empty"; }

export async function runFilterStep(clientId: string, w: WizState, kind: string): Promise<FilterStats> {
  const stats: FilterStats = { changed: 0, unchanged: 0, failed: 0, lastErr: "", total: 0 };
  if (!getAdminKey()) return { ...stats, error: "admin" };
  if (!composeLens()) return { ...stats, error: "lens" };
  const c0 = findClient(clientId); if (!c0) return { ...stats, error: "empty" };
  const ic0 = (c0.icps || []).find((x: any) => x.id === w.icpId);
  const ex = " Use our offer-creation & guarantee knowledge to sharpen it into an outcome-driven offer line.";

  // Each job resolves its array/index against whichever client object it's given (snapshot for
  // reading, draft for writing) — indices stay stable across the await (no other mutation runs).
  type Job = { t: string; extra?: string; apply: (c: any, val: string) => void };
  const jobs: Job[] = [];
  const arrJob = (getArr: (c: any) => any[], extra?: string) => {
    const arr = getArr(c0);
    if (Array.isArray(arr)) arr.forEach((v, i) => { if (typeof v === "string" && v.trim()) jobs.push({ t: v, extra, apply: (c, val) => { const a = getArr(c); if (a) a[i] = val; } }); });
  };
  const objTextJob = (getList: (c: any) => any[], field: string) => {
    const list = getList(c0) || [];
    list.forEach((o: any, i: number) => { if (o && o[field]) jobs.push({ t: o[field], apply: (c, val) => { const l = getList(c); if (l && l[i]) l[i][field] = val; } }); });
  };
  const csPains = (c: any) => { c.caseStudy = c.caseStudy || {}; return (c.caseStudy.pains = c.caseStudy.pains || []); };
  const csDesires = (c: any) => { c.caseStudy = c.caseStudy || {}; return (c.caseStudy.desires = c.caseStudy.desires || []); };
  const csOffers = (c: any) => { c.caseStudy = c.caseStudy || {}; return (c.caseStudy.offers = c.caseStudy.offers || []); };
  const csCases = (c: any) => { c.caseStudy = c.caseStudy || {}; return (c.caseStudy.caseStudies = c.caseStudy.caseStudies || []); };
  const nbPains = (c: any) => ensureBucket(c, w.niche).pains;
  const nbDesires = (c: any) => ensureBucket(c, w.niche).desires;
  const nbOffers = (c: any) => ensureBucket(c, w.niche).offers;
  const icArr = (field: string) => (c: any) => { const ic = (c.icps || []).find((x: any) => x.id === w.icpId); return ic ? (ic[field] = ic[field] || []) : []; };

  if (kind === "pain") {
    arrJob(csPains); arrJob(nbPains);
    objTextJob((c) => (c.savedAngles || []).filter((s: any) => s && s.text), "text");
    if (ic0) arrJob(icArr("pains"));
  } else if (kind === "outcome") {
    arrJob(csDesires, ex); arrJob(csOffers, ex); arrJob(nbDesires, ex); arrJob(nbOffers, ex);
    if (ic0) arrJob(icArr("desires"), ex);
  } else if (kind === "proof") {
    objTextJob((c) => c.guarantees || [], "text");
    arrJob(csCases);
  } else if (kind === "mech") {
    if (c0.caseStudy && c0.caseStudy.mechanism) jobs.push({ t: c0.caseStudy.mechanism, apply: (c, val) => { c.caseStudy = c.caseStudy || {}; c.caseStudy.mechanism = val; } });
  } else if (kind === "icp") {
    if (ic0) {
      if (ic0.description) jobs.push({ t: ic0.description, apply: (c, val) => { const ic = (c.icps || []).find((x: any) => x.id === w.icpId); if (ic) ic.description = val; } });
      arrJob(icArr("pains")); arrJob(icArr("desires"), ex); arrJob(icArr("objections"));
    }
  }
  stats.total = jobs.length;
  if (!jobs.length) return { ...stats, error: "empty" };

  // Group by per-item suffix, rewrite each group in ONE batched call.
  const groups: Record<string, Job[]> = {};
  jobs.forEach((j) => { const k = j.extra || ""; (groups[k] = groups[k] || []).push(j); });
  const results: Array<{ job: Job; val: string }> = [];
  for (const key in groups) {
    const gj = groups[key];
    const prompt =
      "Reframe each line THROUGH our house lens — change the ANGLE and the WORDING so each clearly reflects the lens, not just a word swap. Make each a tighter, more specific single line (up to ~20 words) that reads noticeably different from the original." + (key || "");
    const rb = await refineBatch(gj.map((j) => j.t), prompt);
    gj.forEach((j, idx) => {
      if (!rb.ok[idx]) { stats.failed++; if (!stats.lastErr) stats.lastErr = "couldn’t reach the rewriter"; return; }
      const t = String(rb.items[idx] || "").trim();
      if (!t || t === j.t) { stats.unchanged++; return; }
      stats.changed++;
      results.push({ job: j, val: t });
    });
  }
  if (results.length) {
    upd((draft) => {
      const c = draft.clients.find((x: any) => x.id === clientId); if (!c) return;
      results.forEach(({ job, val }) => job.apply(c, val));
      rebucketInDraft(c, w);
    });
  }
  if (stats.changed) notifyFiltered();
  return stats;
}

// ─── Generation (legacy genOnce 7409 + osWizGen 7601) ────────────────────────
const VARIANT_RULE =
  "\n\nMAKE EACH VARIANT GENUINELY DIFFERENT: vary the opening line, the tone, the structure, which pain/desire you lead with, and the mechanism framing. Do NOT just swap a few words while keeping the same shape — each should read like a distinct angle.";

async function genOnce(c: any, n: any, fws: any[], angles: string[], desire: string | null, mechText: string | null, variants: number, w: WizState): Promise<any[]> {
  const nn = n || {};
  const cs: any = Object.assign({}, c.caseStudy || {});
  cs.pains = nichePains(c, nn.id).slice(0, 30);
  cs.desires = nicheDesires(c, nn.id).slice(0, 30);
  cs.offers = nicheOffers(c, nn.id).slice(0, 30);
  cs.caseStudies = clientCaseStudies(c).slice(0, 20);
  if (mechText != null) cs.mechanism = mechText;
  const fav = c.favorites || { pains: [], desires: [], caseStudies: [], offers: [] };
  if (fav.caseStudies && fav.caseStudies.length) cs.caseStudies = fav.caseStudies;
  if (fav.offers && fav.offers.length) cs.offers = fav.offers;
  const ic = (c.icps || []).find((x: any) => x.id === w.icpId);
  const data: any = await api({
    action: "generate",
    prospect: { fname: "", company: "", url: "", classification: "", customPain: "" },
    client: {
      name: c.name,
      caseStudy: cs,
      emphasis: { pains: fav.pains || [], desires: desire ? [desire] : [], caseStudies: fav.caseStudies || [], offers: fav.offers || [] },
      frameworkOverride: (c.frameworkOverrides || {})[nn.id] || "",
      avoid: c.avoid || [],
      competitorIntel: (c.competitorIntel || []).map((x: any) => (x.name || "") + ": offer=" + (x.offer || "?")).join("\n"),
    },
    niche: { name: nn.name, triggerWords: nn.triggerWords || [] },
    frameworks: fws.map((f) => ({ id: f.id, name: f.name, category: f.category, template: f.template, rules: f.rules })),
    angles,
    variantsPerAngle: variants,
    globalRules: ((cfg().settings && cfg().settings.globalRules) || "") + VARIANT_RULE + learnExamples(c),
    guarantee: w.guarantees && w.guarantees.length ? w.guarantees.join(" ") : "",
    icp: ic ? { title: ic.title, niche: ic.niche, jobTitles: ic.jobTitles || [], locations: ic.locations || [], employeeSize: ic.employeeSize || "", revenue: ic.revenue || "", outboundNotes: ic.outboundNotes || "" } : undefined,
  });
  return data.results || [];
}

// Persist the wizard's hand-picked selections back onto the client/ICP (legacy osWizGen 7603).
export function commitWizardSelections(clientId: string, w: WizState) {
  upd((draft) => {
    const c = draft.clients.find((x: any) => x.id === clientId); if (!c) return;
    c.favorites = c.favorites || { pains: [], desires: [], caseStudies: [], offers: [] };
    c.favorites.offers = (w.offers || []).slice();
    c.favorites.desires = (w.desires || []).slice();
    c.favorites.caseStudies = (w.caseStudies || []).slice();
    const ic = (c.icps || []).find((x: any) => x.id === w.icpId);
    const merge = (arr: string[], items: string[]) => { (items || []).forEach((t) => { t = String(t || "").trim(); if (t && arr.indexOf(t) < 0) arr.push(t); }); };
    c.caseStudy = c.caseStudy || {};
    c.caseStudy.pains = c.caseStudy.pains || []; c.caseStudy.desires = c.caseStudy.desires || []; c.caseStudy.offers = c.caseStudy.offers || [];
    merge(c.caseStudy.pains, w.angles); merge(c.caseStudy.desires, w.desires); merge(c.caseStudy.offers, w.offers);
    const nb = ensureBucket(c, w.niche);
    merge(nb.pains, w.angles); merge(nb.desires, w.desires); merge(nb.offers, w.offers);
    if (ic) { ic.pains = ic.pains || []; ic.desires = ic.desires || []; merge(ic.pains, w.angles); merge(ic.desires, (w.desires || []).concat(w.offers || [])); }
  });
}

// Run the full matrix → near-dup filtered deck (legacy osWizGen 7601). Returns the deck +
// any error / dedupe note; the caller owns the wizard's generating/phase state.
export async function generateDeck(clientId: string, w: WizState): Promise<{ deck: DeckCard[]; genError: string; dedupNote: string }> {
  const c = findClient(clientId);
  const n = nicheById(w.niche);
  if (!getAdminKey()) return { deck: [], genError: "No admin key — open the app with your admin key to generate.", dedupNote: "" };
  const fws = (cfg().frameworks || []).filter((f: any) => w.fws[f.id]);

  const pains = w.useP !== false && w.angles.length ? w.angles.slice() : [w.angles[0] || ((n && n.angles) || [])[0] || "Opener"];
  const desires = w.useD !== false && (w.desires || []).length ? w.desires.slice(0, 4) : [null];
  const activeMech = (c.mechanisms || []).find((m: any) => m.id === c.activeMechId);
  const mechText = activeMech ? mechToText(activeMech) : (c.caseStudy || {}).mechanism || null;
  const mechs = w.useM !== false ? [mechText] : [null];

  let deck: DeckCard[] = [];
  let genError = "";
  try {
    for (let di = 0; di < desires.length; di++) {
      for (let mi = 0; mi < mechs.length; mi++) {
        const results = await genOnce(c, n, fws, pains, desires[di], mechs[mi], w.variants || 1, w);
        (results || []).forEach((r: any) => {
          if (r && r.error) return;
          ((r && r.variants) || []).forEach((v: any) => {
            deck.push({ text: v.script || "", fw: r.framework || "", angle: v.angle || "", _desire: desires[di] || "", _mech: mechs[mi] ? String(mechs[mi]).split(" — ")[0] : "" });
          });
        });
      }
    }
    notifyFiltered();
  } catch (e: any) {
    genError = (e && e.message) || String(e);
  }
  if (!deck.length && !genError) genError = "The generator returned nothing — try again, or pick fewer combinations.";
  const rawN = deck.length;
  deck = dedupeScripts(deck.slice(0, 36), 30);
  const dedupNote = rawN > deck.length ? rawN + " generated → " + deck.length + " kept (near-duplicates filtered)" : "";
  return { deck, genError, dedupNote };
}

// ─── "From a script" variation flow (legacy osWizVariate 7656) ───────────────
export async function variateScript(baseText: string, fw: string, angle: string): Promise<DeckCard[]> {
  const prompts = [
    "Rewrite as a fresh variation — same angle, keep merge tags.",
    "Rewrite with a different angle on the same offer.",
    "Expand the same angle deeper and more specific.",
  ];
  const deck: DeckCard[] = [];
  for (let i = 0; i < prompts.length; i++) {
    try {
      const r: any = await api({ action: "refine_script", script: baseText, prompt: prompts[i] });
      deck.push({ text: (r && r.script) || baseText, fw: fw || "Variation", angle: angle || "" });
    } catch {
      deck.push({ text: baseText, fw: fw || "Variation", angle: angle || "" });
    }
  }
  notifyFiltered();
  return deck;
}

// ─── Angles flow (legacy osWizFindAngles / FindRelated / *FromScript 7660) ────
export async function suggestAngles(clientId: string, nicheId: string | null, prompt: string): Promise<string[]> {
  const c = findClient(clientId); const n = nicheById(nicheId);
  const r: any = await api({
    action: "suggest_angles",
    niche: (n || {}).name || "",
    clientContext: [c.name, (c.caseStudy || {}).mechanism, (c.caseStudy || {}).result].filter(Boolean).join(" — "),
    prompt: prompt || "",
  });
  notifyFiltered();
  return r.angles || [];
}

export function addAngleToNiche(nicheId: string | null, angle: string) {
  upd((draft) => {
    const n = (draft.niches || []).find((x: any) => x.id === nicheId); if (!n) return;
    n.angles = n.angles || [];
    if (n.angles.indexOf(angle) < 0) n.angles.push(angle);
  });
}

// ─── Keep a swipe card → board reservoir (legacy osWizSwipe/KeepAll 7644) ─────
function makeItem(c: any, card: DeckCard): any {
  return {
    id: uid("sr"),
    name: nextScriptName(c),
    script: card.text || "",
    label: (card.fw || "") + " · " + (card.angle || ""),
    framework: card.fw || "Variation",
    angle: card.angle || "",
    nicheId: primaryNicheId(c),
    status: "idea",
    note: "",
    versions: [],
    savedAt: new Date().toISOString().slice(0, 10),
  };
}
export function keepCard(clientId: string, card: DeckCard): string {
  let id = "";
  upd((draft) => {
    const c = draft.clients.find((x: any) => x.id === clientId); if (!c) return;
    c.scriptReservoir = c.scriptReservoir || [];
    const item = makeItem(c, card);
    id = item.id;
    c.scriptReservoir.push(item);
  });
  return id;
}
export function keepCards(clientId: string, cards: DeckCard[]): string[] {
  const ids: string[] = [];
  upd((draft) => {
    const c = draft.clients.find((x: any) => x.id === clientId); if (!c) return;
    c.scriptReservoir = c.scriptReservoir || [];
    cards.forEach((card) => { const item = makeItem(c, card); ids.push(item.id); c.scriptReservoir.push(item); });
  });
  return ids;
}
