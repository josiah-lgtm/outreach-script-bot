// MCP resources + prompts.
//
// Resources are the "read this to understand the system" surface: a written guide
// to how the ICP builder and script maker actually work, the live logic, and the
// shipped defaults for every prompt slot (so a model can diff its override against
// the original before overwriting it).
//
// Prompts are the guided workflows a user picks from the host's prompt menu.

import { SLOTS } from "../prompts";
import { readConfig } from "./config-io";
import { getLogic } from "./tools/logic";
import type { ToolCtx } from "./types";

export interface McpResource {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
  read: (ctx: ToolCtx) => Promise<string>;
}

const GUIDE = `# Outreach Script Bot — how the machine actually works

This MCP server drives an internal tool that turns what an agency knows about a
client into (a) ideal customer profiles and (b) send-ready cold outreach scripts.
Everything lives in ONE config document, edited concurrently by the web app and
by this server, protected by an atomic compare-and-swap.

## The two products

**ICP builder** (\`build_icp\`) takes a client's dossier — offer, mechanism, proof,
customer pains, desires, objections, call-transcript intel, competitors, niches —
and returns 1-5 ranked ideal customer profiles: job titles, geos, size bands, an
estimated reachable-market size (web-searched), and why each fits THIS client.
The house rule it is built around: an outbound-viable market is roughly
10,000-100,000 reachable prospects, ~30-40K being ideal.

**Script maker** (\`generate_scripts\`) writes a matrix: one Claude call per
framework, one script per angle × variant. Into every call it folds the client's
case study, the selected niche's pain/desire/offer bucket and trigger words, the
chosen ICP persona, the active mechanism, competitor intel, hard exclusions,
guarantees, and up to four of the client's own winning scripts as style exemplars.

## The three layers of "logic"

1. **House lens** — \`settings.systemFilter.{lens,messaging,icpScripter,offers}\`.
   Free text, injected as the FIRST system block on every AI call. This is where
   agency-wide knowledge and taste live.
2. **Engine slots** — \`settings.engines.<slot>\`. Overrides for the baked-in
   methodology prompts: the ICP builder's whole system prompt, the first-liner
   engines, the script-writer persona, the refiners, the extractors. An empty slot
   means "use the shipped default", so any change is revertible.
3. **Structure** — \`settings.globalRules\` (style rules folded into every
   generation), \`frameworks[]\` (the script templates and their rules), and
   \`settings.builderButtons\` (the one-click rewrite chips).

Read all three with \`get_logic\`. Change any of them with \`set_logic\` /
\`upsert_framework\` / \`upsert_builder_button\`. See exactly what a change produces,
without spending a token, with \`preview_prompt\`.

## The tuning loop

    get_logic            → see what the builder currently believes
    set_logic dryRun     → draft a change, check the before/after
    set_logic            → save it (atomic; the web app picks it up immediately)
    preview_prompt       → read the assembled prompt, free
    build_icp / generate_scripts → run it for real

## What makes output good

The single biggest lever is not the prompt — it is the material. A client with
call transcripts (\`extract_transcript\`), a scraped site (\`research\`), real pains
in its niche buckets and a saved ICP produces specific scripts. A client with an
empty case study produces generic ones no prompt can save. Check with
\`get_client\` before blaming the logic.

## Guardrails you cannot break from here

- The JSON output contract of every prompt slot is re-appended automatically.
- The board holds at most 8 scripts in Testing.
- Near-duplicate scripts (word-set Jaccard ≥ 0.82) are dropped from a run.
- AI calls are metered and stop at the daily cap (\`usage_report\`).
- Every write is an atomic compare-and-swap against the shared config, retried on
  conflict, so a teammate editing in the browser is never clobbered.
`;

