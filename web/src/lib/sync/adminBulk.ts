// Admin "run across everything" bulk operations. Ports the legacy
// runFilterAcrossAll (index.html:3462-3530) and runGroupAll (index.html:3429-3461).
//
// Both walk every client / niche / ICP, run AI through the saved house lens, and
// rewrite the config IN PLACE. Scripts keep their previous version (pushed to
// `_versions`); angles / desires / offers / pains / sizes are replaced in place.
// CONCURRENCY=3 for the per-item script + grouping passes (legacy parity).
//
// The legacy versions mutated the global `config` then called persistConfig(); here
// we collect a list of mutators and apply them all in ONE useConfigStore.update()
// recipe (immer draft) so the optimistic write + debounced server save fire once.

import { api } from "./api";
import { composeLens } from "./systemFilter";
import { getAdminKey } from "./adminKey";
import { refineBatch } from "./lens";
import { categorizeList } from "@/lib/ai-json";
import { uid } from "@/lib/text-utils";
import { clientPains, clientDesires } from "./wizard";
import { useConfigStore } from "@/lib/store/configStore";
import { notify } from "@/lib/notify";

const CONCURRENCY = 3;
const MOCK_TAIL = /\n*\(mock refinement applied\)\s*$/;

// ─── runFilterAcrossAll ──────────────────────────────────────────────────────

export interface RunFilterOpts {
  scripts: boolean;
  pains: boolean;
  desires: boolean;
  offers: boolean;
  sizes: boolean;
  /** Called on every completed item so the UI can show "Filtering n / total…". */
  onProgress?: (completed: number, total: number) => void;
  /** Confirm gate (legacy used window.confirm). Return true to proceed. */
  confirm?: (count: number) => boolean;
}

export interface RunFilterResult {
  ran: boolean;
  changed: number;
  same: number;
  failed: number;
  total: number;
  message: string;
}

// A single item to filter. `apply` mutates the config draft in place (it captures
// the draft node + index it was built from inside the update() recipe).
type FilterJob =
  | { kind: "script"; short: false; text: string; apply: (draft: any, t: string) => void }
  | { kind: "pain" | "desire" | "offer" | "size"; short: true; text: string; apply: (draft: any, t: string) => void };

