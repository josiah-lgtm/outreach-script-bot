// Admin → Niches tab. Port of the legacy adminNiches() screen (index.html:3971-4008),
// its saveNiche handler (:4031) and the niche branch of the generic deleteItem (:4917).
//
// A niche = { id, name, angles: string[], triggerWords: string[], tag? }. Angles are the
// diagnostic hooks and triggerWords are phrases worked into scripts; legacy ALLOWED
// duplicate entries in both (the DOM tag editor never de-duped), so both TagInputs pass
// unique={false}.
//
// DELETE CASCADE (verbatim port of deleteItem's `type === 'niches'` branch, :4923-4926):
// removing a niche must also strip its id from every client.nicheIds so no client points
// at a dead niche. The legacy code additionally reset the builder's ephemeral active-niche
// (state.nicheId / state.angles) when it matched; that runtime state does not exist in the
// new app (the builder re-derives its active niche from config on each render), so the only
// data-level cleanup needed here is the client.nicheIds strip — done inside the SAME
// update() so it lands atomically with the niche removal.
//
// Editing is local React state (which niche id is open + the draft fields); a NEW niche is
// a draft with the id "__new__". All config writes go through useConfigStore.getState()
// .update() so the single save queue stays correct.

"use client";

import { useState } from "react";
import {
  Button, IconButton, Card, CardBody, Input, TagInput, FormField, Grid2, Icon, Badge,
  EmptyState,
} from "@/components/ui";
import { useConfigStore } from "@/lib/store/configStore";
import { uid } from "@/lib/text-utils";
import { notify } from "@/lib/notify";

interface Niche {
  id: string;
  name: string;
  angles?: string[];
  triggerWords?: string[];
  tag?: string;
}

interface Client {
  id: string;
  name: string;
  nicheIds?: string[];
}

interface Draft {
  id: string; // "__new__" for a new niche
  name: string;
  angles: string[];
  triggerWords: string[];
  tag: string;
}

const NEW_ID = "__new__";

export function NichesTab() {
  const niches = (useConfigStore((s) => s.config.niches) ?? []) as Niche[];
  const clients = (useConfigStore((s) => s.config.clients) ?? []) as Client[];

  const [draft, setDraft] = useState<Draft | null>(null);

  // # clients whose nicheIds include this niche (legacy listed "X rivals"; here we surface
  // the cross-link count so the cascade impact of a delete is visible up front).
  const clientCount = (nicheId: string) =>
    clients.filter((c) => (c.nicheIds || []).includes(nicheId)).length;

  function openNew() {
    setDraft({ id: NEW_ID, name: "", angles: [], triggerWords: [], tag: "" });
  }

  function openEdit(n: Niche) {
    setDraft({
      id: n.id,
      name: n.name || "",
      angles: [...(n.angles || [])],
      triggerWords: [...(n.triggerWords || [])],
      tag: n.tag || "",
    });
  }

  function save() {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      notify("Name required", true);
      return;
    }
    const isNew = draft.id === NEW_ID;
    const obj: Niche = {
      id: isNew ? uid("niche") : draft.id,
      name,
      angles: draft.angles,
      triggerWords: draft.triggerWords,
      tag: draft.tag.trim(),
    };
    useConfigStore.getState().update((cfg) => {
      cfg.niches = cfg.niches || [];
      if (isNew) cfg.niches.push(obj);
      else cfg.niches = cfg.niches.map((n: Niche) => (n.id === obj.id ? obj : n));
    });
    setDraft(null);
    notify("Niche saved");
  }

  function del(n: Niche) {
    const used = clientCount(n.id);
    const warn = used
      ? `Delete niche "${n.name}"? It will be removed from ${used} client${used === 1 ? "" : "s"}.`
      : `Delete niche "${n.name}"?`;
    if (!window.confirm(warn)) return;
    // CASCADE (legacy deleteItem :4923-4926): drop the niche AND strip its id from every
    // client.nicheIds, atomically in one update().
    useConfigStore.getState().update((cfg) => {
      cfg.niches = (cfg.niches || []).filter((x: Niche) => x.id !== n.id);
      (cfg.clients || []).forEach((c: Client) => {
        c.nicheIds = (c.nicheIds || []).filter((x) => x !== n.id);
      });
    });
    if (draft && draft.id === n.id) setDraft(null);
    notify("Deleted");
  }

  const editing = draft && draft.id !== NEW_ID ? draft : null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <Icon name="crosshair" />
          Niches
        </div>
        <Button variant="mini" size="sm" icon="plus" onClick={openNew} disabled={draft?.id === NEW_ID}>
          New niche
        </Button>
      </div>

      {niches.length === 0 && draft?.id !== NEW_ID ? (
        <EmptyState
          icon="crosshair"
          title="No niches yet"
          description="A niche bundles the diagnostic angles and trigger words that power every script."
          action={
            <Button variant="mini" size="sm" icon="plus" onClick={openNew}>
              New niche
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {niches.map((n) => {
            const used = clientCount(n.id);
            return (
              <Card key={n.id} selected={editing?.id === n.id}>
                <CardBody className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] text-text">
                      <b>{n.name}</b>
                      {n.tag ? (
                        <Badge tone="accent" className="ml-2">
                          {n.tag}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-subtle">
                      {(n.angles || []).length} angle{(n.angles || []).length === 1 ? "" : "s"} ·{" "}
                      {(n.triggerWords || []).length} trigger word
                      {(n.triggerWords || []).length === 1 ? "" : "s"} ·{" "}
                      {used} client{used === 1 ? "" : "s"} using it
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <IconButton icon="edit" label="Edit niche" size="sm" onClick={() => openEdit(n)} />
                    <IconButton
                      icon="trash"
                      label="Delete niche"
                      size="sm"
                      variant="danger"
                      onClick={() => del(n)}
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
              {draft.id === NEW_ID ? "New niche" : `Edit: ${draft.name || "niche"}`}
            </div>

            <Grid2>
              <FormField label="Name" htmlFor="en-name">
                <Input
                  id="en-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </FormField>
              <FormField label="Tag (short label)" htmlFor="en-tag">
                <Input
                  id="en-tag"
                  value={draft.tag}
                  placeholder="optional"
                  onChange={(e) => setDraft({ ...draft, tag: e.target.value })}
                />
              </FormField>
            </Grid2>

            <FormField label="Angles — the niche diagnostics (each becomes a testable hook)">
              <TagInput
                value={draft.angles}
                onChange={(angles) => setDraft({ ...draft, angles })}
                placeholder="add angle + Enter"
                unique={false}
              />
            </FormField>

            <FormField label="Key trigger words (worked naturally into scripts)">
              <TagInput
                value={draft.triggerWords}
                onChange={(triggerWords) => setDraft({ ...draft, triggerWords })}
                placeholder="add trigger word + Enter"
                unique={false}
              />
            </FormField>

            <div className="flex justify-end gap-2 mt-2.5">
              <Button variant="ghost" size="sm" icon="x" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button variant="mini" size="sm" icon="device-floppy" onClick={save}>
                Save niche
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
