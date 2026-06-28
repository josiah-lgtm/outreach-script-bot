// Shared script editor — the version rail + AI-rewrite + highlight→refine_selection
// dialog used by the kanban board (and, later, the wizard and follow-up flows).
// Faithful port of legacy index.html:2650-2862 (openModalCtx / renderVersionList /
// modalAiRefine / modalApply). The legacy `modalCtx.store._versions` mutable global is
// replaced by local React state; on apply the caller persists `text` + `versions`
// through the config store, never by mutating the draft directly.

"use client";

import { useEffect, useRef, useState } from "react";
import { Modal, Button, Icon, cn } from "@/components/ui";
import { api } from "@/lib/sync/api";
import { getAdminKey } from "@/lib/sync/adminKey";
import { notify } from "@/lib/notify";
import { uid } from "@/lib/text-utils";

export type ScriptVersion = { id?: string; label: string; tag: string; text: string };

export interface ScriptEditModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  sub?: string;
  initialText: string;
  /** Persisted versions (e.g. reservoir item.versions); a fresh "Original" is seeded if empty. */
  initialVersions?: ScriptVersion[];
  applyLabel?: string;
  /** Receives the final text + the version rail (stripped of internal ids) to persist. */
  onApply: (text: string, versions: ScriptVersion[]) => void;
}

const MOCK_TAIL = /\n*\(mock refinement applied\)\s*$/;

function seed(vs: ScriptVersion[] | undefined, text: string): ScriptVersion[] {
  if (vs && vs.length) return vs.map((v) => ({ ...v, id: v.id || uid("v") }));
  return [{ id: uid("v"), label: "Original", tag: "orig", text }];
}

