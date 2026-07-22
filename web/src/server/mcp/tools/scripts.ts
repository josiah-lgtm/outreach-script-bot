// Outreach-script tools: generate the matrix, refine, curate the board, and
// reverse-engineer winners into new frameworks.

import { readConfig, mutateConfig, findClient, findNiche, findFramework, type Cfg } from "../config-io";
import { buildGenerateBody } from "../context";
import { callAction } from "../invoke";
import { dedupeScripts } from "@/lib/dedupe";
import { nextScriptName } from "@/lib/text-utils";
import { schema, str, bool, num, arr, argStr, argBool, argNum, argArr, required, type McpTool } from "../types";

const STATUSES = ["idea", "testing", "winning"] as const;
const MAX_TESTING = 8; // the kanban board's hard cap — mirrored here so MCP writes can't break it

export const generateScripts: McpTool = {
  name: "generate_scripts",
  title: "Generate outreach scripts for a client",
  description:
    "Run the script matrix for a client: one Claude call per framework, one script per angle × variant. Assembles the same payload the web wizard does — the client's case study, niche pains/desires/offers, favourites, active mechanism, ICP persona, competitor intel, hard exclusions, guarantees, and the client's own winning scripts as style exemplars — then applies the house lens and the scriptFirstLiner engine. Costs one AI call per framework. Pass save=true to drop the results onto the client's board as Ideas. To change HOW it writes, edit the 'scriptWriter' / 'scriptFirstLiner' slots via set_logic, or the framework templates via upsert_framework.",
  annotations: { openWorldHint: true },
  inputSchema: schema(
    {
      clientId: str("Client id or name."),
      nicheId: str("Niche id or name. Defaults to the client's first niche — this selects which pain/desire/offer bucket and trigger words are used."),
      icpId: str("Saved ICP id — every script is written TO this persona. Strongly recommended; see list_icps."),
      frameworkIds: arr("Which frameworks to write against (max 6). Defaults to all configured frameworks.", { type: "string" }),
      angles: arr("The angles/pains to write against (max 8). Defaults to the client's top niche pains.", { type: "string" }),
      desires: arr("Desired outcomes to point at. Defaults to the client's favourites.", { type: "string" }),
      variantsPerAngle: num("1-3 variants per angle. Default 1."),
      mechanismId: str("Which saved mechanism to use as the 'how it works'. Defaults to the client's active mechanism."),
      dedupe: bool("Drop near-duplicate scripts (Jaccard ≥ 0.82) across the whole matrix. Default true."),
      save: bool("Save the generated scripts to the client's board as Ideas. Default false."),
    },
    ["clientId"],
  ),
  handler: async (args) => {
    const cfg = await readConfig();
    const c = findClient(cfg, required(args, "clientId"));
    if (!c) throw new Error(`No client matching "${argStr(args, "clientId")}". Use list_clients.`);

    const nicheArg = argStr(args, "nicheId");
    const niche = nicheArg ? findNiche(cfg, nicheArg) : (cfg.niches || []).find((n: any) => (c.nicheIds || []).includes(n.id));
    if (nicheArg && !niche) throw new Error(`No niche matching "${nicheArg}". Use list_niches.`);

    const fwIds = argArr(args, "frameworkIds").map((f) => {
      const found = findFramework(cfg, f);
      if (!found) throw new Error(`No framework matching "${f}". Use list_frameworks.`);
      return found.id as string;
    });

    const icpId = argStr(args, "icpId") || null;
    if (icpId && !(c.icps || []).some((x: any) => x.id === icpId)) {
      throw new Error(`No ICP with id "${icpId}" on ${c.name}. Use list_icps.`);
    }

    const body = buildGenerateBody(cfg, c, {
      nicheId: niche?.id ?? null,
      icpId,
      frameworkIds: fwIds.length ? fwIds : undefined,
      angles: argArr(args, "angles"),
      desires: argArr(args, "desires"),
      mechanismId: argStr(args, "mechanismId") || null,
      variantsPerAngle: argNum(args, "variantsPerAngle", 1),
    }) as any;

    if (!body.frameworks.length) throw new Error("No frameworks configured — create one with upsert_framework first.");
    if (!body.angles.length) {
      throw new Error(
        `No angles to write against. ${c.name} has no saved pains for this niche — pass angles explicitly, or run suggest_angles / extract_transcript first.`,
      );
    }

    const r = await callAction("generate", body, { clientId: c.id });

    // Flatten the per-framework results into one list, same shape the swipe deck uses.
    const cards: Array<{ text: string; fw: string; frameworkId: string; angle: string; label: string }> = [];
    const errors: Array<{ framework: string; error: string }> = [];
    for (const res of r.results || []) {
      if (res.error) { errors.push({ framework: res.framework, error: res.error }); continue; }
      for (const v of res.variants || []) {
        const text = String(v.script ?? "").trim();
        if (text) {
          cards.push({
            text, fw: res.framework, frameworkId: res.frameworkId,
            angle: String(v.angle ?? ""), label: String(v.label ?? ""),
          });
        }
      }
    }

    let deck = cards;
    let dedupNote = "";
    if (argBool(args, "dedupe", true) && cards.length > 1) {
      // dedupeScripts keys off `.text`, which is exactly the field these cards carry.
      const kept = dedupeScripts(cards);
      const dropped = cards.length - kept.length;
      if (dropped > 0) dedupNote = `${dropped} near-duplicate script(s) dropped (Jaccard ≥ 0.82, cap 30).`;
      deck = kept;
    }

    let savedIds: string[] = [];
    let rev: number | null = null;
    if (argBool(args, "save", false) && deck.length) {
      const out = await mutateConfig((draft: Cfg) => {
        const dc = (draft.clients || []).find((x: any) => x.id === c.id);
        if (!dc) throw new Error("client not found");
        dc.scriptReservoir = dc.scriptReservoir || [];
        const ids: string[] = [];
        deck.forEach((card) => {
          const id = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          dc.scriptReservoir.push({
            id,
            script: card.text,
            status: "idea",
            framework: card.fw,
            frameworkId: card.frameworkId,
            angle: card.angle,
            nicheId: niche?.id ?? "",
            icpId: icpId ?? "",
            savedAt: new Date().toISOString().slice(0, 10),
            name: nextScriptName(dc),
            versions: [card.text],
            source: "mcp",
          });
          ids.push(id);
        });
        return ids;
      });
      savedIds = out.result;
      rev = out.rev;
    }

    return {
      client: { id: c.id, name: c.name },
      niche: niche?.name ?? "(none)",
      frameworks: body.frameworks.map((f: any) => f.name),
      angles: body.angles,
      generated: cards.length,
      returned: deck.length,
      dedupNote,
      errors,
      scripts: deck,
      saved: savedIds.length
        ? { count: savedIds.length, ids: savedIds, status: "idea", configRev: rev }
        : { count: 0, note: "Not saved. Call again with save=true, or save chosen ones with upsert_script." },
      usage: r.usage ?? null,
    };
  },
};

