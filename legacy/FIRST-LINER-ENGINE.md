# Cold Email First-Liner Engine — canonical spec

This is the agency methodology for turning research into cold-email opening lines.
It is **baked into the app's AI prompts** (not a separate tool):

- **Angle / pain finding** (`suggest_angles`, the Find Angles flow, "more pain points"),
  **ICP building** (`build_icp`) and **offer ideas** (`suggest_offers`) get the
  pain-library → research-validation → GOLD/WEAK → angle-type logic (Stages 1–3), and
  validate against **the client's own call transcripts + saved sources** (our "research").
- **Script generation** (`generate`) gets the first-liner filter (Stage 4) so the OPENING
  line of every framework-built script follows it — observation + pain said plainly, or a
  curiosity style — while still fitting the framework's structure. The offer/CTA stay with
  the framework downstream.

The condensed versions actually injected live in `index.html` as
`FIRST_LINER_ENGINE_ANGLES` and `FIRST_LINER_ENGINE_SCRIPT`. This file is the full source.

---

## INPUTS
- CLIENT_WEBSITE_TEXT — scraped client site copy.
- ICP_DESCRIPTION — who we're emailing (industry, size, role).
- REDDIT_RESEARCH — harvested complaints/threads/quotes about this ICP. **In-app this is
  the client's call transcripts + saved sources.**
- DIRECTION (optional) — a steer, e.g. "lean on speed-to-lead pains."
- OUTPUT_COUNT — how many first liners (default 5).

If an input is thin, proceed and note which were thin.

## STAGE 1 — BUILD THE PAIN LIBRARY (website + ICP)
1. List every service/product from the website (infer from ICP/industry if thin; mark "inferred").
2. For each, the specific customer pain it solves, framed as what goes wrong without it — the felt problem, not the service.
3. Add well-known ICP/industry pains the services hint at but the site doesn't mention.
4. Rate each pain High/Medium/Low by how directly the site supported it vs inference.
Output: 8–12 plain-sentence pains with confidence (internal working list).

## STAGE 2 — VALIDATE AGAINST RESEARCH
- In library AND real complaints → GOLD.
- In library but nobody mentions → WEAK.
- Strong complaint in research not in library → add it, GOLD (evidence beats inference).
Rank GOLD first, then confidence. Keep pains the client can actually solve; discard unsolvable trivia.

## STAGE 3 — ANGLE TYPE PER PAIN
- GOLD / high confidence → PAIN angle.
- Solid business / no strong pain signal → CURIOSITY angle.

## STAGE 4 — FIRST-LINER FILTER
First LINE ONLY. Make a stranger stop, feel something, keep reading. No offer/ask/link/call,
no question unless it's a curiosity-question. Stop right after the pain/hook so the next line
(the offer) carries the weight.

Banned: "I imagine", "I figure", "I guess", "leverage", "solutions", "circle back",
"touch base", "hope this finds you well", anything brochure-like.

Tone: talk like a person. Short sentences. Words a 12-year-old gets. Show the cost in plain
terms (the lead going to a competitor). Never accuse — pin the pain on the situation.

**PAIN angle** = Observation (one true, specific thing about them) + the Pain Said Plainly,
then stop. Examples:
- "Hi {Name}, saw you're hiring a few more reps right now. When a team grows that fast, leads usually start slipping. Someone reaches out, nobody gets back to them in time, and they go buy from someone else."
- "Hi {Name}, just saw your new service page went up. Pages like that bring in a wave of people, but half of them leave and never come back because nothing catches them."
- "Hi {Name}, your clinic's reviews are everywhere lately, that's great. The thing is, when reviews pick up the phone does too, and the calls you miss just call the next clinic on the list."

**CURIOSITY angle** = one of:
- Open loop: "Hi {Name}, your site's one of the cleaner ones I've seen in your space. Which is exactly why one thing on it surprised me."
- Pattern: "Hi {Name}, most teams your size fall into one of two camps with their follow-up. Curious which one you're in."
- Genuine question: "Hi {Name}, quick one, when someone fills out your contact form, who's the first to see it?"

## OUTPUT FORMAT
Return OUTPUT_COUNT first liners. Each: the first line, then a short tag
`[PAIN/CURIOSITY type | GOLD or confidence | source: site or reddit]`. Nothing after the
first line in the line itself — the offer and CTA are added downstream.