export const RESOURCES: McpResource[] = [
  {
    uri: "outreach://guide",
    name: "guide",
    title: "How the ICP builder and script maker work",
    description: "Written orientation: the two products, the three layers of editable logic, the tuning loop, and the guardrails. Read this before changing any logic.",
    mimeType: "text/markdown",
    read: async () => GUIDE,
  },
  {
    uri: "outreach://logic/current",
    name: "current-logic",
    title: "Current ICP + script logic",
    description: "Live snapshot of the house lens, every engine slot (with whether it is customised), the global style rules and the frameworks.",
    mimeType: "application/json",
    read: async (ctx) => {
      const data = await getLogic.handler({ area: "all", full: true }, ctx);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    uri: "outreach://logic/defaults",
    name: "shipped-defaults",
    title: "Shipped default prompt for every slot",
    description: "The original, un-overridden text of every engine slot — diff your override against this, or paste one back to restore it by hand.",
    mimeType: "application/json",
    read: async () =>
      JSON.stringify(
        SLOTS.map((s) => ({
          slot: s.key, label: s.label, area: s.area, kind: s.kind,
          usedBy: s.usedBy, what: s.what,
          default: s.default,
          immutableContract: s.contract ?? null,
        })),
        null,
        2,
      ),
  },
  {
    uri: "outreach://clients",
    name: "clients",
    title: "Client index",
    description: "Every client with its id, niches, stage and how much material it holds.",
    mimeType: "application/json",
    read: async () => {
      const cfg = await readConfig();

      const nicheName = (id: string) => (cfg.niches || []).find((n: any) => n.id === id)?.name ?? id;
      return JSON.stringify(

        (cfg.clients || []).map((c: any) => ({
          id: c.id, name: c.name, meta: c.meta ?? "", stage: c.stage ?? "", csm: c.csm ?? "",
          niches: (c.nicheIds || []).map(nicheName),
          icps: (c.icps || []).length,
          scripts: (c.scriptReservoir || []).length,
          transcripts: (c.transcripts || []).length,
        })),
        null,
        2,
      );
    },
  },
];

const BY_URI = new Map(RESOURCES.map((r) => [r.uri, r]));
export function getResource(uri: string): McpResource | undefined {
  return BY_URI.get(uri);
}

// ─── Prompts (guided workflows) ──────────────────────────────────────────────

export interface McpPrompt {
  name: string;
  title: string;
  description: string;
  arguments: Array<{ name: string; description: string; required?: boolean }>;
  build: (args: Record<string, string>) => string;
}

export const PROMPTS: McpPrompt[] = [
  {
    name: "tune-icp-logic",
    title: "Tune the ICP builder",
    description: "Guided loop for changing how the ICP builder thinks, with a free preview before spending anything.",
    arguments: [
      { name: "goal", description: "What you want to change, e.g. 'stop proposing markets over 200K' or 'weight recent funding rounds'.", required: true },
      { name: "client", description: "A client to test against.", required: false },
    ],
    build: (a) =>
      `I want to change how the ICP builder behaves.\n\nGOAL: ${a.goal}\n${a.client ? `TEST CLIENT: ${a.client}\n` : ""}
Please work in this order:
1. Read outreach://guide, then call get_logic with area="icp", full=true, so you know the current icpBuilder prompt, the icpAngles engine and the house-lens icpScripter field verbatim.
2. Tell me which layer should change and why — the house lens (agency-wide taste), the icpBuilder slot (the builder's actual rules), or icpAngles (how pains and angles are found). Do not change more than one unless you explain why.
3. Draft the exact new text. Call set_logic with dryRun=true and show me the before/after.
4. Once I approve, save it, then call preview_prompt${a.client ? ` with action="build_icp" and clientId="${a.client}"` : ""} so I can read the assembled prompt before we spend a token.
5. Only then offer to run build_icp for real.`,
  },
  {
    name: "tune-script-logic",
    title: "Tune the script maker",
    description: "Guided loop for changing how outreach scripts are written — persona, first-liner rules, style rules or framework templates.",
    arguments: [
      { name: "goal", description: "What you want different about the scripts, e.g. 'openers are too clever, make them plainer'.", required: true },
      { name: "client", description: "A client to test against.", required: false },
    ],
    build: (a) =>
      `I want to change how our outreach scripts are written.\n\nGOAL: ${a.goal}\n${a.client ? `TEST CLIENT: ${a.client}\n` : ""}
Work in this order:
1. Read outreach://guide, then get_logic with area="script", full=true.
2. Diagnose which layer is actually responsible:
   - opening lines → the scriptFirstLiner engine
   - voice/persona → the scriptWriter slot
   - blanket style bans → settings.globalRules
   - structure/length/shape → the framework template + rules (list_frameworks)
   - agency-wide taste → systemFilter.messaging
   Say which one and why before touching anything.
3. Draft the change, run set_logic (or upsert_framework) with dryRun=true, show me the diff.
4. After I approve, save, then preview_prompt${a.client ? ` with action="generate" and clientId="${a.client}"` : ""}.
5. Then offer to run generate_scripts with save=false so we can judge the output before it lands on the board.`,
  },
  {
    name: "onboard-client",
    title: "Onboard a new client end to end",
    description: "Research the site, build the dossier, propose ICPs, and produce a first batch of scripts.",
    arguments: [
      { name: "name", description: "Client name.", required: true },
      { name: "website", description: "Their website.", required: true },
      { name: "niche", description: "The niche they sell into.", required: false },
    ],
    build: (a) =>
      `Onboard a new client end to end.\n\nCLIENT: ${a.name}\nWEBSITE: ${a.website}\n${a.niche ? `NICHE: ${a.niche}\n` : ""}
Steps:
1. research kind="client_site" on the website. Show me what came back before saving anything.
2. Create the client with upsert_client — fill the case study (size, mechanism, result, proofLine), pains, desires, objections and offers from the research. Ask me for anything the site did not answer rather than inventing it.
3. ${a.niche ? `Attach the niche "${a.niche}" (create it with upsert_niche if it does not exist yet).` : "Ask me which niche to attach, then attach it."}
4. research kind="competitors" and save it.
5. Run build_icp with save=false. Walk me through the profiles and flag any whose market size is outside the 10K-100K outbound-viable band.
6. Save the ICPs I pick with upsert_icp.
7. Run generate_scripts with save=false against the best ICP and 2-3 frameworks. Show me the scripts before anything reaches the board.`,
  },
  {
    name: "diagnose-weak-output",
    title: "Diagnose weak ICPs or scripts",
    description: "Work out whether bad output is a logic problem or a missing-material problem before anyone rewrites a prompt.",
    arguments: [
      { name: "client", description: "The client whose output disappointed you.", required: true },
      { name: "symptom", description: "What is wrong, e.g. 'the scripts all sound the same' or 'the ICPs are far too broad'.", required: true },
    ],
    build: (a) =>
      `Something is off with our output and I want it diagnosed properly before we touch any prompt.\n\nCLIENT: ${a.client}\nSYMPTOM: ${a.symptom}\n
Do this:
1. get_client for "${a.client}". Judge the MATERIAL first: is the case study filled in? Are there real pains in the niche buckets, or only generic ones? Any call transcripts? A saved ICP? An active mechanism? Say plainly which inputs are thin.
2. list_scripts and read a few — is the weakness present in the saved winners too, or only in new output?
3. preview_prompt for the affected action so we can see what the model is actually being told, including the composed lens.
4. Only after all that, tell me whether this is a material problem (fix with extract_transcript / research / upsert_client) or a logic problem (fix with set_logic), and propose the single smallest change.
Do not rewrite a prompt slot before completing steps 1-3.`,
  },
];

const PROMPT_BY_NAME = new Map(PROMPTS.map((p) => [p.name, p]));
export function getPrompt(name: string): McpPrompt | undefined {
  return PROMPT_BY_NAME.get(name);
}
