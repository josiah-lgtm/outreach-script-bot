// AiProviderCard — the AI provider switch + both providers' API keys. Rendered in BOTH
// Admin → Settings (grouped with the other shared keys) and Admin → Usage (next to the
// spend it drives); it is fully self-contained and re-reads the server on mount, so the
// two copies can never disagree for longer than a tab switch.
//
// Widened from the legacy single-Anthropic-key block (adminUsage :3285-3295) to the
// provider registry in server/providers.ts. The segmented control picks which provider
// you're LOOKING at; "Use … for every AI call" is what actually switches the bot over,
// so adding a key to the other provider is never a switch by accident.
//
// Keys are NEVER shown in full — the server only ever returns set/source/last4.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/sync/api";
import { notify } from "@/lib/notify";
import {
  Button, Card, CardBody, CardHeader, Input, FormField, Icon, Badge, Spinner, SegmentedControl, cn,
} from "@/components/ui";

export type Rate = { in: number; out: number; cacheRead?: number; cacheWrite?: number };
export type Rates = Record<string, Rate>;
export type KeyStatus = { set: boolean; source: string; last4: string };
/** Mirror of PublicProvider in server/providers.ts — no key material, ever. */
export type PublicProvider = {
  id: string;
  label: string;
  keyPrefix: string;
  keyHint: string;
  consoleUrl: string;
  consoleLabel: string;
  models: Record<string, string>;
  rates: Rates;
  webSearch: boolean;
  promptCaching: boolean;
  notes: string;
};
export type ProviderState = { provider: string; providers: PublicProvider[]; statuses: Record<string, KeyStatus> };

