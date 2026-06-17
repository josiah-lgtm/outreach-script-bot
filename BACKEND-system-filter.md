# System Filter → Claude Sonnet (Option A — DONE, needs deploy)

**Status:** implemented in `supabase/functions/outreach-bot/index.ts`. Takes effect once
the edge function is **redeployed** (pushing to GitHub only updates the frontend, not the
function).

## What was changed

The backend already runs on Claude (`ANTHROPIC_API_KEY` is set; `CLAUDE_MODEL =
"claude-sonnet-4-6"`). The "Gemini 2.5 Flash" string in the app config is only a
cost-estimate label — it was never the model that runs.

Several copy-writing actions were on the cheap **Haiku** model. Since the System Filter's
lens is folded into these prompts, they now run on **Sonnet** so the filter is applied at
full quality:

| Action            | Before        | After         |
|-------------------|---------------|---------------|
| `refine_script`   | Haiku         | **Sonnet**    | ← powers the batch "Run filter" + AI rewrite
| `refine_selection`| Haiku         | **Sonnet**    |
| `suggest_angles`  | Haiku         | **Sonnet**    |
| `fuse_angle`      | Haiku         | **Sonnet**    |
| `ai_edit_text`    | Haiku         | **Sonnet**    |
| `suggest_offers`  | Haiku         | **Sonnet**    |

Already on Sonnet (unchanged): `generate`, `build_icp`, `extract_transcript`,
`compose_client_brief`, `compose_growth_plan`, `compose_sales_plan`, `find_icp_example`,
`generate_followups`.

Left on Haiku (mechanical, not copy the filter shapes): `research_client_site` website
summarisation.

## Deploy

```bash
./deploy.sh            # bundles index.html → html.ts and runs `supabase functions deploy outreach-bot`
# or just the function:
# supabase functions deploy outreach-bot
```

No new secret needed — `ANTHROPIC_API_KEY` is already configured.

## Verify after deploy

1. Admin → 🧠 System Filter → put a distinctive rule in **Messaging**
   (e.g. "every line must start with HEY"), Save.
2. Run "Run filter now" on one client's Scripts, or generate a script.
3. Output should obey the rule → Sonnet + lens are live.

## Note on the model dropdown

The dropdown (Sonnet/Opus/Haiku/Gemini) is still a saved preference only — the backend now
uses Sonnet for the actions above regardless of the dropdown. To make the dropdown switch
models per request, do Option B from git history (read `filterModel` in the function and
add the one-line frontend send) — but only after confirming the function ignores unknown
body keys, to avoid the earlier "model field" regression.
