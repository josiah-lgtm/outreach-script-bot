// Human-facing setup page for the MCP endpoint.
//
// Referenced from the OAuth metadata documents, and the page a teammate lands on
// if they open the /mcp URL in a browser and follow the hint. Deliberately a
// route handler emitting static HTML rather than a React page: it must render
// identically whether or not the app shell/auth is working.

import { baseUrl } from "@/server/mcp/auth";
import { TOOLS } from "@/server/mcp/tools";
import { esc } from "@/lib/text-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  const base = baseUrl(req);
  const url = `${base}/mcp`;
  const adminKeyAllowed = String(process.env.MCP_ALLOW_ADMIN_KEY ?? "true").toLowerCase() !== "false";

  const toolRows = TOOLS.map(
    (t) =>
      `<tr><td><code>${esc(t.name)}</code>${t.write ? ' <span class="w">write</span>' : ""}</td><td>${esc(t.description.split(". ")[0])}.</td></tr>`,
  ).join("");

  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MCP server · Outreach Script Bot</title>
<style>
  :root { color-scheme: light dark; --bg:#0f1115; --card:#171a21; --border:#272b35; --text:#e8eaee; --muted:#9aa1ad; --accent:#5b8cff; --code:#1e222b; }
  @media (prefers-color-scheme: light) { :root { --bg:#f6f7f9; --card:#fff; --border:#e2e5ea; --text:#171a21; --muted:#606875; --code:#f0f2f5; } }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--text); padding:40px 20px;
         font:15px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif }
  main { max-width:820px; margin:0 auto }
  h1 { font-size:26px; margin:0 0 6px }
  h2 { font-size:17px; margin:34px 0 10px; padding-top:20px; border-top:1px solid var(--border) }
  p.sub { color:var(--muted); margin:0 0 8px }
  code { background:var(--code); padding:2px 6px; border-radius:5px; font-size:13px;
         font-family:ui-monospace,SFMono-Regular,Menlo,monospace }
  pre { background:var(--code); border:1px solid var(--border); border-radius:10px;
        padding:14px 16px; overflow-x:auto; font-size:13px; line-height:1.55 }
  pre code { background:none; padding:0 }
  .url { display:flex; align-items:center; gap:10px; background:var(--card); border:1px solid var(--border);
         border-radius:10px; padding:14px 16px; margin:14px 0; font-family:ui-monospace,monospace;
         font-size:15px; word-break:break-all }
  ol,ul { padding-left:22px } li { margin:6px 0 }
  table { width:100%; border-collapse:collapse; margin-top:10px; font-size:13.5px }
  td { padding:7px 8px; border-bottom:1px solid var(--border); vertical-align:top }
  td:first-child { white-space:nowrap; width:1%; padding-right:18px }
  .w { font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; color:#ffb86b;
       border:1px solid #6b4a1f; border-radius:4px; padding:1px 5px; margin-left:5px }
  .note { background:var(--card); border:1px solid var(--border); border-left:3px solid var(--accent);
          border-radius:8px; padding:12px 16px; margin:16px 0; font-size:14px }
</style></head><body><main>

<h1>Outreach Script Bot — MCP server</h1>
<p class="sub">Connect Claude or ChatGPT to your clients, ICPs, scripts — and to the logic behind the ICP builder and the script maker.</p>

<div class="url">${esc(url)}</div>

<h2>Connect Claude</h2>
<ol>
  <li>Open <b>Settings → Connectors → Add custom connector</b> on claude.ai (or in the desktop app).</li>
  <li>Paste the URL above. Leave the OAuth fields blank — this server registers Claude automatically.</li>
  <li>Click <b>Connect</b>. A sign-in window opens: use your team email and password, or the shared admin key.</li>
  <li>Untick <b>Allow changes</b> in that window if you want a read-only connection.</li>
</ol>

<h2>Connect ChatGPT</h2>
<ol>
  <li>Enable <b>Developer mode</b> under Settings → Connectors → Advanced.</li>
  <li><b>Create</b> a connector, paste the URL above, and choose <b>OAuth</b> authentication.</li>
  <li>Sign in the same way. The <code>search</code> and <code>fetch</code> tools also make this usable in deep research.</li>
</ol>

<h2>Connect Claude Code / a script</h2>
<p class="sub">Header auth with the shared admin key${adminKeyAllowed ? "" : " is currently DISABLED on this server (MCP_ALLOW_ADMIN_KEY=false)"}.</p>
<pre><code>claude mcp add --transport http outreach ${esc(url)} \\
  --header "Authorization: Bearer $ADMIN_KEY"</code></pre>

<h2>Where to start once connected</h2>
<ul>
  <li>Ask it to run <code>whoami</code>, then read the <code>outreach://guide</code> resource.</li>
  <li>Use the <b>Tune the ICP builder</b> or <b>Tune the script maker</b> prompt from the host's prompt menu.</li>
  <li>The loop is: <code>get_logic</code> → <code>set_logic</code> (with <code>dryRun</code>) → <code>preview_prompt</code> (free) → <code>build_icp</code> / <code>generate_scripts</code>.</li>
</ul>

<div class="note">Writes go to the same config the web app is editing live. They are atomic and retried on conflict, but they are immediate — ask for <code>dryRun=true</code> and <code>save=false</code> while you are exploring.</div>

<h2>Tools (${TOOLS.length})</h2>
<table>${toolRows}</table>

<h2>Discovery endpoints</h2>
<pre><code>${esc(base)}/.well-known/oauth-protected-resource
${esc(base)}/.well-known/oauth-authorization-server
${esc(url)}/oauth/register
${esc(url)}/oauth/authorize
${esc(url)}/oauth/token</code></pre>

</main></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}
