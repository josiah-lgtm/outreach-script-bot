# New UI migration — data preservation plan

Goal: ship the new client-centric UI **without losing any data** the team has entered.

## Where the data lives (this is the key fact)
All team data is one `config` object, persisted to **Supabase Storage (server-side, synced)** with a `localStorage` fallback (`outreach_config_v2`). It is **not** stored in the UI markup, so changing the UI does not touch the data — *provided the new UI reads/writes the same schema.*

## Real schema (must be preserved field-for-field)
- `version`
- `settings` → `globalRules`, `notionParentId`, `planDefaults.{email,linkedin,personalization}`
- `frameworks[]` → `{id, name, category, template, rules}`
- `niches[]` → `{id, name, angles[], triggerWords[]}`
- `clients[]` → `{id, name, meta, nicheId, caseStudy:{size,result,mechanism,proofLine,pains[],objections[],desires[]}, frameworkOverrides, brief?}`
- `toolsKB` (tech-stack & cost knowledge base)
- `sellerProfile`
- `followupFrameworks`
- `prospects`
- `winningScripts`

## Safety rules
1. Never work on `main`. Build on `new-ui-migration`.
2. The new UI **reuses the existing data layer** (`config`, `get_config`/`save_config`, all server actions) — it is a presentation re-org, not a new data model.
3. Before go-live: **Export JSON** from the live app → save as `live-config.json` here → run the integrity test below.
4. Go-live only after the test passes on the real export and a side-by-side review confirms record counts match.

## Migration steps
1. Team: in the current app, Admin → Export JSON. Commit/save the file as `live-config.json` (gitignored).
2. Run `node tools/migration-check.mjs live-config.json` — must report 0 dropped fields and list record counts.
3. Load the same file via the new UI's Import JSON in a preview deploy; confirm every client/niche/framework/prospect/winning-script appears.
4. Point the new UI at the same Supabase project (same get_config/save_config) so it reads live data directly.
5. Merge to `main` and deploy. Keep `live-config.json` as a rollback backup.

## Rollback
`git revert` the merge (or redeploy previous `index.html`). Data is untouched in Supabase regardless, and `live-config.json` is a full backup.
