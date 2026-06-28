// Presentational pieces for the create-script wizard — stateless where possible so the
// CreateScriptWizard state machine owns all wizard state. Visual port of legacy v9Wizard's
// step bar, group picker (wizGroupedPicker 7336), pick rows, mechanism cards (mechCardsHtml
// 7378) and the flow menu (v9Wizard menu 7422).

"use client";

import { useState, type ReactNode } from "react";
import { Icon, Button, cn } from "@/components/ui";
import type { Group, Mechanism } from "@/lib/sync/wizard";

const WIZ_STEPS = ["ICP", "Pain points", "Desired outcomes", "Mechanism", "Proof", "Framework"];

export function StepBar({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1 mb-4 overflow-x-auto">
      {WIZ_STEPS.map((s, k) => {
        const st = k + 1;
        const on = step >= st;
        const done = step > st;
        return (
          <div key={s} className="flex items-center gap-1 shrink-0">
            <div
              className={cn(
                "flex items-center gap-1.5 text-[12px] font-medium whitespace-nowrap",
                on ? "text-text" : "text-muted",
              )}
            >
              <span
                className={cn(
                  "inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold",
                  on ? "bg-accent2 text-white" : "bg-bg3 text-muted",
                )}
              >
                {done ? <Icon name="check" size={12} /> : st}
              </span>
              {s}
            </div>
            {k < WIZ_STEPS.length - 1 && <span className="w-3 h-px bg-border shrink-0" />}
          </div>
        );
      })}
    </div>
  );
}

const FLOWS: Array<{ id: "new" | "followup" | "angles" | "winning"; icon: string; title: string; sub: string }> = [
  { id: "new", icon: "file-plus", title: "Create new scripts", sub: "Niche → angle → offer → framework → swipe" },
  { id: "followup", icon: "arrow-forward-up", title: "Follow-up sequence", sub: "Build follow-ups to a script" },
  { id: "angles", icon: "search", title: "Find angles", sub: "AI suggests fresh angles" },
  { id: "winning", icon: "trophy", title: "From a script", sub: "Pick a board script or paste one → variations" },
];

