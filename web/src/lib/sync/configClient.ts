// Config layer — verbatim port of the legacy single-file app's config code
// (legacy/index.html: DEFAULT_CONFIG ~1281, seed consts ~1420-1660, migrateConfig
// ~1457-1553, and the load/save/backup/export/import helpers ~1664-1857).
//
// FIDELITY-CRITICAL: every field, default, string, regex and branch is transcribed
// exactly. The only changes from the legacy are: light TS types (loose `Config`/`any`),
// DOM/render coupling removed (data is RETURNED instead of rendered), and ES modules.
//
// The React store owns orchestration (debounce timer, serverSaveWithRetry retry/
// conflict-merge, all rendering). This module ports only the PURE/data pieces.

import { api } from "./api";
import { safeStorageGet, safeStorageSet } from "./adminKey";
import type { Config, ConfigSource } from "./types";

// structuredClone is available in the runtime; keep the legacy deep-clone semantics.
declare const structuredClone: <T>(value: T) => T;

// ─── DEFAULT CONFIG ────────────────────────────────────────────────────────────
export const DEFAULT_CONFIG: Config = {
  version: 2,
  settings: {
    globalRules: "No jargon, no dashes mid-sentence, no 'genuinely', no corporate speak. Plain language a 12-year-old gets. Sound like a real person texting, not a marketer writing copy. Every script must be sendable exactly as written. Hooks must be answerable in 2 seconds.",
    notionParentId: '3744fd2a4cfe8015830fc724e06dcdb3', // "CSM" page (CEO Station)
    // Growth-plan funnel + cost assumptions (editable in Admin → Settings).
    planDefaults: {
      email: { leadsPerMonth: 3000, verifyRate: 0.65, sendsPerLead: 3, replyRate: 0.04, positiveRate: 0.30, bookRate: 0.40, sendsPerInboxPerDay: 30, sendingDays: 22, inboxCostMo: 3 },
      linkedin: { connectsPerDay: 25, daysPerMonth: 22, acceptRate: 0.30, replyRate: 0.25, positiveRate: 0.40, bookRate: 0.40, connectsPerProfilePerDay: 20, profileCostMo: 80 },
      personalization: { inputTokensPerLead: 2000, outputTokensPerLead: 200, model: 'Gemini 2.5 Flash' }
    }
  },
  frameworks: [
    {
      id: 'proof-bridge', name: 'Proof Bridge', category: 'Proof-led',
      template: "{{hook_question}}\n\nWe just helped {{proof_client}} ({{size}}) {{step_1}}, {{step_2}}, {{step_3}}. {{result}}. No {{objection_1}}, no {{objection_2}}.\n\nFor you that means more {{desire_1}}, better margins, and a stronger multiple if you ever raise or sell.\n\n{{cta}}",
      rules: "Steps are 5-7 words each, plain language. 80-100 words total. desire_1 must be specific and loop back into the CTA. The 'stronger multiple' closer always follows 'better margins'."
    },
    {
      id: 'pas', name: 'Pain-Agitate-Solve', category: 'Pain-led',
      template: "{{pain_observation}}\n\n{{agitate_cost}}\n\nWe fixed exactly this for {{proof_client}} — {{result}}.\n\n{{cta}}",
      rules: "Agitate with a number or a concrete consequence, never adjectives. 75 words max. CTA is one short question."
    },
    {
      id: 'trigger-question', name: 'Trigger Question', category: 'Curiosity-led',
      template: "{{personalized_trigger_line}}\n\n{{curiosity_question}}\n\n{{one_line_proof}}\n\n{{soft_cta}}",
      rules: "Trigger line must reference something real about the prospect (use research if provided). 60 words max. CTA is interest-based ('worth a look?'), never a meeting ask."
    },
    {
      id: 'three-liner', name: '3-Liner', category: 'Ultra-short',
      template: "{{one_line_pain_question}}\n{{one_line_proof}}\n{{one_line_cta}}",
      rules: "Exactly 3 lines. 35 words max total. No greeting, no sign-off. Reads like a text message."
    }
  ],
  niches: [
    {
      id: 'saas', name: 'SaaS Pricing',
      angles: ['Existing customers underpriced', "Pricing hasn't kept up with product", 'ARR gap vs willingness to pay', 'Pre-raise pricing audit', 'CAC rising while ARR plateaus', 'NRR below benchmark', 'Growth only from new logos'],
      triggerWords: ['ARR', 'NRR', 'CAC', 'churn', 'willingness to pay', 'price migration', 'packaging', 'exit multiple']
    },
    {
      id: 'amazon', name: 'Amazon / eCommerce',
      angles: ['Revenue leak audit', 'Flatlined sales with rising ad spend', 'ACOS too high', 'Listings converting below benchmark', 'Wasted PPC spend', 'Profit wall at $30K/month', 'Shopify strong, Amazon untouched', 'Resellers undercutting brand'],
      triggerWords: ['ACOS', 'TACoS', 'PPC', 'listing CRO', 'buy box', 'review velocity', 'bundles', 'Subscribe & Save']
    },
    {
      id: 'strategy', name: 'Strategy & Consulting',
      angles: ['AI making delivery faster but cheaper', 'Billing for effort not outcomes', 'AI pilots stuck in the lab', 'ARR capped by headcount', 'Too many priorities, no focus', 'Leadership firefighting not building'],
      triggerWords: ['outcome-based pricing', 'consumption tiers', 'delivery margin', 'governance', 'pilot to production', 'utilization']
    }
  ],
  clients: [
    { id: 'ehealth', name: 'VC-backed eHealth', meta: 'US · ~$500M B2C Revenue', nicheId: 'saas',
      caseStudy: { size: '~$500M B2C revenue', result: '20% ARR uplift potential', mechanism: 'Historical deal data pricing model + migration of existing customers to updated price levels', proofLine: 'We just helped a $500M eHealth platform identify 20% ARR uplift by repricing their existing customer base. No new customers, no churn spike.', pains: ['pricing not reflecting value', 'B2B expansion without clear pricing strategy', 'existing customers underpriced'], objections: ["we don't want to lose customers", "our sales team can't handle a pricing change", "we just raised and don't want disruption"], desires: ['ARR growth', 'better margins', 'stronger multiple at next raise'] },
      frameworkOverrides: {} },
    { id: 'insurance', name: 'Insurance Pricing Platform', meta: 'UK · ~$70M Series B', nicheId: 'saas',
      caseStudy: { size: '~$70M Series B', result: '17% ARR uplift potential', mechanism: 'Competitor interviews + packaging redesign + controlled customer migration', proofLine: 'We just helped a $70M Series B insurance platform unlock 17% ARR uplift through optimised packaging and controlled migration.', pains: ['fragmented pricing structure', 'packaging not aligned to value', 'competitor pricing unknown'], objections: ['we already have a pricing team', 'our market is too regulated to change pricing', 'migrations are too risky'], desires: ['ARR', 'better margins', 'stronger multiple if you ever raise or sell'] },
      frameworkOverrides: {} },
    { id: 'ux', name: 'PE-backed UX Software', meta: 'Nordics · $10–30M ARR', nicheId: 'saas',
      caseStudy: { size: '$10–30M ARR', result: '$8M ARR uplift potential', mechanism: 'Quantitative willingness-to-pay survey + price level rebuild + enterprise migration', proofLine: 'We just helped a $10–30M ARR UX software company find $8M in ARR by repricing their existing enterprise customers. Zero new logos needed.', pains: ['pricing outdated vs product value', 'enterprise customers underpriced', 'no willingness-to-pay data'], objections: ['our enterprise clients will push back', "we don't want to risk churn", "we've tried pricing changes before"], desires: ['ARR', 'better margins', 'stronger exit multiple for PE'] },
      frameworkOverrides: {} },
    { id: 'infra', name: 'Infrastructure Streaming', meta: 'US · $20M+ Revenue', nicheId: 'saas',
      caseStudy: { size: '$20M+ revenue', result: 'Prevented flawed pricing rollout', mechanism: '30 buyer interviews + structural weakness identification + full pricing model redesign', proofLine: 'We just helped a PE-backed infrastructure platform validate their pricing strategy through 30 buyer interviews — uncovering flaws before a costly rollout.', pains: ['new pricing strategy unvalidated', 'product complexity growing faster than monetisation', 'risk of losing customers on migration'], objections: ['we already built our new pricing', "we don't have time for research", "our buyers won't talk to you"], desires: ['protected revenue', 'better margins', 'stronger multiple at PE exit'] },
      frameworkOverrides: {} },
    { id: 'finserv', name: 'Financial Services Software', meta: 'APAC · Multi-product', nicheId: 'saas',
      caseStudy: { size: 'Multi-product, banking/insurance/lending', result: '~5% TCV uplift identified', mechanism: '40 market interviews + 4-pillar pricing redesign + Excel pricing tool for commercial execution', proofLine: 'We helped a PE-backed financial software company identify 5% TCV uplift across four product pillars, backed by 40 market interviews and a dedicated pricing tool.', pains: ['multiple products with inconsistent pricing', 'sales team quoting inconsistently', 'no scalable pricing metrics'], objections: ['our products are too complex to standardise', "sales won't adopt a new tool", 'APAC markets are too different'], desires: ['TCV growth', 'better margins', 'stronger multiple at PE exit'] },
      frameworkOverrides: {} },
    { id: 'flourish', name: 'Flourish Pancakes', meta: 'DTC Food · Amazon + Shopify', nicheId: 'amazon',
      caseStudy: { size: 'DTC food brand, Amazon + Shopify', result: '$25K → $100K/month revenue', mechanism: 'Rebuilt Amazon listings + redesigned social content + optimised pricing and bundles + overhauled ad strategy', proofLine: 'We just helped Flourish Pancakes go from $25K to $100K a month on Amazon by rebuilding their listings, fixing their ads, and adding a two-pack bundle that significantly boosted profit.', pains: ['Amazon revenue flatlined', 'no bundling strategy', 'ads running but not converting'], objections: ["we've had bad experiences with agencies", "we don't have budget right now", 'we manage Amazon in-house'], desires: ['monthly revenue', 'better margins', 'stronger multiple if you ever raise or sell'] },
      frameworkOverrides: {} },
    { id: 'heladiv', name: 'Heladiv', meta: 'Restaurant + eCom', nicheId: 'amazon',
      caseStudy: { size: 'Restaurant + eCommerce', result: 'Doubled sales in 90 days, ACOS dropped', mechanism: 'Gradual spend increase as results arrived + PPC strategy + listings optimisation', proofLine: 'We helped Heladiv double their Amazon sales in 90 days while lowering ACOS — starting slow, increasing spend only as results came in. No horror stories.', pains: ['eCom plateaued at $10K/month', 'no confidence to scale ads', 'fear of Amazon after horror stories'], objections: ["we've tried ads before and it didn't work", "we don't understand Amazon", "we're scared of wasting money"], desires: ['monthly revenue', 'better margins', 'a business worth more if you ever sell'] },
      frameworkOverrides: {} },
    { id: 'erp', name: 'Retail ERP Provider', meta: 'Nordics & Baltics', nicheId: 'strategy',
      caseStudy: { size: 'Leading Nordic market position', result: 'Pricing model rebuilt for AI era', mechanism: 'Moved pricing from hours to sized consumption tiers + embedded AI costs + rebuilt client reporting from outputs to outcomes', proofLine: 'We helped a leading Nordic ERP provider stop billing by the hour, embed AI costs into fixed pricing tiers, and re-anchor client conversations on outcomes. Now faster delivery means higher margins, not lower ones.', pains: ['AI making delivery faster but reducing revenue', 'billing for effort not outcomes', 'support sold as metered time'], objections: ['our clients expect hourly billing', "we can't change mid-contract", "our delivery team won't accept this"], desires: ['profit per engagement', 'better margins', 'stronger multiple if you ever raise or sell'] },
      frameworkOverrides: {} },
    { id: 'retailtech', name: 'Retail-Tech Platform', meta: '€130M+ Recurring Revenue', nicheId: 'strategy',
      caseStudy: { size: '€130M+ recurring revenue, multi-country', result: 'AI age-verification feature shipped live in stores', mechanism: 'Mapped which processes could absorb innovation + built feedback loops + set governance for iterative delivery', proofLine: 'We helped a €130M retail-tech platform ship an AI feature into live stores in a multi-country environment — without disrupting core operations or checkout systems.', pains: ['AI pilots never making it to production', 'fear of disrupting core systems', 'no governance for innovation'], objections: ['our tech is too complex to change', "we can't risk disrupting live stores", "we don't have the team bandwidth"], desires: ['ARR from AI features', 'better margins', 'stronger multiple if you ever raise or sell'] },
      frameworkOverrides: {} }
  ]
};

