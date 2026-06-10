# Outreach Script Bot

AI-powered cold outreach script generator built for testing volume. Pick a
client case study, choose N frameworks × M angles, and Claude writes the whole
matrix in one go — every script labeled `framework × angle × variant` for A/B
tracking, with CSV export for your sequencer.

Features:
- **Frameworks** are first-class and categorized (Proof-led, Pain-led,
  Curiosity-led, Ultra-short) with visible `{{variables}}` — add or edit them in
  the Admin portal.
- **Niches** own the angles (the diagnostics) and key trigger words.
- **Clients** each have their own view: case study, pains, objections, desires,
  and per-niche pasted framework overrides.
- **Real web research**: the server fetches the prospect's site and extracts
  pains + personalization hooks before writing.
- **Admin portal** (⚙ Admin): edit global style rules, frameworks, niches and
  clients; config is stored server-side (Supabase Storage) and synced, with a
  localStorage fallback.

**Live site:** served by GitHub Pages from this repo (`index.html`).

## Architecture — where the API keys live

No API keys exist anywhere in this repo or in the browser.

```
Browser (GitHub Pages, static index.html)
   │  POST { action: "generate", system, user }  +  x-admin-key header
   ▼
Supabase Edge Function  /functions/v1/outreach-bot
   │  reads ANTHROPIC_API_KEY from Supabase secrets (server-side only)
   ▼
Anthropic Messages API (Claude)
```

- `ANTHROPIC_API_KEY` — stored as a Supabase Edge Function secret. Never sent to the client.
- `ADMIN_KEY` — shared secret guarding the generate endpoint so it isn't an open
  Claude proxy. Delivered to your browser once via `?admin=...` in the URL, then
  kept in localStorage. Don't commit it or share links containing it.

## Deploy the backend

```bash
SUPABASE_TOKEN=sbp_xxx bash deploy.sh
```

First time (or to rotate secrets), also pass `ANTHROPIC_API_KEY` / `ADMIN_KEY`:

```bash
SUPABASE_TOKEN=sbp_xxx ANTHROPIC_API_KEY=sk-ant-xxx ADMIN_KEY=xxx bash deploy.sh
```

The function also serves the same UI itself at
`https://<project>.supabase.co/functions/v1/outreach-bot`, so the GitHub Pages
site and the Supabase-hosted copy stay interchangeable.

## Local development

```bash
deno run --allow-net --allow-read --allow-env dev-server.ts
# open http://localhost:8788/ — all server actions are mocked
```
