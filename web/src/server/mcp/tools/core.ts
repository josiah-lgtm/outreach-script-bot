// Discovery, entity CRUD, research and the raw-config power tools.
//
// `search` and `fetch` deliberately follow the shape ChatGPT's deep research mode
// expects (search → {results:[{id,title,url}]}, fetch → {id,title,text,url,metadata}),
// which is also a perfectly good generic entry point for Claude: one query across
// clients, niches, ICPs, scripts, frameworks, angles and pains.

import {
  readConfig, mutateConfig, findClient, findNiche, mkId,
  getPath, setPath, deletePath, summarize, type Cfg,
} from "../config-io";
import { callAction } from "../invoke";
import { getUsage, DAILY_AI_CALL_CAP } from "../../usage";
import { ratesFor } from "../../providers";
import { activeProvider } from "../../secrets";
import { SLOT_KEYS, loadEngineOverrides } from "../../prompts";
import { schema, str, bool, num, arr, argStr, argBool, argNum, argArr, required, type McpTool } from "../types";

// ─── whoami ──────────────────────────────────────────────────────────────────

export const whoami: McpTool = {
  name: "whoami",
  title: "Who am I and what is in this workspace",
  description:
    "Start here. Reports who you are authenticated as, what you are allowed to do (read vs write), and the shape of the workspace: how many clients, niches, frameworks and scripts exist, which logic slots have been customised, and today's AI spend against the daily cap. Cheap and safe to call first.",
  annotations: { readOnlyHint: true, idempotentHint: true },
  inputSchema: schema({}),
  handler: async (_args, ctx) => {
    const cfg = await readConfig();
    const overrides = await loadEngineOverrides(true);
    const clients: any[] = cfg.clients || [];
    const scripts = clients.reduce((n, c) => n + (c.scriptReservoir || []).length, 0);
    const icps = clients.reduce((n, c) => n + (c.icps || []).length, 0);
    let usage: any = null;
    try {
      const u = await getUsage();
      const today = new Date().toISOString().slice(0, 10);
      const rec = u?.days?.[today] ?? null;
      usage = {
        day: today,
        cap: DAILY_AI_CALL_CAP,
        callsToday: rec?.requests ?? 0,
        costToday: rec?.cost ?? 0,
      };
    } catch { /* usage is best-effort */ }

    return {
      identity: {
        sub: ctx.principal.sub,
        via: ctx.principal.via,
        scopes: ctx.principal.scopes,
        canWrite: ctx.principal.scopes.includes("outreach:write"),
        client: ctx.principal.clientId ?? null,
      },
      server: { name: "outreach-script-bot", endpoint: `${ctx.baseUrl}/mcp` },
      workspace: {
        configRev: cfg._rev ?? null,
        clients: clients.length,
        niches: (cfg.niches || []).length,
        frameworks: (cfg.frameworks || []).length,
        followupFrameworks: (cfg.followupFrameworks || []).length,
        savedScripts: scripts,
        savedIcps: icps,
        winningScripts: (cfg.winningScripts || []).length,
      },
      logic: {
        houseLensEnabled: ((cfg.settings || {}).systemFilter || {}).enabled !== false,
        customisedSlots: Object.keys(overrides),
        availableSlots: SLOT_KEYS,
        hint: "Call get_logic to read the ICP-builder and script-maker logic, set_logic to change it.",
      },
      usage,
    };
  },
};

// ─── search / fetch ──────────────────────────────────────────────────────────

interface Hit { id: string; title: string; url: string; kind: string; snippet: string; score: number }

function scoreOf(haystack: string, needle: string): number {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (!n) return 0;
  if (h === n) return 100;
  if (h.startsWith(n)) return 60;
  const i = h.indexOf(n);
  if (i >= 0) return 40 - Math.min(20, i / 10);
  // token overlap
  const tokens = n.split(/\s+/).filter((t) => t.length > 2);
  if (!tokens.length) return 0;
  const hits = tokens.filter((t) => h.includes(t)).length;
  return hits ? (hits / tokens.length) * 25 : 0;
}

const KINDS = ["client", "niche", "framework", "icp", "script", "pain", "angle"] as const;

