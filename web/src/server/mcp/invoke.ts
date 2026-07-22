// Run a backend action from the MCP server.
//
// /api/outreach's route handler does four things around `dispatch`: composes the
// house lens into body.lensPrefix (in the browser), enforces the daily AI-call
// cap, opens a usage accumulator, and records the spend. MCP calls must go
// through the same gauntlet or they'd bypass the spend cap and never show up in
// the Admin → Usage console — so this reproduces it exactly, with the lens
// composed server-side (see server/lens.ts).

import { dispatch } from "../outreach";
import { buildLensPrefix } from "../lens";
import { AI_ACTIONS, usageCtx, usageBumpAndCheck, recordActionUsage } from "../usage";
import { generateWeight } from "../generate";

export interface InvokeOpts {
  /** Scopes the lens's research block to one client, as the UI does. */
  clientId?: string | null;
  /** Skip lens composition (used by preview tooling that supplies its own). */
  lensPrefix?: string;
}

/**
 * Invoke one action and return its parsed JSON payload.
 * Throws with the server's own error message when the action fails, so the MCP
 * layer can surface it verbatim to the model.
 */
export async function callAction(
  action: string,
  body: Record<string, unknown>,
  opts: InvokeOpts = {},
): Promise<any> {
  const lensPrefix = opts.lensPrefix ?? (await buildLensPrefix(action, opts.clientId ?? null));
  const full: Record<string, unknown> = { ...body, action };
  if (lensPrefix) full.lensPrefix = lensPrefix;

  const isAi = AI_ACTIONS.has(action);
  if (isAi) {
    const weight = action === "generate" ? generateWeight(full) : 1;
    const u = await usageBumpAndCheck(action, weight);
    if (!u.ok) {
      throw new Error(
        `Daily AI limit reached (${u.cap} calls/day). This is a safety cap to control spend; it resets at UTC midnight. Raise it by setting the DAILY_AI_CALL_CAP env var.`,
      );
    }
  }

  return usageCtx.run({ input: 0, output: 0, cost: 0, lens: lensPrefix }, async () => {
    const res = await dispatch(action, full);
    if (isAi) { try { await recordActionUsage(action, usageCtx.getStore()); } catch { /* ignore */ } }
    let data: any;
    try {
      data = await res.json();
    } catch {
      throw new Error(`${action} returned a non-JSON response (HTTP ${res.status})`);
    }
    if (!res.ok || data?.ok === false) {
      throw new Error(String(data?.error ?? `${action} failed (HTTP ${res.status})`));
    }
    return data;
  });
}
