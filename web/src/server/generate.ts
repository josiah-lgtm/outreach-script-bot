// Matrix generation: one Claude call per framework, one script per angle × variantsPerAngle.
// The SHARED prefix (client/niche/ICP/research/emphasis) is byte-stable across frameworks and
// sent as a cached prefix; the per-framework tail is the volatile block. Port of legacy
// index.ts:702-869 + the generate handler at 1702-1735.

import { CLAUDE_MODEL } from "./anthropic";
import { claudeMessages } from "./claude";
import { textOf, parseJson, json, MAX_FRAMEWORKS, MAX_ANGLES, MAX_VARIANTS_PER_ANGLE, MAX_TOTAL_SCRIPTS, MAX_PROMPT_CHARS } from "./shared";

export interface Framework {
  id: string;
  name: string;
  category: string;
  template: string;
  rules?: string;
}

export interface GenerateBody {
  action: "generate";
  prospect: { fname?: string; company?: string; url?: string; classification?: string; customPain?: string };
  client: {
    name: string;
    caseStudy: Record<string, unknown>;
    emphasis?: { pains?: string[]; desires?: string[]; caseStudies?: string[]; offers?: string[] };
    frameworkOverride?: string;
    competitorIntel?: string;
    avoid?: string[];
  };
  niche: { name: string; triggerWords?: string[] };
  frameworks: Framework[];
  angles: string[];
  variantsPerAngle: number;
  globalRules?: string;
  guarantee?: string;
  icp?: { title?: string; niche?: string; jobTitles?: string[]; locations?: string[]; employeeSize?: string; revenue?: string; outboundNotes?: string };
  research?: { summary?: string; pains?: string[]; hooks?: string[] };
}

