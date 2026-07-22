// Context assembly for the MCP tools.
//
// The UI builds the ICP dossier (ClientEditor.icpDossier) and the generate payload
// (lib/sync/wizard.genOnce) in the browser before calling the API. MCP callers have
// no browser, so those assemblies are reproduced here against the config document —
// byte-for-byte where it matters, because these strings land in the cached prompt
// prefix and any drift silently changes the output the team is used to.
//
// Keep in sync with:
//   src/components/ClientEditor.tsx      → icpDossier()
//   src/lib/sync/wizard.ts               → genOnce() / learnExamples() / VARIANT_RULE

import type { Cfg } from "./config-io";
// mechToText is pure (no DOM/storage), so the browser implementation is the one
// source of truth for how a mechanism reaches the generator.
import { mechToText } from "@/lib/ai-json";

// ─── ICP dossier (ClientEditor.icpDossier) ───────────────────────────────────

export function icpDossier(cfg: Cfg, c: Cfg): string {
  const cs = c.caseStudy || {};
  const tags = (a: unknown[]) => (a || []).map((x) => String(x)).join("; ");
  const lines: string[] = [];
  lines.push(`Client: ${c.name ?? ""} (${c.meta ?? ""})`);
  if (c.website) lines.push(`Website: ${c.website}`);
  if (cs.size) lines.push(`Their size: ${cs.size}`);
  if (cs.mechanism) lines.push(`Mechanism (how they deliver results): ${cs.mechanism}`);
  if (cs.result) lines.push(`Headline result: ${cs.result}`);
  if (cs.proofLine) lines.push(`Proof line: ${cs.proofLine}`);
  const offers: string[] = clientOffers(c);
  if (offers.length) lines.push(`Offers:\n${offers.join("\n")}`);
  const caseStudies: string[] = clientCaseStudies(c);
  if (caseStudies.length) lines.push(`Case studies:\n${caseStudies.join("\n")}`);
  const pains = allPains(c);
  if (pains.length) lines.push(`Customer pains they solve: ${tags(pains)}`);
  const desires = allDesires(c);
  if (desires.length) lines.push(`Customer desires: ${tags(desires)}`);
  if ((cs.objections || []).length) lines.push(`Common objections: ${tags(cs.objections)}`);
  (c.transcripts || []).forEach((t: any) => {
    const bits: string[] = [];
    if ((t.pains || []).length) bits.push(`pains: ${t.pains.join("; ")}`);
    if ((t.desires || []).length) bits.push(`desires: ${t.desires.join("; ")}`);
    if ((t.offers || []).length) bits.push(`offer ideas: ${t.offers.join("; ")}`);
    if (bits.length) lines.push(`From call transcript "${t.title ?? ""}": ${bits.join(" | ")}`);
  });
  if ((c.competitorIntel || []).length) {
    lines.push(
      `Competitors: ${(c.competitorIntel || []).map((x: any) => `${x.name} (${x.offer || "?"})`).join("; ")}`,
    );
  }
  const en = (c.nicheIds || [])
    .map((id: string) => (cfg.niches || []).find((n: any) => n.id === id)?.name)
    .filter(Boolean);
  if (en.length) lines.push(`Niches already targeted: ${en.join(", ")}`);
  return lines.join("\n");
}

// ─── Per-niche aggregators (wizard.ts) ───────────────────────────────────────

const uniq = (xs: unknown[]): string[] => {
  const seen: Record<string, 1> = {};
  const out: string[] = [];
  (xs || []).forEach((raw) => {
    const t = String(raw ?? "").trim();
    if (t && !seen[t]) { seen[t] = 1; out.push(t); }
  });
  return out;
};

export function nichePains(c: Cfg, nicheId?: string | null): string[] {
  const bucket = nicheId ? (c.nicheData || {})[nicheId] : null;
  return uniq([...((bucket?.pains) || []), ...(((c.caseStudy || {}).pains) || [])]);
}
export function nicheDesires(c: Cfg, nicheId?: string | null): string[] {
  const bucket = nicheId ? (c.nicheData || {})[nicheId] : null;
  return uniq([...((bucket?.desires) || []), ...(((c.caseStudy || {}).desires) || [])]);
}
export function nicheOffers(c: Cfg, nicheId?: string | null): string[] {
  const bucket = nicheId ? (c.nicheData || {})[nicheId] : null;
  return uniq([...((bucket?.offers) || []), ...(((c.caseStudy || {}).offers) || [])]);
}
export function clientCaseStudies(c: Cfg): string[] {
  const cs = c.caseStudy || {};
  return uniq([...(cs.caseStudies || []), cs.proofLine].filter(Boolean));
}
export function clientOffers(c: Cfg): string[] {
  return uniq([
    ...(((c.caseStudy || {}).offers) || []),
    ...Object.values(c.nicheData || {}).flatMap((b: any) => b?.offers || []),
  ]);
}
export function allPains(c: Cfg): string[] {
  return uniq([
    ...(((c.caseStudy || {}).pains) || []),
    ...Object.values(c.nicheData || {}).flatMap((b: any) => b?.pains || []),
  ]);
}
export function allDesires(c: Cfg): string[] {
  return uniq([
    ...(((c.caseStudy || {}).desires) || []),
    ...Object.values(c.nicheData || {}).flatMap((b: any) => b?.desires || []),
  ]);
}

