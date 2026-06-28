# Build Plan: Growth Plan Builder (v10)

**For:** Opus, working in `~/outreach-script-bot`
**Requested by:** Agency Advanta (lead-gen agency) — spec also lives in Notion page "BOT OFFER" (`37b4fd2a-4cfe-80e9-ad54-eaeacaa021bd`)
**Goal:** A third top-level view ("📈 Growth Plan") that assembles a client-facing growth plan from everything the app already knows about a client, computes the funnel/cost math deterministically, has AI write the narrative, and exports the finished plan to Notion.

---

## 0. Context you must read first

- `index.html` — the whole frontend is this one file (inline CSS + JS). Follow its existing idioms exactly: `esc()`, `uid()`, `client()/niche()`, `state` object, `persistConfig()`, `api(body)` (POSTs to the Edge Function with `x-admin-key`), `migrateConfig()` for schema upgrades, chips/`mini-btn`/`info-block`/`editor` CSS classes, admin tab pattern (`switchAdminTab`, `adminTabHtml`).
- `supabase/functions/outreach-bot/index.ts` — Edge Function. One `switch(body.action)`. All Claude calls server-side via `claudeMessages()` from `_shared/anthropic.ts`. `parseJson()` tolerates fences. `webSearchTool(n)` for web search. Add new actions here.
- `dev-server.ts` — local mock server (port 8788, registered as "outreach-bot" in `~/.claude/launch.json`). **Every new action needs a mock here.** The server caches code at startup — restart the preview server after editing it.
- `deploy.sh` — deploys with `SUPABASE_TOKEN=sbp_... bash deploy.sh`. Bundles index.html into html.ts. Project ref `pturxqgrhywyhylxovun`.
- Existing client data model (all already migrated/persisted): `caseStudy{}`, `guarantees[]`, `transcripts[]` (each with extracted `pains/desires/angles/offers`), `icps[]` (from the ICP builder: `title, niche, jobTitles[], locations[], employeeSize, revenue, marketSize, why, outboundNotes, score`), `favorites{pains,desires,caseStudies,offers}` (the ⭐ starred items), `scriptReservoir[]` (`script, framework, angle, status: idea|testing|winning, note`), `sources{}` (provenance map), `avoid[]`.
- Aggregation helpers to reuse: `clientPains(c)`, `clientDesires(c)`, `clientOffers(c)`, `clientCaseStudies(c)`, `srcOf()`.
- Verification discipline used in this repo: `~/.deno/bin/deno check` both Deno files; test every flow in the preview (preview_start "outreach-bot", drive with preview_eval); deploy; live-test new actions with curl against production; commit + push to GitHub Pages (`josiah-lgtm/outreach-script-bot`, main). Co-author trailer per repo history.

---

## 1. Feature overview

Two plan modes, one builder view:

| | **Mode 1 — Strategy (Proof of Concept)** | **Mode 2 — Growth (Scaling)** |
|---|---|---|
| For | Onboarding a NEW client | Existing client with a proven script |
| Core question | "Which targets/scripts do we test, on which channel, and what does the test cost?" | "We know the script works — how do we scale it, and what does X bookings cost?" |
| Inputs | Client profile, ICPs (pick up to 3 targets), KEY pains (default = starred favorites), offer, 2 angles per target, 2 scripts per target, channel(s) | One winning script (from reservoir), observed campaign metrics (email and/or LinkedIn), niche size (from ICP marketSize), target bookings |
| Output | Per-channel test plan: volumes, lead scrape/verify counts, tool stack + costs, personalization spec, expected funnel, next steps, cost breakdown | Scale plan: recommended sending volume derived from OBSERVED metrics, bulk lead order size, cost to reach X bookings, scaling options |

Both modes end with: **save plan on the client** + **Export to Notion**.

---

## 2. Data model (frontend, `migrateConfig`)

```js
// Global, admin-managed (config level — NOT per client):
config.toolsKB = config.toolsKB || [];
// each: { id, name, category, link, monthlyCost, unitCost, unitLabel, why, channels: ['email','linkedin'] }
// category: 'scraping' | 'verification' | 'sending' | 'personalization' | 'reply-agent' | 'other'
// unitCost/unitLabel for per-unit pricing (e.g. 0.20 per 1K verifications); monthlyCost for flat.

config.settings.notionParentId = config.settings.notionParentId || '33a4fd2a4cfe81fdaab6e17031fa93be';
config.settings.planDefaults = config.settings.planDefaults || { /* funnel assumption defaults, see §5 */ };

// Per client:
c.growthPlans = c.growthPlans || [];
// each: { id, mode: 'strategy'|'growth', title, channels: ['email','linkedin'],
//         targets: [...], assumptions: {...}, computed: {...},
//         toggles: { replyAgent: bool, pledge: bool, pledgeText: '' },
//         campaignStats: {...} (mode 2 only),
//         notionUrl: '', createdAt: 'YYYY-MM-DD' }
```

