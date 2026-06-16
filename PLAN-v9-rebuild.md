# v9 functional rebuild — phased plan

Goal: the app **looks and works like the v9 widget** (client-centric), wired to the
real `config` + server actions. No data loss; nothing merged to `main` until reviewed.

## Guiding rules
- All existing `config` keys preserved. New concepts are **additive** fields saved via the
  existing `save_config` (it persists the whole JSON blob — no backend change needed).
- Existing server actions (`generate`, `refine_script`, `compose_*`, `export_notion`, etc.)
  are reused as-is. We change presentation + add client-scoped state, not the AI logic.
- Each phase is previewed + committed on `v9-rebuild`. Deeper flows (generate/save) are
  validated against real Supabase/login by the team before go-live.

## Data model additions (additive, preserves everything)
- `clients[].board`  — array of saved scripts with `{id, name, code, status: Draft|Testing|Winner|Failed, text, followups[]}`
- `clients[].stage`  — Testing | Proof of concept | Scaling
- `clients[].csm`, `clients[].tags[]`, `clients[].contact`, `clients[].website`
- `niches[].notes[]`, `niches[].transcripts[]` (trigger words already exist as `triggerWords`)
- Existing `caseStudy`, `frameworkOverrides`, `winningScripts`, `prospects`, `reservoir` untouched.

## Phases
1. **Shell** — top nav Clients · Sales · Admin; route to a client-centric workspace. (nav already v9)
2. **Clients list** — real `config.clients` as v9 cards (niche, stage, CSM, board counts), filter + bulk select.
3. **Client detail · Overview** — script board (drag-drop + hover preview) + niche summary + follow-ups + client summary, reading real data.
4. **Create script** — the v9 menu + wizard, but Generate calls the real `generate` action; kept scripts land on the client board (saved to config).
5. **Niche** — profile (persona/angles/pains/desires/triggers/notes/transcripts) + Add-niche (ICP builder → real `build_icp`/`research_niche`; research-agent → `research_niche`).
6. **Growth** — wire to `compose_growth_plan` / plan defaults.
7. **Client tab** — case study, pains, objections, desires, competitors, notes, files, constraints, research brief (`compose_client_brief`).
8. **Sales** — one plan view; ICP (`build_icp`), brief from site (`research_client_site`), scripts (`generate`), Notion (`export_notion`).
9. **Admin** — Frameworks / Niches / Reservoir / Tools / Team / Settings (mostly already exist; reskin to v9).
10. **Verify + launch** — team runs generate/save on real env; `tools/migration-check.mjs` on a fresh export; then merge to `main`.

## Rollback
Branch-isolated. `main` stays live throughout. Revert is a no-op for data (Supabase untouched).