// ─── SEED DEFAULTS ───────────────────────────────────────────────────────────
// ── Script Builder rewrite buttons (user-configurable in Admin → Builder Buttons) ──
export function defaultBuilderButtons(): any[] {
  return [
    { id: 'shorten', label: 'Shorten', icon: 'ti-arrows-minimize', keepStructure: false, enabled: true, examples: '', prompt: 'Make this shorter and more concise — cut filler and repetition, keep the core message and every {{merge_tag}}. Return only the script.' },
    { id: 'simpler', label: 'Simpler', icon: 'ti-mood-smile', keepStructure: true, enabled: true, examples: '', prompt: 'Make this SIMPLER and easier to understand — clearer wording, shorter phrases, swap long/technical words for plain ones (a 12-year-old reads it easily). No jargon.' },
    { id: 'conversational', label: 'Conversational', icon: 'ti-message-circle', keepStructure: true, enabled: true, examples: '', prompt: 'Make this more CONVERSATIONAL and human — like a real person talking, warm and natural, with everyday contractions and a relaxed opener. No stiff or robotic phrasing.' },
    { id: 'salesy', label: 'Salesy', icon: 'ti-trending-up', keepStructure: true, enabled: true, examples: '', prompt: 'Make this more SALESY — more outcome-driven and direct. Emphasise desired outcomes (more revenue, more qualified inquiries, more booked calls, predictable growth), use stronger but truthful claims and specific numbers only if already supported by the offer. Do NOT invent claims or numbers.' },
    { id: 'softer', label: 'Softer', icon: 'ti-feather', keepStructure: true, enabled: true, examples: '', prompt: 'Make this SOFTER and lower-pressure — less direct, less pushy. Reduce hard claims and aggressive language, soften the ask, make it feel relaxed and no-pressure.' },
    { id: 'reformat', label: 'Reformat', icon: 'ti-layout-list', keepStructure: false, enabled: true, examples: '', prompt: 'Reformat this into a clean, easy-to-read layout: a short greeting line, the body broken into short readable lines / short paragraphs, and the CTA on its own line at the end. Keep the EXACT wording, message, offer and every {{merge_tag}} — only change spacing and line breaks.' },
  ];
}

