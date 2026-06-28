// Client-detail growth / client / history sections (legacy v9Section :7305 / :7310 /
// :7330). The growth section lists saved plans and hands off to the standalone /growth
// builder (one growth builder, parameterised by client). The client section is the
// read-only profile + "Edit full profile" (opens the shared ClientEditor) + mechanism
// block. History is a derived, never-persisted feed.

"use client";

import { useState } from "react";
import Link from "next/link";
import { clientOffers, clientCaseStudies, clientPains, clientDesires } from "@/lib/sync/wizard";
import type { Client, Niche } from "@/lib/sync/types";
import { useConfigStore } from "@/lib/store/configStore";
import { Button, Card, Icon, EmptyState } from "@/components/ui";
import { ClientEditor } from "@/components/ClientEditor";
import { MechanismBlock } from "./MechanismBlock";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-3.5 flex flex-col gap-1.5">
      <div className="text-[13px] font-semibold">{title}</div>
      {children}
    </Card>
  );
}

function ListRows({ items }: { items: string[] }) {
  if (!items || !items.length) return <div className="text-xs text-muted">None yet.</div>;
  return (
    <>
      {items.map((x, i) => (
        <div key={i} className="text-[13px] inline-flex items-start gap-1.5"><Icon name="point" size={14} className="text-muted mt-0.5" /> <span>{x}</span></div>
      ))}
    </>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-[13px] py-1 border-b border-border last:border-0">
      <span className="text-muted shrink-0">{label}</span><span className="text-right max-w-[60%]">{value}</span>
    </div>
  );
}

// — Growth section (v9Section growth branch :7305) —
export function GrowthSection({ client }: { client: Client }) {
  const plans = (client.growthPlans as Array<{ title?: string; label?: string; name?: string; notionUrl?: string; createdAt?: string }> | undefined) || [];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-[14px] font-semibold">Growth plans</div>
        <Link href={`/growth?client=${client.id}`}>
          <Button variant="secondary" size="sm" icon="plus">New growth plan</Button>
        </Link>
      </div>
      {plans.length ? (
        <Card className="p-3.5 flex flex-col">
          {plans.map((p, i) => (
            <div key={i} className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0 text-[13px]">
              <span>{p.title || p.label || p.name || `Growth plan ${i + 1}`}</span>
              <span className="text-xs text-muted">
                {p.notionUrl && <a href={p.notionUrl} target="_blank" rel="noreferrer" className="text-accent2 hover:underline">Notion ↗</a>}
                {p.notionUrl && p.createdAt ? " · " : ""}{p.createdAt || ""}
              </span>
            </div>
          ))}
        </Card>
      ) : (
        <EmptyState icon="trending-up" title="No growth plans yet" description="Create one with the growth builder." />
      )}
    </div>
  );
}

// — Client section: read-only profile + Edit full profile + mechanism (v9Section :7310) —
export function ClientSection({ client, clientId }: { client: Client; clientId: string }) {
  const niches = (useConfigStore((s) => s.config.niches) as Niche[] | undefined) || [];
  const [editing, setEditing] = useState(false);
  const cs = (client.caseStudy as Record<string, string | undefined>) || {};
  const primaryNicheName = niches.find((n) => n.id === (client.nicheIds || [])[0])?.name || "—";
  const guarantees = ((client.guarantees as Array<{ text?: string } | string> | undefined) || []).map((g) => (typeof g === "string" ? g : g.text || "")).filter(Boolean);
  const competitors = (client.competitorIntel as Array<{ name?: string; offer?: string }> | undefined) || [];
  const avoid = (client.avoid as string[] | undefined) || [];
  const website = (client.website as string | undefined) || "";

  return (
    <div className="flex flex-col gap-3">
      {editing && <ClientEditor clientId={clientId} onClose={() => setEditing(false)} />}
      <div className="flex items-center justify-between">
        <div className="text-[14px] font-semibold">Client profile</div>
        <Button variant="secondary" size="sm" icon="edit" onClick={() => setEditing(true)}>Edit full profile</Button>
      </div>

      <Section title="Details">
        <KV label="Name" value={client.name} />
        <KV label="Meta" value={client.meta || "—"} />
        <KV label="Website" value={website ? <a href={`https://${website.replace(/^https?:\/\//, "")}`} target="_blank" rel="noreferrer" className="text-accent2 hover:underline">{website}</a> : "—"} />
        <KV label="Niche" value={primaryNicheName} />
      </Section>

      <Section title="Case study">
        <KV label="Size" value={cs.size || "—"} />
        <KV label="Result" value={cs.result || "—"} />
        <KV label="Mechanism" value={cs.mechanism || "—"} />
        {cs.proofLine && <KV label="Proof line" value={cs.proofLine} />}
      </Section>

      <Card className="p-3.5"><MechanismBlock client={client} clientId={clientId} /></Card>

      <Section title="Offer"><ListRows items={clientOffers(client)} /></Section>
      <Section title="Case studies"><ListRows items={clientCaseStudies(client)} /></Section>
      <Section title="Pains"><ListRows items={clientPains(client)} /></Section>
      <Section title="Objections"><ListRows items={(cs.objections as unknown as string[]) || []} /></Section>
      <Section title="Desires"><ListRows items={clientDesires(client)} /></Section>
      {guarantees.length > 0 && <Section title="Guarantees"><ListRows items={guarantees} /></Section>}
      {competitors.length > 0 && (
        <Section title="Competitors">
          {competitors.map((x, i) => (
            <div key={i} className="text-[13px] inline-flex items-start gap-1.5"><Icon name="point" size={14} className="text-muted mt-0.5" /> <span><b>{x.name || ""}</b>{x.offer ? ` — ${x.offer}` : ""}</span></div>
          ))}
        </Section>
      )}
      {avoid.length > 0 && <Section title="Avoid / exclusions"><ListRows items={avoid} /></Section>}
    </div>
  );
}

// — History section (derived, never persisted — v9Section :7330) —
export function HistorySection({ client }: { client: Client }) {
  const hist: Array<{ d: string; t: string }> = [];
  ((client.scriptReservoir as Array<{ savedAt?: string; framework?: string }> | undefined) || []).forEach((s) => {
    hist.push({ d: s.savedAt || "", t: "Saved script · " + (s.framework || "") });
  });
  ((client.growthPlans as Array<{ createdAt?: string }> | undefined) || []).forEach((p, i) => {
    hist.push({ d: p.createdAt || "", t: "Growth plan " + (i + 1) });
  });
  hist.sort((a, b) => (b.d || "").localeCompare(a.d || ""));
  return (
    <div className="flex flex-col gap-3">
      <div className="text-[14px] font-semibold">History</div>
      {hist.length ? (
        <Card className="p-3.5 flex flex-col">
          {hist.map((h, i) => (
            <div key={i} className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0 text-[13px]">
              <span>{h.t}</span><span className="text-xs text-muted">{h.d}</span>
            </div>
          ))}
        </Card>
      ) : (
        <div className="text-xs text-muted">No history yet.</div>
      )}
    </div>
  );
}