export const refineScript: McpTool = {
  name: "refine_script",
  title: "Rewrite a script with an instruction",
  description:
    "Rewrite a script with a plain-English instruction ('make it shorter', 'lead with the pain not the proof', 'drop the meeting ask'). Pass the script text inline, or clientId + scriptId to refine one on the board (with save=true to write the new version back, keeping the version history).",
  annotations: { openWorldHint: true },
  inputSchema: schema(
    {
      instruction: str("What to change. Only the requested change is made — the rest is preserved."),
      script: str("The script text. Omit if using clientId + scriptId."),
      clientId: str("Client id or name — required with scriptId."),
      scriptId: str("Script id on that client's board. Use list_scripts."),
      model: str("'haiku' (fast/cheap), 'sonnet' (default), or 'opus'.", { enum: ["haiku", "sonnet", "opus"] }),
      save: bool("Write the rewrite back as a new version of the saved script. Requires clientId + scriptId."),
    },
    ["instruction"],
  ),
  handler: async (args) => {
    const instruction = required(args, "instruction");
    const cid = argStr(args, "clientId");
    const sid = argStr(args, "scriptId");
    let text = argStr(args, "script").trim();
    let clientId: string | null = null;

    if (!text) {
      if (!cid || !sid) throw new Error("Pass either `script` text, or both `clientId` and `scriptId`.");
      const cfg = await readConfig();
      const c = findClient(cfg, cid);
      if (!c) throw new Error(`No client matching "${cid}".`);
      clientId = c.id;
      const s = (c.scriptReservoir || []).find((x: any) => x.id === sid);
      if (!s) throw new Error(`No script with id "${sid}" on ${c.name}. Use list_scripts.`);
      text = String(s.script ?? "");
    } else if (cid) {
      const cfg = await readConfig();
      clientId = findClient(cfg, cid)?.id ?? null;
    }

    const r = await callAction(
      "refine_script",
      { script: text, prompt: instruction, model: argStr(args, "model") || undefined },
      { clientId },
    );
    const revised = String(r.script ?? "").trim();

    if (argBool(args, "save", false)) {
      if (!clientId || !sid) throw new Error("save=true needs clientId and scriptId.");
      const { rev } = await mutateConfig((draft: Cfg) => {
        const dc = (draft.clients || []).find((x: any) => x.id === clientId);
        const s = (dc?.scriptReservoir || []).find((x: any) => x.id === sid);
        if (!s) throw new Error("script not found");
        s.versions = s.versions || [s.script];
        s.versions.push(revised);
        s.script = revised;
      });
      return { instruction, before: text, after: revised, saved: true, configRev: rev };
    }
    return { instruction, before: text, after: revised, saved: false };
  },
};

