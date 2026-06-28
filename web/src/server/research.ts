// Research actions: prospect research (generate-time), client-site onboarding, niche
// research, competitor intel. All use Anthropic's server-side web_search tool.
// Port of legacy index.ts:569-700.

import { CLAUDE_HAIKU, CLAUDE_MODEL } from "./anthropic";
import { claudeMessages } from "./claude";
import { textOf, parseJson, webSearchTool } from "./shared";
import { fetchSiteText, normalizeUrl } from "./ssrf";

// Prospect research (used at generate time) — cheap direct scrape; falls back to web search.
export async function researchProspect(rawUrl: string, classification: string) {
  const page = await fetchSiteText(rawUrl);
  const sparse = !page.ok || page.text.length < 300;
  const target = page.ok ? page.target : normalizeUrl(rawUrl);
  const system =
    `You are a cold outreach researcher. ` +
    (sparse
      ? `The prospect's website could not be read directly — use web search (up to 3 searches) on their domain/company to learn about them. `
      : `You are given the text of a prospect company's website. `) +
    `Extract what matters for personalizing a cold email. Return valid JSON only, no markdown fences:\n` +
    `{"summary":"2-3 sentences: what they do, who they sell to, anything notable",` +
    `"pains":["3-4 likely business pains, specific to them"],` +
    `"hooks":["3-4 personalization hooks — concrete details a cold email could reference"]}`;
  const res = await claudeMessages({
    model: CLAUDE_HAIKU,
    max_tokens: 1200,
    system,
    messages: [{
      role: "user",
      content: `Prospect type: ${classification || "unknown"}\nWebsite: ${target}\n` +
        (page.ok ? `Website text:\n${page.text}` : `(site unreadable — research ${new URL(target).hostname} via web search)`),
    }],
    tools: sparse ? [webSearchTool(3)] : undefined,
  });
  const parsed = parseJson(textOf(res.content), { summary: textOf(res.content).slice(0, 600), pains: [], hooks: [] });
  return { ok: true as const, url: target, ...parsed };
}

// Client onboarding: scrape the agency client's own site into case-study data.
export async function researchClientSite(rawUrl: string) {
  const page = await fetchSiteText(rawUrl);
  const target = page.ok ? page.target : normalizeUrl(rawUrl);
  const domain = new URL(target).hostname.replace(/^www\./, "");
  const sparse = !page.ok || page.text.length < 600;
  const userContent = page.ok
    ? `Client website: ${target}\n\nHomepage text:\n${page.text}`
    : `Client website: ${target}\n\nThe homepage could not be read directly (JS-rendered or blocked). You MUST rely on web searches: try "site:${domain}", "${domain}", the company name, their LinkedIn page, reviews, and directories.`;
  const res = await claudeMessages({
    model: CLAUDE_MODEL,
    max_tokens: 2400,
    system:
      `You onboard clients for a lead generation agency. ` +
      (sparse
        ? `The client's website could not be read directly, so research them via web search (up to 4 searches): their domain, company name, LinkedIn, reviews, case studies, testimonials. `
        : `The client's website text is provided. Use up to 3 web searches to find their case studies, testimonials, reviews, or named results if the homepage lacks numbers. `) +
      `Extract the raw material for cold outreach offers. Be accurate — never invent numbers; if a field is unknown leave it as an empty string/array.\n` +
      `Return valid JSON only, no markdown fences:\n` +
      `{"name":"company name","meta":"one-line descriptor (location · size · type)",` +
      `"niche_guess":"the niche(s) THEY target, best guess",` +
      `"size":"company size / revenue if stated","result":"their single most impressive client result (with numbers if found)",` +
      `"mechanism":"how they get results, in plain words (their process/system)",` +
      `"proofLine":"one sendable sentence of proof: 'We just helped X do Y...' style, built only from real findings",` +
      `"offers":["their offers/packages/guarantees as stated"],` +
      `"caseStudies":["each concrete case study/result found, one line each"],` +
      `"pains":["pains their customers have (from their own copy)"],` +
      `"desires":["outcomes their customers want"],` +
      `"objections":["objections their copy preempts"],` +
      `"summary":"2-3 sentence overview of the client"}`,
    messages: [{ role: "user", content: userContent }],
    tools: [webSearchTool(sparse ? 4 : 3)],
  });
  const parsed = parseJson(textOf(res.content), null as Record<string, unknown> | null);
  if (!parsed) return { ok: false as const, error: "Could not parse research output — try again" };
  return {
    ok: true as const,
    url: target,
    fetchNote: sparse ? "Site is JS-rendered/blocked — researched via web search instead of direct scrape." : "",
    ...parsed,
  };
}

// Niche research: real web search incl. Reddit/forums for pains → angles.
export async function researchNiche(nicheName: string, clientContext: string) {
  const res = await claudeMessages({
    model: CLAUDE_MODEL,
    max_tokens: 2400,
    system:
      `You are a lead generation researcher building cold outreach assets for a niche. ` +
      `Use web search (up to 5 searches) to find this niche's real pain points — search Reddit, industry forums, communities, and Google. ` +
      `Prioritize how people in the niche actually talk about their problems (their words beat marketing words).\n` +
      `Return valid JSON only, no markdown fences:\n` +
      `{"insights":"3-4 sentences: state of the niche, what they complain about, where the money pressure is",` +
      `"pains":["6-8 specific pains, phrased the way the niche says them"],` +
      `"angles":["6-8 short cold-email angles (testable hooks) derived from those pains"],` +
      `"triggerWords":["8-12 niche-native terms/acronyms that signal insider knowledge"],` +
      `"desires":["4-6 outcomes this niche wants most"],` +
      `"objections":["4-6 objections they raise to outreach offers"]}`,
    messages: [{
      role: "user",
      content: `Niche: ${nicheName}\n${clientContext ? `Our client (who sells into this niche): ${clientContext}` : ""}`,
    }],
    tools: [webSearchTool(5)],
  });
  const parsed = parseJson(textOf(res.content), null as Record<string, unknown> | null);
  if (!parsed) return { ok: false as const, error: "Could not parse niche research — try again" };
  return { ok: true as const, niche: nicheName, ...parsed };
}

// Competitor research: find the client's competitors and pull their offers.
export async function researchCompetitors(clientName: string, clientUrl: string, nicheName: string) {
  const res = await claudeMessages({
    model: CLAUDE_MODEL,
    max_tokens: 2600,
    system:
      `You are a lead generation strategist doing competitor intel. ` +
      `Use web search (up to 4 searches) to find 3-5 direct competitors of the client below — companies selling a similar service to the same niche. ` +
      `For each, pull what is publicly visible: their offer/packages, their mechanism (how they claim to get results), named results/case studies, and any guarantee. ` +
      `Never invent data; leave unknown fields as empty strings.\n` +
      `Return valid JSON only, no markdown fences:\n` +
      `{"insights":"2-3 sentences: how the competitive field positions itself, and the gap our client can exploit",` +
      `"competitors":[{"name":"","website":"","offer":"their core offer/packages","mechanism":"how they get results","results":"named results/case studies found","guarantee":"guarantee if any"}]}`,
    messages: [{
      role: "user",
      content: `Client: ${clientName}${clientUrl ? ` (${clientUrl})` : ""}\nNiche they sell into: ${nicheName || "unknown"}`,
    }],
    tools: [webSearchTool(4)],
  });
  const parsed = parseJson(textOf(res.content), null as Record<string, unknown> | null);
  if (!parsed) return { ok: false as const, error: "Could not parse competitor research — try again" };
  return { ok: true as const, ...parsed };
}
