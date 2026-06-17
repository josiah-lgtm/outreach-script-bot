# Backend change — route the System Filter through Claude Sonnet

**Goal:** make the Admin → 🧠 System Filter "model" choice (Sonnet by default) actually
take effect, so the lens/messaging/offer knowledge is applied by Claude Sonnet instead of
whatever model the edge function currently uses (Gemini 2.5 Flash).

**Where:** the Supabase Edge Function behind
`https://pturxqgrhywyhylxovun.supabase.co/functions/v1/outreach-bot`
(action router — `generate`, `suggest_angles`, `suggest_offers`, `build_icp`,
`research_niche`, `refine_script`, `extract_transcript`, `compose_growth_plan`, …).
This function is **not** in this repo.

> The lens text already reaches the model today — the frontend folds it into the
> `prompt` / `globalRules` / `context` fields the function already reads. The only thing
> missing is **which model** runs these calls. That is a 100% backend decision.

---

## Why the frontend doesn't send a model field (read this first)

We previously sent `model: "sonnet"` on every request. The function passed it straight to
the LLM as a model id, `"sonnet"` is not a valid id, and **every AI call errored**
("444 skipped" on a filter run, and silent failures on generation). We reverted that.

So the request body today is exactly the original shape, e.g. for `refine_script`:

```json
{ "action": "refine_script", "script": "…", "prompt": "…(house lens folded in)…" }
```

Pick **Option A** (simplest) or **Option B** (honors the dropdown) below.

---

## Option A — just use Sonnet for the AI actions (recommended, no frontend change)

In the edge function, set the model for the generation/filter actions to Claude Sonnet.
No request-shape change, zero regression risk on the client.

```ts
// Model ids (confirm against your account's current aliases):
const SONNET = "claude-sonnet-4-6";

// For the actions that write/judge copy, call Claude:
async function callClaude(system: string, user: string, model = SONNET) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,   // add this secret
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      system,                                   // your existing system prompt
      messages: [{ role: "user", content: user }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Anthropic ${res.status}`);
  return data.content?.[0]?.text ?? "";         // <- the text the action returns
}
```

Then in each action handler, replace the current Gemini call with `callClaude(system, prompt)`.
Keep the **same JSON response shape** you already return (e.g. `{ ok:true, script:"…" }`,
`{ ok:true, angles:[…] }`) — the frontend already parses those.

**Setup:** add a Supabase secret:
```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-…
```

That's it. The dropdown in the UI then just documents what's running.

---

## Option B — honor the dropdown (Sonnet / Opus / Haiku / Gemini)

1. **Backend:** read an optional `filterModel` and map it. Default to Sonnet.

```ts
const MODEL_MAP: Record<string, string> = {
  sonnet: "claude-sonnet-4-6",
  opus:   "claude-opus-4-8",
  haiku:  "claude-haiku-4-5-20251001",
  // "gemini" -> fall through to your existing Gemini path
};
const wanted = String(body.filterModel || "sonnet").toLowerCase();
const claudeModel = MODEL_MAP[wanted];          // undefined => use existing Gemini code

if (claudeModel) {
  result = await callClaude(system, prompt, claudeModel);   // callClaude from Option A
} else {
  result = await callGemini(system, prompt);                // your current path
}
```

Make sure the router **ignores unknown body keys** (the usual
`const { action, prompt, script } = await req.json()` already does — it just doesn't read
`filterModel` unless you destructure it). Do **not** reject unknown fields.

2. **Frontend (apply only AFTER the backend above is deployed):** re-enable sending the
   preference. One edit in `index.html`, inside `withSystemFilter(...)`, right after
   `body = Object.assign({}, body);`:

```js
    // forward the Admin → System Filter model choice (backend maps it; unknown => ignored)
    const sf = (config.settings && config.settings.systemFilter) || {};
    if (sf.model) body.filterModel = sf.model;
```

   Leave it out until the backend accepts it, so we don't repeat the "444 skipped" regression.

---

## Test after deploy

1. Admin → 🧠 System Filter → put a distinctive rule in **Messaging**
   (e.g. "every line must start with the word HEY").
2. Generate a script, or run "Run filter now" on one client's Scripts.
3. Confirm the output obeys the rule → Sonnet is being used with the lens.
4. If anything errors, the filter run now prints the first error inline — capture it.

Model ids above are the latest known aliases; confirm them against the account
(`/v1/models` on the Anthropic API) before shipping.
