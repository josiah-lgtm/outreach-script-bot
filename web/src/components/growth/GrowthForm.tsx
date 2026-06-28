// The left pane — the full growth-plan builder form. Faithful port of the legacy
// renderGrowthForm (:5128) and its sub-forms: gpStrategyForm (:5221), gpGrowthForm (:5267),
// gpAssumptionsForm (:5303), gpToolsForm (:5330), gpReservoirPicker (:5468),
// gpFollowupsSection (:5524), plus the client-picker / mode / channel / brief steps.
//
// All mutations go through the growthStore actions; the client brief build (compose_client_brief
// + find_icp_example) and the per-target "Write 2 with AI" (generate) call the server and then
// persist results to the config via useConfigStore.update (briefs/ICP examples live on the
// client, not on the ephemeral plan).

"use client";

import { useState } from "react";
import {
  Button,
  Card,
  Chip,
  Input,
  Select,
  NumberInput,
  Textarea,
  Toggle,
  Badge,
  Spinner,
  Accordion,
  cn,
} from "@/components/ui";
import { api } from "@/lib/sync/api";
import { getAdminKey } from "@/lib/sync/adminKey";
import { notify } from "@/lib/notify";
import { useConfigStore } from "@/lib/store/configStore";
import {
  useGrowthStore,
  clientAnglePool,
  clientScriptPool,
  selectableTools,
  type GrowthMode,
  type WorkingTarget,
} from "@/lib/store/growthStore";
import {
  rateFractionToDisplay,
  gpMoney,
} from "@/lib/funnel-math";
import {
  clientPains,
  clientOffers,
  primaryNicheId,
} from "@/lib/sync/wizard";
import type {
  GpClient,
  GpConfig,
  GpIcp,
  GpToolKB,
  GpFollowupSeq,
  GpSavedPlan,
  GpFramework,
} from "./types";

const CH_LABEL: Record<string, string> = { email: "📧 Email", linkedin: "🔗 LinkedIn" };
const CHANNELS = ["email", "linkedin"] as const;

// ── small section heading (legacy .step-head) ──
function Step({
  num,
  title,
  count,
  children,
}: {
  num?: number | string;
  title: React.ReactNode;
  count?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2.5">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-text">
          {num != null && (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent text-white text-[11px]">
              {num}
            </span>
          )}
          {title}
        </span>
        {count != null && <span className="text-[11px] text-muted">{count}</span>}
      </div>
      {children}
    </div>
  );
}

const toolCostLabel = (t: GpToolKB): string => {
  if (t.costModel === "flat") return gpMoney(t.cost || 0) + "/mo";
  if (t.costModel === "per_1k_leads") return gpMoney(t.cost || 0) + " / 1K leads";
  if (t.costModel === "per_1k_verified") return "$" + t.cost + " / 1K verified";
  if (t.costModel === "tokens") return `$${t.inPerM}/1M in · $${t.outPerM}/1M out`;
  return "";
};

interface GrowthFormProps {
  client: GpClient;
}

