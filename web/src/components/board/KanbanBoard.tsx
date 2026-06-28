// Script board — the Ideas / Testing / Winning kanban on a client's overview.
// Port of legacy index.html:7219-7223 (v9BoardHtml) + the board handlers at 7710-7727
// (osDropCol / osDropDelete) and the export bar at 7288. Drag a card between columns to
// change its status (max 8 in Testing — the rest stay in Ideas), drop on the trash zone
// to delete (with confirm), click a card to open the shared ScriptEditModal, and tick
// cards to export the selection to Notion.

"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Button, Icon, cn } from "@/components/ui";
import { useConfigStore } from "@/lib/store/configStore";
import { useUiStore } from "@/lib/store/uiStore";
import { notify } from "@/lib/notify";
import type { Client } from "@/lib/sync/types";
import { ScriptEditModal, type ScriptVersion } from "@/components/ScriptEditModal";
import { CreateScriptWizard } from "@/components/wizard/CreateScriptWizard";
import { BoardExportModal } from "./BoardExportModal";
import type { BoardScript } from "./types";

type Script = BoardScript;

const COLUMNS: Array<{ key: string; label: string; icon: string }> = [
  { key: "idea", label: "Ideas", icon: "bulb" },
  { key: "testing", label: "Testing", icon: "flask" },
  { key: "winning", label: "Winning", icon: "trophy" },
];
const TRASH_ID = "__trash__";
const MAX_TESTING = 8;

function nicheNamesOf(client: Client, niches: Array<{ id: string; name: string }>): string {
  const byId = new Map(niches.map((n) => [n.id, n.name]));
  return ((client.nicheIds as string[]) || [])
    .map((id) => byId.get(id))
    .filter(Boolean)
    .join(", ");
}

export function KanbanBoard({ client, clientId }: { client: Client; clientId: string }) {
  const niches = useConfigStore((s) => s.config.niches) as Array<{ id: string; name: string }> | undefined;
  const boardSel = useUiStore((s) => s.boardSel);
  const boardSelClient = useUiStore((s) => s.boardSelClient);
  const toggleBoardSel = useUiStore((s) => s.toggleBoardSel);
  const setBoardSelAll = useUiStore((s) => s.setBoardSelAll);
  const clearBoardSel = useUiStore((s) => s.clearBoardSel);

  const [dragId, setDragId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [wizOpen, setWizOpen] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const reservoir = useMemo(() => (client.scriptReservoir as Script[]) || [], [client.scriptReservoir]);
  const followups = (client.followups as Array<{ parentLabel?: string }>) || [];

  const grouped = useMemo(() => {
    const g: Record<string, Script[]> = { idea: [], testing: [], winning: [] };
    reservoir.forEach((s) => (g[String(s.status)] || (g[String(s.status)] = [])).push(s));
    return g;
  }, [reservoir]);

  // Selection is per-client; treat a stale selection (different client) as empty.
  const sel = boardSelClient === clientId ? boardSel : {};
  const selectedIds = reservoir.filter((s) => sel[s.id]).map((s) => s.id as string);
  const selCount = selectedIds.length;
  const editing = editId ? reservoir.find((s) => s.id === editId) : null;

  function fuCountFor(s: Script): number {
    const key = s.label || `${s.framework || ""} · ${s.angle || ""}`;
    return followups.filter((f) => f.parentLabel === key).length;
  }

  function moveScript(scriptId: string, status: string) {
    const s = reservoir.find((x) => x.id === scriptId);
    if (!s || s.status === status) return;
    if (status === "testing") {
      const testingCount = reservoir.filter((x) => x.status === "testing").length;
      if (testingCount >= MAX_TESTING) {
        notify("Max 8 scripts in active Testing — the rest stay in Ideas (your card storage)", true);
        return;
      }
    }
    useConfigStore.getState().update((draft) => {
      const c = (draft.clients || []).find((x) => x.id === clientId);
      const item = c?.scriptReservoir?.find((x: BoardScript) => x.id === scriptId);
      if (item) item.status = status;
    });
  }

  function deleteScript(scriptId: string) {
    if (!window.confirm("Delete this script from the board?")) return;
    useConfigStore.getState().update((draft) => {
      const c = (draft.clients || []).find((x) => x.id === clientId);
      if (c) c.scriptReservoir = (c.scriptReservoir || []).filter((x: BoardScript) => x.id !== scriptId);
    });
    notify("Script deleted");
  }

  function applyEdit(scriptId: string, text: string, versions: ScriptVersion[]) {
    useConfigStore.getState().update((draft) => {
      const c = (draft.clients || []).find((x) => x.id === clientId);
      const item = c?.scriptReservoir?.find((x: BoardScript) => x.id === scriptId);
      if (item) {
        item.script = text;
        item.versions = versions;
      }
    });
    notify("Reservoir script updated");
  }

  function onDragEnd(e: DragEndEvent) {
    setDragId(null);
    const id = String(e.active.id);
    const over = e.over?.id ? String(e.over.id) : null;
    if (!over) return;
    if (over === TRASH_ID) deleteScript(id);
    else moveScript(id, over);
  }

  const nicheName = nicheNamesOf(client, niches || []);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[13px] font-semibold">Scripts board</h3>
        <Button variant="secondary" size="sm" icon="plus" onClick={() => setWizOpen(true)}>
          Create new script
        </Button>
      </div>
      <p className="text-[12px] text-muted flex items-center gap-1.5 mb-2.5">
        <Icon name="arrows-move" size={13} /> Drag between columns · tick to export · hover to preview
      </p>

      {reservoir.length > 0 && (
        <div className="flex items-center justify-between gap-2 mb-3">
          <span className="text-[12px] text-muted">
            {selCount ? `${selCount} selected for export` : "Tick scripts to export to Notion"}
          </span>
          <span className="flex gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              icon="checks"
              onClick={() => setBoardSelAll(clientId, reservoir.map((s) => s.id as string))}
            >
              Select all
            </Button>
            {selCount > 0 && (
              <Button variant="secondary" size="sm" onClick={() => clearBoardSel(clientId)}>
                Clear
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              icon="brand-notion"
              disabled={selCount === 0}
              onClick={() => setExportOpen(true)}
            >
              Export {selCount || ""} to Notion
            </Button>
          </span>
        </div>
      )}

      <DndContext
        sensors={sensors}
        onDragStart={(e: DragStartEvent) => setDragId(String(e.active.id))}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragId(null)}
      >
        <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
          {COLUMNS.map((col) => (
            <BoardColumn key={col.key} col={col} count={(grouped[col.key] || []).length}>
              {(grouped[col.key] || []).length === 0 ? (
                <div className="text-[11px] text-muted text-center py-2.5">—</div>
              ) : (
                (grouped[col.key] || []).map((s) => (
                  <ScriptCard
                    key={s.id}
                    script={s}
                    fuCount={fuCountFor(s)}
                    selected={!!sel[s.id]}
                    onToggleSel={() => toggleBoardSel(clientId, s.id as string)}
                    onEdit={() => setEditId(s.id as string)}
                  />
                ))
              )}
            </BoardColumn>
          ))}
        </div>

        <TrashZone active={!!dragId} />

        <DragOverlay>{dragId ? <DragCard script={reservoir.find((s) => s.id === dragId)} /> : null}</DragOverlay>
      </DndContext>

      {editing && (
        <ScriptEditModal
          open={!!editing}
          onClose={() => setEditId(null)}
          title={editing.framework || "Reservoir script"}
          sub={editing.angle || editing.label || ""}
          initialText={editing.script || ""}
          initialVersions={(editing.versions as ScriptVersion[]) || []}
          applyLabel="Save changes"
          onApply={(text, versions) => applyEdit(editId!, text, versions)}
        />
      )}

      <BoardExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        client={client}
        picks={reservoir.filter((s) => sel[s.id])}
        nicheName={nicheName}
        onExported={() => clearBoardSel(clientId)}
      />

      {wizOpen && <CreateScriptWizard open onClose={() => setWizOpen(false)} clientId={clientId} />}
    </div>
  );
}

function BoardColumn({
  col,
  count,
  children,
}: {
  col: { key: string; label: string; icon: string };
  count: number;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "bg-bg border border-border rounded-xl p-2.5 min-h-[120px] transition-colors",
        isOver && "border-accent2 bg-bg2",
      )}
    >
      <div className="flex items-center justify-between text-[12px] font-semibold text-muted px-1 pb-2">
        <span className="inline-flex items-center gap-1.5">
          <Icon name={col.icon} size={14} /> {col.label}
        </span>
        <span>{count}</span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function TrashZone({ active }: { active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: TRASH_ID });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "mt-3 rounded-xl border border-dashed text-[12px] text-center py-3 transition-colors flex items-center justify-center gap-2",
        active ? "opacity-100" : "opacity-50",
        isOver ? "border-red text-red bg-[var(--tint-red)]" : "border-border text-muted",
      )}
    >
      <Icon name="trash" size={15} /> Drop a script here to delete
    </div>
  );
}

