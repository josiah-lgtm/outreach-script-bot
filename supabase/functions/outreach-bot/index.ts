// Outreach Script Bot — Supabase Edge Function (v3)
//
// GET  → serves the UI (bundled into html.ts by deploy.sh).
// POST → JSON actions, all guarded by x-admin-key (ADMIN_KEY secret):
//   generate              → matrix generation: one Claude call per framework,
//                           one script per angle × variantsPerAngle, parallel.
//   research              → prospect website → insights/pains/hooks (haiku).
//   research_client_site  → onboard an agency client: scrape their site (+ web
//                           search for case studies/reviews) → mechanism,
//                           results, proof line, offers, case studies.
//   research_niche        → real web search (Reddit/forums/Google) on a niche →
//                           pains, angles, trigger words, desires, objections.
//   research_competitors  → web search for the client's competitors → their
//                           offers, mechanisms, results, guarantees.
//   get_config / save_config → config persistence in Supabase Storage.
//
// Web research uses Anthropic's server-side web_search tool — searches run on
// Anthropic's side; no search API keys needed. No API keys ever reach the
// browser.

import { CLAUDE_HAIKU, CLAUDE_MODEL, messages as claudeMessages, type Tool } from "../_shared/anthropic.ts";
import { HTML } from "./html.ts";

// ─── Limits ───────────────────────────────────────────────────────────────────
const MAX_FRAMEWORKS = 6;
const MAX_ANGLES = 8;
const MAX_VARIANTS_PER_ANGLE = 3;
const MAX_TOTAL_SCRIPTS = 48;
const MAX_PROMPT_CHARS = 40_000;

// Anthropic server-side web search tool (executed by the API, not by us).
const webSearchTool = (maxUses: number): Tool =>
  ({ type: "web_search_20250305", name: "web_search", max_uses: maxUses }) as unknown as Tool;

function textOf(content: Array<{ type: string }>): string {
  return content.filter((b) => b.type === "text").map((b) => (b as unknown as { text: string }).text).join("");
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    // Tolerate fences and prose around the JSON object.
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) return fallback;
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return fallback;
  }
}

// ─── Config storage (Supabase Storage, service-role only) ─────────────────────
const BUCKET = "outreach-bot";
const OBJECT = "config.json";

function storageEnv() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("storage env not available");
  // `apikey` works for both legacy JWT service keys and new sb_secret_ keys;
  // the bare Bearer header alone fails JWT parsing on new-style keys.
  return { url, headers: { Authorization: `Bearer ${key}`, apikey: key } };
}

async function configLoad(): Promise<unknown | null> {
  const { url, headers } = storageEnv();
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${OBJECT}`, { headers });
  if (!res.ok) return null;
  return await res.json();
}

async function configSave(config: unknown): Promise<void> {
  const { url, headers } = storageEnv();
  await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  }).catch(() => {});
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${OBJECT}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", "x-upsert": "true" },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`config save failed: ${res.status} ${await res.text()}`);
}

// ─── Site fetching ─────────────────────────────────────────────────────────────
async function fetchSiteText(rawUrl: string): Promise<{ ok: true; target: string; text: string } | { ok: false; error: string }> {
  let target = rawUrl.trim();
  if (!/^https?:\/\//i.test(target)) target = "https://" + target;
  try {
    const res = await fetch(target, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OutreachBot/3.0)" },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 11_000);
    if (text.length < 100) return { ok: false, error: `Fetched ${target} but found almost no readable text (JS-rendered site?)` };
    return { ok: true, target, text };
  } catch (err) {
    return { ok: false, error: `Could not fetch ${target}: ${String((err as Error).message ?? err)}` };
  }
}

// ─── Research actions ──────────────────────────────────────────────────────────
// Prospect research (used at generate time) — cheap, no web search.
async function researchProspect(rawUrl: string, classification: string) {
  const page = await fetchSiteText(rawUrl);
  if (!page.ok) return page;
  const res = await claudeMessages({
    model: CLAUDE_HAIKU,
    max_tokens: 900,
    system:
      `You are a cold outreach researcher. You are given the text of a prospect company's website. ` +
      `Extract what matters for personalizing a cold email. Return valid JSON only, no markdown fences:\n` +
      `{"summary":"2-3 sentences: what they do, who they sell to, anything notable",` +
      `"pains":["3-4 likely business pains, specific to them"],` +
      `"hooks":["3-4 personalization hooks — concrete details from the site a cold email could reference"]}`,
    messages: [{ role: "user", content: `Prospect type: ${classification || "unknown"}\nWebsite text:\n${page.text}` }],
  });
  const parsed = parseJson(textOf(res.content), { summary: textOf(res.content).slice(0, 600), pains: [], hooks: [] });
  return { ok: true as const, url: page.target, ...parsed };
}