export const suggestAngles: McpTool = {
  name: "suggest_angles",
  title: "Suggest new angles for a niche",
  description:
    "Generate 6 testable cold-email angle hooks for a niche — each a 5-14 word problem, trigger event or curiosity gap. Pass save=true with a clientId to append them to that client's niche pain bucket. Steered by the 'angleSuggester' and 'icpAngles' slots.",
  annotations: { openWorldHint: true },
  inputSchema: schema(
    {
      niche: str("Niche id or name."),
      clientId: str("Optional client — supplies context and scopes the research block in the lens."),
      direction: str("Optional focus, e.g. 'angles about hiring freezes' or 'lead with cost, not growth'."),
      save: bool("Append the angles to the client's pain bucket for that niche. Needs clientId."),
    },
    ["niche"],
  ),
  handler: async (args) => {
    const cfg = await readConfig();
    const nicheArg = required(args, "niche");
    const niche = findNiche(cfg, nicheArg);
    const nicheName = niche?.name ?? nicheArg;
    const cid = argStr(args, "clientId");
    const c = cid ? findClient(cfg, cid) : null;
    if (cid && !c) throw new Error(`No client matching "${cid}".`);

    const clientContext = c
      ? [c.name, (c.caseStudy || {}).proofLine, (c.caseStudy || {}).mechanism].filter(Boolean).join(" — ")
      : "";
    const r = await callAction(
      "suggest_angles",
      { niche: nicheName, clientContext, prompt: argStr(args, "direction") },
      { clientId: c?.id ?? null },
    );
    const angles: string[] = Array.isArray(r.angles) ? r.angles.map(String) : [];

    if (argBool(args, "save", false)) {
      if (!c) throw new Error("save=true needs a clientId.");
      if (!niche) throw new Error(`"${nicheArg}" is not a saved niche, so there is no bucket to save into.`);
      const { rev, result } = await mutateConfig((draft: Cfg) => {
        const dc = (draft.clients || []).find((x: any) => x.id === c.id);
        if (!dc) throw new Error("client not found");
        dc.nicheData = dc.nicheData || {};
        const b = (dc.nicheData[niche.id] = dc.nicheData[niche.id] || { pains: [], desires: [], offers: [] });
        b.pains = b.pains || [];
        let added = 0;
        angles.forEach((a) => { if (a && b.pains.indexOf(a) < 0) { b.pains.push(a); added++; } });
        return added;
      });
      return { niche: nicheName, angles, saved: { added: result, bucket: `${c.name} → ${niche.name} → pains`, configRev: rev } };
    }
    return { niche: nicheName, angles, saved: null };
  },
};