**Seed `toolsKB`** with sensible defaults so the feature works day one (admin can edit/delete):

| name | category | channels | pricing | why |
|---|---|---|---|---|
| Apollo.io | scraping | email, linkedin | $99/mo | Lead database — find + scrape the ICP's titles at target company sizes |
| MillionVerifier | verification | email | $0.37 per 1K | Verify scraped emails; protects domain reputation, keeps bounces <2% |
| Smartlead | sending | email | $94/mo | Multi-inbox email sequencer with warmup + rotation |
| HeyReach | sending | linkedin | $79/mo per seat | LinkedIn outreach automation — connections + DMs at safe volumes |
| Gemini 2.5 Flash | personalization | email, linkedin | $0.30 per 1M input tokens / $2.50 per 1M output | Writes a personalized first line per lead from scraped data |
| AI Reply Agent | reply-agent | email, linkedin | $250/mo | Answers replies within minutes, books the call — client signs up for this |

(Exact prices are editable; seed with these.)

---

## 3. Navigation + view skeleton

- Header: add third nav button `📈 Growth` between Builder and Admin. Extend `showScreen()` with a `'growth'` screen: hide the three builder panels and `panelAdmin`, show new `panelGrowth` (full-width like admin, `admin-mode` grid).
- `panelGrowth` layout: left = the plan form (steps), right = live plan preview (rendered like a document — this is what exports to Notion). Single scrollable panel with a sticky action bar is also acceptable; prefer two-column ≥1100px.
- `state.growth = { planId: null, mode: 'strategy', clientId: null, ...working fields }`.
- Top of view: client picker (reuse client list semantics, a simple `<select>`), mode toggle (two big segmented buttons: "🧪 Strategy — proof of concept" / "📈 Growth — scaling"), and a list of previously saved plans for that client (open/duplicate/delete, link to Notion if exported).

---

## 4. Mode 1 — Strategy (POC) form

Step-by-step (numbered steps, same visual language as the builder):

1. **Channel** — chips: ☐ Email ☐ LinkedIn (multi-select; at least one). Each selected channel gets its own section in the plan output.
2. **Targets (up to 3)** — pick from the client's saved ICPs (chips with fit score). For each selected target, auto-pull and show (editable):
   - **Key pains** — default to `c.favorites.pains` ∩ relevant, max ~4 shown ("not all of them, just the key ones"). Checkboxes to trim.
   - **2 angles** — pick chips from the same angle pool the builder uses (niche angles + transcript angles + saved custom). Pre-select the first 2.
   - **2 scripts** — picker listing `scriptReservoir` entries (prefer status winning/testing) + `winningScripts`; or "✍️ paste one". Store script text snapshots in the plan (not refs) so the plan is stable.
3. **Offer** — radio: pick one from `clientOffers(c)` (starred offers first). Editable text after pick.
4. **Volumes & assumptions** — per selected channel, an editable assumptions grid prefilled from `config.settings.planDefaults` (see §5). Show computed outputs live.
5. **Tools** — auto-include from `toolsKB` matching the channel (one per category by default; admin KB is the source). Each row: checkbox to include, name (link), cost, "why" line. Personalization row shows the token math (see §5 personalization).
6. **Toggles:**
   - **AI reply agent** — checkbox. When ON: its tool row is included in costs AND a next-step "Client signs up for the AI reply agent" is added.
   - **Pledge / guarantee** — checkbox, default OFF ("sometimes we just want to test"). When ON, a text field prefilled from `c.guarantees[0].text`; rendered as a callout in the plan. (Spec said "error pledge" — interpret as the performance pledge/guarantee block; flag to user in PR notes.)
7. **Next steps** (auto-built checklist, editable): ① Verbal agreement on the niche(s) ② Verbal agreement on the scripts ③ (if reply agent) Sign up for the AI reply agent ④ Kickoff: domains/inboxes warmup (email) / seat setup (LinkedIn).
8. **Cost breakdown** — table summing: flat tool costs/mo + per-unit costs at the planned volumes (verification per lead, Gemini tokens per lead × leads) → **total tech stack cost/mo**. This table always renders, even with pledge OFF — "just a cost breakdown" is a first-class output.