export function ScriptEditModal({
  open,
  onClose,
  title,
  sub,
  initialText,
  initialVersions,
  applyLabel = "Apply",
  onApply,
}: ScriptEditModalProps) {
  const [versions, setVersions] = useState<ScriptVersion[]>(() => seed(initialVersions, initialText));
  const [active, setActive] = useState(0);
  const [text, setText] = useState(initialText);
  const [aiInput, setAiInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<{ start: number; end: number; text: string } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const wasOpen = useRef(false);

  // Re-seed the rail on each open (rising edge), mirroring openModalCtx/ensureCtxVersions.
  useEffect(() => {
    if (open && !wasOpen.current) {
      const vs = seed(initialVersions, initialText);
      const a = initialVersions && initialVersions.length ? vs.length - 1 : 0;
      setVersions(vs);
      setActive(a);
      setText(vs[a]?.text ?? initialText);
      setAiInput("");
      setSel(null);
      setTimeout(() => taRef.current?.focus(), 60);
    }
    wasOpen.current = open;
  }, [open, initialText, initialVersions]);

  function trackSelection() {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (end - start >= 3) setSel({ start, end, text: ta.value.slice(start, end).replace(/\n+/g, " ") });
  }
  function clearSelection() {
    setSel(null);
  }

  function pushVersion(label: string, tag: string, t: string) {
    const next = [...versions, { id: uid("v"), label, tag, text: t }];
    setVersions(next);
    setActive(next.length - 1);
  }

  function loadVersion(i: number) {
    const v = versions[i];
    if (!v) return;
    setActive(i);
    setText(v.text);
    clearSelection();
  }

  function saveSnapshot() {
    const n = versions.filter((v) => v.tag === "edit").length + 1;
    pushVersion("Manual edit " + n, "edit", text);
    notify("Version saved");
  }

  async function aiRefine() {
    const prompt = aiInput.trim();
    if (!prompt) return notify("Tell the AI what to change", true);
    if (!getAdminKey()) return notify("No admin key", true);
    setBusy(true);
    try {
      if (sel && sel.end <= text.length) {
        const selection = text.slice(sel.start, sel.end);
        const r = await api({ action: "refine_selection", script: text, selection, prompt });
        const repl = String(r.replacement ?? "").replace(MOCK_TAIL, "");
        const replaced = text.slice(0, sel.start) + repl + text.slice(sel.end);
        pushVersion("✂️ " + prompt, "ai", replaced);
        setText(replaced);
        clearSelection();
      } else {
        const r = await api({ action: "refine_script", script: text, prompt });
        const out = String(r.script ?? r.text ?? r.result ?? r.content ?? "").replace(MOCK_TAIL, "");
        pushVersion(prompt, "ai", out);
        setText(out);
      }
      setAiInput("");
    } catch (e) {
      notify("Refine failed: " + (e as Error).message, true);
    }
    setBusy(false);
  }

  function apply() {
    let finalVersions = versions;
    if (versions[active]?.text !== text) {
      finalVersions = [...versions, { id: uid("v"), label: "Manual edit", tag: "edit", text }];
    }
    onApply(
      text,
      finalVersions.map((v) => ({ label: v.label, tag: v.tag, text: v.text })),
    );
    onClose();
  }

  const tagLabel = (tag: string) => (tag === "ai" ? "AI" : tag === "orig" ? "original" : "edit");
  const tagTone = (tag: string) =>
    tag === "ai"
      ? "bg-[var(--tint-accent)] text-accent2"
      : tag === "orig"
        ? "bg-bg3 text-muted"
        : "bg-[var(--tint-green)] text-green";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title || "Edit"}
      sub={sub}
      size="xl"
      flush
      footer={
        <>
          <Button variant="secondary" size="sm" icon="device-floppy" onClick={saveSnapshot}>
            Save version
          </Button>
          <div className="ml-auto" />
          <Button variant="primary" size="sm" onClick={apply}>
            {applyLabel}
          </Button>
        </>
      }
    >
      {/* Version rail */}
      <aside className="w-[230px] shrink-0 border-r border-border flex flex-col bg-bg">
        <div className="px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted flex items-center justify-between border-b border-border">
          <span>Versions</span>
          <span className="text-text">{versions.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
          {versions.map((v, i) => (
            <button
              key={v.id}
              onClick={() => loadVersion(i)}
              className={cn(
                "text-left rounded-lg border px-2.5 py-2 transition-colors cursor-pointer",
                i === active ? "border-accent2 bg-bg2" : "border-border bg-bg2 hover:bg-bg3",
              )}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[12px] font-semibold truncate flex-1">{v.label}</span>
                <span className={cn("text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide", tagTone(v.tag))}>
                  {tagLabel(v.tag)}
                </span>
              </div>
              <div className="text-[11px] text-muted leading-snug line-clamp-2">
                {String(v.text).replace(/\n+/g, " ").slice(0, 90)}
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* Editor */}
      <div className="flex-1 flex flex-col min-w-0">
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onSelect={trackSelection}
          onMouseUp={trackSelection}
          onKeyUp={trackSelection}
          spellCheck
          className="flex-1 resize-none bg-transparent outline-none px-4 py-3.5 text-[14px] leading-[1.65] text-text font-mono"
        />

        {sel && (
          <div className="mx-4 mb-1.5 flex items-center gap-2 text-[11px] text-accent2 bg-[var(--tint-accent)] border border-[var(--accent-ring)] rounded-lg px-2.5 py-1.5">
            <Icon name="edit" size={13} />
            <span className="truncate flex-1">
              “{sel.text.slice(0, 80)}
              {sel.text.length > 80 ? "…" : ""}”
            </span>
            <button onClick={clearSelection} className="text-muted hover:text-text cursor-pointer" aria-label="Clear selection">
              <Icon name="x" size={13} />
            </button>
          </div>
        )}

        <div className="border-t border-border p-3 flex items-center gap-2">
          <input
            value={aiInput}
            onChange={(e) => setAiInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                aiRefine();
              }
            }}
            disabled={busy}
            placeholder={
              sel
                ? "Rewrite just this part — “turn it into a question”, “add a number”…"
                : "Ask AI to rewrite — “make it shorter”, “add a stat”, “warmer tone”…"
            }
            className="flex-1 bg-bg2 border border-border rounded-lg px-3 py-2 text-[13px] outline-none focus:border-accent2 placeholder:text-muted"
          />
          <Button variant="primary" size="sm" icon="sparkles" loading={busy} onClick={aiRefine}>
            {sel ? "Rewrite part" : "Rewrite"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
