// ─────────────────────────────────────────────────────────────────────────────
// OVERRIDABLE PROMPT SLOTS — "the logic" of the ICP builder and the script maker.
//
// Historically every system prompt was a hardcoded string inside outreach.ts /
// generate.ts / lib/sync/engines.ts. This module keeps those exact strings as the
// DEFAULTS and layers an optional per-install override on top, read from the one
// config document at `settings.engines`.
//
//   settings.engines = { icpBuilder?: string, scriptWriter?: string, … }
//
// An absent / empty / whitespace-only value means "use the baked-in default", so
// existing configs behave identically and a slot can always be reverted by
// clearing it. Overrides are edited through the MCP server (get_logic/set_logic)
// or by hand in the config.
//
// Two slot kinds:
//   • "full"     — the override REPLACES the whole system prompt for that action.
//                  Only used where the machine-readable output contract is stated
//                  inside the text itself; the contract line is re-appended by
//                  `contract` so a user override can never break JSON parsing.
//   • "preamble" — the override replaces only the persona/instruction preamble;
//                  the structural remainder (templates, JSON output format, item
//                  counts) is always assembled by code and cannot be overridden.
//
// The three "lens" slots (icpAngles / scriptFirstLiner / mechanismBuilder) are the
// methodology blocks injected as a cached system prefix; they are consumed by both
// the browser (lib/sync/systemFilter.ts) and the server (server/lens.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { getConfig } from "./db";
import {
  FIRST_LINER_ENGINE_ANGLES,
  FIRST_LINER_ENGINE_SCRIPT,
  MECHANISM_BUILDER,
} from "@/lib/sync/engines";

export type SlotKind = "full" | "preamble" | "lens";

export interface SlotDef {
  /** Stable key under settings.engines. */
  key: string;
  /** Short human label. */
  label: string;
  /** Which surface this steers. */
  area: "icp" | "script" | "research" | "shared";
  kind: SlotKind;
  /** Which backend action(s) consume it. */
  usedBy: string[];
  /** One-line explanation of what changing this does. */
  what: string;
  /** The baked-in default text. */
  default: string;
  /**
   * Machine contract appended AFTER any override for "full" slots. Never
   * overridable — this is what keeps the JSON parseable.
   */
  contract?: string;
}

// ─── ICP BUILDER ─────────────────────────────────────────────────────────────

const ICP_BUILDER_DEFAULT =
  `You are a world-renowned outbound/cold-email strategist. Given everything known about a lead-gen agency's client ` +
  `(their offer, mechanism, proof, customer pains, call-transcript intel, competitors), define the 1-5 BEST ideal customer profiles to target with cold outreach.\n` +
  `Rules of great outbound ICPs:\n` +
  `- Specific job titles that actually hold the budget/pain (not generic "decision makers").\n` +
  `- A market that is ACCESSIBLE via outbound (findable on LinkedIn/Apollo/email databases). The sweet spot is roughly 10,000-100,000 reachable prospects — big enough to scale sequences, small enough to specialize messaging. Around 30-40K is ideal. Flag anything under ~5K (too thin) or over ~500K (unfocused).\n` +
  `- The client's existing proof must transfer: pick ICPs where their case studies and mechanism are believable.\n` +
  `- Use web search (up to 4 searches) to ESTIMATE market size: LinkedIn title counts, industry association stats, census/firmographic data ("number of X companies in Y"). State numbers with their basis; never present a guess as fact — if it is a reasoned estimate, say so.`;

