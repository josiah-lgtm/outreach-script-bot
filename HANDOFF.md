# HANDOFF — Outreach Script Bot → self-hosted Next.js + Postgres migration

_Last updated mid-migration. This is the single entry point for an agent taking over._
_Approved plan (more detail): `C:\Users\Harun\.claude\plans\stateful-tinkering-creek.md`._

---

## 0. TL;DR — where we are

We are migrating a legacy single-file app to a **fully self-hosted Next.js + Postgres app in Docker** (no Supabase at runtime). The **entire backend + data layer + infrastructure is DONE and verified** (`tsc` clean, eslint clean, 74 unit tests green, `next build` green). **The UI design system + app shell are now also DONE** (Phase 5 + the shell/login/boot of Phase 6). **What remains is the rest of the Phase-6 screens** in `web/`.

> **Update (2026-06-27):** Phase 5 (design system + primitive library) is built and verified, plus the app shell: `globals.css` @theme tokens, `src/components/ui/*` primitives, `ToastProvider`, `AppShell` (top nav + save-status pill + boot + login gate), `LoginModal`, a first functional **Clients** grid (`/clients`, search + cards-as-links), and stub pages for every other route so the whole app navigates. **All four gates green** (typecheck, lint, 74 tests, `next build` standalone). See §3/§4. Next: build the shared cross-screen components (ScriptEditModal, ClientEditor, `notion-blocks.ts`, lens helpers), then fan out the remaining screens.