function collect(cfg: Cfg, base: string): Hit[] {
  const out: Hit[] = [];
  const url = (path: string) => `${base}${path}`;

  (cfg.clients || []).forEach((c: any) => {
    const cs = c.caseStudy || {};
    out.push({
      id: `client:${c.id}`, kind: "client", title: c.name,
      url: url(`/client/${c.id}/overview`),
      snippet: [c.meta, cs.proofLine, cs.mechanism].filter(Boolean).join(" · ").slice(0, 300),
      score: 0,
    });
    (c.icps || []).forEach((i: any) => {
      out.push({
        id: `icp:${c.id}:${i.id}`, kind: "icp", title: `${i.title} (${c.name})`,
        url: url(`/client/${c.id}/client`),
        snippet: [i.niche, (i.jobTitles || []).join(", "), i.marketSize, i.why].filter(Boolean).join(" · ").slice(0, 300),
        score: 0,
      });
    });
    (c.scriptReservoir || []).forEach((s: any) => {
      out.push({
        id: `script:${c.id}:${s.id}`, kind: "script",
        title: `${s.name ?? s.id} — ${c.name}${s.status ? ` [${s.status}]` : ""}`,
        url: url(`/client/${c.id}/overview`),
        snippet: String(s.script ?? "").replace(/\s+/g, " ").slice(0, 300),
        score: 0,
      });
    });
    const pains: string[] = [
      ...((cs.pains) || []),
      ...Object.values(c.nicheData || {}).flatMap((b: any) => b?.pains || []),
    ];
    Array.from(new Set(pains)).forEach((p, i) => {
      out.push({
        id: `pain:${c.id}:${i}`, kind: "pain", title: String(p).slice(0, 90),
        url: url(`/client/${c.id}/niche`),
        snippet: `Pain on ${c.name}`, score: 0,
      });
    });
  });

  (cfg.niches || []).forEach((n: any) => {
    out.push({
      id: `niche:${n.id}`, kind: "niche", title: n.name,
      url: url(`/clients`),
      snippet: `Trigger words: ${(n.triggerWords || []).join(", ")}`.slice(0, 300),
      score: 0,
    });
    (n.angles || []).forEach((a: string, i: number) => {
      out.push({
        id: `angle:${n.id}:${i}`, kind: "angle", title: String(a).slice(0, 90),
        url: url(`/clients`), snippet: `Angle in ${n.name}`, score: 0,
      });
    });
  });

  (cfg.frameworks || []).forEach((f: any) => {
    out.push({
      id: `framework:${f.id}`, kind: "framework", title: f.name,
      url: url(`/admin`),
      snippet: `${f.category ?? ""} — ${String(f.rules ?? "").slice(0, 240)}`,
      score: 0,
    });
  });

  return out;
}

