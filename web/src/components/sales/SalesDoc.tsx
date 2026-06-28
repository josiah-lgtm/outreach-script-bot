// The right pane — the live PERSONALISED prospect pitch document + "Export to Notion".
// Faithful JSX port of the legacy prospectDocHtml (:5896); the Notion export reuses the
// decoupled buildProspectDocBlocks(:5993 port) from notion-blocks.ts so the on-screen doc
// matches the export. Reuses the growth `.gp-doc` styling (DocStyles) so the look is shared
// with the growth doc without touching globals.css. mode='sales' on the working state is
// implied — the doc is driven entirely by the prospect record + sellerProfile + planDefaults.

"use client";

import { useState } from "react";
import { Button, Spinner, EmptyState } from "@/components/ui";
import { api } from "@/lib/sync/api";
import { getAdminKey } from "@/lib/sync/adminKey";
import { notify } from "@/lib/notify";
import { useConfigStore } from "@/lib/store/configStore";
import {
  useGrowthStore,
  prospectChosenIcps,
  logoUrl,
  type Prospect,
} from "@/lib/store/growthStore";
import { DEFAULT_SALES_DOC } from "@/lib/sync/configClient";
import { buildProspectDocBlocks, type Prospect as BlockProspect } from "@/lib/sync/notion-blocks";
import { computeReverse, gpInt, gpMoney, type Channel } from "@/lib/funnel-math";
import { DocStyles } from "@/components/growth/docStyles";
import type { SaConfig, SellerProfile, SpSalesDoc } from "./types";

// ── salesProgramSteps (legacy :5877) ─────────────────────────────────────────────
function salesProgramSteps(sp: SellerProfile, channels: string[]) {
  const ch =
    channels.includes("linkedin") && channels.includes("email")
      ? "email and LinkedIn"
      : channels.includes("linkedin")
        ? "LinkedIn"
        : "email";
  const find = sp.howWeFindLeads || "";
  const qual = sp.howWeQualify || "";
  const chanLine =
    channels.includes("linkedin") && !channels.includes("email")
      ? "We run everything through LinkedIn, sending connection requests and messages for you every day."
      : channels.includes("email") && !channels.includes("linkedin")
        ? "We set up your inboxes and sending tools, then send your emails automatically every day."
        : "We run both email and LinkedIn, sending automatically every day across both.";
  return { ch, find, qual, chanLine };
}

// ── salesHeading (legacy :1581) ──────────────────────────────────────────────────
function makeHeading(sp: SellerProfile, p: Prospect) {
  const sd: SpSalesDoc = sp.salesDoc || DEFAULT_SALES_DOC;
  return (key: string): string =>
    String(sd.headings?.[key] || DEFAULT_SALES_DOC.headings[key] || "").replaceAll(
      "{client}",
      p?.name || "you",
    );
}

interface SalesDocProps {
  prospect: Prospect | null;
}

