// Admin → Outbound follow-up frameworks tab. Port of the legacy adminFollowups()
// screen (index.html:3658-3686) plus its handlers adminEditFollowup (:3687),
// saveFollowup (:3688) and deleteFollowup (:3697).
//
// Data shape (read verbatim from DEFAULT_FOLLOWUP_FRAMEWORKS in lib/sync/configClient.ts):
//   followupFramework = { id, name, template }   // name AND template both required to save
//
// Editing is local React state (the open draft, id "__new__" for a new framework). All config
// writes go through useConfigStore.getState().update() so the single save queue stays correct.

"use client";

import { useState } from "react";
import {
  Button, IconButton, Card, CardBody, Input, Textarea, FormField, Icon, EmptyState,
} from "@/components/ui";
import { useConfigStore } from "@/lib/store/configStore";
import { uid } from "@/lib/text-utils";
import { notify } from "@/lib/notify";

interface Followup {
  id: string;
  name: string;
  template: string;
}

interface Draft {
  id: string; // "__new__" for a new follow-up framework
  name: string;
  template: string;
}

const NEW_ID = "__new__";

export function FollowupsTab() {
  const followups = (useConfigStore((s) => s.config.followupFrameworks) ?? []) as Followup[];

  const [draft, setDraft] = useState<Draft | null>(null);

  function openNew() {
    setDraft({ id: NEW_ID, name: "", template: "" });
  }

  function openEdit(f: Followup) {
    setDraft({ id: f.id, name: f.name || "", template: f.template || "" });
  }

  function save() {
    if (!draft) return;
    const name = draft.name.trim();
    const template = draft.template;
    // Legacy saveFollowup (:3691): name AND a non-blank template are both required.
    if (!name || !template.trim()) {
      notify("Name and template required", true);
      return;
    }
    const isNew = draft.id === NEW_ID;
    const obj: Followup = { id: isNew ? uid("fu") : draft.id, name, template };
    useConfigStore.getState().update((cfg) => {
      cfg.followupFrameworks = cfg.followupFrameworks || [];
      if (isNew) cfg.followupFrameworks.push(obj);
      else cfg.followupFrameworks = cfg.followupFrameworks.map((f: Followup) => (f.id === obj.id ? obj : f));
    });
    setDraft(null);
    notify("Follow-up framework saved");
  }

  function del(f: Followup) {
    if (!window.confirm("Delete this follow-up framework?")) return;
    useConfigStore.getState().update((cfg) => {
      cfg.followupFrameworks = (cfg.followupFrameworks || []).filter((x: Followup) => x.id !== f.id);
    });
    if (draft && draft.id === f.id) setDraft(null);
    notify("Deleted");
  }

  const editing = draft && draft.id !== NEW_ID ? draft : null;

  return (
    <div className="space-y-5">
      <div className="info-block">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <Icon name="arrow-forward-up" />
          Outbound follow-up frameworks
        </div>
        <p className="mt-1 text-xs text-subtle">
          Models the AI bases each follow-up on. Use {"{placeholders}"} for the parts AI fills; keep{" "}
          {"{{first_name}}"} / {"{{company}}"} merge tags.
        </p>
      </div>

      <div className="flex justify-end">
        <Button variant="mini" size="sm" icon="plus" onClick={openNew} disabled={draft?.id === NEW_ID}>
          New follow-up framework
        </Button>
      </div>

      {followups.length === 0 && draft?.id !== NEW_ID ? (
        <EmptyState
          icon="arrow-forward-up"
          title="No follow-up frameworks yet"
          description="Add a follow-up framework the AI can base outbound follow-ups on."
          action={
            <Button variant="mini" size="sm" icon="plus" onClick={openNew}>
              New follow-up framework
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {followups.map((f) => {
            // Legacy preview (:3665): template flattened to one line, first 90 chars + ellipsis.
            const preview = String(f.template).replace(/\n/g, " ").slice(0, 90);
            return (
              <Card key={f.id} selected={editing?.id === f.id}>
                <CardBody className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] text-text">
                      <b>{f.name}</b>
                    </div>
                    <div className="mt-1 text-xs text-subtle truncate max-w-[520px]">{preview}…</div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <IconButton icon="edit" label="Edit follow-up framework" size="sm" onClick={() => openEdit(f)} />
                    <IconButton
                      icon="trash"
                      label="Delete follow-up framework"
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
              {draft.id === NEW_ID ? "New follow-up framework" : `Edit: ${draft.name || "follow-up"}`}
            </div>

            <FormField label="Name" htmlFor="ef-fu-name">
              <Input
                id="ef-fu-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </FormField>

            <FormField label="Template" htmlFor="ef-fu-template">
              <Textarea
                id="ef-fu-template"
                value={draft.template}
                onChange={(e) => setDraft({ ...draft, template: e.target.value })}
                className="min-h-[150px] font-mono"
              />
            </FormField>

            <div className="flex justify-end gap-2 mt-2.5">
              <Button variant="ghost" size="sm" icon="x" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button variant="mini" size="sm" icon="device-floppy" onClick={save}>
                Save
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
