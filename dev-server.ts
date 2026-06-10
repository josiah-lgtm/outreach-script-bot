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
