// AppShell — the app frame (legacy header :740 + showScreen :1869 + loadConfigAndRender
// :6997). Runs the one-time boot() reconciliation, gates render on `booted`, shows the
// LoginModal until signed in, and renders the top nav + save-status pill above the routed
// screen. The legacy hash router is gone — nav items are real <Link>s.

"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConfigStore } from "@/lib/store/configStore";
import { storedUser, signOut } from "@/lib/sync/authClient";
import { Pill, Spinner, Icon, cn } from "@/components/ui";
import { LoginModal } from "./LoginModal";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Extra path prefixes that should mark this item active. */
  match?: string[];
  muted?: boolean;
}

const NAV: NavItem[] = [
  { href: "/clients", label: "Clients", icon: "layout-grid", match: ["/client/"] },
  { href: "/growth", label: "Growth", icon: "trending-up" },
  { href: "/sales", label: "Sales", icon: "target" },
  { href: "/admin", label: "Admin", icon: "adjustments-horizontal" },
  { href: "/build", label: "Build", icon: "flask", muted: true },
];

function SavePill() {
  const pill = useConfigStore((s) => s.pill);
  const loggedIn = useConfigStore((s) => s.loggedIn);
  if (!loggedIn) return <Pill tone="muted">Local only</Pill>;
  switch (pill) {
    case "saving":
      return <Pill tone="amber" pulse>Saving…</Pill>;
    case "error":
      return <Pill tone="red">Save failed</Pill>;
    case "local":
      return <Pill tone="muted">Local only</Pill>;
    case "server":
    default:
      return <Pill tone="green">Saved</Pill>;
  }
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const booted = useConfigStore((s) => s.booted);
  const loggedIn = useConfigStore((s) => s.loggedIn);
  const pathname = usePathname();

  // One-time boot reconciliation (load local + server, migrate, pick winner).
  useEffect(() => {
    void useConfigStore.getState().boot();
  }, []);

  const user = typeof window !== "undefined" ? storedUser() : null;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <header className="flex items-center justify-between px-5 h-[54px] shrink-0 bg-bg2 border-b border-border">
        <div className="flex items-center gap-3.5">
          <Link href="/clients" className="font-mono text-lg font-bold tracking-tight no-underline text-text">
            outreach<span className="text-accent2">.bot</span>
          </Link>
          <nav className="inline-flex gap-1 bg-bg3 p-1 rounded-[9px]">
            {NAV.map((it) => {
              const active =
                pathname === it.href ||
                pathname.startsWith(it.href + "/") ||
                (it.match || []).some((m) => pathname.startsWith(m));
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[13px] font-medium no-underline border transition-colors duration-150",
                    active
                      ? "bg-bg2 text-text border-border"
                      : cn("bg-transparent border-transparent hover:text-text", it.muted ? "text-muted/70" : "text-muted"),
                  )}
                >
                  <Icon name={it.icon} size={15} />
                  {it.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <SavePill />
          {loggedIn && (
            <button
              type="button"
              onClick={() => {
                signOut();
                location.reload();
              }}
              title={user?.email || "Sign out"}
              className="inline-flex items-center gap-1.5 text-[11px] text-muted hover:text-text px-2.5 py-1 rounded-md border border-border hover:border-accent cursor-pointer"
            >
              <Icon name="id-badge-2" size={14} />
              {user?.name || user?.email?.split("@")[0] || "Sign out"}
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        {booted ? (
          children
        ) : (
          <div className="h-full flex items-center justify-center">
            <Spinner size="lg" />
          </div>
        )}
      </main>

      <LoginModal open={booted && !loggedIn} />
    </div>
  );
}
