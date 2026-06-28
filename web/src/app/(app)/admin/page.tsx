// Admin console — the 11-tab shell (legacy renderAdmin :3125 / adminTabHtml :3155).
// The hash router is gone; the active tab is a query param (?tab=…) so deep-links like
// /admin?tab=clients work, read once on mount to avoid the useSearchParams prerender
// constraint. Each tab is its own component under @/components/admin. Mutations all flow
// through the config store; this page only owns tab selection + the admin-key gate notice.

"use client";

import { useEffect, useState } from "react";
import { useConfigStore } from "@/lib/store/configStore";
import { Tabs, Card, Icon, type TabItem } from "@/components/ui";
import { FrameworksTab } from "@/components/admin/FrameworksTab";
import { WinningTab } from "@/components/admin/WinningTab";
import { NichesTab } from "@/components/admin/NichesTab";
import { ClientsTab } from "@/components/admin/ClientsTab";
import { FollowupsTab } from "@/components/admin/FollowupsTab";
import { AgencyTab } from "@/components/admin/AgencyTab";
import { ToolsTab } from "@/components/admin/ToolsTab";
import { SystemFilterTab } from "@/components/admin/SystemFilterTab";
import { BuilderButtonsTab } from "@/components/admin/BuilderButtonsTab";
import { UsageTab } from "@/components/admin/UsageTab";
import { SettingsTab } from "@/components/admin/SettingsTab";

type Tab =
  | "frameworks" | "winning" | "niches" | "clients" | "followups"
  | "agency" | "tools" | "systemfilter" | "builderbtns" | "usage" | "settings";

const TABS: TabItem<Tab>[] = [
  { value: "frameworks", label: "Frameworks", icon: "file-text" },
  { value: "winning", label: "Winning", icon: "trophy" },
  { value: "niches", label: "Niches", icon: "crosshair" },
  { value: "clients", label: "Clients", icon: "id-badge-2" },
  { value: "followups", label: "Follow-ups", icon: "arrow-forward-up" },
  { value: "agency", label: "Our agency", icon: "bolt" },
  { value: "tools", label: "Tools KB", icon: "plug" },
  { value: "systemfilter", label: "System filter", icon: "filter" },
  { value: "builderbtns", label: "Builder buttons", icon: "wand" },
  { value: "usage", label: "Usage", icon: "trending-up" },
  { value: "settings", label: "Settings", icon: "adjustments-horizontal" },
];

const VALID = new Set(TABS.map((t) => t.value));

export default function AdminPage() {
  const loggedIn = useConfigStore((s) => s.loggedIn);
  const [tab, setTab] = useState<Tab>("frameworks");

  // Deep-link: read ?tab= once on mount. A one-time URL→state sync is exactly what an
  // effect is for; the lint rule's synchronous-setState concern doesn't apply to a
  // mount-only read, so it's scoped-disabled here.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (t && VALID.has(t as Tab)) setTab(t as Tab);
  }, []);

  function selectTab(t: Tab) {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url.toString());
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1100px] mx-auto px-6 py-6">
        <h1 className="text-lg font-semibold mb-4">Admin</h1>

        {!loggedIn && (
          <Card className="p-3.5 mb-4 flex items-start gap-2.5 border-amber/40">
            <Icon name="alert-triangle" size={18} className="text-amber shrink-0 mt-0.5" />
            <div className="text-[13px] text-muted">
              <b className="text-text">Admin key required for server sync + AI generation.</b> Changes save to this
              browser either way. Sign in (or open with <code className="text-text">?admin=YOUR_KEY</code>) to sync to
              the server and run AI actions.
            </div>
          </Card>
        )}

        <div className="mb-5 border-b border-border pb-3">
          <Tabs items={TABS} value={tab} onChange={selectTab} variant="soft" />
        </div>

        {tab === "frameworks" && <FrameworksTab />}
        {tab === "winning" && <WinningTab />}
        {tab === "niches" && <NichesTab />}
        {tab === "clients" && <ClientsTab />}
        {tab === "followups" && <FollowupsTab />}
        {tab === "agency" && <AgencyTab />}
        {tab === "tools" && <ToolsTab />}
        {tab === "systemfilter" && <SystemFilterTab />}
        {tab === "builderbtns" && <BuilderButtonsTab />}
        {tab === "usage" && <UsageTab />}
        {tab === "settings" && <SettingsTab />}
      </div>
    </div>
  );
}