const ICP_BUILDER_CONTRACT =
  `\nReturn valid JSON only, no markdown fences:\n` +
  `{"icps":[{` +
  `"title":"short memorable ICP label",` +
  `"niche":"the vertical/niche",` +
  `"jobTitles":["3-6 exact titles to target"],` +
  `"locations":["1-3 geos, most accessible first"],` +
  `"employeeSize":"company size band, e.g. 11-50",` +
  `"revenue":"revenue band if relevant, else empty string",` +
  `"marketSize":"estimated reachable prospects + one-line basis, e.g. '~35K — LinkedIn shows 32-38K matching titles in US'",` +
  `"why":"2-3 sentences: why this ICP fits THIS client — tie to their pains/mechanism/proof",` +
  `"outboundNotes":"reachability, buying triggers, what to lead with",` +
  `"score":8` +
  `}],"insights":"2-3 sentences: overall targeting strategy and which ICP to start with"}\n` +
  `Order icps best-first. score is outbound-fit 1-10.\n` +
  `IMPORTANT: do all web searching FIRST, then write NOTHING except the single JSON object as your final answer — no commentary before or after it.`;

const ICP_EXAMPLE_DEFAULT =
  `You find ONE real company that is a textbook example of an ideal customer profile, using web search (up to 3 searches). ` +
  `It must be a real, currently operating company with a working website that matches the ICP's niche, size and location. ` +
  `Never invent a company. If genuinely nothing fits, return an empty company string.\n` +
  `Style: no dashes or hyphens in the text, plain clear English.`;

const ICP_EXAMPLE_CONTRACT =
  `\nReturn valid JSON only, no fences: {"company":"name","website":"domain.com","why":"one sentence: why this company is a perfect example of the ICP"}`;

// ─── SCRIPT MAKER ────────────────────────────────────────────────────────────

const SCRIPT_WRITER_DEFAULT =
  `You are a world-class cold email copywriter. You write short, punchy, conversational scripts that get replies, never marketing copy.`;

const SCRIPT_REFINER_DEFAULT =
  `You are a cold email editor. The user gives you a script and a revision instruction. Make ONLY the requested changes — preserve what works. Return ONLY the revised script text, no commentary, no quotes, no markdown.`;

const SELECTION_REFINER_DEFAULT =
  `You are a cold email editor. The user highlighted ONE EXCERPT of a script and wants only that excerpt rewritten. ` +
  `Rewrite the excerpt per the instruction so it fits seamlessly back into the surrounding script (tone, tense, flow). ` +
  `Return ONLY the replacement text for the excerpt — no commentary, no quotes, no markdown, and do NOT return the rest of the script.`;

const ANGLE_SUGGESTER_DEFAULT =
  `You generate testable cold email angle hooks for a specific niche. Each angle is a 5-14 word specific hook — a problem, trigger event, or curiosity gap. Make them distinct, concrete, and sendable as email openers.`;

const ANGLE_SUGGESTER_CONTRACT =
  `\nReturn valid JSON only, no markdown: {"angles":["6 angles"]}`;

const FUSE_ANGLE_DEFAULT =
  `You fuse hand-picked ingredients (pains, desired outcomes, guarantees, offers) into ONE cold-email angle hook. ` +
  `5-14 words, specific, written the way the prospect would say it, sendable as an email opener's theme. ` +
  `Use the ingredients' substance — don't just concatenate them. The angle must make immediate sense to the prospect: ` +
  `frame the PAIN as their situation and the outcome/guarantee as the tension or promise.\n` +
  `Example — pain: "leads go cold before we follow up" + outcome: "predictable booked calls" → {"angle":"Leads going cold while the calendar stays empty"}\n` +
  `NEVER invent numbers or claims: only numbers that appear verbatim in the ingredients may be used.`;

const FUSE_ANGLE_CONTRACT = `\nReturn valid JSON only: {"angle":"the fused angle"}`;

const OFFER_SUGGESTER_DEFAULT =
  `You are a cold outreach strategist. Given a client's case study data, suggest 4-6 distinct offer packages they could sell — each with a name and one-line description. Make them concrete, risk-reversed, and outcome-focused.`;

const OFFER_SUGGESTER_CONTRACT =
  `\nReturn valid JSON only, no markdown: {"offers":[{"name":"short offer name","description":"one-line description of what's included and the outcome"}]}`;

