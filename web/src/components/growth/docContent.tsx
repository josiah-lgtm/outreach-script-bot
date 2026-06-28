// The live growth-plan document, rendered as React from the working state + funnel-math.
// This is the JSX equivalent of the legacy gpPreviewStrategy (:6060) / gpPreviewGrowth
// (:6123): the same sections, tables, numbers and copy, built from the deterministic
// funnel math so the on-screen doc matches the Notion export byte-for-byte.
//
// The DOM produced here mirrors the Notion block structure so the Tiptap initial content
// (built by docToHtml, below) round-trips cleanly through blocksFromEditorDoc on export.

"use client";

import {
  computeReverse,
  gpCostRows,
  gpInfraRows,
  gpInt,
  gpMoney,
  gpPct,
  toolMonthlyCost,
  type Channel,
  type FunnelResult,
  type Tool,
} from "@/lib/funnel-math";
import { reverseRows } from "@/lib/sync/notion-blocks";
import {
  asFunnelState,
  activeFollowups,
  includedTools,
  type GrowthWorking,
} from "@/lib/store/growthStore";
import type { GpClient, GpIcp, GpFollowupSeq, GpFollowupItem } from "./types";

const CH_LABEL: Record<string, string> = { email: "📧 Email", linkedin: "🔗 LinkedIn" };
const chLabel = (ch: string) => CH_LABEL[ch] ?? ch;

interface DocProps {
  g: GrowthWorking;
  client: GpClient;
}

// ── brief (legacy gpBriefHtml :5611) ─────────────────────────────────────────────
function briefTargetIcps(g: GrowthWorking, c: GpClient): GpIcp[] {
  if (g.mode === "strategy")
    return g.targets
      .map((t) => (c?.icps || []).find((i) => i.id === t.icpId))
      .filter((i): i is GpIcp => !!i);
  return [];
}

