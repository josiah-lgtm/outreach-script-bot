// UsageTab — Admin → Usage. Port of the legacy adminUsage :3283 +
// renderUsageDashboard :3358 + the key-management helpers (loadKeyStatus :3302,
// testAnthropicKeyInput :3312, saveAnthropicKey :3322, clearAnthropicKey :3335,
// loadUsage :3346). Two blocks: the Anthropic API-key manager and the usage/spend
// dashboard. All numbers + prices come from the server (`get_usage` returns
// { usage, cap, rates }); the dashboard renders RATES from the response rather than
// hardcoding a price copy. The legacy SVG bar graph is rendered here as a simple
// CSS bar chart (divs). The key is NEVER shown in full — status renders ••••last4 only.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConfigStore } from "@/lib/store/configStore";
import { api } from "@/lib/sync/api";
import { notify } from "@/lib/notify";
import {
  Button, Card, CardBody, CardHeader, Input, FormField, Icon, Badge, Spinner, EmptyState, cn,
} from "@/components/ui";

// ── server response shapes (see web/src/server/usage.ts + secrets.ts) ────────────
type Rate = { in: number; out: number };
type Rates = Record<string, Rate>;
type DayActions = Record<string, { requests?: number; input?: number; output?: number; cost?: number }>;
type DayRec = {
  requests?: number; input?: number; output?: number; cost?: number;
  cacheRead?: number; cacheWrite?: number; actions?: DayActions;
};
type UsageDoc = { days?: Record<string, DayRec> };
type KeyStatus = { set: boolean; source: string; last4: string };

// ── formatters (ports of the legacy `money` / `num`) ─────────────────────────────
const money = (n: unknown) => "$" + (Number(n) || 0).toFixed(2);
const num = (n: unknown) => (Number(n) || 0).toLocaleString();
const today = () => new Date().toISOString().slice(0, 10);