const FRAMEWORK_EXTRACTOR_DEFAULT =
  `You reverse-engineer winning cold outreach scripts into reusable frameworks for a lead generation agency.\n` +
  `Given one or more scripts that got replies, extract the underlying repeatable structure:\n` +
  `- Keep the load-bearing structure and phrasing patterns that make it work.\n` +
  `- Replace the situation-specific parts (pain, proof, names, numbers, CTA target) with descriptive snake_case {{variables}}.\n` +
  `- Write rules that capture why it wins: length, tone, rhythm, what each part must do.`;

const FRAMEWORK_EXTRACTOR_CONTRACT =
  `\nReturn valid JSON only, no markdown fences:\n` +
  `{"name":"short memorable framework name","category":"what it is (Proof-led / Pain-led / Curiosity-led / Ultra-short / ...)",` +
  `"template":"the structure with {{variables}}","rules":"the rules that make it win",` +
  `"analysis":"2-3 sentences on why this script structure works"}`;

const TRANSCRIPT_EXTRACTOR_DEFAULT =
  `You extract cold outreach intelligence from sales call transcripts. Read the transcript and identify actionable material.`;

const TRANSCRIPT_EXTRACTOR_CONTRACT =
  `\nReturn valid JSON only, no markdown fences:\n` +
  `{"pains":["6-8 specific pain points, phrased in the prospect's exact words where possible"],` +
  `"desires":["4-6 outcomes they explicitly or implicitly want"],` +
  `"angles":["5-8 testable cold email angles derived from what you heard — use their exact language"],` +
  `"offers":["3-5 potential offer structures that would resonate based on what was said"],` +
  `"insights":"2-3 sentences on what this call reveals about the niche and what messaging will land"}`;

const CLIENT_BRIEF_DEFAULT =
  `You turn a lead gen agency's internal client notes into a clean client facing brief that opens a growth plan. ` +
  `The client reading it should feel "they did their research on us".\n` +
  `STYLE RULES (strict): simple, concise, clear. Plain English a busy founder skims in seconds. ` +
  `NEVER use dashes or hyphens of any kind in the text, not even in compound words you can rephrase. Use commas or the word "to" instead. ` +
  `No jargon, no fluff, no exaggeration. Only use facts present in the notes, never invent numbers or names.`;

const CLIENT_BRIEF_CONTRACT =
  `\nReturn valid JSON only, no fences:\n` +
  `{"services":["3 to 5 short lines, what the client offers, each under 12 words"],` +
  `"positioning":"2 to 3 sentences: who they serve, how they get results, why them",` +
  `"caseStudies":["each proven result as one clean line with its real numbers"],` +
  `"competitors":["each competitor as one line: Name, what they pitch, how our client differs"]}`;

const FOLLOWUP_WRITER_DEFAULT =
  `You write OUTBOUND FOLLOW-UP emails — short messages sent AFTER a first cold email that got no reply.`;

// ─── The registry ────────────────────────────────────────────────────────────

