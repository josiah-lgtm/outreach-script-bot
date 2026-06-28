// The EPHEMERAL Growth Plan Builder store. Faithful port of the legacy `state.growth`
// object + every `gp*` mutator (legacy/index.html: initGrowth :4953 … gpDeletePlan :6345).
//
// The legacy app kept the working plan on `state.growth` (a mutable global) and the SAVED
// plans on `client.growthPlans` inside the persisted config. This store keeps the same
// split:
//   • the working plan lives HERE (zustand, ephemeral — never persisted directly);
//   • saving / loading / deleting a plan goes through useConfigStore.getState().update()
//     so the single save queue + lens stay correct (gpSavePlan/gpLoadPlan/gpDeletePlan).
//
// Internal `_*` flags (the auto-narrate guard, the winning-script candidate pool, the last
// Notion URL) are kept on the working state but STRIPPED from any snapshot written to the
// config — exactly as the legacy gpSnapshot() did (it only copied the public fields).
//
// `any` is permitted in this directory by the eslint config (the config document is
// dynamically shaped, same as the legacy untyped app). The funnel/notion-block types are
// reused so the working state flows straight into the deterministic math + block builders.

"use client";

import { create } from "zustand";
import { useConfigStore } from "./configStore";
import { uid } from "@/lib/text-utils";
import type { Assumptions, GrowthState as FunnelGrowthState } from "@/lib/funnel-math";
import type { GrowthPlanState, GrowthTarget } from "@/lib/sync/notion-blocks";

// ── small config helpers (mirror legacy gpClient / client / niche / framework) ──
const cfg = (): any => useConfigStore.getState().config as any;
const upd = (recipe: (draft: any) => void) => useConfigStore.getState().update(recipe);
const clientById = (id: string | null | undefined): any =>
  (cfg().clients || []).find((c: any) => c.id === id) || null;
const planDefaults = (): any => cfg().settings?.planDefaults || {};