export const suggestOffers: McpTool = {
  name: "suggest_offers",
  title: "Suggest offer packages for a client",
  description:
    "Propose 4-6 concrete, risk-reversed offer packages from a client's case-study data. Steered by the 'offerSuggester' slot. Pass save=true to append them to the client's offers.",
  annotations: { openWorldHint: true },
  inputSchema: schema(
    {
      clientId: str("Client id or name."),
      nicheId: str("Optional niche — saves into that niche's offer bucket."),
      save: bool("Append the offer names + descriptions to the client's offers."),
    },
    ["clientId"],
  ),
  handler: async (args) => {
    const cfg = await readConfig();
    const c = findClient(cfg, required(args, "clientId"));
    if (!c) throw new Error(`No client matching "${argStr(args, "clientId")}".`);
    const cs = c.caseStudy || {};
    const context = [
      `Client: ${c.name} (${c.meta ?? ""})`,
      cs.size ? `Size: ${cs.size}` : "",
      cs.mechanism ? `Mechanism: ${cs.mechanism}` : "",
      cs.result ? `Result: ${cs.result}` : "",
      cs.proofLine ? `Proof: ${cs.proofLine}` : "",
      (cs.pains || []).length ? `Pains: ${(cs.pains || []).join("; ")}` : "",
      (cs.desires || []).length ? `Desires: ${(cs.desires || []).join("; ")}` : "",
    ].filter(Boolean).join("\n");

    const r = await callAction("suggest_offers", { context }, { clientId: c.id });
    const offers: Array<{ name: string; description: string }> = r.offers ?? [];

    if (argBool(args, "save", false) && offers.length) {
      const niche = argStr(args, "nicheId") ? findNiche(cfg, argStr(args, "nicheId")) : null;
      const { rev, result } = await mutateConfig((draft: Cfg) => {
        const dc = (draft.clients || []).find((x: any) => x.id === c.id);
        if (!dc) throw new Error("client not found");
        const lines = offers.map((o) => `${o.name}: ${o.description}`);
        let added = 0;
        const push = (target: string[]) => lines.forEach((l) => { if (target.indexOf(l) < 0) { target.push(l); added++; } });
        if (niche) {
          dc.nicheData = dc.nicheData || {};
          const b = (dc.nicheData[niche.id] = dc.nicheData[niche.id] || { pains: [], desires: [], offers: [] });
          b.offers = b.offers || [];
          push(b.offers);
        } else {
          dc.caseStudy = dc.caseStudy || {};
          dc.caseStudy.offers = dc.caseStudy.offers || [];
          push(dc.caseStudy.offers);
        }
        return added;
      });
      return { client: c.name, offers, saved: { added: result, configRev: rev } };
    }
    return { client: c.name, offers, saved: null };
  },
};

export const extractFramework: McpTool = {
  name: "extract_framework",
  title: "Reverse-engineer scripts into a framework",
  description:
    "Feed in one or more scripts that got replies and get back a reusable framework: the load-bearing structure with {{variables}} in place of the situation-specific parts, plus the rules that make it win. Pass save=true to add it to the framework list so generate_scripts can write against it. Steered by the 'frameworkExtractor' slot.",
  annotations: { openWorldHint: true },
  inputSchema: schema(
    {
      scripts: arr("The winning scripts, verbatim.", { type: "string" }),
      context: str("Optional: what these scripts were for, and why they worked."),
      save: bool("Add the extracted framework to the config."),
    },
    ["scripts"],
  ),
  handler: async (args) => {
    const scripts = argArr(args, "scripts");
    if (!scripts.length) throw new Error('"scripts" must contain at least one script.');
    const r = await callAction("extract_framework", { scripts, context: argStr(args, "context") });

    if (argBool(args, "save", false)) {
      const { mkId } = await import("../config-io");
      const id = mkId("fw", String(r.name ?? "framework"));
      const { rev } = await mutateConfig((draft: Cfg) => {
        draft.frameworks = draft.frameworks || [];
        draft.frameworks.push({
          id,
          name: String(r.name ?? "Extracted framework"),
          category: String(r.category ?? "Extracted"),
          template: String(r.template ?? ""),
          rules: String(r.rules ?? ""),
          nicheIds: [],
        });
      });
      return { ...r, saved: { id, configRev: rev } };
    }
    return { ...r, saved: null };
  },
};