// The sales document, part by part. Headings support {client} as a placeholder.
export const SALES_SECTION_DEFS: any[] = [
  ['intro', 'Personalised intro (AI written)'],
  ['brief', 'Their research (services, positioning, case studies, competitors)'],
  ['how', 'How we get them booked calls + process'],
  ['expect', 'What they can expect'],
  ['who', 'Who we are (proof, wins, links)'],
  ['included', 'What is included + promise'],
  ['investment', 'Investment'],
  ['next', 'Next step'],
];
export const DEFAULT_SALES_DOC: any = {
  prompt: '',
  mention: [],
  custom: [],
  show: { intro: true, brief: true, how: true, expect: true, who: true, included: true, investment: true, next: true },
  headings: {
    brief: 'About {client}',
    how: 'How we get you booked calls',
    expect: 'What you can expect',
    who: 'Who we are',
    included: "What's included",
    investment: 'Your investment',
    next: 'Next step',
  },
};
export function salesHeading(key: string, c: any, cfg: Config): string {
  const sd = cfg?.sellerProfile?.salesDoc || DEFAULT_SALES_DOC;
  return String(sd.headings?.[key] || DEFAULT_SALES_DOC.headings[key] || '').replaceAll('{client}', c?.name || 'you');
}

// Agency Advanta's own profile — what we pitch in a sales plan. Seeded from the
// company's real offer, contract and VSL; fully editable in Admin → Our Agency.
export const DEFAULT_SELLER_PROFILE: any = {
  name: 'Agency Advanta',
  legal: 'JA Jozy Media Ltd',
  website: 'agencyadvanta.com',
  logo: 'https://logo.clearbit.com/agencyadvanta.com',
  founder: 'Josiah Ansu, Founder and CEO',
  tagline: 'Done for you AI outreach that books you 10 to 40 qualified calls a month.',
  whoWeAre: 'We build and run cold outreach systems for marketing agencies and consultants. We find your ideal clients, write the messages, set up the software, and fill your calendar with qualified calls so you can just show up and close.',
  trackRecord: '400+ agencies and consultants served, over 500 verified results, scaled to $115k a month.',
  whyDifferent: [
    'Our own LinkedIn software multiplies your outreach volume at the lowest cost.',
    'AI finds and scores the decision makers most ready to buy, for pennies.',
    'AI reply agents book calls and follow up 24/7, sounding just like you.',
    'Unlimited one to one coaching built around your business.',
    'A scripting system that works without big guarantees or wild offers.'
  ],
  howWeFindLeads: 'We pull your ideal buyers from a live database of millions, then our AI scores every one so only the people most likely to buy make your list. Each message gets a personal first line written by AI, so it reads like one human writing to another, not spam.',
  howWeQualify: 'We agree on exactly who counts as a good lead with you up front. Only people who match get contacted, and the AI reply agent asks the right questions before it books anyone, so your calendar fills with real prospects, not tire kickers.',
  caseStudies: [
    { name: 'Zach', result: 'added an extra $120k a month in 90 days', link: '' },
    { name: 'Craig', result: 'added $30k in 30 days', link: '' },
    { name: 'Vimmal', result: 'added $160k in 9 months', link: '' },
    { name: 'Nana', result: 'added $20k a month in 4 months', link: '' },
    { name: 'Abde', result: 'added $12k a month', link: '' },
    { name: 'Aaman', result: 'added $40k a month', link: '' }
  ],
  socialLinks: [],
  process: [
    { phase: 'Week 1 to 2: Setup', items: ['Audit your offer, niche and positioning', 'Agree who counts as a qualified lead', 'Build your personalised growth plan', 'Set up the AI to score leads and write personal lines', 'Build your target list of ideal clients'] },
    { phase: 'Week 3 to 8: Launch and improve', items: ['Launch your campaigns and watch the numbers', 'Test the messaging and the targeting', 'Find what books qualified calls', 'Install AI reply agents to book calls for you', 'Review your sales calls together'] },
    { phase: 'Week 9 to 12: Scale and step back', items: ['Turn up the volume or add new systems', 'Add fresh angles', 'Book more calls', 'Hand calls to setters so you step out of chasing leads', 'Grow your revenue'] }
  ],
  deliverables: [
    'Full cold outreach setup: lead list, AI personalisation, scripts and software',
    'Access to our proprietary software for the whole support period',
    '12 months of hands on support',
    'Weekly performance reviews and campaign updates',
    'One to one support calls whenever you need them',
    '24 hour Slack support from Josiah and the client success team'
  ],
  programCost: 15000,
  guarantee: 'If you do not book at least 50 calls in 180 days, you get every penny back. Simple conditions apply, like staying active and replying to your leads.',
  costNote: 'The fee covers everything we build and run for you. You pay the email and sending tools (inboxes, domains, sending software) directly to those providers, and we set them all up for you.'
};

