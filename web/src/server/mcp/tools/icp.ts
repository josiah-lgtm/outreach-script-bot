// ICP builder tools: run it, read what it produced, curate the saved profiles.
//
// The runtime behaviour of build_icp is steered by the `icpBuilder` and `icpAngles`
// prompt slots plus settings.systemFilter — all editable through get_logic/set_logic.

import { readConfig, mutateConfig, findClient, mkId, type Cfg } from "../config-io";
import { icpDossier } from "../context";
import { callAction } from "../invoke";
import { schema, str, bool, num, arr, argStr, argBool, argNum, argArr, required, type McpTool } from "../types";

const ICP_FIELDS = [
  "title", "niche", "jobTitles", "locations", "employeeSize", "revenue",
  "marketSize", "why", "outboundNotes", "score", "description",
] as const;

function normalizeIcp(raw: any): Cfg {
  const out: Cfg = {};
  for (const k of ICP_FIELDS) if (raw?.[k] !== undefined) out[k] = raw[k];
  out.jobTitles = Array.isArray(out.jobTitles) ? out.jobTitles.map(String) : [];
  out.locations = Array.isArray(out.locations) ? out.locations.map(String) : [];
  out.description = typeof out.description === "string" ? out.description : "";
  out.pains = Array.isArray(raw?.pains) ? raw.pains.map(String) : [];
  out.desires = Array.isArray(raw?.desires) ? raw.desires.map(String) : [];
  out.objections = Array.isArray(raw?.objections) ? raw.objections.map(String) : [];
  out.painGroups = [];
  out.desireGroups = [];
  return out;
}

export const buildIcp: McpTool = {
  name: "build_icp",
  title: "Build ideal customer profiles for a client",
  description:
    "Run the ICP builder for a client. It assembles the client's full dossier (offer, mechanism, proof, pains, desires, objections, call-transcript intel, competitors, niches) exactly as the web app does, applies the house lens and the icpBuilder engine prompt, web-searches to estimate market size, and returns 1-5 ranked ideal customer profiles with job titles, geos, size bands, reachable-market estimates and why each fits. Costs an AI call (~30-60s). Pass save=true to persist the returned ICPs onto the client, or review first and persist chosen ones with upsert_icp. To change HOW it thinks, edit the 'icpBuilder' / 'icpAngles' slots via set_logic.",
  annotations: { openWorldHint: true },
  inputSchema: schema(
    {
      clientId: str("Client id or name. The dossier is built from this client's saved data."),
      extraContext: str("Optional extra context appended to the dossier — a brief, a positioning note, a constraint like 'US only, under 200 employees'."),
      save: bool("Persist every returned ICP onto the client. Default false (review first)."),
    },
    ["clientId"],
  ),
  handler: async (args) => {
    const cfg = await readConfig();
    const c = findClient(cfg, required(args, "clientId"));
    if (!c) throw new Error(`No client matching "${argStr(args, "clientId")}". Use list_clients to see the ids.`);

    let dossier = icpDossier(cfg, c);
    const extra = argStr(args, "extraContext").trim();
    if (extra) dossier += `\n\nADDITIONAL CONTEXT FROM THE OPERATOR:\n${extra}`;
    if (dossier.length < 80) {
      throw new Error(
        `The dossier for "${c.name}" is too thin (${dossier.length} chars) for the ICP builder to work with. Fill in the case study / pains / offers first — research(kind='client_site') then upsert_client is the fastest path.`,
      );
    }

    const r = await callAction("build_icp", { context: dossier }, { clientId: c.id });
    const icps: any[] = Array.isArray(r.icps) ? r.icps : [];

    let saved: string[] = [];
    let rev: number | null = null;
    if (argBool(args, "save", false) && icps.length) {
      const out = await mutateConfig((draft: Cfg) => {
        const dc = (draft.clients || []).find((x: any) => x.id === c.id);
        if (!dc) throw new Error("client disappeared while saving");
        dc.icps = dc.icps || [];
        const added: string[] = [];
        icps.forEach((raw) => {
          if (dc.icps.some((x: any) => x.title === raw.title)) return; // don't duplicate
          const icp = normalizeIcp(raw);
          icp.id = mkId("icp", icp.title as string);
          icp.savedAt = new Date().toISOString().slice(0, 10);
          dc.icps.push(icp);
          added.push(icp.id as string);
        });
        return added;
      });
      saved = out.result;
      rev = out.rev;
    }

    return {
      client: { id: c.id, name: c.name },
      dossierChars: dossier.length,
      insights: r.insights ?? "",
      icps,
      saved: saved.length ? { count: saved.length, ids: saved, configRev: rev } : { count: 0, note: "Not saved. Call again with save=true, or persist a chosen one with upsert_icp." },
    };
  },
};

export const listIcps: McpTool = {
  name: "list_icps",
  title: "List a client's saved ICPs",
  description: "List the ideal customer profiles saved on a client, with their ids (needed by generate_scripts, find_icp_example and upsert_icp).",
  annotations: { readOnlyHint: true, idempotentHint: true },
  inputSchema: schema({ clientId: str("Client id or name.") }, ["clientId"]),
  handler: async (args) => {
    const cfg = await readConfig();
    const c = findClient(cfg, required(args, "clientId"));
    if (!c) throw new Error(`No client matching "${argStr(args, "clientId")}".`);
    return {
      client: { id: c.id, name: c.name },
      count: (c.icps || []).length,
      icps: c.icps || [],
    };
  },
};

