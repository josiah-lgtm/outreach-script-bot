// HTTP entry point for the ported backend. Mirrors the legacy Deno.serve handler
// (index.ts:872-1749): login is the only unauthenticated action; everything else
// requires x-admin-key === ADMIN_KEY; AI actions are metered + daily-capped.

import { corsHeaders, json } from "@/server/shared";
import { handleLogin } from "@/server/auth";
import { dispatch } from "@/server/outreach";
import { AI_ACTIONS, usageCtx, usageBumpAndCheck, recordActionUsage } from "@/server/usage";
import { generateWeight } from "@/server/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Self-hosted (own Node server) — no serverless timeout, but set a generous ceiling.
export const maxDuration = 300;

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid JSON body" }, 400);
  }

  const adminKey = process.env.ADMIN_KEY;

  // Login is the only unauthenticated action.
  if (body.action === "login") return handleLogin(body, req);

  if (!adminKey || req.headers.get("x-admin-key") !== adminKey) {
    return json({ ok: false, error: "unauthorized — missing or wrong x-admin-key" }, 401);
  }

  const action = String(body.action);
  const isAi = AI_ACTIONS.has(action);

  // Daily spend safety cap: block AI actions once the day's call budget is exhausted.
  if (isAi) {
    const weight = action === "generate" ? generateWeight(body) : 1;
    const u = await usageBumpAndCheck(action, weight);
    if (!u.ok) {
      return json({ ok: false, error: `Daily AI limit reached (${u.cap} calls/day). This is a safety cap to control spend; it resets at UTC midnight. Raise it by setting the DAILY_AI_CALL_CAP env var.` }, 429);
    }
  }

  // Run inside a usage accumulator so every Claude call's tokens/cost are metered.
  return usageCtx.run(
    { input: 0, output: 0, cost: 0, lens: typeof body.lensPrefix === "string" ? body.lensPrefix : "" },
    async () => {
      try {
        const result = await dispatch(action, body);
        if (isAi) { try { await recordActionUsage(action, usageCtx.getStore()); } catch { /* ignore */ } }
        return result;
      } catch (err) {
        console.error("outreach-bot error:", err);
        return json({ ok: false, error: String((err as Error).message ?? err) }, 502);
      }
    },
  );
}