export function WizMenu({ onPick }: { onPick: (flow: "new" | "followup" | "angles" | "winning") => void }) {
  return (
    <div>
      <div className="text-[15px] font-semibold mb-3">What do you want to create?</div>
      <div className="grid grid-cols-2 gap-2.5 max-md:grid-cols-1">
        {FLOWS.map((o) => (
          <button
            key={o.id}
            onClick={() => onPick(o.id)}
            className="text-left rounded-xl border border-border bg-bg2 hover:border-accent2 hover:bg-bg3 transition-colors p-3.5"
          >
            <div className="font-semibold text-[13px] flex items-center gap-2">
              <Icon name={o.icon} size={16} className="text-accent2" /> {o.title}
            </div>
            <div className="text-[12px] text-muted mt-1">{o.sub}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function PickRow({
  selected,
  onClick,
  children,
  className,
}: {
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-lg border px-3 py-2 text-[13px] transition-colors",
        selected ? "border-accent2 bg-[var(--tint-accent)]" : "border-border bg-bg2 hover:border-subtle",
        className,
      )}
    >
      {selected && <Icon name="check" size={13} className="inline-block mr-1.5 -mt-0.5 text-accent2" />}
      {children}
    </button>
  );
}

// Add-an-item row (input + button). Holds its own input state; calls onAdd(value).
export function AddRow({ placeholder, onAdd, busy }: { placeholder: string; onAdd: (v: string) => void; busy?: boolean }) {
  const [v, setV] = useState("");
  const submit = () => {
    const t = v.trim();
    if (!t) return;
    onAdd(t);
    setV("");
  };
  return (
    <div className="flex items-center gap-2 mt-2.5">
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        className="flex-1 bg-bg2 border border-border rounded-lg px-3 py-2 text-[13px] outline-none focus:border-accent2 placeholder:text-muted"
      />
      <Button variant="secondary" size="sm" onClick={submit} disabled={busy}>
        Add
      </Button>
    </div>
  );
}

// Grouped / flat item picker (legacy wizGroupedPicker 7336).
export function GroupedPicker({
  items,
  groups,
  selected,
  onToggle,
  openGroups,
  onToggleGroup,
  onMore,
  busy,
}: {
  items: string[];
  groups?: Group[];
  selected: string[];
  onToggle: (item: string) => void;
  openGroups: Record<string, boolean>;
  onToggleGroup: (id: string) => void;
  onMore: (gid: string) => void;
  busy?: boolean;
}) {
  const isSel = (a: string) => selected.indexOf(a) > -1;

  if (groups && groups.length) {
    const seen: Record<string, number> = {};
    groups.forEach((g) => (g.items || []).forEach((it) => (seen[it] = 1)));
    const left = items.filter((it) => !seen[it]);
    return (
      <div className="flex flex-col gap-2">
        {groups.map((g) => {
          const isOpen = !!openGroups[g.id];
          const picks = (g.items || []).filter(isSel).length;
          return (
            <div key={g.id} className="rounded-lg border border-border overflow-hidden">
              <div
                className="flex items-center justify-between gap-2 px-3 py-2 bg-bg2 cursor-pointer select-none"
                onClick={() => onToggleGroup(g.id)}
              >
                <span className="text-[13px] font-medium inline-flex items-center gap-1.5">
                  <Icon name={isOpen ? "chevron-down" : "chevron-right"} size={14} /> {g.topic || "Group"}
                </span>
                <span className="text-[12px] text-muted inline-flex items-center gap-2">
                  {(g.items || []).length}
                  {picks ? ` · ${picks} picked` : ""}
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="sparkles"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMore(g.id);
                    }}
                  >
                    more
                  </Button>
                </span>
              </div>
              {isOpen && (
                <div className="flex flex-col gap-1.5 p-2 bg-bg">
                  {(g.items || []).map((a) => (
                    <PickRow key={a} selected={isSel(a)} onClick={() => onToggle(a)}>
                      {a}
                    </PickRow>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {left.length > 0 && (
          <div className="rounded-lg border border-border overflow-hidden">
            <div
              className="flex items-center justify-between gap-2 px-3 py-2 bg-bg2 cursor-pointer select-none"
              onClick={() => onToggleGroup("__ungrouped")}
            >
              <span className="text-[13px] font-medium inline-flex items-center gap-1.5">
                <Icon name={openGroups.__ungrouped ? "chevron-down" : "chevron-right"} size={14} /> Ungrouped
              </span>
              <span className="text-[12px] text-muted">{left.length}</span>
            </div>
            {openGroups.__ungrouped && (
              <div className="flex flex-col gap-1.5 p-2 bg-bg">
                {left.map((a) => (
                  <PickRow key={a} selected={isSel(a)} onClick={() => onToggle(a)}>
                    {a}
                  </PickRow>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (!items.length) return <div className="text-[12px] text-muted">None yet — add one.</div>;
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((a) => (
        <PickRow key={a} selected={isSel(a)} onClick={() => onToggle(a)}>
          {a}
        </PickRow>
      ))}
    </div>
  );
}

// Built mechanisms as selectable cards (legacy mechCardsHtml 7378).
export function MechanismCards({
  mechs,
  activeId,
  onPick,
  helpLabel,
}: {
  mechs: Mechanism[];
  activeId?: string;
  onPick: (id: string) => void;
  helpLabel?: string;
}) {
  if (!mechs || !mechs.length) return null;
  return (
    <div className="flex flex-col gap-2.5 mb-3">
      {mechs.map((m) => {
        const sel = !!(m.id && m.id === activeId);
        const steps = m.steps || [];
        const help: Array<{ icon: string; label: string; text: string }> = [];
        if (m.reducesPain) help.push({ icon: "bandage", label: "Reduces pain", text: m.reducesPain });
        if (m.removesObjection) help.push({ icon: "shield-check", label: "Removes objection", text: m.removesObjection });
        if (m.increasesDesire) help.push({ icon: "trending-up", label: "Increases desire", text: m.increasesDesire });
        return (
          <button
            key={m.id}
            onClick={() => onPick(m.id)}
            title="Use this mechanism in your scripts"
            className={cn(
              "text-left rounded-xl border p-3.5 transition-colors",
              sel ? "border-accent2 bg-[var(--tint-accent)]" : "border-border bg-bg2 hover:border-subtle",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-[13px] font-semibold">
                {m.name || "Mechanism"}
                {m.confidence ? (
                  <span className="text-[11px] text-muted font-normal"> ({m.confidence}{m.source ? ` · ${m.source}` : ""})</span>
                ) : null}
              </div>
              {sel ? (
                <span className="text-[11px] font-semibold text-green inline-flex items-center gap-1">
                  <Icon name="check" size={12} /> Used in scripts
                </span>
              ) : (
                <span className="text-[11px] text-muted">tap to use</span>
              )}
            </div>
            {m.fixes && (
              <div className="text-[12px] text-muted mt-1">
                <b>Fixes:</b> {m.fixes}
              </div>
            )}
            {m.reframe && <div className="text-[12px] text-muted italic mt-1">{m.reframe}</div>}
            {steps.length > 0 && (
              <div className="flex flex-col gap-1 mt-2.5">
                {steps.map((s, i) => {
                  const last = i === steps.length - 1;
                  return (
                    <div key={i} className="flex items-start gap-2 text-[12px]">
                      <span
                        className={cn(
                          "inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-semibold mt-0.5 shrink-0",
                          last ? "bg-green text-white" : "bg-bg3 text-muted",
                        )}
                      >
                        {last ? <Icon name="flag" size={10} /> : i + 1}
                      </span>
                      <span>{s}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {m.outcome && (
              <div className="text-[12px] text-accent2 mt-2 inline-flex items-center gap-1.5">
                <Icon name="target" size={13} /> {m.outcome}
              </div>
            )}
            {help.length > 0 && (
              <div className="mt-2.5 pt-2.5 border-t border-border">
                <div className="text-[11px] font-semibold text-muted mb-1">{helpLabel || "How this helps"}</div>
                <div className="flex flex-col gap-1">
                  {help.map((h) => (
                    <div key={h.label} className="text-[12px] text-muted inline-flex items-start gap-1.5">
                      <Icon name={h.icon} size={13} className="mt-0.5 shrink-0" />
                      <span>
                        <b>{h.label}:</b> {h.text}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