export const SLOTS: SlotDef[] = [
  {
    key: "icpBuilder",
    label: "ICP builder system prompt",
    area: "icp",
    kind: "full",
    usedBy: ["build_icp"],
    what: "The whole brain of the ICP builder: what makes a good outbound ICP, the market-size sweet spot, how hard it web-searches. Replace this to change what kind of ICPs come back.",
    default: ICP_BUILDER_DEFAULT,
    contract: ICP_BUILDER_CONTRACT,
  },
  {
    key: "icpAngles",
    label: "First-liner engine — pains & angles",
    area: "icp",
    kind: "lens",
    usedBy: ["build_icp", "suggest_angles", "suggest_offers", "fuse_angle"],
    what: "The methodology block injected above every ICP/angle/offer call: how to build a pain library, validate it against research, and pick PAIN vs CURIOSITY angles.",
    default: FIRST_LINER_ENGINE_ANGLES,
  },
  {
    key: "icpExample",
    label: "ICP example finder",
    area: "icp",
    kind: "full",
    usedBy: ["find_icp_example"],
    what: "How a real-world textbook example company is picked for an ICP.",
    default: ICP_EXAMPLE_DEFAULT,
    contract: ICP_EXAMPLE_CONTRACT,
  },
  {
    key: "scriptWriter",
    label: "Script writer persona",
    area: "script",
    kind: "preamble",
    usedBy: ["generate"],
    what: "The opening persona line of every script-generation call. The rest of the prompt (case study, niche, ICP, emphasis blocks and the JSON output format) is assembled by code and stays fixed.",
    default: SCRIPT_WRITER_DEFAULT,
  },
  {
    key: "scriptFirstLiner",
    label: "First-liner filter — opening lines",
    area: "script",
    kind: "lens",
    usedBy: ["generate"],
    what: "The methodology block injected above every generation: what the opening line must do, PAIN vs CURIOSITY openers, banned phrases, the proof rule.",
    default: FIRST_LINER_ENGINE_SCRIPT,
  },
  {
    key: "scriptRefiner",
    label: "Script refiner",
    area: "script",
    kind: "full",
    usedBy: ["refine_script"],
    what: "How a whole saved script is rewritten when you give it an instruction.",
    default: SCRIPT_REFINER_DEFAULT,
  },
  {
    key: "selectionRefiner",
    label: "Highlighted-excerpt refiner",
    area: "script",
    kind: "full",
    usedBy: ["refine_selection"],
    what: "How a highlighted excerpt inside a script is rewritten in place.",
    default: SELECTION_REFINER_DEFAULT,
  },
  {
    key: "angleSuggester",
    label: "Angle suggester",
    area: "script",
    kind: "full",
    usedBy: ["suggest_angles"],
    what: "How new testable angle hooks are written for a niche.",
    default: ANGLE_SUGGESTER_DEFAULT,
    contract: ANGLE_SUGGESTER_CONTRACT,
  },
  {
    key: "fuseAngle",
    label: "Angle fuser",
    area: "script",
    kind: "full",
    usedBy: ["fuse_angle"],
    what: "How hand-picked pains/desires/offers get fused into one angle hook.",
    default: FUSE_ANGLE_DEFAULT,
    contract: FUSE_ANGLE_CONTRACT,
  },
  {
    key: "offerSuggester",
    label: "Offer suggester",
    area: "script",
    kind: "full",
    usedBy: ["suggest_offers"],
    what: "How offer packages are proposed from a client's case-study data.",
    default: OFFER_SUGGESTER_DEFAULT,
    contract: OFFER_SUGGESTER_CONTRACT,
  },
  {
    key: "frameworkExtractor",
    label: "Framework extractor",
    area: "script",
    kind: "full",
    usedBy: ["extract_framework"],
    what: "How winning scripts are reverse-engineered into a reusable framework template.",
    default: FRAMEWORK_EXTRACTOR_DEFAULT,
    contract: FRAMEWORK_EXTRACTOR_CONTRACT,
  },
  {
    key: "followupWriter",
    label: "Follow-up writer persona",
    area: "script",
    kind: "preamble",
    usedBy: ["generate_followups"],
    what: "The persona line for follow-up emails. The per-framework rules, ICP line and JSON contract are appended by code.",
    default: FOLLOWUP_WRITER_DEFAULT,
  },
  {
    key: "mechanismBuilder",
    label: "Mechanism builder",
    area: "shared",
    kind: "lens",
    usedBy: ["(wizard mechanism step)"],
    what: "How a client's services are turned into named 'how it works' mechanisms (pain → obstacle → misdiagnosis → mechanism → outcome).",
    default: MECHANISM_BUILDER,
  },
  {
    key: "transcriptExtractor",
    label: "Transcript extractor",
    area: "research",
    kind: "full",
    usedBy: ["extract_transcript"],
    what: "What intelligence is pulled out of a sales-call transcript.",
    default: TRANSCRIPT_EXTRACTOR_DEFAULT,
    contract: TRANSCRIPT_EXTRACTOR_CONTRACT,
  },
  {
    key: "clientBrief",
    label: "Client brief composer",
    area: "research",
    kind: "full",
    usedBy: ["compose_client_brief"],
    what: "How internal client notes become the client-facing brief at the top of a growth plan.",
    default: CLIENT_BRIEF_DEFAULT,
    contract: CLIENT_BRIEF_CONTRACT,
  },
];

