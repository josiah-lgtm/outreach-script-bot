// MATRIX BUILDER (/build) — the de-emphasized legacy generation grid. Faithful port of the
// legacy renderBuilder/generate/substitute/renderOutput/saveToReservoir/copyAll/exportCsv
// (legacy/index.html :1991-2404, :2889-2910). The reservoir BOARD is NOT here — that lives in
// the Kanban screen; this page only WRITES into a client's scriptReservoir via the 💾 action.
//
// Reuses: the `generate` server action (via api()), the CSV lib (formula-injection defang),
// dedupe is not needed here (the matrix is the user's explicit grid, not a dedup deck),
// ScriptEditModal for per-card editing, and the wizard data aggregators. Every config read is
// a useConfigStore selector; every mutation goes through useConfigStore.getState().update().

"use client";

import { useMemo, useState } from "react";
import { useConfigStore } from "@/lib/store/configStore";
import { frameworksForNiche } from "@/lib/sync/configClient";
import {
  clientPains,
  clientDesires,
  clientOffers,
  clientCaseStudies,
  primaryNicheId,
} from "@/lib/sync/wizard";
import { api } from "@/lib/sync/api";
import { getAdminKey } from "@/lib/sync/adminKey";
import type { Config, Client, Niche, Framework } from "@/lib/sync/types";
import { substitute as subst, uid, nextScriptName } from "@/lib/text-utils";
import { buildCsv, downloadCsv, type ScriptRow } from "@/lib/csv";
import { notify } from "@/lib/notify";
import { ScriptEditModal, type ScriptVersion } from "@/components/ScriptEditModal";
import {
  Button,
  Card,
  Chip,
  Select,
  Input,
  SegmentedControl,
  Accordion,
  Tabs,
  Icon,
  Badge,
  EmptyState,
  LoadingState,
  type TabItem,
  type SegmentOption,
} from "@/components/ui";

// ─── Result shapes returned by the `generate` server action ──────────────────
interface VariantOut {
  angle?: string;
  label?: string;
  script?: string;
  _versions?: ScriptVersion[];
}
interface FrameworkResult {
  frameworkId?: string;
  framework?: string;
  category?: string;
  fills?: Record<string, string>;
  variants?: VariantOut[];
  error?: string;
}
interface ResearchResult {
  ok?: boolean;
  url?: string;
  summary?: string;
  pains?: string[];
  hooks?: string[];
  error?: string;
}

// A flattened, merge-tag-substituted script row keyed back to its source framework result.
interface FlatScript {
  framework: string;
  category: string;
  fwId: string;
  angle: string;
  label: string;
  n: number; // variant number within its framework (1-based)
  script: string;
  vref: VariantOut;
}

type BuildTab = "scripts" | "frameworks" | "research";

const VARIANT_OPTS: SegmentOption<number>[] = [1, 2, 3].map((v) => ({ value: v, label: String(v) }));