// Client onboarding: scrape the agency client's own site into case-study data.
async function researchClientSite(rawUrl: string) {
  const page = await fetchSiteText(rawUrl);
  if (!page.ok) return page;
  const res = await claudeMessages({
    model: CLAUDE_MODEL,
    max_tokens: 2400,
    system:
      `You onboard clients for a lead generation agency. The client's website text is provided. ` +
      `Use up to 3 web searches to find their case studies, testimonials, reviews, or named results if the homepage lacks numbers. ` +
      `Extract the raw material for cold outreach offers. Be accurate — never invent numbers; if a field is unknown leave it as an empty string/array.\n` +
      `Return valid JSON only, no markdown fences:\n` +
      `{"name":"company name","meta":"one-line descriptor (location · size · type)",` +
      `"niche_guess":"the niche(s) THEY target, best guess",` +
      `"size":"company size / revenue if stated","result":"their single most impressive client result (with numbers if found)",` +
      `"mechanism":"how they get results, in plain words (their process/system)",` +
      `"proofLine":"one sendable sentence of proof: 'We just helped X do Y...' style, built only from real findings",` +
      `"offers":["their offers/packages/guarantees as stated"],` +
      `"caseStudies":["each concrete case study/result found, one line each"],` +
      `"pains":["pains their customers have (from their own copy)"],` +
      `"desires":["outcomes their customers want"],` +
      `"objections":["objections their copy preempts"],` +
      `"summary":"2-3 sentence overview of the client"}`,
    messages: [{ role: "user", content: `Client website: ${page.target}\n\nHomepage text:\n${page.text}` }],
    tools: [webSearchTool(3)],
  });
  const parsed = parseJson(textOf(res.content), null as Record<string, unknown> | null);
  if (!parsed) return { ok: false as const, error: "Could not parse research output — try again" };
  return { ok: true as const, url: page.target, ...parsed };
}

// Niche research: real web search incl. Reddit/forums for pains → angles.
async function researchNiche(nicheName: string, clientContext: string) {
  const res = await claudeMessages({
    model: CLAUDE_MODEL,
    max_tokens: 2400,
    system:
      `You are a lead generation researcher building cold outreach assets for a niche. ` +
      `Use web search (up to 5 searches) to find this niche's real pain points — search Reddit, industry forums, communities, and Google. ` +
      `Prioritize how people in the niche actually talk about their problems (their words beat marketing words).\n` +
      `Return valid JSON only, no markdown fences:\n` +
      `{"insights":"3-4 sentences: state of the niche, what they complain about, where the money pressure is",` +
      `"pains":["6-8 specific pains, phrased the way the niche says them"],` +
      `"angles":["6-8 short cold-email angles (testable hooks) derived from those pains"],` +
      `"triggerWords":["8-12 niche-native terms/acronyms that signal insider knowledge"],` +
      `"desires":["4-6 outcomes this niche wants most"],` +
      `"objections":["4-6 objections they raise to outreach offers"]}`,
    messages: [{
      role: "user",
      content: `Niche: ${nicheName}\n${clientContext ? `Our client (who sells into this niche): ${clientContext}` : ""}`,
    }],
    tools: [webSearchTool(5)],
  });
  const parsed = parseJson(textOf(res.content), null as Record<string, unknown> | null);
  if (!parsed) return { ok: false as const, error: "Could not parse niche research — try again" };
  return { ok: true as const, niche: nicheName, ...parsed };
}

// Competitor research: find the client's competitors and pull their offers.
async function researchCompetitors(clientName: string, clientUrl: string, nicheName: string) {
  const res = await claudeMessages({
    model: CLAUDE_MODEL,
    max_tokens: 2600,
    system:
      `You are a lead generation strategist doing competitor intel. ` +
      `Use web search (up to 6 searches) to find 3-5 direct competitors of the client below — companies selling a similar service to the same niche. ` +
      `For each, pull what is publicly visible: their offer/packages, their mechanism (how they claim to get results), named results/case studies, and any guarantee. ` +
      `Never invent data; leave unknown fields as empty strings.\n` +
      `Return valid JSON only, no markdown fences:\n` +
      `{"insights":"2-3 sentences: how the competitive field positions itself, and the gap our client can exploit",` +
      `"competitors":[{"name":"","website":"","offer":"their core offer/packages","mechanism":"how they get results","results":"named results/case studies found","guarantee":"guarantee if any"}]}`,
    messages: [{
      role: "user",
      content: `Client: ${clientName}${clientUrl ? ` (${clientUrl})` : ""}\nNiche they sell into: ${nicheName || "unknown"}`,
    }],
    tools: [webSearchTool(6)],
  });
  const parsed = parseJson(textOf(res.content), null as Record<string, unknown> | null);
  if (!parsed) return { ok: false as const, error: "Could not parse competitor research — try again" };
  return { ok: true as const, ...parsed };
}

