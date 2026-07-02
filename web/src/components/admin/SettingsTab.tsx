// Admin → Settings tab. Port of the legacy adminSettings() screen (index.html:4682-4910)
// plus resetConfig (:4911) and the team-management handlers loadTeamUsers (:6941),
// addTeamUser (:6953), removeTeamUser (:6967).
//
// LOAD-BEARING:
//  • Backup BEFORE restore/import (legacy backed the discarded copy up implicitly via
//    loadConfig; here we snapshot the live config before replacing it).
//  • The danger-zone Import (the legacy importConfig at :4898) requires frameworks AND
//    niches AND clients all present — STRICTER than configClient.importConfigText (which
//    only checks `frameworks`). We replicate the legacy guard here.
//  • After restore/import we set a brand-new config object, so we run migrateConfig from
//    configClient BEFORE handing it to restoreConfig(cfg,"local") — which marks it _dirty and
//    aligns _rev so the CAS save REPLACES the server copy (never silently adopts the server).
//  • users_* response shapes (server/auth.ts): list → {users:[{email,name,createdAt}]},
//    add → {ok,updated:boolean}, remove → {ok:true}.

"use client";

import { useEffect, useRef, useState } from "react";
import {
  Button, Card, CardBody, Input, NumberInput, Textarea, FormField, Grid2, Icon, Badge,
  EmptyState, Hint, cn,
} from "@/components/ui";
import { useConfigStore } from "@/lib/store/configStore";
import { notify } from "@/lib/notify";
import { api } from "@/lib/sync/api";
import { safeStorageGet, getAdminKey } from "@/lib/sync/adminKey";
import {
  listBackups, restoreBackup, exportConfig, importConfigText, backupConfig, migrateConfig,
  DEFAULT_CONFIG,
} from "@/lib/sync/configClient";
import type { Config } from "@/lib/sync/types";

// Rate keys are stored as decimals (0.04) but shown/edited as percentages (4). Verbatim
// from the legacy PD_RATE_KEYS set (index.html:4881).
const PD_RATE_KEYS = new Set(["verifyRate", "replyRate", "positiveRate", "bookRate", "acceptRate"]);
const EMAIL_KEYS = ["leadsPerMonth", "verifyRate", "sendsPerLead", "replyRate", "positiveRate", "bookRate"];
const LINKEDIN_KEYS = ["connectsPerDay", "daysPerMonth", "acceptRate", "replyRate", "positiveRate", "bookRate"];

// Accept a Notion page/db URL or a raw id; store the 32-char id (legacy saveNotionParent/
// saveNotionBoardDb regex, index.html:4831/4841).
function extractNotionId(raw: string): string {
  const v = (raw || "").trim();
  if (!v) return "";
  const m = v.match(/[0-9a-f]{32}/i) || v.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return (m ? m[0] : v).replace(/-/g, "");
}

interface TeamUser { email: string; name: string; createdAt?: string }

// The team-login server responses (server/auth.ts): list → {users}, add → {updated}.
interface UsersListResponse { users?: TeamUser[] }
interface UsersAddResponse { updated?: boolean }
// create_notion_db → {id, url}.
interface NotionDbResponse { id?: string; url?: string }

// A backup-ring snapshot as returned by listBackups()/restoreBackup() in configClient.
interface BackupEntry { key: string; at?: string; tag?: string; clients: number; config: Config }

// cfg.settings.planDefaults — the funnel + personalization assumptions. The channel maps are
// open string→number records (legacy indexed them by key); personalization carries the two
// token counts (plus other fields we don't edit here).
interface PlanDefaults {
  email: Record<string, number>;
  linkedin: Record<string, number>;
  personalization: { inputTokensPerLead: number; outputTokensPerLead: number; [k: string]: unknown };
  [k: string]: unknown;
}

