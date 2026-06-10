# Outreach Script Bot

AI-powered cold outreach script generator. Pick a client case study, fill in the
prospect details, and Claude writes 1–3 short outreach script variants following
a strict hook → proof → benefit → CTA framework.

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

From the `niche-bot-web` project this originated in, a mock dev server exists
(`outreach-dev-server.ts`, port 8788). Or just open `index.html` — the UI loads,
and generate calls hit the production Edge Function (admin key required).