// ─── Generation ────────────────────────────────────────────────────────────────
interface Framework {
  id: string;
  name: string;
  category: string;
  template: string;
  rules?: string;
}

interface GenerateBody {
  action: "generate";
  prospect: { fname?: string; company?: string; url?: string; classification?: string; customPain?: string };
  client: {
    name: string;
    caseStudy: Record<string, unknown>;
    frameworkOverride?: string;
    competitorIntel?: string;
  };
  niche: { name: string; triggerWords?: string[] };
  frameworks: Framework[];
  angles: string[];
  variantsPerAngle: number;
  globalRules?: string;
  research?: { summary?: string; pains?: string[]; hooks?: string[] };
}

function buildSystemPrompt(body: GenerateBody, fw: Framework): string {
  const cs = body.client.caseStudy ?? {};
  const csLines = Object.entries(cs)
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? (v as unknown[]).join(", ") : v}`)
    .join("\n");
  const tw = (body.niche.triggerWords ?? []).join(", ");
  const r = body.research;
  const researchBlock = r && (r.summary || r.pains?.length || r.hooks?.length)
    ? `\nPROSPECT RESEARCH (from their website — personalize with this, reference real details):\n` +
      `${r.summary ?? ""}\nLikely pains: ${(r.pains ?? []).join("; ")}\nHooks: ${(r.hooks ?? []).join("; ")}\n`
    : "";
  const overrideBlock = body.client.frameworkOverride?.trim()
    ? `\nCLIENT-SPECIFIC FRAMEWORK NOTES (these override the defaults where they conflict):\n${body.client.frameworkOverride.trim()}\n`
    : "";
  const competitorBlock = body.client.competitorIntel?.trim()
    ? `\nCOMPETITOR INTEL (what rivals in this niche promise — position our client distinctly, never copy their claims):\n${body.client.competitorIntel.trim().slice(0, 2000)}\n`
    : "";

  return `You are a world-class cold email copywriter. You write short, punchy, conversational scripts that get replies, never marketing copy.

FRAMEWORK: ${fw.name} (category: ${fw.category})
TEMPLATE — every {{variable}} must be filled; the final script follows this structure exactly:
${fw.template}

FRAMEWORK RULES:
${fw.rules || "(none)"}

GLOBAL STYLE RULES:
${body.globalRules || "(none)"}

