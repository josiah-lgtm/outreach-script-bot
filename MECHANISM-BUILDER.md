# Mechanism Builder — canonical spec

Turns the client's services into clear, simple mechanisms that justify the claim by showing
HOW. Lives in the **Mechanism step** of create-script (after pains/desired outcomes, before
proof). Built mechanisms save to the client (`client.mechanisms`) and the composed summary to
`client.caseStudy.mechanism`, so they persist and feed future script generation.

In-app it's wired via the `MECHANISM_BUILDER` prompt + `parseMechanisms()` in `index.html`,
called by the "Build mechanism (AI)" button (`osWizBuildMechanism`). Inputs are pulled
automatically: client services = `clientOffers`, ICP pains/desires = the selected ICP + client.

## Logic (work backwards from the service)
1. **Pain** — the symptom the prospect already feels.
2. **Obstacle** — the real cause behind that pain (what's actually breaking).
3. **Misdiagnosis** — what they wrongly blame instead.
4. **Mechanism** — the service flipped into the fix that removes the obstacle.
5. **Outcome** — the result once the obstacle is gone (inversion of the pain).
Never lead with the raw service; lead with the obstacle you remove. The service is only proof.

## Stage 1 — map each service
Pain it kills · obstacle (cause) behind it · the misdiagnosis · the desire removing it unlocks.

## Stage 2 — build the mechanism (plain steps)
Name + "what it fixes" + 3 (max 4) one-sentence steps a 12-year-old gets:
`Step 1: We … / Step 2: Then we … / Step 3: So you …`. No jargon.

## Stage 3 — kill objections inside the steps
The steps themselves answer "will it work?" (show WHY — the cause removed) and "is it risky /
more work?" (repeatable, done-for-them, hands-off). No separate objections section.

## Stage 4 — make it feel unique
Simple, slightly unique name drawn from the specific obstacle most people miss — not fancy words.

## Output (JSON)
```json
{"mechanisms":[{"name":"...","fixes":"the obstacle, one sentence",
"reframe":"It's usually not [misdiagnosis], it's actually [obstacle].",
"steps":["We ...","Then we ...","So you ..."],"outcome":"...",
"confidence":"High|Medium|Low","source":"site|inferred"}]}
```
Plain words only — no "leverage", no "solutions", no brochure language. Reads like a person
explaining how something works to a friend.