export async function runFilterAcrossAll(opts: RunFilterOpts): Promise<RunFilterResult> {
  const fail = (message: string): RunFilterResult => ({ ran: false, changed: 0, same: 0, failed: 0, total: 0, message });

  if (!getAdminKey()) { notify("Admin key required to run the AI filter", true); return fail("Admin key required to run the AI filter"); }

  const cfg = useConfigStore.getState().config;
  const sf = (cfg.settings && cfg.settings.systemFilter) || {};
  if (sf.enabled === false) { notify("Turn the filter on first", true); return fail("Turn the filter on first"); }
  if (!composeLens()) { notify("Add some filter content first (lens / messaging / offers…)", true); return fail("Add some filter content first"); }

  const { scripts: doScripts, pains: doPains, desires: doDesires, offers: doOffers, sizes: doSizes } = opts;
  if (!(doScripts || doPains || doDesires || doOffers || doSizes)) { notify("Pick at least one thing to run", true); return fail("Pick at least one thing to run"); }

  // Build the job list by WALKING the live config and recording the path to each item,
  // so apply() can re-walk the immer draft and write the new text back in place.
  const jobs: FilterJob[] = [];
  const clients: any[] = cfg.clients || [];
  const niches: any[] = cfg.niches || [];

  if (doScripts) {
    clients.forEach((c, ci) => (c.scriptReservoir || []).forEach((s: any, si: number) => {
      if (!s.script) return;
      const origScript = s.script;
      jobs.push({
        kind: "script", short: false, text: origScript,
        apply: (draft, t) => {
          const node = draft.clients[ci].scriptReservoir[si];
          node._versions = node._versions || [];
          node._versions.push({ id: uid("v"), label: "Pre-filter", tag: "orig", text: origScript });
          node.script = t;
        },
      });
    }));
  }

  if (doPains) {
    // pains live on each client's case study…
    clients.forEach((c, ci) => ((c.caseStudy || {}).pains || []).forEach((p: string, i: number) =>
      jobs.push({ kind: "pain", short: true, text: p, apply: (draft, t) => { draft.clients[ci].caseStudy.pains[i] = t; } })));
    // …plus the niche angle lists…
    niches.forEach((n, ni) => (n.angles || []).forEach((a: string, i: number) =>
      jobs.push({ kind: "pain", short: true, text: a, apply: (draft, t) => { draft.niches[ni].angles[i] = t; } })));
    // …any saved custom angles…
    clients.forEach((c, ci) => (c.savedAngles || []).forEach((x: any, i: number) => {
      if (x && x.text) jobs.push({ kind: "pain", short: true, text: x.text, apply: (draft, t) => { draft.clients[ci].savedAngles[i].text = t; } });
    }));
    // …and each ICP's objections.
    clients.forEach((c, ci) => (c.icps || []).forEach((ic: any, ii: number) => (ic.objections || []).forEach((o: string, i: number) =>
      jobs.push({ kind: "pain", short: true, text: o, apply: (draft, t) => { draft.clients[ci].icps[ii].objections[i] = t; } }))));
  }

  if (doDesires) {
    clients.forEach((c, ci) => ((c.caseStudy || {}).desires || []).forEach((d: string, i: number) =>
      jobs.push({ kind: "desire", short: true, text: d, apply: (draft, t) => { draft.clients[ci].caseStudy.desires[i] = t; } })));
    clients.forEach((c, ci) => (c.icps || []).forEach((ic: any, ii: number) => (ic.desires || []).forEach((d: string, i: number) =>
      jobs.push({ kind: "desire", short: true, text: d, apply: (draft, t) => { draft.clients[ci].icps[ii].desires[i] = t; } }))));
  }

  if (doOffers) {
    clients.forEach((c, ci) => ((c.caseStudy || {}).offers || []).forEach((o: string, i: number) =>
      jobs.push({ kind: "offer", short: true, text: o, apply: (draft, t) => { draft.clients[ci].caseStudy.offers[i] = t; } })));
  }

  if (doSizes) {
    clients.forEach((c, ci) => {
      const cs = c.caseStudy || {};
      if (cs.size) jobs.push({ kind: "size", short: true, text: cs.size, apply: (draft, t) => { draft.clients[ci].caseStudy.size = t; } });
    });
  }

  if (!jobs.length) { notify("Nothing to run — no matching items found", true); return fail("Nothing to run — no matching items found"); }

  const total = jobs.length;
  if (opts.confirm && !opts.confirm(total)) return fail("Cancelled");

  let changed = 0, same = 0, failed = 0, firstErr = "", completed = 0;
  const tick = () => opts.onProgress?.(completed, total);

  // Each successful job records its mutator; we apply them all in one update() at the end.
  const mutators: Array<(draft: any) => void> = [];

  // Short single-line items → ONE batched call per ~25 (not one Claude call each).
  const shortJobs = jobs.filter((j): j is Extract<FilterJob, { short: true }> => j.short);
  const scriptJobs = jobs.filter((j): j is Extract<FilterJob, { short: false }> => !j.short);

  if (shortJobs.length) {
    const rb = await refineBatch(
      shortJobs.map((j) => j.text),
      "Rewrite each short line to match our house lens and messaging. Keep each short — each stays a single line.",
    );
    rb.items.forEach((t, i) => {
      completed++;
      if (!rb.ok[i]) { failed++; if (!firstErr) firstErr = "couldn’t reach the rewriter"; return; }
      const orig = String(shortJobs[i].text).trim();
      if (t && t !== orig) { const job = shortJobs[i]; mutators.push((draft) => job.apply(draft, t)); changed++; } else same++;
    });
    tick();
  }

  // Full scripts: per-item, 3 at a time (≈3× faster than serial).
  async function runScript(job: Extract<FilterJob, { short: false }>) {
    try {
      const r: any = await api({
        action: "refine_script",
        script: job.text,
        prompt: "Rewrite this script to match our house messaging and lens. Keep every {{merge_tag}} exactly and keep about the same length. Return only the rewritten script.",
      });
      let out = (r && (r.script || r.text || r.result || r.refined || r.output || r.content || r.rewrite)) || (typeof r === "string" ? r : "");
      out = String(out).replace(MOCK_TAIL, "").trim();
      if (out && out !== String(job.text).trim()) { mutators.push((draft) => job.apply(draft, out)); changed++; }
      else if (out) { same++; }
      else { failed++; if (!firstErr) firstErr = "empty response (" + JSON.stringify(Object.keys(r || {})) + ")"; }
    } catch (e) {
      failed++; if (!firstErr) firstErr = (e as Error)?.message || ("" + e);
    }
    completed++; tick();
  }

  let next = 0;
  async function worker() { while (next < scriptJobs.length) { await runScript(scriptJobs[next++]); } }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, scriptJobs.length) }, worker));

  // Apply every recorded mutation in ONE optimistic write + debounced save.
  if (mutators.length) useConfigStore.getState().update((draft) => { mutators.forEach((m) => m(draft)); });

  const tail = `${changed} changed${same ? `, ${same} already on-brand` : ""}${failed ? `, ${failed} skipped` : ""}` + (failed && firstErr ? ` — first issue: ${firstErr}` : "");
  notify(`Filter run complete — ${tail}`, failed > 0 && changed === 0);
  return { ran: true, changed, same, failed, total, message: `Done — ${tail}` };
}