> **Update 2 (2026-06-27):** First Phase-6 vertical slice landed — the **client OVERVIEW screen**: the **kanban script board** (`src/components/board/KanbanBoard.tsx`, @dnd-kit drag Ideas/Testing/Winning, max-8 Testing guard, drop-to-delete-with-confirm, per-client export selection), the shared **`ScriptEditModal`** (`src/components/ScriptEditModal.tsx` — version rail + AI rewrite + highlight→`refine_selection`), the **`BoardExportModal`** (Notion `export_notion_db`), the **lens helpers** (`src/lib/sync/lens.ts` — filterIdea/refineBatch/notifyFiltered), and a per-client board-selection slice in `uiStore`. The overview section of `/client/[id]/[sec]` now renders the real board + read-only context cards (other sections still ComingSoon). **All four gates green** (re-verified). **Live-stack runtime check (Phase 8) NOT yet done** — needs a DB + admin key. Next: the **create-script wizard + swipe deck** (wires into the board's "Create new script" button, which currently just toasts), then admin → growth → sales.

> **Update 3 (2026-06-27):** The **create-script wizard + swipe deck** is built (launches from the board's "Create new script" button). New files: data/actions layer `src/lib/sync/wizard.ts` (niche/client aggregators, builderButtons, wizCount, localRegroup, **all store mutations through `update()`**: addPain/Desire, AI suggest more, categorize, moreInTopic, buildMechanism/pickMechanism, runFilterStep, commitWizardSelections, generateDeck, variateScript, suggestAngles, keepCard/keepCards + `WizState`/`DeckCard`/`BuilderButton` types). Components `src/components/wizard/`: `CreateScriptWizard.tsx` (modal state machine — flow menu + 6 steps + generating + swipe; reuses `ScriptEditModal`), `parts.tsx` (StepBar/WizMenu/GroupedPicker/PickRow/AddRow/MechanismCards), `SwipeDeck.tsx` (**@use-gesture/react + @react-spring/web drag-to-swipe**, keep/pass buttons, undo/redo, clean-up, config-driven rewrite chips, +N variants, Keep all). Reused the already-ported `parseMechanisms`/`mechToText`/`categorizeList` from `lib/ai-json.ts` and `dedupeScripts` from `lib/dedupe.ts`. Flows: **new** (full 6-step→swipe), **From a script** (variate→swipe), **Find angles** (suggest+add to niche) all built; **Follow-up** shows a "coming with the follow-up builder" notice (that screen is still unbuilt — §4). **All four gates green.** **Phase-8 live-stack check still NOT done** for the wizard (drag-swipe, generate matrix, mechanism build, AI categorize, lens filter-step all need a DB + Anthropic key). Next: **admin → growth → sales**, plus the follow-up-sequence builder + `ClientEditor` + `notion-blocks.ts`.

- `legacy/` — the old app (one 7.7k-line `index.html` + a Deno Supabase Edge Function). **Untouched and still deployable** to Supabase as a fallback.
- `web/` — the new full-stack Next.js 16 app. **Build here.**

> **▶ NEW AGENT, START HERE:** the backend, data layer, **design system, app shell, the client OVERVIEW (kanban board + `ScriptEditModal`), and the create-script wizard + swipe deck** are all done and verified (4 gates green — see §3). Your job is the remaining Phase-6 screens — see the **Remaining-work checklist** at the top of §4. **Start with `/admin/[tab]`** (the largest remaining screen) or the **follow-up-sequence builder** (the wizard's "Follow-up" menu option is a notice waiting on it). Read **§4.1 for the design-system API you import** (`@/components/ui`), and study `src/lib/sync/wizard.ts` + `src/components/wizard/*` as the reference pattern for **store-mutating actions through `update()`** + an immer-`produce` local state machine. Read §6 for the invariants you must not break. Working tree has **uncommitted changes** (nothing committed this session) — `git status` shows the new `web/src/components/**`, `web/src/lib/**`, `web/src/app/**`. **Run the 4 gates (§7) before handing back; none of the new UI has had a live-stack runtime check (Phase 8) yet.**

---

## 1. Locked decisions (from the owner — do not relitigate)

1. **Fully self-hosted, no Supabase at runtime.** Everything runs via `docker compose up` on the owner's server.
2. **Backend ported into Next.js route handlers** (Node runtime). The old Deno edge function's 35 actions now live in `web/src/server/*` behind `POST /api/outreach`.
3. **Data faithful:** the app config is ONE Postgres `config` row (`jsonb data` + integer `rev`) with an **atomic compare-and-swap**; `users`/`usage`/`secrets`/`login-attempts` live in a `kv` table. The merge/migrate/conflict logic is preserved verbatim from the legacy client.
4. **Shared-admin-key auth retained.** The server validates `x-admin-key` against the `ADMIN_KEY` env var; team `login` exchanges email+password (PBKDF2) for that key. **No Supabase Auth, no Postgres-normalized tables** — that was explicitly out of scope.
5. **Full UI rebuild in one pass**, faithful to behavior, "make the UI better where possible" (cosmetic only — see §6).
6. **Keep `legacy/` working** as a fallback (its repointed Supabase deploy still works).

---

## 2. Architecture

```
Browser (Next.js client components; holds a per-user admin key in localStorage)
  │  POST /api/outreach {action, ...} + x-admin-key   (same-origin)
  ▼
Next.js route handler  src/app/api/outreach/route.ts   (Node runtime)
  → src/server/outreach.ts  (the 35-action dispatch)
      ├─ config (jsonb+rev, atomic CAS) · kv(users/usage/secrets/login-attempts) ── Postgres
      ├─ Anthropic Claude + web_search (pause-turn loop)  ── ANTHROPIC_API_KEY (server env)
      └─ Notion REST                                      ── NOTION_API_KEY (server env)

docker compose:  web (Next.js :3000)  +  db (postgres:16, named volume `pgdata`)
```

The client composes the house-lens prefix and the request body exactly as the legacy app did; the server reads `body.lensPrefix` and caches it as a system block. **The request/response contract is unchanged from the legacy edge function** (so `legacy/dev-server.ts` and `legacy/.../index.ts` remain accurate references).

---

## 3. What is DONE (verified)

| Phase | Status | Notes |
|---|---|---|
| 0 Relocate old app → `legacy/`, repoint `deploy.yml` | ✅ | `git mv`; `deploy.yml` uses `paths: legacy/**` + `defaults.run.working-directory: legacy`. `legacy/deploy.sh` self-`cd`s (unchanged). |
| 1 Scaffold `web/` | ✅ | Next 16, React 19, TS strict, Tailwind v4, `output: 'standalone'`. Deps: pg, zustand+immer, @dnd-kit, @use-gesture/react + @react-spring/web, @tiptap/react, @tabler/icons-react, vitest. |
| 2 Backend port → Next.js + Postgres | ✅ | 15 modules in `src/server/*` + `app/api/outreach/route.ts` + `app/api/health/route.ts`. `tsc` + eslint clean. |
| 3 Client data/sync + state | ✅ | `src/lib/sync/*` + `src/lib/store/*` + `src/lib/notify.ts`. CAS/merge/migrate/debounced-save ported. |
| 4 Pure-logic libs + golden tests | ✅ | `src/lib/{dedupe,funnel-math,csv,text-utils,ai-json}.ts`. **74 vitest tests passing.** |
| 7 Docker + env | ✅ | `Dockerfile`, `docker-compose.yml`, `.env.example`, `db/init/01_schema.sql`. |
| 5 Design system + primitives | ✅ | `globals.css` @theme (12-color palette + legacy `var(--*)` aliases + fonts via runtime `<link>` + shadow scale + focus rings). `src/components/ui/*`: Icon (curated Tabler map), Button/IconButton, Card, Chip, Pill/StatusDot, SegmentedControl, Toggle/ToggleRow, Field family (Input/Select/Textarea/NumberInput/FormField/Label/Hint/Grid2), TagInput, Avatar, Badge/StageBadge/StatusBadge, Tabs, Accordion, Tooltip, EmptyState, Spinner/StepProgress/LoadingState, Modal, ToastProvider. Barrel: `@/components/ui`. |
| 6a Shell + login + boot | ✅ | `src/components/AppShell.tsx` (top nav, save-status pill, sign-out, `boot()` effect, `booted` gate), `LoginModal.tsx` (email/password + admin-key fallback → `afterLogin()`), `(app)/layout.tsx`, root `page.tsx`→`/clients`. ToastProvider mounted in root layout. |
| 6b Clients (first cut) | ✅ | `(app)/clients/page.tsx` — searchable client grid, cards are real `<Link href="/client/<id>/overview">`. Filters/bulk-ops/grouping still TODO. Stub pages exist for `/growth`, `/sales`, `/admin`, `/build` (ComingSoon) so all routes resolve. |
| 6c Client OVERVIEW + shared pieces | ✅ | **Kanban board** `src/components/board/KanbanBoard.tsx` (@dnd-kit; Ideas/Testing/Winning; max-8 Testing; drop-to-delete + confirm; tick→export selection). **`ScriptEditModal`** `src/components/ScriptEditModal.tsx` (version rail + `refine_script`/`refine_selection`). **`BoardExportModal`** `src/components/board/BoardExportModal.tsx` (`export_notion_db`). **Lens helpers** `src/lib/sync/lens.ts`. Board-selection slice in `uiStore`. Wired into `(app)/client/[id]/[sec]/page.tsx` overview section + read-only context cards. Other detail sections still ComingSoon. |
| — Production build | ✅ | `npm run build` (Turbopack) passes; standalone output generated (re-verified with the board UI). |

---

## 4. What's LEFT (the UI — your job)

**Remaining-work checklist** (everything below the line is unbuilt or partial; see the route table further down for legacy line anchors):

- ✅ **Create-script wizard + swipe deck** — DONE. 6-step wizard (ICP→pain→desire→mechanism→proof→framework), AI pain/desire categorization, mechanism builder, swipe deck (keep/pass, undo/redo, rewrite chips, +N variants) + drag-to-swipe gesture. Plus the "From a script" (variate) and "Find angles" flows. `src/lib/sync/wizard.ts` + `src/components/wizard/*`. Launches from the board's "Create new script" button. (Wizard's **Follow-up** menu option is a notice — needs the follow-up-sequence builder below.) Phase-8 live-stack check still pending.
- ⬜ **`/admin/[tab]`** — 11 tabs. Largest remaining screen ← _good next step._ Currently one ComingSoon stub.
- ⬜ **`/growth`** — growth-plan builder (Tiptap doc + deterministic funnel math + `notion-blocks.ts` port).
- ⬜ **`/sales`** — 5-step prospect pipeline.
- ⬜ **Client detail — `niche` / `growth` / `client` / `history` sections** (overview is done). The `client` section + Admin both need a shared **`ClientEditor`** (legacy `osEditClientFull` physically moved a DOM node — rebuild as ONE component).
- ⬜ **`/build`** — de-emphasized legacy matrix builder (lowest priority).
- 🟡 **Clients grid finish** — niche/csm/tag/stage filters, bulk select + ops (`osBulk*` 7676), grouping, add-client. `uiStore` already has the filter/select scaffolding.
- ⬜ **Shared ports not yet done:** `ClientEditor`, `notion-blocks.ts`, mechanism-builder UI, follow-up-sequence UI.
- ⬜ **Phase 8 — live-stack verification** of ALL UI (incl. the new board): drag/delete/AI-rewrite/Notion-export against a real DB + Anthropic/Notion keys.

**Phase 5 — Design system / component library. ✅ DONE.** Built in `web/src/app/globals.css` + `web/src/components/ui/*` (see §3, row "5 Design system"). All primitives listed below exist and are exported from the `@/components/ui` barrel. When building screens, **import primitives from `@/components/ui`** — do not re-roll buttons/inputs/modals. Notes for consumers:
- `Icon` takes a legacy `ti-*` name (prefix optional); only a curated set is mapped (`ICON_NAMES`), unknown names fall back to a dot. Add to the map in `Icon.tsx` if a screen needs a new glyph.
- Tints use CSS vars `--tint-{accent,green,amber,red}` (+ `-ring`); the 12 palette colors are Tailwind tokens (`bg-bg2`, `text-muted`, `border-border`, …) AND legacy `var(--accent)` aliases.
- `Modal` portals to `<body>`, handles Esc/overlay-close + scroll-lock; `flush`+`size="xl"` is the preset for the ScriptEditModal split layout.
- `cn(...)` is the class joiner; `Badge` has `tone` variants; `StageBadge`/`StatusBadge` are the client-stage / kanban-status pills.

**Phase 6 — Screens** (all are **client components**; routes use `useParams()`/`usePathname()` since async params can't be awaited in client components). Build order recommendation: ~~shell+login~~ ✅ → ~~clients list (first cut)~~ ✅ → ~~client detail overview + board~~ ✅ → **wizard → admin → growth → sales → build**. The shell, login, boot, Clients grid (first cut), and the client OVERVIEW (board + `ScriptEditModal`) are DONE; the wizard is next and the other routes are `ComingSoon` stubs to replace.

**Recommended next step — build the shared cross-screen pieces first, then fan out:** ~~`ScriptEditModal` (board + wizard)~~ ✅, ~~lens helpers `filterIdea`/`refineBatch`/`notifyFiltered`~~ ✅ — still to build: `ClientEditor` (admin + client "client" section) and `notion-blocks.ts` (growth + sales). The board/overview is done (§3 row 6c). **The single highest-value next screen is the create-script wizard + swipe deck** (legacy `v9Wizard` :7420, `osWizGen` :7601, `osWizSwipe` :7644): it reuses `ScriptEditModal` + the now-built lens helpers, and the board's "Create new script" button is a stub `notify()` waiting to launch it. After that: admin → growth → sales → build. These remaining screens depend only on primitives + stores + (ClientEditor / notion-blocks), so they can go in parallel.

### 4.1 — Design-system API (the contract every screen imports)

Everything below is exported from the single barrel **`@/components/ui`** (`web/src/components/ui/index.ts`). **Reuse these — do not re-roll buttons/inputs/modals/cards.** All are `"use client"` where they hold state. Props shown are the notable ones; native element attributes pass through where relevant.

| Export | Key props | Notes / legacy equivalent |
|---|---|---|
| `Button` | `variant?: primary\|secondary\|ghost\|danger\|mini`, `size?: sm\|md\|lg`, `loading?`, `icon?` (ti-name), `block?` | `.btn*`, `.mini-btn`, `.v9-newbtn`. `loading` shows spinner + disables. |
| `IconButton` | `icon` (req), `label` (req, a11y), `variant?`, `size?` | icon-only square button. |
| `Card` + `CardHeader` `CardBody` | `as?` (e.g. `Link`), `interactive?`, `selected?`, passthrough (`href`,`onClick`,dnd handlers) | `.card/.v9-card/.icp-card`. Cards-as-links: `as={Link} href=…`. |
| `Chip` | `selected?`, `tone?: accent\|green\|amber\|red`, `star?`, `onRemove?`, `onClick?` | `.chip/.fav-chip/.mix-chip`. |
| `Pill` / `StatusDot` | `tone?: green\|amber\|red\|muted`, `pulse?`, `noDot?` | header status pill (`.pill/.dot`). The save-status pill is in AppShell. |
| `SegmentedControl<T>` | `options: {value,label,title?}[]`, `value`, `onChange`, `size?` | `.seg`. Generic over the value type. |
| `Toggle` / `ToggleRow` | `checked`, `onChange`, `disabled?`; row adds `label` | `.toggle/.toggle-row`. |
| `Input` `Select` `Textarea` | native attrs + `className` | `.form-input/.form-select/.form-textarea`. |
| `NumberInput` | `value`, `onValueChange?(n)`, `percent?` | right-aligned `.num-input`; `percent` shows a `%` suffix. |
| `FormField` `Label` `Hint` `Grid2` | `FormField{label?,hint?,htmlFor?}`; `Grid2` = 2-col | `.form-group/.form-label/.hint/.grid2`. |
| `TagInput` | `value: string[]`, `onChange`, `unique?` | controlled `.tags/.tag-item` (Enter/comma adds, Backspace pops). |
| `Avatar` | `name`, `size?: sm\|md\|lg`, `accent?` | initials circle (`accent` = filled-square hero avatar). |
| `Badge` / `StageBadge` / `StatusBadge` | `Badge{tone?: neutral\|accent\|green\|amber\|red}`; `StageBadge{stage}`; `StatusBadge{status: idea\|testing\|winning, onClick?}` | `.badge2/.v9-stage/.status-*`. |
| `Tabs<T>` | `items: {value,label,icon?,count?}[]`, `value`, `onChange`, `variant?: pill\|soft`, `vertical?` | `.tab-btn/.admin-tabs/.v9-secnav`. (Don't nest `<Link>` inside — use plain Links for routed nav.) |
| `Accordion` | `title`, `meta?`, `open`, `onToggle`, children | controlled `.angle-acc/.v9-bucket`. Parent owns open state. |
| `Tooltip` | `content`, `side?`, `width?`, children | hover/focus bubble (`.v9-tip`), pre-wrapped. |
| `EmptyState` | `icon?` (ti-name), `title?`, `description?`, `action?` | `.placeholder-state/.v9-empty`. |
| `Spinner` / `StepProgress` / `LoadingState` | `Spinner{size?}`; `StepProgress{steps:string[],active:number}`; `LoadingState{steps?,active?}` | `.loading-spinner/.loading-steps` (steps before `active` read done/green). |
| `Modal` | `open`, `onClose`, `title?`, `sub?`, `footer?`, `size?: sm\|md\|lg\|xl`, `dismissible?`, `flush?` | portals to `<body>`, Esc/overlay close, scroll-lock. **`flush` + `size="xl"`** is the ScriptEditModal split-layout preset. |
| `ToastProvider` | — | already mounted in root `layout.tsx`; just call `notify()` from `@/lib/notify`. |
| `Icon` / `hasIcon` / `ICON_NAMES` | `Icon{name (ti-* or bare), size?, stroke?}` | curated Tabler map in `Icon.tsx`; **unknown names fall back to a dot — add new glyphs to the map**. |
| `cn(...)` | class joiner | use for conditional classes. |

**Design tokens (in `globals.css`):** Tailwind color utilities exist for all 12 palette colors — `bg`, `bg2`, `bg3`, `border`, `accent`, `accent2`, `green`, `amber`, `red`, `text`, `subtle`, `muted` (e.g. `bg-bg2 text-muted border-border`). Fonts: `font-sans` (Inter) / `font-mono` (Courier Prime). The same colors are also legacy CSS-var aliases (`var(--accent)` …) for verbatim-ported markup. Tints: `var(--tint-accent|green|amber|red)` + matching `-ring`, plus `--accent-ring`. Shadows: `var(--shadow-xs|sm|md|lg|modal)`. Keyframes `spin`/`pulse` + util `.animate-pulse-dot`.

| ✓ | Route | Screen | Legacy reference (in `legacy/index.html`) |
|---|---|---|---|
| ✅ | `(app)/layout.tsx` | `AppShell`: top nav, save-status pill, login gate, **boot effect** | showScreen 1869, header 740, loadConfigAndRender 6997 |
| ✅ | — | `LoginModal` (email/password + admin-key fallback) | #loginModal 909, doLogin 6907 |
| 🟡 | `/clients` | client grid + search ✅; **filters + bulk ops + grouping + add-client still TODO** | v9List 7197, v9Card 7164, v9Match 7186, osBulk* 7676 |
| 🟡 | `/client/[id]/[sec]` | detail; sec ∈ overview\|niche\|growth\|client\|history. **overview ✅; niche/growth/client/history still ComingSoon** | v9Detail 7225, v9Section 7282 |
| ✅ | (overview) | **kanban board** Ideas/Testing/Winning (DnD, max-8 testing, trash) + Notion export bar → `components/board/KanbanBoard.tsx` + `BoardExportModal.tsx` | v9BoardHtml 7219, osDropCol 7712, openBoardExport 3038 |
| ✅ | (overview) | **create-script wizard** (6 steps) + **swipe deck** (keep/pass, rewrite chips, undo/redo, +N variants) → `components/wizard/CreateScriptWizard.tsx` · `SwipeDeck.tsx` · `parts.tsx` + `lib/sync/wizard.ts`. Launches from the board's "Create new script" button. | v9Wizard 7420, osWizGen 7601, osWizSwipe 7644, swRefine 7638 |
| ✅ | shared modal | `ScriptEditModal` (version rail + highlight→`refine_selection`) — used by board + wizard → `components/ScriptEditModal.tsx` | openModalCtx 2664, editReservoirScript 2704 |
| ⬜ | `/admin/[tab]` | 11 tabs: frameworks, winning, niches, clients, followups, agency, tools, systemfilter, builderbtns, usage, settings | renderAdmin 3125, adminClients 4050, adminUsage 3283, adminSettings 4682 |
| ⬜ | `/growth` | growth-plan builder (2-pane form+preview; deterministic funnel math; **Tiptap** doc replacing contenteditable) | renderGrowth 5126, gpBuildBlocks 6353, gpEnterEdit 5712 |
| ⬜ | `/sales` | prospect pipeline (5-step research→pitch) | renderSales 6591, prospectPipeline 6704 |
| ⬜ | `/build` | de-emphasized legacy matrix builder (reuse wizard gen + shared edit modal + CSV) | generate 2142, renderReservoir 2912 |

Hard-interaction libs (already installed): **@dnd-kit** (kanban — ✅ used by KanbanBoard), **@use-gesture/react + @react-spring/web** (swipe deck — for the wizard), **@tiptap/react** (growth-plan doc; serialize its JSON model to the Notion block array — keep the block schema identical to `src/server/notion.ts`'s `toNotionBlock`).

Still to port from `legacy/index.html` when their screen is built: `notion-blocks.ts` (gpBuildBlocks 6353 / gpFollowupsBlocks 5644 / prospectDocBlocks 5993 + the `blocksFromEditorDoc` replacement for gpBlocksFromDocHtml 5830). ✅ **Already ported:** the lens helpers `filterIdea`/`refineBatch`/`notifyFiltered` (now in `src/lib/sync/lens.ts`) — the wizard's per-step filter just imports them.

**Phase 8 — Verification:** run the real stack (`docker compose up db` + `npm run dev`), drive all 35 actions from the UI, exercise the CAS conflict-merge + migrate-on-load + backup ring.

---

## 5. File map (web/)

```
web/
  Dockerfile  docker-compose.yml  .dockerignore  .env.example  vitest.config.ts
  db/init/01_schema.sql            # config(jsonb+rev) + kv tables; runs once on first compose up
  src/
    app/
      layout.tsx  globals.css  page.tsx(→/clients)
      api/outreach/route.ts        # POST: login | auth gate | daily cap | usage meter | dispatch
      api/health/route.ts          # GET 200 for Docker healthcheck
      (app)/                       # ← screens (Phase 6)
        layout.tsx                 #   renders <AppShell>
        clients/page.tsx           #   ✅ Clients grid (first cut: search + cards)
        client/[id]/[sec]/page.tsx #   ✅ overview = kanban board + context cards; other secs ComingSoon
        growth|sales|admin|build/  #   ComingSoon stubs (to replace)
    components/                    # ── UI (DONE: design system + shell + board) ──
      ui/                          #   primitives barrel (@/components/ui) — see §3 row 5
      AppShell.tsx LoginModal.tsx ComingSoon.tsx
      ScriptEditModal.tsx          #   ✅ shared editor: version rail + refine_script/refine_selection
      board/                       #   ✅ KanbanBoard.tsx · BoardExportModal.tsx · types.ts (BoardScript)
      wizard/                      #   ✅ CreateScriptWizard.tsx (state machine) · SwipeDeck.tsx · parts.tsx
    server/                        # ── backend port (DONE) ──
      db.ts                        # pg pool; getConfig; casSaveConfig (atomic CAS); kvGet/kvSet
      anthropic.ts                 # Messages API client (non-streaming, retries)
      claude.ts                    # claudeMessages wrapper: lens caching + cost meter + pause-turn loop
      usage.ts                     # metering + daily cap (AsyncLocalStorage) + AI_ACTIONS
      secrets.ts                   # admin Anthropic-key override (kv['secrets']) + rotation/test
      ssrf.ts                      # SSRF guard + fetchSiteText (node:dns rebinding check)
      shared.ts                    # limits, pickModel, webSearchTool, textOf, parseJson, json()
      notion.ts                    # toNotionBlock + export_notion/_db + create_notion_db
      research.ts                  # research / research_client_site / _niche / _competitors
      generate.ts                  # matrix generation (cached shared prefix + per-fw tail)
      auth.ts                      # PBKDF2 login + throttle (kv) + users_list/add/remove
      outreach.ts                  # the 35-action switch (dispatch)
    lib/
      dedupe.ts funnel-math.ts csv.ts text-utils.ts ai-json.ts   # pure (DONE, tested)
      notify.ts                    # toast pub/sub (onNotify/notify)
      __tests__/*.test.ts          # 74 golden tests
      sync/
        engines.ts                 # LENS_ACTIONS + FIRST_LINER_ENGINE_* + MECHANISM_BUILDER (verbatim)
        systemFilter.ts            # composeLens/Lite + clientResearch + withSystemFilter; setLensContext()
        lens.ts                    # ✅ filterIdea / refineBatch / notifyFiltered (hand-typed-line filtering)
        wizard.ts                  # ✅ create-script wizard data + AI/store actions (all mutations via update()) + WizState types
        api.ts                     # api(body) → POST /api/outreach (+ x-admin-key)
        adminKey.ts                # initAdminKey (?admin= capture+scrub), get/setAdminKey, safeStorage*
        authClient.ts              # doLogin / loginWithKey / signOut / storedUser
        configClient.ts            # DEFAULT_CONFIG, migrateConfig, mergeConfigs, backups, loadConfigData
        types.ts                   # loose Config/Client/Niche/Framework types
      store/
        saveQueue.ts               # single global debounce + in-flight guard (CAS linchpin)
        configStore.ts             # zustand+immer: boot/update/replaceConfig/_flush(serverSaveWithRetry)
        uiStore.ts                 # ephemeral view state (client-list filters/search/select + per-client board-export selection)
```

---

## 6. Load-bearing invariants — DO NOT change (owner: "watch out if we have everything correct")

- **Request contract unchanged:** the `action` set, request/response shapes, and `body.lensPrefix`-only injection (the lens is written ONLY to `lensPrefix`, never other top-level keys, never `model`). Caps: 4500 (lite), 8000 (global).
- **CAS / save:** always send numeric `baseRev` (0 when never synced); strip `_dirty` before send; a conflict comes back HTTP 200 `{ok:true,conflict:true,...}` — `api()` must NOT throw on it. **All config mutations go through `useConfigStore.getState().update(recipe)`** — never mutate `config` directly (immer freezes it; and you'd bypass the save queue + lens refresh).
- **One save queue:** `src/lib/store/saveQueue.ts` is a module-level singleton; do not create per-component debounces.
- **`migrateConfig` runs on every new config object** (load, conflict-merge, adopt, restore). It's idempotent — keep it that way.
- **Sets → arrays:** never reintroduce JS `Set`s into persisted config or the store (they don't serialize / break React identity).
- **Pure-logic constants:** dedupe Jaccard **≥0.82 rejects**, 36→30 cap; funnel-math formulas + `PD_RATE_KEYS` %↔fraction; CSV formula-injection defang (`= + - @ \t \r`); Anthropic model ids (`claude-sonnet-4-6` / `claude-opus-4-6` / `claude-haiku-4-5`); all `MAX_*` limits; Notion block schema in `server/notion.ts`. These have golden tests — keep them green.
- **Kanban:** max **8** scripts in "Testing"; drop-to-delete confirms.
- **Secrets:** `ADMIN_KEY`/`ANTHROPIC_API_KEY`/`NOTION_API_KEY` are server-only. **Never** expose any as `NEXT_PUBLIC_*`. The admin key is a per-user runtime credential in `localStorage` (`offer_admin_key`), captured from `?admin=…` (then scrubbed from the URL) or the login form.
- **localStorage keys (unchanged):** `outreach_config_v2`, `outreach_config_bak_index`, `outreach_config_bak_<ts>`, `offer_admin_key`, `outreach_user`.

---

## 7. How to run / dev loop

```bash
cd web
cp .env.example .env        # set ADMIN_KEY, ANTHROPIC_API_KEY, POSTGRES_*, DATABASE_URL

# Option A — full stack:
docker compose up -d --build           # web :3000 + postgres (schema auto-runs)

# Option B — fast dev (db in Docker, app on host):
docker compose up -d db
npm run dev                            # DATABASE_URL in .env points at localhost:5432
```

**First-run bootstrap:** there are no team users yet. Open `http://localhost:3000/?admin=<ADMIN_KEY>` to authenticate (the key is captured into localStorage and scrubbed from the URL). Then in **Admin → Settings → Team logins**, add a user (`users_add`) so people can log in with email+password. The config seeds from `DEFAULT_CONFIG` (9 demo clients) and the first save inserts the Postgres `config` row.

**Quality gates (run before handing back):**
```bash
npm run typecheck     # tsc --noEmit
npm run lint          # eslint  (any-exemption is scoped to server/sync/store/ai-json)
npm test              # vitest run (golden tests)
npm run build         # next build (standalone)
```

**Backend reference / parity:** `legacy/dev-server.ts` mocks all 35 actions; `legacy/supabase/functions/outreach-bot/index.ts` is the behavioral spec for the server port; `legacy/index.html` is the behavioral spec for every UI screen and client function (line anchors in §4).

---

## 8. Conventions & gotchas

- **Next 16 is not the Next.js you may know.** Read `web/node_modules/next/dist/docs/` first (there's an `AGENTS.md` reminder). Route handlers use Web `Request`/`Response`; params are async (use `useParams()` in client components); Turbopack is the default bundler.
- **Stores:** read config via `useConfigStore(s => s.config...)`; mutate via `update(recipe)`. Ephemeral UI via `useUiStore`. Call `useConfigStore.getState().setActiveClientForLens(clientId)` when a client detail opens (keeps research-backed lens correct).
- **Boot:** ✅ already wired — `AppShell` runs `boot()` once, gates on `booted`, and renders `<LoginModal>` when `!loggedIn`. `LoginModal` calls `afterLogin()` itself on success. Don't rebuild this; mount new screens under `(app)/` and they inherit the shell.
- **Toasts:** ✅ `<ToastProvider>` is mounted in root `layout.tsx`. From anywhere, just call `notify(msg, error?)` from `@/lib/notify` (replaces the legacy `#notif` + `showNotif`). Don't add another provider.
- **Icons:** ✅ use the `Icon` primitive (`@/components/ui`) with a legacy `ti-*` name. It wraps `@tabler/icons-react` via a curated map; the legacy webfont was never loaded (icons were invisible), so real SVGs are the deliberate, acceptable visual change. **Unknown names fall back to a dot — add the glyph to `Icon.tsx`'s map.**
- **Routing replaces the hash router:** ✅ done — the shell uses real `<Link>`s and route groups, not the legacy `currentRoute`/`syncHash`/`applyRoute`/`__builderSub`. New client cards/links should be real `<Link href="/client/<id>/<sec>">` for native cmd/ctrl/middle-click new-tab. Client-detail sections are `/client/[id]/[sec]` (`sec ∈ overview|niche|growth|client|history`).
- **Don't** import `src/server/*` or `pg` from a client component — server-only.

---

## 9. Open items / risks to watch when building the UI

- **Clients screen is a FIRST CUT** (`(app)/clients/page.tsx`): search + grid + cards-as-links work, but still TODO — the niche/csm/tag/stage **filters**, **bulk select + ops** (`osBulk*` 7676), grouping, and an **add-client** flow. `uiStore` already has the filter/select state scaffolding (`filterNiche/filterCsm/filterTag/filterStage/selectMode/selected`) — wire the UI to it.
- **Client-detail OVERVIEW is built** (`(app)/client/[id]/[sec]/page.tsx`): the section nav + `setActiveClientForLens` are wired; the **overview** section renders the real kanban board + read-only context cards. The **niche / growth / client / history** sections still render `ComingSoon`. The board's **"Create new script"** button is a placeholder `notify()` until the wizard exists.
- **Board / ScriptEditModal need a live-stack smoke test (Phase 8):** all four static gates pass, but drag-between-columns, the max-8 toast, drop-to-delete confirm, AI rewrite (`refine_script`/`refine_selection`), and the Notion export have NOT been exercised against a running DB + Anthropic/Notion keys. Verify CAS save fires once per drag (single debounced `update`).
- `notion-blocks.ts` not yet ported — port when building `/growth` and `/sales`; keep output identical to `server/notion.ts`'s block schema; replace `gpBlocksFromDocHtml` (DOM walker) with a serializer over the Tiptap JSON doc.
- The growth-plan doc was `contenteditable` + `execCommand` (deprecated) → Tiptap; verify the exported Notion blocks match the on-screen preview.
- `osEditClientFull` in legacy physically moved a DOM node — rebuild the client editor as ONE shared `<ClientEditor>` used by both Admin and the client detail's "client" section.
- Board export selection (`boardSel`) is shared between the legacy reservoir and the V9 board — model it as one shared selection slice so both surfaces stay in sync.
- GitHub Pages root URL shifted to `/legacy/` after relocation (the canonical hosted copy is the Supabase function GET, unaffected). Confirm with owner if Pages matters.