function ScriptCard({
  script,
  fuCount,
  selected,
  onToggleSel,
  onEdit,
}: {
  script: Script;
  fuCount: number;
  selected: boolean;
  onToggleSel: () => void;
  onEdit: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: script.id });
  const sub = [script.framework, script.angle].filter(Boolean).join(" · ");
  const snip = String(script.script || "").replace(/\s+/g, " ").trim();
  const snipShort = snip ? (snip.length > 90 ? snip.slice(0, 90) + "…" : snip) : script.label || "(no text)";

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onEdit}
      title="Click to edit · drag to move"
      className={cn(
        "group relative bg-bg2 border rounded-lg p-2.5 cursor-grab active:cursor-grabbing text-left",
        selected ? "border-accent2" : "border-border hover:border-subtle",
        fuCount > 0 && "border-l-2 border-l-accent2",
        isDragging && "opacity-40",
      )}
    >
      <label
        className="absolute top-2 right-2 cursor-pointer"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSel}
          className="cursor-pointer accent-[var(--accent2)]"
          aria-label="Select for Notion export"
        />
      </label>
      <div className="text-[13px] font-semibold pr-5 truncate">{script.name || "Script"}</div>
      {sub && <div className="text-[11px] text-muted truncate">{sub}</div>}
      <div className="text-[11px] text-subtle mt-1 line-clamp-2 leading-snug">{snipShort}</div>
      {fuCount > 0 && (
        <div className="text-[10px] text-accent2 mt-1.5 inline-flex items-center gap-1">
          <Icon name="arrow-forward-up" size={12} /> {fuCount} follow-up{fuCount > 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}

// Lightweight card shown under the cursor while dragging.
function DragCard({ script }: { script?: Script }) {
  if (!script) return null;
  return (
    <div className="bg-bg2 border border-accent2 rounded-lg p-2.5 shadow-[var(--shadow-lg)] w-[220px] rotate-2">
      <div className="text-[13px] font-semibold truncate">{script.name || "Script"}</div>
      <div className="text-[11px] text-muted truncate">{[script.framework, script.angle].filter(Boolean).join(" · ")}</div>
    </div>
  );
}