export function SettingsTab() {
  // ── Config reads (selectors; never mutate these directly) ──
  const clientsCount = useConfigStore((s) => (s.config.clients || []).length);
  const source = useConfigStore((s) => s.source);
  const globalRules = useConfigStore((s) => s.config.settings?.globalRules ?? "");
  const growthRules = useConfigStore((s) => s.config.settings?.growthRules ?? "");
  const notionParentId = useConfigStore((s) => s.config.settings?.notionParentId ?? "");
  const notionBoardDbId = useConfigStore((s) => s.config.settings?.notionBoardDbId ?? "");
  const notionBoardParent = useConfigStore((s) => s.config.settings?.notionBoardParent ?? "");
  const notionBoardName = useConfigStore((s) => s.config.settings?.notionBoardName ?? "clients script testing board");
  const planDefaults = useConfigStore((s) => s.config.settings?.planDefaults) as PlanDefaults | undefined;

  // Signed-in user (localStorage key "outreach_user"). safeStorageGet handles SSR/quota.
  const me = (() => {
    try { return JSON.parse(safeStorageGet("outreach_user") || "null"); } catch { return null; }
  })();
  const adminKey = getAdminKey();

  // Snapshots refresh on demand (listBackups reads localStorage, not the store). The mount
  // read is deferred past a microtask so it doesn't run setState synchronously in the effect
  // body (react-hooks/set-state-in-effect).
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => { if (alive) setBackups(listBackups() as BackupEntry[]); });
    return () => { alive = false; };
  }, []);
  const refreshBackups = () => setBackups(listBackups() as BackupEntry[]);

  // ── Team logins ──
  const [users, setUsers] = useState<TeamUser[] | null>(null);
  const [usersError, setUsersError] = useState("");
  const [tuName, setTuName] = useState("");
  const [tuEmail, setTuEmail] = useState("");
  const [tuPassword, setTuPassword] = useState("");
  const [tuBusy, setTuBusy] = useState(false);

  // Fetch the team-login list, for the add/remove handlers' refresh (event handlers are not
  // flagged by react-hooks/set-state-in-effect). The mount fetch is inlined in the effect
  // below so its setState only runs after an await.
  async function loadTeamUsers() {
    if (!getAdminKey()) { setUsers([]); setUsersError("Sign in first."); return; }
    try {
      const r = (await api({ action: "users_list" })) as UsersListResponse;
      setUsers(r.users || []); setUsersError("");
    } catch (e) {
      setUsers([]); setUsersError((e as Error)?.message || "Failed to load logins");
    }
  }

  // Mount fetch: inline async loader, setState only AFTER the await, cancelled on unmount.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!getAdminKey()) {
        await Promise.resolve();
        if (alive) { setUsers([]); setUsersError("Sign in first."); }
        return;
      }
      try {
        const r = (await api({ action: "users_list" })) as UsersListResponse;
        if (alive) { setUsers(r.users || []); setUsersError(""); }
      } catch (e) {
        if (alive) { setUsers([]); setUsersError((e as Error)?.message || "Failed to load logins"); }
      }
    })();
    return () => { alive = false; };
  }, []);

  async function addTeamUser() {
    const name = tuName.trim();
    const email = tuEmail.trim();
    const password = tuPassword;
    if (!email || !password) return notify("Email and password required", true);
    if (password.length < 8) return notify("Password must be at least 8 characters", true);
    setTuBusy(true);
    try {
      const r = (await api({ action: "users_add", name, email, password })) as UsersAddResponse;
      notify(r.updated ? "Login updated" : "Login created");
      setTuPassword("");
      await loadTeamUsers();
    } catch (e) {
      notify("Failed: " + ((e as Error)?.message || ""), true);
    } finally {
      setTuBusy(false);
    }
  }

  async function removeTeamUser(email: string) {
    if (!window.confirm("Remove the login for " + email + "?")) return;
    try {
      await api({ action: "users_remove", email });
      notify("Login removed");
      await loadTeamUsers();
    } catch (e) {
      notify("Failed: " + ((e as Error)?.message || ""), true);
    }
  }

  // ── Backup / restore → store replacement ──
  // Snapshot the live config first (legacy always backed up the discarded copy), migrate the
  // incoming object (it's brand-new, so migrateConfig hasn't run on it), then replace + resave.
  function applyRestoredConfig(cfg: Config, tag: string) {
    const live = useConfigStore.getState().config;
    backupConfig(live, tag);
    try { migrateConfig(cfg); } catch { /* ignore */ }
    // restoreConfig (NOT replaceConfig + scheduleResave): marks the restore as a winning local
    // edit and aligns _rev so it cleanly REPLACES the server copy. The old pair did a non-dirty
    // resave, which on a server-rev conflict silently ADOPTED the server copy and discarded the
    // just-restored clients — the reason a restore never reached the server.
    useConfigStore.getState().restoreConfig(cfg, "local");
    refreshBackups();
  }

  function onRestoreSnapshot(key: string) {
    if (!window.confirm("Restore this snapshot? Your current config will be replaced (a backup is kept).")) return;
    const cfg = restoreBackup(key);
    if (!cfg) return notify("Couldn't read that snapshot", true);
    applyRestoredConfig(cfg, "before-restore-snapshot");
    notify("Snapshot restored");
  }

  // Backup & restore card's file import: mirrors importConfigFile — accepts any backup that
  // parses with a frameworks array (the lenient configClient.importConfigText guard).
  const restoreFileRef = useRef<HTMLInputElement | null>(null);
  function onRestoreFile(file: File | undefined | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const cfg = importConfigText(String(reader.result || ""));
      if (!cfg) return notify("Restore failed: not a valid backup file", true);
      applyRestoredConfig(cfg, "before-restore-file");
      notify("Config restored from file");
    };
    reader.readAsText(file);
  }

  function onDownloadBackup() {
    exportConfig(useConfigStore.getState().config);
  }

  // ── Danger-zone Import (legacy importConfig :4898) — STRICTER guard than the file restore:
  // requires frameworks AND niches AND clients all present.
  const dangerFileRef = useRef<HTMLInputElement | null>(null);
  function onDangerImport(file: File | undefined | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ""));
        if (!parsed.frameworks || !parsed.niches || !parsed.clients) throw new Error("not a valid config file");
        applyRestoredConfig(parsed as Config, "before-import");
        notify("Config imported");
      } catch (e) {
        notify("Import failed: " + ((e as Error)?.message || ""), true);
      }
    };
    reader.readAsText(file);
  }

  // ── Reset to defaults (legacy resetConfig :4911) ──
  function onReset() {
    if (!window.confirm("Reset all frameworks, niches and clients to the built-in defaults? Your current config will be overwritten.")) return;
    // Build a fresh migrated default and replace the live config wholesale (legacy resetConfig).
    const fresh = migrateConfig(structuredClone(DEFAULT_CONFIG));
    const live = useConfigStore.getState().config;
    backupConfig(live, "before-reset");
    useConfigStore.getState().restoreConfig(fresh, "local");
    refreshBackups();
    notify("Reset to defaults");
  }

  // ── Save handlers (mutate ONLY via update()) ──
  function saveRules() {
    useConfigStore.getState().update((cfg) => {
      cfg.settings = cfg.settings || {};
      cfg.settings.globalRules = globalRulesDraft;
    });
    notify("Rules saved");
  }
  function saveGrowthRules() {
    useConfigStore.getState().update((cfg) => {
      cfg.settings = cfg.settings || {};
      cfg.settings.growthRules = growthRulesDraft;
    });
    notify("Growth plan rules saved");
  }
  function saveNotionParent() {
    const id = extractNotionId(notionParentDraft);
    useConfigStore.getState().update((cfg) => {
      cfg.settings = cfg.settings || {};
      cfg.settings.notionParentId = id;
    });
    notify("Notion destination saved");
  }
  function saveNotionBoardDb() {
    const id = extractNotionId(notionBoardDbDraft);
    useConfigStore.getState().update((cfg) => {
      cfg.settings = cfg.settings || {};
      cfg.settings.notionBoardDbId = id;
    });
    notify(id ? "Script board database saved" : "Cleared — will auto-find by name");
  }

  async function createNotionBoard() {
    const parentId = extractNotionId(notionBoardParentDraft);
    if (!parentId) { setBoardStatus("Paste the parent Notion page ID or URL first."); return; }
    useConfigStore.getState().update((cfg) => {
      cfg.settings = cfg.settings || {};
      cfg.settings.notionBoardParent = parentId;
    });
    setBoardStatus("Creating the database in Notion…");
    try {
      const r = (await api({ action: "create_notion_db", parentId, title: notionBoardName || "clients script testing board" })) as NotionDbResponse;
      const dbId = (r.id || "").replace(/-/g, "");
      useConfigStore.getState().update((cfg) => {
        cfg.settings = cfg.settings || {};
        cfg.settings.notionBoardDbId = dbId;
      });
      setNotionBoardDbDraft(dbId);
      setBoardStatus("✅ Created — exports will go here automatically." + (r.url ? " " + r.url : ""));
      notify("✅ Script testing board created in Notion");
    } catch (e) {
      setBoardStatus("❌ " + ((e as Error)?.message || "") + " — make sure the parent page is shared with your integration (page → ••• → Connections).");
      notify("Could not create the database: " + ((e as Error)?.message || ""), true);
    }
  }

  function savePlanDefaults() {
    useConfigStore.getState().update((cfg) => {
      cfg.settings = cfg.settings || {};
      const pd = cfg.settings.planDefaults as PlanDefaults;
      const read = (ch: "email" | "linkedin", k: string) => {
        const raw = pdDraft[ch][k];
        const v = Number(raw) || 0;
        return PD_RATE_KEYS.has(k) ? v / 100 : v;
      };
      EMAIL_KEYS.forEach((k) => { pd.email[k] = read("email", k); });
      LINKEDIN_KEYS.forEach((k) => { pd.linkedin[k] = read("linkedin", k); });
      pd.personalization.inputTokensPerLead = Number(pdDraft.pers.inputTokensPerLead) || 0;
      pd.personalization.outputTokensPerLead = Number(pdDraft.pers.outputTokensPerLead) || 0;
    });
    notify("Plan defaults saved");
  }

  // ── Local form drafts (controlled, seeded from the store once) ──
  const [globalRulesDraft, setGlobalRulesDraft] = useState(globalRules);
  const [growthRulesDraft, setGrowthRulesDraft] = useState(growthRules);
  const [notionParentDraft, setNotionParentDraft] = useState(notionParentId);
  const [notionBoardDbDraft, setNotionBoardDbDraft] = useState(notionBoardDbId);
  const [notionBoardParentDraft, setNotionBoardParentDraft] = useState(notionBoardParent || "3444fd2a4cfe80fa9f77dddfab8ad806");
  const [boardStatus, setBoardStatus] = useState("");

  // Plan-defaults drafts: rates held as % strings (legacy showed value*1000/10), counts as-is.
  const toPct = (v: number | undefined) => Math.round((Number(v) || 0) * 1000) / 10;
  const seedPd = () => ({
    email: Object.fromEntries(EMAIL_KEYS.map((k) => [k, String(PD_RATE_KEYS.has(k) ? toPct(planDefaults?.email?.[k]) : (planDefaults?.email?.[k] ?? 0))])) as Record<string, string>,
    linkedin: Object.fromEntries(LINKEDIN_KEYS.map((k) => [k, String(PD_RATE_KEYS.has(k) ? toPct(planDefaults?.linkedin?.[k]) : (planDefaults?.linkedin?.[k] ?? 0))])) as Record<string, string>,
    pers: {
      inputTokensPerLead: String(planDefaults?.personalization?.inputTokensPerLead ?? 0),
      outputTokensPerLead: String(planDefaults?.personalization?.outputTokensPerLead ?? 0),
    },
  });
  const [pdDraft, setPdDraft] = useState(seedPd);
  const setPd = (ch: "email" | "linkedin", k: string, v: number) =>
    setPdDraft((p) => ({ ...p, [ch]: { ...p[ch], [k]: String(v) } }));
  const setPers = (k: "inputTokensPerLead" | "outputTokensPerLead", v: number) =>
    setPdDraft((p) => ({ ...p, pers: { ...p.pers, [k]: String(v) } }));

  const sourceLabel =
    source === "server" ? "on the server (shared across browsers)"
      : source === "local" ? "in this browser only"
        : "as defaults (nothing saved yet)";

  return (
    <div className="space-y-5">
      {/* ── Backup & restore ── */}
      <Card>
        <CardBody>
          <div className="flex items-center gap-2 text-sm font-semibold text-text">
            <Icon name="device-floppy" />
            Backup &amp; restore (your clients + all data)
          </div>
          <Hint className="mt-1.5 mb-3">
            Download a full backup any time, or restore from a file or an automatic local snapshot. The bot keeps
            the last few local snapshots and auto-heals the server, so a failed sync can&apos;t silently wipe your work.
          </Hint>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="mini" size="sm" icon="download" onClick={onDownloadBackup}>
              Download backup
            </Button>
            <Button variant="mini" size="sm" icon="upload" onClick={() => restoreFileRef.current?.click()}>
              Restore from file
            </Button>
            <input
              ref={restoreFileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => { onRestoreFile(e.target.files?.[0]); e.target.value = ""; }}
            />
            <Hint className="!mt-0">
              {clientsCount} client{clientsCount === 1 ? "" : "s"} loaded now
            </Hint>
          </div>

          {backups.length ? (
            <div className="mt-3">
              <Hint className="!mt-0 mb-1.5">Automatic local snapshots:</Hint>
              <div className="flex flex-col gap-1.5">
                {backups.map((b) => (
                  <div
                    key={b.key}
                    className="flex items-center justify-between gap-2 border border-border rounded-lg px-3 py-2"
                  >
                    <span className="text-[13px] text-subtle">
                      {String(b.at || "").replace("T", " ").slice(0, 16)} · <b>{b.clients}</b> client
                      {b.clients === 1 ? "" : "s"}{" "}
                      {b.tag ? <span className="text-muted text-[11px]">{b.tag}</span> : null}
                    </span>
                    <Button variant="mini" size="sm" icon="refresh" onClick={() => onRestoreSnapshot(b.key)}>
                      Restore
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <Hint className="mt-2">No local snapshots yet — they appear after the next load/save.</Hint>
          )}
        </CardBody>
      </Card>

      {/* ── Team logins ── */}
      <Card>
        <CardBody>
          <div className="flex items-center gap-2 text-sm font-semibold text-text">
            <Icon name="id-badge-2" />
            Team logins
          </div>
          <Hint className="mt-1.5 mb-3">
            Everyone signs in with their email and password — the admin key is applied automatically behind the
            scenes, so it never needs sharing.
            {me ? <> Signed in as <b>{me.name || me.email}</b>.</> : null}
          </Hint>

          {users === null ? (
            <Hint className="!mt-0">Loading…</Hint>
          ) : usersError ? (
            <Hint className="!mt-0">⚠️ {usersError}</Hint>
          ) : users.length ? (
            <div className="flex flex-col gap-1.5">
              {users.map((u) => (
                <div
                  key={u.email}
                  className="flex items-center justify-between gap-2 border border-border rounded-lg px-3 py-2"
                >
                  <div className="text-[13px]">
                    <b>{u.name}</b>{" "}
                    <span className="text-muted text-[11px]">
                      {u.email} · added {u.createdAt || ""}
                    </span>
                  </div>
                  <Button variant="danger" size="sm" icon="trash" onClick={() => removeTeamUser(u.email)}>
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <Hint className="!mt-0">No logins yet — add yourself below. Until then, sign in with the admin key.</Hint>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.2fr_1fr_auto] gap-2 mt-3">
            <Input placeholder="Name" value={tuName} onChange={(e) => setTuName(e.target.value)} />
            <Input
              type="email"
              placeholder="email@agency.com"
              value={tuEmail}
              onChange={(e) => setTuEmail(e.target.value)}
            />
            <Input
              type="password"
              placeholder="password (8+ chars)"
              value={tuPassword}
              onChange={(e) => setTuPassword(e.target.value)}
            />
            <Button variant="mini" size="sm" icon="plus" loading={tuBusy} onClick={addTeamUser} className="whitespace-nowrap">
              Add login
            </Button>
          </div>
          <Hint>Adding an email that already exists resets that person&apos;s password.</Hint>
        </CardBody>
      </Card>

      {/* ── Admin key info ── */}
      <Card>
        <CardBody>
          <div className="flex items-center gap-2 text-sm font-semibold text-text">
            <Icon name="alert-triangle" />
            Admin key
          </div>
          <div className="mt-1.5 text-[13px] text-subtle">
            {adminKey ? (
              <>
                Current key in this browser:{" "}
                <Badge tone="accent">
                  {adminKey.slice(0, 4)}…{adminKey.slice(-4)}
                </Badge>{" "}
                ({adminKey.length} chars)
              </>
            ) : (
              "No key saved in this browser yet."
            )}
          </div>
          <Hint className="mt-2">
            If actions fail with “unauthorized”, the key saved here doesn&apos;t match the server. Open the app once
            with <code>?admin=YOUR_KEY</code> in the URL to set it.
          </Hint>
        </CardBody>
      </Card>

      {/* ── Notion export config ── */}
      <Card>
        <CardBody>
          <div className="flex items-center gap-2 text-sm font-semibold text-text">
            <Icon name="upload" />
            Notion export (Growth Plan Builder)
          </div>
          <Hint className="mt-1.5 mb-2.5">
            Growth plans export as a page under this Notion page. Create an internal integration at
            notion.so/my-integrations, share the destination page with it, then deploy with{" "}
            <b>NOTION_API_KEY</b> set. Paste the destination page ID or URL below.
          </Hint>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="max-w-[420px]"
              value={notionParentDraft}
              onChange={(e) => setNotionParentDraft(e.target.value)}
              placeholder="Notion page ID or URL"
            />
            <Button variant="mini" size="sm" icon="device-floppy" onClick={saveNotionParent}>
              Save
            </Button>
          </div>

          <hr className="border-0 border-t border-border my-3.5" />

          <div className="flex items-center gap-2 text-[13px] font-semibold text-text">
            <Icon name="file-text" size={15} />
            Script testing board (Notion database)
          </div>
          <Hint className="mt-1.5 mb-2.5">
            When you export scripts from a client&apos;s script board, they&apos;re added as a row in this Notion{" "}
            <b>database</b>. Paste the database ID or URL — or leave blank to auto-find a database named “
            {notionBoardName}”. Share the database with your integration first.
          </Hint>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="max-w-[420px]"
              value={notionBoardDbDraft}
              onChange={(e) => setNotionBoardDbDraft(e.target.value)}
              placeholder="Notion database ID or URL (optional)"
            />
            <Button variant="mini" size="sm" icon="device-floppy" onClick={saveNotionBoardDb}>
              Save
            </Button>
          </div>

          <hr className="border-0 border-t border-border my-3.5" />

          <div className="flex items-center gap-2 text-[13px] font-semibold text-text">
            <Icon name="plus" size={15} />
            Don&apos;t have the database yet? Create it
          </div>
          <Hint className="mt-1.5 mb-2.5">
            Creates the “{notionBoardName}” database (Client, Niche, Status, Who we&apos;re targeting, # tests, Date)
            under a Notion page you choose, and saves its ID above automatically.{" "}
            <b>Share that parent page with your integration first.</b>
          </Hint>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="max-w-[420px]"
              value={notionBoardParentDraft}
              onChange={(e) => setNotionBoardParentDraft(e.target.value)}
              placeholder="Parent Notion page ID or URL"
            />
            <Button variant="mini" size="sm" icon="plus" onClick={createNotionBoard}>
              Create database in Notion
            </Button>
          </div>
          {boardStatus ? <Hint className="mt-2">{boardStatus}</Hint> : null}
        </CardBody>
      </Card>

      {/* ── Growth plan defaults (% fields) ── */}
      <Card>
        <CardBody>
          <div className="flex items-center gap-2 text-sm font-semibold text-text">
            <Icon name="file-text" />
            Growth plan defaults (funnel + personalization)
          </div>
          <Hint className="mt-1.5 mb-3">
            Starting assumptions for new plans (each plan can override). Rates are percentages (4 = 4%).
          </Hint>

          <Grid2>
            <div>
              <div className="text-xs font-semibold text-accent2 mb-2">📧 Email</div>
              {EMAIL_KEYS.map((k) => {
                const isRate = PD_RATE_KEYS.has(k);
                return (
                  <div key={k} className="flex items-center justify-between gap-2 mb-1.5">
                    <label className="text-xs text-subtle">{k}{isRate ? " (%)" : ""}</label>
                    <NumberInput
                      value={pdDraft.email[k]}
                      percent={isRate}
                      step={isRate ? 0.5 : 1}
                      onValueChange={(v) => setPd("email", k, v)}
                    />
                  </div>
                );
              })}
            </div>
            <div>
              <div className="text-xs font-semibold text-accent2 mb-2">🔗 LinkedIn</div>
              {LINKEDIN_KEYS.map((k) => {
                const isRate = PD_RATE_KEYS.has(k);
                return (
                  <div key={k} className="flex items-center justify-between gap-2 mb-1.5">
                    <label className="text-xs text-subtle">{k}{isRate ? " (%)" : ""}</label>
                    <NumberInput
                      value={pdDraft.linkedin[k]}
                      percent={isRate}
                      step={isRate ? 0.5 : 1}
                      onValueChange={(v) => setPd("linkedin", k, v)}
                    />
                  </div>
                );
              })}
            </div>
          </Grid2>

          <div className="text-xs font-semibold text-accent2 mt-3 mb-2">✨ Personalization (Gemini 2.5)</div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <label className="text-xs text-subtle">Input tokens / lead</label>
            <NumberInput value={pdDraft.pers.inputTokensPerLead} onValueChange={(v) => setPers("inputTokensPerLead", v)} />
          </div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <label className="text-xs text-subtle">Output tokens / lead</label>
            <NumberInput value={pdDraft.pers.outputTokensPerLead} onValueChange={(v) => setPers("outputTokensPerLead", v)} />
          </div>

          <div className="flex justify-end mt-2.5">
            <Button variant="mini" size="sm" icon="device-floppy" onClick={savePlanDefaults}>
              Save defaults
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* ── Global style rules ── */}
      <Card>
        <CardBody>
          <div className="flex items-center gap-2 text-sm font-semibold text-text">
            <Icon name="file-text" />
            Global style rules (the language every framework obeys)
          </div>
          <FormField className="mt-2.5 mb-0">
            <Textarea
              className="min-h-[110px]"
              value={globalRulesDraft}
              onChange={(e) => setGlobalRulesDraft(e.target.value)}
            />
          </FormField>
          <div className="flex justify-end mt-2.5">
            <Button variant="mini" size="sm" icon="device-floppy" onClick={saveRules}>
              Save rules
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* ── Growth plan system prompt ── */}
      <Card>
        <CardBody>
          <div className="flex items-center gap-2 text-sm font-semibold text-text">
            <Icon name="file-text" />
            Growth plan system prompt (language rules for plan writing)
          </div>
          <Hint className="mt-1.5 mb-2.5">
            Injected into every growth-plan AI call — the narrative drafter AND the ✨ highlight-edit in the doc.
            Put your house language here: words to use/avoid, tone, how to talk about guarantees, emoji habits, etc.
          </Hint>
          <FormField className="mb-0">
            <Textarea
              className="min-h-[110px]"
              value={growthRulesDraft}
              onChange={(e) => setGrowthRulesDraft(e.target.value)}
              placeholder="e.g. Always say 'booked calls', never 'meetings'. Keep sentences under 20 words."
            />
          </FormField>
          <div className="flex justify-end mt-2.5">
            <Button variant="mini" size="sm" icon="device-floppy" onClick={saveGrowthRules}>
              Save growth rules
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* ── Danger zone (export / import / reset) ── */}
      <Card className="border-red/40">
        <CardBody>
          <div className="flex items-center gap-2 text-sm font-semibold text-text">
            <Icon name="alert-triangle" />
            Config
          </div>
          <div className="mt-1.5 text-[13px] text-subtle">Stored {sourceLabel}.</div>
          <div className="flex flex-wrap gap-2 mt-3">
            <Button variant="mini" size="sm" icon="download" onClick={onDownloadBackup}>
              Export JSON
            </Button>
            <Button variant="mini" size="sm" icon="upload" onClick={() => dangerFileRef.current?.click()}>
              Import JSON
            </Button>
            <input
              ref={dangerFileRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => { onDangerImport(e.target.files?.[0]); e.target.value = ""; }}
            />
            <Button variant="danger" size="sm" icon="trash" onClick={onReset}>
              Reset to defaults
            </Button>
          </div>
          {clientsCount < 0 ? (
            <EmptyState className={cn("mt-4")} icon="alert-triangle" title="No config loaded" />
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
