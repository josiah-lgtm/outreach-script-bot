// LoginModal — the team login gate (legacy #loginModal / doLogin, index.html:909/6907).
// Two ways in: email + password (exchanges for the shared admin key via the `login`
// action) or pasting the admin key directly. On success it triggers the store's
// afterLogin() reconciliation and closes. Rendered by AppShell when !loggedIn.

"use client";

import { useState } from "react";
import { Modal, Button, FormField, Input, Icon } from "@/components/ui";
import { doLogin, loginWithKey } from "@/lib/sync/authClient";
import { useConfigStore } from "@/lib/store/configStore";

export function LoginModal({ open }: { open: boolean }) {
  const afterLogin = useConfigStore((s) => s.afterLogin);
  const [mode, setMode] = useState<"password" | "key">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const r = await doLogin(email, password);
    setBusy(false);
    if (r.ok) {
      await afterLogin();
    } else {
      setError(r.error);
    }
  }

  async function submitKey(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!loginWithKey(key)) {
      setError("That doesn't look like a valid admin key.");
      return;
    }
    setBusy(true);
    await afterLogin();
    setBusy(false);
  }

  return (
    <Modal open={open} onClose={() => {}} dismissible={false} size="sm" title="Sign in">
      <div className="flex flex-col gap-1">
        <p className="text-[13px] text-muted leading-relaxed mb-3">
          Sign in with your team email, or paste an admin key if you have a setup link.
        </p>

        {mode === "password" ? (
          <form onSubmit={submitPassword} className="flex flex-col">
            <FormField label="Email">
              <Input
                type="email"
                autoComplete="username"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@agencyadvanta.com"
                required
              />
            </FormField>
            <FormField label="Password">
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </FormField>
            {error && <ErrorNote text={error} />}
            <Button type="submit" block loading={busy} className="mt-1">
              Sign in
            </Button>
            <button
              type="button"
              onClick={() => {
                setMode("key");
                setError("");
              }}
              className="mt-3 text-[11px] text-muted hover:text-accent2 cursor-pointer self-center"
            >
              Use an admin key instead
            </button>
          </form>
        ) : (
          <form onSubmit={submitKey} className="flex flex-col">
            <FormField label="Admin key" hint="Pasted from your setup link (?admin=…).">
              <Input
                type="password"
                autoFocus
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="offer_…"
                required
              />
            </FormField>
            {error && <ErrorNote text={error} />}
            <Button type="submit" block loading={busy} className="mt-1">
              Continue
            </Button>
            <button
              type="button"
              onClick={() => {
                setMode("password");
                setError("");
              }}
              className="mt-3 text-[11px] text-muted hover:text-accent2 cursor-pointer self-center"
            >
              Sign in with email & password
            </button>
          </form>
        )}
      </div>
    </Modal>
  );
}

function ErrorNote({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-red bg-[var(--tint-red)] border border-[var(--tint-red-ring)] rounded-md px-3 py-2 mb-2">
      <Icon name="alert-triangle" size={14} className="shrink-0" />
      {text}
    </div>
  );
}
