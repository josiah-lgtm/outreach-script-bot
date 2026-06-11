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
    if (body.action === "refine_script") {
      await new Promise((r) => setTimeout(r, 700));
      const script = String(body.script || "");
      const prompt = String(body.prompt || "").toLowerCase();
      let refined = script;
      if (prompt.includes("short")) refined = script.split("\n").filter((l: string) => l.trim()).slice(0, 3).join("\n");
      else if (prompt.includes("question")) refined = script.replace(/\.\s*$/, "?");
      else refined = script + "\n\n(mock refinement applied)";
      return json({ ok: true, script: refined }, cors);
    }
    if (body.action === "refine_selection") {
      await new Promise((r) => setTimeout(r, 600));
      const prompt = String(body.prompt || "");
      return json({ ok: true, replacement: `[mock rewrite of selection per "${prompt}"]` }, cors);
    }
    if (body.action === "extract_transcript") {
      await new Promise((r) => setTimeout(r, 1400));
      return json({
        ok: true,
        pains: ["CAC doubled since last year", "our old agency ghosted us after month 1", "leads go cold before we follow up", "team is too busy to do outreach manually"],
        desires: ["predictable 10-15 booked calls per month", "someone else to run the whole process", "leads that actually show up"],
        angles: ["Agency-burned twice, skeptical of promises", "CAC doubled, pipeline hasn't", "Leads going cold in under 48h", "Team too stretched to do outbound"],
        offers: ["DFY cold outreach — $2.5K/mo retainer", "Pay-per-show model — $200/booked call", "90-day pilot with performance guarantee"],
        insights: "(mock) This niche is frustrated with agencies that over-promise and under-deliver. They want a low-risk entry point and proof before committing.",
      }, cors);
    }
    if (body.action === "suggest_angles") {
      await new Promise((r) => setTimeout(r, 700));
      return json({
        ok: true,
        angles: [
          "Outbound volume is high but reply rates under 2%",
          "Cold email works but follow-up is falling through cracks",
          "Sales team spending 60% of time on prospecting",
          "Every competitor offering the same angle — standing out is hard",
          "Q3 pipeline target missed for third quarter running",
          "New market entry with no existing network",
        ],
      }, cors);
    }
    if (body.action === "build_icp") {
      await new Promise((r) => setTimeout(r, 1800));
      return json({
        ok: true,
        icps: [
          {
            title: "Scaling B2B SaaS — pricing left behind",
            niche: "B2B SaaS, Series A-C",
            jobTitles: ["CEO", "CFO", "VP Revenue", "Head of RevOps"],
            locations: ["United States", "UK"],
            employeeSize: "51-200",
            revenue: "$5M-$50M ARR",
            marketSize: "~34K — LinkedIn shows ~31-37K matching titles at US/UK SaaS cos 51-200",
            why: "(mock) Their $500M eHealth case study transfers directly: same 'existing customers underpriced' pain, same repricing mechanism. Budget holder is the CEO/CFO at this size.",
            outboundNotes: "Highly reachable on LinkedIn/Apollo. Trigger: recent funding round or flat NRR. Lead with the 20% ARR uplift case.",
            score: 9,
          },
          {
            title: "PE-backed vertical software",
            niche: "PE portfolio software companies",
            jobTitles: ["Operating Partner", "Portfolio CEO", "CFO"],
            locations: ["United States"],
            employeeSize: "201-1000",
            revenue: "$20M-$100M",
            marketSize: "~12K — est. from PitchBook PE software portfolio counts",
            why: "(mock) PE owners care about exit multiples — the client's 'stronger multiple' framing lands hardest here, and 3 of their case studies are PE-backed.",
            outboundNotes: "Smaller but high-ACV market. Lead with exit-multiple math, not features.",
            score: 8,
          },
          {
            title: "Bootstrapped SaaS hitting the growth wall",
            niche: "Bootstrapped B2B SaaS",
            jobTitles: ["Founder", "CEO"],
            locations: ["US", "EU"],
            employeeSize: "11-50",
            revenue: "$1M-$10M ARR",
            marketSize: "~80K — broad; would need niching down to ~30K via vertical filter",
            why: "(mock) Price-sensitive but the pain is acute: CAC rising, no pricing function in-house.",
            outboundNotes: "Cheaper deals, faster cycles. Flag: market is broad — niche by vertical before sequencing.",
            score: 6,
          },
        ],
        insights: "(mock) Start with ICP 1 — proof transfers cleanly and the ~34K market is the outbound sweet spot. ICP 2 is the high-ACV expansion play.",
      }, cors);
    }
    if (body.action === "fuse_angle") {
      await new Promise((r) => setTimeout(r, 600));
      const ing = Array.isArray(body.ingredients) ? body.ingredients as Array<{ text: string }> : [];
      return json({ ok: true, angle: `(fused) ${ing.map((i) => i.text.split(" ").slice(0, 3).join(" ")).join(" → ")}` }, cors);
    }
    if (body.action === "ai_edit_text") {
      await new Promise((r) => setTimeout(r, 600));
      const instruction = String(body.instruction || "");
      const text = String(body.text || "");
      return json({
        ok: true,
        html: `<p>📌 [mock ${instruction}] ${text.split(" ").slice(0, 6).join(" ")}…</p><ul><li>✅ point one</li><li style="color:red" onclick="alert(1)">point two (attrs must be stripped)</li></ul><script>bad()</script>`,
      }, cors);
    }
    if (body.action === "generate_followups") {
      await new Promise((r) => setTimeout(r, 1000));
      const fws = Array.isArray(body.frameworks) ? body.frameworks as Array<{ name: string }> : [];
      const gap = Math.max(1, Number(body.gapDays) || 2);
      return json({
        ok: true,
        followups: fws.map((f, i) => ({
          day: gap * (i + 1),
          framework: f.name,
          text: `Hi {{first_name}}, circling back — (mock ${f.name}) we just helped a similar company hit their numbers. Mind if I share how we'd do the same for {{company}}?\n\nThanks`,
        })),
      }, cors);
    }
    if (body.action === "compose_growth_plan") {
      await new Promise((r) => setTimeout(r, 900));
      const targets = Array.isArray(body.targets) ? body.targets : [];
      return json({
        ok: true,
        execSummary: `(mock) This ${body.mode === "growth" ? "scaling" : "proof-of-concept"} plan focuses outbound on ${targets.length || "the chosen"} target(s) across ${(body.channels || []).join(" + ")}, testing tight messaging to find the audience-script pair that books calls before scaling spend.`,
        targetRationales: targets.map((t: { title: string; niche: string }) => ({
          title: t.title,
          rationale: `(mock) ${t.title} is a strong fit — their pains map directly to the client's mechanism and the proof transfers cleanly to ${t.niche}.`,
        })),
        closing: "(mock) Success = a repeatable script booking calls at a predictable cost, ready to scale.",
      }, cors);
    }
    if (body.action === "export_notion") {
      await new Promise((r) => setTimeout(r, 700));
      if (body.test) return json({ ok: true, title: "Outreach Tracker (mock)" }, cors);
      return json({ ok: true, url: "https://notion.so/mock-growth-plan-" + Math.random().toString(36).slice(2, 8) }, cors);
    }
    if (body.action === "suggest_offers") {
      await new Promise((r) => setTimeout(r, 800));
      return json({
        ok: true,
        offers: [
          { name: "DFY Outreach Sprint", description: "90 days fully managed cold outreach — targeting one niche, one offer, daily sends" },
          { name: "Pay-Per-Show", description: "Only pay $200–300 per booked, confirmed call — zero retainer risk" },
          { name: "Rapid Audit", description: "One-week audit of current outreach: sequences, targeting, messaging — $997 flat" },
          { name: "Done-With-You", description: "We build the infrastructure, train your team, run the first month alongside you" },
        ],
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