export function AiProviderCard({ onState }: {
  /** Fires whenever the server state changes, so a host tab can follow the live provider. */
  onState?: (s: ProviderState | null) => void;
}) {
  // `state` is the server's view (which provider is live + every provider's key status);
  // `view` is only which provider the admin is currently looking at, which starts as the
  // live one but can be pointed at the other to add its key before switching over.
  const [state, setState] = useState<ProviderState | null>(null);
  const [stateErr, setStateErr] = useState("");
  const [view, setView] = useState<string>("");
  const [keyInput, setKeyInput] = useState("");
  const [keyMsg, setKeyMsg] = useState<{ text: string; tone: "ok" | "err" | "info" } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [switching, setSwitching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the callback in a ref so a host passing an inline arrow doesn't re-run the mount
  // effect. Synced in an effect (never during render) — declared first so it lands before
  // the load effect below runs.
  const onStateRef = useRef(onState);
  useEffect(() => { onStateRef.current = onState; }, [onState]);

  const viewed = useMemo(
    () => state?.providers.find((p) => p.id === view) ?? state?.providers[0] ?? null,
    [state, view],
  );
  const viewedStatus = (viewed && state?.statuses[viewed.id]) || null;
  const isActive = !!viewed && viewed.id === state?.provider;
  const activeLabel = state?.providers.find((p) => p.id === state.provider)?.label ?? "";

  const apply = useCallback((next: ProviderState | null) => {
    setState(next);
    if (next) setView((v) => v || next.provider);
    onStateRef.current?.(next);
  }, []);

  const load = useCallback(async () => {
    setStateErr("");
    try {
      apply((await api({ action: "get_ai_provider" })) as unknown as ProviderState);
    } catch (e) {
      apply(null);
      setStateErr("Could not read provider status: " + (e as Error).message);
    }
  }, [apply]);

  // Mount: read the live provider + both key statuses. The async work lives INSIDE the
  // effect and only setState after the await, guarded by `alive`.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api({ action: "get_ai_provider" });
        if (alive) { apply(r as unknown as ProviderState); setStateErr(""); }
      } catch (e) {
        if (alive) { apply(null); setStateErr("Could not read provider status: " + (e as Error).message); }
      }
    })();
    return () => { alive = false; };
  }, [apply]);

  // Every provider action returns the fresh full state, so one setter keeps the switch,
  // both key statuses and the rate card in sync after any of them.
  function applyResponse(r: Record<string, unknown>) {
    if (r && Array.isArray(r.providers)) apply(r as unknown as ProviderState);
    else load();
  }

  // Port of testAnthropicKeyInput :3312, scoped to the provider being viewed.
  async function testKey() {
    if (!viewed) return;
    const cand = keyInput.trim();
    setTesting(true);
    setKeyMsg({ text: cand ? "Testing the pasted key…" : "Testing the current key…", tone: "info" });
    try {
      const r = await api({ action: "test_provider_key", provider: viewed.id, key: cand || undefined });
      const res = r.result || {};
      setKeyMsg(res.ok
        ? { text: `Works (responded on ${res.model || viewed.label})`, tone: "ok" }
        : { text: res.error || "failed", tone: "err" });
    } catch (e) {
      setKeyMsg({ text: (e as Error).message, tone: "err" });
    } finally {
      setTesting(false);
    }
  }

  // Port of saveAnthropicKey :3322.
  async function saveKey() {
    if (!viewed) return;
    const key = keyInput.trim();
    if (!key) { setKeyMsg({ text: "Paste a key first.", tone: "info" }); return; }
    setSaving(true);
    setKeyMsg({ text: "Verifying & saving…", tone: "info" });
    try {
      const r = await api({ action: "set_provider_key", provider: viewed.id, key });
      setKeyInput("");
      setKeyMsg({
        text: isActive
          ? "Saved & verified — the bot now uses this key."
          : `Saved & verified. ${viewed.label} isn't live yet — switch to it above.`,
        tone: "ok",
      });
      notify(`${viewed.label} key updated`);
      applyResponse(r);
    } catch (e) {
      setKeyMsg({ text: (e as Error).message, tone: "err" });
    } finally {
      setSaving(false);
    }
  }

  // Port of clearAnthropicKey :3335.
  async function clearKey() {
    if (!viewed) return;
    if (!confirm(`Clear the stored ${viewed.label} key and fall back to the deployed env key?`)) return;
    setClearing(true);
    try {
      const r = await api({ action: "clear_provider_key", provider: viewed.id });
      setKeyMsg({ text: "Cleared — using the deployed env key.", tone: "info" });
      notify("Stored key cleared");
      applyResponse(r);
    } catch (e) {
      setKeyMsg({ text: (e as Error).message, tone: "err" });
    } finally {
      setClearing(false);
    }
  }

  // Point every AI action at the provider currently being viewed. The server refuses the
  // switch when that provider has no key, so the bot can never end up with a dead backend.
  async function switchProvider() {
    if (!viewed || isActive) return;
    setSwitching(true);
    setKeyMsg({ text: `Switching to ${viewed.label}…`, tone: "info" });
    try {
      applyResponse(await api({ action: "set_ai_provider", provider: viewed.id }));
      setKeyMsg({ text: `${viewed.label} is now handling every AI call.`, tone: "ok" });
      notify(`AI provider switched to ${viewed.label}`);
    } catch (e) {
      setKeyMsg({ text: (e as Error).message, tone: "err" });
    } finally {
      setSwitching(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-text">
          <Icon name="plug" size={16} /> AI provider &amp; API keys
        </div>
        {activeLabel && <Badge tone="accent">{activeLabel} is live</Badge>}
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <p className="text-[11px] text-muted leading-snug">
          Which service runs every AI call — script generation, research, the house filter, the rewrite
          chips. Add a key for each provider you want available, then pick the one the app uses. Keys are
          stored server-side, never shown in full or sent back to the browser, and override that
          provider&rsquo;s deployed env key. Switching takes effect immediately for everyone; nothing in
          your scripts or config changes.
        </p>

        {stateErr ? (
          <div className="text-[12px] text-red">{stateErr}</div>
        ) : !state || !viewed ? (
          <div className="inline-flex items-center gap-1.5 text-[12px] text-muted">
            <Spinner size="sm" /> Loading providers…
          </div>
        ) : (
          <>
            {/* Which provider you're configuring. A ✓ marks the one that is live. */}
            <SegmentedControl
              size="sm"
              value={viewed.id}
              onChange={(id) => { setView(id); setKeyInput(""); setKeyMsg(null); }}
              options={state.providers.map((p) => ({
                value: p.id,
                label: `${p.label}${p.id === state.provider ? " ✓" : ""}`,
                title: p.id === state.provider ? "Currently handling every AI call" : `Configure ${p.label}`,
              }))}
            />

            {/* At-a-glance: does each provider have a key, and which one is live. */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
              {state.providers.map((p) => {
                const st = state.statuses[p.id];
                return (
                  <span key={p.id} className="inline-flex items-center gap-1">
                    {st?.set
                      ? <Icon name="check" size={13} className="text-green" />
                      : <Icon name="alert-triangle" size={13} className="text-amber" />}
                    {p.label}: {st?.set ? `key set (••••${st.last4})` : "no key"}
                    {p.id === state.provider && <b className="text-text">· in use</b>}
                  </span>
                );
              })}
            </div>

            <p className="text-[11px] text-muted leading-snug">{viewed.notes}</p>

            {/* The switch itself. Disabled without a key: the server rejects it anyway. */}
            {!isActive && (
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="primary"
                  size="sm"
                  icon="bolt"
                  loading={switching}
                  disabled={!viewedStatus?.set}
                  onClick={switchProvider}
                >
                  Use {viewed.label} for every AI call
                </Button>
                <span className="text-[11px] text-muted">
                  {viewedStatus?.set ? `Replaces ${activeLabel}.` : "Add a key below first."}
                </span>
              </div>
            )}

            {/* Current key status — masked ••••last4 only, NEVER the full key. */}
            <div className="text-[12px] text-subtle">
              {!viewedStatus
                ? <span className="inline-flex items-center gap-1.5 text-muted"><Spinner size="sm" /> Checking key…</span>
                : viewedStatus.set
                  ? <>
                      {viewed.label} key: <b className="text-text">••••{viewedStatus.last4}</b> · source:{" "}
                      <b className="text-text">{viewedStatus.source}</b>{" "}
                      {viewedStatus.source === "stored" ? "(set here)" : "(deployed env)"}
                    </>
                  : <span className="inline-flex items-center gap-1 text-amber">
                      <Icon name="alert-triangle" size={14} /> No {viewed.label} key set
                      {isActive ? " — the bot can’t make AI calls until you add one." : " — add one to be able to switch to it."}
                    </span>}
            </div>

            <FormField className="mb-0" label={`${viewed.label} API key`} hint={viewed.keyHint}>
              <Input
                ref={inputRef}
                type="password"
                autoComplete="off"
                placeholder={`${viewed.keyPrefix}… paste a new key`}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                className="max-w-[420px]"
              />
            </FormField>

            <p className="text-[11px] text-muted leading-snug">
              Create one at{" "}
              <a href={viewed.consoleUrl} target="_blank" rel="noreferrer" className="text-accent2 no-underline hover:underline">
                {viewed.consoleLabel}
              </a>
              . &ldquo;Use deployed default&rdquo; clears the stored key and falls back to the env key.
            </p>

            <div className="flex gap-2 flex-wrap">
              <Button variant="secondary" size="sm" icon="plug" loading={testing} onClick={testKey}>
                Test
              </Button>
              <Button variant="primary" size="sm" icon="device-floppy" loading={saving} onClick={saveKey}>
                Save &amp; verify
              </Button>
              <Button variant="mini" size="sm" loading={clearing} onClick={clearKey}>
                Use deployed default
              </Button>
            </div>
          </>
        )}

        {keyMsg && (
          <div
            className={cn(
              "text-[12px] inline-flex items-center gap-1",
              keyMsg.tone === "ok" && "text-green",
              keyMsg.tone === "err" && "text-red",
              keyMsg.tone === "info" && "text-muted",
            )}
          >
            {keyMsg.tone === "ok" && <Icon name="check" size={14} />}
            {keyMsg.tone === "err" && <Icon name="x" size={14} />}
            {keyMsg.text}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