function Brief({ g, client: c }: DocProps) {
  const b = c?.brief;
  if (!b) {
    return (
      <p className="text-muted text-xs">
        🧾 Build the client brief (left panel) to open the plan with {c?.name || "the client"}&apos;s services,
        positioning, case studies and competitors.
      </p>
    );
  }
  const icps = briefTargetIcps(g, c).filter((i) => i.example);
  return (
    <>
      <h2>About {c.name}</h2>
      {b.positioning && <p>{b.positioning}</p>}
      {!!b.services?.length && (
        <>
          <h3>Services</h3>
          <ul>{b.services.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </>
      )}
      {!!b.caseStudies?.length && (
        <>
          <h3>Case studies</h3>
          <ul>{b.caseStudies.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </>
      )}
      {!!b.competitors?.length && (
        <>
          <h3>Competitors</h3>
          <ul>{b.competitors.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </>
      )}
      {!!icps.length && (
        <>
          <h3>Who we will target, with a real example</h3>
          {icps.map((i, k) => (
            <p key={k}>
              <b>{i.title}</b> → {i.example!.company}
              {i.example!.website ? ` (${i.example!.website})` : ""}. {i.example!.why}
            </p>
          ))}
        </>
      )}
    </>
  );
}

// ── reverse funnel table (legacy funnelTableReverse :5677) ─────────────────────────
function ReverseTable({ channel, m, T, g }: { channel: Channel; m: FunnelResult; T: number; g: GrowthWorking }) {
  const a = g.assumptions[channel];
  return (
    <table>
      <thead>
        <tr>
          <th>Reverse funnel</th>
          <th className="num">Per month</th>
        </tr>
      </thead>
      <tbody>
        {reverseRows(channel, m, T, a).map(([k, v, desc, strong], i) => (
          <tr key={i}>
            <td className={strong ? "tot" : undefined}>
              {k}
              <br />
              <span className="rowdesc">{desc}</span>
            </td>
            <td className={strong ? "num tot" : "num"}>{gpInt(v as number)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── followups (legacy gpFollowupsDocHtml :5553) ────────────────────────────────────
function Followups({ g, client: c }: DocProps) {
  const seqs = activeFollowups(g, c) as GpFollowupSeq[];
  if (!seqs.length) return null;
  return (
    <>
      <h2>↪ Outbound follow-ups</h2>
      {seqs.map((s) => (
        <details key={s.id} className="gp-fold">
          <summary>
            {s.parentLabel} — {s.items.length} follow-ups (every {s.gapDays || 2} days)
          </summary>
          <div>
            {s.items.map((it: GpFollowupItem, i: number) => (
              <div key={i}>
                <h3>
                  Day +{it.day} · {it.framework || ""}
                </h3>
                <pre className="scriptbox">{it.text}</pre>
              </div>
            ))}
          </div>
        </details>
      ))}
    </>
  );
}

// ── strategy doc (legacy gpPreviewStrategy :6060) ──────────────────────────────────
function StrategyDoc({ g, client: c }: DocProps) {
  const N = g.narrative;
  const tools = includedTools(g);
  const gs = asFunnelState(g);
  const T = +g.targetBookings || 0;
  const per: Record<string, FunnelResult> = {};
  g.channels.forEach((ch) => { per[ch] = computeReverse(ch as Channel, g.assumptions[ch as Channel], T); });

  // Cost rows use the same gpAggregate (reverse) path the legacy gpCostRows() used.
  const costRows = gpCostRows(tools, gs);
  const infra = gpInfraRows(per, gs);
  const grand = costRows.reduce((s, r) => s + r.cost, 0) + infra.reduce((s, r) => s + r.cost, 0);
  const pers = g.assumptions.personalization;

  return (
    <>
      <h1>Growth Plan — {c?.name || ""}</h1>
      <div className="doc-sub">
        🧪 Strategy · Proof of Concept · {g.channels.map(chLabel).join(" · ")}
      </div>
      <Brief g={g} client={c} />
      <div className="callout">
        {N?.execSummary
          ? N.execSummary
          : `The goal of this phase is to prove the concept — test ${g.targets.length} target${
              g.targets.length !== 1 ? "s" : ""
            } with tight messaging, find the script + audience that books calls, then scale what works.`}
      </div>

      {!g.targets.length && (
        <p className="warn">⚠ Pick at least one target on the left to build the plan.</p>
      )}

      {g.targets.map((t, i) => {
        const rationales = (N?.targetRationales ?? []) as Array<{ title?: string; rationale?: string }>;
        const rationale =
          rationales.find((r) =>
            (r.title || "").toLowerCase().includes((t.title || "").toLowerCase().slice(0, 12)),
          ) || rationales[i];
        return (
          <div key={t.icpId}>
            <h2>🎯 Target {i + 1}: {t.title}</h2>
            <p>{rationale?.rationale || t.why || `Niche: ${t.niche || ""}`}</p>
            {t.marketSize && <p className="warn">📊 {t.marketSize}</p>}
            <h3>Key pains</h3>
            <ul>{t.pains.length ? t.pains.map((p, j) => <li key={j}>{p}</li>) : <li>—</li>}</ul>
            <h3>Offer</h3>
            <p>{t.offer || "—"}</p>
            <h3>Angles to test</h3>
            <ul>{t.angles.length ? t.angles.map((a, j) => <li key={j}>{a}</li>) : <li>—</li>}</ul>
            <h3>Scripts</h3>
            {t.scripts.length ? (
              t.scripts.map((s, j) => <pre key={j} className="scriptbox">{s.text}</pre>)
            ) : (
              <p>—</p>
            )}
          </div>
        );
      })}

      {g.channels.map((ch) => (
        <div key={ch}>
          <h2>{chLabel(ch)} funnel — reverse-engineered from {gpInt(T)} booked calls/mo</h2>
          <p>
            Working back from the goal: to book <b>{gpInt(T)}</b> calls a month at these rates, here is what we
            provision.
          </p>
          <ReverseTable channel={ch as Channel} m={per[ch]} T={T} g={g} />
        </div>
      ))}

      <h2>Personalization</h2>
      <p>
        Every lead gets a custom first line written by <b>{pers.model}</b> (~{gpInt(pers.inputTokensPerLead || 0)} in /{" "}
        {gpInt(pers.outputTokensPerLead || 0)} out tokens per lead). Relevance is what lifts reply rates above the
        floor.
      </p>

      <h2>🧰 Tech stack &amp; cost breakdown</h2>
      <table>
        <thead>
          <tr>
            <th>Line item</th>
            <th>Why</th>
            <th className="num">$/mo</th>
          </tr>
        </thead>
        <tbody>
          {costRows.map((r, i) => (
            <tr key={i}>
              <td><b>{r.tool.name}</b></td>
              <td className="muted">{r.tool.why as string}</td>
              <td className="num">{gpMoney(r.cost)}</td>
            </tr>
          ))}
          {infra.map((r, i) => (
            <tr key={`i${i}`}>
              <td><b>{r.name}</b></td>
              <td className="muted">{r.why}</td>
              <td className="num">{gpMoney(r.cost)}</td>
            </tr>
          ))}
          <tr>
            <td className="tot">Total tech stack</td>
            <td></td>
            <td className="num tot">{gpMoney(grand)}/mo</td>
          </tr>
        </tbody>
      </table>

      <h2>Next steps</h2>
      <ul>
        <li>☐ Verbal agreement on the target niche{g.targets.length > 1 ? "s" : ""}</li>
        <li>☐ Verbal agreement on the scripts to test</li>
        {g.toggles.replyAgent && <li>☐ Sign up for the AI reply agent</li>}
        <li>
          ☐ Kickoff: {g.channels.includes("email") ? "domains + inbox warmup" : ""}
          {g.channels.length > 1 ? " / " : ""}
          {g.channels.includes("linkedin") ? "LinkedIn seat setup" : ""}
        </li>
      </ul>

      <Followups g={g} client={c} />
      {g.toggles.pledge && (g.toggles.pledgeText || "").trim() && (
        <div className="callout pledge"><b>Our pledge:</b> {g.toggles.pledgeText}</div>
      )}
      {N?.closing && <p><i>{N.closing}</i></p>}
    </>
  );
}

// ── growth/scaling doc (legacy gpPreviewGrowth :6123) ──────────────────────────────
function GrowthDocBody({ g, client: c }: DocProps) {
  const N = g.narrative;
  const gs = asFunnelState(g);
  const verifyRateEmail = (g.assumptions.email.verifyRate as number) || 0.65;

  const channelBlocks = g.channels.map((ch) => {
    const o = g.observed[ch] || { contacted: 0, replies: 0, positive: 0, booked: 0 };
    const bookedPer = o.contacted ? (o.booked || 0) / o.contacted : 0;
    const needContacted = bookedPer > 0 ? g.targetBookings / bookedPer : 0;
    const verifyRate = ch === "email" ? verifyRateEmail : 1;
    const leadsNeeded = verifyRate ? needContacted / verifyRate : needContacted;
    const bulkOrder = Math.ceil(leadsNeeded / 1000) * 1000;
    return { ch, o, bookedPer, needContacted, bulkOrder };
  });
  const plannedLeadsAll = channelBlocks.reduce((s, b) => s + b.bulkOrder, 0);

  const aggForCost = { per: {}, leads: plannedLeadsAll, verified: plannedLeadsAll * verifyRateEmail, booked: 0 };
  const costRows = includedTools(g).map((t: Tool) => ({ tool: t, cost: toolMonthlyCost(t, aggForCost, g.assumptions.personalization) }));
  const perScale: Record<string, FunnelResult> = {};
  if (g.channels.includes("email"))
    perScale.email = {
      leads: 0,
      outreaches: plannedLeadsAll * verifyRateEmail * ((g.assumptions.email.sendsPerLead as number) || 1),
      replies: 0,
      positive: 0,
      booked: 0,
      conversion: 0,
    };
  if (g.channels.includes("linkedin"))
    perScale.linkedin = { leads: 0, outreaches: 1, replies: 0, positive: 0, booked: 0, conversion: 0 };
  const infra = gpInfraRows(perScale, gs);
  const totalCostAll = costRows.reduce((s, r) => s + r.cost, 0) + infra.reduce((s, r) => s + r.cost, 0);
  const perBooking = g.targetBookings ? totalCostAll / g.targetBookings : 0;

  const otherIcps = (c?.icps || []).filter((i) => i.marketSize);
  const otherCh = (["email", "linkedin"] as const).find((ch) => !g.channels.includes(ch));

  return (
    <>
      <h1>Scaling Plan — {c?.name || ""}</h1>
      <div className="doc-sub">📈 Growth · {g.channels.map(chLabel).join(" · ")}</div>
      <Brief g={g} client={c} />
      <div className="callout">
        {N?.execSummary
          ? N.execSummary
          : "We already have a script that books calls. This plan scales it: add the niche pains, bulk-order leads, and run at the volume needed to hit the booking target."}
      </div>

      {g.winningScript && (
        <>
          <h2>The winning script</h2>
          <pre className="scriptbox">{g.winningScript.text}</pre>
          {g.winningScript.note && <p className="muted">{g.winningScript.note}</p>}
        </>
      )}
      {g.nicheSize && (
        <>
          <h2>The niche</h2>
          <p className="big-stat">{g.nicheSize}</p>
          <p>reachable prospects</p>
        </>
      )}

      {channelBlocks.map(({ ch, o, bookedPer, needContacted, bulkOrder }) => (
        <div key={ch}>
          <h2>{chLabel(ch)} — to hit {g.targetBookings} bookings/mo</h2>
          {!o.contacted || !o.booked ? (
            <p className="warn">Enter observed {chLabel(ch)} metrics on the left to compute this.</p>
          ) : (
            <table>
              <tbody>
                <tr>
                  <td>
                    Observed booking rate
                    <br />
                    <span className="rowdesc">Booked calls ÷ people contacted, from the real campaign — the rate we scale with.</span>
                  </td>
                  <td className="num">{gpPct(bookedPer)} of contacts</td>
                </tr>
                <tr>
                  <td>
                    Contacts needed / mo
                    <br />
                    <span className="rowdesc">People to reach at that booking rate to hit the target.</span>
                  </td>
                  <td className="num">{gpInt(needContacted)}</td>
                </tr>
                <tr>
                  <td className="tot">
                    Bulk lead order
                    <br />
                    <span className="rowdesc">Leads to buy: contacts ÷ verify rate, rounded up to the nearest 1,000.</span>
                  </td>
                  <td className="num tot">{gpInt(bulkOrder)} leads</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      ))}

      <h2>🧰 Cost to scale</h2>
      <table>
        <thead>
          <tr>
            <th>Line item</th>
            <th className="num">$/mo</th>
          </tr>
        </thead>
        <tbody>
          {costRows.map((r, i) => (
            <tr key={i}>
              <td>{r.tool.name}</td>
              <td className="num">{gpMoney(r.cost)}</td>
            </tr>
          ))}
          {infra.map((r, i) => (
            <tr key={`i${i}`}>
              <td>{r.name}</td>
              <td className="num">{gpMoney(r.cost)}</td>
            </tr>
          ))}
          <tr>
            <td className="tot">Total</td>
            <td className="num tot">{gpMoney(totalCostAll)}/mo</td>
          </tr>
        </tbody>
      </table>
      <div className="stat-row">
        <div className="s">
          <div className="lab">For</div>
          <div className="big-stat">{g.targetBookings}</div>
          <div className="lab">bookings / mo</div>
        </div>
        <div className="s">
          <div className="lab">Cost per booking</div>
          <div className="big-stat">{gpMoney(perBooking)}</div>
        </div>
      </div>

      <h2>Next steps</h2>
      <ul>
        <li>☐ Confirm the niche pains added to the script</li>
        <li>☐ Bulk order {gpInt(plannedLeadsAll)} leads</li>
        <li>☐ Run the script at the volume above</li>
      </ul>

      <h2>Scaling options</h2>
      <div className="opt-card">
        <div className="oc-title">⏫ Double the volume</div>
        <p>
          ~{gpInt(plannedLeadsAll * 2)} leads/mo → ~{g.targetBookings * 2} bookings at ~{gpMoney(totalCostAll * 2)}/mo.
        </p>
      </div>
      {!!otherIcps.length && (
        <div className="opt-card">
          <div className="oc-title">🎯 More niches</div>
          <p>
            Open a second front:{" "}
            {otherIcps
              .slice(0, 3)
              .map((i) => i.title + (i.marketSize ? ` (${i.marketSize})` : ""))
              .join(", ")}
            .
          </p>
        </div>
      )}
      {otherCh && (
        <div className="opt-card">
          <div className="oc-title">➕ Add {chLabel(otherCh)}</div>
          <p>Layer in {chLabel(otherCh)} to multiply touchpoints on the same accounts.</p>
        </div>
      )}

      <Followups g={g} client={c} />
      {g.toggles.pledge && (g.toggles.pledgeText || "").trim() && (
        <div className="callout pledge"><b>Our pledge:</b> {g.toggles.pledgeText}</div>
      )}
      {N?.closing && <p><i>{N.closing}</i></p>}
    </>
  );
}

/** The live document body (no edit chrome) — used both for display and as the Tiptap seed. */
export function DocContent({ g, client }: DocProps) {
  return g.mode === "strategy" ? <StrategyDoc g={g} client={client} /> : <GrowthDocBody g={g} client={client} />;
}