CLIENT CASE STUDY (the sender's proof — use it accurately, never invent numbers):
${csLines}

NICHE: ${body.niche.name}
NICHE TRIGGER WORDS (work 1-3 in naturally where they genuinely fit; never force them): ${tw || "(none)"}
${researchBlock}${overrideBlock}${competitorBlock}
OUTPUT FORMAT — return valid JSON only, no markdown, no preamble:
{
  "framework_fill": { "<variable_name>": "<value used in the first script>", ... },
  "variants": [ { "angle": "<the angle>", "label": "<3-6 word label>", "script": "<complete send-ready script>" } ]
}`;
}

function buildUserPrompt(body: GenerateBody): string {
  const p = body.prospect;
  const lines = [
    `Prospect first name: ${p.fname || "{{first_name}}"}`,
    `Prospect company: ${p.company || "{{company}}"}`,
    `Classification: ${p.classification || "unknown"}`,
    p.customPain ? `Custom pain point to consider: ${p.customPain}` : "",
    "",
    `Write exactly ${body.variantsPerAngle} variant(s) for EACH of these angles, in order (${body.angles.length * body.variantsPerAngle} scripts total). Each variant of the same angle must take a noticeably different approach to the opening line:`,
    ...body.angles.map((a, i) => `${i + 1}. ${a}`),
    "",
    `Return JSON only.`,
  ];
  return lines.filter((l) => l !== "").join("\n");
}

interface VariantOut { angle: string; label: string; script: string }

async function generateForFramework(body: GenerateBody, fw: Framework) {
  const count = body.angles.length * body.variantsPerAngle;
  const system = buildSystemPrompt(body, fw);
  const user = buildUserPrompt(body);
  if (system.length + user.length > MAX_PROMPT_CHARS) {
    return { frameworkId: fw.id, framework: fw.name, category: fw.category, error: "prompt too long" };
  }
  try {
    const res = await claudeMessages({
      model: CLAUDE_MODEL,
      max_tokens: Math.min(800 + 260 * count, 7000),
      system,
      messages: [{ role: "user", content: user }],
    });
    const raw = textOf(res.content);
    const parsed = parseJson<{ framework_fill?: Record<string, string>; variants?: VariantOut[] }>(
      raw,
      { variants: [{ angle: body.angles[0] ?? "", label: "Unparsed output", script: raw }] },
    );
    return {
      frameworkId: fw.id,
      framework: fw.name,
      category: fw.category,
      fills: parsed.framework_fill ?? {},
      variants: (parsed.variants ?? []).slice(0, count + 2),
      usage: res.usage,
    };
  } catch (err) {
    return { frameworkId: fw.id, framework: fw.name, category: fw.category, error: String((err as Error).message ?? err) };
  }
}

// ─── HTTP ──────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "*";
  const cors = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-key",
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  if (req.method === "GET") {
    return new Response(HTML, {
      status: 200,
      headers: { ...cors, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const adminKey = Deno.env.get("ADMIN_KEY");
  if (!adminKey || req.headers.get("x-admin-key") !== adminKey) {
    return json({ ok: false, error: "unauthorized — missing or wrong x-admin-key" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid JSON body" }, 400);
  }

  try {
    switch (body.action) {
      case "get_config": {
        const config = await configLoad();
        return json({ ok: true, config });
      }

      case "save_config": {
        if (!body.config || typeof body.config !== "object") {
          return json({ ok: false, error: "config object required" }, 400);
        }
        if (JSON.stringify(body.config).length > 1_000_000) {
          return json({ ok: false, error: "config too large (1MB max)" }, 400);
        }
        await configSave(body.config);
        return json({ ok: true });
      }

      case "research": {
        const url = String(body.url ?? "").trim();
        if (!url) return json({ ok: false, error: "url required" }, 400);
        const result = await researchProspect(url, String(body.classification ?? ""));
        return json(result, result.ok ? 200 : 422);
      }

      case "research_client_site": {
        const url = String(body.url ?? "").trim();
        if (!url) return json({ ok: false, error: "url required" }, 400);
        const result = await researchClientSite(url);
        return json(result, result.ok ? 200 : 422);
      }

      case "research_niche": {
        const nicheName = String(body.niche ?? "").trim();
        if (!nicheName) return json({ ok: false, error: "niche required" }, 400);
        const result = await researchNiche(nicheName, String(body.clientContext ?? ""));
        return json(result, result.ok ? 200 : 422);
      }

      case "research_competitors": {
        const name = String(body.clientName ?? "").trim();
        const url = String(body.clientUrl ?? "").trim();
        if (!name && !url) return json({ ok: false, error: "clientName or clientUrl required" }, 400);
        const result = await researchCompetitors(name, url, String(body.niche ?? ""));
        return json(result, result.ok ? 200 : 422);
      }

      case "generate": {
        const g = body as unknown as GenerateBody;
        if (!Array.isArray(g.frameworks) || g.frameworks.length === 0) {
          return json({ ok: false, error: "at least one framework required" }, 400);
        }
        if (!Array.isArray(g.angles) || g.angles.length === 0) {
          return json({ ok: false, error: "at least one angle required" }, 400);
        }
        g.frameworks = g.frameworks.slice(0, MAX_FRAMEWORKS);
        g.angles = g.angles.slice(0, MAX_ANGLES);
        g.variantsPerAngle = Math.max(1, Math.min(Number(g.variantsPerAngle) || 1, MAX_VARIANTS_PER_ANGLE));
        const total = g.frameworks.length * g.angles.length * g.variantsPerAngle;
        if (total > MAX_TOTAL_SCRIPTS) {
          return json({ ok: false, error: `matrix too large: ${total} scripts (max ${MAX_TOTAL_SCRIPTS}) — deselect some frameworks/angles` }, 400);
        }
        const results = await Promise.all(g.frameworks.map((fw) => generateForFramework(g, fw)));
        const usage = results.reduce(
          (acc, r) => "usage" in r && r.usage
            ? { input_tokens: acc.input_tokens + r.usage.input_tokens, output_tokens: acc.output_tokens + r.usage.output_tokens }
            : acc,
          { input_tokens: 0, output_tokens: 0 },
        );
        return json({ ok: true, results, usage });
      }

      default:
        return json({ ok: false, error: "unknown action" }, 400);
    }
  } catch (err) {
    console.error("outreach-bot error:", err);
    return json({ ok: false, error: String((err as Error).message ?? err) }, 502);
  }
});
