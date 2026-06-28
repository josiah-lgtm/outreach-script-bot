// Ephemeral, non-persisted view state (the legacy `state` + `window.V9` view slices).
// Never serialized; the old JS Sets become plain arrays/maps here so React change-detection
// works and nothing leaks into the persisted config. Grows as screens are built.

"use client";

import { create } from "zustand";

export const STAGES = ["Testing", "Proof of concept", "Scaling"] as const;

interface UiState {
  // Client list filters / search / selection
  search: string;
  filterNiche: string;
  filterCsm: string;
  filterTag: string;
  filterStage: string;
  filterOpen: boolean;
  selectMode: boolean;
  selected: Record<string, boolean>;

  setSearch: (v: string) => void;
  setFilter: (key: "filterNiche" | "filterCsm" | "filterTag" | "filterStage", value: string) => void;
  toggleFilterOpen: () => void;
  resetFilters: () => void;
  toggleSelectMode: () => void;
  toggleSelected: (id: string) => void;
  selectAllShown: (ids: string[]) => void;
  clearSelected: () => void;

  // Notion-export selection on the script board. Per-client (legacy boardSel :3026):
  // switching clients starts a fresh selection so the export modal never mixes scripts.
  boardSelClient: string | null;
  boardSel: Record<string, boolean>;
  toggleBoardSel: (clientId: string, scriptId: string) => void;
  setBoardSelAll: (clientId: string, ids: string[]) => void;
  clearBoardSel: (clientId: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  search: "",
  filterNiche: "All",
  filterCsm: "All",
  filterTag: "All",
  filterStage: "All",
  filterOpen: false,
  selectMode: false,
  selected: {},

  setSearch: (v) => set({ search: v }),
  setFilter: (key, value) => set({ [key]: value } as Partial<UiState>),
  toggleFilterOpen: () => set((s) => ({ filterOpen: !s.filterOpen })),
  resetFilters: () => set({ filterNiche: "All", filterCsm: "All", filterTag: "All", filterStage: "All", search: "" }),
  toggleSelectMode: () => set((s) => ({ selectMode: !s.selectMode, selected: {} })),
  toggleSelected: (id) => set((s) => {
    const selected = { ...s.selected };
    if (selected[id]) delete selected[id]; else selected[id] = true;
    return { selected };
  }),
  // Add-only over the currently-shown ids (legacy osSelectAllShown :7673).
  selectAllShown: (ids) => set((s) => {
    const selected = { ...s.selected };
    ids.forEach((id) => { selected[id] = true; });
    return { selected };
  }),
  clearSelected: () => set({ selected: {} }),

  boardSelClient: null,
  boardSel: {},
  toggleBoardSel: (clientId, scriptId) => set((s) => {
    const reset = s.boardSelClient !== clientId;
    const next = reset ? {} : { ...s.boardSel };
    if (next[scriptId]) delete next[scriptId]; else next[scriptId] = true;
    return { boardSel: next, boardSelClient: clientId };
  }),
  // Toggle-all over the shown ids (legacy boardSelectAllShown): if every one is already
  // selected, clear them; otherwise select them all.
  setBoardSelAll: (clientId, ids) => set((s) => {
    const cur = s.boardSelClient === clientId ? s.boardSel : {};
    const allOn = ids.length > 0 && ids.every((id) => cur[id]);
    const next = { ...cur };
    if (allOn) ids.forEach((id) => delete next[id]);
    else ids.forEach((id) => { next[id] = true; });
    return { boardSel: next, boardSelClient: clientId };
  }),
  clearBoardSel: (clientId) => set({ boardSel: {}, boardSelClient: clientId }),
}));
