// The provider registry is a CONTRACT between the call sites (which only ever name a
// capability tier) and the two backends. These assertions pin the parts that silently
// break things if they drift: tier→model resolution, the legacy sonnet/opus/haiku aliases
// still stored in settings.builderModel + settings.systemFilter.model, the cost formula,
// and the capability flags server/ai.ts branches on.

import { describe, it, expect } from "vitest";
import {
  PROVIDERS, PROVIDER_IDS, isProviderId, providerSpec, publicProvider, rateFor, ratesFor, tierOf,
  MODEL_SMART, MODEL_DEFAULT, MODEL_FAST, type Tier,
} from "../providers";

const TIERS: Tier[] = ["smart", "default", "fast"];

describe("tierOf", () => {
  it("passes tiers through", () => {
    expect(tierOf(MODEL_SMART)).toBe("smart");
    expect(tierOf(MODEL_DEFAULT)).toBe("default");
    expect(tierOf(MODEL_FAST)).toBe("fast");
  });

  it("maps the UI's stored aliases (what settings.builderModel holds)", () => {
    expect(tierOf("opus")).toBe("smart");
    expect(tierOf("sonnet")).toBe("default");
    expect(tierOf("haiku")).toBe("fast");
  });

  it("maps raw model ids from either provider back to their tier", () => {
    expect(tierOf("claude-opus-4-6")).toBe("smart");
    expect(tierOf("claude-sonnet-4-6")).toBe("default");
    expect(tierOf("claude-haiku-4-5")).toBe("fast");
    expect(tierOf("deepseek-v4-pro")).toBe("smart");
    expect(tierOf("deepseek-v4-flash")).toBe("fast");
  });

  it("falls back to the balanced tier for anything unrecognised", () => {
    // 'gemini' is still selectable in the System filter tab and has never resolved to
    // anything else; undefined/null happen whenever a caller omits `model`.
    expect(tierOf("gemini")).toBe("default");
    expect(tierOf(undefined)).toBe("default");
    expect(tierOf(null)).toBe("default");
    expect(tierOf("")).toBe("default");
  });
});

describe("provider registry", () => {
  it("resolves ids and rejects unknown ones", () => {
    expect(isProviderId("anthropic")).toBe(true);
    expect(isProviderId("deepseek")).toBe(true);
    expect(isProviderId("openai")).toBe(false);
    expect(isProviderId(undefined)).toBe(false);
    expect(providerSpec("openai").id).toBe("anthropic"); // unknown → the env default
  });

  it("gives every provider a model and a rate for every tier", () => {
    for (const id of PROVIDER_IDS) {
      const spec = PROVIDERS[id];
      for (const tier of TIERS) {
        expect(spec.models[tier], `${id}.${tier} model`).toBeTruthy();
        const r = rateFor(spec, tier);
        expect(r, `${id}.${tier} rate`).toBeTruthy();
        expect(r.out).toBeGreaterThan(0);
        // A cached read must never cost more than a fresh input token, or the metering
        // in server/ai.ts would over-report savings as spend.
        expect(r.cacheRead).toBeLessThanOrEqual(r.in);
      }
    }
  });

  it("pins the Anthropic model ids the app has always sent", () => {
    expect(PROVIDERS.anthropic.models).toEqual({
      smart: "claude-opus-4-6",
      default: "claude-sonnet-4-6",
      fast: "claude-haiku-4-5",
    });
  });

  it("points DeepSeek at its Anthropic-compatible endpoint", () => {
    // DeepSeek speaks the Messages API at /anthropic; the shared wire client in
    // server/anthropic.ts appends nothing, so the full path must be here.
    expect(PROVIDERS.deepseek.apiUrl).toBe("https://api.deepseek.com/anthropic/v1/messages");
    expect(PROVIDERS.deepseek.models.smart).toBe("deepseek-v4-pro");
    expect(PROVIDERS.deepseek.models.default).toBe("deepseek-v4-flash");
  });

  it("flags what DeepSeek can't do — server/ai.ts branches on both", () => {
    expect(PROVIDERS.anthropic.webSearch).toBe(true);
    expect(PROVIDERS.anthropic.promptCaching).toBe(true);
    // No server-side web_search tool, and cache_control is ignored (caching is automatic).
    expect(PROVIDERS.deepseek.webSearch).toBe(false);
    expect(PROVIDERS.deepseek.promptCaching).toBe(false);
  });

  it("keeps the Anthropic cache multipliers the old cost formula hardcoded", () => {
    // The port replaced `r.in * 0.1` / `r.in * 1.25` with explicit prices — same numbers.
    for (const key of Object.keys(PROVIDERS.anthropic.rates)) {
      const r = PROVIDERS.anthropic.rates[key];
      expect(r.cacheRead).toBeCloseTo(r.in * 0.1, 10);
      expect(r.cacheWrite).toBeCloseTo(r.in * 1.25, 10);
    }
  });

  it("ratesFor returns the asked-for provider's card", () => {
    expect(Object.keys(ratesFor("anthropic")).sort()).toEqual(["haiku", "opus", "sonnet"]);
    expect(Object.keys(ratesFor("deepseek")).sort()).toEqual(["v4-flash", "v4-pro"]);
  });

  it("strips the server-only fields from the browser payload", () => {
    // publicProvider() is what get_ai_provider hands the admin console. Keys never travel,
    // and neither do the env var / kv field names that hold them.
    for (const id of PROVIDER_IDS) {
      const pub = publicProvider(PROVIDERS[id]) as unknown as Record<string, unknown>;
      expect(pub.envVar).toBeUndefined();
      expect(pub.secretField).toBeUndefined();
      expect(pub.apiUrl).toBeUndefined();
      expect(pub.id).toBe(id);
    }
  });
});