export default function BuildPage() {
  // ── Config reads (selectors) ──────────────────────────────────────────────
  const clients = useConfigStore((s) => s.config.clients) as Client[] | undefined;
  const niches = useConfigStore((s) => s.config.niches) as Niche[] | undefined;
  const allFrameworks = useConfigStore((s) => s.config.frameworks) as Framework[] | undefined;
  const globalRules = useConfigStore((s) => s.config.settings?.globalRules) as string | undefined;

  // ── Builder selection state (ephemeral) ───────────────────────────────────
  const [clientId, setClientId] = useState<string>("");
  const [nicheId, setNicheId] = useState<string>("");
  const [selectedIcpId, setSelectedIcpId] = useState<string | null>(null);
  const [angles, setAngles] = useState<Set<string>>(new Set());
  const [fwIds, setFwIds] = useState<Set<string>>(new Set());
  const [variantsPer, setVariantsPer] = useState<number>(1);

  // ── Prospect personalization + research cache ─────────────────────────────
  const [fname, setFname] = useState("");
  const [company, setCompany] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [classification, setClassification] = useState("");
  const [customPain, setCustomPain] = useState("");
  const [doResearch, setDoResearch] = useState(true);
  const [research, setResearch] = useState<ResearchResult | null>(null);
  const [researchKey, setResearchKey] = useState("");

  // ── Generation + output state ─────────────────────────────────────────────
  const [results, setResults] = useState<FrameworkResult[] | null>(null);
  const [openAngles, setOpenAngles] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<BuildTab>("scripts");
  const [generating, setGenerating] = useState(false);
  const [step, setStep] = useState(-1); // -1 none, 0 research, 1 writing, 2 packaging
  const [genError, setGenError] = useState("");
  const [editIdx, setEditIdx] = useState<number | null>(null);

  // ── Derived: selected client / niche, niche-grouped select options ────────
  const client = useMemo(() => (clients || []).find((c) => c.id === clientId) || null, [clients, clientId]);
  const niche = useMemo(() => (niches || []).find((n) => n.id === nicheId) || null, [niches, nicheId]);

  // Frameworks visible for the active niche (global + niche-scoped) — legacy frameworksForNiche.
  const visibleFws = useMemo(
    () => (nicheId ? frameworksForNiche(nicheId, { frameworks: allFrameworks } as Config) : []) as Framework[],
    [nicheId, allFrameworks],
  );

  // The angle cloud: niche angles + transcript angles + this client's saved angles (deduped).
  const angleItems = useMemo(() => {
    const seen = new Set<string>();
    const out: { text: string; ico: string }[] = [];
    const push = (text: unknown, ico: string) => {
      const t = String(text ?? "").trim();
      if (!t || seen.has(t)) return;
      seen.add(t);
      out.push({ text: t, ico });
    };
    (niche?.angles || []).forEach((a: string) => push(a, "🎯"));
    (client?.transcripts || []).forEach((t: { angles?: string[] }) => (t.angles || []).forEach((a) => push(a, "📞")));
    (client?.savedAngles || [])
      .filter((x: { nicheId?: string }) => !x.nicheId || x.nicheId === nicheId)
      .forEach((x: { text?: string; src?: string }) =>
        push(x.text, x.src === "composed" ? "🤚" : x.src === "ai" ? "✨" : "✍️"),
      );
    return out;
  }, [niche, client, nicheId]);

  const icps = (client?.icps || []) as { id: string; title: string; [k: string]: unknown }[];
  const activeIcp = icps.find((i) => i.id === selectedIcpId) || null;

  // Live count + the front-end clamp ceiling (tighter than the server cap): angles × variants.
  const perFwMax = angles.size * variantsPer;
  const total = fwIds.size * perFwMax;

  // ── Selection handlers ────────────────────────────────────────────────────
  function pickClient(id: string) {
    setClientId(id);
    const c = (clients || []).find((x) => x.id === id) || null;
    // Default to the client's primary niche, seeding a few of its angles (legacy seeding).
    const nid = (primaryNicheId(c) as string) || (niches || [])[0]?.id || "";
    setNicheId(nid);
    const n = (niches || []).find((x) => x.id === nid) || null;
    setAngles(new Set(((n?.angles || []) as string[]).slice(0, 3)));
    setFwIds(new Set());
    setSelectedIcpId(null);
  }

  function pickNiche(nid: string) {
    setNicheId(nid);
    // Drop any selected frameworks no longer visible for the new niche (legacy prune).
    const vis = nid ? (frameworksForNiche(nid, { frameworks: allFrameworks } as Config) as Framework[]) : [];
    setFwIds((prev) => new Set([...prev].filter((id) => vis.some((f) => f.id === id))));
  }

  const toggleAngle = (a: string) =>
    setAngles((prev) => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a);
      else next.add(a);
      return next;
    });
  const toggleFw = (id: string) =>
    setFwIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleIcp = (id: string) => setSelectedIcpId((prev) => (prev === id ? null : id));

  // ── Merge-tag substitution (port of legacy substitute(), reads the prospect fields) ──
  const substitute = (script: unknown) => subst(script, { firstName: fname, company });

  // ── GENERATE ──────────────────────────────────────────────────────────────
  async function generate() {
    if (!client) return notify("Select a client first", true);
    if (!niche) return notify("Select a niche first", true);
    if (!angles.size) return notify("Pick at least one angle", true);
    if (!fwIds.size) return notify("Pick at least one framework", true);
    if (!getAdminKey()) return notify("No admin key — open the app once with ?admin=YOUR_KEY", true);

    const fws = (allFrameworks || []).filter((f) => fwIds.has(f.id));
    const angleList = Array.from(angles);
    const url = companyUrl.trim();
    const cls = classification.trim();
    const willResearch = doResearch && !!url;

    setGenerating(true);
    setGenError("");
    setTab("scripts");
    setStep(willResearch ? 0 : 1);

    try {
      // STEP 1 — research the prospect site (cached by url|classification so re-generating with
      // tweaked frameworks/angles doesn't pay for a fresh research call every time).
      let activeResearch = research;
      if (willResearch) {
        const key = url + "|" + cls;
        if (research?.ok && researchKey === key) {
          activeResearch = research;
        } else {
          try {
            const r = (await api({ action: "research", url, classification: cls })) as ResearchResult;
            activeResearch = r;
            setResearch(r);
            setResearchKey(key);
          } catch (e) {
            activeResearch = { ok: false, error: (e as Error).message };
            setResearch(activeResearch);
            setResearchKey("");
            notify("Research failed: " + (e as Error).message + " — generating without it", true);
          }
        }
      }
      setStep(1);

      // Build the client case-study payload (capped lists, mirrors legacy).
      const fav = (client.favorites || { pains: [], desires: [], caseStudies: [], offers: [] }) as {
        pains: string[];
        desires: string[];
        caseStudies: string[];
        offers: string[];
      };
      const caseStudyOut: Record<string, unknown> = { ...(client.caseStudy || {}) };
      caseStudyOut.pains = clientPains(client).slice(0, 30);
      caseStudyOut.desires = clientDesires(client).slice(0, 30);
      caseStudyOut.offers = clientOffers(client).slice(0, 30);
      caseStudyOut.caseStudies = clientCaseStudies(client).slice(0, 20);
      if (fav.caseStudies?.length) caseStudyOut.caseStudies = fav.caseStudies;
      if (fav.offers?.length) caseStudyOut.offers = fav.offers;

      const icp = activeIcp as
        | {
            title?: string;
            niche?: string;
            jobTitles?: string[];
            locations?: string[];
            employeeSize?: string;
            revenue?: string;
            outboundNotes?: string;
          }
        | null;

      const data = (await api({
        action: "generate",
        prospect: { fname: fname.trim(), company: company.trim(), url, classification: cls, customPain: customPain.trim() },
        client: {
          name: client.name,
          caseStudy: caseStudyOut,
          emphasis: {
            pains: fav.pains || [],
            desires: fav.desires || [],
            caseStudies: fav.caseStudies || [],
            offers: fav.offers || [],
          },
          frameworkOverride: (client.frameworkOverrides || {})[nicheId] || "",
          avoid: client.avoid || [],
          competitorIntel: (client.competitorIntel || [])
            .map(
              (x: { name?: string; website?: string; offer?: string; mechanism?: string; results?: string; guarantee?: string }) =>
                `${x.name}${x.website ? " (" + x.website + ")" : ""}: offer=${x.offer || "?"}; mechanism=${
                  x.mechanism || "?"
                }; results=${x.results || "?"}${x.guarantee ? "; guarantee=" + x.guarantee : ""}`,
            )
            .join("\n"),
        },
        niche: { name: niche.name, triggerWords: niche.triggerWords || [] },
        frameworks: fws.map((f) => ({ id: f.id, name: f.name, category: f.category, template: f.template, rules: f.rules })),
        angles: angleList,
        variantsPerAngle: variantsPer,
        globalRules: globalRules || "",
        icp: icp?.title
          ? {
              title: icp.title,
              niche: icp.niche,
              jobTitles: icp.jobTitles || [],
              locations: icp.locations || [],
              employeeSize: icp.employeeSize || "",
              revenue: icp.revenue || "",
              outboundNotes: icp.outboundNotes || "",
            }
          : undefined,
        research: activeResearch?.ok ? activeResearch : undefined,
      })) as { results?: FrameworkResult[] };

      setStep(2);

      // FRONT-END CLAMP — the server may hand back up to 2 extra variants per framework (parser
      // slack); slice each framework to angles × variantsPer so the rendered/exported/counted
      // totals never exceed what the user asked for.
      const cap = angleList.length * variantsPer;
      const clamped = (data.results || []).map((r) =>
        r && Array.isArray(r.variants) ? { ...r, variants: r.variants.slice(0, cap) } : r,
      );
      setResults(clamped);
      setOpenAngles(new Set());
      const n = clamped.reduce((s, r) => s + (r.variants?.length || 0), 0);
      notify(`${n} scripts generated`);
    } catch (err) {
      const msg = (err as Error).message;
      setGenError(/401|unauthorized|admin/i.test(msg) ? "Unauthorized — open the app with ?admin=YOUR_KEY once." : msg);
    } finally {
      setGenerating(false);
      setStep(-1);
    }
  }

  // ── Flatten results → substituted rows grouped by angle ───────────────────
  const { flat, angleGroups, errors } = useMemo(() => {
    const flat: FlatScript[] = [];
    const angleGroups = new Map<string, FlatScript[]>();
    const errors: FrameworkResult[] = [];
    (results || []).forEach((r) => {
      if (r.error) {
        errors.push(r);
        return;
      }
      (r.variants || []).forEach((v, i) => {
        const angle = (v.angle || "").trim() || "General";
        const row: FlatScript = {
          framework: r.framework || "",
          category: r.category || "",
          fwId: r.frameworkId || "",
          angle,
          label: v.label || "",
          n: i + 1,
          script: substitute(v.script || ""),
          vref: v,
        };
        flat.push(row);
        if (!angleGroups.has(angle)) angleGroups.set(angle, []);
        angleGroups.get(angle)!.push(row);
      });
    });
    return { flat, angleGroups, errors };
    // substitute closes over fname/company — re-flatten when those change so merge tags update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, fname, company]);

  const firstAngle = angleGroups.size ? [...angleGroups.keys()][0] : null;
  const isAngleOpen = (a: string) => (openAngles.size ? openAngles.has(a) : a === firstAngle);
  const toggleAngleGroup = (a: string) =>
    setOpenAngles((prev) => {
      // First interaction: start from the implicit "first angle open" set, then toggle.
      const base = prev.size ? new Set(prev) : firstAngle ? new Set([firstAngle]) : new Set<string>();
      if (base.has(a)) base.delete(a);
      else base.add(a);
      return base;
    });

  // ── Copy-All + Export CSV (reuse csv lib) ─────────────────────────────────
  function copyAll() {
    if (!flat.length) return notify("Nothing to copy yet", true);
    const text = flat
      .map((s) => `--- [${s.framework} | ${s.angle} | v${s.n}] ---\n${s.script}`)
      .join("\n\n");
    navigator.clipboard.writeText(text);
    notify(`${flat.length} scripts copied`);
  }
  function exportCsv() {
    if (!flat.length) return notify("Nothing to export yet", true);
    const rows: ScriptRow[] = flat.map((s) => ({
      framework: s.framework,
      category: s.category,
      angle: s.angle,
      label: s.label,
      n: s.n,
      script: s.script,
    }));
    downloadCsv(buildCsv(rows));
    notify(`${flat.length} scripts exported`);
  }
  function copyOne(text: string) {
    if (!text) return;
    navigator.clipboard.writeText(text);
    notify("Copied");
  }

  // ── Save a generated card into the client's scriptReservoir (legacy saveToReservoir) ──
  function saveToReservoir(row: FlatScript, status: "idea" | "testing" | "winning" = "idea") {
    if (!client) return notify("Select a client first", true);
    if (!row.script) return;
    useConfigStore.getState().update((cfg) => {
      const c = (cfg.clients || []).find((x: Client) => x.id === client.id);
      if (!c) return;
      c.scriptReservoir = c.scriptReservoir || [];
      c.scriptReservoir.push({
        id: uid("sr"),
        name: nextScriptName(c),
        script: row.script,
        label: `${row.framework} · ${row.angle}`,
        framework: row.framework,
        angle: row.angle,
        nicheId: nicheId,
        status,
        note: "",
        // Copy any version rail the variant carries (e.g. from an in-place edit).
        versions: (row.vref?._versions || []).map((v) => ({ label: v.label, tag: v.tag, text: v.text })),
        savedAt: new Date().toISOString().slice(0, 10),
      });
    });
    notify("Saved to Reservoir");
  }

  // ── Apply an in-place edit from ScriptEditModal back onto the live variant ─
  function applyEdit(idx: number, text: string, versions: ScriptVersion[]) {
    setResults((prev) => {
      if (!prev) return prev;
      // Re-walk the same flatten order to find the variant the row points at, then mutate a copy.
      let seen = 0;
      const next = prev.map((r) => {
        if (r.error) return r;
        const variants = (r.variants || []).map((v) => {
          const here = seen++;
          if (here === idx) return { ...v, script: text, _versions: versions };
          return v;
        });
        return { ...r, variants };
      });
      return next;
    });
  }

  const editing = editIdx != null ? flat[editIdx] : null;

  // ── Render ────────────────────────────────────────────────────────────────
  const tabs: TabItem<BuildTab>[] = [
    { value: "scripts", label: "Scripts", icon: "file-text", count: flat.length || undefined },
    { value: "frameworks", label: "Framework fill", icon: "wand" },
    { value: "research", label: "Research", icon: "crosshair" },
  ];

  return (
    <div className="h-full flex min-w-0">
      {/* ── LEFT: the matrix controls ─────────────────────────────────────── */}
      <aside className="w-[380px] shrink-0 border-r border-border overflow-y-auto">
        <div className="p-4 flex flex-col gap-4">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Icon name="bolt" size={18} className="text-accent2" /> Matrix builder
            </h1>
            <p className="text-[12px] text-muted leading-snug">
              The legacy framework × angle × variant grid. For most work, use the guided builder — this is here when you
              want the raw matrix.
            </p>
          </div>

          {/* Client + niche pickers */}
          <div className="flex flex-col gap-2.5">
            <div>
              <label className="block text-[10px] font-semibold text-muted tracking-wide uppercase mb-1.5">Client</label>
              <Select value={clientId} onChange={(e) => pickClient(e.target.value)}>
                <option value="">Select a client…</option>
                {(clients || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            {client && (
              <div>
                <label className="block text-[10px] font-semibold text-muted tracking-wide uppercase mb-1.5">Niche</label>
                <Select value={nicheId} onChange={(e) => pickNiche(e.target.value)}>
                  {(niches || []).map((n) => (
                    <option key={n.id} value={n.id}>
                      {(client.nicheIds || []).includes(n.id) ? "★ " : ""}
                      {n.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>

          {!client && (
            <EmptyState icon="id-badge-2" title="Pick a client" description="Choose a client to load their angles, frameworks and ICPs." />
          )}

          {client && (
            <>
              {/* ICP chips — optional persona personalization */}
              {icps.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-muted tracking-wide uppercase mb-1.5 flex items-center gap-1.5">
                    <Icon name="target" size={12} /> Target ICP
                    <span className="font-normal normal-case text-muted">— optional</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {icps.map((i) => (
                      <Chip key={i.id} selected={selectedIcpId === i.id} onClick={() => toggleIcp(i.id)}>
                        {i.title}
                      </Chip>
                    ))}
                  </div>
                  {activeIcp && (
                    <p className="text-[11px] text-muted mt-1.5">
                      ✍️ Writing to <b className="text-text">{activeIcp.title}</b>
                    </p>
                  )}
                </div>
              )}

              {/* Angle cloud */}
              <div>
                <div className="text-[10px] font-semibold text-muted tracking-wide uppercase mb-1.5 flex items-center gap-1.5">
                  <Icon name="crosshair" size={12} /> Angles
                  {angles.size > 0 && <span className="text-accent2">({angles.size} selected)</span>}
                </div>
                {angleItems.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {angleItems.map((it) => (
                      <Chip key={it.text} selected={angles.has(it.text)} onClick={() => toggleAngle(it.text)}>
                        <span className="opacity-70">{it.ico}</span> {it.text}
                      </Chip>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted">No angles yet — research the niche in the client profile to add some.</p>
                )}
              </div>

              {/* Framework chips */}
              <div>
                <div className="text-[10px] font-semibold text-muted tracking-wide uppercase mb-1.5 flex items-center gap-1.5">
                  <Icon name="file-text" size={12} /> Frameworks
                  {fwIds.size > 0 && <span className="text-accent2">({fwIds.size} selected)</span>}
                </div>
                {visibleFws.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {visibleFws.map((f) => (
                      <Chip key={f.id} selected={fwIds.has(f.id)} onClick={() => toggleFw(f.id)} title={f.category}>
                        {(f.nicheIds || []).length ? "🎯 " : ""}
                        {f.name}
                      </Chip>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted">No frameworks for this niche — add them in Admin → Frameworks.</p>
                )}
              </div>

              {/* Variants-per + live count */}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <label className="block text-[10px] font-semibold text-muted tracking-wide uppercase mb-1.5">
                    Variants / angle
                  </label>
                  <SegmentedControl options={VARIANT_OPTS} value={variantsPer} onChange={setVariantsPer} size="sm" />
                </div>
                <Badge tone={total > 0 ? "accent" : "neutral"} className="self-end">
                  {fwIds.size} × {angles.size} × {variantsPer} = {total}
                </Badge>
              </div>

              {/* Prospect personalization (optional) */}
              <Card className="p-3 flex flex-col gap-2.5 bg-bg">
                <div className="text-[10px] font-semibold text-muted tracking-wide uppercase">Prospect (optional)</div>
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="First name" value={fname} onChange={(e) => setFname(e.target.value)} />
                  <Input placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} />
                </div>
                <Input placeholder="Company website (for research)" value={companyUrl} onChange={(e) => setCompanyUrl(e.target.value)} />
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Classification" value={classification} onChange={(e) => setClassification(e.target.value)} />
                  <Input placeholder="Custom pain" value={customPain} onChange={(e) => setCustomPain(e.target.value)} />
                </div>
                <Chip selected={doResearch} onClick={() => setDoResearch((v) => !v)}>
                  <Icon name={doResearch ? "check" : "x"} size={12} /> Research the website before writing
                </Chip>
              </Card>

              <Button block size="lg" icon="sparkles" loading={generating} onClick={generate} disabled={!total}>
                Generate {total > 0 ? total : ""} script{total === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </div>
      </aside>

      {/* ── RIGHT: the output ─────────────────────────────────────────────── */}
      <section className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border">
          <Tabs items={tabs} value={tab} onChange={setTab} />
          {flat.length > 0 && (
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" icon="file-text" onClick={copyAll}>
                Copy all
              </Button>
              <Button variant="secondary" size="sm" icon="download" onClick={exportCsv}>
                Export CSV
              </Button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {generating ? (
            <LoadingState
              steps={[
                doResearch && companyUrl.trim() ? `🌐 Researching ${companyUrl.trim()}…` : "🌐 Research skipped",
                `✍️ Writing ${total} scripts across ${fwIds.size} framework${fwIds.size === 1 ? "" : "s"}…`,
                "📦 Packaging matrix…",
              ]}
              active={step}
            />
          ) : genError ? (
            <EmptyState icon="alert-triangle" title="Generation failed" description={genError} />
          ) : tab === "research" ? (
            <ResearchPanel research={research} />
          ) : tab === "frameworks" ? (
            <FrameworkFillPanel results={results} visibleFws={visibleFws} />
          ) : !results ? (
            <EmptyState
              icon="file-text"
              title="Nothing generated yet"
              description="Pick a client, choose angles × frameworks, then Generate. Every script comes labeled for A/B testing."
            />
          ) : (
            <div>
              {errors.map((r, i) => (
                <Card key={i} className="p-3 mb-2 border-red/40">
                  <div className="text-[13px] font-semibold mb-1">{r.framework}</div>
                  <div className="text-[12px] text-red">⚠️ {r.error}</div>
                </Card>
              ))}
              {[...angleGroups.entries()].map(([angle, scripts]) => (
                <Accordion
                  key={angle}
                  title={angle}
                  meta={`${scripts.length} variant${scripts.length === 1 ? "" : "s"}`}
                  open={isAngleOpen(angle)}
                  onToggle={() => toggleAngleGroup(angle)}
                >
                  <div className="flex flex-col gap-2.5">
                    {scripts.map((s) => {
                      const idx = flat.indexOf(s);
                      const vcount = (s.vref?._versions || []).length;
                      return (
                        <Card key={idx} className="p-3 bg-bg">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[12px] font-semibold truncate">{s.framework}</span>
                              <Badge tone="neutral">{s.category}</Badge>
                              {vcount > 1 && <Badge tone="accent">v{vcount}</Badge>}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <Button variant="mini" size="sm" onClick={() => copyOne(s.script)}>
                                Copy
                              </Button>
                              <Button variant="mini" size="sm" icon="edit" onClick={() => setEditIdx(idx)}>
                                Edit
                              </Button>
                              <Button
                                variant="mini"
                                size="sm"
                                icon="device-floppy"
                                onClick={() => saveToReservoir(s)}
                                title="Save to this client's reservoir"
                              />
                            </div>
                          </div>
                          <div className="text-[13px] leading-[1.6] text-text whitespace-pre-wrap font-mono">{s.script}</div>
                        </Card>
                      );
                    })}
                  </div>
                </Accordion>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Per-card editor — reuses the shared modal; applies back onto the live variant. */}
      {editing && (
        <ScriptEditModal
          open={editIdx != null}
          onClose={() => setEditIdx(null)}
          title="Edit script"
          sub={`${editing.framework} · ${editing.angle}`}
          initialText={editing.script}
          initialVersions={editing.vref?._versions}
          onApply={(text, versions) => editIdx != null && applyEdit(editIdx, text, versions)}
        />
      )}
    </div>
  );
}

// ── Research tab ──────────────────────────────────────────────────────────────
function ResearchPanel({ research }: { research: ResearchResult | null }) {
  if (!research)
    return (
      <EmptyState
        icon="crosshair"
        title="No research yet"
        description="Enter a website, keep the research toggle on, and Generate."
      />
    );
  if (!research.ok)
    return <EmptyState icon="alert-triangle" title="Research failed" description={research.error} />;
  return (
    <div className="flex flex-col gap-3 max-w-[680px]">
      <Card className="p-3.5">
        <div className="text-[13px] font-semibold mb-1.5">🌐 {research.url || "Research"}</div>
        <div className="text-[13px] text-subtle leading-relaxed">{research.summary || ""}</div>
      </Card>
      <Card className="p-3.5">
        <div className="text-[13px] font-semibold mb-1.5">Likely pains</div>
        {(research.pains || []).length ? (
          <ul className="list-disc pl-5 text-[13px] text-subtle flex flex-col gap-1">
            {(research.pains || []).map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        ) : (
          <span className="text-[13px] text-muted">—</span>
        )}
      </Card>
      <Card className="p-3.5">
        <div className="text-[13px] font-semibold mb-1.5">Personalization hooks</div>
        {(research.hooks || []).length ? (
          <ul className="list-disc pl-5 text-[13px] text-subtle flex flex-col gap-1">
            {(research.hooks || []).map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        ) : (
          <span className="text-[13px] text-muted">—</span>
        )}
      </Card>
    </div>
  );
}

// ── Framework-fill tab ─────────────────────────────────────────────────────────
function FrameworkFillPanel({
  results,
  visibleFws,
}: {
  results: FrameworkResult[] | null;
  visibleFws: Framework[];
}) {
  // Before generating: show the framework templates + their {{variables}} (legacy preview).
  if (!results) {
    if (!visibleFws.length)
      return <EmptyState icon="wand" title="No frameworks" description="Pick a niche to see its framework templates." />;
    const fwVars = (tpl: string) => Array.from(new Set((String(tpl).match(/\{\{?([\w-]+)\}?\}/g) || []).map((m) => m.replace(/[{}]/g, ""))));
    return (
      <div className="flex flex-col gap-3 max-w-[680px]">
        {visibleFws.map((f) => (
          <Card key={f.id} className="p-3.5">
            <div className="text-[13px] font-semibold mb-2">
              {f.name} · <span className="text-muted font-normal">{f.category}</span>
            </div>
            <div className="text-[12px] text-subtle whitespace-pre-wrap font-mono mb-2">{f.template}</div>
            <div className="flex flex-wrap gap-1.5">
              {fwVars(f.template || "").map((v) => (
                <Badge key={v} tone="accent">
                  {`{{${v}}}`}
                </Badge>
              ))}
            </div>
          </Card>
        ))}
      </div>
    );
  }
  // After generating: show each framework's chosen fills (the variables Claude filled).
  return (
    <div className="flex flex-col gap-3 max-w-[680px]">
      {results.map((r, i) =>
        r.error ? (
          <Card key={i} className="p-3.5 border-red/40">
            <div className="text-[13px] font-semibold mb-1">{r.framework}</div>
            <div className="text-[12px] text-red">⚠️ {r.error}</div>
          </Card>
        ) : (
          <Card key={i} className="p-3.5">
            <div className="text-[13px] font-semibold mb-2">
              📋 {r.framework} · <span className="text-muted font-normal">{r.category}</span>
            </div>
            {Object.entries(r.fills || {}).length ? (
              <div className="flex flex-col gap-1.5">
                {Object.entries(r.fills || {}).map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[160px_1fr] gap-2 text-[12px]">
                    <span className="text-muted font-mono">{k}</span>
                    <span className="text-subtle">{v}</span>
                  </div>
                ))}
              </div>
            ) : (
              <span className="text-[12px] text-muted">No fill returned.</span>
            )}
          </Card>
        ),
      )}
    </div>
  );
}