// Outbound follow-up frameworks — models the AI bases each follow-up on.
export const DEFAULT_FOLLOWUP_FRAMEWORKS: any[] = [
  { id: 'fu-clientwin', name: 'Client win story', template: "Hi {{first_name}},\nI wanted to share what we did for {client}. {client} is a {client business}.\n{the problem they had}\nOur solution: {how we solved it}\nWould love to see if we could do something similar for {{company}}.\nThanks\n{signature}" },
  { id: 'fu-winstack', name: 'Recent wins stack', template: "Hi {{first_name}}, just wanted to share a few recent wins with you.\n{case study}\n{case study}\n{case study}\nAnd {case study}.\nMind if I share some info on how we consistently get results like these for {sub-niche}?\nThanks\n{signature}" },
  { id: 'fu-videooffer', name: 'Case study video offer', template: "Hi {{first_name}}, we've just made a video on how we helped {case study} get {outcome} in {timeframe}, want to see it?\nThanks\n{signature}" },
  { id: 'fu-research', name: 'Research / study share', template: "Hi {{first_name}}, we recently completed a research paper on how {niche} get {outcome} where we discovered {mechanism}.\nDo you mind if I share the document here?\nThanks\n{signature}" },
  { id: 'fu-plan', name: 'Custom plan + video offer', template: "Hi {{first_name}}, I wanted to share my plan for {{company}} and how we'd get {outcome}:\n{plan}\nWe just helped {case study}.\nMind if I record a quick 3-minute video outlining how we'd do something similar for {{company}}?\nThanks\n{signature}" },
  { id: 'fu-peer', name: 'Reminded by a peer', template: "Hi {{first_name}}, I was speaking to {name} from {case study} and it reminded me to follow up with you. They're also a {common identifier} and we recently helped them {transformation} in {timeframe}.\nInterested in seeing if we could do something similar for {{company}}?\nThanks\n{signature}" },
  { id: 'fu-peervideo', name: 'Case study video (peer)', template: "Hi {{first_name}}, we just spoke to {case study} and thought you might be interested in what they had to say.\n[link to case study video]\nMind if I share it here?\nThanks\n{signature}" },
  { id: 'fu-xcompanies', name: 'X companies like you', template: "Hi {{first_name}}, we have helped over {X} companies similar to {{company}} in the {sub-niche}. Would you mind if I send over a video outlining how we can {transformation} in {time} for you?\nThanks\n{signature}" },
  { id: 'fu-directhelp', name: 'Direct help offer', template: "Hi {{first_name}}, would you mind if I tell you exactly how we can help you with {what we help with} in {time}?\nThanks\n{signature}" },
  { id: 'fu-problemq', name: 'Problem question', template: "Hi {{first_name}}, are you ever facing the problem of {what we can help with}?\nMind if I share some examples of what's possible?\nThanks\n{signature}" },
  { id: 'fu-fullplan', name: 'Full plan + chat', template: "Hey {{first_name}}, have you ever heard of {case study}? We just helped them {transformation} in {timeframe}.\nJust to show you how we'd do the same for {{company}}:\n{plan for how you'd get results}\nSimilar to how we helped {case study} {result}.\nWould you be open to a quick chat to see if we can do the same for {{company}}?\nThanks\n{signature}" },
];