export function SalesDoc({ prospect: p }: SalesDocProps) {
  const cfg = useConfigStore((s) => s.config) as SaConfig;
  const updateProspect = useGrowthStore((s) => s.updateProspect);
  const [exporting, setExporting] = useState(false);

  if (!p) {
    return (
      <div className="flex flex-col h-full">
        <DocStyles />
        <div className="flex-1 grid place-items-center p-6">
          <EmptyState
            icon="world-search"
            title="Paste a prospect's website on the left"
            description="The full personalised pitch builds itself here."
          />
        </div>
      </div>
    );
  }

  const sp: SellerProfile = cfg.sellerProfile || {};
  const sd: SpSalesDoc = sp.salesDoc || DEFAULT_SALES_DOC;
  const show = sd.show || {};
  const pd = cfg.settings?.planDefaults || {};
  const N = p.narrative;
  const T = +(p.targetBookings as number) || 10;
  const channels = p.channels || ["email"];
  const primary = (channels[0] || "email") as Channel;
  const prog = salesProgramSteps(sp, channels);
  const heading = makeHeading(sp, p);
  const chosenIcps = prospectChosenIcps(p);
  const m = computeReverse(primary, pd[primary] || {}, T);
  const prospectLogo = logoUrl(p.website);

  // ── export to Notion (legacy prospectExportNotion :6872) ──
  async function exportNotion() {
    if (!getAdminKey()) { notify("Sign in first", true); return; }
    if (!p) return;
    setExporting(true);
    notify("Exporting to Notion…");
    try {
      const r = await api({
        action: "export_notion",
        parentId: cfg.settings?.notionParentId,
        title: `Growth Plan for ${p.name} — ${new Date().toISOString().slice(0, 10)}`,
        blocks: buildProspectDocBlocks({
          prospect: p as BlockProspect,
          sellerProfile: sp,
          planDefaults: pd,
          heading,
          channelSummary: prog.ch,
          channelLine: prog.chanLine,
          logoUrl,
        }),
      });
      updateProspect(p.id, (pp) => { pp.notionUrl = r.url || ""; });
      notify(r.warning ? "⚠️ Exported, but truncated: " + r.warning : "✅ Exported to Notion", !!r.warning);
      if (r.url) window.open(r.url, "_blank");
    } catch (e) {
      notify("Notion export failed: " + (e as Error).message, true);
    }
    setExporting(false);
  }

  return (
    <div className="flex flex-col h-full">
      <DocStyles />
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <div className="flex-1" />
        <Button size="sm" variant="primary" icon="brand-notion" onClick={exportNotion} disabled={exporting}>
          {exporting ? <Spinner size="sm" /> : "Export to Notion"}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="gp-doc">
          {/* Header with prospect logo */}
          <div className="flex items-center gap-3.5 mb-1.5">
            {prospectLogo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={prospectLogo}
                alt=""
                style={{ height: 40, width: 40, borderRadius: 8, objectFit: "contain", background: "#fff" }}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            )}
            <h1 style={{ margin: 0 }}>Growth Plan for {p.name || "your business"}</h1>
          </div>
          <div className="doc-sub">Prepared by {sp.name || "us"} · {prog.ch}</div>

          {show.intro &&
            (N?.intro ? (
              <div className="callout">{N.intro}</div>
            ) : (
              <p className="warn">Click “Redraft narrative” on the left to personalise the opening for {p.name || "this prospect"}.</p>
            ))}

          {show.brief && <Brief p={p} heading={heading("brief")} icps={chosenIcps} />}

          {show.how && (
            <>
              <h2>{heading("how")}</h2>
              <p>{prog.chanLine}</p>
              <h3>How we find your leads</h3>
              <p>{prog.find}</p>
              <h3>How we keep them qualified</h3>
              <p>{prog.qual}</p>
              {(sp.process || []).map((ph, i) => (
                <div key={i}>
                  <h3>{ph.phase}</h3>
                  <ul>{(ph.items || []).map((it, j) => <li key={j}>{it}</li>)}</ul>
                </div>
              ))}
            </>
          )}

          {show.expect && (
            <>
              <h2>{heading("expect")}</h2>
              {N?.expectations && <p>{N.expectations}</p>}
              <p>
                To book around <b>{gpInt(T)}</b> calls a month, we send about{" "}
                <b>{gpInt(m.outreaches || m.connects || 0)}</b> messages to roughly <b>{gpInt(m.leads)}</b> of your
                ideal buyers. You only talk to the ones who put their hand up.
              </p>
            </>
          )}

          {!!(p.sampleScripts || []).length && (
            <>
              <h2>What your messages could look like</h2>
              <p>Real drafts written for your buyers. We sharpen these together before anything goes out.</p>
              {p.sampleScripts!.map((s, i) => (
                <div key={i}>
                  {s.label && <h3>{s.label}</h3>}
                  <pre className="scriptbox">{s.text}</pre>
                </div>
              ))}
            </>
          )}

          {show.who && (
            <>
              <h2>{heading("who")}</h2>
              {sp.logo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={sp.logo}
                  alt=""
                  style={{ height: 34, marginBottom: 8 }}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                />
              )}
              {sp.whoWeAre && <p>{sp.whoWeAre}</p>}
              {sp.trackRecord && <p><b>{sp.trackRecord}</b></p>}
              {!!(sp.whyDifferent || []).length && (
                <>
                  <h3>Why we are different</h3>
                  <ul>{sp.whyDifferent!.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </>
              )}
              {!!(sp.caseStudies || []).length && (
                <>
                  <h3>Recent wins</h3>
                  <ul>
                    {sp.caseStudies!.map((cs, i) => (
                      <li key={i}>
                        {cs.name} {cs.result}
                        {cs.link && (
                          <> — <a href={cs.link} target="_blank" rel="noreferrer" style={{ color: "var(--accent2)" }}>watch</a></>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {!!(sp.socialLinks || []).length && (
                <p>
                  {sp.socialLinks!.map((s, i) => (
                    <a key={i} href={s.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent2)", marginRight: 12 }}>
                      {s.label || s.url}
                    </a>
                  ))}
                </p>
              )}
            </>
          )}

          {show.included && (
            <>
              <h2>{heading("included")}</h2>
              <ul>{(sp.deliverables || []).map((d, i) => <li key={i}>{d}</li>)}</ul>
              {sp.guarantee && <div className="callout pledge"><b>Our promise:</b> {sp.guarantee}</div>}
            </>
          )}

          {show.investment && (
            <>
              <h2>{heading("investment")}</h2>
              <p className="big-stat">{gpMoney(sp.programCost || 0)}</p>
              <p>{sp.costNote || ""}</p>
            </>
          )}

          {(sd.custom || []).map((cs2, i) => {
            if (!cs2.heading && !cs2.body) return null;
            return (
              <div key={i}>
                {cs2.heading && <h2>{String(cs2.heading).replaceAll("{client}", p.name || "you")}</h2>}
                {String(cs2.body || "")
                  .split(/\n+/)
                  .filter(Boolean)
                  .map((para, j) => <p key={j}>{para.replaceAll("{client}", p.name || "you")}</p>)}
              </div>
            );
          })}

          {show.next && (
            <>
              <h2>{heading("next")}</h2>
              {N?.closing && <p>{N.closing}</p>}
              <ul>
                <li>Book a quick call with {(sp.founder || "").split(",")[0] || sp.name || "us"}</li>
                <li>We walk you through this plan and answer anything</li>
                <li>If it is a fit we start, if not you keep the plan for free</li>
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── brief (legacy gpBriefHtml :5611, prospect-targeted ICPs) ─────────────────────
function Brief({ p, heading, icps }: { p: Prospect; heading: string; icps: ReturnType<typeof prospectChosenIcps> }) {
  const b = p.brief;
  if (!b) {
    return (
      <p className="muted" style={{ fontSize: 12 }}>
        🧾 Build the client brief (left panel) to open the plan with {p.name || "the client"}&apos;s services,
        positioning, case studies and competitors.
      </p>
    );
  }
  const withExample = icps.filter((i) => i.example);
  return (
    <>
      <h2>{heading || `About ${p.name}`}</h2>
      {b.positioning && <p>{b.positioning}</p>}
      {!!b.services?.length && (<><h3>Services</h3><ul>{b.services.map((s, i) => <li key={i}>{s}</li>)}</ul></>)}
      {!!b.caseStudies?.length && (<><h3>Case studies</h3><ul>{b.caseStudies.map((s, i) => <li key={i}>{s}</li>)}</ul></>)}
      {!!b.competitors?.length && (<><h3>Competitors</h3><ul>{b.competitors.map((s, i) => <li key={i}>{s}</li>)}</ul></>)}
      {!!withExample.length && (
        <>
          <h3>Who we will target, with a real example</h3>
          {withExample.map((i, k) => (
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
