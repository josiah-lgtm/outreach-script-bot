// Client detail. The section nav (overview/niche/growth/client/history) + the lens
// convention (setActiveClientForLens on open) are wired. All five sections are built:
// overview = KanbanBoard + context cards + MechanismBlock; niche = NicheSection (ICP/niche
// editors + add flow); growth = saved plans → /growth builder; client = read-only profile
// + Edit-full-profile (ClientEditor) + mechanism; history = derived feed. Legacy: v9Detail
// :7225 / v9Section :7282.

"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { useConfigStore } from "@/lib/store/configStore";
import type { Client, Niche } from "@/lib/sync/types";
import { Avatar, Icon, EmptyState, cn } from "@/components/ui";
import { KanbanBoard } from "@/components/board/KanbanBoard";
import { MechanismBlock } from "@/components/client/MechanismBlock";
import { NicheSection } from "@/components/client/NicheSection";
import { GrowthSection, ClientSection, HistorySection } from "@/components/client/sections";

const SECTIONS = [
  { value: "overview", label: "Overview", icon: "layout-dashboard" },
  { value: "niche", label: "ICP", icon: "crosshair" },
  { value: "growth", label: "Growth", icon: "trending-up" },
  { value: "client", label: "Client", icon: "id-badge-2" },
  { value: "history", label: "History", icon: "history" },
] as const;

export default function ClientDetailPage() {
  const params = useParams<{ id: string; sec: string }>();
  const id = params.id;
  const sec = params.sec || "overview";
  const client = useConfigStore((s) => (s.config.clients || []).find((c: Client) => c.id === id)) as
    | Client
    | undefined;

  // Keep the research-backed lens pointed at this client while the detail is open.
  useEffect(() => {
    useConfigStore.getState().setActiveClientForLens(id);
    return () => useConfigStore.getState().setActiveClientForLens(null);
  }, [id]);

  if (!client) {
    return (
      <div className="h-full">
        <EmptyState
          icon="alert-triangle"
          title="Client not found"
          description="It may have been removed."
          action={
            <Link href="/clients" className="text-accent2 text-[13px] hover:underline">
              ← Back to clients
            </Link>
          }
        />
      </div>
    );
  }

  const active = SECTIONS.find((s) => s.value === sec) ?? SECTIONS[0];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1100px] mx-auto px-6 py-6">
        <Link href="/clients" className="inline-flex items-center gap-1.5 text-muted hover:text-text text-[13px] mb-4">
          <Icon name="arrow-left" size={15} /> Clients
        </Link>

        <div className="flex items-center gap-3 mb-5">
          <Avatar name={client.name} size="lg" />
          <div>
            <div className="text-[18px] font-semibold leading-tight">{client.name}</div>
            {client.meta && <div className="text-xs text-muted mt-0.5">{client.meta}</div>}
          </div>
        </div>

        <div className="grid [grid-template-columns:180px_1fr] gap-5 items-start max-md:grid-cols-1">
          <nav className="flex flex-col gap-1.5">
            {SECTIONS.map((s) => {
              const on = s.value === active.value;
              return (
                <Link
                  key={s.value}
                  href={`/client/${id}/${s.value}`}
                  className={cn(
                    "flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[14px] no-underline transition-colors duration-150",
                    on ? "bg-bg3 text-text" : "text-muted hover:text-text hover:bg-bg3",
                  )}
                >
                  <Icon name={s.icon} size={16} />
                  {s.label}
                </Link>
              );
            })}
          </nav>
          <div className="min-h-[300px]">
            {active.value === "overview" && <OverviewSection client={client} clientId={id} />}
            {active.value === "niche" && <NicheSection client={client} clientId={id} />}
            {active.value === "growth" && <GrowthSection client={client} />}
            {active.value === "client" && <ClientSection client={client} clientId={id} />}
            {active.value === "history" && <HistorySection client={client} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function OverviewSection({ client, clientId }: { client: Client; clientId: string }) {
  const niches = useConfigStore((s) => s.config.niches) as Niche[] | undefined;
  const primaryNicheId = (client.nicheIds || [])[0];
  const niche = (niches || []).find((n) => n.id === primaryNicheId);
  const followups = (client.followups as Array<{ parentLabel?: string; items?: unknown[] }>) || [];
  const caseStudy = (client.caseStudy as { result?: string } | undefined) || {};

  return (
    <div className="flex flex-col gap-5">
      <KanbanBoard client={client} clientId={clientId} />

      <Card title="ICP they're targeting">
        {niche ? (
          <>
            <div className="text-[14px] font-semibold">{niche.name}</div>
            <div className="text-xs text-muted mt-0.5">
              {((niche.angles as string[]) || []).slice(0, 4).join(" · ") || "—"}
            </div>
          </>
        ) : (
          <div className="text-[13px] text-muted">No ICP set.</div>
        )}
      </Card>

      <Card title="Follow-ups">
        {followups.length ? (
          <div className="flex flex-col">
            {followups.map((s, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0 text-[14px]"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="arrow-forward-up" size={14} className="text-muted" /> {s.parentLabel || "sequence"}
                </span>
                <span className="text-xs text-muted">{s.items ? s.items.length : 0} steps</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[13px] text-muted">No follow-ups yet.</div>
        )}
      </Card>

      <div className="bg-bg2 border border-border rounded-xl p-4">
        <MechanismBlock client={client} clientId={clientId} />
      </div>

      <Card title="Client">
        <div className="text-xs text-muted">
          {[client.meta, caseStudy.result, client.website].filter(Boolean).join(" · ") || "—"}
        </div>
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-bg2 border border-border rounded-xl p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">{title}</div>
      {children}
    </div>
  );
}
