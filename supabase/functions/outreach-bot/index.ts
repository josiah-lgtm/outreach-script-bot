// Outreach Script Bot — Supabase Edge Function (v2)
//
// GET  → serves the UI (bundled into html.ts by deploy.sh).
// POST → JSON actions, all guarded by x-admin-key (ADMIN_KEY secret):
//   { action: "generate", ... }     → matrix generation: one Claude call per
//                                     framework, each producing one script per
//                                     angle × variantsPerAngle. Calls run in
//                                     parallel.
//   { action: "research", url }     → fetches the prospect's website server-side
//                                     and has Claude (haiku) extract insights,
//                                     pains and personalization hooks.
//   { action: "get_config" }        → load saved config (frameworks/niches/
//                                     clients/settings) from Supabase Storage.
//   { action: "save_config", config } → persist config to Supabase Storage.
//
// No API keys ever reach the browser: ANTHROPIC_API_KEY and the service-role
// key only exist as Edge Function secrets/env.

import { CLAUDE_HAIKU, CLAUDE_MODEL, messages as claudeMessages } from "../_shared/anthropic.ts";
import { HTML } from "./html.ts";

// ─── Limits ───────────────────────────────────────────────────────────────────
const MAX_FRAMEWORKS = 6;
const MAX_ANGLES = 8;
const MAX_VARIANTS_PER_ANGLE = 3;
const MAX_TOTAL_SCRIPTS = 48;
const MAX_PROMPT_CHARS = 40_000;

// ─── Config storage (Supabase Storage, service-role only) ─────────────────────
const BUCKET = "outreach-bot";
const OBJECT = "config.json";

function storageEnv() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("storage env not available");
  return { url, key };
}

async function configLoad(): Promise<unknown | null> {
  const { url, key } = storageEnv();
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${OBJECT}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return null;
  return await res.json();
}

async function configSave(config: unknown): Promise<void> {
  const { url, key } = storageEnv();
  // Ensure the bucket exists (409 = already there, fine).
  await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  }).catch(() => {});
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${OBJECT}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "x-upsert": "true",
    },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`config save failed: ${res.status} ${await res.text()}`);
}

// ─── Web research ──────────────────────────────────────────────────────────────
async function researchProspect(rawUrl: string, classification: string) {
  let target = rawUrl.trim();
  if (!/^https?:\/\//i.test(target)) target = "https://" + target;

  let pageText = "";
  try {
    const res = await fetch(target, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OutreachBot/2.0)" },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    const html = await res.text();
    pageText = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 9000);
  } catch (err) {
    return { ok: false as const, error: `Could not fetch ${target}: ${String((err as Error).message ?? err)}` };
  }
  if (pageText.length < 100) {
    return { ok: false as const, error: `Fetched ${target} but found almost no readable text (JS-rendered site?)` };
  }

  const res = await claudeMessages({
    model: CLAUDE_HAIKU,
    max_tokens: 900,
    system:
      `You are a cold outreach researcher. You are given the text of a prospect company's website. ` +
      `Extract what matters for personalizing a cold email. Return valid JSON only, no markdown fences:\n` +
      `{"summary":"2-3 sentences: what they do, who they sell to, anything notable",` +
      `"pains":["3-4 likely business pains, specific to them"],` +
      `"hooks":["3-4 personalization hooks — concrete details from the site a cold email could reference"]}`,
    messages: [{
      role: "user",
      content: `Prospect type: ${classification || "unknown"}\nWebsite text:\n${pageText}`,
    }],
  });
  const raw = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    return { ok: true as const, url: target, ...parsed };
  } catch {
    return { ok: true as const, url: target, summary: raw.slice(0, 600), pains: [], hooks: [] };
  }
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
${researchBlock}${overrideBlock}
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
    const raw = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    let parsed: { framework_fill?: Record<string, string>; variants?: VariantOut[] };
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    } catch {
      parsed = { variants: [{ angle: body.angles[0] ?? "", label: "Unparsed output", script: raw }] };
    }
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
