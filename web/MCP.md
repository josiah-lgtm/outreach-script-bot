# MCP server

The app exposes a Model Context Protocol server at **`<your domain>/mcp`** — same
Next.js app, same origin, same Postgres. Nothing extra to deploy and no second
domain: if the web app is reachable, so is the MCP endpoint.

It gives Claude and ChatGPT the two things the app does — **build ICPs** and
**write outreach scripts** — plus the thing you cannot do from the UI: **change
the logic behind both**, from a chat window, safely, with a free preview before
anything is spent.

---

## 1. Connect

### Claude (claude.ai, desktop)

1. **Settings → Connectors → Add custom connector**
2. Paste `https://your-domain/mcp`. Leave the OAuth client fields blank — the
   server implements dynamic client registration, so Claude registers itself.
3. **Connect** → a sign-in window opens. Use a team login (Admin → Settings →
   Team logins) or the shared admin key.
4. Untick **Allow changes** in that window for a read-only connection.

### ChatGPT

1. **Settings → Connectors → Advanced → Developer mode**.
2. **Create** a connector, paste the same URL, choose **OAuth**.
3. Sign in the same way.

The `search` and `fetch` tools follow the deep-research contract, so the
connector also works in ChatGPT's research mode.

### Claude Code / scripts

```bash
claude mcp add --transport http outreach https://your-domain/mcp \
  --header "Authorization: Bearer $ADMIN_KEY"
```

A human-readable version of all of this is served at `/mcp/docs`.

### Deploy checklist

1. **Set `MCP_PUBLIC_BASE_URL`** in `.env` to the public https origin, no trailing
   slash. This is the single most common cause of a connector that will not
   attach — see below.
2. **Let nginx forward the whole path.** `/mcp`, `/mcp/oauth/*` and
   `/.well-known/*` must all reach the app. A `location /` proxy already does
   this; a path-restricted config may not.
3. **Forward the proxy headers:**

   ```nginx
   location / {
       proxy_pass http://127.0.0.1:29314;
       proxy_set_header Host              $host;
       proxy_set_header X-Forwarded-Proto $scheme;   # ← without this, OAuth breaks
       proxy_set_header X-Forwarded-Host  $host;
       proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
       proxy_read_timeout 300s;   # build_icp / generate can run for minutes
   }
   ```

4. **Verify before touching Claude** — these two must both return JSON whose URLs
   are `https://` and match your domain:

   ```bash
   curl https://your-domain/.well-known/oauth-protected-resource
   curl https://your-domain/.well-known/oauth-authorization-server
   ```

   And this must return `401` with a `WWW-Authenticate` header:

   ```bash
   curl -i -X POST https://your-domain/mcp \
     -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
   ```

   If the URLs come back as `http://`, step 1 or 3 is missing. If you get a 404,
   step 2 is.

---

## 2. What "changing the logic" means

The behaviour of the ICP builder and the script maker comes from three layers.
`get_logic` returns all three at once so nobody has to guess which one to edit.

| Layer | Where it lives | What it controls |
|---|---|---|
| **House lens** | `settings.systemFilter.{lens,messaging,icpScripter,offers}` | Agency-wide knowledge and taste, injected as the first system block on every AI call. |
| **Engine slots** | `settings.engines.<slot>` | The builders' own system prompts — the ICP builder's brain, the first-liner engines, the script-writer persona, the refiners and extractors. |
| **Structure** | `settings.globalRules`, `frameworks[]`, `settings.builderButtons` | Blanket style rules, the script templates, the one-click rewrite chips. |

### Engine slots

Before this, every one of those prompts was a hardcoded string in
`src/server/outreach.ts`, `src/server/generate.ts` and `src/lib/sync/engines.ts`.
They still are — as the **defaults**. `src/server/prompts.ts` layers an optional
override on top, read from `settings.engines`:

```
settings.engines = { icpBuilder: "…", scriptWriter: "…", … }
```

An **absent, empty or whitespace-only** value means "use the shipped default", so:

* existing installs behave exactly as before (the field starts empty),
* any slot is revertible with `set_logic mode="reset"`,
* both the browser and the MCP server resolve the same override, so a change made
  from Claude immediately affects what the web app sends.

| Slot | Kind | Used by |
|---|---|---|
| `icpBuilder` | full | `build_icp` |
| `icpAngles` | lens | `build_icp`, `suggest_angles`, `suggest_offers`, `fuse_angle` |
| `icpExample` | full | `find_icp_example` |
| `scriptWriter` | preamble | `generate` |
| `scriptFirstLiner` | lens | `generate` |
| `scriptRefiner` | full | `refine_script` |
| `selectionRefiner` | full | `refine_selection` |
| `angleSuggester` | full | `suggest_angles` |
| `fuseAngle` | full | `fuse_angle` |
| `offerSuggester` | full | `suggest_offers` |
| `frameworkExtractor` | full | `extract_framework` |
| `followupWriter` | preamble | `generate_followups` |
| `mechanismBuilder` | lens | the wizard's mechanism step |
| `transcriptExtractor` | full | `extract_transcript` |
| `clientBrief` | full | `compose_client_brief` |

