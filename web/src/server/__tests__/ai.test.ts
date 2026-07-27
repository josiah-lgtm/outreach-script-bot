// server/ai.ts is the only place that knows a provider's limits. These tests pin what it
// sends on the wire for each one: the tier→model resolution, the cache breakpoint (Anthropic
// only), and the web_search strip + "you cannot search" note (DeepSeek), plus that cost is
// metered against the right rate card.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PROVIDERS } from "../providers";
import type { ProviderSpec } from "../providers";

const rawMessages = vi.fn();
const resolveEndpoint = vi.fn();

vi.mock("../anthropic", () => ({ messages: rawMessages }));
vi.mock("../secrets", () => ({ resolveEndpoint }));

const { aiMessages } = await import("../ai");
const { usageCtx } = await import("../usage");
type UsageAccum = import("../usage").UsageAccum;

function endpointFor(spec: ProviderSpec) {
  return { spec, endpoint: { url: spec.apiUrl, key: "test-key", label: spec.label } };
}

// A response big enough to meter, shaped like the Messages API returns.
const reply = (usage: Record<string, number> = { input_tokens: 1000, output_tokens: 100 }) => ({
  id: "msg_1", model: "x", role: "assistant", content: [{ type: "text", text: "ok" }],
  stop_reason: "end_turn", usage,
});

/** The request body server/ai.ts actually handed the wire client. */
const sent = () => rawMessages.mock.calls[0][0] as Record<string, unknown>;

// Long enough to clear the smallest cache minimum (8300 chars for the sonnet tier).
const LONG_SYSTEM = "x".repeat(9000);
const webSearch = { type: "web_search_20250305", name: "web_search", max_uses: 3 };

beforeEach(() => {
  vi.clearAllMocks();
  rawMessages.mockResolvedValue(reply());
});

describe("aiMessages — tier resolution", () => {
  it("sends the active provider's model for the requested tier", async () => {
    resolveEndpoint.mockResolvedValue(endpointFor(PROVIDERS.deepseek));
    await aiMessages({ model: "fast", max_tokens: 10, messages: [{ role: "user", content: "hi" }] });
    expect(sent().model).toBe("deepseek-v4-flash");

    rawMessages.mockClear();
    resolveEndpoint.mockResolvedValue(endpointFor(PROVIDERS.anthropic));
    await aiMessages({ model: "fast", max_tokens: 10, messages: [{ role: "user", content: "hi" }] });
    expect(sent().model).toBe("claude-haiku-4-5");
  });

  it("resolves the legacy 'opus' alias against whichever provider is live", async () => {
    resolveEndpoint.mockResolvedValue(endpointFor(PROVIDERS.deepseek));
    await aiMessages({ model: "opus", max_tokens: 10, messages: [] });
    expect(sent().model).toBe("deepseek-v4-pro");
  });
});

describe("aiMessages — Anthropic", () => {
  beforeEach(() => resolveEndpoint.mockResolvedValue(endpointFor(PROVIDERS.anthropic)));

  it("keeps server-side web search and adds no tooling note", async () => {
    await aiMessages({ model: "default", max_tokens: 10, system: "be brief", messages: [], tools: [webSearch] });
    expect(sent().tools).toEqual([webSearch]);
    const system = sent().system as Array<{ text: string }>;
    expect(system).toHaveLength(1);
    expect(system[0].text).toBe("be brief");
  });

  it("marks the last stable block as a cache breakpoint once it clears the minimum", async () => {
    await aiMessages({ model: "default", max_tokens: 10, system: LONG_SYSTEM, messages: [] });
    const system = sent().system as Array<{ cache_control?: unknown }>;
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("leaves the volatile tail of a multi-block system uncached", async () => {
    await aiMessages({
      model: "default", max_tokens: 10, messages: [],
      system: [{ type: "text", text: LONG_SYSTEM }, { type: "text", text: "per-framework tail" }],
    });
    const system = sent().system as Array<{ cache_control?: unknown }>;
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(system[1].cache_control).toBeUndefined();
  });
});

describe("aiMessages — DeepSeek", () => {
  beforeEach(() => resolveEndpoint.mockResolvedValue(endpointFor(PROVIDERS.deepseek)));

  it("drops the server-side web_search tool and warns the model it cannot search", async () => {
    await aiMessages({ model: "default", max_tokens: 10, system: "research them", messages: [], tools: [webSearch] });
    // tools would otherwise be an unsupported field carrying a tool DeepSeek can't run.
    expect(sent().tools).toBeUndefined();
    const system = sent().system as Array<{ text: string }>;
    expect(system[0].text).toContain("web search is NOT available");
    // The note goes FIRST so the caller's "last block is volatile" contract survives.
    expect(system[system.length - 1].text).toBe("research them");
  });

  it("keeps client-side tools, which it can run", async () => {
    const realTool = { name: "lookup", description: "d", input_schema: { type: "object" } };
    await aiMessages({ model: "default", max_tokens: 10, messages: [], tools: [realTool, webSearch] });
    expect(sent().tools).toEqual([realTool]);
  });

  it("never sends a cache_control breakpoint (cache_control is ignored there)", async () => {
    await aiMessages({ model: "default", max_tokens: 10, system: LONG_SYSTEM, messages: [] });
    const system = sent().system as Array<{ cache_control?: unknown }>;
    expect(system.every((b) => b.cache_control === undefined)).toBe(true);
  });
});

describe("aiMessages — metering", () => {
  it("bills against the active provider's rate card", async () => {
    rawMessages.mockResolvedValue(reply({ input_tokens: 1_000_000, output_tokens: 1_000_000 }));

    resolveEndpoint.mockResolvedValue(endpointFor(PROVIDERS.anthropic));
    const claude = { input: 0, output: 0, cost: 0 };
    await usageCtx.run(claude, () => aiMessages({ model: "default", max_tokens: 10, messages: [] }));
    // sonnet: $3 in + $15 out per 1M
    expect(claude.cost).toBeCloseTo(18, 6);
    expect(claude.input).toBe(1_000_000);

    resolveEndpoint.mockResolvedValue(endpointFor(PROVIDERS.deepseek));
    const deepseek = { input: 0, output: 0, cost: 0 };
    await usageCtx.run(deepseek, () => aiMessages({ model: "default", max_tokens: 10, messages: [] }));
    // v4-flash: $0.14 in + $0.28 out per 1M
    expect(deepseek.cost).toBeCloseTo(0.42, 6);
  });

  it("prices cache reads and writes from the rate card, not a multiplier", async () => {
    resolveEndpoint.mockResolvedValue(endpointFor(PROVIDERS.anthropic));
    rawMessages.mockResolvedValue(reply({
      input_tokens: 0, output_tokens: 0,
      cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000,
    }));
    const s: UsageAccum = { input: 0, output: 0, cost: 0 };
    await usageCtx.run(s, () => aiMessages({ model: "default", max_tokens: 10, messages: [] }));
    // sonnet: write 3 × 1.25 = 3.75, read 3 × 0.1 = 0.30
    expect(s.cost).toBeCloseTo(4.05, 6);
    expect(s.cacheWrite).toBe(1_000_000);
    expect(s.cacheRead).toBe(1_000_000);
  });
});
