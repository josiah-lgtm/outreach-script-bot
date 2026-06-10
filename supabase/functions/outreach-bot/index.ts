// Outreach Script Bot — Supabase Edge Function
// GET  → serves the outreach-bot UI (bundled into html.ts by deploy.sh, same
//        pattern as the `app` function).
// POST → { action: "generate", system, user, max_tokens? }
//        Proxies one Claude Messages call so the API key stays server-side.
//        Returns { ok: true, text } with the raw assistant text (the UI parses
//        the JSON the prompt asks for).
//
// Auth: POST requires x-admin-key matching the ADMIN_KEY secret (same key as
// offer-bot). GET is public — the HTML alone is harmless without the key.

import { CLAUDE_MODEL, messages as claudeMessages } from "../_shared/anthropic.ts";
import { HTML } from "./html.ts";

interface GenerateBody {
  action: "generate";
  system: string;
  user: string;
  max_tokens?: number;
}

const MAX_TOKENS_CAP = 2000;
const MAX_PROMPT_CHARS = 20_000;

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
      headers: {
        ...cors,
        "Content-Type": "text/html; charset=utf-8",
        // no-store so redeploys are immediately visible.
        "Cache-Control": "no-store",
      },
    });
  }

  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const adminKey = Deno.env.get("ADMIN_KEY");
  if (!adminKey || req.headers.get("x-admin-key") !== adminKey) {
    return json({ ok: false, error: "unauthorized — missing or wrong x-admin-key" }, 401);
  }

  let body: GenerateBody;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid JSON body" }, 400);
  }

  if (body.action !== "generate") return json({ ok: false, error: "unknown action" }, 400);
  if (!body.system || !body.user) return json({ ok: false, error: "system and user prompts required" }, 400);
  if (body.system.length + body.user.length > MAX_PROMPT_CHARS) {
    return json({ ok: false, error: "prompt too long" }, 400);
  }

  try {
    const res = await claudeMessages({
      model: CLAUDE_MODEL,
      max_tokens: Math.min(body.max_tokens ?? 1600, MAX_TOKENS_CAP),
      system: body.system,
      messages: [{ role: "user", content: body.user }],
    });
    const text = res.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("");
    return json({ ok: true, text, usage: res.usage });
  } catch (err) {
    console.error("outreach-bot generate failed:", err);
    return json({ ok: false, error: String((err as Error).message ?? err) }, 502);
  }
});