export const SLOT_KEYS = SLOTS.map((s) => s.key);
const SLOT_BY_KEY: Record<string, SlotDef> = Object.fromEntries(SLOTS.map((s) => [s.key, s]));

export function slotDef(key: string): SlotDef | undefined {
  return SLOT_BY_KEY[key];
}

export type ResolvedPrompts = Record<string, string>;

/** Overrides exactly as stored (only non-empty entries), for reporting. */
export type EngineOverrides = Record<string, string>;

function readOverrides(cfg: Record<string, unknown> | null): EngineOverrides {
  const settings = (cfg?.settings ?? {}) as Record<string, unknown>;
  const engines = (settings.engines ?? {}) as Record<string, unknown>;
  const out: EngineOverrides = {};
  for (const key of SLOT_KEYS) {
    const v = engines[key];
    if (typeof v === "string" && v.trim()) out[key] = v;
  }
  return out;
}

/**
 * Resolve a slot to its effective text: the override when set, else the default.
 * For "full" slots the immutable machine contract is always appended.
 */
export function resolveSlot(key: string, overrides: EngineOverrides): string {
  const def = SLOT_BY_KEY[key];
  if (!def) return "";
  const base = overrides[key] ?? def.default;
  if (def.kind === "full" && def.contract) return base + def.contract;
  return base;
}

// One DB read per 5s per process — every AI action resolves prompts, and the
// config document is a single row.
let cache: { at: number; overrides: EngineOverrides } | null = null;
const TTL_MS = 5_000;

export async function loadEngineOverrides(force = false): Promise<EngineOverrides> {
  const now = Date.now();
  if (!force && cache && now - cache.at < TTL_MS) return cache.overrides;
  let overrides: EngineOverrides = {};
  try {
    overrides = readOverrides(await getConfig());
  } catch {
    // A transient DB error must never take the AI actions down — fall back to defaults.
    overrides = cache?.overrides ?? {};
  }
  cache = { at: now, overrides };
  return overrides;
}

/** Call after writing settings.engines so the next action picks it up immediately. */
export function invalidateEngineCache(): void {
  cache = null;
}

/**
 * A slot split into its overridable body and its immutable machine contract, so a
 * handler can inject a runtime block (house rules, item counts) BETWEEN the two
 * instead of appending after the JSON contract where it reads as an afterthought.
 */
export async function slotParts(key: string): Promise<{ body: string; contract: string }> {
  const def = SLOT_BY_KEY[key];
  if (!def) return { body: "", contract: "" };
  const overrides = await loadEngineOverrides();
  return {
    body: overrides[key] ?? def.default,
    contract: def.kind === "full" ? (def.contract ?? "") : "",
  };
}

/**
 * The effective prompt text for every slot. `prompts()` is what the action
 * handlers call: `const P = await prompts(); … system: P.icpBuilder`.
 */
export async function prompts(): Promise<ResolvedPrompts> {
  const overrides = await loadEngineOverrides();
  const out: ResolvedPrompts = {};
  for (const key of SLOT_KEYS) out[key] = resolveSlot(key, overrides);
  return out;
}

/** Same as prompts() but also reports which slots are customised. */
export async function promptsWithMeta(): Promise<{ text: ResolvedPrompts; overrides: EngineOverrides }> {
  const overrides = await loadEngineOverrides();
  const text: ResolvedPrompts = {};
  for (const key of SLOT_KEYS) text[key] = resolveSlot(key, overrides);
  return { text, overrides };
}