export const upsertIcp: McpTool = {
  name: "upsert_icp",
  title: "Save, edit or delete an ICP",
  description:
    "Save a new ideal customer profile onto a client, edit an existing one, or delete it with remove=true. Use this to persist a single ICP that build_icp proposed, or to hand-write one.",
  write: true,
  annotations: { idempotentHint: true, destructiveHint: true },
  inputSchema: schema(
    {
      clientId: str("Client id or name."),
      icpId: str("Existing ICP id. Omit to create a new one."),
      title: str("Short memorable ICP label."),
      niche: str("The vertical / niche."),
      jobTitles: arr("Exact buyer job titles to target.", { type: "string" }),
      locations: arr("Geos, most accessible first.", { type: "string" }),
      employeeSize: str("Company size band, e.g. '11-50'."),
      revenue: str("Revenue band, if relevant."),
      marketSize: str("Estimated reachable prospects plus the basis for the estimate."),
      why: str("Why this ICP fits THIS client — tie to their pains, mechanism and proof."),
      outboundNotes: str("Reachability, buying triggers, what to lead with."),
      description: str("Free-text description used by the wizard."),
      pains: arr("Pains for this ICP.", { type: "string" }),
      desires: arr("Desired outcomes for this ICP.", { type: "string" }),
      objections: arr("Objections this ICP raises.", { type: "string" }),
      score: num("Outbound-fit score, 1-10."),
      remove: bool("Delete this ICP."),
    },
    ["clientId"],
  ),
  handler: async (args) => {
    const cfg = await readConfig();
    const c = findClient(cfg, required(args, "clientId"));
    if (!c) throw new Error(`No client matching "${argStr(args, "clientId")}".`);
    const icpId = argStr(args, "icpId");
    const remove = argBool(args, "remove", false);

    if (remove) {
      if (!icpId) throw new Error('"icpId" is required when remove=true.');
      const { rev } = await mutateConfig((draft: Cfg) => {
        const dc = (draft.clients || []).find((x: any) => x.id === c.id);
        if (!dc) throw new Error("client not found");
        const before = (dc.icps || []).length;
        dc.icps = (dc.icps || []).filter((x: any) => x.id !== icpId);
        if (dc.icps.length === before) throw new Error(`No ICP with id "${icpId}" on ${c.name}.`);
      });
      return { deleted: true, icpId, configRev: rev };
    }

    if (!icpId && !argStr(args, "title").trim()) throw new Error('"title" is required when creating an ICP.');

    const { rev, result } = await mutateConfig((draft: Cfg) => {
      const dc = (draft.clients || []).find((x: any) => x.id === c.id);
      if (!dc) throw new Error("client not found");
      dc.icps = dc.icps || [];
      let icp = icpId ? dc.icps.find((x: any) => x.id === icpId) : null;
      const created = !icp;
      if (icpId && !icp) throw new Error(`No ICP with id "${icpId}" on ${c.name}.`);
      if (!icp) {
        icp = normalizeIcp({});
        icp.id = mkId("icp", argStr(args, "title"));
        icp.savedAt = new Date().toISOString().slice(0, 10);
        dc.icps.push(icp);
      }
      for (const k of ["title", "niche", "employeeSize", "revenue", "marketSize", "why", "outboundNotes", "description"] as const) {
        const v = argStr(args, k);
        if (v) icp[k] = v;
      }
      for (const k of ["jobTitles", "locations", "pains", "desires", "objections"] as const) {
        if (Array.isArray(args[k])) icp[k] = argArr(args, k);
      }
      if (args.score !== undefined) icp.score = argNum(args, "score", 0);
      icp.painGroups = icp.painGroups || [];
      icp.desireGroups = icp.desireGroups || [];
      return { created, icp: { ...icp } };
    });
    return { saved: true, configRev: rev, ...(result as object) };
  },
};

export const findIcpExample: McpTool = {
  name: "find_icp_example",
  title: "Find a real company matching an ICP",
  description:
    "Web-search for ONE real, currently operating company that is a textbook example of an ICP — useful for sanity-checking that a profile is actually reachable and for showing the client what the target looks like. Costs an AI call. Pass clientId + icpId, or describe the ICP inline.",
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: schema({
    clientId: str("Client id or name — required if you pass icpId."),
    icpId: str("Saved ICP id on that client."),
    title: str("Inline ICP label, if not using a saved one."),
    niche: str("Inline: the vertical."),
    jobTitles: arr("Inline: buyer titles.", { type: "string" }),
    employeeSize: str("Inline: company size band."),
    locations: arr("Inline: geos.", { type: "string" }),
  }),
  handler: async (args) => {
    let icp: Cfg | null = null;
    let clientId: string | null = null;
    const cid = argStr(args, "clientId");
    const iid = argStr(args, "icpId");
    if (cid && iid) {
      const cfg = await readConfig();
      const c = findClient(cfg, cid);
      if (!c) throw new Error(`No client matching "${cid}".`);
      clientId = c.id;
      icp = (c.icps || []).find((x: any) => x.id === iid) ?? null;
      if (!icp) throw new Error(`No ICP with id "${iid}" on ${c.name}. Use list_icps.`);
    } else {
      const title = argStr(args, "title").trim();
      if (!title) throw new Error("Pass either clientId + icpId, or an inline ICP with at least a title.");
      icp = {
        title,
        niche: argStr(args, "niche"),
        jobTitles: argArr(args, "jobTitles"),
        employeeSize: argStr(args, "employeeSize"),
        locations: argArr(args, "locations"),
      };
    }
    const r = await callAction(
      "find_icp_example",
      {
        icp: {
          title: icp.title, niche: icp.niche, jobTitles: icp.jobTitles ?? [],
          employeeSize: icp.employeeSize ?? "", locations: icp.locations ?? [],
        },
      },
      { clientId },
    );
    return { icp: icp.title, company: r.company ?? "", website: r.website ?? "", why: r.why ?? "" };
  },
};

export const ICP_TOOLS: McpTool[] = [buildIcp, listIcps, upsertIcp, findIcpExample];
