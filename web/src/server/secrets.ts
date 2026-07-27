// AI provider + key management (admin can switch and rotate from the console).
// An admin-set key in kv['secrets'] overrides that provider's env var; clearing reverts to env.
// kv['secrets'].aiProvider picks which provider every AI call goes to; unset falls back to
// the AI_PROVIDER env var, then Anthropic.
// Port of legacy index.ts:131-177 (Supabase Storage secrets.json → Postgres kv).

import { kvGet, kvSet } from "./db";
import type { Endpoint } from "./anthropic";
import {
  PROVIDER_IDS, envProvider, isProviderId, providerSpec, publicProvider,
  type ProviderId, type ProviderSpec, type PublicProvider,
} from "./providers";

export interface KeyStatus { set: boolean; source: string; last4: string }

export async function secretsLoad(): Promise<Record<string, string>> {
  try {
    const d = await kvGet<Record<string, string>>("secrets");
    if (d && typeof d === "object") return d;
  } catch { /* ignore */ }
  return {};
}

export async function secretsSave(s: Record<string, string>): Promise<void> {
  await kvSet("secrets", s);
}

// Every AI call needs the provider + key, so the secrets doc is cached per process for 30s
// (the same throttle the old ensureAnthropicKey() used) instead of hitting Postgres per call.
let __cache: Record<string, string> | null = null;
let __cacheAt = 0;
async function secretsCached(): Promise<Record<string, string>> {
  const now = Date.now();
  if (__cache && now - __cacheAt < 30_000) return __cache;
  try {
    __cache = await secretsLoad();
    __cacheAt = now;
  } catch { /* keep the last good copy; env is still the floor */ }
  return __cache ?? {};
}

/** Invalidate the cache so the next AI call re-reads kv['secrets'] (call after set/clear/switch). */
export function markSecretsChanged(): void { __cache = null; __cacheAt = 0; }

/** The provider every AI call currently goes to. */
export async function activeProvider(): Promise<ProviderId> {
  const stored = (await secretsCached()).aiProvider;
  return isProviderId(stored) ? stored : envProvider();
}

/** Resolved key for one provider: an admin-set key wins, else the env fallback, else "". */
function keyFrom(secrets: Record<string, string>, spec: ProviderSpec): { key: string; source: "stored" | "env" | "none" } {
  const stored = secrets[spec.secretField];
  if (stored) return { key: stored, source: "stored" };
  const env = process.env[spec.envVar];
  if (env) return { key: env, source: "env" };
  return { key: "", source: "none" };
}

/** Where the next AI call goes. Throws with an actionable message when no key is set. */
export async function resolveEndpoint(): Promise<{ spec: ProviderSpec; endpoint: Endpoint }> {
  const secrets = await secretsCached();
  const spec = providerSpec(isProviderId(secrets.aiProvider) ? secrets.aiProvider : envProvider());
  const { key } = keyFrom(secrets, spec);
  if (!key) {
    throw new Error(
      `No ${spec.label} API key set — add one in Admin → Usage, or set ${spec.envVar} on the server.`,
    );
  }
  return { spec, endpoint: { url: spec.apiUrl, key, label: spec.label } };
}

export async function providerKeyStatus(id: ProviderId): Promise<KeyStatus> {
  const spec = providerSpec(id);
  const { key, source } = keyFrom(await secretsLoad(), spec);
  return { set: !!key, source, last4: key ? key.slice(-4) : "" };
}

// Tiny 1-token call to validate a key. Tests the given key, or the resolved (stored/env) one.
export async function testProviderKey(id: ProviderId, candidate?: string): Promise<{ ok: boolean; model?: string; error?: string }> {
  const spec = providerSpec(id);
  const key = (candidate && candidate.trim()) || keyFrom(await secretsLoad(), spec).key;
  if (!key) return { ok: false, error: "No key set" };
  const model = spec.models.fast;
  try {
    const res = await fetch(spec.apiUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
    });
    if (res.ok) return { ok: true, model };
    return { ok: false, error: `${spec.label} ${res.status}: ${(await res.text()).slice(0, 160)}` };
  } catch (e) { return { ok: false, error: String((e as Error).message ?? e) }; }
}

/** Everything Admin → Usage needs to render the provider switch. Never includes a key. */
export interface AiProviderState {
  provider: ProviderId;
  providers: PublicProvider[];
  statuses: Record<string, KeyStatus>;
}
export async function aiProviderState(): Promise<AiProviderState> {
  const secrets = await secretsLoad();
  const statuses: Record<string, KeyStatus> = {};
  for (const id of PROVIDER_IDS) {
    const spec = providerSpec(id);
    const { key, source } = keyFrom(secrets, spec);
    statuses[id] = { set: !!key, source, last4: key ? key.slice(-4) : "" };
  }
  return {
    provider: isProviderId(secrets.aiProvider) ? secrets.aiProvider : envProvider(),
    providers: PROVIDER_IDS.map((id) => publicProvider(providerSpec(id))),
    statuses,
  };
}

// ─── Notion API key (shared, admin-set in Settings; falls back to env) ──────────
// The three Notion export actions resolve the key through this instead of reading
// process.env directly, so ONE key set in Admin → Settings is shared by everyone,
// and the NOTION_API_KEY env var is only a fallback when no key is stored.

/** The effective Notion key: an admin-set key in kv['secrets'] wins, else the env fallback. */
export async function resolveNotionKey(): Promise<string> {
  try { const s = await secretsLoad(); if (s.notionKey) return s.notionKey; } catch { /* fall through to env */ }
  return process.env.NOTION_API_KEY || "";
}

export async function notionKeyStatus(): Promise<{ set: boolean; source: string; last4: string }> {
  const stored = (await secretsLoad()).notionKey;
  const env = process.env.NOTION_API_KEY;
  const k = stored || env || "";
  return { set: !!k, source: stored ? "stored" : (env ? "env" : "none"), last4: k ? k.slice(-4) : "" };
}

// Validate a Notion token with a cheap GET /v1/users/me. Tests the given key, or the
// resolved (stored/env) one. A Notion integration token has no fixed prefix (secret_… for
// internal integrations, ntn_… for newer ones), so we validate by calling the API, not by shape.
export async function testNotionKey(candidate?: string): Promise<{ ok: boolean; name?: string; error?: string }> {
  const key = (candidate && candidate.trim()) || (await resolveNotionKey());
  if (!key) return { ok: false, error: "No key set" };
  try {
    const res = await fetch("https://api.notion.com/v1/users/me", {
      headers: { "Authorization": `Bearer ${key}`, "Notion-Version": "2022-06-28" },
    });
    if (res.ok) {
      const d = await res.json().catch(() => ({} as Record<string, unknown>));
      const bot = (d as { bot?: { owner?: { workspace_name?: string } } })?.bot;
      const name = bot?.owner?.workspace_name || (d as { name?: string })?.name || "connected";
      return { ok: true, name };
    }
    return { ok: false, error: `Notion ${res.status}: ${(await res.text()).slice(0, 160)}` };
  } catch (e) { return { ok: false, error: String((e as Error).message ?? e) }; }
}