* **full** — the override replaces the whole system prompt. The JSON output
  contract is re-appended by code afterwards and **cannot** be overridden, so a
  bad override can never break response parsing.
* **preamble** — the override replaces only the persona/instruction opening; the
  structural remainder (templates, output format, item counts) is assembled by
  code.
* **lens** — a methodology block injected as a cached prefix, consumed by both
  the browser (`lib/sync/systemFilter.ts`) and the server (`server/lens.ts`).

### The loop

```
get_logic                     read what the builder currently believes
set_logic dryRun=true         draft the change, see the before/after
set_logic                     save it (atomic; the web app picks it up at once)
preview_prompt                read the exact assembled prompt — costs nothing
build_icp / generate_scripts  run it for real
```

`mode="append"` on a slot that has never been customised appends to the **shipped
default** rather than replacing it — adding a rule is the common case and it
should not silently wipe the prompt.

---

## 3. Tools

33 tools, ordered so a host shows orientation first.

**Orientation** `whoami` · `search` · `fetch`
**Logic** `get_logic` · `set_logic` · `preview_prompt` · `preview_lens`
**Clients** `list_clients` · `get_client` · `upsert_client`
**ICP** `build_icp` · `list_icps` · `upsert_icp` · `find_icp_example`
**Scripts** `generate_scripts` · `list_scripts` · `upsert_script` · `refine_script`
**Frameworks** `list_frameworks` · `upsert_framework` · `extract_framework`
**Rewrite chips** `list_builder_buttons` · `upsert_builder_button`
**Ideation** `suggest_angles` · `suggest_offers` · `generate_followups`
**Niches** `list_niches` · `upsert_niche`
**Research** `research` · `extract_transcript`
**Ops** `usage_report` · `get_config` · `patch_config`

**Resources** `outreach://guide` (how the machine works) · `outreach://logic/current`
· `outreach://logic/defaults` (the un-overridden text of every slot) ·
`outreach://clients`

**Prompts** `tune-icp-logic` · `tune-script-logic` · `onboard-client` ·
`diagnose-weak-output`

---

## 4. How it stays safe

* **Same guardrails as the UI.** AI calls go through `callAction`, which composes
  the house lens server-side, enforces the daily spend cap and records usage — so
  MCP traffic shows up in Admin → Usage like everything else.
* **Atomic writes.** Every mutation is a compare-and-swap against the single
  config row, re-reading and re-applying on conflict (up to 4 attempts). A
  teammate editing in the browser is never clobbered. Verified with 8 concurrent
  writes: no lost updates.
* **The board's rules hold.** Max 8 scripts in Testing; near-duplicate scripts
  (Jaccard ≥ 0.82) dropped from a run.
* **Scopes.** `outreach:read` and `outreach:write`. Write tools are refused with a
  readable message on a read-only connection.
* **Generators default to not saving.** `save=false` and `dryRun` are the defaults
  on the destructive paths, and the server instructions tell the model to show
  its work before persisting.

---

## 5. Auth internals

An unauthenticated `POST /mcp` returns **401** with:

```
WWW-Authenticate: Bearer realm="outreach-script-bot",
  resource_metadata="https://your-domain/.well-known/oauth-protected-resource"
```

That header is the entire discovery trigger — without it, hosts report a
connection failure instead of opening the sign-in popup.

| Endpoint | Spec |
|---|---|
| `/.well-known/oauth-protected-resource` | RFC 9728 |
| `/.well-known/oauth-authorization-server` | RFC 8414 |
| `/mcp/oauth/register` | RFC 7591 dynamic client registration |
| `/mcp/oauth/authorize` | authorization code + PKCE S256 |
| `/mcp/oauth/token` | code exchange + refresh with rotation |

The `.well-known` paths are `rewrites` in `next.config.ts` pointing at
`/api/mcp/well-known/*`, because Next's file router ignores dot-prefixed
directories.

Clients, codes and tokens live in the existing `kv` table (`mcp:client:*`,
`mcp:code:*`, `mcp:at:*`, `mcp:rt:*`) — **no schema migration**, which matters
because `db/init/01_schema.sql` only runs on a database's first boot. Secrets are
stored as SHA-256 digests. Codes are single-use with a 60s TTL; refresh tokens
rotate on use and are only retired after the exchange fully validates, so a
rejected refresh does not brick the connector.

---

## 6. Source map

```
src/server/prompts.ts              slot registry: defaults, overrides, resolution
src/server/lens.ts                 server-side house-lens composition
src/server/mcp/
  auth.ts                          bearer gate, base-URL resolution, 401 challenge
  oauth-store.ts                   kv-backed clients/codes/tokens + PKCE
  config-io.ts                     CAS-retry mutateConfig + lookup/path helpers
  context.ts                       ICP dossier + generate payload (ports of the UI)
  invoke.ts                        lens + spend cap + usage metering around dispatch
  server.ts                        JSON-RPC / MCP method dispatch
  resources.ts                     resources + guided prompts
  tools/{core,logic,icp,scripts}.ts
src/app/mcp/route.ts               the endpoint
src/app/mcp/{docs,oauth/*}/route.ts
src/app/api/mcp/well-known/*       discovery documents (reached via rewrites)
```
