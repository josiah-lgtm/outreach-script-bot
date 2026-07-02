// The persisted-config store. Orchestrates the data layer the legacy app kept in globals:
// optimistic local writes + the debounced CAS save, the conflict-merge + retry recursion
// (verbatim port of serverSaveWithRetry, index.html:1783-1819), and boot reconciliation.
// All config mutations MUST go through update()/replaceConfig() so the single save queue
// and the lens context stay correct.

"use client";

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Config, ConfigSource } from "@/lib/sync/types";
import { api } from "@/lib/sync/api";
import { getAdminKey, initAdminKey } from "@/lib/sync/adminKey";
import { setLensContext } from "@/lib/sync/systemFilter";
import {
  DEFAULT_CONFIG, migrateConfig, mergeConfigs, saveLocalConfig, backupConfig, loadConfigData,
} from "@/lib/sync/configClient";
import { scheduleSave } from "./saveQueue";
import { notify } from "@/lib/notify";

type Pill = "server" | "saving" | "error" | "local";

let saveWarned = false;

function refreshLens(cfg: Config): void {
  setLensContext({ systemFilter: cfg?.settings?.systemFilter ?? null });
}

interface ConfigState {
  config: Config;
  source: ConfigSource;
  pill: Pill;
  booted: boolean;
  loggedIn: boolean;
  boot: () => Promise<void>;
  afterLogin: () => Promise<void>;
  update: (recipe: (draft: Config) => void) => void;
  replaceConfig: (cfg: Config, source: ConfigSource) => void;
  restoreConfig: (cfg: Config, source: ConfigSource) => void;
  scheduleResave: () => void;
  setActiveClientForLens: (clientId: string | null) => void;
  _flush: (attempt: number, conflictDepth: number) => Promise<void>;
}

const initialConfig: Config = migrateConfig(structuredClone(DEFAULT_CONFIG));