export function UsageTab() {
  // Read login state from the config store (the legacy tab gated on the admin key).
  const loggedIn = useConfigStore((s) => s.loggedIn);

  // ── Anthropic key state ──
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  const [keyStatusErr, setKeyStatusErr] = useState<string>("");
  const [keyInput, setKeyInput] = useState("");
  const [keyMsg, setKeyMsg] = useState<{ text: string; tone: "ok" | "err" | "info" } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  // ── usage dashboard state ──
  const [usage, setUsage] = useState<UsageDoc | null>(null);
  const [cap, setCap] = useState(0);
  const [rates, setRates] = useState<Rates>({});
  const [usageLoading, setUsageLoading] = useState(true);
  const [usageErr, setUsageErr] = useState("");

  // Port of loadKeyStatus :3302.
  const loadKeyStatus = useCallback(async () => {
    setKeyStatusErr("");
    try {
      const r = await api({ action: "get_key_status" });
      setKeyStatus((r.status || {}) as KeyStatus);
    } catch (e) {
      setKeyStatus(null);
      setKeyStatusErr("Could not read key status: " + (e as Error).message);
    }
  }, []);

  // Port of loadUsage :3346.
  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    setUsageErr("");
    try {
      const r = await api({ action: "get_usage" });
      setUsage((r.usage || { days: {} }) as UsageDoc);
      setCap(Number(r.cap) || 0);
      setRates((r.rates || {}) as Rates);
    } catch (e) {
      const msg = (e as Error).message;
      setUsageErr(
        "Could not load usage: " + msg +
        (/unknown action/i.test(msg) ? " — the backend needs to be redeployed (it auto-deploys on push)." : ""),
      );
    } finally {
      setUsageLoading(false);
    }
  }, []);

  // Mount: load key status + usage together (the contract's required useEffect).
  // The async work lives INSIDE the effect and only setState after `await`, guarded by
  // `alive`, so we never call setState synchronously in the effect body
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!loggedIn) return;
    let alive = true;
    (async () => {
      try {
        const r = await api({ action: "get_key_status" });
        if (alive) { setKeyStatus((r.status || {}) as KeyStatus); setKeyStatusErr(""); }
      } catch (e) {
        if (alive) { setKeyStatus(null); setKeyStatusErr("Could not read key status: " + (e as Error).message); }
      }
      try {
        const r = await api({ action: "get_usage" });
        if (alive) {
          setUsage((r.usage || { days: {} }) as UsageDoc);
          setCap(Number(r.cap) || 0);
          setRates((r.rates || {}) as Rates);
          setUsageErr("");
        }
      } catch (e) {
        const msg = (e as Error).message;
        if (alive) {
          setUsageErr(
            "Could not load usage: " + msg +
            (/unknown action/i.test(msg) ? " — the backend needs to be redeployed (it auto-deploys on push)." : ""),
          );
        }
      } finally {
        if (alive) setUsageLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [loggedIn]);

  // Port of testAnthropicKeyInput :3312.
  async function testKey() {
    const cand = keyInput.trim();
    setTesting(true);
    setKeyMsg({ text: cand ? "Testing the pasted key…" : "Testing the current key…", tone: "info" });
    try {
      const r = await api({ action: "test_anthropic_key", key: cand || undefined });
      const res = r.result || {};
      setKeyMsg(res.ok
        ? { text: `Works (responded on ${res.model || "Claude"})`, tone: "ok" }
        : { text: res.error || "failed", tone: "err" });
    } catch (e) {
      setKeyMsg({ text: (e as Error).message, tone: "err" });
    } finally {
      setTesting(false);
    }
  }

  // Port of saveAnthropicKey :3322.
  async function saveKey() {
    const key = keyInput.trim();
    if (!key) { setKeyMsg({ text: "Paste a key first.", tone: "info" }); return; }
    setSaving(true);
    setKeyMsg({ text: "Verifying & saving…", tone: "info" });
    try {
      const r = await api({ action: "set_anthropic_key", key });
      setKeyInput("");
      setKeyMsg({ text: "Saved & verified — the bot now uses this key.", tone: "ok" });
      notify("Anthropic key updated");
      // set_anthropic_key returns the fresh status; fall back to a reload otherwise.
      if (r.status) setKeyStatus(r.status as KeyStatus); else loadKeyStatus();
    } catch (e) {
      setKeyMsg({ text: (e as Error).message, tone: "err" });
    } finally {
      setSaving(false);
    }
  }

  // Port of clearAnthropicKey :3335.
  async function clearKey() {
    if (!confirm("Clear the stored key and fall back to the deployed env key?")) return;
    setClearing(true);
    try {
      const r = await api({ action: "clear_anthropic_key" });
      setKeyMsg({ text: "Cleared — using the deployed env key.", tone: "info" });
      notify("Stored key cleared");
      if (r.status) setKeyStatus(r.status as KeyStatus); else loadKeyStatus();
    } catch (e) {
      setKeyMsg({ text: (e as Error).message, tone: "err" });
    } finally {
      setClearing(false);
    }
  }

  if (!loggedIn) {
    return (
      <EmptyState
        icon="bolt"
        title="Admin key required"
        description="Enter your admin key to manage the API key and view usage."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <KeyManager
        status={keyStatus}
        statusErr={keyStatusErr}
        keyInput={keyInput}
        setKeyInput={setKeyInput}
        keyMsg={keyMsg}
        testing={testing}
        saving={saving}
        clearing={clearing}
        onTest={testKey}
        onSave={saveKey}
        onClear={clearKey}
      />
      <UsageDashboard
        usage={usage}
        cap={cap}
        rates={rates}
        loading={usageLoading}
        error={usageErr}
        onRefresh={loadUsage}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────
// Anthropic API key manager (legacy adminUsage key block :3285-3295).
// ─────────────────────────────────────────────────────────────────────────────────
function KeyManager({
  status, statusErr, keyInput, setKeyInput, keyMsg, testing, saving, clearing, onTest, onSave, onClear,
}: {
  status: KeyStatus | null;
  statusErr: string;
  keyInput: string;
  setKeyInput: (v: string) => void;
  keyMsg: { text: string; tone: "ok" | "err" | "info" } | null;
  testing: boolean; saving: boolean; clearing: boolean;
  onTest: () => void; onSave: () => void; onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-text">
          <Icon name="plug" size={16} /> Anthropic API key
        </div>
        <KeyBadge status={status} />
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <p className="text-[11px] text-muted leading-snug">
          The key the bot uses for every AI call. Rotate it here after creating a new one at{" "}
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noreferrer"
            className="text-accent2 no-underline hover:underline"
          >
            console.anthropic.com
          </a>
          . It is stored server-side, never shown in full or sent back to the browser, and overrides the
          deployed env key. &ldquo;Use deployed default&rdquo; clears it and falls back to the env key.
        </p>

        {/* Current key status — masked ••••last4 only, NEVER the full key. */}
        <div className="text-[12px] text-subtle">
          {statusErr
            ? <span className="text-red">{statusErr}</span>
            : !status
              ? <span className="inline-flex items-center gap-1.5 text-muted"><Spinner size="sm" /> Checking key…</span>
              : status.set
                ? <>
                    Current key: <b className="text-text">••••{status.last4}</b> · source:{" "}
                    <b className="text-text">{status.source}</b>{" "}
                    {status.source === "stored" ? "(set here)" : "(deployed env)"}
                  </>
                : <span className="inline-flex items-center gap-1 text-amber">
                    <Icon name="alert-triangle" size={14} /> No API key set — the bot can&rsquo;t make AI calls until you add one.
                  </span>}
        </div>

        <FormField
          className="mb-0"
          label="New key"
          hint="Paste a new sk-ant-… key, then Test or Save & verify."
        >
          <Input
            ref={inputRef}
            type="password"
            autoComplete="off"
            placeholder="sk-ant-… paste a new key"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            className="max-w-[420px]"
          />
        </FormField>

        <div className="flex gap-2 flex-wrap">
          <Button variant="secondary" size="sm" icon="plug" loading={testing} onClick={onTest}>
            Test
          </Button>
          <Button variant="primary" size="sm" icon="device-floppy" loading={saving} onClick={onSave}>
            Save &amp; verify
          </Button>
          <Button variant="mini" size="sm" loading={clearing} onClick={onClear}>
            Use deployed default
          </Button>
        </div>

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

function KeyBadge({ status }: { status: KeyStatus | null }) {
  if (!status) return null;
  if (!status.set) return <Badge tone="amber">No key</Badge>;
  return <Badge tone={status.source === "stored" ? "accent" : "neutral"}>{status.source}</Badge>;
}

// ─────────────────────────────────────────────────────────────────────────────────
// Usage & spend dashboard (legacy renderUsageDashboard :3358).
// ─────────────────────────────────────────────────────────────────────────────────
function UsageDashboard({
  usage, cap, rates, loading, error, onRefresh,
}: {
  usage: UsageDoc | null;
  cap: number;
  rates: Rates;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  const days = usage?.days || {};
  const allDates = Object.keys(days).sort();          // ascending
  const win = allDates.slice(-30);                     // last 30 days for the graph
  const td = today();

  // Window totals + per-task aggregation (port of the legacy reduce loop).
  let tReq = 0, tIn = 0, tOut = 0, tCost = 0, tCacheRead = 0, tCacheWrite = 0;
  const byTask: Record<string, { requests: number; input: number; output: number; cost: number }> = {};
  win.forEach((d) => {
    const r = days[d] || {};
    tReq += r.requests || 0; tIn += r.input || 0; tOut += r.output || 0; tCost += r.cost || 0;
    tCacheRead += r.cacheRead || 0; tCacheWrite += r.cacheWrite || 0;
    Object.keys(r.actions || {}).forEach((a) => {
      const x = (r.actions as DayActions)[a];
      const t = byTask[a] = byTask[a] || { requests: 0, input: 0, output: 0, cost: 0 };
      t.requests += x.requests || 0; t.input += x.input || 0; t.output += x.output || 0; t.cost += x.cost || 0;
    });
  });
  const todayCost = (days[td] || {}).cost || 0;
  const todayReq = (days[td] || {}).requests || 0;
  const maxCost = Math.max(0.0001, ...win.map((d) => (days[d] || {}).cost || 0));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-text">
          <Icon name="trending-up" size={16} /> API usage &amp; spend
        </div>
        <Button variant="mini" size="sm" icon="refresh" loading={loading} onClick={onRefresh}>
          Refresh
        </Button>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        {/* Prices rendered from the server's `rates` — NOT a hardcoded price copy. */}
        <p className="text-[11px] text-muted leading-snug">
          Tokens and estimated cost of every AI action the bot runs through your Anthropic key, by day and
          by task. Cost is an estimate from the model used per call ({" "}
          <RatesLine rates={rates} />). The authoritative number is always your{" "}
          <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" className="text-accent2 no-underline hover:underline">
            Anthropic Console
          </a>
          .
        </p>

        {loading && !usage ? (
          <div className="flex items-center gap-2 text-[12px] text-muted py-6 justify-center">
            <Spinner size="sm" /> Loading usage…
          </div>
        ) : error ? (
          <EmptyState icon="alert-triangle" title="Couldn’t load usage" description={error} />
        ) : !win.length ? (
          <EmptyState
            icon="trending-up"
            title="No usage recorded yet"
            description="Run a few AI actions (generate, filter, etc.) and check back — this populates as the bot makes calls."
          />
        ) : (
          <>
            {/* 4 stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <Stat label="Today" value={money(todayCost)} sub={num(todayReq) + " req" + (cap ? " · cap " + num(cap) : "")} />
              <Stat label="Last 30 days" value={money(tCost)} sub={num(tReq) + " requests"} />
              <Stat label="Tokens (30d)" value={num(tIn + tOut)} sub={num(tIn) + " in · " + num(tOut) + " out"} />
              <Stat
                label="Cache (30d)"
                value={num(tCacheRead) + " read"}
                sub={(tCacheRead || tCacheWrite) ? num(tCacheWrite) + " written · cached reads cost ~10%" : "not engaging yet"}
              />
            </div>

            {/* CSS bar chart (replaces the legacy SVG) — daily estimated cost. */}
            <section>
              <div className="text-[12px] font-semibold text-text mb-2">
                Daily estimated cost (last {win.length} day{win.length === 1 ? "" : "s"})
              </div>
              <div className="overflow-x-auto border border-border rounded-lg p-3">
                <div className="flex items-end gap-1.5 h-[130px] min-w-max">
                  {win.map((d) => {
                    const rec = days[d] || {};
                    const c = rec.cost || 0;
                    const pct = Math.max(1, Math.round((c / maxCost) * 100));
                    const isToday = d === td;
                    return (
                      <div key={d} className="flex flex-col items-center justify-end gap-1 w-[26px] shrink-0 h-full">
                        <div
                          className={cn(
                            "w-full rounded-t-sm bg-accent2 transition-[height]",
                            isToday ? "opacity-100" : "opacity-50",
                          )}
                          style={{ height: `${pct}%` }}
                          title={`${d}: ${money(c)} · ${num(rec.requests || 0)} req · ${num(rec.input || 0)}/${num(rec.output || 0)} tok`}
                        />
                        <span className="text-[8px] text-muted leading-none">
                          {d.slice(8)}/{d.slice(5, 7)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Daily receipts (newest first) */}
            <section>
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-text mb-2">
                <Icon name="file-text" size={14} /> Daily receipts
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="text-left text-muted">
                      <Th>Date</Th>
                      <Th right>Requests</Th>
                      <Th right>Input tok</Th>
                      <Th right>Output tok</Th>
                      <Th right>Est. cost</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {win.slice().reverse().map((d) => {
                      const r = days[d] || {};
                      return (
                        <tr key={d}>
                          <Td>{d}{d === td && <span className="text-muted"> (today)</span>}</Td>
                          <Td right>{num(r.requests || 0)}</Td>
                          <Td right>{num(r.input || 0)}</Td>
                          <Td right>{num(r.output || 0)}</Td>
                          <Td right>{money(r.cost || 0)}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* By task (cost desc) */}
            <section>
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-text mb-2">
                <Icon name="bolt" size={14} /> Which tasks are spending (last 30 days)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="text-left text-muted">
                      <Th>Task (action)</Th>
                      <Th right>Requests</Th>
                      <Th right>Tokens</Th>
                      <Th right>Est. cost</Th>
                      <Th right>% spend</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(byTask).sort((a, b) => byTask[b].cost - byTask[a].cost).map((a) => {
                      const t = byTask[a];
                      return (
                        <tr key={a}>
                          <Td><code className="text-[12px] text-subtle">{a}</code></Td>
                          <Td right>{num(t.requests)}</Td>
                          <Td right>{num(t.input + t.output)}</Td>
                          <Td right>{money(t.cost)}</Td>
                          <Td right>{tCost ? Math.round((t.cost / tCost) * 100) : 0}%</Td>
                        </tr>
                      );
                    })}
                    {!Object.keys(byTask).length && (
                      <tr><td colSpan={5} className="py-2 text-muted text-[12px]">No task data yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </CardBody>
    </Card>
  );
}

// Render the per-1M in/out price for each model from the server's `rates` map.
function RatesLine({ rates }: { rates: Rates }) {
  const keys = Object.keys(rates);
  if (!keys.length) return <span className="italic">prices loading…</span>;
  const label = (k: string) => k.charAt(0).toUpperCase() + k.slice(1);
  return (
    <>
      {keys.map((k, i) => (
        <span key={k}>
          {label(k)} ${rates[k].in}/${rates[k].out}{i < keys.length - 1 ? ", " : ""}
        </span>
      ))}{" "}
      per 1M in/out
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-border rounded-lg p-3 min-w-0">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="text-[20px] font-bold text-text mt-0.5 tabular-nums truncate">{value}</div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function Th({ right, children }: { right?: boolean; children?: React.ReactNode }) {
  return <th className={cn("px-2 py-1.5 border-b border-border font-medium", right && "text-right")}>{children}</th>;
}
function Td({ right, children }: { right?: boolean; children?: React.ReactNode }) {
  return <td className={cn("px-2 py-1.5 border-b border-border", right && "text-right tabular-nums")}>{children}</td>;
}
