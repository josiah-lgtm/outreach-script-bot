// The AI backends the bot can run on, and everything that differs between them.
//
// Both providers speak the SAME wire protocol — the Anthropic Messages API — because
// DeepSeek publishes an Anthropic-compatible endpoint at https://api.deepseek.com/anthropic
// (docs: https://api-docs.deepseek.com/guides/anthropic_api). That is what makes the switch
// a setting rather than a second client: `server/anthropic.ts` talks the protocol,
// `server/ai.ts` runs the call, and this file says WHERE to send it, WITH WHICH KEY, and
// WHAT the provider can't do. Adding a third provider = one entry in PROVIDERS.
//
// Call sites never name a model. They ask for a capability TIER ("smart"/"default"/"fast")
// and server/ai.ts resolves it against the active provider, so flipping the provider
// re-points every AI action at once.

export type ProviderId = "anthropic" | "deepseek";
export type Tier = "smart" | "default" | "fast";

/** What the action handlers pass as `model`. Resolved per-provider at call time. */
export const MODEL_SMART: Tier = "smart";
export const MODEL_DEFAULT: Tier = "default";
export const MODEL_FAST: Tier = "fast";

/** USD per 1M tokens. cacheRead/cacheWrite are absolute prices, not multipliers. */
export interface Rate { in: number; out: number; cacheRead: number; cacheWrite: number }

export interface ProviderSpec {
  id: ProviderId;
  label: string;
  /** Full Messages endpoint (…/v1/messages). */
  apiUrl: string;
  /** Env var holding the fallback key. */
  envVar: string;
  /** Field inside kv['secrets'] holding the admin-set key that overrides the env one. */
  secretField: string;
  /** Required prefix — a cheap paste-check before we spend a request validating. */
  keyPrefix: string;
  keyHint: string;
  consoleUrl: string;
  consoleLabel: string;
  /** Concrete model id per tier. */
  models: Record<Tier, string>;
  /** Which rate-card entry each tier bills at. */
  tierRate: Record<Tier, string>;
  rates: Record<string, Rate>;
  /** Server-side web_search tool (executed by the API, not by us). */
  webSearch: boolean;
  /** Explicit cache_control breakpoints are honoured. */
  promptCaching: boolean;
  /** Shown in Admin → Usage under the provider switch. */
  notes: string;
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    apiUrl: "https://api.anthropic.com/v1/messages",
    envVar: "ANTHROPIC_API_KEY",
    secretField: "anthropicKey",
    keyPrefix: "sk-ant-",
    keyHint: "Paste a new sk-ant-… key, then Test or Save & verify.",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    consoleLabel: "console.anthropic.com",
    models: { smart: "claude-opus-4-6", default: "claude-sonnet-4-6", fast: "claude-haiku-4-5" },
    tierRate: { smart: "opus", default: "sonnet", fast: "haiku" },
    // Approx list prices, USD per 1M tokens. Cache reads bill ~0.1× input, writes ~1.25×.
    rates: {
      opus: { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      sonnet: { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      haiku: { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    },
    webSearch: true,
    promptCaching: true,
    notes: "Full feature set: server-side web search (used by niche, competitor and client-site research) and explicit prompt caching on the shared prefix.",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    // Anthropic-compatible surface. `anthropic-version` is accepted and ignored.
    apiUrl: "https://api.deepseek.com/anthropic/v1/messages",
    envVar: "DEEPSEEK_API_KEY",
    secretField: "deepseekKey",
    keyPrefix: "sk-",
    keyHint: "Paste a DeepSeek sk-… key, then Test or Save & verify.",
    consoleUrl: "https://platform.deepseek.com/api_keys",
    consoleLabel: "platform.deepseek.com",
    // DeepSeek maps claude-opus-* → v4-pro and claude-sonnet-*/haiku-* → v4-flash. We send
    // the real ids instead of relying on that aliasing, so the choice stays ours.
    models: { smart: "deepseek-v4-pro", default: "deepseek-v4-flash", fast: "deepseek-v4-flash" },
    tierRate: { smart: "v4-pro", default: "v4-flash", fast: "v4-flash" },
    // Published prices, USD per 1M tokens. Caching is automatic (no cache_control), so a
    // "write" is just an ordinary input token — cacheWrite carries no premium here.
    rates: {
      "v4-pro": { in: 0.435, out: 0.87, cacheRead: 0.003625, cacheWrite: 0.435 },
      "v4-flash": { in: 0.14, out: 0.28, cacheRead: 0.0028, cacheWrite: 0.14 },
    },
    webSearch: false,
    promptCaching: false,
    notes: "Much cheaper, but the API has no server-side web search: niche research, competitor intel and client-site research fall back to what the app can scrape directly, and are told not to invent what they can't verify. Caching is automatic (no cache_control), so cached-prefix savings still apply.",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function isProviderId(x: unknown): x is ProviderId {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(PROVIDERS, x);
}

/** The provider used when nothing is stored in kv['secrets']. */
export function envProvider(): ProviderId {
  const v = String(process.env.AI_PROVIDER ?? "").trim().toLowerCase();
  return isProviderId(v) ? v : "anthropic";
}

export function providerSpec(id: unknown): ProviderSpec {
  return isProviderId(id) ? PROVIDERS[id] : PROVIDERS[envProvider()];
}

// Accepts a tier, one of the UI's legacy aliases (sonnet/opus/haiku — still what
// settings.builderModel and settings.systemFilter.model store), or a raw model id from
// either provider. Anything unrecognised falls back to the balanced tier.
export function tierOf(model: unknown): Tier {
  const s = String(model ?? "").toLowerCase();
  if (s === "smart" || s.includes("opus") || s.includes("-pro")) return "smart";
  if (s === "fast" || s.includes("haiku") || s.includes("flash")) return "fast";
  return "default";
}

export function modelFor(spec: ProviderSpec, tier: Tier): string {
  return spec.models[tier];
}

export function rateFor(spec: ProviderSpec, tier: Tier): Rate {
  return spec.rates[spec.tierRate[tier]] ?? spec.rates[spec.tierRate.default];
}

/** The rate card the admin Usage dashboard prints, for one provider. */
export function ratesFor(id: unknown): Record<string, Rate> {
  return providerSpec(id).rates;
}

/** Everything about a provider that is safe to hand the browser (no keys, ever). */
export interface PublicProvider {
  id: ProviderId;
  label: string;
  keyPrefix: string;
  keyHint: string;
  consoleUrl: string;
  consoleLabel: string;
  models: Record<Tier, string>;
  rates: Record<string, Rate>;
  webSearch: boolean;
  promptCaching: boolean;
  notes: string;
}

export function publicProvider(spec: ProviderSpec): PublicProvider {
  const { id, label, keyPrefix, keyHint, consoleUrl, consoleLabel, models, rates, webSearch, promptCaching, notes } = spec;
  return { id, label, keyPrefix, keyHint, consoleUrl, consoleLabel, models, rates, webSearch, promptCaching, notes };
}