// ─── Style exemplars (wizard.learnExamples, verbatim) ────────────────────────

export function learnExamples(cfg: Cfg, c: Cfg): string {
  const R: any[] = c.scriptReservoir || [];
  const pool: any[] = [];
  R.forEach((s) => { if (s.status === "winning") pool.push(s); });
  R.forEach((s) => { if (s.status === "testing") pool.push(s); });
  R.forEach((s) => { if (s.versions && s.versions.length > 1 && pool.indexOf(s) < 0) pool.push(s); });
  const clientNicheIds: string[] = c.nicheIds || [];
  (cfg.winningScripts || []).forEach((s: any) => {
    const nids: string[] = (s && s.nicheIds) || [];
    const relevant = !nids.length || !clientNicheIds.length || nids.some((id) => clientNicheIds.includes(id));
    if (relevant) pool.push({ script: (s && (s.script || s.text)) || s });
  });
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

export const VARIANT_RULE =
  "\n\nMAKE EACH VARIANT GENUINELY DIFFERENT: vary the opening line, the tone, the structure, which pain/desire you lead with, and the mechanism framing. Do NOT just swap a few words while keeping the same shape — each should read like a distinct angle.";

// ─── generate payload (wizard.genOnce) ───────────────────────────────────────

export interface GenerateOpts {
  nicheId?: string | null;
  icpId?: string | null;
  frameworkIds?: string[];
  angles?: string[];
  desires?: string[];
  mechanismId?: string | null;
  variantsPerAngle?: number;
  guarantees?: string[];
}

export function buildGenerateBody(cfg: Cfg, c: Cfg, o: GenerateOpts): Record<string, unknown> {
  const nn = (cfg.niches || []).find((n: any) => n.id === o.nicheId) || {};
  const cs: any = Object.assign({}, c.caseStudy || {});
  cs.pains = nichePains(c, nn.id).slice(0, 30);
  cs.desires = nicheDesires(c, nn.id).slice(0, 30);
  cs.offers = nicheOffers(c, nn.id).slice(0, 30);
  cs.caseStudies = clientCaseStudies(c).slice(0, 20);

  const mech = (c.mechanisms || []).find((m: any) => m.id === (o.mechanismId ?? c.activeMechId));
  if (mech) cs.mechanism = mechToText(mech);

  const fav = c.favorites || { pains: [], desires: [], caseStudies: [], offers: [] };
  if (fav.caseStudies && fav.caseStudies.length) cs.caseStudies = fav.caseStudies;
  if (fav.offers && fav.offers.length) cs.offers = fav.offers;

  const ic = (c.icps || []).find((x: any) => x.id === o.icpId);
  const frameworks = (cfg.frameworks || []).filter((f: any) =>
    o.frameworkIds?.length ? o.frameworkIds.includes(f.id) : true,
  );

  return {
    action: "generate",
    prospect: { fname: "", company: "", url: "", classification: "", customPain: "" },
    client: {
      name: c.name,
      caseStudy: cs,
      emphasis: {
        pains: o.angles?.length ? o.angles : (fav.pains || []),
        desires: o.desires?.length ? o.desires : (fav.desires || []),
        caseStudies: fav.caseStudies || [],
        offers: fav.offers || [],
      },
      frameworkOverride: (c.frameworkOverrides || {})[nn.id] || "",
      avoid: c.avoid || [],
      competitorIntel: (c.competitorIntel || [])
        .map((x: any) => (x.name || "") + ": offer=" + (x.offer || "?"))
        .join("\n"),
    },
    niche: { name: nn.name ?? "", triggerWords: nn.triggerWords || [] },
    frameworks: frameworks.map((f: any) => ({
      id: f.id, name: f.name, category: f.category, template: f.template, rules: f.rules,
    })),
    angles: o.angles?.length ? o.angles : nichePains(c, nn.id).slice(0, 3),
    variantsPerAngle: Math.max(1, Math.min(Number(o.variantsPerAngle) || 1, 3)),
    globalRules: ((cfg.settings && cfg.settings.globalRules) || "") + VARIANT_RULE + learnExamples(cfg, c),
    guarantee: o.guarantees?.length
      ? o.guarantees.join(" ")
      : (c.guarantees || []).map((g: any) => (typeof g === "string" ? g : g?.text || "")).filter(Boolean).join(" "),
    icp: ic
      ? {
        title: ic.title, niche: ic.niche, jobTitles: ic.jobTitles || [],
        locations: ic.locations || [], employeeSize: ic.employeeSize || "",
        revenue: ic.revenue || "", outboundNotes: ic.outboundNotes || "",
      }
      : undefined,
  };
}