// costModel: 'flat' ($/mo) · 'per_1k_leads' · 'per_1k_verified' ($ per 1000) · 'tokens' (uses inPerM/outPerM $ per 1M)
export const DEFAULT_TOOLS_KB: any[] = [
  { id: 'tool-apollo', name: 'Apollo.io', category: 'scraping', channels: ['email', 'linkedin'], link: 'https://apollo.io', costModel: 'flat', cost: 99, why: 'Lead database — find and scrape the ICP\'s job titles at the target company sizes.' },
  { id: 'tool-mv', name: 'MillionVerifier', category: 'verification', channels: ['email'], link: 'https://millionverifier.com', costModel: 'per_1k_verified', cost: 0.37, why: 'Verify scraped emails before sending — protects domain reputation, keeps bounces under 2%.' },
  { id: 'tool-smartlead', name: 'Smartlead', category: 'sending', channels: ['email'], link: 'https://smartlead.ai', costModel: 'flat', cost: 94, why: 'Multi-inbox email sequencer with warmup and inbox rotation for deliverability at volume.' },
  { id: 'tool-heyreach', name: 'HeyReach', category: 'sending', channels: ['linkedin'], link: 'https://heyreach.io', costModel: 'flat', cost: 79, why: 'LinkedIn outreach automation — connection requests and DMs at safe daily volumes.' },
  { id: 'tool-gemini', name: 'Gemini 2.5 Flash', category: 'personalization', channels: ['email', 'linkedin'], link: 'https://ai.google.dev', costModel: 'tokens', inPerM: 0.30, outPerM: 2.50, cost: 0, why: 'Writes a personalized first line per lead from their scraped data — relevance lifts reply rates.' },
  { id: 'tool-replyagent', name: 'AI Reply Agent', category: 'reply-agent', channels: ['email', 'linkedin'], link: '', costModel: 'flat', cost: 250, why: 'Answers replies within minutes and books the call. The client signs up for this directly.' },
];

// Frameworks visible for a niche: global ones (no scope) + ones scoped to it.
export const frameworksForNiche = (nicheId: string, cfg: Config): any[] =>
  (cfg.frameworks || []).filter((f: any) => !(f.nicheIds || []).length || (f.nicheIds || []).includes(nicheId));

