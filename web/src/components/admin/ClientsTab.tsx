// Admin → Clients tab. Port of the LIST half of the legacy adminClients() screen
// (index.html:4050-4060) and the client branch of the generic deleteItem (:4917-4922).
//
// The full client-profile editor is NOT re-built here — it already exists as the shared
// <ClientEditor>. This tab is just the list: each row shows name, meta, the niche names it
// is tagged with, and how many competitors it tracks, plus Edit / Delete. Edit opens the
// shared editor for that client; "New client" opens it with clientId="__new__". The editor
// is controlled by local state (which client id is open, or null when closed) and writes
// through the config store itself, so this tab only needs to render it and clear the state
// on close.
//
// DELETE (legacy deleteItem :4920-4922): remove the client from cfg.clients via update().
// The legacy code also reset the ephemeral active-client (state.clientId) when it matched;
// that runtime selection does not live in the persisted config in the new app, so the only
// data-level change here is dropping the client.

"use client";

import { useState } from "react";
import {
  Button, IconButton, Card, CardBody, Icon, Badge, EmptyState, Avatar,
} from "@/components/ui";
import { useConfigStore } from "@/lib/store/configStore";
import { notify } from "@/lib/notify";
import { ClientEditor } from "@/components/ClientEditor";

interface Niche {
  id: string;
  name: string;
}

interface Client {
  id: string;
  name: string;
  meta?: string;
  nicheIds?: string[];
  competitorIntel?: unknown[];
}

const NEW_ID = "__new__";

export function ClientsTab() {
  const clients = (useConfigStore((s) => s.config.clients) ?? []) as Client[];
  const niches = (useConfigStore((s) => s.config.niches) ?? []) as Niche[];

  // null = editor closed; otherwise the clientId being edited ("__new__" for a new client).
  const [editingId, setEditingId] = useState<string | null>(null);

  const nicheNames = (c: Client) =>
    (c.nicheIds || [])
      .map((id) => niches.find((n) => n.id === id)?.name || "")
      .filter(Boolean);

  function del(c: Client) {
    if (!window.confirm(`Delete client "${c.name}"?`)) return;
    useConfigStore.getState().update((cfg) => {
      cfg.clients = (cfg.clients || []).filter((x: Client) => x.id !== c.id);
    });
    if (editingId === c.id) setEditingId(null);
    notify("Deleted");
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <Icon name="id-badge-2" />
          Clients
        </div>
        <Button variant="mini" size="sm" icon="plus" onClick={() => setEditingId(NEW_ID)}>
          New client
        </Button>
      </div>

      {clients.length === 0 ? (
        <EmptyState
          icon="id-badge-2"
          title="No clients yet"
          description="Add a client to build their profile, niches and competitor intel."
          action={
            <Button variant="mini" size="sm" icon="plus" onClick={() => setEditingId(NEW_ID)}>
              New client
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {clients.map((c) => {
            const names = nicheNames(c);
            const rivals = (c.competitorIntel || []).length;
            return (
              <Card key={c.id} selected={editingId === c.id}>
                <CardBody className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <Avatar name={c.name} size="sm" />
                    <div className="min-w-0">
                      <div className="text-[13px] text-text">
                        <b>{c.name}</b>
                        {c.meta ? <span className="ml-2 text-xs text-subtle">{c.meta}</span> : null}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {names.length ? (
                          names.map((n, i) => (
                            <Badge key={n + i} tone="accent">
                              {n}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-[11px] text-muted">no niche</span>
                        )}
                        <span className="text-xs text-subtle">
                          · {rivals} rival{rivals === 1 ? "" : "s"} tracked
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <IconButton icon="edit" label="Edit client" size="sm" onClick={() => setEditingId(c.id)} />
                    <IconButton
                      icon="trash"
                      label="Delete client"
                      size="sm"
                      variant="danger"
                      onClick={() => del(c)}
                    />
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {editingId !== null && (
        <ClientEditor clientId={editingId} onClose={() => setEditingId(null)} />
      )}
    </div>
  );
}
