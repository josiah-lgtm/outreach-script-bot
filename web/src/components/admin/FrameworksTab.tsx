// Admin → Frameworks tab. Port of the legacy adminFrameworks() screen
// (index.html:3787-3827) plus its handlers saveFramework (:3834), previewVars (:3829)
// and the generic deleteItem('frameworks', …) path (:4917).
//
// Data shape (per the new-app contract):
//   framework = { id, name, category, template, rules?, nicheIds? }
//   nicheIds = niche scope; empty/absent = global (every niche).
//
// Editing is local React state (which framework id is open + the draft fields). A NEW
// framework is a draft with the id "__new__". All config writes go through
// useConfigStore.getState().update() so the single save queue stays correct.

"use client";

import { useState } from "react";
import {
  Button, IconButton, Card, CardBody, Chip, Input, Textarea, FormField, Grid2, Icon, Badge,
  EmptyState,
} from "@/components/ui";
import { useConfigStore } from "@/lib/store/configStore";
import { uid } from "@/lib/text-utils";
import { notify } from "@/lib/notify";

// Port of fwVars (legacy index.html:1397): unique {{variable}} names in template order.
function fwVars(t: unknown): string[] {
  return Array.from(
    new Set(Array.from(String(t).matchAll(/\{\{(\w+)\}\}/g), (m) => m[1])),
  );
}

interface Framework {
  id: string;
  name: string;
  category?: string;
  template?: string;
  rules?: string;
  nicheIds?: string[];
}

interface Niche {
  id: string;
  name: string;
}

interface Draft {
  id: string; // "__new__" for a new framework
  name: string;
  category: string;
  template: string;
  rules: string;
  nicheIds: string[];
}

const NEW_ID = "__new__";

function VarChips({ template }: { template: string }) {
  const vars = fwVars(template);
  if (!vars.length) return <span className="text-[11px] text-muted">No {"{{variables}}"} yet</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {vars.map((v) => (
        <Badge key={v} tone="accent" className="font-mono">
          {`{{${v}}}`}
        </Badge>
      ))}
    </div>
  );
}

