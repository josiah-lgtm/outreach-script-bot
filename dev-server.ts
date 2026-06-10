// Local dev server for the Outreach Script Bot (v2).
// Serves index.html and mocks the Edge Function (generate / research /
// get_config / save_config) so the full app works without deploying.
//
// Run:
//   ~/.deno/bin/deno run --allow-net --allow-read --allow-env dev-server.ts
//   # then open http://localhost:8788/
//
// Flags (env vars):
//   PORT=8788    — override the port
//   MOCK=0       — disable mocks (fetches go to the real Supabase URL)

const PORT = Number(Deno.env.get("PORT") ?? 8788);
const MOCK = Deno.env.get("MOCK") !== "0";
const HTML_PATH = new URL("./index.html", import.meta.url).pathname;

// In-memory config store standing in for Supabase Storage.
let savedConfig: unknown = null;

function mockScript(fw: string, angle: string, v: number): string {
  return `Hey {{first_name}}, quick one — is {{company}} feeling "${angle}" yet?\n\n` +
    `(mock ${fw} v${v}) We just helped a client fix exactly this. Went from stuck to growing in 90 days. No fluff, no lock-in.\n\n` +
    `Worth a short chat?`;
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const origin = req.headers.get("origin") ?? "*";
  const cors = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-key",
  };

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  // Mock Edge Function endpoint
  if (url.pathname === "/mock/outreach-bot" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));

    if (body.action === "get_config") {
      return json({ ok: true, config: savedConfig }, cors);
    }
    if (body.action === "save_config") {
      savedConfig = body.config;
      await new Promise((r) => setTimeout(r, 200));
      return json({ ok: true }, cors);
    }
    if (body.action === "research_client_site") {
      await new Promise((r) => setTimeout(r, 1200));
      return json({
        ok: true,
        url: "https://" + String(body.url).replace(/^https?:\/\//, ""),
        name: "Acme Growth Agency",
        meta: "US · 12-person lead gen agency",
        niche_guess: "B2B SaaS founders",
        size: "~$2M/yr agency",
        result: "Added $480K pipeline for a B2B SaaS client in 6 months",
        mechanism: "Cold email infrastructure + triple-touch follow-up + reply management",
        proofLine: "We just helped a B2B SaaS client add $480K in pipeline in 6 months with done-for-you cold email.",
        offers: ["DFY cold email — $3.5K/mo retainer", "Pay-per-show pilot — $250/booked call"],
        caseStudies: ["SaaSCo: $480K pipeline in 6 months", "Shopify agency: 22 booked calls in 45 days"],
        pains: ["feast-or-famine pipeline", "founder-led sales not scaling"],
        desires: ["predictable booked calls", "pipeline without hiring SDRs"],
        objections: ["tried agencies before", "worried about domain reputation"],
        summary: "(mock) Acme is a 12-person lead gen agency selling DFY cold email to B2B companies.",
      }, cors);
    }
    if (body.action === "research_niche") {
      await new Promise((r) => setTimeout(r, 1500));
      return json({
        ok: true,
        niche: body.niche,
        insights: "(mock) The niche is squeezed by rising CAC; owners complain on Reddit about churn-and-burn agencies and leads going cold.",
        pains: ["CAC doubled since 2024", "agencies overpromise and ghost", "in-house team maxed out", "lead quality worse every quarter", "no time to follow up leads", "tool stack costs ballooning"],
        angles: ["CAC doubled, results flat", "Agency-burned and skeptical", "Leads going cold in the CRM", "Stack costs eating margin", "Follow-up falling through cracks"],
        triggerWords: ["CAC", "LTV", "show rate", "no-show", "speed-to-lead", "pipeline velocity", "ICP", "reply rate"],
        desires: ["cheaper booked calls", "predictable monthly pipeline", "less time chasing leads"],
        objections: ["we tried cold email before", "our niche is different", "no budget this quarter"],
      }, cors);
    }
    if (body.action === "research_competitors") {
      await new Promise((r) => setTimeout(r, 1500));
      return json({
        ok: true,
        insights: "(mock) Rivals all lead with volume promises; none offers a show-rate guarantee — that's the gap.",
        competitors: [
          { name: "LeadFlow Co", website: "leadflow.example", offer: "20 calls/mo retainer $4K", mechanism: "AI SDR + LinkedIn touches", results: "Claims 350+ clients served", guarantee: "" },
          { name: "PipelinePros", website: "pipelinepros.example", offer: "Pay-per-show $250/call", mechanism: "Cold call + email combo", results: "Case study: 40 calls for fintech in 60 days", guarantee: "Pay only for shows" },
          { name: "OutboundLab", website: "outboundlab.example", offer: "$2.9K/mo + setup", mechanism: "Clay-powered personalization at scale", results: "", guarantee: "30-day opt-out" },
        ],
      }, cors);
    }
    if (body.action === "extract_framework") {
      await new Promise((r) => setTimeout(r, 1200));
      return json({
        ok: true,
        name: "Permission Opener",
        category: "Curiosity-led",
        template: "{{casual_permission_line}}\n\n{{one_line_what_we_do}} — {{specific_result_with_number}}.\n\n{{low_friction_cta}}",
        rules: "Under 50 words. The permission line lowers defenses. Result must contain a real number. CTA asks for interest, never a meeting.",
        analysis: "(mock) This wins because it asks permission before pitching, which flips the dynamic — the prospect opts in rather than being sold to.",
      }, cors);
    }
    if (body.action === "research") {
      await new Promise((r) => setTimeout(r, 1000));
      return json({
        ok: true,
        url: "https://" + String(body.url).replace(/^https?:\/\//, ""),
        summary: `(mock) They sell premium widgets to mid-market DTC brands, recently launched a subscription line, and proudly mention being "agency-burned" on their about page.`,
        pains: ["Subscription churn eating growth", "Ad spend up 40% with flat revenue", "Founder still writing all the emails"],
        hooks: ["New subscription line launched last quarter", "About page mentions bad agency experiences", "They sponsor a local pickleball league"],
      }, cors);
    }
    if (body.action === "generate") {
      if (!Array.isArray(body.frameworks) || !body.frameworks.length) return json({ ok: false, error: "at least one framework required (mock)" }, cors, 400);
      if (!Array.isArray(body.angles) || !body.angles.length) return json({ ok: false, error: "at least one angle required (mock)" }, cors, 400);
      await new Promise((r) => setTimeout(r, 1800));
      const vpa = Math.max(1, Math.min(Number(body.variantsPerAngle) || 1, 3));
      const results = body.frameworks.map((fw: { id: string; name: string; category: string; template: string }) => ({
        frameworkId: fw.id,
        framework: fw.name,
        category: fw.category,
        fills: Object.fromEntries(
          Array.from(new Set(Array.from(String(fw.template).matchAll(/\{\{(\w+)\}\}/g), (m) => m[1])))
            .map((v) => [v, `(mock fill for ${v})`]),
        ),
        variants: body.angles.flatMap((angle: string) =>
          Array.from({ length: vpa }, (_, i) => ({
            angle,
            label: `${fw.name.slice(0, 12)} take ${i + 1}`,
            script: mockScript(fw.name, angle, i + 1),
          }))
        ),
        usage: { input_tokens: 100, output_tokens: 200 },
      }));
      return json({ ok: true, results, usage: { input_tokens: 100, output_tokens: 200 } }, cors);
    }
    return json({ ok: false, error: "unknown action (mock)" }, cors, 400);
  }

  // Serve index.html
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    let html = await Deno.readTextFile(HTML_PATH);
    if (MOCK) {
      html = html.replace(
        /const\s+OUTREACH_BOT_URL\s*=\s*['"][^'"]+['"]\s*;/,
        `const OUTREACH_BOT_URL = 'http://localhost:${PORT}/mock/outreach-bot';`,
      );
      html = html.replace(
        "<body>",
        `<body>
<div style="position:fixed;bottom:0;left:0;right:0;background:#fbbf24;color:#0f172a;text-align:center;font:600 12px/1 Inter,sans-serif;padding:.4rem;z-index:9999">
  🧪 LOCAL DEV — Edge Function is mocked. Responses are canned, not real Claude output.
</div>`,
      );
    }
    return new Response(html, {
      status: 200,
      headers: { ...cors, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  return new Response("Not found", { status: 404, headers: cors });
}

function json(body: unknown, cors: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

console.log("");
console.log(`  outreach-script-bot dev server`);
console.log(`  ➜  http://localhost:${PORT}/`);
console.log(`  mocks: ${MOCK ? "ON" : "OFF (hits prod Supabase)"}`);
console.log("");
Deno.serve({ port: PORT }, handle);
