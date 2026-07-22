// Server-side house-lens composition.
//
// The browser composes the lens itself (lib/sync/systemFilter.ts) and ships it to
// the API as `body.lensPrefix` — that contract is unchanged and load-bearing.
// The MCP server has no browser, so it composes the SAME prefix here, reading the
// config document straight from Postgres and honouring the same
// settings.systemFilter fields and the overridable engine slots.
//
// Keep this behaviourally identical to lib/sync/systemFilter.ts: same headings,
// same ordering, same 4500/8000 caps. If one changes, change both.

import { getConfig } from "./db";
import { LENS_ACTIONS } from "@/lib/sync/engines";
import { loadEngineOverrides, resolveSlot } from "./prompts";

type SystemFilter = {
  enabled?: boolean;
  lens?: string;
  messaging?: string;
  icpScripter?: string;
  offers?: string;
} | null;

type ActiveClient = {
  transcripts?: Array<{ text?: string; pains?: string[]; angles?: string[]; desires?: string[] }>;
  sources?: Record<string, unknown>;
} | null;

export { LENS_ACTIONS };

export function composeLens(sf: SystemFilter): string {
  if (!sf || sf.enabled === false) return "";
  const parts: string[] = [];
  if (sf.lens) parts.push("OUR LENS (the overall filter — read everything below through this):\n" + sf.lens);
  if (sf.messaging) parts.push("MESSAGING & SCRIPTING (voice, tone, structure and rules EVERY script must follow):\n" + sf.messaging);
  if (sf.icpScripter) parts.push("ICP BUILDER & ANGLES (how to find, judge and create pain points, desires and angles — for the client account, the ICP and the niche):\n" + sf.icpScripter);
  if (sf.offers) parts.push("OFFER CREATION & GUARANTEES (offers, guarantees, and the offer-creation framework — use it as the template for thinking about offers and risk-reversal):\n" + sf.offers);
  if (!parts.length) return "";
  return "HOUSE KNOWLEDGE & FILTER — apply this as the lens for what to pick, what to ignore, and how to phrase it back to us:\n\n" + parts.join("\n\n");
}

export function composeLensLite(sf: SystemFilter): string {
  if (!sf || sf.enabled === false) return "";
  const parts: string[] = [];
  if (sf.lens) parts.push("OUR LENS:\n" + sf.lens);
  if (sf.messaging) parts.push("MESSAGING & SCRIPTING (voice, tone, structure, rules):\n" + sf.messaging);
  if (!parts.length) return "";
  const s = "HOUSE KNOWLEDGE & FILTER — write every script through this lens:\n\n" + parts.join("\n\n");
  return s.length > 4500 ? s.slice(0, 4500) + "\n…" : s;
}

export function clientResearch(c: ActiveClient): string {
  try {
    if (!c) return "";
    const bits: string[] = [];
    (c.transcripts || []).forEach((t) => {
      if (t.text) bits.push(String(t.text).slice(0, 1500));
      const tags = ([] as string[]).concat(t.pains || [], t.angles || [], t.desires || []);
      if (tags.length) bits.push(tags.join("; "));
    });
    if (c.sources) Object.keys(c.sources).forEach((k) => bits.push(k));
    const txt = bits.filter(Boolean).join("\n").slice(0, 4000);
    return txt
      ? "RESEARCH (this client's call transcripts / saved sources — validate pains against this, real complaints beat inference):\n" + txt
      : "";
  } catch {
    return "";
  }
}

/**
 * Build the `lensPrefix` for one action, exactly as the browser would.
 * `clientId` scopes the research block to a client (the browser uses whichever
 * client detail screen is open).
 */
export async function buildLensPrefix(
  action: string,
  clientId?: string | null,
): Promise<string> {
  try {
    if (!action || !LENS_ACTIONS[action]) return "";
    const cfg = (await getConfig()) as Record<string, unknown> | null;
    const settings = (cfg?.settings ?? {}) as Record<string, unknown>;
    const sf = (settings.systemFilter ?? null) as SystemFilter;
    const overrides = await loadEngineOverrides();

    const parts: string[] = [];
    if (action === "generate") {
      const lite = composeLensLite(sf);
      if (lite) parts.push(lite);
      parts.push(resolveSlot("scriptFirstLiner", overrides));
    } else {
      const lens = composeLens(sf);
      if (lens) parts.push(lens);
      if (action === "suggest_angles" || action === "suggest_offers" || action === "build_icp" || action === "fuse_angle") {
        parts.push(resolveSlot("icpAngles", overrides));
        if (clientId) {
          const clients = (cfg?.clients ?? []) as Array<Record<string, unknown>>;
          const c = clients.find((x) => x.id === clientId) as ActiveClient;
          const research = clientResearch(c ?? null);
          if (research) parts.push(research);
        }
      }
    }
    if (!parts.length) return "";
    let block = parts.join("\n\n");
    if (block.length > 8000) block = block.slice(0, 8000) + "\n…(filter trimmed to fit)";
    return block;
  } catch {
    return "";
  }
}