function buildSystemPrompt(body: GenerateBody, fw: Framework): { shared: string; framework: string } {
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
  const avoidBlock = (body.client.avoid ?? []).filter((a) => String(a).trim()).length
    ? `\nHARD EXCLUSIONS — the client forbids these. NEVER mention, imply, or allude to any of them in any script:\n` +
      (body.client.avoid ?? []).filter((a) => String(a).trim()).map((a) => `- ${a}`).join("\n") + "\n"
    : "";

  const guaranteeBlock = body.guarantee?.trim()
    ? `\nGUARANTEE / RISK REVERSAL (incorporate naturally where it fits — don't force into every variant):\n${body.guarantee.trim()}\n`
    : "";

  const icp = body.icp;
  const icpBlock = icp?.title
    ? `\nTARGET ICP — every script is written TO this exact persona. Match their seniority, vocabulary and pain framing; a CFO reads differently than a founder:\n` +
      `ICP: ${icp.title}${icp.niche ? ` (${icp.niche})` : ""}\n` +
      `Recipient job titles: ${(icp.jobTitles ?? []).join(", ") || "unknown"}\n` +
      `Company size: ${icp.employeeSize || "unknown"}${icp.revenue ? ` · ${icp.revenue}` : ""}\n` +
      `Locations: ${(icp.locations ?? []).join(", ") || "unknown"}\n` +
      (icp.outboundNotes ? `Outbound notes (lead with this): ${icp.outboundNotes}\n` : "")
    : "";

  const em = body.client.emphasis ?? {};
  const emList = (arr?: string[]) => (arr ?? []).filter((x) => String(x).trim()).map((x) => `- ${x}`).join("\n");
  const emphasisParts: string[] = [];
  if (em.pains?.length) emphasisParts.push(`Pains to lead with (these matter most to this client — prioritize them):\n${emList(em.pains)}`);
  if (em.desires?.length) emphasisParts.push(`Desired outcomes to point at:\n${emList(em.desires)}`);
  if (em.caseStudies?.length) emphasisParts.push(`Use ONLY these case studies as proof (don't invent others):\n${emList(em.caseStudies)}`);
  if (em.offers?.length) emphasisParts.push(`Offers to pitch:\n${emList(em.offers)}`);
  const emphasisBlock = emphasisParts.length
    ? `\nEMPHASIS — the user hand-picked these as the focus. Build the scripts around them:\n${emphasisParts.join("\n")}\n`
    : "";

  const shared = `You are a world-class cold email copywriter. You write short, punchy, conversational scripts that get replies, never marketing copy.

GLOBAL STYLE RULES:
${body.globalRules || "(none)"}

CLIENT CASE STUDY (the sender's proof — use it accurately, never invent numbers):
${csLines}

NICHE: ${body.niche.name}
NICHE TRIGGER WORDS (work 1-3 in naturally where they genuinely fit; never force them): ${tw || "(none)"}
${icpBlock}${researchBlock}${overrideBlock}${competitorBlock}${avoidBlock}${guaranteeBlock}${emphasisBlock}
OUTPUT FORMAT — return valid JSON only, no markdown, no preamble:
{
  "framework_fill": { "<variable_name>": "<value used in the first script>", ... },
  "variants": [ { "angle": "<the angle>", "label": "<3-6 word label>", "script": "<complete send-ready script>" } ]
}`;

  const framework = `FRAMEWORK FOR THIS BATCH: ${fw.name} (category: ${fw.category})
TEMPLATE — every {{variable}} must be filled; the final script follows this structure exactly:
${fw.template}

FRAMEWORK RULES:
${fw.rules || "(none)"}

Write every variant using THIS framework, following the OUTPUT FORMAT defined above.`;

  return { shared, framework };
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
  const { shared, framework } = buildSystemPrompt(body, fw);
  const user = buildUserPrompt(body);
  if (shared.length + framework.length + user.length > MAX_PROMPT_CHARS) {
    return { frameworkId: fw.id, framework: fw.name, category: fw.category, error: "prompt too long" };
  }
  try {
    const res = await claudeMessages({
      model: CLAUDE_MODEL,
      max_tokens: Math.min(800 + 260 * count, 7000),
      system: [{ type: "text", text: shared }, { type: "text", text: framework }],
      messages: [{ role: "user", content: user }],
    });
    const raw = textOf(res.content);
    const parsed = parseJson<{ framework_fill?: Record<string, string>; variants?: VariantOut[] }>(
      raw,
      { variants: [{ angle: body.angles[0] ?? "", label: "Unparsed output", script: raw }] },
    );
    const usedFallback = parsed.variants?.length === 1 && parsed.variants[0]?.label === "Unparsed output";
    if (res.stop_reason === "max_tokens" && usedFallback) {
      return { frameworkId: fw.id, framework: fw.name, category: fw.category, error: "response was truncated (hit the output limit) — try fewer angles/variants or a shorter framework", usage: res.usage };
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

export async function handleGenerate(body: Record<string, unknown>): Promise<Response> {
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
  // Warm the shared cached prefix with the first framework, then fan out the rest.
  let results: Awaited<ReturnType<typeof generateForFramework>>[];
  if (g.frameworks.length > 1) {
    const first = await generateForFramework(g, g.frameworks[0]);
    const rest = await Promise.all(g.frameworks.slice(1).map((fw) => generateForFramework(g, fw)));
    results = [first, ...rest];
  } else {
    results = [await generateForFramework(g, g.frameworks[0])];
  }
  const usage = results.reduce(
    (acc, r) => "usage" in r && r.usage
      ? { input_tokens: acc.input_tokens + r.usage.input_tokens, output_tokens: acc.output_tokens + r.usage.output_tokens }
      : acc,
    { input_tokens: 0, output_tokens: 0 },
  );
  return json({ ok: true, results, usage });
}

// Weight for the daily cap: generate fans out one Claude call per framework.
export function generateWeight(body: Record<string, unknown>): number {
  return Array.isArray(body.frameworks)
    ? Math.max(1, Math.min((body.frameworks as unknown[]).length, MAX_FRAMEWORKS))
    : 1;
}
