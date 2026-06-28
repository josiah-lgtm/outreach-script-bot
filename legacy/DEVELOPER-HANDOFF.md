# Developer Handoff — Outreach Script Bot ("script.bot")

_Last updated: 2026-06-19. This document is the single source of truth for a developer
taking over the bot. It covers what the bot is, the owner's intentions, the architecture,
everything changed in the recent engagement (done and not-done), every API key / secret and
when it's used, the Notion integration in detail, and the known-flawed / constrained APIs and
why they're used._

---

## 1. What the bot is

An **AI cold-outreach script generator** for an agency. For each client it:
- Builds an ICP / niche profile, pain points, desired outcomes, offers, and a "mechanism".
- Generates cold-email/LinkedIn scripts from frameworks, run through a house "system filter" (brand lens).
- Lets the user review scripts Tinder-style (keep/pass), rewrite them with one-click buttons, and organise them on a per-client **script board** (Ideas → Testing → Winning).
- Builds growth plans and follow-up sequences.
- Exports scripts and plans to **Notion**.

It is a **single-page app** (`index.html`, ~7k lines of inline JS) served by a **Supabase Edge Function** (`supabase/functions/outreach-bot/index.ts`, Deno/TypeScript) that proxies **Anthropic Claude** and **Notion**.

---

## 2. Owner's intentions & objectives

In the owner's words, across the engagement, the goals are:

