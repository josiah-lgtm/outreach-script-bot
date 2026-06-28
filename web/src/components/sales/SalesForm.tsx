// The left pane — prospect intake + the one-input 5-step pipeline, the prospect list, and
// (once researched) the ICP→pitch chips, channel toggles + target-bookings, "Write 2 drafts",
// "Redraft narrative" and the "Finish research" repair button.
//
// Faithful port of the legacy renderSalesForm (:6598) and its handlers:
//   prospectPipeline :6704 · tryStep :6689 · prospectIntake :6762 · prospectRepair :6786
//   prospectNarrateRaw :6799 · prospectNarrate :6814 · prospectToggleIcp :6824
//   prospectToggleChannel :6832 · prospectDraftScripts :6841
//
// The 5-step pipeline (research_client_site → build_icp → compose_client_brief →
// find_icp_example → compose_sales_plan) persists after EACH step (so a refresh resumes),
// skips any step that already has output, and retries ONCE on clearly-transient errors. A
// failed step never kills the rest; whatever is still missing surfaces the repair button.

"use client";

import { useState } from "react";
import { Button, Chip, Input, Select, NumberInput, Badge, Spinner } from "@/components/ui";
import type { ReactNode } from "react";
import { api } from "@/lib/sync/api";
import { getAdminKey } from "@/lib/sync/adminKey";
import { notify } from "@/lib/notify";
import { uid } from "@/lib/text-utils";
import { useConfigStore } from "@/lib/store/configStore";
import {
  useGrowthStore,
  prospectChosenIcps,
  domainOf,
  type Prospect,
  type ProspectIcp,
} from "@/lib/store/growthStore";
import type { SaConfig, SaFramework } from "./types";

const CHANNELS = ["email", "linkedin"] as const;
const CH_LABEL: Record<string, string> = { email: "📧 Email", linkedin: "🔗 LinkedIn" };

const dedupeStr = (arr: unknown[]): string[] =>
  Array.from(new Set((arr || []).map((s) => String(s).trim()).filter(Boolean)));

// Only auto-retry on clearly-transient errors (legacy tryStep :6689). Don't re-call Claude on
// a 4xx, a parse error, or the daily cap — that just double-bills the step.
const TRANSIENT = /network|blocked|too large|overload|timeout|HTTP 5|503|529/i;
async function tryStep<T>(label: string, fn: () => Promise<T>, onRetry: () => void): Promise<T> {
  try {
    return await fn();
  } catch (e1) {
    const msg = (e1 as Error)?.message || String(e1);
    if (!TRANSIENT.test(msg)) throw new Error(label + " failed: " + msg);
    onRetry();
    try {
      return await fn();
    } catch (e2) {
      throw new Error(label + " failed: " + ((e2 as Error)?.message || String(e2)));
    }
  }
}

// ── small section block (legacy .step / .step-head) ──
function Step({ title, count, children }: { title: ReactNode; count?: ReactNode; children: ReactNode }) {
  return (
    <div className="bg-bg2 border border-border rounded-xl p-3.5">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <span className="text-[13px] font-semibold">{title}</span>
        {count != null && <span className="text-[11px] text-muted">{count}</span>}
      </div>
      {children}
    </div>
  );
}

interface SalesFormProps {
  prospect: Prospect | null;
}