// ─── MIGRATION ───────────────────────────────────────────────────────────────
// Migrate older configs: clients used a single nicheId; v3 clients target many.
export function migrateConfig(cfg: Config): Config {
  (cfg.clients || []).forEach((c: any) => {
    if (!Array.isArray(c.nicheIds)) c.nicheIds = c.nicheId ? [c.nicheId] : [];
    delete c.nicheId;
    c.website = c.website || '';
    c.contact = c.contact || '';   // client contact person (v9)
    c.csm = c.csm || '';           // CSM owner (v9)
    c.stage = c.stage || '';       // Testing | Proof of concept | Scaling (v9)
    if (!Array.isArray(c.tags)) c.tags = [];
    c.competitorIntel = c.competitorIntel || [];
    c.frameworkOverrides = c.frameworkOverrides || {};
    c.caseStudy = c.caseStudy || {};
    c.avoid = c.avoid || [];
    c.guarantees = c.guarantees || [];
    c.savedAngles = c.savedAngles || [];
    c.scriptReservoir = c.scriptReservoir || [];
    // Name every saved script "<D Mon> · v<n>" — sequential per day. Deterministic, so
    // it also repairs legacy titles (framework names / "v14") across all clients.
    {
      const per: any = {}, MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      c.scriptReservoir.forEach((s: any) => {
        const iso = String(s.savedAt || '').slice(0, 10);
        const dt = iso ? new Date(iso + 'T00:00:00') : null;
        const label = (dt && !isNaN(dt.getTime())) ? `${dt.getDate()} ${MO[dt.getMonth()]}` : 'Undated';
        per[iso] = (per[iso] || 0) + 1;
        s.name = `${label} · v${per[iso]}`;
      });
    }
    c.transcripts = c.transcripts || [];
    c.favorites = c.favorites || { pains: [], desires: [], caseStudies: [], offers: [] };
    ['pains', 'desires', 'caseStudies', 'offers'].forEach(k => { if (!Array.isArray(c.favorites[k])) c.favorites[k] = []; });
    c.sources = c.sources || {};   // text → {type:'site'|'transcript'|'research'|'ai'|'competitor', label}
    c.icps = c.icps || [];         // saved ideal customer profiles from the ICP builder
    c.icps.forEach((ic: any) => { if (typeof ic.description !== 'string') ic.description = ''; if (!Array.isArray(ic.desires)) ic.desires = []; if (!Array.isArray(ic.objections)) ic.objections = []; if (!Array.isArray(ic.pains)) ic.pains = []; if (!Array.isArray(ic.painGroups)) ic.painGroups = []; if (!Array.isArray(ic.desireGroups)) ic.desireGroups = []; });
    if (!Array.isArray(c.painGroups)) c.painGroups = [];
    if (!Array.isArray(c.desireGroups)) c.desireGroups = [];
    if (!Array.isArray(c.mechanisms)) c.mechanisms = [];   // built "how it works" mechanisms
    // Per-niche data buckets (pains/desires/offers scoped to each niche).
    c.nicheData = c.nicheData || {};
    (c.nicheIds || []).forEach((nid: string) => { const b = c.nicheData[nid] = c.nicheData[nid] || {}; b.pains = b.pains || []; b.desires = b.desires || []; b.offers = b.offers || []; });
    // One-time backfill: existing client-wide case-study items → the primary niche bucket (idempotent).
    if (!c._nicheMigrated) {
      const pn = (c.nicheIds || [])[0];
      if (pn) { const b = c.nicheData[pn] = c.nicheData[pn] || { pains: [], desires: [], offers: [] }; const cs = c.caseStudy || {};
        (cs.pains || []).forEach((t: any) => { if (b.pains.indexOf(t) < 0) b.pains.push(t); });
        (cs.desires || []).forEach((t: any) => { if (b.desires.indexOf(t) < 0) b.desires.push(t); });
        (cs.offers || []).forEach((t: any) => { if (b.offers.indexOf(t) < 0) b.offers.push(t); });
      }
      c._nicheMigrated = true;
    }
    c.growthPlans = c.growthPlans || []; // saved growth plans
    c.followups = c.followups || []; // saved outbound follow-up sequences
    c.brief = c.brief || null; // client-facing brief (services/positioning/case studies/competitors)
  });
  if (!Array.isArray(cfg.followupFrameworks) || !cfg.followupFrameworks.length) cfg.followupFrameworks = structuredClone(DEFAULT_FOLLOWUP_FRAMEWORKS);
  (cfg.frameworks || []).forEach((f: any) => { f.nicheIds = f.nicheIds || []; });
  cfg.winningScripts = cfg.winningScripts || [];
  cfg.settings = cfg.settings || {};
  // Default export destination = the "CSM" page; also migrate configs still on
  // the old code default (Outreach Tracker), which was never user-chosen.
  if (!cfg.settings.notionParentId || cfg.settings.notionParentId === '33a4fd2a4cfe81fdaab6e17031fa93be') {
    cfg.settings.notionParentId = '3744fd2a4cfe8015830fc724e06dcdb3';
  }
  cfg.settings.growthRules = cfg.settings.growthRules || '';
  {
    const sf: any = Object.assign({ enabled: true, model: 'sonnet', lens: '', messaging: '', icpScripter: '', offers: '' }, cfg.settings.systemFilter || {});
    const mergeTxt = (...xs: any[]) => xs.map(x => String(x || '').trim()).filter(Boolean).join('\n\n');
    // Consolidate the old split fields into the merged ones, preserving every bit of data.
    if (sf.scriptFilter != null) { sf.messaging = mergeTxt(sf.messaging, sf.scriptFilter); delete sf.scriptFilter; }
    if (sf.angleLogic != null)   { sf.icpScripter = mergeTxt(sf.icpScripter, sf.angleLogic); delete sf.angleLogic; }
    if (sf.offersKB != null || sf.guaranteesKB != null || sf.offerSheet != null) {
      sf.offers = mergeTxt(sf.offers, sf.offersKB, sf.guaranteesKB, sf.offerSheet);
      delete sf.offersKB; delete sf.guaranteesKB; delete sf.offerSheet;
    }
    cfg.settings.systemFilter = sf;
  }
  // Backfill any planDefaults fields added in later versions (inbox/profile math).
  cfg.settings.planDefaults = cfg.settings.planDefaults || structuredClone(DEFAULT_CONFIG.settings.planDefaults);
  ['email', 'linkedin', 'personalization'].forEach(k => {
    cfg.settings.planDefaults[k] = { ...DEFAULT_CONFIG.settings.planDefaults[k], ...(cfg.settings.planDefaults[k] || {}) };
  });
  // Prospects (Sales tab) — pre-sale pipeline, completely separate from clients.
  cfg.prospects = cfg.prospects || [];
  cfg.prospects.forEach((p: any) => { p.icps = p.icps || []; p.targetIcpIds = p.targetIcpIds || []; p.sampleScripts = p.sampleScripts || []; p.channels = p.channels || ['email']; p.caseStudy = p.caseStudy || {}; });
  // Tools knowledge base — what we use, why, cost. Seed sensible defaults once.
  if (!Array.isArray(cfg.toolsKB) || !cfg.toolsKB.length) cfg.toolsKB = structuredClone(DEFAULT_TOOLS_KB);
  // Our own agency profile (the seller) — powers the sales growth plan.
  if (!cfg.sellerProfile || !cfg.sellerProfile.name) cfg.sellerProfile = structuredClone(DEFAULT_SELLER_PROFILE);
  // Sales-document defaults: per-section visibility + headings, extra AI
  // prompt, always-mention list, custom sections. Merge new keys into old configs.
  cfg.sellerProfile.salesDoc = { ...structuredClone(DEFAULT_SALES_DOC), ...(cfg.sellerProfile.salesDoc || {}) };
  cfg.sellerProfile.salesDoc.show = { ...DEFAULT_SALES_DOC.show, ...(cfg.sellerProfile.salesDoc.show || {}) };
  cfg.sellerProfile.salesDoc.headings = { ...DEFAULT_SALES_DOC.headings, ...(cfg.sellerProfile.salesDoc.headings || {}) };
  if (!Array.isArray(cfg.sellerProfile.salesDoc.mention)) cfg.sellerProfile.salesDoc.mention = [];
  if (!Array.isArray(cfg.sellerProfile.salesDoc.custom)) cfg.sellerProfile.salesDoc.custom = [];
  return cfg;
}

