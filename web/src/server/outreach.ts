// Action dispatcher — the full switch over the 35 actions. Port of legacy
// index.ts:961-1739 (everything after the auth gate; login/auth/cap live in the route).

import { CLAUDE_HAIKU, CLAUDE_MODEL, setApiKeyOverride } from "./anthropic";
import { claudeMessages } from "./claude";
import { json, textOf, parseJson, pickModel, webSearchTool } from "./shared";
import { getConfig, casSaveConfig } from "./db";
import { getUsage, RATES, DAILY_AI_CALL_CAP } from "./usage";
import { anthropicKeyStatus, testAnthropicKey, secretsLoad, secretsSave, markKeyChanged } from "./secrets";
import { researchProspect, researchClientSite, researchNiche, researchCompetitors } from "./research";
import { handleGenerate } from "./generate";
import { exportNotion, exportNotionDb, createNotionDb } from "./notion";
import { usersList, usersAdd, usersRemove } from "./auth";

export async function dispatch(action: string, body: Record<string, unknown>): Promise<Response> {
  switch (action) {
    case "get_usage":
      return json({ ok: true, usage: await getUsage(), cap: DAILY_AI_CALL_CAP, rates: RATES });

    case "get_key_status":
      return json({ ok: true, status: await anthropicKeyStatus() });

    case "set_anthropic_key": {
      const key = String(body.key ?? "").trim();
      if (!key) return json({ ok: false, error: "key required" }, 400);
      if (!key.startsWith("sk-ant-")) return json({ ok: false, error: "That doesn't look like an Anthropic key (should start with sk-ant-)." }, 400);
      const t = await testAnthropicKey(key);
      if (!t.ok) return json({ ok: false, error: "Key rejected by Anthropic: " + (t.error || "invalid") }, 400);
      const s = await secretsLoad();
      s.anthropicKey = key;
      await secretsSave(s);
      setApiKeyOverride(key);
      markKeyChanged();
      return json({ ok: true, status: await anthropicKeyStatus() });
    }

    case "clear_anthropic_key": {
      const s = await secretsLoad();
      delete s.anthropicKey;
      await secretsSave(s);
      setApiKeyOverride(null);
      markKeyChanged();
      return json({ ok: true, status: await anthropicKeyStatus() });
    }

    case "test_anthropic_key": {
      const cand = body.key ? String(body.key).trim() : undefined;
      return json({ ok: true, result: await testAnthropicKey(cand) });
    }

    case "get_config": {
      // getConfig throws on a transient DB error → caught by the route → 502 (client keeps local).
      const config = await getConfig();
      return json({ ok: true, config });
    }

    case "save_config": {
      if (!body.config || typeof body.config !== "object") {
        return json({ ok: false, error: "config object required" }, 400);
      }
      // Guard against a runaway document, but leave real headroom: a self-hosted Node server
      // (no serverless body limit) + Postgres jsonb handle multi-MB fine, and real accounts with
      // many clients/scripts already sit near the old 1MB line. The legacy Supabase function
      // capped at 1MB; raised here so an active account's next edit doesn't start bouncing.
      if (JSON.stringify(body.config).length > 16_000_000) {
        return json({ ok: false, error: "config too large (16MB max)" }, 400);
      }
      const baseRev = (typeof body.baseRev === "number" && Number.isFinite(body.baseRev)) ? body.baseRev : null;
      const r = await casSaveConfig(body.config as Record<string, unknown>, baseRev);
      if (!r.ok) return json({ ok: true, conflict: true, config: r.config, rev: r.rev });
      return json({ ok: true, rev: r.rev });
    }

    case "research": {
      const url = String(body.url ?? "").trim();
      if (!url) return json({ ok: false, error: "url required" }, 400);
      const result = await researchProspect(url, String(body.classification ?? ""));
      return json(result, result.ok ? 200 : 422);
    }

    case "research_client_site": {
      const url = String(body.url ?? "").trim();
      if (!url) return json({ ok: false, error: "url required" }, 400);
      const result = await researchClientSite(url);
      return json(result, result.ok ? 200 : 422);
    }

    case "research_niche": {
      const nicheName = String(body.niche ?? "").trim();
      if (!nicheName) return json({ ok: false, error: "niche required" }, 400);
      const result = await researchNiche(nicheName, String(body.clientContext ?? ""));
      return json(result, result.ok ? 200 : 422);
    }

    case "research_competitors": {
      const name = String(body.clientName ?? "").trim();
      const url = String(body.clientUrl ?? "").trim();
      if (!name && !url) return json({ ok: false, error: "clientName or clientUrl required" }, 400);
      const result = await researchCompetitors(name, url, String(body.niche ?? ""));
      return json(result, result.ok ? 200 : 422);
    }

    case "extract_framework": {
      const scripts = Array.isArray(body.scripts) ? (body.scripts as unknown[]).map(String).filter((s) => s.trim()) : [];
      if (!scripts.length) return json({ ok: false, error: "scripts required" }, 400);
      const res = await claudeMessages({
        model: CLAUDE_MODEL,
        max_tokens: 1600,
        system:
          `You reverse-engineer winning cold outreach scripts into reusable frameworks for a lead generation agency.\n` +
          `Given one or more scripts that got replies, extract the underlying repeatable structure:\n` +
          `- Keep the load-bearing structure and phrasing patterns that make it work.\n` +
          `- Replace the situation-specific parts (pain, proof, names, numbers, CTA target) with descriptive snake_case {{variables}}.\n` +
          `- Write rules that capture why it wins: length, tone, rhythm, what each part must do.\n` +
          `Return valid JSON only, no markdown fences:\n` +
          `{"name":"short memorable framework name","category":"what it is (Proof-led / Pain-led / Curiosity-led / Ultra-short / ...)",` +
          `"template":"the structure with {{variables}}","rules":"the rules that make it win",` +
          `"analysis":"2-3 sentences on why this script structure works"}`,
        messages: [{
          role: "user",
          content: scripts.map((s, i) => `SCRIPT ${i + 1}:\n${s}`).join("\n\n---\n\n") +
            (body.context ? `\n\nContext: ${body.context}` : ""),
        }],
      });
      const parsed = parseJson(textOf(res.content), null as Record<string, unknown> | null);
      if (!parsed) return json({ ok: false, error: "could not parse framework extraction — try again" }, 422);
      return json({ ok: true, ...parsed });
    }

    case "refine_script": {
      const script = String(body.script ?? "").trim();
      const prompt = String(body.prompt ?? "").trim();
      if (!script || !prompt) return json({ ok: false, error: "script and prompt required" }, 400);
      const res = await claudeMessages({
        model: pickModel(body.model),
        max_tokens: 4000,
        system: `You are a cold email editor. The user gives you a script and a revision instruction. Make ONLY the requested changes — preserve what works. Return ONLY the revised script text, no commentary, no quotes, no markdown.`,
        messages: [{ role: "user", content: `SCRIPT:\n${script}\n\nINSTRUCTION: ${prompt}` }],
      });
      return json({ ok: true, script: textOf(res.content).trim() });
    }

    case "refine_batch": {
      const items = Array.isArray(body.items) ? (body.items as unknown[]).map((x) => String(x ?? "")) : [];
      const prompt = String(body.prompt ?? "").trim();
      if (!items.length || !prompt) return json({ ok: false, error: "items and prompt required" }, 400);
      if (items.length > 40) return json({ ok: false, error: "too many items in one batch (max 40)" }, 400);
      const res = await claudeMessages({
        model: pickModel(body.model),
        max_tokens: Math.min(500 + 160 * items.length, 8000),
        system:
          `You are a cold email editor. You are given a JSON array of short text items and ONE instruction. ` +
          `Apply the instruction to EACH item independently — keep what works, change only what the instruction asks. ` +
          `Preserve any {{merge_tags}} exactly. Return ONLY valid JSON (no markdown fences): ` +
          `{"items":["<rewrite of item 0>","<rewrite of item 1>", …]} with EXACTLY ${items.length} strings, in the SAME ORDER as the input. No commentary.`,
        messages: [{ role: "user", content: `INSTRUCTION: ${prompt}\n\nITEMS (JSON array):\n${JSON.stringify(items)}` }],
      });
      const parsed = parseJson(textOf(res.content), null as { items?: unknown[] } | null);
      const arr = parsed && Array.isArray(parsed.items) ? parsed.items.map((x) => String(x ?? "")) : [];
      if (arr.length !== items.length) return json({ ok: true, items });
      const out = items.map((orig, i) => { const v = (arr[i] ?? "").trim(); return v || orig; });
      return json({ ok: true, items: out });
    }

    case "ai_edit_batch": {
      const items = Array.isArray(body.items) ? (body.items as unknown[]).map((x) => String(x ?? "")) : [];
      const instruction = String(body.instruction ?? "").trim();
      if (!items.length || !instruction) return json({ ok: false, error: "items and instruction required" }, 400);
      if (items.length > 30) return json({ ok: false, error: "too many items in one batch (max 30)" }, 400);
      const ctx = String(body.context ?? "").slice(0, 6000);
      const rules = String(body.rules ?? "").trim();
      const res = await claudeMessages({
        model: CLAUDE_HAIKU,
        max_tokens: Math.min(800 + 320 * items.length, 8000),
        system:
          `You restyle passages of a client-facing growth-plan document to match a house style. ` +
          `You are given the document context, a JSON array of passages, and ONE instruction. Apply it to EACH passage. ` +
          `Keep every number, name and fact exact.\n` +
          `Each result is a minimal HTML fragment using ONLY these tags: <p>, <ul>, <li>, <b>, <i>, <br>, <h3>. ` +
          `Never include style attributes, classes, font tags, markdown, or commentary. If a passage is a short inline phrase, return plain text with no tags.\n` +
          (rules ? `HOUSE LANGUAGE RULES (always obey):\n${rules}\n` : "") +
          `Return ONLY valid JSON (no fences): {"items":["<fragment 0>","<fragment 1>", …]} with EXACTLY ${items.length} strings, in the SAME ORDER as the input.`,
        messages: [{ role: "user", content: `INSTRUCTION: ${instruction}\n\nDOCUMENT CONTEXT:\n${ctx}\n\nPASSAGES (JSON array):\n${JSON.stringify(items)}` }],
      });
      const parsed = parseJson(textOf(res.content), null as { items?: unknown[] } | null);
      const arr = parsed && Array.isArray(parsed.items) ? parsed.items.map((x) => String(x ?? "")) : [];
      if (arr.length !== items.length) return json({ ok: true, items });
      const out = items.map((orig, i) => { const v = (arr[i] ?? "").trim(); return v || orig; });
      return json({ ok: true, items: out });
    }

    case "refine_selection": {
      const script = String(body.script ?? "").trim();
      const selection = String(body.selection ?? "").trim();
      const prompt = String(body.prompt ?? "").trim();
      if (!script || !selection || !prompt) return json({ ok: false, error: "script, selection and prompt required" }, 400);
      const res = await claudeMessages({
        model: CLAUDE_HAIKU,
        max_tokens: 400,
        system:
          `You are a cold email editor. The user highlighted ONE EXCERPT of a script and wants only that excerpt rewritten. ` +
          `Rewrite the excerpt per the instruction so it fits seamlessly back into the surrounding script (tone, tense, flow). ` +
          `Return ONLY the replacement text for the excerpt — no commentary, no quotes, no markdown, and do NOT return the rest of the script.`,
        messages: [{
          role: "user",
          content: `FULL SCRIPT (context):\n${script}\n\nHIGHLIGHTED EXCERPT TO REWRITE:\n${selection}\n\nINSTRUCTION: ${prompt}`,
        }],
      });
      return json({ ok: true, replacement: textOf(res.content).trim() });
    }

    case "extract_transcript": {
      const text = String(body.text ?? "").slice(0, 30_000);
      if (!text.trim()) return json({ ok: false, error: "transcript text required" }, 400);
      const res = await claudeMessages({
        model: CLAUDE_MODEL,
        max_tokens: 2000,
        system:
          `You extract cold outreach intelligence from sales call transcripts. Read the transcript and identify actionable material.\n` +
          `Return valid JSON only, no markdown fences:\n` +
          `{"pains":["6-8 specific pain points, phrased in the prospect's exact words where possible"],` +
          `"desires":["4-6 outcomes they explicitly or implicitly want"],` +
          `"angles":["5-8 testable cold email angles derived from what you heard — use their exact language"],` +
          `"offers":["3-5 potential offer structures that would resonate based on what was said"],` +
          `"insights":"2-3 sentences on what this call reveals about the niche and what messaging will land"}`,
        messages: [{ role: "user", content: `Call transcript:\n${text}` }],
      });
      const parsed = parseJson(textOf(res.content), null as Record<string, unknown> | null);
      if (!parsed) return json({ ok: false, error: "could not parse transcript — try again" }, 422);
      return json({ ok: true, ...parsed });
    }

    case "suggest_angles": {
      const nicheName = String(body.niche ?? "").trim();
      const clientContext = String(body.clientContext ?? "").trim();
      const userPrompt = String(body.prompt ?? "").trim();
      if (!nicheName) return json({ ok: false, error: "niche required" }, 400);
      const res = await claudeMessages({
        model: CLAUDE_HAIKU,
        max_tokens: 600,
        system:
          `You generate testable cold email angle hooks for a specific niche. Each angle is a 5-14 word specific hook — a problem, trigger event, or curiosity gap. Make them distinct, concrete, and sendable as email openers.\n` +
          `Return valid JSON only, no markdown: {"angles":["6 angles"]}`,
        messages: [{
          role: "user",
          content: `Niche: ${nicheName}\n${clientContext ? `Client context: ${clientContext}` : ""}${userPrompt ? `\nDirection / focus: ${userPrompt}` : ""}`,
        }],
      });
      const parsed = parseJson(textOf(res.content), { angles: [] as string[] });
      return json({ ok: true, angles: parsed.angles ?? [] });
    }

    case "build_icp": {
      const context = String(body.context ?? "").slice(0, 14_000);
      if (!context.trim()) return json({ ok: false, error: "client context required" }, 400);
      const res = await claudeMessages({
        model: CLAUDE_MODEL,
        max_tokens: 6000,
        system:
          `You are a world-renowned outbound/cold-email strategist. Given everything known about a lead-gen agency's client ` +
          `(their offer, mechanism, proof, customer pains, call-transcript intel, competitors), define the 1-5 BEST ideal customer profiles to target with cold outreach.\n` +
          `Rules of great outbound ICPs:\n` +
          `- Specific job titles that actually hold the budget/pain (not generic "decision makers").\n` +
          `- A market that is ACCESSIBLE via outbound (findable on LinkedIn/Apollo/email databases). The sweet spot is roughly 10,000-100,000 reachable prospects — big enough to scale sequences, small enough to specialize messaging. Around 30-40K is ideal. Flag anything under ~5K (too thin) or over ~500K (unfocused).\n` +
          `- The client's existing proof must transfer: pick ICPs where their case studies and mechanism are believable.\n` +
          `- Use web search (up to 4 searches) to ESTIMATE market size: LinkedIn title counts, industry association stats, census/firmographic data ("number of X companies in Y"). State numbers with their basis; never present a guess as fact — if it is a reasoned estimate, say so.\n` +
          `Return valid JSON only, no markdown fences:\n` +
          `{"icps":[{` +
          `"title":"short memorable ICP label",` +
          `"niche":"the vertical/niche",` +
          `"jobTitles":["3-6 exact titles to target"],` +
          `"locations":["1-3 geos, most accessible first"],` +
          `"employeeSize":"company size band, e.g. 11-50",` +
          `"revenue":"revenue band if relevant, else empty string",` +
          `"marketSize":"estimated reachable prospects + one-line basis, e.g. '~35K — LinkedIn shows 32-38K matching titles in US'",` +
          `"why":"2-3 sentences: why this ICP fits THIS client — tie to their pains/mechanism/proof",` +
          `"outboundNotes":"reachability, buying triggers, what to lead with",` +
          `"score":8` +
          `}],"insights":"2-3 sentences: overall targeting strategy and which ICP to start with"}\n` +
          `Order icps best-first. score is outbound-fit 1-10.\n` +
          `IMPORTANT: do all web searching FIRST, then write NOTHING except the single JSON object as your final answer — no commentary before or after it.`,
        messages: [{ role: "user", content: `CLIENT DOSSIER:\n${context}` }],
        tools: [webSearchTool(4)],
      });
      const parsed = parseJson(textOf(res.content), null as Record<string, unknown> | null);
      if (!parsed) {
        const why = res.stop_reason === "max_tokens"
          ? "the response was truncated (hit the output limit) — try a shorter client dossier"
          : "could not parse ICP output — try again";
        return json({ ok: false, error: why }, 422);
      }
      return json({ ok: true, ...parsed });
    }

    case "fuse_angle": {
      const ingredients = Array.isArray(body.ingredients) ? body.ingredients as Array<{ kind: string; text: string }> : [];
      if (!ingredients.length) return json({ ok: false, error: "ingredients required" }, 400);
      const res = await claudeMessages({
        model: CLAUDE_HAIKU,
        max_tokens: 300,
        system:
          `You fuse hand-picked ingredients (pains, desired outcomes, guarantees, offers) into ONE cold-email angle hook. ` +
          `5-14 words, specific, written the way the prospect would say it, sendable as an email opener's theme. ` +
          `Use the ingredients' substance — don't just concatenate them. The angle must make immediate sense to the prospect: ` +
          `frame the PAIN as their situation and the outcome/guarantee as the tension or promise.\n` +
          `Example — pain: "leads go cold before we follow up" + outcome: "predictable booked calls" → {"angle":"Leads going cold while the calendar stays empty"}\n` +
          `NEVER invent numbers or claims: only numbers that appear verbatim in the ingredients may be used.\n` +
          `Return valid JSON only: {"angle":"the fused angle"}`,
        messages: [{
          role: "user",
          content: ingredients.map((i) => `${i.kind}: ${i.text}`).join("\n") +
            (body.niche ? `\nNiche: ${body.niche}` : "") +
            (body.clientContext ? `\nClient: ${body.clientContext}` : ""),
        }],
      });
      const parsed = parseJson(textOf(res.content), { angle: "" });
      if (!parsed.angle) return json({ ok: false, error: "could not fuse — try again" }, 422);
      return json({ ok: true, angle: parsed.angle });
    }

    case "ai_edit_text": {
      const text = String(body.text ?? "").trim();
      const instruction = String(body.instruction ?? "").trim();
      if (!text || !instruction) return json({ ok: false, error: "text and instruction required" }, 400);
      const rules = String(body.rules ?? "").trim();
      const res = await claudeMessages({
        model: CLAUDE_HAIKU,
        max_tokens: 1200,
        system:
          `You edit text inside a client-facing outbound growth plan document. The user highlighted a passage and gave an instruction ` +
          `(summarize, analyze, expand, rewrite, add to it, etc.). Apply it.\n` +
          `STYLE — stay congruent with the document: same confident plain-English tone, same tense, same level of formality. ` +
          `Use emojis the way the document does (sparing, section-level: 🎯 📊 ✅ 📈). Use bullet points for any list of 3+ items.\n` +
          (rules ? `HOUSE LANGUAGE RULES (always obey):\n${rules}\n` : "") +
          `OUTPUT — return ONLY the replacement as a minimal HTML fragment using ONLY these tags: <p>, <ul>, <li>, <b>, <i>, <br>, <h3>. ` +
          `Never include style attributes, classes, font tags, markdown, or commentary. ` +
          `If the highlighted passage is a short inline phrase (part of a sentence), return plain text with no tags at all.`,
        messages: [{
          role: "user",
          content: `DOCUMENT (context):\n${String(body.context ?? "").slice(0, 8000)}\n\nHIGHLIGHTED PASSAGE:\n${text}\n\nINSTRUCTION: ${instruction}`,
        }],
      });
      return json({ ok: true, html: textOf(res.content).trim() });
    }

    case "users_list": return usersList();
    case "users_add": return usersAdd(body);
    case "users_remove": return usersRemove(body);

    case "compose_client_brief": {
      const ctx = String(body.context ?? "").slice(0, 10_000);
      if (!ctx.trim()) return json({ ok: false, error: "client context required" }, 400);
      const rules = String(body.rules ?? "").trim();
      const res = await claudeMessages({
        model: CLAUDE_MODEL,
        max_tokens: 1400,
        system:
          `You turn a lead gen agency's internal client notes into a clean client facing brief that opens a growth plan. ` +
          `The client reading it should feel "they did their research on us".\n` +
          `STYLE RULES (strict): simple, concise, clear. Plain English a busy founder skims in seconds. ` +
          `NEVER use dashes or hyphens of any kind in the text, not even in compound words you can rephrase. Use commas or the word "to" instead. ` +
          `No jargon, no fluff, no exaggeration. Only use facts present in the notes, never invent numbers or names.\n` +
          (rules ? `HOUSE LANGUAGE RULES (also obey):\n${rules}\n` : "") +
          `Return valid JSON only, no fences:\n` +
          `{"services":["3 to 5 short lines, what the client offers, each under 12 words"],` +
          `"positioning":"2 to 3 sentences: who they serve, how they get results, why them",` +
          `"caseStudies":["each proven result as one clean line with its real numbers"],` +
          `"competitors":["each competitor as one line: Name, what they pitch, how our client differs"]}`,
        messages: [{ role: "user", content: `CLIENT NOTES:\n${ctx}` }],
      });
      const parsed = parseJson(textOf(res.content), null as Record<string, unknown> | null);
      if (!parsed) return json({ ok: false, error: "could not parse brief — try again" }, 422);
      return json({ ok: true, ...parsed });
    }

    case "find_icp_example": {
      const icp = body.icp as { title?: string; niche?: string; jobTitles?: string[]; employeeSize?: string; locations?: string[] } | undefined;
      if (!icp?.title) return json({ ok: false, error: "icp required" }, 400);
      const res = await claudeMessages({
        model: CLAUDE_MODEL,
        max_tokens: 800,
        system:
          `You find ONE real company that is a textbook example of an ideal customer profile, using web search (up to 3 searches). ` +
          `It must be a real, currently operating company with a working website that matches the ICP's niche, size and location. ` +
          `Never invent a company. If genuinely nothing fits, return an empty company string.\n` +
          `Style: no dashes or hyphens in the text, plain clear English.\n` +
          `Return valid JSON only, no fences: {"company":"name","website":"domain.com","why":"one sentence: why this company is a perfect example of the ICP"}`,
        messages: [{
          role: "user",
          content: `ICP: ${icp.title}\nNiche: ${icp.niche ?? ""}\nBuyer titles: ${(icp.jobTitles ?? []).join(", ")}\nCompany size: ${icp.employeeSize ?? ""}\nLocations: ${(icp.locations ?? []).join(", ")}`,
        }],
        tools: [webSearchTool(3)],
      });
      const parsed = parseJson(textOf(res.content), null as { company?: string; website?: string; why?: string } | null);
      if (!parsed) return json({ ok: false, error: "could not parse example — try again" }, 422);
      return json({ ok: true, ...parsed });
    }

    case "generate_followups": {
      const parent = String(body.parentScript ?? "").trim();
      const frameworks = Array.isArray(body.frameworks) ? body.frameworks as Array<{ name: string; template: string }> : [];
      if (!frameworks.length) return json({ ok: false, error: "at least one follow-up framework required" }, 400);
      const gapDays = Math.max(1, +(body.gapDays ?? 2));
      const icp = body.icp as { title?: string; jobTitles?: string[]; niche?: string } | undefined;
      const cs = (body.client as { name?: string; caseStudy?: Record<string, unknown> } | undefined) ?? {};
      const basis = body.basis as { pains?: string[]; desires?: string[]; angles?: string[] } | undefined;
      const rules = String(body.rules ?? "").trim();
      const sys =
        `You write OUTBOUND FOLLOW-UP emails — short messages sent AFTER a first cold email that got no reply. ` +
        `Write ${frameworks.length} follow-ups, one per framework given, in order. Each must:\n` +
        `- Follow its framework's structure and fill every {placeholder} from the real client data (never leave a {placeholder} or invent numbers).\n` +
        `- Build on the first script's thread without repeating it; reference it lightly ("circling back", "following up").\n` +
        `- Be sendable as-is, short, plain, human. Keep {{first_name}} / {{company}} merge tags.\n` +
        (icp?.title ? `- Speak to the ICP: ${icp.title}${icp.jobTitles?.length ? " (" + icp.jobTitles.join(", ") + ")" : ""}.\n` : "") +
        (rules ? `HOUSE LANGUAGE RULES (always obey):\n${rules}\n` : "") +
        `Return valid JSON only, no fences: {"followups":[{"framework":"<framework name>","text":"<the follow-up>"}]}`;
      const user =
        `FIRST SCRIPT (the one already sent):\n${parent || "(none provided)"}\n\n` +
        `CLIENT: ${cs.name ?? ""}\nProof: ${(cs.caseStudy?.proofLine as string) ?? ""}\nMechanism: ${(cs.caseStudy?.mechanism as string) ?? ""}\n` +
        `Case studies: ${((cs.caseStudy?.caseStudies as string[]) ?? []).join(" | ")}\n` +
        (basis?.pains?.length ? `Pains: ${basis.pains.join("; ")}\n` : "") +
        (basis?.desires?.length ? `Desired outcomes: ${basis.desires.join("; ")}\n` : "") +
        (basis?.angles?.length ? `Angles: ${basis.angles.join("; ")}\n` : "") +
        `\nFRAMEWORKS (write one follow-up each, in this order):\n` +
        frameworks.map((f, i) => `FRAMEWORK ${i + 1} — ${f.name}:\n${f.template}`).join("\n\n");
      const res = await claudeMessages({
        model: CLAUDE_MODEL,
        max_tokens: 1800,
        system: sys,
        messages: [{ role: "user", content: user }],
      });
      const parsed = parseJson(textOf(res.content), null as { followups?: Array<{ framework: string; text: string }> } | null);
      if (!parsed?.followups?.length) return json({ ok: false, error: "could not parse follow-ups — try again" }, 422);
      const followups = parsed.followups.map((f, i) => ({ day: gapDays * (i + 1), framework: f.framework || frameworks[i]?.name || "", text: f.text || "" }));
      return json({ ok: true, followups });
    }

    case "compose_sales_plan": {
      const ctx = String(body.context ?? "").slice(0, 12_000);
      const rules = String(body.rules ?? "").trim();
      const customPrompt = String(body.prompt ?? "").trim();
      const mention = Array.isArray(body.mention) ? (body.mention as unknown[]).map(String).filter((s) => s.trim()) : [];
      const res = await claudeMessages({
        model: CLAUDE_MODEL,
        max_tokens: 1400,
        system:
          `You are an outreach expert writing a short, warm sales plan that an agency sends to a prospect to win their business. ` +
          `The reader knows nothing about outreach tools or jargon. Write like a friendly human, not a marketer.\n` +
          `HARD STYLE RULES: a 12 year old must understand every line. Short sentences. No dashes or hyphens anywhere, rephrase instead. ` +
          `No buzzwords, no AI sounding words (no "leverage", "utilize", "synergy", "robust", "seamless", "elevate", "unlock", "empower"). ` +
          `Only use facts from the notes, never invent numbers or names. Speak to the prospect as "you".\n` +
          (rules ? `HOUSE LANGUAGE RULES (also obey):\n${rules}\n` : "") +
          (customPrompt ? `EXTRA INSTRUCTIONS FROM THE AGENCY OWNER (always obey):\n${customPrompt}\n` : "") +
          (mention.length ? `ALWAYS WORK THESE POINTS IN NATURALLY (across intro and expectations, never as a list):\n${mention.map((m) => `- ${m}`).join("\n")}\n` : "") +
          `Return valid JSON only, no fences:\n` +
          `{"intro":"2 to 3 sentences: show you understand the prospect's business and what they want, warm and specific to them",` +
          `"expectations":"2 to 3 sentences: in plain words, what they can expect once this is running, framed around booked calls",` +
          `"closing":"1 or 2 sentences: a simple, low pressure nudge to take the next step"}`,
        messages: [{ role: "user", content: ctx }],
      });
      const parsed = parseJson(textOf(res.content), null as Record<string, unknown> | null);
      if (!parsed) return json({ ok: false, error: "could not parse sales plan — try again" }, 422);
      return json({ ok: true, ...parsed });
    }

    case "compose_growth_plan": {
      const mode = String(body.mode ?? "strategy");
      const rules = String(body.rules ?? "").trim();
      const ctx = JSON.stringify({
        client: body.client, targets: body.targets, numbers: body.numbers,
        channels: body.channels, targetBookings: body.targetBookings, nicheSize: body.nicheSize,
      }).slice(0, 12_000);
      const res = await claudeMessages({
        model: CLAUDE_MODEL,
        max_tokens: 1600,
        system:
          `You are a senior outbound strategist writing a client-facing growth plan. Write crisp, confident, plain-English prose — no fluff, no hype. ` +
          `The numbers are already computed and given to you; never invent or change them, reference them naturally.\n` +
          (rules ? `HOUSE LANGUAGE RULES (always obey these):\n${rules}\n` : "") +
          `Return valid JSON only, no markdown fences:\n` +
          `{"execSummary":"2-3 sentences framing the plan and the goal",` +
          (mode === "strategy"
            ? `"targetRationales":[{"title":"the exact target title","rationale":"2-3 sentences: why this audience + these pains + this offer will work for THIS client, referencing their proof"}],`
            : `"targetRationales":[],`) +
          `"closing":"1 sentence on what success looks like / the next move"}`,
        messages: [{ role: "user", content: `MODE: ${mode}\n${ctx}` }],
      });
      const parsed = parseJson(textOf(res.content), null as Record<string, unknown> | null);
      if (!parsed) return json({ ok: false, error: "could not parse narrative — try again" }, 422);
      return json({ ok: true, ...parsed });
    }

    case "suggest_offers": {
      const context = String(body.context ?? "").slice(0, 6_000);
      if (!context.trim()) return json({ ok: false, error: "context required" }, 400);
      const res = await claudeMessages({
        model: CLAUDE_HAIKU,
        max_tokens: 800,
        system:
          `You are a cold outreach strategist. Given a client's case study data, suggest 4-6 distinct offer packages they could sell — each with a name and one-line description. Make them concrete, risk-reversed, and outcome-focused.\n` +
          `Return valid JSON only, no markdown: {"offers":[{"name":"short offer name","description":"one-line description of what's included and the outcome"}]}`,
        messages: [{ role: "user", content: `Client data:\n${context}` }],
      });
      const parsed = parseJson(textOf(res.content), { offers: [] as { name: string; description: string }[] });
      return json({ ok: true, offers: parsed.offers ?? [] });
    }

    case "export_notion": return exportNotion(body);
    case "export_notion_db": return exportNotionDb(body);
    case "create_notion_db": return createNotionDb(body);

    case "generate": return handleGenerate(body);

    default:
      return json({ ok: false, error: "unknown action" }, 400);
  }
}