1. **Per-client, niche-specific script generation** — selecting a niche/"group" should load only that client's data for that niche, with no cross-client or cross-niche leakage.
2. **Speed and control** — fast (auto) regrouping, one-click rewrite buttons the owner can fully configure (prompts, examples, model), and an explicit Save.
3. **A real testing workflow** — scripts move Ideas → Testing → Winning; winners feed back into generation ("learning"); cap active tests so the board stays focused.
4. **Research actually shows up** — pains/desires found during research must appear in the builder for that niche.
5. **Notion as the system of record** — export selected scripts to a "clients script testing board" database (client, niche, status, who we're targeting, # tests, date + the scripts), living in the data workspace.
6. **Frictionless ops** — every page has a URL (open in tabs, refresh-restore), a client search, and deploys that don't require hand-passing secrets.

---

## 3. Architecture

```
Browser (index.html, one file)
  ├─ Legacy "builder" UI:  state.*  + renderClientList/renderOutput/renderReservoir/renderAdmin
  └─ "V9" client-centric UI: window.V9 + renderV9 (client list, client detail, script board, wizard)
        │  api(body) → POST {action, ...}  (x-admin-key header)
        ▼
Supabase Edge Function "outreach-bot" (Deno)  supabase/functions/outreach-bot/index.ts
  ├─ Serves the UI:        GET → HTML (bundled from index.html into html.ts)
  ├─ Auth gate:            every action requires x-admin-key === ADMIN_KEY (except "login")
  ├─ Config store:         get_config / save_config (per-workspace config JSON)
  ├─ AI actions:           generate, suggest_angles, build_icp, suggest_offers, refine_script,
  │                        categorize/grouping, mechanism builder, research_*, compose_* …
  └─ Notion actions:       export_notion (page), export_notion_db (DB row), create_notion_db
        │
        ├─ Anthropic Claude  (_shared/anthropic.ts)   ← ANTHROPIC_API_KEY
        └─ Notion REST API   (api.notion.com)         ← NOTION_API_KEY (integration "NEW")
```

- **The website IS the function.** `deploy.sh` / CI bundles `index.html` into `supabase/functions/outreach-bot/html.ts`, and the function returns it on GET. **There is no separate web host.** So a frontend change is only live after a deploy.
- **Config** lives in `window.config` (clients, niches, frameworks, settings). It's saved to `localStorage['outreach_config_v2']` immediately and debounce-synced to the server via `save_config`. On load: `get_config` (if admin key) → else localStorage → else `DEFAULT_CONFIG`.
- **Auth**: a team login (email+password) returns the shared admin key; or open with `?admin=KEY`. The key is stored in `localStorage['offer_admin_key']` and sent as `x-admin-key`. The function rejects any action without the right key (HTTP 401).
- **Models** (`_shared/anthropic.ts`): `CLAUDE_MODEL='claude-sonnet-4-6'` (default), `CLAUDE_MODEL_OPUS='claude-opus-4-6'`, `CLAUDE_HAIKU='claude-haiku-4-5'`.
- **Project**: Supabase project ref `pturxqgrhywyhylxovun`; function URL `https://pturxqgrhywyhylxovun.supabase.co/functions/v1/outreach-bot` (also `OUTREACH_BOT_URL` in `index.html`).

---

## 4. File map

| File | What it is |
|---|---|
| `index.html` | The entire frontend (inline CSS + JS). Legacy builder + V9 client UI + admin. |
| `supabase/functions/outreach-bot/index.ts` | The edge function: all actions, auth, Claude + Notion calls. |
| `supabase/functions/outreach-bot/html.ts` | Generated bundle of `index.html` (do not hand-edit). |
| `supabase/functions/outreach-bot/bundle.ts` | Bundles `index.html` → `html.ts` (used by CI and deploy.sh). |
| `supabase/functions/_shared/anthropic.ts` | Claude model ids + `messages()` helper. |
| `deploy.sh` | Manual deploy (needs `SUPABASE_TOKEN`). cd's to its own dir. |
| `.github/workflows/deploy.yml` | **CI auto-deploy** on push to `main` (uses `SUPABASE_ACCESS_TOKEN` GitHub secret). |
| `FIRST-LINER-ENGINE.md`, `MECHANISM-BUILDER.md`, `BACKEND-system-filter.md` | Methodology specs baked into prompts. |
| `/tmp/run/dev-server.ts` | **Local mock** dev server (mocks the edge function; not in the repo). Used for preview testing. |

### Key code locations in `index.html`
- `showScreen` / `osNav` / `switchTab` / `switchAdminTab` — screen + tab navigation.
- **Hash router**: `currentRoute` / `syncHash` / `applyRoute` + `hashchange` listener (near `osNav`). Boot restore in `loadConfigAndRender` (captures `location.hash` first).
- `loadConfig` / `persistConfig` / `migrateConfig` — config load/save/migration.
- `client()`, `niche()`, `primaryNicheId()`, `clientPains/Desires/Offers`.
- **Niche buckets**: `nicheBucket` / `nichePains` / `nicheDesires` / `nicheOffers` / `nicheSavedAngles` (~line 1380).
- **Builder buttons**: `defaultBuilderButtons` / `builderButtons` (~1395); admin UI `adminBuilderButtons` + `osBtn*` handlers (~2950); runtime `osWizTx` + `swRefine` in the V9 IIFE.
- **Reservoir** (legacy script board): `renderReservoir` (~2662); Notion export helpers `boardSel/boardCid/boardRerender/toggleBoardSel/openBoardExport/boardDoExport` (~2771).
- **V9 board** (client overview kanban): `v9BoardHtml` (~6733) with per-card export checkbox; export bar in `v9Section` overview.
- **V9 client list + search**: `v9List` (~6713), `v9Card` (anchor for open-in-new-tab), `osSearch` / `v9Match`.
- **Create-script wizard**: `v9Wizard` (~6760) — step 1 "Pick a Group", steps for pains/desires/mechanism/proof/framework, swipe review; `osWiz*` handlers.

### Key actions in the function (`index.ts`)
- Auth/config: `login`, `users_*`, `get_config`, `save_config`.
- AI: `generate`, `suggest_angles`, `build_icp`, `suggest_offers`, `fuse_angle`, `ai_edit_text`, `extract_framework`, `extract_transcript`, `refine_script`, `refine_selection`, `research_client_site`, `research_niche`, `research_competitors`, `compose_*`.
- Notion: `export_notion` (page under a page), `export_notion_db` (one row in a database, schema-aware), `create_notion_db` (creates the testing-board database).
- Helpers: `pickModel` (alias→model), `toNotionBlock`, `nRich`, `dashifyId`, `parseJson`.

---

## 5. Data model (the `config` object)

```
config = {
  version: 2,
  settings: {
    globalRules, notionParentId,                 // growth-plan export parent page
    notionBoardDbId, notionBoardName,            // script-testing-board database
    systemFilter: { enabled, lens, messaging, icpScripter, offers, model },
    builderModel: 'sonnet'|'opus'|'haiku',       // default model for rewrite buttons
    builderButtons: [ { id, label, icon, prompt, examples, keepStructure, enabled, model } ],
    planDefaults: { email:{…}, linkedin:{…}, personalization:{…} },
  },
  frameworks: [ { id, name, category, template, rules, nicheIds[] } ],
  niches:     [ { id, name, angles[], triggerWords[], transcripts[] } ],   // GLOBAL, shared by clients
  clients:    [ Client ],
  winningScripts: [...], toolsKB: [...],
}

Client = {
  id, name, meta, website, contact, csm, stage, tags[],
  nicheIds: [nicheId, …],                        // which niches this client targets (first = primary)
  icps: [ { id, title, niche, description, pains[], desires[], objections[], painGroups[], desireGroups[] } ],
  caseStudy: { pains[], desires[], offers[], caseStudies[], mechanism, … },   // client-wide
  nicheData: { [nicheId]: { pains[], desires[], offers[] } },  // PER-NICHE buckets (isolation, #6)
  _nicheMigrated: true,                           // one-time backfill guard
  mechanisms: [...], activeMechId,
  savedAngles: [ { id, text, nicheId, src } ],    // research/composed angles (niche-tagged)
  scriptReservoir: [ Script ],                    // the script board
  painGroups[], desireGroups[], guarantees[], followups[], growthPlans[], sources{}, transcripts[],
  favorites{}, brief,
}

Script (scriptReservoir item) = {
  id, name, framework, angle, label, nicheId,
  status: 'idea'|'testing'|'winning',             // board column
  script, note, savedAt, versions[],
}
```

**Niche isolation logic (important):** `nichePains(c, nid)` returns that niche's bucket + the niche's `angles` + `savedAngles` tagged to it, **plus** (only for the client's **primary** niche) the client-wide `caseStudy`/transcript pains. Non-primary niches stay isolated. This is a deliberate compromise between strict isolation (#6) and "research pains must show" (#2) — research/edit-profile pains land in `caseStudy.pains`, so the primary niche folds them in. `nicheDesires`/`nicheOffers` follow the same rule.

---

## 6. Change log — this engagement

All commits below are on `main`. ✅ = done & verified, ⚠️ = done with a caveat, ❌ = not done / out of scope.

### Script-builder pass (commit `c25e0b2`, pre-handoff)
- ✅ Uniqueness dedup 36→30 (near-dup Jaccard filter + diversity directive).
- ✅ Mechanism count bug (generation now uses only the selected `activeMechId`).
- ✅ Stronger lens reframe; rewrite options keep framework/length; added Salesy/Softer.
- ✅ 8-card Testing cap (rest stay in Ideas as "card storage").
- ✅ Feed winning/kept scripts into generation (learning).

### "Do all 3" (`60a139f`)
- ✅ **#6 Niche-scoped data** — per-niche `nicheData` buckets; all reads/writes/generation routed through them; idempotent backfill of existing case-study items into the primary niche.
- ✅ **#3 Group-first** — wizard step 1 is "Pick a Group" (a niche bundle) with a readiness badge; selecting one auto-loads pains/desires and flags what's missing.
- ✅ **#5 Fast auto-regroup** — `localRegroup`/`wizRebucket` re-slot new/edited items into existing AI themes by word overlap (no AI call) after every edit; the AI "Re-group" button still does a full pass.

### Filter "not working" (`78e9b85`)
- ✅ The per-step **Filter** silently swallowed rewrite errors and always claimed success. Now `osWizFilterStep` tracks changed/unchanged/failed and reports honestly (e.g. "Filtered 3 of 5", or "couldn't reach the rewriter — N failed: <error>"). Removed the word "short" from the reframe prompt (clearer; it also tripped the mock's truncation branch).

### Per-client groups / research pains / Reformat / Builder Buttons dashboard (`38fe611`)
- ✅ **Create New Scripts showed every niche** → step 1 now lists only the client's own `nicheIds` (no fallback to all).
- ✅ **Research pains weren't showing** → `nichePains/Desires/Offers` now fold in the primary niche's client-wide + transcript + saved-angle items (see §5).
- ✅ **Reformat** rewrite button added.
- ✅ **Builder Buttons dashboard** (Admin → 🎛 Builder Buttons): edit each rewrite button's prompt + examples, rename, set icon, enable/disable, "keep structure & length" toggle, add/delete, reset. Toolbar renders from `config.settings.builderButtons` via generic `osWizTx(id)`.

### Save + model picker (`dba6cab`)
- ✅ Explicit **Save / Save all changes** in the dashboard (reads every field from the DOM so un-blurred edits are captured).
- ✅ **Claude model picker** — default model + per-button override (Sonnet/Opus/Haiku). Frontend passes `model` to `refine_script`; backend `pickModel` maps alias→model id (defaults to Sonnet; other actions unaffected).
- ⚠️ Scope is the **rewrite (swipe) buttons only** — the owner chose this. The data/step buttons (AI ideas, Group, Filter, Build mechanism) are **not** prompt-configurable (❌ out of scope).
- ⚠️ The System-Filter model dropdown lists "Gemini" but the backend `pickModel` only maps sonnet/opus/haiku — Gemini is **not wired** (falls back to Sonnet).

### Notion script-board export (`be64af6`, `8173c5c`, `e619907`, `9dccb90`)
- ✅ `export_notion_db` action — creates one DB row per export. **Schema-aware**: reads the target database's columns and maps our fields (client, niche, status, target, # tests, date) to whatever the columns are named/typed.
- ✅ Frontend: checkboxes + "Export N to Notion" on **both** the Reservoir tab and the **V9 client-overview board**; modal prefills client/niche/today/# tests/target/status; Admin → Settings field for the DB id (blank = auto-find by name).
- ✅ **Status 400 fix** (`8173c5c`) — `matchOption` maps a requested status to the column's existing option (exact → substring → 4-char prefix); for `status`-type columns it skips rather than erroring; `select` reuses a match or sends the value.
- ✅ `create_notion_db` (`e619907`/`9dccb90`) — one-click "Create database in Notion" button under a chosen page; Client/Niche are **rich_text**, Status is a **select** preloaded with Test idea/Testing/Winner.

### CI / deploy (`ea7f2e7`, `be4c946`)
- ✅ `.github/workflows/deploy.yml` auto-deploys on push to `main` using the `SUPABASE_ACCESS_TOKEN` GitHub secret — **the deploy token never goes through chat again.** `bundle.ts` keeps CI and `deploy.sh` building `html.ts` identically.

### Client view: routing, refresh, search (`57937b9`)
- ✅ **Hash routing** — every view has a URL: `#/clients`, `#/client/<id>/<sec>`, `#/admin/<tab>`, `#/sales`, `#/growth`. Client cards are real `<a href>` (cmd/middle-click → new tab). Refresh / shared links / back-forward restore the page.
- ✅ **Clients search** — always-visible search box top-left of the clients view (was buried in the filter panel); filters by name/contact/meta with focus retained.

### Notion database (done via the Notion MCP, not in code)
- ✅ Created the **`clients script testing board`** database (ID `5b412212338d43e88032956b4b1e41a8`) under **CSM Operations**, then **moved it inside the "Clients Script Testing Board" row** of the **AA Sheets & Resources** database (so opening that entry shows the real database, not a link). Schema: Name (title), Client (text), Niche (text), Status (select: Test idea/Testing/Winner), Who we're targeting (text), Number of tests (number), Date (date).
- ⚠️ A labelled **test row** ("✅ TEST ROW — Acme") was left in the board for reference (offered to delete).

---

## 7. API keys & secrets — what, where, when

**No secret is in the repo or the browser.** All live as Supabase Edge Function secrets (set via `supabase secrets set` / `deploy.sh`), except the deploy token which is a GitHub Actions secret.

| Secret | Where | Used for | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Supabase secret | Every Claude call (generation, refine, grouping, research, mechanism, ICP, offers) via `_shared/anthropic.ts` | Pre-existing. |
| `ADMIN_KEY` | Supabase secret | Guards every function action (`x-admin-key`). Team `login` returns it to authenticated users. | Pre-existing. Stored client-side in `localStorage['offer_admin_key']`. |
| `NOTION_API_KEY` | Supabase secret | All Notion exports — growth plans (`export_notion`) **and** the script board (`export_notion_db`, `create_notion_db`). | Integration is named **"NEW"** (integration_id `37c4fd2a-4cfe-81fe-a4db-00271ed36325`). **The same key powers both exports** — no new key was added for the script board. |
| `SUPABASE_ACCESS_TOKEN` | **GitHub Actions secret** | CI deploy only. | Added during this engagement so deploys stop requiring a hand-passed token. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase secret(s) | Referenced by the function (e.g. team-login/users storage). | Pre-existing. |

### ⚠️ SECURITY INCIDENTS — rotate these
During the engagement the owner pasted live secrets directly into chat **multiple times**. The assistant refused to use any pasted secret and flagged each one. **All of these are exposed in the chat transcript and must be rotated:**
- A **GitHub Personal Access Token**.
- **Two Supabase personal access tokens** (`sbp_…`).
- A **Notion integration token** (`ntn_…`).

Action for the new dev: rotate each at its provider, then update the **GitHub `SUPABASE_ACCESS_TOKEN` secret** (for deploys) and the **Supabase `NOTION_API_KEY` secret** (if the Notion token is rotated, re-set it and redeploy). Never paste tokens into chat/PRs/issues; deploys run through CI with the GitHub secret only.

### Two different Notion identities (gotcha)
- The **server export** uses the **"NEW" integration** (`NOTION_API_KEY`).
- The database was **created/moved by the assistant** through a **different** Notion connection (the owner's claude.ai OAuth connection).
- Therefore the new database had to be **shared with the "NEW" integration** (database → ••• → Connections → add "NEW") for in-app exports to write to it. Connections are per-object and travel when a database is moved. If exports ever 404 with `Could not find … shared with your integration "NEW"`, re-add "NEW" to the database.

---

## 8. Flawed / constrained APIs & the workarounds (why they exist)

1. **`refine_script` is overloaded.** Several features (per-step Filter, swipe rewrites, mechanism builder, grouping) "ride on" this one endpoint. It was capped at 600 `max_tokens` → JSON for mechanism/grouping got truncated ("no mechanisms could be read"). **Workaround:** raised to 4000 tokens, raised `MAX_PROMPT_CHARS` 40k→150k, and added tolerant JSON parsing (`extractJsonObjects`/`repairFirstObject`) + forced compact minified JSON. _Better long-term: give mechanism/grouping their own actions._

2. **Lens folding once broke `refine_script`.** `withSystemFilter` added extra fields / a model override that the endpoint rejected → "444 skipped" on batch filters, and oversized requests → Safari "Load failed". **Workaround:** only fold the lens into existing text fields (no extra keys), cap the folded text (~8000 chars), use a lean `composeLensLite` for generation, and surface readable network errors in `api()`.

3. **Silent failure masking.** `refine`/`swRefine` caught all errors and returned the original text, so the UI claimed success while nothing changed. **Workaround:** the per-step Filter now counts changed/unchanged/failed and reports the truth.

4. **Notion `select` options aren't auto-created via the API path used here.** Setting a select value that isn't already an option → 400. Client/niche names vary per export. **Workaround:** the created board uses **rich_text** for Client/Niche; **Status** is a `select` with fixed options; `matchOption` maps requested values to existing options.

5. **Notion `status`-type properties can't have options created via the API.** The owner's original column was a `status` type missing "Testing" → 400. **Workaround:** the bot-created board uses a **`select`** named "Status" (API-creatable) preloaded with Test idea/Testing/Winner; the export's `matchOption` also handles status columns by matching/skip.

6. **Notion: a database can't be nested inside another database.** "Move into AA Sheets & Resources" was done by moving the database **inside a row's page** of that database (a row is a page that can hold child blocks).

7. **Mock dev-server quirks (test harness only, not prod).** `/tmp/run/dev-server.ts`'s `refine_script` mock keys off the words "short"/"question" in the prompt and strips a `(mock refinement applied)` marker, so rewrites look like no-ops in preview. `dedupeScripts` is private to the V9 IIFE so it can't be called directly from `eval` during testing. These only affect local preview testing.

8. **The app is one giant `index.html`.** No build step, no modules, no component framework; state is split between the legacy `state` object and `window.V9`. This is the biggest structural constraint — every change is a careful in-place edit + full-file bundle. _Verification is done via a Deno `new Function()` syntax check across the inline `<script>` blocks and `deno check` on the function._

---

## 9. Known limitations / not done / deferred

- ❌ **Data/step buttons aren't prompt-configurable** (only the rewrite buttons are) — owner's explicit scope choice.
- ⚠️ **Gemini** appears in the System-Filter model dropdown but isn't wired in the backend (only Claude models map).
- ⚠️ **Real in-app Notion export wasn't run by the assistant** (it requires the owner's admin key, which the assistant won't take). It was verified via a Notion-MCP test row + by capturing the exact `export_notion_db` payload against a mock. The owner should do one real export to confirm the "NEW"-integration path end-to-end.
- ⚠️ **Niche isolation is intentionally relaxed for the primary niche** (it folds in client-wide case-study/transcript pains so research shows). Multi-niche clients see shared `caseStudy` items under their primary niche only.
- ⚠️ **Test row** left in the board.
- ⚠️ **Status option names matter** — exports populate Status only if the column's options resemble Test idea/Testing/Winner (the bot-created board already matches).

---

## 10. How to run, deploy, test

**Local preview (mocked backend):**
```bash
PORT=8788 deno run --allow-read --allow-net --allow-env /tmp/run/dev-server.ts
# serves index.html at http://localhost:8788 with the edge function mocked
```
The mock seeds nothing; sign in is bypassed by injecting a config into `localStorage` + an `offer_admin_key`, or POST `{action:'save_config', config}` to `/mock/outreach-bot` then reload. (The mock is a dev convenience, not in the repo.)

**Deploy (preferred — CI):** push to `main`. `.github/workflows/deploy.yml` bundles `index.html`→`html.ts` and runs `supabase functions deploy outreach-bot`. Requires the `SUPABASE_ACCESS_TOKEN` GitHub secret. Watch the **Actions** tab.

**Deploy (manual fallback):**
```bash
SUPABASE_TOKEN=sbp_xxx bash /path/to/outreach-script-bot/deploy.sh
```

**Verify a deploy** (no auth needed): `curl https://pturxqgrhywyhylxovun.supabase.co/functions/v1/outreach-bot` and grep for a marker from the change (frontend functions appear in the served HTML; backend functions do not).

**Syntax/type checks before pushing:**
```bash
deno check supabase/functions/outreach-bot/index.ts
# frontend: extract inline <script> blocks and run `new Function(src)` on each (see prior tests)
```

---

## 11. Recommended next steps / tech debt

1. **Rotate all pasted secrets** (see §7) — highest priority.
2. **Confirm one real Notion export** end-to-end now that the board is shared with "NEW".
3. **Split `refine_script`** into purpose-specific actions (rewrite vs mechanism vs grouping) to stop fighting token caps.
4. Consider a **build step / modularising `index.html`** if the app keeps growing.
5. Wire **Gemini** in `pickModel` or remove it from the UI to avoid confusion.
6. Optionally make **data/step buttons** configurable if the owner later wants it.
7. Delete the leftover **test row** in the board when no longer needed.

---

## 12. Notion object reference

| Object | ID / URL |
|---|---|
| Script testing board (database) | `5b412212338d43e88032956b4b1e41a8` · https://app.notion.com/p/5b412212338d43e88032956b4b1e41a8 |
| …its data source (collection) | `46097d25-b04f-4de3-ac93-d655e44312c8` |
| AA Sheets & Resources (index DB) | `3234fd2a4cfe80979ac7e6a29228b75e` (collection `3234fd2a-4cfe-80de-9db5-000bb2de56d4`) |
| "Clients Script Testing Board" entry (holds the DB) | `3844fd2a4cfe81419e7ff8b619214e95` |
| CSM Operations (original parent page) | `3444fd2a4cfe80fa9f77dddfab8ad806` |
| Growth-plan export parent (`notionParentId`) | `3744fd2a4cfe8015830fc724e06dcdb3` |
| Notion integration | **"NEW"** — `37c4fd2a-4cfe-81fe-a4db-00271ed36325` |