// ─── CONFIG LOAD / SAVE ────────────────────────────────────────────────────────
// Keep a small ring of local backups so a bad sync can always be rolled back.
export function backupConfig(cfg: Config | null | undefined, tag?: string): void {
  if (!cfg || typeof cfg !== 'object') return;
  try {
    const at = new Date().toISOString();
    const entry = JSON.stringify({ at, tag: tag || '', clients: (cfg.clients || []).length, config: cfg });
    const key = 'outreach_config_bak_' + Date.now();
    safeStorageSet(key, entry);
    let idx: any[] = []; try { idx = JSON.parse(safeStorageGet('outreach_config_bak_index') || '[]'); } catch { /* ignore */ }
    idx.push(key);
    while (idx.length > 3) { const old = idx.shift(); try { localStorage.removeItem(old); } catch { /* ignore */ } }
    safeStorageSet('outreach_config_bak_index', JSON.stringify(idx));
  } catch { /* ignore */ }
}
export function listBackups(): any[] {
  let idx: any[] = []; try { idx = JSON.parse(safeStorageGet('outreach_config_bak_index') || '[]'); } catch { /* ignore */ }
  return idx.map(k => { try { const e = JSON.parse(safeStorageGet(k)); return e ? { key: k, at: e.at, tag: e.tag, clients: e.clients, config: e.config } : null; } catch { return null; } }).filter(Boolean).reverse();
}
export const cfgClients = (c: Config | null | undefined): number => (c && Array.isArray(c.clients)) ? c.clients.length : -1;

// `_rev` is a server-assigned MONOTONIC counter; read it as a number (0 = never synced).
export const cfgRev = (c: Config | null | undefined): number => Number((c && c._rev) || 0);

// Read the locally-persisted config (the live document). Mirrors the legacy
// `safeStorageGet('outreach_config_v2') → JSON.parse` read in loadConfig.
export function loadLocalConfig(): Config | null {
  let local: Config | null = null; const localRaw = safeStorageGet('outreach_config_v2');
  if (localRaw) { try { local = JSON.parse(localRaw); } catch { /* ignore */ } }
  return local;
}

