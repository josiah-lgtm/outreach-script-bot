// House lens injection. Verbatim port of legacy index.html:1063-1262 (composeLens /
// composeLensLite / clientResearch / withSystemFilter). The legacy versions read the
// globals `config` and the active client; here those are pushed in via setLensContext()
// (the store updates it whenever config or the open client changes), so the network
// layer can read them synchronously without importing React/stores.

import { LENS_ACTIONS, FIRST_LINER_ENGINE_ANGLES, FIRST_LINER_ENGINE_SCRIPT } from "./engines";

// deno-style permissive shapes — the config/client documents are dynamic.
type SystemFilter = { enabled?: boolean; lens?: string; messaging?: string; icpScripter?: string; offers?: string } | null;
type ActiveClient = { transcripts?: Array<{ text?: string; pains?: string[]; angles?: string[]; desires?: string[] }>; sources?: Record<string, unknown> } | null;

let _systemFilter: SystemFilter = null;
let _activeClient: ActiveClient = null;

/** The store calls this whenever config.settings.systemFilter or the open client changes. */
export function setLensContext(ctx: { systemFilter?: SystemFilter; activeClient?: ActiveClient }): void {
  if ("systemFilter" in ctx) _systemFilter = ctx.systemFilter ?? null;
  if ("activeClient" in ctx) _activeClient = ctx.activeClient ?? null;
}

// The client's own research (call transcripts + saved sources) — used to validate pains.
export function clientResearch(): string {
  try {
    const c = _activeClient;
    if (!c) return "";
    const bits: string[] = [];
    (c.transcripts || []).forEach((t) => {
      if (t.text) bits.push(String(t.text).slice(0, 1500));
      const tags = ([] as string[]).concat(t.pains || [], t.angles || [], t.desires || []);
      if (tags.length) bits.push(tags.join("; "));
    });
    if (c.sources) Object.keys(c.sources).forEach((k) => bits.push(k));
    const txt = bits.filter(Boolean).join("\n").slice(0, 4000);
    return txt ? ("RESEARCH (this client's call transcripts / saved sources — validate pains against this, real complaints beat inference):\n" + txt) : "";
  } catch {
    return "";
  }
}

export function composeLens(): string {
  const sf = _systemFilter;
  if (!sf || sf.enabled === false) return "";
  const parts: string[] = [];
  if (sf.lens)        parts.push("OUR LENS (the overall filter — read everything below through this):\n" + sf.lens);
  if (sf.messaging)   parts.push("MESSAGING & SCRIPTING (voice, tone, structure and rules EVERY script must follow):\n" + sf.messaging);
  if (sf.icpScripter) parts.push("ICP BUILDER & ANGLES (how to find, judge and create pain points, desires and angles — for the client account, the ICP and the niche):\n" + sf.icpScripter);
  if (sf.offers)      parts.push("OFFER CREATION & GUARANTEES (offers, guarantees, and the offer-creation framework — use it as the template for thinking about offers and risk-reversal):\n" + sf.offers);
  if (!parts.length) return "";
  return "HOUSE KNOWLEDGE & FILTER — apply this as the lens for what to pick, what to ignore, and how to phrase it back to us:\n\n" + parts.join("\n\n");
}

// Lean lens for SCRIPT GENERATION only — lens + messaging, capped at 4500 chars.
export function composeLensLite(): string {
  const sf = _systemFilter;
  if (!sf || sf.enabled === false) return "";
  const parts: string[] = [];
  if (sf.lens) parts.push("OUR LENS:\n" + sf.lens);
  if (sf.messaging) parts.push("MESSAGING & SCRIPTING (voice, tone, structure, rules):\n" + sf.messaging);
  if (!parts.length) return "";
  const s = "HOUSE KNOWLEDGE & FILTER — write every script through this lens:\n\n" + parts.join("\n\n");
  return s.length > 4500 ? s.slice(0, 4500) + "\n…" : s;
}

// deno-lint-ignore no-explicit-any
export function withSystemFilter(body: any): any {
  try {
    if (!body || !body.action || !LENS_ACTIONS[body.action as string]) return body;
    const parts: string[] = [];
    if (body.action === "generate") {
      const lite = composeLensLite();
      if (lite) parts.push(lite);
      parts.push(FIRST_LINER_ENGINE_SCRIPT);
    } else {
      const lens = composeLens();
      if (lens) parts.push(lens);
      if (body.action === "suggest_angles" || body.action === "suggest_offers" || body.action === "build_icp" || body.action === "fuse_angle") {
        parts.push(FIRST_LINER_ENGINE_ANGLES);
        const research = clientResearch();
        if (research) parts.push(research);
      }
    }
    if (!parts.length) return body;
    body = Object.assign({}, body);
    let block = parts.join("\n\n");
    if (block.length > 8000) block = block.slice(0, 8000) + "\n…(filter trimmed to fit)";
    body = Object.assign({}, body);
    body.lensPrefix = block;
    return body;
  } catch {
    return body;
  }
}
