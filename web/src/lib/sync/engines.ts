// Baked-in methodology prompts + the lens-action allow-list. Verbatim port of
// legacy index.html:1037-1061. Every newline and word is load-bearing prompt text.

export const LENS_ACTIONS: Record<string, 1> = {
  generate: 1, suggest_angles: 1, suggest_offers: 1, fuse_angle: 1, ai_edit_text: 1, ai_edit_batch: 1,
  build_icp: 1, research_niche: 1, research: 1, research_client_site: 1, refine_script: 1, refine_batch: 1,
  extract_transcript: 1, compose_growth_plan: 1, compose_client_brief: 1,
};

export const FIRST_LINER_ENGINE_ANGLES =
`FIRST-LINER ENGINE — how to find pains & angles:
1) Build a pain library: from what the client offers, write the specific customer pain each thing solves, framed as what goes WRONG without it (describe the felt problem, not the service). Add well-known ICP/industry pains the services hint at.
2) Validate against the research provided (the client's call transcripts and saved sources ARE the research). A pain real people actually complain about = GOLD; a library pain nobody mentions = WEAK; a strong complaint in the research that's not yet in the library = ADD it as GOLD. Rank GOLD first, keep only pains the client can actually solve.
3) Per pain pick an angle type: clear real pain (GOLD/high confidence) = PAIN angle; solid business / no strong pain signal = CURIOSITY angle.
Return specific, plain-language pains/angles in the prospect's own words (a 12-year-old gets them). No marketing language, no jargon.`;

export const FIRST_LINER_ENGINE_SCRIPT =
`FIRST-LINER FILTER — the OPENING line of the script (it must still fit the framework's structure):
The first line's only job is to make a stranger stop, feel something, and keep reading. No offer, ask, link or call request in the first line — stop right after the pain or hook lands so the rest of the framework (the offer) carries the weight.
PAIN-angle opener = Observation (one true, specific thing about them, plain words) + the Pain Said Plainly (land the real problem so they nod; pin it on the situation, never the person; show what it costs them, e.g. the lead going to a competitor), then stop.
CURIOSITY-angle opener = one of: Open loop (say something true, then hint at a "but" without finishing); Pattern (point at a pattern across similar businesses so they wonder which side they're on); Genuine question (a real, specific, low-effort question about how they do one thing).
Banned: "I imagine", "I figure", "I guess", "leverage", "solutions", "circle back", "touch base", "hope this finds you well", and anything brochure-like. Short sentences, talk like a real person, never accuse.
PROOF RULE: proof and case studies are our credibility, layered in LATER by the framework's offer — NEVER build the opening hook or the angle from proof. The hook comes only from the prospect's pain or curiosity; we write to the audience, then use proof to back it up.`;

export const MECHANISM_BUILDER =
`You are a MECHANISM BUILDER. Turn the client's services into clear, simple mechanisms that justify the claim by showing HOW. Build each by working BACKWARDS from the service: Pain (the symptom they feel) → Obstacle (the real cause behind it) → Misdiagnosis (what they wrongly blame instead) → Mechanism (the service flipped into the fix that removes the obstacle) → Outcome (the result once the obstacle is gone). Never lead with the raw service; lead with the obstacle you remove — the service is only proof you can remove it.
For each service: name the pain it kills, the obstacle behind it, the misdiagnosis, and the desire it unlocks. Then write the mechanism as 3 (max 4) plain numbered steps a 12-year-old understands. The steps themselves must quietly answer the two objections: "will this actually work?" (show WHY — the cause it removes) and "is this risky / more work for me?" (show it's repeatable, done-for-them, hands-off). Bake these into the wording — no separate objections section. Give each a simple, slightly unique NAME drawn from the specific obstacle most people miss. Plain words only — no "leverage", no "solutions", no brochure language; it should read like a person explaining how something works to a friend. If inputs are thin, infer from the industry/ICP and mark source "inferred".
Connect every mechanism to the CHOSEN PAINS and CHOSEN DESIRED OUTCOMES in the context: show plainly how it reduces that pain, removes the related objection, and makes that desire more likely. The steps run "We … / Then we … / So you …" — the LAST step is the outcome they feel.
Respond with PURE JSON ONLY — no prose, no markdown, and ignore any voice/tone guidance for THIS response. Output MINIFIED JSON on a single line: NO newlines, NO indentation, no spaces after colons/commas. Return AT MOST 2 mechanisms. Keep every value short — under 15 words. Shape exactly:
{"mechanisms":[{"name":"simple unique name","fixes":"the obstacle, short","reframe":"It's usually not [misdiagnosis], it's actually [obstacle].","steps":["We ...","Then we ...","So you ..."],"outcome":"the payoff, short","reducesPain":"short","removesObjection":"short","increasesDesire":"short","confidence":"High|Medium|Low","source":"site|inferred"}]}`;