// Persist the live config to localStorage with quota handling. On a failed write (quota
// exceeded) we drop the local backup ring (which stores full copies) and retry; if it still
// fails we warn once so the user knows their edits live on the server / in memory only — not
// silently lost on the next reload.
let localSaveWarned = false;
export function saveLocalConfig(config: Config): boolean {
  const json = JSON.stringify(config);
  if (safeStorageSet('outreach_config_v2', json)) return true;
  try {
    const idx = JSON.parse(safeStorageGet('outreach_config_bak_index') || '[]');
    (idx || []).forEach((k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
    localStorage.removeItem('outreach_config_bak_index');
  } catch { /* ignore */ }
  if (safeStorageSet('outreach_config_v2', json)) return true;
  if (!localSaveWarned) { localSaveWarned = true; console.warn('⚠️ Browser storage is full — changes are saved to the server but NOT on this device. Free up space or export a backup.'); }
  return false;
}

// Deep-merge two configs without losing data, preferring `a` (the locally-edited copy) on
// scalar conflicts. Object arrays that carry an `id` are unioned by id (so neither side's
// additions are dropped); other arrays prefer the longer/local one. Used to reconcile a save
// conflict where another device advanced the server copy under us.
export function mergeConfigVal(a: any, b: any): any {
  if (Array.isArray(a) && Array.isArray(b)) {
    const ided = (arr: any[]) => arr.length && arr.every(x => x && typeof x === 'object' && 'id' in x);
    if (ided(a) && ided(b)) {
      const byId = new Map();
      b.forEach((x: any) => byId.set(x.id, x));
      a.forEach((x: any) => byId.set(x.id, byId.has(x.id) ? mergeConfigVal(x, byId.get(x.id)) : x));
      return [...byId.values()];
    }
    return a.length >= b.length ? a : b;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out = Object.assign({}, b);
    for (const k of Object.keys(a)) out[k] = (k in b) ? mergeConfigVal(a[k], b[k]) : a[k];
    return out;
  }
  return a === undefined ? b : a;
}
export function mergeConfigs(local: Config, server: Config): Config { return mergeConfigVal(local, server); }

// Version-aware load. _rev is now a server-assigned MONOTONIC counter (not a wall clock), so
// it can't be skewed across devices. _dirty marks unsynced local edits, so a device with real
// unsaved work always keeps it. The discarded copy is always backed up first. needsServerResave
// flags a self-heal push, which goes through the compare-and-swap save and so cannot clobber.
//
// Decoupled port of the legacy `loadConfig`: it no longer mutates globals or renders. It reads
// local + (when hasAdminKey) the server, reconciles exactly as the legacy did, runs
// migrateConfig on the chosen config, and RETURNS the reconciled data for the React store.
export async function loadConfigData(opts: { hasAdminKey: boolean }): Promise<{ config: Config; source: ConfigSource; needsServerResave: boolean }> {
  let needsServerResave = false;
  const local = loadLocalConfig();
  let server: Config | null = null;
  if (opts.hasAdminKey) {
    try {
      const data = await api({ action: 'get_config' });
      if (data.config && Array.isArray(data.config.frameworks)) server = data.config;
    } catch (e) { console.warn('server config load failed:', (e as Error)?.message); }   // transient: keep local; the CAS save guards against clobber
  }
  const localOk = local && Array.isArray(local.frameworks) && local.frameworks.length;
  const serverOk = server && Array.isArray(server.frameworks) && server.frameworks.length;

  let config: Config;
  let configSource: ConfigSource;

  if (localOk && serverOk) {
    const lrev = Number((local as Config)._rev || 0), srev = Number((server as Config)._rev || 0);
    const localDirty = !!(local as Config)._dirty;
    // Unsynced local edits win this device; otherwise the higher server-rev wins; a true tie
    // (same rev, no unsaved edits — the copies should be identical) falls to the richer copy.
    const useLocal = localDirty ? true : (lrev !== srev ? lrev > srev : cfgClients(local) > cfgClients(server));
    if (useLocal) {
      backupConfig(server, 'server-copy-at-load');
      config = local as Config; configSource = 'local';
      needsServerResave = true;                         // push local up; CAS merges if the server moved
    } else {
      backupConfig(local, 'local-copy-at-load');
      config = server as Config; configSource = 'server';
      saveLocalConfig(config);
    }
  } else if (serverOk) {
    config = server as Config; configSource = 'server'; saveLocalConfig(config);
  } else if (localOk) {
    config = local as Config; configSource = 'local'; needsServerResave = !!opts.hasAdminKey;
  } else {
    config = structuredClone(DEFAULT_CONFIG); configSource = 'defaults';
  }

  migrateConfig(config);
  return { config, source: configSource, needsServerResave };
}

// ── Backup / restore: download, restore-from-file, restore-from-snapshot ──
// Triggers a JSON download of the live config. The legacy success/error toasts are
// dropped here (UI orchestration lives in the React store); the download is the data op.
export function exportConfig(config: Config): void {
  try {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'script-bot-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { console.warn('Export failed: ' + ((e as Error)?.message || '')); }
}

// Parse + validate a pasted/file JSON string → Config | null. Mirrors importConfigFile's
// validation (must parse and carry a frameworks array). Returns the parsed config (the store
// confirms + restores); returns null on bad JSON or an invalid backup shape.
export function importConfigText(text: string): Config | null {
  try {
    const cfg = JSON.parse(text);
    if (!cfg || !Array.isArray(cfg.frameworks)) return null;
    return cfg as Config;
  } catch {
    return null;
  }
}

// Read a snapshot from the backup ring by key → Config | null. Mirrors restoreBackup's
// snapshot read (the legacy confirm()/restore orchestration lives in the React store).
export function restoreBackup(key: string): Config | null {
  let e: any; try { e = JSON.parse(safeStorageGet(key)); } catch { /* ignore */ }
  if (!e || !e.config) return null;
  return e.config as Config;
}
