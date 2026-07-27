// UsageTab — Admin → Usage. Port of the legacy adminUsage :3283 +
// renderUsageDashboard :3358 + loadUsage :3346. Two blocks: the AI-provider + key manager
// (shared with Admin → Settings, see AiProviderCard.tsx) and the usage/spend dashboard.
// All numbers + prices come from the server (`get_usage` returns { usage, cap, provider,
// rates }); the dashboard renders the active provider's rate card from the response rather
// than hardcoding a price copy. The legacy SVG bar graph is rendered here as a simple CSS
// bar chart (divs).

"use client";

import { useCallback, useEffect, useState } from "react";
import { useConfigStore } from "@/lib/store/configStore";
import { api } from "@/lib/sync/api";
import { AiProviderCard, type ProviderState, type PublicProvider, type Rates } from "./AiProviderCard";
import { Card, CardBody, CardHeader, Button, Icon, Spinner, EmptyState, cn } from "@/components/ui";

// ── server response shapes (see web/src/server/usage.ts) ─────────────────────────
type DayActions = Record<string, { requests?: number; input?: number; output?: number; cost?: number }>;
type DayRec = {
  requests?: number; input?: number; output?: number; cost?: number;
  cacheRead?: number; cacheWrite?: number; actions?: DayActions;
};
type UsageDoc = { days?: Record<string, DayRec> };

// ── formatters (ports of the legacy `money` / `num`) ─────────────────────────────
const money = (n: unknown) => "$" + (Number(n) || 0).toFixed(2);
const num = (n: unknown) => (Number(n) || 0).toLocaleString();
const today = () => new Date().toISOString().slice(0, 10);

export function UsageTab() {
  // Read login state from the config store (the legacy tab gated on the admin key).
  const loggedIn = useConfigStore((s) => s.loggedIn);

  // The provider card owns provider/key state; we only mirror it so the dashboard copy
  // (rate card, console link) names whichever provider is actually live.
  const [providers, setProviders] = useState<ProviderState | null>(null);

  // ── usage dashboard state ──
  const [usage, setUsage] = useState<UsageDoc | null>(null);
  const [cap, setCap] = useState(0);
  const [rates, setRates] = useState<Rates>({});
  const [usageLoading, setUsageLoading] = useState(true);
  const [usageErr, setUsageErr] = useState("");

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

  // Mount: load usage. The async work lives INSIDE the effect and only setState after the
  // await, guarded by `alive`, so we never call setState synchronously in the effect body
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!loggedIn) return;
    let alive = true;
    (async () => {
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

  if (!loggedIn) {
    return (
      <EmptyState
        icon="bolt"
        title="Admin key required"
        description="Enter your admin key to manage the API keys and view usage."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <AiProviderCard onState={setProviders} />
      <UsageDashboard
        usage={usage}
        cap={cap}
        rates={rates}
        active={providers?.providers.find((p) => p.id === providers?.provider) ?? null}
        loading={usageLoading}
        error={usageErr}
        onRefresh={loadUsage}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────
// Usage & spend dashboard (legacy renderUsageDashboard :3358).
// ─────────────────────────────────────────────────────────────────────────────────
function UsageDashboard({
  usage, cap, rates, active, loading, error, onRefresh,
}: {
  usage: UsageDoc | null;
  cap: number;
  rates: Rates;
  active: PublicProvider | null;
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
        {/* Prices rendered from the active provider's `rates` — NOT a hardcoded price copy. */}
        <p className="text-[11px] text-muted leading-snug">
          Tokens and estimated cost of every AI action the bot runs through your{" "}
          {active?.label ?? "provider"} key, by day and by task. Cost is an estimate from the model used per
          call ({" "}
          <RatesLine rates={rates} />). Days recorded before a provider switch keep the cost they were
          billed at. The authoritative number is always your{" "}
          <a href={active?.consoleUrl ?? "https://console.anthropic.com"} target="_blank" rel="noreferrer" className="text-accent2 no-underline hover:underline">
            {active?.label ?? "provider"} console
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
                sub={(tCacheRead || tCacheWrite) ? num(tCacheWrite) + " written · cached reads bill at a fraction of input" : "not engaging yet"}
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