export const generateFollowups: McpTool = {
  name: "generate_followups",
  title: "Write a follow-up sequence",
  description:
    "Write the follow-up emails that go out after a first cold email got no reply — one per follow-up framework, spaced by gapDays. Uses the client's real proof, mechanism, pains and ICP so no placeholder survives. Steered by the 'followupWriter' slot.",
  annotations: { openWorldHint: true },
  inputSchema: schema(
    {
      clientId: str("Client id or name."),
      parentScript: str("The first script that was already sent — the follow-ups build on its thread."),
      scriptId: str("Alternatively, the id of a saved script to use as the parent."),
      frameworkIds: arr("Which follow-up frameworks to use, in order. Defaults to the first three configured.", { type: "string" }),
      gapDays: num("Days between each follow-up. Default 2."),
      icpId: str("Saved ICP id to speak to."),
    },
    ["clientId"],
  ),
  handler: async (args) => {
    const cfg = await readConfig();
    const c = findClient(cfg, required(args, "clientId"));
    if (!c) throw new Error(`No client matching "${argStr(args, "clientId")}".`);

    let parent = argStr(args, "parentScript").trim();
    const sid = argStr(args, "scriptId");
    if (!parent && sid) {
      const s = (c.scriptReservoir || []).find((x: any) => x.id === sid);
      if (!s) throw new Error(`No script with id "${sid}" on ${c.name}.`);
      parent = String(s.script ?? "");
    }

    const all: any[] = cfg.followupFrameworks || [];
    const wanted = argArr(args, "frameworkIds");
    const frameworks = wanted.length
      ? wanted.map((w) => {
        const f = all.find((x) => x.id === w || String(x.name).toLowerCase() === w.toLowerCase());
        if (!f) throw new Error(`No follow-up framework matching "${w}". Available: ${all.map((x) => x.id).join(", ")}`);
        return { name: f.name, template: f.template };
      })
      : all.slice(0, 3).map((f) => ({ name: f.name, template: f.template }));
    if (!frameworks.length) throw new Error("No follow-up frameworks configured.");

    const icp = (c.icps || []).find((x: any) => x.id === argStr(args, "icpId"));
    const r = await callAction(
      "generate_followups",
      {
        parentScript: parent,
        frameworks,
        gapDays: argNum(args, "gapDays", 2),
        icp: icp ? { title: icp.title, jobTitles: icp.jobTitles, niche: icp.niche } : undefined,
        client: { name: c.name, caseStudy: c.caseStudy || {} },
        basis: {
          pains: ((c.caseStudy || {}).pains || []).slice(0, 10),
          desires: ((c.caseStudy || {}).desires || []).slice(0, 10),
          angles: (c.savedAngles || []).slice(0, 10),
        },
        rules: (cfg.settings || {}).globalRules ?? "",
      },
      { clientId: c.id },
    );
    return { client: c.name, followups: r.followups ?? [] };
  },
};

// ─── board ───────────────────────────────────────────────────────────────────

export const listScripts: McpTool = {
  name: "list_scripts",
  title: "List a client's saved scripts",
  description:
    "List the scripts on a client's kanban board. Statuses are 'idea', 'testing' (max 8 at a time) and 'winning'. Returns ids for refine_script and upsert_script.",
  annotations: { readOnlyHint: true, idempotentHint: true },
  inputSchema: schema(
    {
      clientId: str("Client id or name."),
      status: str("Filter by column: 'idea', 'testing' or 'winning'.", { enum: [...STATUSES] }),
      limit: num("Max scripts to return. Default 50."),
      full: bool("Return the full script text. Default true; set false for a compact index."),
    },
    ["clientId"],
  ),
  handler: async (args) => {
    const cfg = await readConfig();
    const c = findClient(cfg, required(args, "clientId"));
    if (!c) throw new Error(`No client matching "${argStr(args, "clientId")}".`);
    const status = argStr(args, "status");
    const full = argBool(args, "full", true);
    const limit = argNum(args, "limit", 50);
    const all: any[] = c.scriptReservoir || [];
    const filtered = status ? all.filter((s) => (s.status || "idea") === status) : all;
    return {
      client: { id: c.id, name: c.name },
      counts: {
        idea: all.filter((s) => (s.status || "idea") === "idea").length,
        testing: all.filter((s) => s.status === "testing").length,
        winning: all.filter((s) => s.status === "winning").length,
      },
      returned: Math.min(filtered.length, limit),
      scripts: filtered.slice(0, limit).map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status || "idea",
        framework: s.framework ?? "",
        angle: s.angle ?? "",
        savedAt: s.savedAt ?? "",
        versions: (s.versions || []).length,
        script: full ? s.script : String(s.script ?? "").slice(0, 140) + "…",
      })),
    };
  },
};