**AI narrative:** button "✨ Draft narrative" → new server action `compose_growth_plan` (see §7) writes: 1-paragraph exec summary, one short rationale paragraph per target (why this ICP + these pains + this angle, reusing ICP `why`), and a closing "what success looks like" line. Numbers are NOT generated by the model — they're passed in, already computed.

---

## 5. Funnel & cost math (deterministic JS — never the model)

`planDefaults` (editable in Settings AND per plan in step 4):

```js
{
  email: {
    leadsPerMonth: 3000,        // scraped
    verifyRate: 0.65,           // scraped → verified sendable
    sendsPerLead: 3,            // sequence steps
    replyRate: 0.04,            // replies / leads contacted
    positiveRate: 0.30,         // positive / replies
    bookRate: 0.40,             // booked / positive
  },
  linkedin: {
    connectsPerDay: 25, daysPerMonth: 22,
    acceptRate: 0.30,           // connections accepted
    replyRate: 0.25,            // replies / accepted
    positiveRate: 0.40,
    bookRate: 0.40,
  },
  personalization: {
    inputTokensPerLead: 2000, outputTokensPerLead: 200, model: 'Gemini 2.5 Flash',
  }
}
```

Computed per channel (email): `verified = leads × verifyRate`, `outreaches = verified × sendsPerLead`, `replies = verified × replyRate`, `positive = replies × positiveRate`, `booked = positive × bookRate`. LinkedIn: `connects = connectsPerDay × days`, `accepted = connects × acceptRate`, `replies = accepted × replyRate`, → positive → booked. Personalization cost = `leads × (inTok × inPrice + outTok × outPrice) / 1M` using the Gemini KB entry's unit costs. Show every number in the expected-results table: **expected volume, outreaches, replies, positive replies, (LinkedIn: connections + positive replies), bookings, and conversion %** (booked / leads).

Round everything for display (`Math.round`), keep raw in `computed`.

---

## 6. Mode 2 — Growth (Scaling) form

