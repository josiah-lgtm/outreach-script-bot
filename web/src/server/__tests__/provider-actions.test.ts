// The admin console's provider flow, end to end through dispatch(): add an Anthropic key,
// add a DeepSeek key, pick which one the app uses, and have that choice survive a reload.
// Everything below is exactly what Admin → Settings / Admin → Usage sends.

import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory kv, so the secrets doc behaves like Postgres does.
const store = new Map<string, unknown>();
const kvGet = vi.fn(async (k: string) => store.get(k) ?? null);
const kvSet = vi.fn(async (k: string, v: unknown) => { store.set(k, v); });

vi.mock("../db", () => ({
  kvGet, kvSet,
  kvDel: vi.fn(), kvKeys: vi.fn().mockResolvedValue([]),
  getConfig: vi.fn(), casSaveConfig: vi.fn(), getConfigRev: vi.fn(),
  exportClientsLite: vi.fn(), exportClientScripts: vi.fn(),
}));

const { dispatch } = await import("../outreach");
const { markSecretsChanged } = await import("../secrets");

type Body = Record<string, unknown>;
const call = async (action: string, body: Body = {}) => {
  const res = await dispatch(action, { action, ...body });
  return { status: res.status, body: (await res.json()) as Body };
};

// testProviderKey does a real 1-token POST; stub it so the provider "accepts" the key.
const fetchMock = vi.fn();
beforeEach(() => {
  store.clear();
  markSecretsChanged();
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({ ok: true, text: async () => "", json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
  // No env keys — a bare install, which is what makes the "add a key" path meaningful.
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("DEEPSEEK_API_KEY", "");
  vi.stubEnv("AI_PROVIDER", "");
});

const ANTHROPIC_KEY = "sk-ant-api03-test-key-0001";
const DEEPSEEK_KEY = "sk-deepseek-test-key-0002";

describe("adding both keys and choosing the provider", () => {
  it("starts on Anthropic with neither key set", async () => {
    const { body } = await call("get_ai_provider");
    expect(body.provider).toBe("anthropic");
    expect((body.providers as unknown[]).map((p) => (p as Body).id)).toEqual(["anthropic", "deepseek"]);
    const statuses = body.statuses as Record<string, { set: boolean }>;
    expect(statuses.anthropic.set).toBe(false);
    expect(statuses.deepseek.set).toBe(false);
  });

  it("stores each provider's key independently and reports both", async () => {
    await call("set_provider_key", { provider: "anthropic", key: ANTHROPIC_KEY });
    await call("set_provider_key", { provider: "deepseek", key: DEEPSEEK_KEY });

    const { body } = await call("get_ai_provider");
    const statuses = body.statuses as Record<string, { set: boolean; source: string; last4: string }>;
    expect(statuses.anthropic).toMatchObject({ set: true, source: "stored", last4: "0001" });
    expect(statuses.deepseek).toMatchObject({ set: true, source: "stored", last4: "0002" });
    // Two separate fields in kv['secrets'] — one never overwrites the other.
    expect(store.get("secrets")).toMatchObject({ anthropicKey: ANTHROPIC_KEY, deepseekKey: DEEPSEEK_KEY });
  });

  it("switches which provider the app uses, and the choice sticks", async () => {
    await call("set_provider_key", { provider: "deepseek", key: DEEPSEEK_KEY });

    const switched = await call("set_ai_provider", { provider: "deepseek" });
    expect(switched.body.ok).toBe(true);
    expect(switched.body.provider).toBe("deepseek");

    // Re-read the way a page reload would.
    expect((await call("get_ai_provider")).body.provider).toBe("deepseek");
    // …and the spend dashboard follows it onto DeepSeek's rate card.
    const usage = await call("get_usage");
    expect(usage.body.provider).toBe("deepseek");
    expect(Object.keys(usage.body.rates as Body).sort()).toEqual(["v4-flash", "v4-pro"]);

    // And back again.
    await call("set_provider_key", { provider: "anthropic", key: ANTHROPIC_KEY });
    await call("set_ai_provider", { provider: "anthropic" });
    expect((await call("get_ai_provider")).body.provider).toBe("anthropic");
  });

  it("sends the key to the right provider's endpoint when verifying it", async () => {
    await call("set_provider_key", { provider: "deepseek", key: DEEPSEEK_KEY });
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe("https://api.deepseek.com/anthropic/v1/messages");
    expect(init.headers["x-api-key"]).toBe(DEEPSEEK_KEY);
  });
});

describe("guardrails", () => {
  it("refuses to switch onto a provider with no key", async () => {
    const r = await call("set_ai_provider", { provider: "deepseek" });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/No DeepSeek key set/);
    // The app is left on the provider it was already using.
    expect((await call("get_ai_provider")).body.provider).toBe("anthropic");
  });

  it("rejects a key pasted into the wrong provider", async () => {
    const r = await call("set_provider_key", { provider: "deepseek", key: "not-a-key" });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/should start with sk-/);
    expect(fetchMock).not.toHaveBeenCalled(); // never spends a request on an obvious typo
  });

  it("rejects a key the provider itself refuses", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => "invalid api key" });
    const r = await call("set_provider_key", { provider: "anthropic", key: ANTHROPIC_KEY });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/Key rejected by Anthropic/);
    expect(store.get("secrets")).toBeUndefined(); // nothing written
  });

  it("rejects an unknown provider id", async () => {
    expect((await call("set_ai_provider", { provider: "openai" })).status).toBe(400);
    expect((await call("set_provider_key", { provider: "openai", key: "sk-x" })).status).toBe(400);
  });

  it("clears one provider's key without touching the other", async () => {
    await call("set_provider_key", { provider: "anthropic", key: ANTHROPIC_KEY });
    await call("set_provider_key", { provider: "deepseek", key: DEEPSEEK_KEY });
    await call("clear_provider_key", { provider: "deepseek" });

    const statuses = (await call("get_ai_provider")).body.statuses as Record<string, { set: boolean }>;
    expect(statuses.anthropic.set).toBe(true);
    expect(statuses.deepseek.set).toBe(false);
  });

  it("falls back to the env key when nothing is stored", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-from-the-env-9999");
    const statuses = (await call("get_ai_provider")).body.statuses as Record<string, { set: boolean; source: string; last4: string }>;
    expect(statuses.deepseek).toMatchObject({ set: true, source: "env", last4: "9999" });
    // An env key is enough to switch onto.
    expect((await call("set_ai_provider", { provider: "deepseek" })).body.ok).toBe(true);
  });
});

describe("legacy Anthropic-only actions still work", () => {
  it("set/get/test/clear_anthropic_key target Anthropic", async () => {
    expect((await call("set_anthropic_key", { key: ANTHROPIC_KEY })).body.ok).toBe(true);
    expect((await call("get_key_status")).body.status).toMatchObject({ set: true, last4: "0001" });
    expect((await call("test_anthropic_key")).body.result).toMatchObject({ ok: true });
    await call("clear_anthropic_key");
    expect((await call("get_key_status")).body.status).toMatchObject({ set: false });
  });
});
