// Action dispatcher — the full switch over the 35 actions. Port of legacy
// index.ts:961-1739 (everything after the auth gate; login/auth/cap live in the route).

import { CLAUDE_HAIKU, CLAUDE_MODEL, setApiKeyOverride } from "./anthropic";
import { claudeMessages } from "./claude";
import { json, textOf, parseJson, pickModel, webSearchTool } from "./shared";
import { getConfig, casSaveConfig } from "./db";
import { getUsage, RATES, DAILY_AI_CALL_CAP } from "./usage";
import { anthropicKeyStatus, testAnthropicKey, secretsLoad, secretsSave, markKeyChanged, notionKeyStatus, testNotionKey } from "./secrets";
import { researchProspect, researchClientSite, researchNiche, researchCompetitors } from "./research";
import { handleGenerate } from "./generate";
import { exportNotion, exportNotionDb, createNotionDb } from "./notion";
import { usersList, usersAdd, usersRemove } from "./auth";
import { prompts, slotParts } from "./prompts";

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

    case "get_notion_key_status":
      return json({ ok: true, status: await notionKeyStatus() });

    case "set_notion_key": {
      const key = String(body.key ?? "").trim();
      if (!key) return json({ ok: false, error: "key required" }, 400);
      const t = await testNotionKey(key);
      if (!t.ok) return json({ ok: false, error: "Key rejected by Notion: " + (t.error || "invalid") + " — share your destination pages with the integration, then try again." }, 400);
      const s = await secretsLoad();
      s.notionKey = key;
      await secretsSave(s);
      return json({ ok: true, status: await notionKeyStatus() });
    }

    case "clear_notion_key": {
      const s = await secretsLoad();
      delete s.notionKey;
      await secretsSave(s);
      return json({ ok: true, status: await notionKeyStatus() });
    }

    case "test_notion_key": {
      const cand = body.key ? String(body.key).trim() : undefined;
      return json({ ok: true, result: await testNotionKey(cand) });
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
        system: (await prompts()).frameworkExtractor,
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
        system: (await prompts()).scriptRefiner,
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
        system: (await prompts()).selectionRefiner,
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
        system: (await prompts()).transcriptExtractor,
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
        system: (await prompts()).angleSuggester,
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
        system: (await prompts()).icpBuilder,
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
        system: (await prompts()).fuseAngle,
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
        system: await (async () => {
          const p = await slotParts("clientBrief");
          return p.body + "\n" + (rules ? `HOUSE LANGUAGE RULES (also obey):\n${rules}\n` : "") + p.contract.replace(/^\n/, "");
        })(),
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
        system: (await prompts()).icpExample,
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
        (await prompts()).followupWriter + " " +
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
        system: (await prompts()).offerSuggester,
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