1. **Winning script** — pick from `scriptReservoir` filtered to `status==='winning'` (fallback: all). Show the script + its note (reply-rate notes live there).
2. **Observed metrics** — per channel the campaign ran on (Email / LinkedIn / both), inputs: contacted, replies, positive replies, booked. These become the plan's rates (replace the §5 defaults — this is "based on the metrics of this current script").
3. **Niche size** — pulled from the matching ICP's `marketSize` (editable text). Render prominently: "The niche: ~34K reachable prospects."
4. **Target** — input: desired bookings/mo (X). Solve backwards with observed rates → required leads/volume per month → **bulk lead order size** (leads ÷ verifyRate, rounded up to the nearest 1K) → tool costs at that volume → **"to get X bookings: $Y/mo total, $Z per booking."**
5. **Steps** (auto checklist): ① Confirm added niche pains in the script (the new pains step: surface `c.favorites.pains` + niche pains as checkable additions) ② Bulk order N leads ③ Run the script at V/day.
6. **Options** (rendered as three cards, each with its own mini-math): **Double the volume** (2× column: leads, cost, bookings), **More niches** (list the client's other ICPs/niches not in this campaign, with their marketSize), **Add a channel** (if campaign was email-only → LinkedIn column with §5 defaults, and vice versa).

---

## 7. Server actions (Edge Function)

1. **`compose_growth_plan`** — model: CLAUDE_MODEL, no web search. Input: `{ mode, clientDossier (reuse icpDossier-style assembly), targets[], numbers (all computed), toggles }`. Output JSON: `{ execSummary, targetRationales: [{title, rationale}], closing }`. Same parseJson + max_tokens ~2000. Mock in dev-server.
2. **`export_notion`** — input: `{ plan }` (the full saved plan object + rendered narrative). Reads `NOTION_API_KEY` from `Deno.env` (new Supabase secret). Creates a child page under `body.parentId` (sent from client config; default Outreach Tracker `33a4fd2a-4cfe-81fd-aab6-e17031fa93be`) via Notion REST API:
   - `POST https://api.notion.com/v1/pages` with headers `Authorization: Bearer`, `Notion-Version: 2022-06-28`.
   - Page title: `Growth Plan — {client} — {Strategy|Scaling} — {date}`.
   - Blocks: H1; callout (exec summary); per channel: H2, funnel table (`table` blocks), tools+costs table; per target: H3 + pains/angles bullets + script code blocks; next steps as `to_do` blocks; cost breakdown table; (if pledge) callout with the pledge text.
   - Notion caps children at 100 blocks per request — build the page with the first ≤100, then `PATCH /v1/blocks/{id}/children` for the rest. Tables: a `table` block with `table_row` children (rows count toward limits).
   - Return `{ ok: true, url }`; store `notionUrl` on the plan.
   - Errors: surface Notion's message verbatim (401 = key/share problem: tell user to share the tracker page with the integration).
3. Mock both in `dev-server.ts` (export returns a fake `https://notion.so/mock-...` URL).

**Secret setup (do this at deploy):** the user must create a Notion internal integration (notion.so/my-integrations), copy its secret, and share the "Outreach Tracker" page with it. Ask the user for the token, then `SUPABASE_TOKEN=... NOTION_API_KEY=ntn_... bash deploy.sh` — extend deploy.sh's optional-secrets block to pass `NOTION_API_KEY` the same way it handles `ADMIN_KEY`.

---

## 8. Admin additions

- **New admin tab "🧰 Tools KB"**: list rows (name, category badge, channels, cost, link) + editor (same `editor` panel pattern as frameworks): name, category select, channels chips, link, monthlyCost, unitCost + unitLabel, why (textarea). Seed defaults from §2 in `migrateConfig` when `toolsKB` is empty.
- **Settings tab additions**: Notion parent page ID field (default = Outreach Tracker ID, hint explaining how to change it: paste any Notion page URL/ID); plan-defaults JSON-ish editor or simple grid for §5 numbers; "Test Notion connection" button → `export_notion` dry-run flag (`{test:true}` → just GET the parent page, return its title).

---

## 9. UI/UX notes

- Keep visual language identical: dark theme vars, chips, numbered steps, `info-block`s. The live preview should look like the document the client will see (white-ish on dark is fine — match `info-block` styling).
- The preview pane re-renders on every input (like `updateMatrix`).
- "💾 Save plan" persists to `c.growthPlans` (write-through, `persistConfig()`), "📤 Export to Notion" saves + exports + shows the returned URL as a link + ✅ toast.
- Past plans list: title, mode badge, date, channels, total cost, bookings target; actions: Open (loads into form), Duplicate, Delete, Notion link.
- Hero badge in the builder client card: `📈 N plans` (consistent with 🎯 ICPs badge).

## 10. Order of work + verification checklist

1. `migrateConfig` additions + toolsKB seed + admin Tools KB tab + Settings additions. Verify in preview (add/edit/delete a tool, persists).
2. Growth view skeleton + nav + client picker + mode toggle + saved-plans list.
3. Mode 1 form + deterministic math + live preview. Verify with preview_eval: select 2 ICP targets, check computed numbers against hand math, toggles add/remove cost rows and next steps.
4. Mode 2 form + math. Verify: observed rates flow through; "double volume" card = exactly 2× leads/cost.
5. `compose_growth_plan` action + mock + wire "✨ Draft narrative". deno check.
6. `export_notion` action + mock + deploy.sh secret plumbing. Local verify against the mock.
7. Deploy. Live-test `compose_growth_plan` with curl. For `export_notion`: ask the user for a Notion integration token first; set secret; live-export a test plan; confirm the page appears under Outreach Tracker; then delete-or-keep per user.
8. Hero badge, polish pass, zero-console-error sweep, commit ("v10: growth plan builder…"), push to main (GitHub Pages).

## 11. Ambiguities resolved (flag these in the final summary to the user)

- "find it under 'Other' and use the tracker Notion" → resolved to the **Outreach Tracker** page (`33a4fd2a-4cfe-81fd-aab6-e17031fa93be`, the one with the DMs/Pos Replies/Cal Sends/Email Contacts metrics table). Parent is configurable in Settings if this is wrong.
- "error pledge" → interpreted as the **performance pledge/guarantee** toggle (default OFF for pure tests). Pledge text sourced from the client's guarantees.
- "three potential targets versus free potential targets" → up to **3 targets**, each with **2 angles and 2 scripts**.
- "add another chunk" → interpreted as **add another channel**.
- Gemini 2.5 is a **cost line item + personalization spec** in the plan (tokens per lead × unit price), not an integration to build.