// ─── runGroupAll ─────────────────────────────────────────────────────────────

export interface RunGroupResult {
  ran: boolean;
  done: number;
  empty: number;
  total: number;
  message: string;
}

interface GroupJob {
  what: "pains" | "desires";
  items: string[];
  apply: (draft: any, groups: unknown) => void;
}

export async function runGroupAll(onProgress?: (completed: number, total: number) => void): Promise<RunGroupResult> {
  const fail = (message: string): RunGroupResult => ({ ran: false, done: 0, empty: 0, total: 0, message });

  if (!getAdminKey()) { notify("Admin key required to run the AI grouping", true); return fail("Admin key required to run the AI grouping"); }

  const cfg = useConfigStore.getState().config;
  const clients: any[] = cfg.clients || [];

  const jobs: GroupJob[] = [];
  clients.forEach((c, ci) => {
    const p = clientPains(c); if (p.length) jobs.push({ what: "pains", items: p, apply: (draft, gs) => { draft.clients[ci].painGroups = gs; } });
    const d = clientDesires(c); if (d.length) jobs.push({ what: "desires", items: d, apply: (draft, gs) => { draft.clients[ci].desireGroups = gs; } });
    (c.icps || []).forEach((ic: any, ii: number) => {
      const ip = ic.pains || []; if (ip.length) jobs.push({ what: "pains", items: ip, apply: (draft, gs) => { draft.clients[ci].icps[ii].painGroups = gs; } });
      const id = ic.desires || []; if (id.length) jobs.push({ what: "desires", items: id, apply: (draft, gs) => { draft.clients[ci].icps[ii].desireGroups = gs; } });
    });
  });

  if (!jobs.length) { notify("Nothing to group yet — no pains/desires on file", true); return fail("Nothing to group yet — no pains/desires on file"); }

  const total = jobs.length;
  let done = 0, empty = 0, completed = 0, firstErr = "";
  const mutators: Array<(draft: any) => void> = [];

  async function runOne(job: GroupJob) {
    try {
      const gs = await categorizeList(job.items, job.what === "pains" ? "cold-outreach pain points" : "desired outcomes and offers", api, uid);
      if (gs) { mutators.push((draft) => job.apply(draft, gs)); done++; } else empty++;
    } catch (e) {
      empty++; if (!firstErr) firstErr = (e as Error)?.message || ("" + e);
    }
    completed++; onProgress?.(completed, total);
  }

  let next = 0;
  async function worker() { while (next < jobs.length) { await runOne(jobs[next++]); } }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));

  if (mutators.length) useConfigStore.getState().update((draft) => { mutators.forEach((m) => m(draft)); });

  const tail = `${done} grouped${empty ? `, ${empty} skipped` : ""}` + (empty && firstErr ? ` — first issue: ${firstErr}` : "");
  notify(`Grouping complete — ${tail}`, done === 0);
  return { ran: true, done, empty, total, message: `Done — ${tail}` };
}