export const useConfigStore = create<ConfigState>()(immer((set, get) => ({
  config: initialConfig,
  source: "defaults",
  pill: "local",
  booted: false,
  loggedIn: false,

  boot: async () => {
    initAdminKey();
    const hasKey = !!getAdminKey();
    try {
      const { config, source, needsServerResave } = await loadConfigData({ hasAdminKey: hasKey });
      set((s) => { s.config = config; s.source = source; s.pill = source === "server" ? "server" : "local"; s.booted = true; s.loggedIn = hasKey; });
      refreshLens(config);
      if (needsServerResave && getAdminKey()) get().scheduleResave();
    } catch {
      set((s) => { s.booted = true; s.loggedIn = hasKey; });
    }
  },

  afterLogin: async () => {
    try {
      const { config, source, needsServerResave } = await loadConfigData({ hasAdminKey: true });
      set((s) => { s.config = config; s.source = source; s.pill = source === "server" ? "server" : "local"; s.loggedIn = true; });
      refreshLens(config);
      if (needsServerResave) get().scheduleResave();
    } catch {
      set((s) => { s.loggedIn = true; });
    }
  },

  // Optimistic local write + schedule the debounced server save (mirrors persistConfig).
  update: (recipe) => {
    set((s) => { recipe(s.config as Config); (s.config as Config)._dirty = true; s.pill = "saving"; });
    const cfg = get().config;
    saveLocalConfig(cfg);
    refreshLens(cfg);
    scheduleSave(() => get()._flush(0, 0));
  },

  replaceConfig: (cfg, source) => {
    set((s) => { s.config = cfg; s.source = source; });
    refreshLens(cfg);
  },

  // Adopt a brand-new config as a REAL, winning local edit: file/snapshot restore and
  // reset-to-defaults. Unlike scheduleResave (a NON-dirty self-heal that ADOPTS the server
  // copy on a rev conflict — which would silently discard the data the user just restored),
  // this marks the config _dirty so the restore always wins. Before the debounced save it
  // aligns _rev to the server's current rev so the CAS does a clean REPLACE (exact overwrite)
  // rather than a union-merge that would resurrect the very rows the user replaced. Mirrors the
  // legacy applyRestoredConfig → persistConfig(dirty) path. The config swaps in immediately
  // (optimistic); the server round-trip happens inside the debounced save task.
  restoreConfig: (cfg, source) => {
    set((s) => { s.config = cfg; (s.config as Config)._dirty = true; s.source = source; s.pill = "saving"; });
    const c = get().config;
    saveLocalConfig(c);
    refreshLens(c);
    scheduleSave(async () => {
      if (getAdminKey()) {
        try {
          const r = await api({ action: "get_config" });
          const sRev = Number(r?.config?._rev);
          if (Number.isFinite(sRev)) set((s) => { (s.config as Config)._rev = sRev; });
        } catch { /* server unreachable: fall back to the dirty-merge conflict path in _flush */ }
      }
      await get()._flush(0, 0);
    });
  },

  // Self-heal push that does NOT flip _dirty (mirrors scheduleServerResave).
  scheduleResave: () => {
    if (!getAdminKey()) return;
    saveLocalConfig(get().config);
    set((s) => { s.pill = "saving"; });
    scheduleSave(() => get()._flush(0, 0));
  },

  setActiveClientForLens: (clientId) => {
    const c = clientId ? (get().config.clients || []).find((x: any) => x.id === clientId) : null;
    setLensContext({ activeClient: c || null });
  },

  // Verbatim port of serverSaveWithRetry (index.html:1783-1819).
  _flush: async (attempt, conflictDepth) => {
    conflictDepth = conflictDepth || 0;
    if (!getAdminKey()) { set((s) => { s.pill = "local"; }); return; }
    const cfg = get().config;
    const baseRev = Number(cfg._rev) || 0;
    const payload: any = Object.assign({}, cfg); delete payload._dirty;
    try {
      const r = await api({ action: "save_config", config: payload, baseRev });
      if (r && r.conflict) {
        const local = get().config;
        if (local._dirty && conflictDepth < 4 && r.config && Array.isArray(r.config.frameworks)) {
          backupConfig(r.config, "server-copy-at-conflict");
          backupConfig(local, "local-copy-at-conflict");
          const merged: Config = mergeConfigs(local, r.config);
          merged._rev = r.rev;     // re-base onto the server's current rev
          merged._dirty = true;    // still unsynced until the re-save lands
          try { migrateConfig(merged); } catch { /* ignore */ }
          set((s) => { s.config = merged; });
          saveLocalConfig(merged);
          refreshLens(merged);
          notify("🔀 Merged changes from another device");
          return get()._flush(0, conflictDepth + 1);
        }
        // No local edits (self-heal) or merge exhausted → adopt the server copy.
        backupConfig(local, "local-before-adopt-server");
        const adopted: Config = r.config;
        adopted._dirty = false; adopted._rev = r.rev;
        try { migrateConfig(adopted); } catch { /* ignore */ }
        set((s) => { s.config = adopted; s.source = "server"; s.pill = "server"; });
        saveWarned = false;
        saveLocalConfig(adopted);
        refreshLens(adopted);
        return;
      }
      if (r && Number.isFinite(Number(r.rev))) set((s) => { (s.config as Config)._rev = Number(r.rev); });
      set((s) => { (s.config as Config)._dirty = false; s.source = "server"; s.pill = "server"; });
      saveWarned = false;
      saveLocalConfig(get().config);
    } catch (e) {
      if (attempt < 2) { setTimeout(() => get()._flush(attempt + 1, conflictDepth), 1500 * (attempt + 1)); return; }
      console.warn("server save failed:", (e as Error).message);
      set((s) => { s.pill = "error"; });
      if (!saveWarned) {
        saveWarned = true;
        notify("⚠️ Couldn't save to the server — your changes are on THIS device only. Check your connection/admin key, then re-save. Don't clear your browser.", true);
      }
    }
  },
})));