export function FrameworksTab() {
  const frameworks = (useConfigStore((s) => s.config.frameworks) ?? []) as Framework[];
  const niches = (useConfigStore((s) => s.config.niches) ?? []) as Niche[];

  const [draft, setDraft] = useState<Draft | null>(null);

  // Existing categories power the datalist (legacy used the same de-duped set).
  const categories = Array.from(new Set(frameworks.map((f) => f.category).filter(Boolean))) as string[];

  const nicheName = (id: string) => niches.find((n) => n.id === id)?.name || "";

  function openNew() {
    setDraft({ id: NEW_ID, name: "", category: "", template: "", rules: "", nicheIds: [] });
  }

  function openEdit(f: Framework) {
    setDraft({
      id: f.id,
      name: f.name || "",
      category: f.category || "",
      template: f.template || "",
      rules: f.rules || "",
      nicheIds: [...(f.nicheIds || [])],
    });
  }

  function toggleScope(nicheId: string) {
    setDraft((d) =>
      d
        ? {
            ...d,
            nicheIds: d.nicheIds.includes(nicheId)
              ? d.nicheIds.filter((x) => x !== nicheId)
              : [...d.nicheIds, nicheId],
          }
        : d,
    );
  }

  function save() {
    if (!draft) return;
    const name = draft.name.trim();
    const template = draft.template;
    if (!name || !template.trim()) {
      notify("Name and template required", true);
      return;
    }
    const isNew = draft.id === NEW_ID;
    const obj: Framework = {
      id: isNew ? uid("fw") : draft.id,
      name,
      category: draft.category.trim() || "Uncategorized",
      template,
      rules: draft.rules.trim(),
      nicheIds: draft.nicheIds,
    };
    useConfigStore.getState().update((cfg) => {
      cfg.frameworks = cfg.frameworks || [];
      if (isNew) cfg.frameworks.push(obj);
      else cfg.frameworks = cfg.frameworks.map((f: Framework) => (f.id === obj.id ? obj : f));
    });
    setDraft(null);
    notify("Framework saved");
  }

  function del(f: Framework) {
    if (!window.confirm(`Delete framework "${f.name}"?`)) return;
    useConfigStore.getState().update((cfg) => {
      cfg.frameworks = (cfg.frameworks || []).filter((x: Framework) => x.id !== f.id);
    });
    if (draft && draft.id === f.id) setDraft(null);
    notify("Deleted");
  }

  const editing = draft && draft.id !== NEW_ID ? draft : null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <Icon name="file-text" />
          Frameworks
        </div>
        <Button variant="mini" size="sm" icon="plus" onClick={openNew} disabled={draft?.id === NEW_ID}>
          New framework
        </Button>
      </div>

      {frameworks.length === 0 && draft?.id !== NEW_ID ? (
        <EmptyState
          icon="file-text"
          title="No frameworks yet"
          description="Add a framework or extract one from a winning script."
          action={
            <Button variant="mini" size="sm" icon="plus" onClick={openNew}>
              New framework
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {frameworks.map((f) => {
            const scope = (f.nicheIds || []).length
              ? (f.nicheIds || []).map(nicheName).filter(Boolean).join(", ")
              : "🌐 all niches";
            return (
              <Card key={f.id} selected={editing?.id === f.id}>
                <CardBody className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] text-text">
                      <b>{f.name}</b>{" "}
                      <span className="text-xs text-subtle">
                        {f.category} · {scope}
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <VarChips template={f.template || ""} />
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <IconButton icon="edit" label="Edit framework" size="sm" onClick={() => openEdit(f)} />
                    <IconButton
                      icon="trash"
                      label="Delete framework"
                      size="sm"
                      variant="danger"
                      onClick={() => del(f)}
                    />
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {draft && (
        <Card selected>
          <CardBody className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-text mb-2">
              <Icon name={draft.id === NEW_ID ? "plus" : "edit"} />
              {draft.id === NEW_ID ? "New framework" : `Edit: ${draft.name || "framework"}`}
            </div>

            <Grid2>
              <FormField label="Name" htmlFor="ef-name">
                <Input
                  id="ef-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </FormField>
              <FormField label="Category (what it is)" htmlFor="ef-cat">
                <Input
                  id="ef-cat"
                  list="fw-cat-list"
                  value={draft.category}
                  placeholder="Proof-led / Pain-led / Curiosity-led / Ultra-short…"
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                />
                <datalist id="fw-cat-list">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </FormField>
            </Grid2>

            <FormField label="Template — use {{variables}} for the parts Claude fills" htmlFor="ef-template">
              <Textarea
                id="ef-template"
                value={draft.template}
                onChange={(e) => setDraft({ ...draft, template: e.target.value })}
                className="min-h-[140px] font-mono"
              />
              <div className="mt-2">
                <VarChips template={draft.template} />
              </div>
            </FormField>

            <FormField label="Rules (language, length, tone for this framework)" htmlFor="ef-rules">
              <Textarea
                id="ef-rules"
                value={draft.rules}
                onChange={(e) => setDraft({ ...draft, rules: e.target.value })}
              />
            </FormField>

            <FormField label="Scope — leave all off for 🌐 generic (every niche), or pick specific niches">
              {niches.length === 0 ? (
                <p className="text-[11px] text-muted">No niches yet — this framework will be global.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {niches.map((n) => (
                    <Chip
                      key={n.id}
                      selected={draft.nicheIds.includes(n.id)}
                      onClick={() => toggleScope(n.id)}
                    >
                      {n.name}
                    </Chip>
                  ))}
                </div>
              )}
            </FormField>

            <div className="flex justify-end gap-2 mt-2.5">
              <Button variant="ghost" size="sm" icon="x" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button variant="mini" size="sm" icon="device-floppy" onClick={save}>
                Save framework
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