// ── website helpers (legacy domainOf / logoUrl :5873) ──
export const domainOf = (u: unknown): string =>
  String(u || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").trim();
export const logoUrl = (u: unknown): string => {
  const d = domainOf(u);
  return d ? "https://logo.clearbit.com/" + d : "";
};

// Resolve a typed name (combobox) — exact match first, then unique prefix/contains.
// Verbatim port of legacy findByName (:5358).
export function findByName(list: any[], name: string, key = "name"): any | null {
  const q = String(name || "").trim().toLowerCase();
  if (!q) return null;
  const val = (x: any) => String(x[key] || "").toLowerCase();
  return (
    list.find((x) => val(x) === q) ||
    (list.filter((x) => val(x).startsWith(q)).length === 1 ? list.find((x) => val(x).startsWith(q)) : null) ||
    (list.filter((x) => val(x).includes(q)).length === 1 ? list.find((x) => val(x).includes(q)) : null) ||
    null
  );
}

// ── working-state shapes ──────────────────────────────────────────────────────
export type GrowthMode = "strategy" | "growth" | "sales";

export interface ObservedChannel {
  contacted: number;
  replies: number;
  positive: number;
  booked: number;
}

export interface GrowthToggles {
  replyAgent: boolean;
  pledge: boolean;
  pledgeText: string;
  [k: string]: unknown;
}

export interface WinningScript {
  label?: string;
  text: string;
  note?: string;
}

export interface GrowthSeed {
  nicheName: string;
  angles: string[];
  script: { label: string; text: string; note?: string; status?: string };
}

/** A target carried on the working state — the GrowthTarget the block builder reads,
 *  plus the builder-only `icpId` / `fwId` / per-script `ai` flag the legacy form used. */
export interface WorkingTarget extends GrowthTarget {
  icpId: string;
  niche?: string;
  fwId?: string;
  scripts: Array<{ label: string; text: string; ai?: boolean }>;
}

/** The full ephemeral working plan (legacy `state.growth`). */
export interface GrowthWorking {
  clientId: string | null;
  planId: string | null;
  mode: GrowthMode;
  channels: string[];
  targets: WorkingTarget[];
  assumptions: Assumptions;
  toolIds: string[];
  toggles: GrowthToggles;
  winningScript: WinningScript | null;
  observed: Record<string, ObservedChannel>;
  nicheSize: string;
  targetBookings: number;
  narrative: GrowthPlanState["narrative"];
  followupIds: string[];
  prospectWebsite: string;
  seed?: GrowthSeed | null;
  /** Tiptap/ProseMirror JSON once the doc is hand-edited (null = live preview is source). */
  docJson: unknown | null;
  // internal, never persisted:
  _winPool?: Array<{ label: string; text: string; note?: string; status?: string }>;
  _notionUrl?: string;
  _narrating?: boolean;
  _narrated?: boolean;
}

// A saved plan snapshot (legacy client.growthPlans[] element). Loose by nature.
export interface SavedPlan {
  id: string;
  mode: GrowthMode;
  title: string;
  channels: string[];
  [k: string]: unknown;
}

// ── default builders ────────────────────────────────────────────────────────────
function freshAssumptions(): Assumptions {
  const pd = planDefaults();
  return {
    email: { ...(pd.email || {}) },
    linkedin: { ...(pd.linkedin || {}) },
    personalization: { ...(pd.personalization || {}) },
  };
}

function freshObserved(): Record<string, ObservedChannel> {
  return {
    email: { contacted: 0, replies: 0, positive: 0, booked: 0 },
    linkedin: { contacted: 0, replies: 0, positive: 0, booked: 0 },
  };
}

// Default tool selection: every tool that isn't the reply-agent and serves a chosen
// channel (legacy gpResetToolDefaults :4970).
function defaultToolIds(channels: string[]): string[] {
  return (cfg().toolsKB || [])
    .filter((t: any) => t.category !== "reply-agent" && (t.channels || []).some((ch: string) => channels.includes(ch)))
    .map((t: any) => t.id);
}

function buildInitial(clientId: string | null, mode: GrowthMode): GrowthWorking {
  const c = clientById(clientId) || (cfg().clients || [])[0] || null;
  const channels = ["email"];
  return {
    clientId: c?.id || null,
    planId: null,
    mode,
    channels,
    targets: [],
    assumptions: freshAssumptions(),
    toolIds: defaultToolIds(channels),
    toggles: { replyAgent: false, pledge: false, pledgeText: (c?.guarantees?.[0]?.text) || "" },
    winningScript: null,
    observed: freshObserved(),
    nicheSize: "",
    targetBookings: 10,
    narrative: null,
    followupIds: [],
    prospectWebsite: "",
    seed: null,
    docJson: null,
  };
}

// ── derived pools (legacy clientAnglePool / clientScriptPool :4939-4951) ──────────
const dedupeStr = (arr: any[]): string[] =>
  Array.from(new Set((arr || []).map((s) => String(s).trim()).filter(Boolean)));

export function clientAnglePool(c: any): string[] {
  const fromNiches = (c?.nicheIds || []).flatMap((id: string) =>
    ((cfg().niches || []).find((n: any) => n.id === id)?.angles) || [],
  );
  const fromTranscripts = (c?.transcripts || []).flatMap((t: any) => t.angles || []);
  const custom = (c?.savedAngles || []).map((x: any) => x.text);
  return dedupeStr([...fromNiches, ...fromTranscripts, ...custom]);
}

export interface PoolScript {
  label: string;
  text: string;
  status: string;
  note: string;
}
export function clientScriptPool(c: any): PoolScript[] {
  const res = (c?.scriptReservoir || []).map((s: any) => ({
    label: `${s.framework} · ${s.angle}`,
    text: s.script,
    status: s.status || "idea",
    note: s.note || "",
  }));
  const win = (cfg().winningScripts || [])
    .filter((w: any) => !w.scope || w.scope === "global" || (c?.nicheIds || []).includes(w.scope))
    .map((w: any) => ({ label: w.name || "Winning script", text: w.script, status: "winning", note: "" }));
  return [...res, ...win].filter((s: any) => s.text);
}

// Tools that aren't the reply-agent and serve a chosen channel (legacy gpToolsForm filter).
export function selectableTools(channels: string[]): any[] {
  return (cfg().toolsKB || []).filter(
    (t: any) => t.category !== "reply-agent" && (t.channels || []).some((ch: string) => channels.includes(ch)),
  );
}

// Resolved tools for cost/export — selected + (when on) the reply agent (legacy gpIncludedTools).
export function includedTools(g: GrowthWorking): any[] {
  const ids = new Set(g.toolIds);
  if (g.toggles.replyAgent) {
    const ra = (cfg().toolsKB || []).find((t: any) => t.category === "reply-agent");
    if (ra) ids.add(ra.id);
  }
  return (cfg().toolsKB || []).filter((t: any) => ids.has(t.id));
}

// The follow-up sequences attached to the plan, resolved against the client (gpActiveFollowups).
export function activeFollowups(g: GrowthWorking, c: any): any[] {
  return (g.followupIds || []).map((id) => (c?.followups || []).find((s: any) => s.id === id)).filter(Boolean);
}

// ── snapshot (legacy gpSnapshot :6287) — public fields only, no `_*` leakage ──────
function snapshot(g: GrowthWorking): SavedPlan {
  return {
    id: g.planId || uid("gp"),
    mode: g.mode,
    title: `${g.mode === "sales" ? "Pitch" : g.mode === "strategy" ? "POC" : "Scale"} — ${
      g.targets[0]?.title || g.winningScript?.label || clientById(g.clientId)?.name || ""
    }`.slice(0, 60),
    channels: [...g.channels],
    targets: structuredClone(g.targets),
    assumptions: structuredClone(g.assumptions),
    toolIds: [...g.toolIds],
    toggles: structuredClone(g.toggles),
    winningScript: g.winningScript ? structuredClone(g.winningScript) : null,
    observed: structuredClone(g.observed),
    nicheSize: g.nicheSize,
    targetBookings: g.targetBookings,
    narrative: g.narrative ? structuredClone(g.narrative) : null,
    docJson: g.docJson ?? null,
    followupIds: [...(g.followupIds || [])],
    prospectWebsite: g.prospectWebsite || "",
    notionUrl: g._notionUrl || "",
    createdAt: new Date().toISOString().slice(0, 10),
  };
}

// ── the GrowthGrowthState adapter funnel-math / notion-blocks consume ──────────────
/** Project the working state onto the GrowthState the funnel-math helpers read. */
export function asFunnelState(g: GrowthWorking): FunnelGrowthState {
  return {
    channels: g.channels,
    assumptions: g.assumptions,
    mode: g.mode,
    targetBookings: g.targetBookings,
    toggles: g.toggles,
    toolIds: g.toolIds,
  };
}

/** Project the working state onto the GrowthPlanState the block builder reads. */
export function asPlanState(g: GrowthWorking): GrowthPlanState {
  return {
    ...asFunnelState(g),
    narrative: g.narrative,
    targets: g.targets as GrowthTarget[],
    winningScript: g.winningScript,
    nicheSize: g.nicheSize,
    observed: g.observed,
    toggles: g.toggles,
  };
}

// ── store ─────────────────────────────────────────────────────────────────────
interface GrowthStore {
  g: GrowthWorking;

  // ── sales prospect pipeline (legacy state.prospectId + psRunning :6677) ──
  /** Selected prospect id (ephemeral, like legacy state.prospectId). */
  prospectId: string | null;
  /** The one-input pipeline is running (legacy psRunning). */
  psRunning: boolean;
  selectProspect: (id: string | null) => void;
  setPsRunning: (v: boolean) => void;
  /** Add a fresh prospect to config.prospects and select it. Returns the record. */
  addProspect: (website: string) => Prospect;
  /** Apply a recipe to a prospect in config.prospects (persisted). */
  updateProspect: (id: string, recipe: (p: Prospect) => void) => void;
  /** Delete a prospect; reselect the first survivor if it was selected. */
  deleteProspect: (id: string) => void;
  /** Toggle an ICP into the pitch, max 3 (legacy prospectToggleIcp :6824). Returns false at the cap. */
  toggleProspectIcp: (id: string, icpId: string) => boolean;
  /** Toggle a channel, keeping at least 1 (legacy prospectToggleChannel :6832). */
  toggleProspectChannel: (id: string, ch: string) => void;

  // lifecycle
  initGrowth: (clientId: string | null, mode?: GrowthMode) => void;
  ensureClient: () => void;
  patch: (p: Partial<GrowthWorking>) => void;

  // client / mode / channel
  setClient: (id: string) => void;
  setClientByName: (name: string) => boolean;
  setMode: (mode: GrowthMode) => void;
  toggleChannel: (ch: string) => void;
  resetToolDefaults: () => void;

  // assumptions / observed
  setAssumption: (ch: keyof Assumptions, key: string, val: number) => void;
  setAssumptionPct: (ch: keyof Assumptions, key: string, val: number) => void;
  setPersonalization: (key: string, val: number) => void;
  setObserved: (ch: string, key: keyof ObservedChannel, val: number) => void;

  // tools / toggles
  toggleTool: (id: string) => void;
  setToggle: (key: keyof GrowthToggles, val: boolean | string) => void;

  // niche size / target
  setNicheSize: (v: string) => void;
  setTargetBookings: (v: number) => void;
  useIcpSize: (idx: number) => void;

  // targets (strategy)
  toggleTarget: (icpId: string) => void;
  toggleTargetItem: (icpId: string, kind: "pains" | "angles", text: string) => void;
  toggleTargetScript: (icpId: string, poolIdx: number) => void;
  removeTargetScript: (icpId: string, idx: number) => void;
  setTargetOffer: (icpId: string, offer: string) => void;
  setTargetFramework: (icpId: string, fwId: string) => void;
  setTargetScripts: (icpId: string, scripts: WorkingTarget["scripts"]) => void;
  activeTarget: () => WorkingTarget | null;

  // winning script (growth)
  setWinPool: (pool: GrowthWorking["_winPool"]) => void;
  pickWinning: (idx: number) => void;
  setWinningScript: (s: WinningScript | null) => void;

  // reservoir pull
  pullScript: (poolIdx: number) => string;
  pullAngle: (text: string) => string;

  // follow-ups
  toggleFollowup: (id: string) => void;

  // narrative
  setNarrative: (n: GrowthPlanState["narrative"]) => void;
  setNarrating: (v: boolean) => void;

  // doc edit (tiptap)
  setDocJson: (json: unknown | null) => void;

  // seed (from builder)
  dismissSeed: () => void;

  // persistence (write to client.growthPlans via configStore.update)
  savePlan: () => string;
  loadPlan: (id: string) => void;
  deletePlan: (id: string) => void;
  setNotionUrl: (url: string) => void;
}

export const useGrowthStore = create<GrowthStore>((set, get) => ({
  g: buildInitial(null, "strategy"),

  // ── sales prospect pipeline ──
  prospectId: null,
  psRunning: false,

  selectProspect: (id) => set({ prospectId: id }),
  setPsRunning: (v) => set({ psRunning: v }),

  addProspect: (website) => {
    const p: Prospect = {
      id: uid("pros"),
      website,
      name: domainOf(website),
      meta: "",
      summary: "",
      caseStudy: {},
      icps: [],
      targetIcpIds: [],
      brief: null,
      sampleScripts: [],
      channels: ["email"],
      targetBookings: 10,
      narrative: null,
      notionUrl: "",
      createdAt: new Date().toISOString().slice(0, 10),
    };
    upd((draft) => {
      draft.prospects = draft.prospects || [];
      draft.prospects.push(p);
    });
    set({ prospectId: p.id });
    return p;
  },

  updateProspect: (id, recipe) =>
    upd((draft) => {
      const p = (draft.prospects || []).find((x: any) => x.id === id);
      if (p) recipe(p as Prospect);
    }),

  deleteProspect: (id) => {
    upd((draft) => {
      draft.prospects = (draft.prospects || []).filter((x: any) => x.id !== id);
    });
    if (get().prospectId === id) set({ prospectId: (cfg().prospects || [])[0]?.id || null });
  },

  toggleProspectIcp: (id, icpId) => {
    const p = (cfg().prospects || []).find((x: any) => x.id === id) as Prospect | undefined;
    if (!p) return true;
    const ids = p.targetIcpIds || [];
    if (!ids.includes(icpId) && ids.length >= 3) return false; // component shows the toast
    get().updateProspect(id, (pp) => {
      const arr = pp.targetIcpIds || (pp.targetIcpIds = []);
      const i = arr.indexOf(icpId);
      if (i !== -1) arr.splice(i, 1);
      else arr.push(icpId);
    });
    return true;
  },

  toggleProspectChannel: (id, ch) =>
    get().updateProspect(id, (pp) => {
      const arr = (pp.channels = pp.channels || ["email"]);
      const i = arr.indexOf(ch);
      if (i !== -1) { if (arr.length > 1) arr.splice(i, 1); } else arr.push(ch);
    }),

  initGrowth: (clientId, mode = "strategy") => set({ g: buildInitial(clientId, mode) }),

  ensureClient: () => {
    const { g } = get();
    if (!g.clientId || !clientById(g.clientId)) {
      const first = (cfg().clients || [])[0]?.id ?? null;
      set({ g: buildInitial(first, g.mode) });
    }
  },

  patch: (p) => set((s) => ({ g: { ...s.g, ...p } })),

  setClient: (id) => set({ g: buildInitial(id, get().g.mode) }),

  setClientByName: (name) => {
    const hit = findByName(cfg().clients || [], name);
    if (hit) { set({ g: buildInitial(hit.id, get().g.mode) }); return true; }
    return false;
  },

  // Switching mode clears narrative + any hand-edited doc (legacy gpSetMode :5371).
  setMode: (mode) =>
    set((s) =>
      s.g.mode === mode ? s : { g: { ...s.g, mode, narrative: null, docJson: null, _narrated: false } },
    ),

  toggleChannel: (ch) =>
    set((s) => {
      const channels = [...s.g.channels];
      const i = channels.indexOf(ch);
      if (i === -1) channels.push(ch);
      else if (channels.length > 1) channels.splice(i, 1);
      return { g: { ...s.g, channels, toolIds: defaultToolIds(channels) } };
    }),

  resetToolDefaults: () => set((s) => ({ g: { ...s.g, toolIds: defaultToolIds(s.g.channels) } })),

  setAssumption: (ch, key, val) =>
    set((s) => ({ g: { ...s.g, assumptions: { ...s.g.assumptions, [ch]: { ...s.g.assumptions[ch], [key]: +val } } } })),

  setAssumptionPct: (ch, key, val) =>
    set((s) => ({
      g: { ...s.g, assumptions: { ...s.g.assumptions, [ch]: { ...s.g.assumptions[ch], [key]: (+val || 0) / 100 } } },
    })),

  setPersonalization: (key, val) =>
    set((s) => ({
      g: { ...s.g, assumptions: { ...s.g.assumptions, personalization: { ...s.g.assumptions.personalization, [key]: +val } } },
    })),

  setObserved: (ch, key, val) =>
    set((s) => ({ g: { ...s.g, observed: { ...s.g.observed, [ch]: { ...s.g.observed[ch], [key]: +val } } } })),

  toggleTool: (id) =>
    set((s) => {
      const toolIds = [...s.g.toolIds];
      const i = toolIds.indexOf(id);
      if (i === -1) toolIds.push(id); else toolIds.splice(i, 1);
      return { g: { ...s.g, toolIds } };
    }),

  setToggle: (key, val) => set((s) => ({ g: { ...s.g, toggles: { ...s.g.toggles, [key]: val } } })),

  setNicheSize: (v) => set((s) => ({ g: { ...s.g, nicheSize: v } })),
  setTargetBookings: (v) => set((s) => ({ g: { ...s.g, targetBookings: +v || 0 } })),

  useIcpSize: (idx) =>
    set((s) => {
      const c = clientById(s.g.clientId);
      const i = (c?.icps || [])[idx];
      return i ? { g: { ...s.g, nicheSize: i.marketSize || "" } } : s;
    }),

  // Add / remove a target (legacy gpToggleTarget :5382). Returns false on the max-3 guard
  // via a no-op (the component shows the toast). Seeds pains/angles/scripts/offer like legacy.
  toggleTarget: (icpId) =>
    set((s) => {
      const g = s.g;
      const c = clientById(g.clientId);
      const i = g.targets.findIndex((t) => t.icpId === icpId);
      if (i !== -1) {
        const targets = [...g.targets];
        targets.splice(i, 1);
        return { g: { ...g, targets } };
      }
      if (g.targets.length >= 3) return s; // component shows "Max 3 targets"
      const icp = (c?.icps || []).find((x: any) => x.id === icpId);
      if (!icp) return s;
      const favPains = (c?.favorites?.pains || []).filter(Boolean).slice(0, 4);
      const realPains = favPains.length ? favPains : clientPainsLocal(c).slice(0, 3);
      const angles = (g.seed?.angles?.length ? g.seed.angles : clientAnglePool(c)).slice(0, 2);
      const scripts = g.seed?.script ? [{ label: g.seed.script.label, text: g.seed.script.text }] : [];
      const offers = clientOffersLocal(c);
      const t: WorkingTarget = {
        icpId,
        title: icp.title,
        niche: icp.niche,
        marketSize: icp.marketSize || "",
        pains: realPains,
        angles,
        scripts,
        offer: offers[0] || "",
        why: icp.why || "",
      };
      return { g: { ...g, targets: [...g.targets, t] } };
    }),

  toggleTargetItem: (icpId, kind, text) =>
    set((s) => {
      const targets = s.g.targets.map((t) => {
        if (t.icpId !== icpId) return t;
        const arr = [...(t[kind] as string[])];
        const i = arr.indexOf(text);
        if (i === -1) { if (kind === "angles" && arr.length >= 2) arr.shift(); arr.push(text); }
        else arr.splice(i, 1);
        return { ...t, [kind]: arr };
      });
      return { g: { ...s.g, targets } };
    }),

  toggleTargetScript: (icpId, poolIdx) =>
    set((s) => {
      const pool = clientScriptPool(clientById(s.g.clientId));
      const ps = pool[poolIdx];
      if (!ps) return s;
      const targets = s.g.targets.map((t) => {
        if (t.icpId !== icpId) return t;
        const scripts = [...t.scripts];
        const i = scripts.findIndex((x) => x.text === ps.text);
        if (i === -1) { if (scripts.length >= 2) scripts.shift(); scripts.push({ label: ps.label, text: ps.text }); }
        else scripts.splice(i, 1);
        return { ...t, scripts };
      });
      return { g: { ...s.g, targets } };
    }),

  removeTargetScript: (icpId, idx) =>
    set((s) => ({
      g: {
        ...s.g,
        targets: s.g.targets.map((t) =>
          t.icpId === icpId ? { ...t, scripts: t.scripts.filter((_, j) => j !== idx) } : t,
        ),
      },
    })),

  setTargetOffer: (icpId, offer) =>
    set((s) => ({ g: { ...s.g, targets: s.g.targets.map((t) => (t.icpId === icpId ? { ...t, offer } : t)) } })),

  setTargetFramework: (icpId, fwId) =>
    set((s) => ({ g: { ...s.g, targets: s.g.targets.map((t) => (t.icpId === icpId ? { ...t, fwId } : t)) } })),

  // AI scripts replace the slot, aligned to this target (legacy gpGenTargetScripts :5450).
  setTargetScripts: (icpId, scripts) =>
    set((s) => ({
      g: { ...s.g, targets: s.g.targets.map((t) => (t.icpId === icpId ? { ...t, scripts: scripts.slice(0, 2) } : t)) },
    })),

  activeTarget: () => { const t = get().g.targets; return t.length ? t[t.length - 1] : null; },

  setWinPool: (pool) => set((s) => ({ g: { ...s.g, _winPool: pool } })),

  pickWinning: (idx) =>
    set((s) => {
      const ws = (s.g._winPool || [])[idx];
      return ws ? { g: { ...s.g, winningScript: { label: ws.label, text: ws.text, note: ws.note } } } : s;
    }),

  setWinningScript: (sc) => set((s) => ({ g: { ...s.g, winningScript: sc } })),

  // Add from the reservoir; in growth mode the script becomes the winning one, otherwise
  // it attaches to the active target (legacy gpPullScript :5501). Returns a status string.
  pullScript: (poolIdx) => {
    const s = get();
    const ps = clientScriptPool(clientById(s.g.clientId))[poolIdx];
    if (!ps) return "";
    if (s.g.mode === "growth") {
      set({ g: { ...s.g, winningScript: { label: ps.label, text: ps.text, note: ps.note || "" } } });
      return "winning";
    }
    const t = s.activeTarget();
    if (!t) return "no-target";
    set((st) => ({
      g: {
        ...st.g,
        targets: st.g.targets.map((x) => {
          if (x.icpId !== t.icpId) return x;
          if (x.scripts.some((y) => y.text === ps.text)) return x;
          const scripts = [...x.scripts];
          if (scripts.length >= 2) scripts.shift();
          scripts.push({ label: ps.label, text: ps.text });
          return { ...x, scripts };
        }),
      },
    }));
    return t.title;
  },

  pullAngle: (text) => {
    const s = get();
    if (s.g.mode === "growth") return "no-target";
    const t = s.activeTarget();
    if (!t) return "no-target";
    set((st) => ({
      g: {
        ...st.g,
        targets: st.g.targets.map((x) => {
          if (x.icpId !== t.icpId) return x;
          if (x.angles.includes(text)) return x;
          const angles = [...x.angles];
          if (angles.length >= 2) angles.shift();
          angles.push(text);
          return { ...x, angles };
        }),
      },
    }));
    return t.title;
  },

  toggleFollowup: (id) =>
    set((s) => {
      const followupIds = [...s.g.followupIds];
      const i = followupIds.indexOf(id);
      if (i === -1) followupIds.push(id); else followupIds.splice(i, 1);
      return { g: { ...s.g, followupIds } };
    }),

  setNarrative: (n) => set((s) => ({ g: { ...s.g, narrative: n, _narrated: true } })),
  setNarrating: (v) => set((s) => ({ g: { ...s.g, _narrating: v } })),

  setDocJson: (json) => set((s) => ({ g: { ...s.g, docJson: json } })),

  dismissSeed: () => set((s) => ({ g: { ...s.g, seed: null } })),

  // Save the working plan onto the client (legacy gpSavePlan :6314). Upserts by id; writes
  // through configStore.update so the save queue runs. `_*` flags never reach the snapshot.
  savePlan: () => {
    const s = get();
    const c = clientById(s.g.clientId);
    if (!c) return "";
    const snap = snapshot(s.g);
    upd((draft) => {
      const cd = draft.clients.find((x: any) => x.id === c.id);
      if (!cd) return;
      cd.growthPlans = cd.growthPlans || [];
      const i = cd.growthPlans.findIndex((p: any) => p.id === snap.id);
      if (i !== -1) cd.growthPlans[i] = snap; else cd.growthPlans.push(snap);
    });
    set({ g: { ...s.g, planId: snap.id } });
    return snap.id;
  },

  // Load a saved plan back into the working state (legacy gpLoadPlan :6326).
  loadPlan: (id) => {
    const s = get();
    const c = clientById(s.g.clientId);
    const p = (c?.growthPlans || []).find((x: any) => x.id === id);
    if (!p) return;
    const pd = planDefaults();
    set({
      g: {
        clientId: c.id,
        planId: p.id,
        mode: p.mode,
        channels: [...p.channels],
        targets: structuredClone(p.targets || []),
        assumptions: structuredClone(
          p.assumptions || { email: { ...pd.email }, linkedin: { ...pd.linkedin }, personalization: { ...pd.personalization } },
        ),
        toolIds: [...(p.toolIds || [])],
        toggles: structuredClone(p.toggles || { replyAgent: false, pledge: false, pledgeText: "" }),
        winningScript: p.winningScript ? structuredClone(p.winningScript) : null,
        observed: structuredClone(p.observed || freshObserved()),
        nicheSize: p.nicheSize || "",
        targetBookings: p.targetBookings || 10,
        narrative: p.narrative ? structuredClone(p.narrative) : null,
        followupIds: [...(p.followupIds || [])],
        prospectWebsite: p.prospectWebsite || "",
        seed: null,
        docJson: p.docJson ?? null,
        _notionUrl: p.notionUrl || "",
        _narrated: !!p.narrative,
      },
    });
  },

  // Remove a saved plan (legacy gpDeletePlan :6345).
  deletePlan: (id) => {
    const s = get();
    const c = clientById(s.g.clientId);
    if (!c) return;
    upd((draft) => {
      const cd = draft.clients.find((x: any) => x.id === c.id);
      if (!cd) return;
      cd.growthPlans = (cd.growthPlans || []).filter((p: any) => p.id !== id);
    });
    if (s.g.planId === id) set({ g: { ...s.g, planId: null } });
  },

  // Stamp the last Notion URL onto the working state AND the saved plan (legacy gpExportNotion).
  setNotionUrl: (url) => {
    const s = get();
    set({ g: { ...s.g, _notionUrl: url } });
    const planId = s.g.planId;
    if (!planId) return;
    upd((draft) => {
      const cd = draft.clients.find((x: any) => x.id === s.g.clientId);
      const p = (cd?.growthPlans || []).find((x: any) => x.id === planId);
      if (p) p.notionUrl = url || "";
    });
  },
}));

// ════════════════════════════════════════════════════════════════════════════════
// SALES PROSPECT PIPELINE state (legacy state.prospectId + psRunning :6677).
//
// Prospects are DISTINCT from clients and live in `config.prospects` (persisted via
// configStore.update). This store only holds the EPHEMERAL selection + the
// "pipeline is running" flag (the legacy globals `state.prospectId` / `psRunning`).
// All prospect mutations write through configStore.update so the single save queue
// stays correct, exactly like the saved-plan path above.
// ════════════════════════════════════════════════════════════════════════════════

/** A prospect record (legacy `config.prospects[]`, shaped at prospectIntake :6767). */
export interface ProspectIcp {
  id: string;
  title: string;
  niche?: string;
  jobTitles?: string[];
  locations?: string[];
  employeeSize?: string;
  revenue?: string;
  marketSize?: string;
  why?: string;
  outboundNotes?: string;
  example?: { company: string; website?: string; why?: string };
  [k: string]: unknown;
}
export interface ProspectCaseStudy {
  size?: string;
  result?: string;
  mechanism?: string;
  proofLine?: string;
  offers?: string[];
  caseStudies?: string[];
  pains?: string[];
  desires?: string[];
  objections?: string[];
  [k: string]: unknown;
}
export interface ProspectBrief {
  services?: string[];
  positioning?: string;
  caseStudies?: string[];
  competitors?: string[];
  builtAt?: string;
}
export interface Prospect {
  id: string;
  website: string;
  name: string;
  meta?: string;
  summary?: string;
  caseStudy?: ProspectCaseStudy;
  icps?: ProspectIcp[];
  targetIcpIds?: string[];
  brief?: ProspectBrief | null;
  sampleScripts?: Array<{ label?: string; text: string }>;
  channels?: string[];
  targetBookings?: number;
  narrative?: { intro?: string; expectations?: string; closing?: string } | null;
  notionUrl?: string;
  createdAt?: string;
  [k: string]: unknown;
}

const prospects = (): Prospect[] => (cfg().prospects || []) as Prospect[];

/** Selected prospect, falling back to the first (legacy curProspect :6589). */
export function curProspect(pid: string | null): Prospect | null {
  const list = prospects();
  return (pid && list.find((x) => x.id === pid)) || list[0] || null;
}

/** The chosen ICPs for a prospect's pitch (legacy prospectChosenIcps :5892). */
export function prospectChosenIcps(p: Prospect | null): ProspectIcp[] {
  if (!p) return [];
  const chosen = new Set(p.targetIcpIds || []);
  return (p.icps || []).filter((i) => chosen.has(i.id));
}

// ── local copies of the wizard aggregators (kept here so the store has no React import) ──
function clientPainsLocal(c: any): string[] {
  const flatT = (key: string) => (c?.transcripts || []).flatMap((t: any) => t[key] || []);
  return dedupeStr([...(c?.caseStudy?.pains || []), ...flatT("pains")]);
}
function clientOffersLocal(c: any): string[] {
  const flatT = (key: string) => (c?.transcripts || []).flatMap((t: any) => t[key] || []);
  return dedupeStr([...(c?.caseStudy?.offers || []), ...flatT("offers")]);
}