export const search: McpTool = {
  name: "search",
  title: "Search everything in the workspace",
  description:
    "Full-text search across clients, niches, frameworks, saved ICPs, saved scripts, pains and angles. Returns ranked ids you can pass to `fetch` for the full record. Use this when you know a name or a phrase but not which entity it belongs to.",
  annotations: { readOnlyHint: true, idempotentHint: true },
  inputSchema: schema(
    {
      query: str("What to look for — a client name, a phrase from a script, a job title, a pain."),
      kind: str(`Restrict to one entity kind: ${KINDS.join(", ")}.`, { enum: [...KINDS] }),
      limit: num("Max results. Default 20."),
    },
    ["query"],
  ),
  handler: async (args, ctx) => {
    const q = required(args, "query");
    const kind = argStr(args, "kind");
    const limit = Math.max(1, Math.min(argNum(args, "limit", 20), 100));
    const cfg = await readConfig();
    const hits = collect(cfg, ctx.baseUrl)
      .filter((h) => !kind || h.kind === kind)
      .map((h) => ({ ...h, score: Math.max(scoreOf(h.title, q), scoreOf(h.snippet, q) * 0.7) }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return {
      results: hits.map((h) => ({ id: h.id, title: h.title, url: h.url })),
      // Extra detail beyond the deep-research contract — harmless for hosts that ignore it.
      details: hits.map((h) => ({ id: h.id, kind: h.kind, snippet: h.snippet })),
    };
  },
};

export const fetchTool: McpTool = {
  name: "fetch",
  title: "Fetch one record in full",
  description:
    "Retrieve the complete record for an id returned by `search` (e.g. 'client:ehealth', 'script:ehealth:s123', 'icp:ehealth:icp-abc', 'niche:saas', 'framework:pas'). Returns the record as readable text plus its structured metadata.",
  annotations: { readOnlyHint: true, idempotentHint: true },
  inputSchema: schema({ id: str("An id from `search`, e.g. 'client:ehealth'.") }, ["id"]),
  handler: async (args, ctx) => {
    const id = required(args, "id");
    const cfg = await readConfig();
    const [kind, a, b] = id.split(":");
    const url = (p: string) => `${ctx.baseUrl}${p}`;

    const notFound = () => {
      throw new Error(`No record with id "${id}". Ids look like 'client:<id>', 'script:<clientId>:<scriptId>', 'icp:<clientId>:<icpId>', 'niche:<id>', 'framework:<id>'. Use search to find one.`);
    };

    if (kind === "client") {
      const c = (cfg.clients || []).find((x: any) => x.id === a);
      if (!c) notFound();
      return {
        id, title: c.name, url: url(`/client/${c.id}/overview`),
        text: JSON.stringify(c, null, 2),
        metadata: { kind: "client", niches: c.nicheIds || [], stage: c.stage ?? "", csm: c.csm ?? "" },
      };
    }
    if (kind === "niche") {
      const n = (cfg.niches || []).find((x: any) => x.id === a);
      if (!n) notFound();
      return { id, title: n.name, url: url("/clients"), text: JSON.stringify(n, null, 2), metadata: { kind: "niche" } };
    }
    if (kind === "framework") {
      const f = (cfg.frameworks || []).find((x: any) => x.id === a);
      if (!f) notFound();
      return { id, title: f.name, url: url("/admin"), text: JSON.stringify(f, null, 2), metadata: { kind: "framework", category: f.category } };
    }
    if (kind === "icp" || kind === "script" || kind === "pain") {
      const c = (cfg.clients || []).find((x: any) => x.id === a);
      if (!c) notFound();
      if (kind === "icp") {
        const i = (c.icps || []).find((x: any) => x.id === b);
        if (!i) notFound();
        return { id, title: `${i.title} (${c.name})`, url: url(`/client/${c.id}/client`), text: JSON.stringify(i, null, 2), metadata: { kind: "icp", client: c.id } };
      }
      if (kind === "script") {
        const s = (c.scriptReservoir || []).find((x: any) => x.id === b);
        if (!s) notFound();
        return {
          id, title: `${s.name ?? s.id} — ${c.name}`, url: url(`/client/${c.id}/overview`),
          text: String(s.script ?? ""),
          metadata: { kind: "script", client: c.id, status: s.status ?? "idea", framework: s.framework ?? "", angle: s.angle ?? "", versions: (s.versions || []).length },
        };
      }
      const pains = Array.from(new Set<string>([
        ...(((c.caseStudy || {}).pains) || []),
        ...Object.values(c.nicheData || {}).flatMap((x: any) => x?.pains || []),
      ]));
      const p = pains[Number(b)];
      if (p == null) notFound();
      return { id, title: String(p), url: url(`/client/${c.id}/niche`), text: String(p), metadata: { kind: "pain", client: c.id } };
    }
    if (kind === "angle") {
      const n = (cfg.niches || []).find((x: any) => x.id === a);
      if (!n) notFound();
      const ang = (n.angles || [])[Number(b)];
      if (ang == null) notFound();
      return { id, title: String(ang), url: url("/clients"), text: String(ang), metadata: { kind: "angle", niche: n.id } };
    }
    return notFound();
  },
};

// ─── clients ─────────────────────────────────────────────────────────────────

export const listClients: McpTool = {
  name: "list_clients",
  title: "List clients",
  description:
    "List the agency's clients with their ids, niches, stage, CSM and how much material each has (ICPs, scripts, transcripts). Filter by free-text query, niche, stage, CSM or tag. The ids returned here are what every other client tool takes.",
  annotations: { readOnlyHint: true, idempotentHint: true },
  inputSchema: schema({
    query: str("Free-text filter on name / meta / website."),
    niche: str("Niche id or name."),
    stage: str("Client stage, e.g. 'Testing', 'Proof of concept', 'Scaling'."),
    csm: str("CSM owner."),
    tag: str("Tag."),
    limit: num("Max clients. Default 100."),
  }),
  handler: async (args) => {
    const cfg = await readConfig();
    const q = argStr(args, "query").toLowerCase();
    const nicheArg = argStr(args, "niche");
    const niche = nicheArg ? findNiche(cfg, nicheArg) : null;
    if (nicheArg && !niche) throw new Error(`No niche matching "${nicheArg}".`);
    const stage = argStr(args, "stage").toLowerCase();
    const csm = argStr(args, "csm").toLowerCase();
    const tag = argStr(args, "tag").toLowerCase();
    const limit = argNum(args, "limit", 100);

    const nicheName = (id: string) => (cfg.niches || []).find((n: any) => n.id === id)?.name ?? id;

    const rows = (cfg.clients || [])
      .filter((c: any) => {
        if (q && !`${c.name} ${c.meta ?? ""} ${c.website ?? ""}`.toLowerCase().includes(q)) return false;
        if (niche && !(c.nicheIds || []).includes(niche.id)) return false;
        if (stage && String(c.stage ?? "").toLowerCase() !== stage) return false;
        if (csm && String(c.csm ?? "").toLowerCase() !== csm) return false;
        if (tag && !(c.tags || []).some((t: string) => String(t).toLowerCase() === tag)) return false;
        return true;
      })
      .slice(0, limit)
      .map((c: any) => ({
        id: c.id,
        name: c.name,
        meta: c.meta ?? "",
        website: c.website ?? "",
        stage: c.stage ?? "",
        csm: c.csm ?? "",
        tags: c.tags || [],
        niches: (c.nicheIds || []).map(nicheName),
        counts: {
          icps: (c.icps || []).length,
          scripts: (c.scriptReservoir || []).length,
          transcripts: (c.transcripts || []).length,
          mechanisms: (c.mechanisms || []).length,
        },
      }));

    return { total: (cfg.clients || []).length, returned: rows.length, clients: rows };
  },
};

export const getClient: McpTool = {
  name: "get_client",
  title: "Get a client's full dossier",
  description:
    "The complete record for one client: case study (size, mechanism, result, proof line, pains, desires, objections), per-niche pain/desire/offer buckets, favourites, saved ICPs, mechanisms, guarantees, hard exclusions, competitor intel, call transcripts and the script board. This is the material the ICP builder and script maker actually reason over — read it before diagnosing weak output.",
  annotations: { readOnlyHint: true, idempotentHint: true },
  inputSchema: schema(
    {
      clientId: str("Client id or name."),
      include: arr("Limit the response to these sections: caseStudy, nicheData, icps, scripts, transcripts, mechanisms, competitors, favorites. Omit for everything except full script text.", { type: "string" }),
      fullScripts: bool("Include every saved script's full text. Default false (they are listed by list_scripts)."),
    },
    ["clientId"],
  ),
  handler: async (args) => {
    const cfg = await readConfig();
    const c = findClient(cfg, required(args, "clientId"));
    if (!c) throw new Error(`No client matching "${argStr(args, "clientId")}". Use list_clients.`);
    const include = argArr(args, "include");
    const want = (k: string) => !include.length || include.includes(k);
    const nicheName = (id: string) => (cfg.niches || []).find((n: any) => n.id === id)?.name ?? id;

    const out: Cfg = {
      id: c.id, name: c.name, meta: c.meta ?? "", website: c.website ?? "",
      contact: c.contact ?? "", csm: c.csm ?? "", stage: c.stage ?? "", tags: c.tags || [],
      niches: (c.nicheIds || []).map((id: string) => ({ id, name: nicheName(id) })),
    };
    if (want("caseStudy")) out.caseStudy = c.caseStudy || {};
    if (want("nicheData")) out.nicheData = c.nicheData || {};
    if (want("favorites")) out.favorites = c.favorites || {};
    if (want("icps")) out.icps = c.icps || [];
    if (want("mechanisms")) { out.mechanisms = c.mechanisms || []; out.activeMechId = c.activeMechId ?? null; }
    if (want("competitors")) out.competitorIntel = c.competitorIntel || [];
    if (want("transcripts")) {
      out.transcripts = (c.transcripts || []).map((t: any) => ({
        title: t.title, pains: t.pains || [], desires: t.desires || [], angles: t.angles || [], offers: t.offers || [],
        textChars: String(t.text ?? "").length,
      }));
    }
    if (want("scripts")) {
      const full = argBool(args, "fullScripts", false);
      out.scripts = (c.scriptReservoir || []).map((s: any) => ({
        id: s.id, name: s.name, status: s.status || "idea", framework: s.framework ?? "", angle: s.angle ?? "",
        script: full ? s.script : String(s.script ?? "").slice(0, 160) + (String(s.script ?? "").length > 160 ? "…" : ""),
      }));
    }
    out.guarantees = c.guarantees || [];
    out.avoid = c.avoid || [];
    out.frameworkOverrides = c.frameworkOverrides || {};
    return out;
  },
};

export const upsertClient: McpTool = {
  name: "upsert_client",
  title: "Create or edit a client",
  description:
    "Create a client or update its fields — name, meta, website, stage, CSM, tags, niches, the case study (size, mechanism, result, proof line, pains, desires, objections), hard exclusions and guarantees. Array fields replace by default; pass appendArrays=true to add without removing. Everything here feeds the ICP builder's dossier and the script generator's prompt.",
  write: true,
  annotations: { idempotentHint: true },
  inputSchema: schema({
    clientId: str("Existing client id or name. Omit to create."),
    name: str("Client name."),
    meta: str("Short descriptor, e.g. 'US · ~$500M B2C Revenue'."),
    website: str("Client website."),
    contact: str("Contact person."),
    csm: str("CSM owner."),
    stage: str("Stage: Testing / Proof of concept / Scaling."),
    tags: arr("Tags.", { type: "string" }),
    nicheIds: arr("Niche ids or names this client targets.", { type: "string" }),
    size: str("caseStudy.size — the client's own size."),
    mechanism: str("caseStudy.mechanism — how they deliver results."),
    result: str("caseStudy.result — the headline outcome."),
    proofLine: str("caseStudy.proofLine — the one-line proof used in scripts."),
    pains: arr("Customer pains they solve.", { type: "string" }),
    desires: arr("Customer desired outcomes.", { type: "string" }),
    objections: arr("Common objections.", { type: "string" }),
    offers: arr("Offers they sell.", { type: "string" }),
    caseStudies: arr("Proven results, one line each with real numbers.", { type: "string" }),
    avoid: arr("HARD EXCLUSIONS — never mentioned or implied in any script.", { type: "string" }),
    guarantees: arr("Guarantees / risk reversal.", { type: "string" }),
    appendArrays: bool("Add to the existing array values instead of replacing them. Default false."),
    remove: bool("Delete this client and everything on it."),
  }),
  handler: async (args) => {
    const cfg = await readConfig();
    const idArg = argStr(args, "clientId");
    const existing = idArg ? findClient(cfg, idArg) : null;
    if (idArg && !existing) throw new Error(`No client matching "${idArg}". Omit clientId to create one.`);

    if (argBool(args, "remove", false)) {
      if (!existing) throw new Error('"clientId" is required when remove=true.');
      const { rev } = await mutateConfig((draft: Cfg) => {
        draft.clients = (draft.clients || []).filter((x: any) => x.id !== existing.id);
      });
      return { deleted: true, id: existing.id, name: existing.name, configRev: rev };
    }

    if (!existing && !argStr(args, "name").trim()) throw new Error('"name" is required when creating a client.');

    const nicheIds = argArr(args, "nicheIds").map((n) => {
      const found = findNiche(cfg, n);
      if (!found) throw new Error(`No niche matching "${n}". Create it with upsert_niche first, or use list_niches.`);
      return found.id as string;
    });
    const append = argBool(args, "appendArrays", false);
    const targetId = existing?.id ?? mkId("client", argStr(args, "name"));

    const { rev, result } = await mutateConfig((draft: Cfg) => {
      draft.clients = draft.clients || [];
      let c = draft.clients.find((x: any) => x.id === targetId);
      const created = !c;
      if (!c) {
        // Shape mirrors what migrateConfig backfills, so the web app is happy immediately.
        c = {
          id: targetId, name: "", meta: "", website: "", contact: "", csm: "", stage: "",
          tags: [], nicheIds: [], caseStudy: {}, frameworkOverrides: {}, competitorIntel: [],
          avoid: [], guarantees: [], savedAngles: [], scriptReservoir: [], transcripts: [],
          favorites: { pains: [], desires: [], caseStudies: [], offers: [] },
          sources: {}, icps: [], painGroups: [], desireGroups: [], mechanisms: [], nicheData: {},
          growthPlans: [], followups: [], brief: null, _nicheMigrated: true,
        };
        draft.clients.push(c);
      }
      for (const k of ["name", "meta", "website", "contact", "csm", "stage"] as const) {
        const v = argStr(args, k);
        if (v) c[k] = v;
      }
      if (Array.isArray(args.tags)) c.tags = append ? Array.from(new Set([...(c.tags || []), ...argArr(args, "tags")])) : argArr(args, "tags");
      if (Array.isArray(args.nicheIds)) c.nicheIds = append ? Array.from(new Set([...(c.nicheIds || []), ...nicheIds])) : nicheIds;
      c.nicheData = c.nicheData || {};
      (c.nicheIds || []).forEach((nid: string) => {
        const b = (c.nicheData[nid] = c.nicheData[nid] || {});
        b.pains = b.pains || []; b.desires = b.desires || []; b.offers = b.offers || [];
      });

      c.caseStudy = c.caseStudy || {};
      for (const k of ["size", "mechanism", "result", "proofLine"] as const) {
        const v = argStr(args, k);
        if (v) c.caseStudy[k] = v;
      }
      for (const k of ["pains", "desires", "objections", "offers", "caseStudies"] as const) {
        if (Array.isArray(args[k])) {
          const next = argArr(args, k);
          c.caseStudy[k] = append ? Array.from(new Set([...(c.caseStudy[k] || []), ...next])) : next;
        }
      }
      for (const k of ["avoid", "guarantees"] as const) {
        if (Array.isArray(args[k])) {
          const next = argArr(args, k);
          c[k] = append ? Array.from(new Set([...(c[k] || []), ...next])) : next;
        }
      }
      return { created, id: c.id, name: c.name };
    });
    return { saved: true, configRev: rev, ...(result as object) };
  },
};

// ─── niches ──────────────────────────────────────────────────────────────────

export const listNiches: McpTool = {
  name: "list_niches",
  title: "List niches",
  description: "List the niches, their angles and trigger words. Trigger words are woven into generated scripts; angles are the default hooks a generation run writes against.",
  annotations: { readOnlyHint: true, idempotentHint: true },
  inputSchema: schema({ nicheId: str("Optional id or name for one niche in full.") }),
  handler: async (args) => {
    const cfg = await readConfig();
    const one = argStr(args, "nicheId");
    if (one) {
      const n = findNiche(cfg, one);
      if (!n) throw new Error(`No niche matching "${one}".`);
      return n;
    }
    return {
      count: (cfg.niches || []).length,
      niches: (cfg.niches || []).map((n: any) => ({
        id: n.id, name: n.name,
        angles: n.angles || [],
        triggerWords: n.triggerWords || [],
        clients: (cfg.clients || []).filter((c: any) => (c.nicheIds || []).includes(n.id)).map((c: any) => c.name),
      })),
    };
  },
};

export const upsertNiche: McpTool = {
  name: "upsert_niche",
  title: "Create, edit or delete a niche",
  description:
    "Create a niche or edit its angles and trigger words. Trigger words are the vocabulary the generator works into scripts where they genuinely fit; angles are the default hooks. Pass remove=true to delete.",
  write: true,
  annotations: { idempotentHint: true, destructiveHint: true },
  inputSchema: schema({
    nicheId: str("Existing niche id or name. Omit to create."),
    name: str("Niche name."),
    angles: arr("Default angles for this niche.", { type: "string" }),
    triggerWords: arr("Vocabulary to weave into scripts, e.g. 'ACOS', 'churn', 'buy box'.", { type: "string" }),
    appendArrays: bool("Add to the existing arrays instead of replacing them."),
    remove: bool("Delete this niche."),
  }),
  handler: async (args) => {
    const cfg = await readConfig();
    const idArg = argStr(args, "nicheId");
    const existing = idArg ? findNiche(cfg, idArg) : null;
    if (idArg && !existing) throw new Error(`No niche matching "${idArg}".`);

    if (argBool(args, "remove", false)) {
      if (!existing) throw new Error('"nicheId" is required when remove=true.');
      const users = (cfg.clients || []).filter((c: any) => (c.nicheIds || []).includes(existing.id)).map((c: any) => c.name);
      if (users.length) {
        throw new Error(`"${existing.name}" is still targeted by ${users.length} client(s): ${users.join(", ")}. Detach it from them first (upsert_client with nicheIds).`);
      }
      const { rev } = await mutateConfig((draft: Cfg) => {
        draft.niches = (draft.niches || []).filter((x: any) => x.id !== existing.id);
      });
      return { deleted: true, id: existing.id, name: existing.name, configRev: rev };
    }

    if (!existing && !argStr(args, "name").trim()) throw new Error('"name" is required when creating a niche.');
    const append = argBool(args, "appendArrays", false);
    const targetId = existing?.id ?? mkId("niche", argStr(args, "name"));

    const { rev, result } = await mutateConfig((draft: Cfg) => {
      draft.niches = draft.niches || [];
      let n = draft.niches.find((x: any) => x.id === targetId);
      const created = !n;
      if (!n) { n = { id: targetId, name: "", angles: [], triggerWords: [] }; draft.niches.push(n); }
      const name = argStr(args, "name");
      if (name) n.name = name;
      for (const k of ["angles", "triggerWords"] as const) {
        if (Array.isArray(args[k])) {
          const next = argArr(args, k);
          n[k] = append ? Array.from(new Set([...(n[k] || []), ...next])) : next;
        }
      }
      return { created, niche: { ...n } };
    });
    return { saved: true, configRev: rev, ...(result as object) };
  },
};

// ─── research ────────────────────────────────────────────────────────────────

export const research: McpTool = {
  name: "research",
  title: "Research a site, niche, prospect or competitor set",
  description:
    "Run one of the four research passes, each of which costs an AI call and fetches live pages: kind='client_site' (scrape a client's own site into services/positioning/proof), 'prospect' (research a prospect's site for personalization hooks), 'niche' (research a niche's pains and language), 'competitors' (what rivals in the niche promise). Pass clientId with save=true to merge the findings onto that client.",
  annotations: { openWorldHint: true },
  inputSchema: schema(
    {
      kind: str("Which pass to run.", { enum: ["client_site", "prospect", "niche", "competitors"] }),
      url: str("Required for 'client_site' and 'prospect'."),
      niche: str("Required for 'niche'; optional context for 'competitors'."),
      clientName: str("For 'competitors': the client's name."),
      classification: str("For 'prospect': how the prospect is classified."),
      clientContext: str("For 'niche': extra context about the client."),
      clientId: str("Client to attribute the research to (scopes the lens; required for save)."),
      save: bool("Merge the findings into the client's record (sources, competitor intel, pains)."),
    },
    ["kind"],
  ),
  handler: async (args) => {
    const kind = required(args, "kind");
    const cid = argStr(args, "clientId");
    let client: Cfg | null = null;
    if (cid) {
      const cfg = await readConfig();
      client = findClient(cfg, cid) ?? null;
      if (!client) throw new Error(`No client matching "${cid}".`);
    }

    let action: string;
    let body: Record<string, unknown>;
    switch (kind) {
      case "client_site":
        action = "research_client_site";
        body = { url: required(args, "url") };
        break;
      case "prospect":
        action = "research";
        body = { url: required(args, "url"), classification: argStr(args, "classification") };
        break;
      case "niche":
        action = "research_niche";
        body = { niche: required(args, "niche"), clientContext: argStr(args, "clientContext") };
        break;
      case "competitors":
        action = "research_competitors";
        body = {
          clientName: argStr(args, "clientName") || client?.name || "",
          clientUrl: argStr(args, "url") || client?.website || "",
          niche: argStr(args, "niche"),
        };
        if (!body.clientName && !body.clientUrl) throw new Error("'competitors' needs clientName, url, or a clientId with a website.");
        break;
      default:
        throw new Error(`Unknown kind "${kind}".`);
    }

    const r = await callAction(action, body, { clientId: client?.id ?? null });

    if (argBool(args, "save", false)) {
      if (!client) throw new Error("save=true needs a clientId.");
      const { rev, result } = await mutateConfig((draft: Cfg) => {
        const dc = (draft.clients || []).find((x: any) => x.id === client.id);
        if (!dc) throw new Error("client not found");
        const notes: string[] = [];
        dc.sources = dc.sources || {};
        if (r.summary) { dc.sources[String(r.summary).slice(0, 400)] = { type: kind === "competitors" ? "competitor" : "site", label: kind }; notes.push("summary → sources"); }
        if (Array.isArray(r.pains) && r.pains.length) {
          dc.caseStudy = dc.caseStudy || {};
          dc.caseStudy.pains = dc.caseStudy.pains || [];
          let n = 0;
          r.pains.forEach((p: unknown) => { const t = String(p ?? "").trim(); if (t && dc.caseStudy.pains.indexOf(t) < 0) { dc.caseStudy.pains.push(t); n++; } });
          if (n) notes.push(`${n} pains → caseStudy.pains`);
        }
        if (Array.isArray(r.competitors) && r.competitors.length) {
          dc.competitorIntel = dc.competitorIntel || [];
          let n = 0;
          r.competitors.forEach((x: any) => {
            const name = String(x?.name ?? x ?? "").trim();
            if (name && !dc.competitorIntel.some((y: any) => y.name === name)) {
              dc.competitorIntel.push({ name, offer: String(x?.offer ?? x?.pitch ?? ""), notes: String(x?.notes ?? "") });
              n++;
            }
          });
          if (n) notes.push(`${n} competitors → competitorIntel`);
        }
        return notes;
      });
      return { kind, research: r, saved: { client: client.name, merged: result, configRev: rev } };
    }
    return { kind, research: r, saved: null };
  },
};

export const extractTranscript: McpTool = {
  name: "extract_transcript",
  title: "Mine a sales-call transcript",
  description:
    "Pull pains, desires, angles, offer ideas and insights out of a sales-call transcript, in the prospect's own words. Saved transcripts become the RESEARCH block the house lens injects into every ICP/angle call, so this is the highest-leverage way to make the ICP builder concrete instead of generic. Pass clientId + save=true to store it.",
  annotations: { openWorldHint: true },
  inputSchema: schema(
    {
      text: str("The transcript text (up to ~30,000 characters)."),
      title: str("A label for this call, e.g. 'Discovery — Acme, 12 Jun'."),
      clientId: str("Client to attach it to."),
      save: bool("Save the transcript and its extraction onto the client. Needs clientId."),
    },
    ["text"],
  ),
  handler: async (args) => {
    const text = required(args, "text");
    const cid = argStr(args, "clientId");
    let client: Cfg | null = null;
    if (cid) {
      const cfg = await readConfig();
      client = findClient(cfg, cid) ?? null;
      if (!client) throw new Error(`No client matching "${cid}".`);
    }
    const r = await callAction("extract_transcript", { text }, { clientId: client?.id ?? null });

    if (argBool(args, "save", false)) {
      if (!client) throw new Error("save=true needs a clientId.");
      const title = argStr(args, "title") || `Call — ${new Date().toISOString().slice(0, 10)}`;
      const { rev } = await mutateConfig((draft: Cfg) => {
        const dc = (draft.clients || []).find((x: any) => x.id === client.id);
        if (!dc) throw new Error("client not found");
        dc.transcripts = dc.transcripts || [];
        dc.transcripts.push({
          id: mkId("tr", title), title, text: text.slice(0, 30_000),
          pains: r.pains || [], desires: r.desires || [], angles: r.angles || [], offers: r.offers || [],
          savedAt: new Date().toISOString().slice(0, 10),
        });
      });
      return { extraction: r, saved: { client: client.name, title, configRev: rev } };
    }
    return { extraction: r, saved: null };
  },
};

// ─── ops ─────────────────────────────────────────────────────────────────────

export const usageReport: McpTool = {
  name: "usage_report",
  title: "AI usage and spend",
  description: "Today's AI call count against the daily safety cap, plus the per-action token and cost breakdown the Admin → Usage console shows.",
  annotations: { readOnlyHint: true, idempotentHint: true },
  inputSchema: schema({}),
  handler: async () => {
    const u = await getUsage();
    const provider = await activeProvider();
    return { cap: DAILY_AI_CALL_CAP, provider, rates: ratesFor(provider), usage: u };
  },
};

export const getConfigTool: McpTool = {
  name: "get_config",
  title: "Read any part of the raw config",
  description:
    "Power tool. Read any path of the single config document by dotted path, e.g. 'settings', 'settings.systemFilter', 'settings.planDefaults.email', 'niches.0', 'sellerProfile'. Use the dedicated tools first — this is the escape hatch for fields they do not cover.",
  annotations: { readOnlyHint: true, idempotentHint: true },
  inputSchema: schema({
    path: str("Dotted path. Omit for a top-level map of what exists."),
    depth: num("How deep to expand. Default 2; deeper responses get large fast."),
  }),
  handler: async (args) => {
    const cfg = await readConfig();
    const path = argStr(args, "path");
    const depth = Math.max(0, Math.min(argNum(args, "depth", 2), 6));
    const value = path ? getPath(cfg, path) : cfg;
    if (value === undefined) throw new Error(`Nothing at path "${path}".`);
    return { path: path || "(root)", configRev: cfg._rev ?? null, value: summarize(value, depth) };
  },
};

export const patchConfig: McpTool = {
  name: "patch_config",
  title: "Write any part of the raw config",
  description:
    "Power tool — prefer the dedicated tools (upsert_client, set_logic, upsert_framework, …) which validate and keep the shape the web app expects. This writes a raw value at a dotted path with the same atomic compare-and-swap the browser uses. mode: 'set' replaces, 'merge' shallow-merges an object, 'append' pushes onto an array, 'remove' deletes the key. ALWAYS run with dryRun=true first.",
  write: true,
  annotations: { destructiveHint: true },
  inputSchema: schema(
    {
      path: str("Dotted path, e.g. 'settings.growthRules' or 'niches.0.triggerWords'."),
      value: str("JSON-encoded value. Strings may be passed bare. Ignored for mode 'remove'."),
      mode: str("'set' (default), 'merge', 'append', 'remove'.", { enum: ["set", "merge", "append", "remove"] }),
      dryRun: bool("Show the before/after without writing. Default false — but run it true first."),
    },
    ["path"],
  ),
  handler: async (args) => {
    const path = required(args, "path");
    const mode = argStr(args, "mode", "set") || "set";
    const dryRun = argBool(args, "dryRun", false);
    if (/^_rev$|^_dirty$/.test(path)) throw new Error(`"${path}" is managed by the save protocol and must not be written directly.`);

    let value: unknown = undefined;
    if (mode !== "remove") {
      const raw = argStr(args, "value");
      if (!raw) throw new Error(`"value" is required for mode '${mode}'.`);
      try { value = JSON.parse(raw); } catch { value = raw; }
    }

    const cfg = await readConfig();
    const before = getPath(cfg, path);

    const apply = (draft: Cfg): unknown => {
      if (mode === "remove") return deletePath(draft, path);
      if (mode === "merge") {
        const cur = getPath(draft, path);
        if (cur != null && typeof cur === "object" && !Array.isArray(cur) && value != null && typeof value === "object") {
          setPath(draft, path, { ...(cur as Cfg), ...(value as Cfg) });
        } else {
          setPath(draft, path, value);
        }
        return cur;
      }
      if (mode === "append") {
        const cur = getPath(draft, path);
        const list = Array.isArray(cur) ? [...cur] : [];
        if (Array.isArray(value)) list.push(...value); else list.push(value);
        setPath(draft, path, list);
        return cur;
      }
      return setPath(draft, path, value);
    };

    if (dryRun) {
      const draft = structuredClone(cfg) as Cfg;
      apply(draft);
      return {
        dryRun: true, saved: false, path, mode,
        before: summarize(before, 3),
        after: summarize(getPath(draft, path), 3),
      };
    }

    const { rev } = await mutateConfig((draft: Cfg) => { apply(draft); });
    return { saved: true, configRev: rev, path, mode, before: summarize(before, 3), after: summarize(value, 3) };
  },
};

export const CORE_TOOLS: McpTool[] = [
  whoami,
  search,
  fetchTool,
  listClients,
  getClient,
  upsertClient,
  listNiches,
  upsertNiche,
  research,
  extractTranscript,
  usageReport,
  getConfigTool,
  patchConfig,
];