export function SalesForm({ prospect: p }: SalesFormProps) {
  const cfg = useConfigStore((s) => s.config) as SaConfig;
  const psRunning = useGrowthStore((s) => s.psRunning);
  const setPsRunning = useGrowthStore((s) => s.setPsRunning);
  const selectProspect = useGrowthStore((s) => s.selectProspect);
  const addProspect = useGrowthStore((s) => s.addProspect);
  const updateProspect = useGrowthStore((s) => s.updateProspect);
  const deleteProspect = useGrowthStore((s) => s.deleteProspect);
  const toggleProspectIcp = useGrowthStore((s) => s.toggleProspectIcp);
  const toggleProspectChannel = useGrowthStore((s) => s.toggleProspectChannel);

  const list = (cfg.prospects || []) as Prospect[];
  const frameworks = (cfg.frameworks || []) as SaFramework[];

  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState("");
  const [fwId, setFwId] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [narrating, setNarrating] = useState(false);

  const rules = cfg.settings?.growthRules || "";
  const dossier = (pr: Prospect) =>
    [
      `Client: ${pr.name} (${pr.meta || ""})`,
      pr.summary || "",
      `Mechanism: ${pr.caseStudy?.mechanism || ""}`,
      `Offers: ${(pr.caseStudy?.offers || []).join("; ")}`,
      `Case studies: ${(pr.caseStudy?.caseStudies || []).join("; ")}`,
      `Customer pains: ${(pr.caseStudy?.pains || []).join("; ")}`,
    ].join("\n");

  // ── the one-input pipeline (legacy prospectPipeline :6704) ──
  // Runs whichever pieces are missing on the prospect; persists after each step so a refresh
  // resumes, and a hiccup never strands a half-built pitch. `pr` is mutated in place and
  // written through updateProspect (which persists via configStore) after every step.
  async function prospectPipeline(pr: Prospect): Promise<string[]> {
    const failures: string[] = [];
    const persist = () => updateProspect(pr.id, (d) => Object.assign(d, pr));

    // 1/5 — scrape the prospect site (skip if already scraped).
    const scraped = (pr.caseStudy?.pains || []).length || pr.caseStudy?.mechanism;
    if (!scraped) {
      setStatus("1/5 Reading their website… (~1 min)");
      try {
        const r = await tryStep(
          "Website research",
          () => api({ action: "research_client_site", url: pr.website }),
          () => setStatus("1/5 Reading their website… (retrying…)"),
        );
        pr.name = r.name || pr.name;
        pr.meta = r.meta || pr.meta;
        pr.summary = r.summary || "";
        pr.caseStudy = {
          size: r.size || "", result: r.result || "", mechanism: r.mechanism || "",
          proofLine: r.proofLine || "", offers: r.offers || [], caseStudies: r.caseStudies || [],
          pains: r.pains || [], desires: r.desires || [], objections: r.objections || [],
        };
        persist();
      } catch (e) { failures.push((e as Error).message); }
    }

    // 2/5 — build the ICPs (skip if already built).
    if (!(pr.icps || []).length) {
      setStatus("2/5 Building their ideal customer profiles… (real web research, ~2 min — leave this tab open)");
      try {
        const icpRes = await tryStep(
          "ICP builder",
          () => api({ action: "build_icp", context: dossier(pr) }),
          () => setStatus("2/5 Building their ideal customer profiles… (retrying…)"),
        );
        pr.icps = ((icpRes.icps || []) as ProspectIcp[]).map((i) => ({ ...i, id: uid("icp") }));
        pr.targetIcpIds = pr.icps.slice(0, 2).map((i) => i.id);
        persist();
      } catch (e) { failures.push((e as Error).message); }
    }

    // 3/5 — write the client brief (skip if already written).
    if (!pr.brief) {
      setStatus("3/5 Writing the client brief…");
      try {
        const briefRes = await tryStep(
          "Client brief",
          () => api({ action: "compose_client_brief", context: dossier(pr), rules }),
          () => setStatus("3/5 Writing the client brief… (retrying…)"),
        );
        pr.brief = {
          services: briefRes.services || [], positioning: briefRes.positioning || "",
          caseStudies: briefRes.caseStudies || [], competitors: briefRes.competitors || [],
          builtAt: new Date().toISOString().slice(0, 10),
        };
        persist();
      } catch (e) { failures.push((e as Error).message); }
    }

    // 4/5 — find a real example for the first chosen ICP (skip if it already has one).
    const first = (pr.icps || []).find((i) => (pr.targetIcpIds || []).includes(i.id));
    if (first && !first.example) {
      setStatus("4/5 Finding a real example of their ideal client… (~1 min)");
      try {
        const ex = await tryStep(
          "Example client",
          () => api({ action: "find_icp_example", icp: { title: first.title, niche: first.niche, jobTitles: first.jobTitles, employeeSize: first.employeeSize, locations: first.locations } }),
          () => setStatus("4/5 Finding a real example of their ideal client… (retrying…)"),
        );
        if (ex.company) first.example = { company: ex.company, website: ex.website || "", why: ex.why || "" };
        persist();
      } catch (e) { failures.push((e as Error).message); }
    }

    // 5/5 — write the pitch narrative (skip if already written).
    if (!pr.narrative) {
      setStatus("5/5 Writing the pitch…");
      try {
        await tryStep(
          "Pitch narrative",
          () => narrateRaw(pr),
          () => setStatus("5/5 Writing the pitch… (retrying…)"),
        );
        persist();
      } catch (e) { failures.push((e as Error).message); }
    }
    return failures;
  }

  // Core narrative call — throws on failure so the pipeline's retry sees it (legacy :6799).
  async function narrateRaw(pr: Prospect) {
    const b = pr.brief || {};
    const ctx = [
      `Prospect: ${pr.name} (${pr.meta || ""})`,
      b.positioning ? `What they do: ${b.positioning}` : "",
      (b.services || []).length ? `Their services: ${(b.services || []).join("; ")}` : "",
      `Who we will target for them: ${prospectChosenIcps(pr).map((i) => i.title).join("; ") || "their ideal customers"}`,
      `Booked calls a month we aim for: ${pr.targetBookings || 10}`,
      `Channel: ${(pr.channels || ["email"]).join(" and ")}`,
    ].filter(Boolean).join("\n");
    const sd = cfg.sellerProfile?.salesDoc || {};
    const r = await api({ action: "compose_sales_plan", context: ctx, rules, prompt: sd.prompt || "", mention: sd.mention || [] });
    pr.narrative = { intro: r.intro || "", expectations: r.expectations || "", closing: r.closing || "" };
  }

  // ── intake (legacy prospectIntake :6762) ──
  async function intake() {
    if (psRunning) { notify("Already researching — give it a minute", true); return; }
    if (!getAdminKey()) { notify("Sign in first", true); return; }
    const url = website.trim();
    if (!url) { notify("Paste the prospect website first", true); return; }
    const pr = addProspect(url);
    setWebsite("");
    setPsRunning(true);
    const failures = await prospectPipeline(pr);
    setPsRunning(false);
    if (failures.length) {
      setStatus("⚠️ " + failures.join(" · ") + " — hit “↻ Finish research” on the prospect to retry the missing parts.");
      notify("Research finished with gaps — see the ↻ button", true);
    } else {
      setStatus("✅ Pitch ready. Want sample scripts in it? Hit “✨ Write 2 drafts” below.");
      notify("🤝 Pitch ready for " + pr.name);
    }
  }

  // ── repair — re-run only the missing pieces (legacy prospectRepair :6786) ──
  async function repair() {
    if (psRunning) { notify("Already running — give it a minute", true); return; }
    if (!getAdminKey()) { notify("Sign in first", true); return; }
    if (!p) return;
    const pr = { ...p } as Prospect;
    setPsRunning(true);
    const failures = await prospectPipeline(pr);
    setPsRunning(false);
    setStatus(failures.length ? "⚠️ Still missing: " + failures.join(" · ") : "✅ All pieces in place.");
    notify(failures.length ? "Some parts still failed — try again in a minute" : "✅ Research complete", !!failures.length);
  }

  // ── redraft narrative (legacy prospectNarrate :6814) ──
  async function redraftNarrative() {
    if (!p) return;
    if (!getAdminKey()) { notify("Sign in first", true); return; }
    setNarrating(true);
    try {
      const pr = { ...p } as Prospect;
      await narrateRaw(pr);
      updateProspect(pr.id, (d) => { d.narrative = pr.narrative; });
      notify("Narrative redrafted");
    } catch (e) {
      notify("Draft failed: " + (e as Error).message, true);
    }
    setNarrating(false);
  }

  // ── draft 2 sample scripts (legacy prospectDraftScripts :6841) ──
  async function draftScripts() {
    if (!p) return;
    if (!getAdminKey()) { notify("Sign in first", true); return; }
    const fw = frameworks.find((f) => f.id === fwId) || frameworks[0];
    if (!fw) { notify("No frameworks in the library", true); return; }
    const icp = prospectChosenIcps(p)[0] || (p.icps || [])[0];
    const angles = dedupeStr(p.caseStudy?.pains || []).slice(0, 2);
    if (!angles.length) { notify("No pains found on their site — run research first", true); return; }
    setDrafting(true);
    try {
      const r = await api({
        action: "generate",
        prospect: {},
        client: { name: p.name, caseStudy: p.caseStudy || {}, avoid: [], competitorIntel: "" },
        niche: { name: icp?.niche || p.meta || "", triggerWords: [] },
        frameworks: [{ id: fw.id, name: fw.name, category: fw.category, template: fw.template, rules: fw.rules }],
        angles,
        variantsPerAngle: 1,
        globalRules: cfg.settings?.globalRules || "",
        icp: icp
          ? { title: icp.title, niche: icp.niche, jobTitles: icp.jobTitles || [], locations: icp.locations || [], employeeSize: icp.employeeSize || "", revenue: icp.revenue || "", outboundNotes: icp.outboundNotes || "" }
          : undefined,
      });
      const variants: Array<{ label: string; text: string }> = (r.results || []).flatMap(
        (res: { framework?: string; variants?: Array<{ angle?: string; script?: string }> }) =>
          (res.variants || []).map((v) => ({ label: `${res.framework} · ${v.angle || ""}`, text: v.script || "" })),
      );
      if (!variants.length) throw new Error("no scripts returned");
      updateProspect(p.id, (d) => { d.sampleScripts = variants.slice(0, 2); });
      notify("✍️ 2 draft scripts added to the pitch");
    } catch (e) {
      notify("Draft failed: " + (e as Error).message, true);
    }
    setDrafting(false);
  }

  // Anything the pipeline didn't finish (legacy missing[] :6627).
  const missing: string[] = [];
  if (p) {
    if (!(p.caseStudy?.pains || []).length && !p.caseStudy?.mechanism) missing.push("website research");
    if (!(p.icps || []).length) missing.push("ICPs");
    if (!p.brief) missing.push("client brief");
    if (!p.narrative) missing.push("pitch narrative");
  }
  const chosen = new Set(p?.targetIcpIds || []);

  function onDelete(id: string, name: string) {
    if (!window.confirm(`Delete ${name} and their pitch?`)) return;
    deleteProspect(id);
    notify("Prospect deleted");
  }

  return (
    <div className="flex flex-col gap-4">
      {/* New prospect intake */}
      <div className="bg-bg2 border border-[var(--tint-accent-ring,rgba(37,99,235,.45))] rounded-xl p-4">
        <div className="text-[13px] font-semibold mb-1.5">🤝 New prospect — one input, the whole pitch</div>
        <p className="text-[11px] text-muted leading-snug mb-2.5">
          Paste their website. We research the site, build their ICPs, write the client brief, find a real example
          company, draft the narrative — and the pitch document appears on the right. Prospects live separately from
          your clients.
        </p>
        <div className="flex gap-2">
          <Input
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") intake(); }}
            placeholder="prospect-website.com"
            disabled={psRunning}
          />
          <Button variant="primary" icon="world-search" onClick={intake} disabled={psRunning} className="whitespace-nowrap">
            {psRunning ? "Working…" : "Research & build"}
          </Button>
        </div>
        {status && <p className="text-[11px] text-muted leading-snug mt-1.5 min-h-[16px]">{status}</p>}
      </div>

      {/* Prospect list */}
      {!!list.length && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted mb-1.5">
            Prospects ({list.length})
          </div>
          <div className="flex flex-col gap-1.5">
            {list.map((x) => {
              const on = p?.id === x.id;
              return (
                <div
                  key={x.id}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${on ? "border-accent" : "border-border"} bg-bg2`}
                >
                  <button
                    type="button"
                    onClick={() => selectProspect(x.id)}
                    className="min-w-0 flex-1 text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5">
                      <b className="text-xs truncate">{x.name || domainOf(x.website)}</b>
                      <Badge tone="accent">prospect</Badge>
                    </div>
                    <div className="text-[11px] text-muted truncate mt-0.5">
                      {domainOf(x.website)} · {(x.icps || []).length} ICPs
                      {x.brief ? " · brief ✓" : ""}
                      {(x.sampleScripts || []).length ? ` · ${x.sampleScripts!.length} drafts` : ""}
                      {x.createdAt ? ` · ${x.createdAt}` : ""}
                      {x.notionUrl ? (
                        <> · <a href={x.notionUrl} target="_blank" rel="noreferrer" className="text-accent2">Notion ↗</a></>
                      ) : null}
                    </div>
                  </button>
                  <Button variant="danger" size="sm" icon="trash" onClick={() => onDelete(x.id, x.name || domainOf(x.website))}>
                    Del
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {p && (
        <>
          {/* Repair — anything the pipeline didn't finish */}
          {!!missing.length && !psRunning && (
            <div className="bg-bg2 border border-[var(--tint-amber-ring,rgba(245,158,11,.45))] rounded-xl p-4">
              <div className="text-[13px] font-semibold mb-1.5">⚠️ Research incomplete for {p.name || "this prospect"}</div>
              <p className="text-[11px] text-muted leading-snug mb-2.5">
                Missing: {missing.join(", ")}. One click re-runs just the missing parts.
              </p>
              <Button variant="secondary" size="sm" icon="refresh" onClick={repair}>Finish research</Button>
            </div>
          )}

          {/* ICPs to pitch */}
          <Step title={`🎯 ICPs to pitch for ${p.name || "them"}`} count={`${chosen.size}/3`}>
            {(p.icps || []).length ? (
              <div className="flex flex-wrap gap-1.5">
                {p.icps!.map((i) => (
                  <Chip
                    key={i.id}
                    selected={chosen.has(i.id)}
                    title={(i.jobTitles || []).join(", ")}
                    onClick={() => { if (!toggleProspectIcp(p.id, i.id)) notify("Max 3 ICPs — keep the pitch focused", true); }}
                  >
                    {i.title}{i.example ? " ✓" : ""}
                  </Chip>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-muted">No ICPs yet — run the research above.</p>
            )}
          </Step>

          {/* Pitch settings */}
          <Step title="⚙ Pitch settings">
            <div className="flex flex-wrap gap-1.5 mb-3">
              {CHANNELS.map((ch) => (
                <Chip key={ch} selected={(p.channels || []).includes(ch)} onClick={() => toggleProspectChannel(p.id, ch)}>
                  {CH_LABEL[ch]}
                </Chip>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-subtle">Booked calls / month we aim for</span>
              <NumberInput
                value={p.targetBookings || 10}
                onValueChange={(v) => updateProspect(p.id, (d) => { d.targetBookings = v; })}
              />
            </div>
          </Step>

          {/* Draft scripts */}
          <Step title="✍️ Draft scripts — show them what it looks like">
            <div className="flex items-center gap-1.5">
              <Select value={fwId} onChange={(e) => setFwId(e.target.value)} className="flex-1 text-[12px]">
                {frameworks.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </Select>
              <Button variant="secondary" size="sm" icon="sparkles" onClick={draftScripts} disabled={drafting} className="whitespace-nowrap">
                {drafting ? "Writing…" : "Write 2 drafts"}
              </Button>
            </div>
            {!!(p.sampleScripts || []).length && (
              <p className="text-[11px] text-muted mt-1.5">
                {p.sampleScripts!.length} draft{p.sampleScripts!.length > 1 ? "s" : ""} in the doc ·{" "}
                <button type="button" className="text-red cursor-pointer hover:underline" onClick={() => updateProspect(p.id, (d) => { d.sampleScripts = []; })}>
                  remove
                </button>
              </p>
            )}
          </Step>

          {/* Actions */}
          <div className="flex gap-2 mt-1 mb-10">
            <Button variant="secondary" icon="refresh" onClick={redraftNarrative} disabled={narrating} className="flex-1">
              {narrating ? <Spinner size="sm" /> : "Redraft narrative"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