export const upsertScript: McpTool = {
  name: "upsert_script",
  title: "Save, move or delete a script",
  description:
    "Add a script to a client's board, edit its text, move it between columns, or delete it with remove=true. Moving to 'testing' respects the board's 8-script cap. Editing text keeps the version history so the editor's version rail still works.",
  write: true,
  annotations: { idempotentHint: true, destructiveHint: true },
  inputSchema: schema(
    {
      clientId: str("Client id or name."),
      scriptId: str("Existing script id. Omit to create a new one."),
      script: str("The script text."),
      status: str("Board column.", { enum: [...STATUSES] }),
      framework: str("Which framework it came from (label only)."),
      angle: str("The angle it was written against."),
      name: str("Display name. Auto-generated as '<D Mon> · v<n>' when omitted."),
      remove: bool("Delete this script."),
    },
    ["clientId"],
  ),
  handler: async (args) => {
    const cfg = await readConfig();
    const c = findClient(cfg, required(args, "clientId"));
    if (!c) throw new Error(`No client matching "${argStr(args, "clientId")}".`);
    const sid = argStr(args, "scriptId");
    const remove = argBool(args, "remove", false);

    if (remove) {
      if (!sid) throw new Error('"scriptId" is required when remove=true.');
      const { rev } = await mutateConfig((draft: Cfg) => {
        const dc = (draft.clients || []).find((x: any) => x.id === c.id);
        if (!dc) throw new Error("client not found");
        const before = (dc.scriptReservoir || []).length;
        dc.scriptReservoir = (dc.scriptReservoir || []).filter((x: any) => x.id !== sid);
        if (dc.scriptReservoir.length === before) throw new Error(`No script with id "${sid}" on ${c.name}.`);
      });
      return { deleted: true, scriptId: sid, configRev: rev };
    }

    const status = argStr(args, "status");
    if (status && !STATUSES.includes(status as never)) {
      throw new Error(`status must be one of: ${STATUSES.join(", ")}`);
    }
    if (!sid && !argStr(args, "script").trim()) throw new Error('"script" is required when creating.');

    const { rev, result } = await mutateConfig((draft: Cfg) => {
      const dc = (draft.clients || []).find((x: any) => x.id === c.id);
      if (!dc) throw new Error("client not found");
      dc.scriptReservoir = dc.scriptReservoir || [];
      let s = sid ? dc.scriptReservoir.find((x: any) => x.id === sid) : null;
      if (sid && !s) throw new Error(`No script with id "${sid}" on ${c.name}.`);
      const created = !s;

      if (status === "testing") {
        const testing = dc.scriptReservoir.filter((x: any) => x.status === "testing" && x.id !== sid).length;
        if (testing >= MAX_TESTING) {
          throw new Error(
            `${c.name} already has ${MAX_TESTING} scripts in Testing — that is the board's cap. Move one to Winning or back to Ideas first.`,
          );
        }
      }

      if (!s) {
        s = {
          id: "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          status: "idea",
          savedAt: new Date().toISOString().slice(0, 10),
          versions: [],
          source: "mcp",
        };
        s.name = argStr(args, "name") || nextScriptName(dc);
        dc.scriptReservoir.push(s);
      }
      const text = argStr(args, "script");
      if (text && text !== s.script) {
        s.versions = s.versions || [];
        if (s.script) s.versions.push(s.script);
        s.script = text;
        if (!s.versions.length) s.versions.push(text);
      }
      if (status) s.status = status;
      for (const k of ["framework", "angle", "name"] as const) {
        const v = argStr(args, k);
        if (v) s[k] = v;
      }
      return { created, script: { ...s } };
    });
    return { saved: true, configRev: rev, ...(result as object) };
  },
};

export const SCRIPT_TOOLS: McpTool[] = [
  generateScripts,
  refineScript,
  suggestAngles,
  suggestOffers,
  extractFramework,
  generateFollowups,
  listScripts,
  upsertScript,
];