export function GrowthForm({ client: c }: GrowthFormProps) {
  const store = useGrowthStore();
  const g = store.g;
  const updateConfig = useConfigStore((s) => s.update);
  const cfg = useConfigStore((s) => s.config) as GpConfig;

  const plans = c?.growthPlans || [];

  return (
    <div className="flex flex-col gap-1">
      {/* Client picker */}
      <div className="mb-4">
        <label className="block text-[10px] font-semibold text-muted tracking-wide uppercase mb-1.5">
          Client — type to search, or pick from the list
        </label>
        <Input
          list="gp-client-list"
          defaultValue={c?.name || ""}
          placeholder="Start typing a client name…"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const v = e.target.value;
            if (!store.setClientByName(v)) {
              // keep typing; only warn when it clearly doesn't match on blur-like change
            }
          }}
        />
        <datalist id="gp-client-list">
          {(cfg.clients || []).map((x) => (
            <option key={x.id} value={x.name} />
          ))}
        </datalist>
      </div>

      {/* Mode toggle */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {([
          ["strategy", "🧪 Strategy", "Proof of concept — new client, find what works"],
          ["growth", "📈 Growth", "Scaling — proven script, scale to X bookings"],
        ] as Array<[GrowthMode, string, string]>).map(([mode, title, sub]) => (
          <button
            key={mode}
            type="button"
            onClick={() => store.setMode(mode)}
            className={cn(
              "text-left rounded-lg border p-3 transition-colors",
              g.mode === mode ? "border-accent bg-[var(--tint-accent)]" : "border-border bg-bg2 hover:border-accent",
            )}
          >
            <div className="text-[13px] font-semibold text-text">{title}</div>
            <div className="text-[11px] text-muted leading-snug mt-0.5">{sub}</div>
          </button>
        ))}
      </div>

      {/* Seed from the builder */}
      {g.seed && (
        <Card className="mb-4 border-accent/45">
          <div className="p-3">
            <div className="text-[12px] font-semibold text-accent2 mb-1">📥 From the Builder</div>
            <div className="text-xs text-subtle leading-relaxed">
              {g.seed.nicheName && (
                <>Niche: <b className="text-text">{g.seed.nicheName}</b><br /></>
              )}
              {!!g.seed.angles.length && (
                <>
                  Angles:{" "}
                  {g.seed.angles.map((a, i) => (
                    <Badge key={i} tone="accent" className="mr-1">{a}</Badge>
                  ))}
                  <br />
                </>
              )}
              Script: <b className="text-text">{g.seed.script.label}</b>{" "}
              <Badge tone={g.seed.script.status === "winning" ? "green" : "accent"}>
                {g.seed.script.status || "idea"}
              </Badge>
            </div>
            <div className="text-[11px] text-muted mt-1.5">
              {g.mode === "growth" ? "Set as the winning script below." : "New targets pick these angles + this script automatically."}{" "}
              <button type="button" className="text-accent2 underline" onClick={store.dismissSeed}>
                Dismiss
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* Saved plans */}
      {!!plans.length && (
        <div className="mb-4">
          <div className="text-[10px] font-semibold text-muted uppercase tracking-wide mb-1.5">
            Saved plans for {c.name}
          </div>
          {plans.map((p: GpSavedPlan) => (
            <div key={p.id} className="flex items-center justify-between gap-2 bg-bg2 border border-border rounded-md px-3 py-2 mb-1.5">
              <div className="min-w-0">
                <b className="text-xs">{p.title}</b>{" "}
                <Badge tone={p.mode === "growth" ? "green" : "accent"}>{p.mode}</Badge>
                <div className="text-[10px] text-muted truncate">
                  {(p.channels || []).map((ch: string) => CH_LABEL[ch]).join(" · ")} · {p.createdAt || ""}
                  {p.notionUrl && (
                    <>
                      {" · "}
                      <a href={p.notionUrl} target="_blank" rel="noreferrer" className="text-accent2">Notion ↗</a>
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <Button size="sm" variant="mini" onClick={() => { store.loadPlan(p.id); notify("Plan loaded"); }}>Open</Button>
                <Button size="sm" variant="danger" onClick={() => { if (window.confirm("Delete this growth plan?")) { store.deletePlan(p.id); notify("Plan deleted"); } }}>Del</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Client brief */}
      <ClientBrief client={c} />

      {/* Step 1: channel */}
      <Step num={1} title="Channel">
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map((ch) => (
            <Chip key={ch} selected={g.channels.includes(ch)} onClick={() => store.toggleChannel(ch)}>
              {CH_LABEL[ch]}
            </Chip>
          ))}
        </div>
      </Step>

      {g.mode === "strategy" ? <StrategyForm client={c} /> : <GrowthModeForm client={c} />}

      <ReservoirPicker client={c} />
      <FollowupsSection client={c} />

      {g.mode === "strategy" && <AssumptionsForm />}
      <ToolsForm />
    </div>
  );

  // ── client brief sub-form (legacy gpBuildClientBrief :5572) ──
  function ClientBrief({ client: cl }: { client: GpClient }) {
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState("");

    const briefIcps: GpIcp[] =
      g.mode === "strategy"
        ? g.targets
            .map((t) => (cl.icps || []).find((i) => i.id === t.icpId))
            .filter((i): i is GpIcp => !!i)
        : [];
    const withEx = briefIcps.filter((i) => i.example).length;

    async function build() {
      if (!getAdminKey()) { notify("No admin key", true); return; }
      if (!cl) return;
      setBusy(true);
      try {
        const lines: string[] = [];
        lines.push(`Client: ${cl.name} (${cl.meta || ""})`);
        if (cl.caseStudy?.mechanism) lines.push(`How they get results: ${cl.caseStudy.mechanism}`);
        if (cl.caseStudy?.proofLine) lines.push(`Proof line: ${cl.caseStudy.proofLine}`);
        const offers = clientOffers(cl);
        if (offers.length) lines.push(`Services / offers:\n${offers.join("\n")}`);
        if ((cl.competitorIntel || []).length)
          lines.push(
            `Competitors:\n${(cl.competitorIntel || [])
              .map((x) => `${x.name}: offer=${x.offer || "?"}; mechanism=${x.mechanism || "?"}${x.guarantee ? "; guarantee=" + x.guarantee : ""}`)
              .join("\n")}`,
          );
        setStatus("Writing the brief…");
        const r = await api({ action: "compose_client_brief", context: lines.join("\n\n"), rules: cfg.settings?.growthRules || "" });
        updateConfig((draft) => {
          const cd = (draft.clients as GpClient[]).find((x) => x.id === cl.id);
          if (cd)
            cd.brief = {
              services: r.services || [],
              positioning: r.positioning || "",
              caseStudies: r.caseStudies || [],
              competitors: r.competitors || [],
              builtAt: new Date().toISOString().slice(0, 10),
            };
        });
        // One real example company per chosen ICP (cached on the ICP).
        const need = briefIcps.filter((i) => !i.example);
        for (let k = 0; k < need.length; k++) {
          setStatus(`Finding an example client for "${need[k].title}"… (${k + 1}/${need.length})`);
          try {
            const ex = await api({
              action: "find_icp_example",
              icp: { title: need[k].title, niche: need[k].niche, jobTitles: need[k].jobTitles, employeeSize: need[k].employeeSize, locations: need[k].locations },
            });
            if (ex.company) {
              updateConfig((draft) => {
                const cd = (draft.clients as GpClient[]).find((x) => x.id === cl.id);
                const icp = (cd?.icps || []).find((i) => i.id === need[k].id);
                if (icp) icp.example = { company: ex.company, website: ex.website || "", why: ex.why || "" };
              });
            }
          } catch { /* ignore one ICP failing */ }
        }
        setStatus("");
        notify("🧾 Client brief ready — it now opens the plan");
      } catch (e) {
        setStatus("⚠️ " + (e as Error).message);
        notify("Brief failed: " + (e as Error).message, true);
      }
      setBusy(false);
    }

    return (
      <Card className="mb-4 border-amber/35">
        <div className="p-3">
          <div className="text-[12px] font-semibold text-amber mb-1">🧾 Client brief — opens the plan with their research</div>
          <div className="text-[11px] text-muted mb-2 leading-snug">
            {cl?.brief
              ? `✓ Built ${cl.brief.builtAt || ""} — services, positioning, ${(cl.brief.caseStudies || []).length} case studies, ${(cl.brief.competitors || []).length} competitors${briefIcps.length ? ` · example clients: ${withEx}/${briefIcps.length} ICPs` : ""}.`
              : "Turns the profile into simple, clear, client facing copy (services, positioning, case studies, competitors) and finds one real example company per chosen ICP via web search."}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={build} disabled={busy} icon={busy ? undefined : "file-text"}>
              {busy ? <Spinner size="sm" /> : cl?.brief ? "Rebuild client brief" : "Build client brief"}
            </Button>
            {status && <span className="text-[11px] text-muted">{status}</span>}
          </div>
        </div>
      </Card>
    );
  }

  // ── strategy targets (legacy gpStrategyForm :5221) ──
  function StrategyForm({ client: cl }: { client: GpClient }) {
    const icps: GpIcp[] = cl?.icps || [];
    if (!icps.length) {
      return (
        <Step num={2} title="Targets">
          <div className="text-[12px] text-muted bg-bg2 border border-border rounded-md p-3">
            No ICPs saved for {cl?.name || "this client"} yet. Build them in the client profile (ICP Builder), then come back.
          </div>
        </Step>
      );
    }
    return (
      <Step num={2} title="Targets — pick up to 3" count={`${g.targets.length}/3`}>
        {icps.map((icp) => {
          const t = g.targets.find((x) => x.icpId === icp.id);
          const on = !!t;
          return (
            <div key={icp.id} className={cn("mb-2 rounded-lg border", on ? "border-accent" : "border-border")}>
              <button
                type="button"
                onClick={() => {
                  if (!on && g.targets.length >= 3) { notify("Max 3 targets — keep the test focused", true); return; }
                  store.toggleTarget(icp.id);
                }}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left"
              >
                <span className="text-[13px] font-semibold text-text">
                  {on ? "★ " : "☆ "}{icp.title}
                </span>
                <Badge tone={Number(icp.score) >= 8 ? "green" : "neutral"}>
                  {icp.score ? "fit " + icp.score + "/10" : "select"}
                </Badge>
              </button>
              {on && t && <TargetBody client={cl} icp={icp} target={t} />}
            </div>
          );
        })}
      </Step>
    );
  }

  function TargetBody({ client: cl, icp, target: t }: { client: GpClient; icp: GpIcp; target: WorkingTarget }) {
    const [gen, setGen] = useState(false);
    const pains = clientPains(cl);
    const angles = clientAnglePool(cl);
    const scripts = clientScriptPool(cl);
    const offers = clientOffers(cl);
    const fwId = t.fwId || cfg.frameworks?.[0]?.id || "";

    async function writeScripts() {
      if (!getAdminKey()) { notify("No admin key", true); return; }
      const fw = (cfg.frameworks || []).find((f) => f.id === fwId);
      if (!fw) { notify("Pick a framework first", true); return; }
      const useAngles = (t.angles.length ? t.angles : clientAnglePool(cl).slice(0, 2)).slice(0, 2);
      if (!useAngles.length) { notify("Add at least one angle to this target", true); return; }
      store.setTargetFramework(icp.id, fw.id);
      setGen(true);
      try {
        const r = await api({
          action: "generate",
          prospect: {},
          client: {
            name: cl.name,
            caseStudy: { ...(cl.caseStudy || {}), pains: t.pains.length ? t.pains : clientPains(cl) },
            emphasis: { pains: t.pains, desires: [], caseStudies: cl.favorites?.caseStudies || [], offers: t.offer ? [t.offer] : [] },
            frameworkOverride: (cl.frameworkOverrides || {})[primaryNicheId(cl) as string] || "",
            avoid: cl.avoid || [],
            competitorIntel: "",
          },
          niche: { name: t.niche || "", triggerWords: (cfg.niches || []).find((n) => n.id === primaryNicheId(cl))?.triggerWords || [] },
          frameworks: [{ id: fw.id, name: fw.name, category: fw.category, template: fw.template, rules: fw.rules }],
          angles: useAngles,
          variantsPerAngle: 1,
          globalRules: cfg.settings?.globalRules || "",
          guarantee: cl.guarantees?.[0]?.text || "",
          icp: { title: icp.title, niche: icp.niche, jobTitles: icp.jobTitles || [], locations: icp.locations || [], employeeSize: icp.employeeSize || "", revenue: icp.revenue || "", outboundNotes: icp.outboundNotes || "" },
        });
        const variants = (r.results || []).flatMap((res: { framework?: string; variants?: Array<{ angle?: string; script?: string }> }) =>
          (res.variants || []).map((v) => ({ label: `${res.framework} · ${v.angle || ""}`, text: v.script || "", ai: true })),
        );
        if (!variants.length) throw new Error("no scripts returned");
        store.setTargetScripts(icp.id, variants.slice(0, 2));
        notify("✨ 2 scripts written for " + (icp.title || "this target"));
      } catch (e) {
        notify("Generate failed: " + (e as Error).message, true);
      }
      setGen(false);
    }

    return (
      <div className="px-3 pb-3 border-t border-border pt-3">
        <SubLabel>Key pains to push (pick the few that matter)</SubLabel>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {pains.length ? (
            pains.map((p) => (
              <Chip key={p} star tone="red" selected={t.pains.includes(p)} onClick={() => store.toggleTargetItem(icp.id, "pains", p)}>
                {p}
              </Chip>
            ))
          ) : (
            <span className="text-[11px] text-muted">No pains on file.</span>
          )}
        </div>

        <SubLabel>2 angles</SubLabel>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {angles.length ? (
            angles.map((a) => (
              <Chip key={a} selected={t.angles.includes(a)} onClick={() => store.toggleTargetItem(icp.id, "angles", a)}>
                {a}
              </Chip>
            ))
          ) : (
            <span className="text-[11px] text-muted">No angles on file.</span>
          )}
        </div>

        <SubLabel>2 scripts to test</SubLabel>
        <div className="flex gap-1.5 items-center mb-2">
          <Select
            className="flex-1 !text-xs !py-1.5"
            value={fwId}
            onChange={(e) => store.setTargetFramework(icp.id, e.target.value)}
          >
            {(cfg.frameworks || []).map((f: GpFramework) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </Select>
          <Button size="sm" variant="secondary" onClick={writeScripts} disabled={gen} icon={gen ? undefined : "sparkles"}>
            {gen ? <Spinner size="sm" /> : "Write 2 with AI"}
          </Button>
        </div>
        {t.scripts.map((s, i) => (
          <div key={i} className="bg-bg2 border border-accent rounded-md p-2 mb-1.5 text-xs">
            <b>{s.label}</b>
            {s.ai && <span className="text-accent2 ml-1">✨ AI</span>}
            <div className="text-muted mt-0.5">{s.text.slice(0, 110)}…</div>
            <button type="button" className="text-red text-[10px] mt-1" onClick={() => store.removeTargetScript(icp.id, i)}>
              remove
            </button>
          </div>
        ))}
        <div className="text-[11px] text-muted mb-1.5">…or pick from the reservoir</div>
        {scripts.length ? (
          scripts.map((s, i) => {
            const sel = t.scripts.some((x) => x.text === s.text);
            return (
              <button
                key={i}
                type="button"
                onClick={() => store.toggleTargetScript(icp.id, i)}
                className={cn("w-full text-left bg-bg2 border rounded-md p-2 mb-1.5 text-xs", sel ? "border-accent" : "border-border")}
              >
                <span>{sel ? "☑" : "☐"}</span> <b>{s.label}</b>{" "}
                <span className="text-muted">{s.status}{s.note ? " · " + s.note : ""}</span>
                <div className="text-muted mt-0.5">{s.text.slice(0, 90)}…</div>
              </button>
            );
          })
        ) : (
          <div className="text-[12px] text-muted">No saved scripts yet — use “Write 2 with AI” above, or generate in the Builder.</div>
        )}

        <SubLabel>Offer</SubLabel>
        <div className="flex flex-wrap gap-1.5">
          {(offers.length ? offers : ["(no offers on file)"]).map((o) => (
            <Chip key={o} selected={t.offer === o} onClick={() => store.setTargetOffer(icp.id, o)}>
              {o}
            </Chip>
          ))}
        </div>
      </div>
    );
  }

  // ── growth/scaling form (legacy gpGrowthForm :5267) ──
  function GrowthModeForm({ client: cl }: { client: GpClient }) {
    const winning = clientScriptPool(cl).filter((s) => s.status === "winning");
    const pool = winning.length ? winning : clientScriptPool(cl);

    return (
      <>
        <Step num={2} title="The winning script">
          {pool.length ? (
            pool.map((s, i) => {
              const sel = g.winningScript?.text === s.text;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => store.setWinningScript({ label: s.label, text: s.text, note: s.note })}
                  className={cn("w-full text-left bg-bg2 border rounded-md p-2 mb-1.5 text-xs", sel ? "border-accent" : "border-border")}
                >
                  <span>{sel ? "☑" : "☐"}</span> <b>{s.label}</b>{" "}
                  <span className="text-muted">{s.status}{s.note ? " · " + s.note : ""}</span>
                  <div className="text-muted mt-0.5">{s.text.slice(0, 100)}…</div>
                </button>
              );
            })
          ) : (
            <div className="text-[12px] text-muted">No scripts saved yet — find a winner in the Builder/Reservoir first.</div>
          )}
        </Step>

        <Step num={3} title="Observed campaign metrics">
          <div className="text-[11px] text-muted mb-2">
            Enter what this script actually did — the scale math runs off these real rates, not assumptions.
          </div>
          {g.channels.map((ch) => {
            const o = g.observed[ch] || { contacted: 0, replies: 0, positive: 0, booked: 0 };
            return (
              <div key={ch} className="mb-2">
                <SubLabel>{CH_LABEL[ch]}</SubLabel>
                <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 items-center">
                  <ObsRow label={ch === "email" ? "Contacted" : "Connections sent"} value={o.contacted} onChange={(v) => store.setObserved(ch, "contacted", v)} />
                  <ObsRow label="Replies" value={o.replies} onChange={(v) => store.setObserved(ch, "replies", v)} />
                  <ObsRow label="Positive replies" value={o.positive} onChange={(v) => store.setObserved(ch, "positive", v)} />
                  <ObsRow label="Booked calls" value={o.booked} onChange={(v) => store.setObserved(ch, "booked", v)} />
                </div>
              </div>
            );
          })}
        </Step>

        <Step num={4} title="Niche size & target">
          <label className="block text-[10px] font-semibold text-muted uppercase tracking-wide mb-1.5">
            How big is the niche (reachable prospects)
          </label>
          <Input
            value={g.nicheSize}
            placeholder="e.g. ~34K — from the ICP builder"
            onChange={(e) => store.setNicheSize(e.target.value)}
          />
          {!!(cl?.icps || []).length && (
            <div className="text-[11px] text-muted mt-1">
              From saved ICPs:{" "}
              {(cl.icps || []).map((i, idx) => (
                <button key={idx} type="button" className="text-accent2 underline mr-2" onClick={() => store.useIcpSize(idx)}>
                  {i.marketSize || i.title}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-[1fr_auto] gap-3 items-center mt-3">
            <span className="text-xs text-subtle">Target bookings / month</span>
            <NumberInput value={g.targetBookings} onValueChange={(v) => store.setTargetBookings(v)} />
          </div>
        </Step>
      </>
    );
  }

  // ── assumptions (legacy gpAssumptionsForm :5303) — strategy only ──
  function AssumptionsForm() {
    const numRow = (ch: "email" | "linkedin", key: string, label: string, pct?: boolean) => {
      const a = g.assumptions[ch] as Record<string, number>;
      return (
        <div key={key} className="grid grid-cols-[1fr_auto] gap-3 items-center mb-1.5">
          <span className="text-xs text-subtle">{label}{pct ? " (%)" : ""}</span>
          {pct ? (
            <NumberInput
              percent
              step={0.5}
              value={rateFractionToDisplay(a[key] || 0)}
              onValueChange={(v) => store.setAssumptionPct(ch, key, v)}
            />
          ) : (
            <NumberInput value={a[key] ?? 0} onValueChange={(v) => store.setAssumption(ch, key, v)} />
          )}
        </div>
      );
    };
    return (
      <Step num={3} title="Volumes, targets & assumptions">
        <SubLabel>🎯 Book-in target</SubLabel>
        <div className="grid grid-cols-[1fr_auto] gap-3 items-center mb-2">
          <span className="text-xs text-subtle">Booked calls / mo to hit</span>
          <NumberInput value={g.targetBookings} onValueChange={(v) => store.setTargetBookings(v)} />
        </div>
        {g.channels.map((ch) => (
          <div key={ch}>
            <SubLabel>{CH_LABEL[ch]}</SubLabel>
            {ch === "email" ? (
              <>
                {numRow("email", "verifyRate", "Verify rate", true)}
                {numRow("email", "sendsPerLead", "Sends / lead")}
                {numRow("email", "replyRate", "Reply rate", true)}
                {numRow("email", "positiveRate", "Positive / reply", true)}
                {numRow("email", "bookRate", "Book / positive", true)}
                {numRow("email", "sendsPerInboxPerDay", "Sends / inbox / day")}
                {numRow("email", "sendingDays", "Sending days / mo")}
                {numRow("email", "inboxCostMo", "Cost / inbox / mo")}
              </>
            ) : (
              <>
                {numRow("linkedin", "connectsPerDay", "Connects / day")}
                {numRow("linkedin", "daysPerMonth", "Sending days / mo")}
                {numRow("linkedin", "acceptRate", "Accept rate", true)}
                {numRow("linkedin", "replyRate", "Reply / accepted", true)}
                {numRow("linkedin", "positiveRate", "Positive / reply", true)}
                {numRow("linkedin", "bookRate", "Book / positive", true)}
                {numRow("linkedin", "connectsPerProfilePerDay", "Connects / profile / day")}
                {numRow("linkedin", "profileCostMo", "Cost / profile / mo")}
              </>
            )}
          </div>
        ))}
        <SubLabel>Personalization ({String(g.assumptions.personalization.model || "")})</SubLabel>
        <div className="grid grid-cols-[1fr_auto] gap-3 items-center mb-1.5">
          <span className="text-xs text-subtle">Input tokens / lead</span>
          <NumberInput value={(g.assumptions.personalization.inputTokensPerLead as number) ?? 0} onValueChange={(v) => store.setPersonalization("inputTokensPerLead", v)} />
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-3 items-center">
          <span className="text-xs text-subtle">Output tokens / lead</span>
          <NumberInput value={(g.assumptions.personalization.outputTokensPerLead as number) ?? 0} onValueChange={(v) => store.setPersonalization("outputTokensPerLead", v)} />
        </div>
      </Step>
    );
  }

  // ── tools & costs (legacy gpToolsForm :5330) ──
  function ToolsForm() {
    const tools = selectableTools(g.channels);
    return (
      <Step title="🧰 Tools & costs">
        {tools.map((t: GpToolKB) => {
          const sel = g.toolIds.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => store.toggleTool(t.id)}
              className={cn("w-full text-left bg-bg2 border rounded-md p-2 mb-1.5 text-xs", sel ? "border-accent" : "border-border")}
            >
              <span>{sel ? "☑" : "☐"}</span> <b>{t.name}</b>{" "}
              <span className="text-muted">{toolCostLabel(t)}</span>
              <div className="text-muted mt-0.5">{t.why}</div>
            </button>
          );
        })}
        <div className="flex items-center justify-between gap-3 bg-bg2 border border-border rounded-md px-3 py-2 mt-2.5">
          <span className="text-xs text-subtle"><b>🤖 AI reply agent</b> — books replies; client signs up</span>
          <Toggle checked={g.toggles.replyAgent} onChange={(v) => store.setToggle("replyAgent", v)} />
        </div>
        <div className="flex items-center justify-between gap-3 bg-bg2 border border-border rounded-md px-3 py-2 mt-1.5">
          <span className="text-xs text-subtle"><b>✅ Performance pledge</b> — off for pure tests</span>
          <Toggle checked={g.toggles.pledge} onChange={(v) => store.setToggle("pledge", v)} />
        </div>
        {g.toggles.pledge && (
          <Textarea
            className="mt-1.5"
            placeholder="The pledge / guarantee text…"
            value={g.toggles.pledgeText}
            onChange={(e) => store.setToggle("pledgeText", e.target.value)}
          />
        )}
      </Step>
    );
  }

  // ── reservoir picker (legacy gpReservoirPicker :5468) ──
  function ReservoirPicker({ client: cl }: { client: GpClient }) {
    const [open, setOpen] = useState(false);
    if (!cl) return null;
    const scripts = clientScriptPool(cl);
    const angles = clientAnglePool(cl);
    const untargeted = (cl.icps || []).filter((i) => !g.targets.some((t) => t.icpId === i.id));
    const active = store.activeTarget();

    return (
      <Accordion
        open={open}
        onToggle={() => setOpen((o) => !o)}
        title={`📥 Pull from the reservoir — scripts, angles${g.mode === "strategy" ? ", niches" : ""}`}
        className="mt-1.5 mb-2.5"
      >
        <div className="text-[11px] text-muted mb-2">
          {g.mode === "growth"
            ? "Adding a script sets it as the winning script."
            : active
              ? <>Scripts &amp; angles attach to: <b>{active.title}</b> (your last-selected target).</>
              : "Add a niche as a target first, then attach scripts & angles."}
        </div>
        <SubLabel>Scripts</SubLabel>
        {scripts.length ? (
          scripts.map((s, i) => (
            <div key={i} className="flex items-center gap-2 bg-bg2 border border-border rounded-md p-2 mb-1.5 text-xs">
              <span className="flex-1 min-w-0">
                <b>{s.label}</b> <span className="text-muted">{s.status}{s.note ? " · " + s.note : ""}</span>
                <div className="text-muted truncate">{s.text.slice(0, 80)}…</div>
              </span>
              <Button size="sm" variant="mini" onClick={() => {
                const res = store.pullScript(i);
                if (res === "no-target") notify("Add a niche as a target first", true);
                else if (res === "winning") notify("Set as winning script");
                else if (res) notify(`Added to ${res}`);
              }}>+ Add</Button>
            </div>
          ))
        ) : (
          <div className="text-[12px] text-muted mb-2">No saved scripts in the reservoir yet.</div>
        )}
        <SubLabel>Angles</SubLabel>
        {angles.length ? (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {angles.map((a) => (
              <Chip key={a} onClick={() => {
                const res = store.pullAngle(a);
                if (res === "no-target") notify("Add a niche as a target first", true);
                else if (res) notify(`Angle added to ${res}`);
              }}>{a} +</Chip>
            ))}
          </div>
        ) : (
          <div className="text-[12px] text-muted mb-2">No saved angles yet.</div>
        )}
        {g.mode === "strategy" && (
          <>
            <SubLabel>Niches / ICPs</SubLabel>
            {untargeted.length ? (
              untargeted.map((i) => (
                <div key={i.id} className="flex items-center gap-2 bg-bg2 border border-border rounded-md p-2 mb-1.5 text-xs">
                  <span className="flex-1 min-w-0">
                    <b>{i.title}</b> <span className="text-muted">{i.niche || ""}{i.marketSize ? " · " + i.marketSize : ""}</span>
                  </span>
                  <Button size="sm" variant="mini" onClick={() => {
                    if (g.targets.length >= 3) { notify("Max 3 targets — keep the test focused", true); return; }
                    store.toggleTarget(i.id);
                  }}>+ Add target</Button>
                </div>
              ))
            ) : (
              <div className="text-[12px] text-muted">All ICPs are already targets.</div>
            )}
          </>
        )}
      </Accordion>
    );
  }

  // ── follow-ups (legacy gpFollowupsSection :5524) ──
  function FollowupsSection({ client: cl }: { client: GpClient }) {
    const [open, setOpen] = useState(false);
    if (!cl) return null;
    const seqs: GpFollowupSeq[] = cl.followups || [];
    return (
      <Accordion
        open={open}
        onToggle={() => setOpen((o) => !o)}
        title="↪ Outbound follow-ups — attach sequences to this plan"
        className="mb-2.5"
      >
        <div className="text-[11px] text-muted mb-2">
          Attached sequences appear in the plan as a dropdown, and export to Notion as a collapsible toggle.
        </div>
        {seqs.length ? (
          seqs.map((s) => {
            const on = g.followupIds.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => store.toggleFollowup(s.id)}
                className={cn("w-full text-left bg-bg2 border rounded-md p-2 mb-1.5 text-xs", on ? "border-accent" : "border-border")}
              >
                <span>{on ? "☑" : "☐"}</span> <b>{s.parentLabel}</b>{" "}
                <span className="text-muted">{s.items.length} follow-ups · {s.createdAt}</span>
                <div className="text-muted mt-0.5">
                  {s.items.map((it) => `Day +${it.day}: ${(it.framework || "").slice(0, 22)}`).join(" · ")}
                </div>
              </button>
            );
          })
        ) : (
          <div className="text-[12px] text-muted">No follow-up sequences saved yet. Build them on the client&apos;s Overview board (a script card → ↪ Follow-ups, or “Create new script” → Follow-up sequence).</div>
        )}
      </Accordion>
    );
  }
}

// ── tiny shared bits ──
function SubLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-semibold text-muted uppercase tracking-wide mb-1.5 mt-2">{children}</div>;
}

function ObsRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <>
      <span className="text-xs text-subtle">{label}</span>
      <NumberInput value={value} onValueChange={onChange} />
    </>
  );
}
