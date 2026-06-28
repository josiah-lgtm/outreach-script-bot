// Portable Notion "block" builders — a decoupled port of the legacy client-side
// builders in legacy/index.html.
//
// CONTRACT: every block object produced here is a `{ t, ... }` shape that the
// server's `toNotionBlock` (web/src/server/notion.ts) knows how to render. The
// server switches on `t` and accepts EXACTLY these tags:
//   'h1' | 'h2' | 'h3' | 'callout' | 'bullet' | 'todo' | 'code' | 'toggle'
//   | 'image' | 'bookmark' | 'divider' | 'table'
// Anything else (notably 't:"p"') falls through to the server's default branch,
// which renders a Notion paragraph. The legacy code emitted `t:'p'` for plain
// paragraphs and relied on exactly that fallthrough, so we keep `'p'` as a
// first-class tag here — it is intentionally NOT in the server's switch.
//
// Legacy source anchors (legacy/index.html):
//   gpBuildBlocks         :6353
//   gpBriefBlocks         :5628
//   gpFollowupsBlocks     :5644
//   prospectDocBlocks     :5993
//   reverseRows           :5659
//   gpBlocksFromDocHtml   :5830  (REPLACED by blocksFromEditorDoc — walks Tiptap
//                                 / ProseMirror JSON instead of a DOM tree)
//
// DECOUPLING: the legacy builders read globals (`state.growth`, `config`,
// `gpClient()`, `gpActiveFollowups()`, …). Following the same pattern already
// used by funnel-math.ts, this module takes those inputs as typed ARGUMENTS.
// The funnel/cost MATH is reused from `@/lib/funnel-math` verbatim, so the
// numbers stay identical to the legacy output.
//
// PURE module: no React, no DOM, no network. (`use client` is not needed.)

import {
  computeReverse,
  gpCostRows,
  gpInfraRows,
  gpInt,
  gpMoney,
  gpPct,
  type Channel,
  type ChannelAssumptions,
  type FunnelResult,
  type GrowthState,
  type InfraRow,
  type Tool,
  type ToolCostRow,
} from "@/lib/funnel-math";

// ── block contract ───────────────────────────────────────────────────────────
// The portable block union. `t:'p'` is the legacy plain-paragraph tag (server
// default branch). The rest map 1:1 onto the server's switch cases.

export type Block =
  | { t: "h1"; text: string }
  | { t: "h2"; text: string }
  | { t: "h3"; text: string }
  | { t: "p"; text: string }
  | { t: "callout"; text: string }
  | { t: "bullet"; text: string }
  | { t: "todo"; text: string }
  | { t: "code"; text: string }
  | { t: "toggle"; text: string; children: Block[] }
  | { t: "image"; url: string }
  | { t: "bookmark"; url: string }
  | { t: "divider" }
  | { t: "table"; headers: string[]; rows: string[][] };

// ── input types ───────────────────────────────────────────────────────────────
// Kept deliberately loose where the underlying config is loose (it was untyped
// JS), but precise where the shape is well-known. `any` is allowed in this
// directory by the eslint config; we avoid it anyway except for the open-ended
// config bag.

/** ICP "real example" used in the brief (legacy `icp.example`). */
export interface IcpExample {
  company: string;
  website?: string;
  why?: string;
}

/** A target ICP referenced by the brief (subset the brief reads). */
export interface BriefIcp {
  title: string;
  example?: IcpExample;
}

/** Client brief (legacy `client.brief`). */
export interface Brief {
  positioning?: string;
  services?: string[];
  caseStudies?: string[];
  competitors?: string[];
}

/** A client/account carrying a brief (legacy `gpClient()`). */
export interface BriefClient {
  name?: string;
  brief?: Brief | null;
}

/** Growth-plan narrative (legacy `state.growth.narrative`). */
export interface GrowthNarrative {
  execSummary?: string;
  targetRationales?: Array<{ rationale?: string }>;
  closing?: string;
}

/** One script inside a target (legacy `target.scripts[]`). */
export interface TargetScript {
  label?: string;
  text: string;
}

/** A strategy target (legacy `state.growth.targets[]`). */
export interface GrowthTarget {
  title: string;
  why?: string;
  marketSize?: string;
  pains: string[];
  offer?: string;
  angles: string[];
  scripts: TargetScript[];
}

/** One follow-up item inside a sequence (legacy `seq.items[]`). */
export interface FollowupItem {
  day: number;
  framework?: string;
  text: string;
}

/** A follow-up sequence (legacy `gpActiveFollowups()` element). */
export interface FollowupSequence {
  parentLabel: string;
  items: FollowupItem[];
  gapDays?: number;
}

/**
 * The growth-plan state the builder reads. Mirrors `funnel-math`'s `GrowthState`
 * (so the same object flows into the cost/aggregate math) and adds the
 * doc-content fields the block builder needs on top.
 */
export interface GrowthPlanState extends GrowthState {
  mode: string; // 'strategy' | 'sales' | 'scaling' (legacy strings)
  narrative?: GrowthNarrative | null;
  targets: GrowthTarget[];
  winningScript?: { text: string } | null;
  nicheSize?: string;
  observed: Record<string, { contacted?: number; replies?: number; positive?: number; booked?: number }>;
  toggles: GrowthState["toggles"] & { pledge?: boolean; pledgeText?: string };
}

/**
 * Everything `buildGrowthPlanBlocks` needs, passed explicitly instead of read
 * from globals. `includedTools` is the legacy `gpIncludedTools()` output and
 * `followups` is the legacy `gpActiveFollowups()` output.
 */
export interface GrowthPlanInput {
  growth: GrowthPlanState;
  client: BriefClient;
  /** Resolved tools (legacy `gpIncludedTools()`) — drives the cost table. */
  includedTools: Tool[];
  /** Active follow-up sequences (legacy `gpActiveFollowups()`). */
  followups: FollowupSequence[];
  /** Channel label map (legacy `CH_LABEL`). */
  channelLabels: Record<string, string>;
}

/** Seller / agency profile (legacy `config.sellerProfile`). Loose by nature. */
export interface SellerProfile {
  name?: string;
  founder?: string;
  logo?: string;
  whoWeAre?: string;
  trackRecord?: string;
  whyDifferent?: string[];
  caseStudies?: Array<{ name?: string; result?: string; link?: string }>;
  socialLinks?: Array<{ url?: string }>;
  deliverables?: string[];
  guarantee?: string;
  programCost?: number;
  costNote?: string;
  process?: Array<{ phase?: string; items?: string[] }>;
  howWeFindLeads?: string;
  howWeQualify?: string;
  // salesDoc.show toggles + custom sections + headings.
  salesDoc?: SalesDoc;
}

/** The sales-doc visibility config (legacy `sellerProfile.salesDoc`). */
export interface SalesDoc {
  show?: Partial<Record<"intro" | "brief" | "how" | "expect" | "who" | "included" | "investment" | "next", boolean>>;
  custom?: Array<{ heading?: string; body?: string }>;
  headings?: Partial<Record<string, string>>;
}

/** A prospect record (legacy `config.prospects[]`). */
export interface Prospect {
  name?: string;
  website?: string;
  narrative?: { intro?: string; expectations?: string; closing?: string } | null;
  targetBookings?: number;
  channels?: string[];
  sampleScripts?: Array<{ label?: string; text: string }>;
  icps?: Array<BriefIcp & { id?: string }>;
  targetIcpIds?: string[];
}

/** Channel plan-defaults for the prospect pitch (legacy `config.settings.planDefaults`). */
export type PlanDefaults = Record<string, ChannelAssumptions>;

/** Everything `buildProspectDocBlocks` needs (decoupled from globals). */
export interface ProspectDocInput {
  prospect: Prospect;
  sellerProfile: SellerProfile;
  planDefaults: PlanDefaults;
  /** Resolved heading for a sales-doc section key (legacy `salesHeading`). */
  heading: (key: string) => string;
  /** Channel "summary" phrase (legacy `salesProgramSteps(...).ch`). */
  channelSummary: string;
  /** Per-channel "how we run it" line (legacy `salesProgramSteps(...).chanLine`). */
  channelLine: string;
  /** Clearbit-style logo URL for a website, '' if none (legacy `logoUrl`). */
  logoUrl: (website?: string) => string;
}

// ── small helpers ──────────────────────────────────────────────────────────────
const CH_LABEL_FALLBACK: Record<string, string> = { email: "📧 Email", linkedin: "🔗 LinkedIn" };
const chLabel = (labels: Record<string, string>, ch: string): string => labels[ch] ?? CH_LABEL_FALLBACK[ch] ?? ch;

// ── reverseRows — port of legacy :5659 ──────────────────────────────────────────
// Drives the reverse-funnel table. Returns [label, value, description, strong?]
// tuples. (The `strong` flag is UI-only emphasis and is dropped when building the
// Notion table, exactly as the legacy export did.)
type ReverseRow = [string, number, string, boolean?];

export function reverseRows(channel: Channel, m: FunnelResult, T: number, a: ChannelAssumptions): ReverseRow[] {
  return channel === "email"
    ? [
        ["🎯 Booked calls (target)", T, "Sales calls on the calendar — the goal. Everything below is sized to hit this.", true],
        ["Positive replies needed", m.positive, `Replies that say "interested, tell me more". ${gpPct(a.bookRate as number)} of these book a call.`],
        ["Replies needed", m.replies, `Any response at all. About ${gpPct(a.positiveRate as number)} of replies are positive.`],
        ["Verified emails needed", m.verified ?? 0, `Leads whose email passed verification — safe to send. ${gpPct(a.replyRate as number)} of them reply.`],
        ["Leads to scrape", m.leads, `Raw contacts to pull from the database. ~${gpPct(a.verifyRate as number)} survive verification.`, true],
        ["Emails to send / mo", m.outreaches, `Total sends: each verified lead gets the ${gpInt(a.sendsPerLead as number)}-step sequence.`],
      ]
    : [
        ["🎯 Booked calls (target)", T, "Sales calls on the calendar — the goal. Everything below is sized to hit this.", true],
        ["Positive replies needed", m.positive, `Replies that say "interested". ${gpPct(a.bookRate as number)} of these book a call.`],
        ["Replies needed", m.replies, `Responses from people who accepted. ~${gpPct(a.replyRate as number)} of accepted connections reply.`],
        ["Accepted connections needed", m.accepted ?? 0, `People who accept the invite. ~${gpPct(a.acceptRate as number)} of requests get accepted.`],
        ["Connection requests / mo", m.connects ?? 0, "Invites to send this month.", true],
        ["Connects / day needed", Math.ceil(m.connectsPerDayDerived || 0), "Daily invite volume, spread across the LinkedIn profiles."],
      ];
}

// ── gpBriefBlocks — port of legacy :5628 ────────────────────────────────────────
// The client's own research that opens both the growth plan and the prospect doc.
export function buildBriefBlocks(c: BriefClient | null | undefined, heading?: string, icpsOverride?: BriefIcp[]): Block[] {
  const b = c?.brief;
  if (!b) return [];
  const briefIcpList = (icpsOverride ?? []).filter((i) => i.example);
  const B: Block[] = [{ t: "h2", text: heading || `About ${c?.name ?? ""}` }];
  if (b.positioning) B.push({ t: "p", text: b.positioning });
  if (b.services?.length) {
    B.push({ t: "h3", text: "Services" });
    b.services.forEach((s) => B.push({ t: "bullet", text: s }));
  }
  if (b.caseStudies?.length) {
    B.push({ t: "h3", text: "Case studies" });
    b.caseStudies.forEach((s) => B.push({ t: "bullet", text: s }));
  }
  if (b.competitors?.length) {
    B.push({ t: "h3", text: "Competitors" });
    b.competitors.forEach((s) => B.push({ t: "bullet", text: s }));
  }
  if (briefIcpList.length) {
    B.push({ t: "h3", text: "Who we will target, with a real example" });
    briefIcpList.forEach((i) =>
      B.push({
        t: "p",
        text: `${i.title} → ${i.example!.company}${i.example!.website ? ` (${i.example!.website})` : ""}. ${i.example!.why ?? ""}`,
      }),
    );
  }
  return B;
}

// ── gpFollowupsBlocks — port of legacy :5644 ────────────────────────────────────
// Each sequence becomes a Notion toggle (dropdown) with the follow-ups inside.
export function buildFollowupsBlocks(seqs: FollowupSequence[]): Block[] {
  if (!seqs.length) return [];
  const B: Block[] = [{ t: "h2", text: "↪ Outbound follow-ups" }];
  seqs.forEach((s) => {
    const kids: Block[] = [];
    s.items.forEach((it) => {
      kids.push({ t: "h3", text: `Day +${it.day} · ${it.framework || ""}` });
      kids.push({ t: "code", text: it.text });
    });
    B.push({ t: "toggle", text: `${s.parentLabel} — ${s.items.length} follow-ups (every ${s.gapDays || 2} days)`, children: kids });
  });
  return B;
}

// ── gpBuildBlocks — port of legacy :6353 ────────────────────────────────────────
// The full growth-plan document as portable blocks.
export function buildGrowthPlanBlocks(input: GrowthPlanInput): Block[] {
  const { growth: g, client: c, includedTools, followups, channelLabels } = input;
  const N = g.narrative;
  const B: Block[] = [];
  const strat = g.mode === "strategy";

  B.push({ t: "h1", text: `Growth Plan — ${c?.name ?? ""}` });
  B.push({
    t: "p",
    text: `${strat ? "🧪 Strategy · Proof of Concept" : "📈 Growth · Scaling"} · ${g.channels.map((ch) => chLabel(channelLabels, ch)).join(" · ")} · ${new Date().toISOString().slice(0, 10)}`,
  });
  // The client's own research always opens the plan.
  buildBriefBlocks(c, undefined, briefTargetIcpsFor(g)).forEach((b) => B.push(b));
  if (N?.execSummary) B.push({ t: "callout", text: N.execSummary });

  if (strat) {
    g.targets.forEach((t, i) => {
      const r = N?.targetRationales?.[i];
      B.push({ t: "h2", text: `🎯 Target ${i + 1}: ${t.title}` });
      if (r?.rationale || t.why) B.push({ t: "p", text: r?.rationale || t.why || "" });
      if (t.marketSize) B.push({ t: "p", text: `📊 ${t.marketSize}` });
      if (t.pains.length) {
        B.push({ t: "h3", text: "Key pains" });
        t.pains.forEach((p) => B.push({ t: "bullet", text: p }));
      }
      B.push({ t: "h3", text: "Offer" });
      B.push({ t: "p", text: t.offer || "—" });
      if (t.angles.length) {
        B.push({ t: "h3", text: "Angles to test" });
        t.angles.forEach((a) => B.push({ t: "bullet", text: a }));
      }
      B.push({ t: "h3", text: "Scripts" });
      t.scripts.forEach((s) => B.push({ t: "code", text: s.text }));
    });

    const per: Record<string, FunnelResult> = {};
    const T = +g.targetBookings || 0;
    g.channels.forEach((ch) => {
      const m = computeReverse(ch as Channel, g.assumptions[ch as Channel], T);
      per[ch] = m;
      B.push({ t: "h2", text: `${chLabel(channelLabels, ch)} funnel — reverse-engineered from ${gpInt(T)} booked calls/mo` });
      const rows = reverseRows(ch as Channel, m, T, g.assumptions[ch as Channel]).map(([k, v, desc]) => [k, gpInt(v), desc]);
      B.push({ t: "table", headers: ["Reverse funnel", "Per month", "What this means"], rows });
    });

    const costRows = gpCostRows(includedTools, g);
    const infra = gpInfraRows(per, g);
    const grand = costRows.reduce((s, r) => s + r.cost, 0) + infra.reduce((s, r) => s + r.cost, 0);
    B.push({ t: "h2", text: "🧰 Tech stack & cost" });
    B.push({
      t: "table",
      headers: ["Line item", "Why", "$/mo"],
      rows: costRows
        .map((r) => [r.tool.name ?? "", r.tool.why as string ?? "", gpMoney(r.cost)])
        .concat(infra.map((r) => [r.name, r.why, gpMoney(r.cost)]))
        .concat([["Total", "", gpMoney(grand) + "/mo"]]),
    });
    B.push({ t: "h2", text: "Next steps" });
    B.push({ t: "todo", text: "Verbal agreement on the target niche(s)" });
    B.push({ t: "todo", text: "Verbal agreement on the scripts to test" });
    if (g.toggles.replyAgent) B.push({ t: "todo", text: "Sign up for the AI reply agent" });
    B.push({ t: "todo", text: "Kickoff — warmup / seat setup" });
  } else {
    if (g.winningScript) {
      B.push({ t: "h2", text: "The winning script" });
      B.push({ t: "code", text: g.winningScript.text });
    }
    if (g.nicheSize) {
      B.push({ t: "h2", text: "The niche" });
      B.push({ t: "p", text: `${g.nicheSize} reachable prospects` });
    }
    let leadsAll = 0;
    g.channels.forEach((ch) => {
      const o = g.observed[ch] ?? {};
      const contacted = o.contacted || 0;
      const bookedPer = contacted ? (o.booked || 0) / contacted : 0;
      const need = bookedPer > 0 ? g.targetBookings / bookedPer : 0;
      const vr = ch === "email" ? ((g.assumptions.email.verifyRate as number) || 0.65) : 1;
      const bulk = Math.ceil((vr ? need / vr : need) / 1000) * 1000;
      leadsAll += bulk;
      B.push({ t: "h2", text: `${chLabel(channelLabels, ch)} — to hit ${g.targetBookings} bookings/mo` });
      B.push({
        t: "table",
        headers: ["Metric", "Value"],
        rows: [
          ["Observed booking rate", gpPct(bookedPer) + " of contacts"],
          ["Contacts needed/mo", gpInt(need)],
          ["Bulk lead order", gpInt(bulk) + " leads"],
        ],
      });
    });

    const costRows = gpCostRows(includedTools, g);
    const perScale: Record<string, FunnelResult> = {};
    if (g.channels.includes("email")) {
      perScale.email = {
        leads: 0,
        outreaches: leadsAll * ((g.assumptions.email.verifyRate as number) || 0.65) * ((g.assumptions.email.sendsPerLead as number) || 1),
        replies: 0,
        positive: 0,
        booked: 0,
        conversion: 0,
      };
    }
    if (g.channels.includes("linkedin")) {
      perScale.linkedin = { leads: 0, outreaches: 1, replies: 0, positive: 0, booked: 0, conversion: 0 };
    }
    const infra = gpInfraRows(perScale, g);
    const total = costRows.reduce((s, r) => s + r.cost, 0) + infra.reduce((s, r) => s + r.cost, 0);
    B.push({ t: "h2", text: "🧰 Cost to scale" });
    B.push({
      t: "table",
      headers: ["Line item", "$/mo"],
      rows: costRows
        .map((r) => [r.tool.name ?? "", gpMoney(r.cost)])
        .concat(infra.map((r) => [r.name, gpMoney(r.cost)]))
        .concat([
          ["Total", gpMoney(total) + "/mo"],
          ["Cost per booking", gpMoney(g.targetBookings ? total / g.targetBookings : 0)],
        ]),
    });
    B.push({ t: "h2", text: "Next steps" });
    B.push({ t: "todo", text: "Confirm the niche pains added to the script" });
    B.push({ t: "todo", text: `Bulk order ${gpInt(leadsAll)} leads` });
    B.push({ t: "todo", text: "Run the script at the volume above" });
  }

  buildFollowupsBlocks(followups).forEach((b) => B.push(b));
  if (g.toggles.pledge && (g.toggles.pledgeText ?? "").trim()) B.push({ t: "callout", text: "✅ Our pledge: " + g.toggles.pledgeText });
  if (N?.closing) B.push({ t: "p", text: N.closing });
  return B;
}

// ── prospectDocBlocks — port of legacy :5993 ────────────────────────────────────
// The personalised prospect pitch document (logos as images, links as bookmarks).
export function buildProspectDocBlocks(input: ProspectDocInput): Block[] {
  const { prospect: p, sellerProfile: sp, planDefaults: pd, heading, channelSummary, channelLine, logoUrl } = input;
  const c = p;
  const N = p.narrative;
  const T = +(p.targetBookings as number) || 10;
  const channels = p.channels || ["email"];
  const primary = (channels[0] || "email") as Channel;
  const m = computeReverse(primary, pd[primary] ?? {}, T);
  const sd: SalesDoc = sp.salesDoc ?? {};
  const show = sd.show ?? {};
  const B: Block[] = [];

  const pl = logoUrl(p.website);
  if (pl) B.push({ t: "image", url: pl });
  B.push({ t: "h1", text: `Growth Plan for ${c?.name || "your business"}` });
  B.push({ t: "p", text: `Prepared by ${sp.name || "us"} · ${channelSummary}` });
  if (show.intro && N?.intro) B.push({ t: "callout", text: N.intro });

  if (show.brief) buildBriefBlocks(c as BriefClient, heading("brief"), prospectChosenIcps(p)).forEach((b) => B.push(b));

  if (show.how) {
    B.push({ t: "h2", text: heading("how") });
    B.push({ t: "p", text: channelLine });
    B.push({ t: "h3", text: "How we find your leads" });
    B.push({ t: "p", text: sp.howWeFindLeads || "" });
    B.push({ t: "h3", text: "How we keep them qualified" });
    B.push({ t: "p", text: sp.howWeQualify || "" });
    (sp.process || []).forEach((ph) => {
      B.push({ t: "h3", text: ph.phase || "" });
      (ph.items || []).forEach((it) => B.push({ t: "bullet", text: it }));
    });
  }

  if (show.expect) {
    B.push({ t: "h2", text: heading("expect") });
    if (N?.expectations) B.push({ t: "p", text: N.expectations });
    B.push({
      t: "p",
      text: `To book around ${gpInt(T)} calls a month, we send about ${gpInt(m.outreaches || m.connects || 0)} messages to roughly ${gpInt(m.leads)} of your ideal buyers. You only talk to the ones who put their hand up.`,
    });
  }

  if ((p.sampleScripts || []).length) {
    B.push({ t: "h2", text: "What your messages could look like" });
    B.push({ t: "p", text: "Real drafts written for your buyers. We sharpen these together before anything goes out." });
    p.sampleScripts!.forEach((s) => {
      if (s.label) B.push({ t: "h3", text: s.label });
      B.push({ t: "code", text: s.text });
    });
  }

  if (show.who) {
    B.push({ t: "h2", text: heading("who") });
    if (sp.logo) B.push({ t: "image", url: sp.logo });
    if (sp.whoWeAre) B.push({ t: "p", text: sp.whoWeAre });
    if (sp.trackRecord) B.push({ t: "p", text: sp.trackRecord });
    if ((sp.whyDifferent || []).length) {
      B.push({ t: "h3", text: "Why we are different" });
      sp.whyDifferent!.forEach((w) => B.push({ t: "bullet", text: w }));
    }
    if ((sp.caseStudies || []).length) {
      B.push({ t: "h3", text: "Recent wins" });
      sp.caseStudies!.forEach((cs) => {
        B.push({ t: "bullet", text: `${cs.name ?? ""} ${cs.result ?? ""}` });
        if (cs.link) B.push({ t: "bookmark", url: cs.link });
      });
    }
    (sp.socialLinks || []).forEach((s) => {
      if (s.url) B.push({ t: "bookmark", url: s.url });
    });
  }

  if (show.included) {
    B.push({ t: "h2", text: heading("included") });
    (sp.deliverables || []).forEach((d) => B.push({ t: "bullet", text: d }));
    if (sp.guarantee) B.push({ t: "callout", text: "Our promise: " + sp.guarantee });
  }

  if (show.investment) {
    B.push({ t: "h2", text: heading("investment") });
    B.push({ t: "p", text: gpMoney(sp.programCost || 0) });
    if (sp.costNote) B.push({ t: "p", text: sp.costNote });
  }

  (sd.custom || []).forEach((cs2) => {
    if (!cs2.heading && !cs2.body) return;
    if (cs2.heading) B.push({ t: "h2", text: String(cs2.heading).replaceAll("{client}", c?.name || "you") });
    String(cs2.body || "")
      .split(/\n+/)
      .filter(Boolean)
      .forEach((para) => B.push({ t: "p", text: para.replaceAll("{client}", c?.name || "you") }));
  });

  if (show.next) {
    B.push({ t: "h2", text: heading("next") });
    if (N?.closing) B.push({ t: "p", text: N.closing });
    [
      "Book a quick call with " + ((sp.founder || "").split(",")[0] || sp.name || "us"),
      "We walk you through this plan and answer anything",
      "If it is a fit we start, if not you keep the plan for free",
    ].forEach((s) => B.push({ t: "todo", text: s }));
  }
  return B;
}

// ── blocksFromEditorDoc — REPLACES legacy gpBlocksFromDocHtml (:5830) ────────────
// The legacy function walked an edited contenteditable DOM. The new editor is a
// Tiptap / ProseMirror instance, so we walk its JSON document instead, into the
// SAME `{ t, ... }` block contract the server consumes.
//
// ProseMirror doc shape (the subset we support):
//   { type: 'doc', content: [
//       { type: 'paragraph',  content: [{ type:'text', text, marks? }] },
//       { type: 'heading',    attrs: { level: 1|2|3 }, content: [...] },
//       { type: 'bulletList' | 'orderedList', content: [{ type:'listItem', content:[...] }] },
//       { type: 'codeBlock',  content: [{ type:'text', text }] },
//       { type: 'blockquote', content: [...] },         // → callout
//       { type: 'image',      attrs: { src } },
//       { type: 'horizontalRule' },                     // → divider
//       { type: 'table',      content: [{ type:'tableRow', content:[{ type:'tableHeader'|'tableCell', content:[...] }] }] },
//       …
//   ] }

/** A ProseMirror / Tiptap node. Loose by design — editor output is open-ended. */
export interface EditorNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown> | null;
  content?: EditorNode[] | null;
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> | null }> | null;
}

const flat = (s: string): string => String(s || "").replace(/\s+/g, " ").trim();

/** Concatenate all descendant text of a node (legacy `innerText` equivalent). */
function nodeText(node: EditorNode | null | undefined): string {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(nodeText).join("");
}

/** Pull every image `src` reachable under a node (http(s) only). */
function collectImages(node: EditorNode | null | undefined, out: Block[]): void {
  if (!node) return;
  if (node.type === "image") {
    const url = String((node.attrs?.src as string) ?? "");
    if (/^https?:/.test(url)) out.push({ t: "image", url });
  }
  (node.content ?? []).forEach((ch) => collectImages(ch, out));
}

function headingTag(level: unknown): "h1" | "h2" | "h3" {
  const n = Number(level) || 1;
  return n <= 1 ? "h1" : n === 2 ? "h2" : "h3";
}

/** Walk a list node's items into bullet blocks (one per top-level list item). */
function listItems(node: EditorNode, out: Block[]): void {
  (node.content ?? []).forEach((li) => {
    if (li.type === "listItem" || li.type === "taskItem" || li.type === "list_item") {
      const text = flat(nodeText(li));
      if (text) out.push({ t: "bullet", text });
    }
  });
}

/** Walk a ProseMirror table node into a `{ t:'table', headers, rows }` block. */
function tableBlock(node: EditorNode): Block | null {
  const trs = (node.content ?? []).filter((r) => r.type === "tableRow" || r.type === "table_row");
  const rows = trs.map((tr) => (tr.content ?? []).map((cell) => flat(nodeText(cell))));
  if (!rows.length) return null;
  return { t: "table", headers: rows[0], rows: rows.slice(1) };
}

/** Walk one ProseMirror block node, pushing portable blocks onto `out`. */
function walkNode(node: EditorNode, out: Block[]): void {
  const type = node.type ?? "";
  switch (type) {
    case "heading":
      out.push({ t: headingTag(node.attrs?.level), text: flat(nodeText(node)) });
      return;
    case "paragraph": {
      // A paragraph that only holds an image (or images) becomes image blocks.
      const imgs: Block[] = [];
      collectImages(node, imgs);
      const text = flat(nodeText(node));
      if (text) out.push({ t: "p", text });
      else imgs.forEach((b) => out.push(b));
      return;
    }
    case "bulletList":
    case "orderedList":
    case "bullet_list":
    case "ordered_list":
    case "taskList":
      listItems(node, out);
      return;
    case "codeBlock":
    case "code_block":
      out.push({ t: "code", text: nodeText(node) });
      return;
    case "blockquote":
      // No native Notion blockquote in the contract — map to callout (legacy
      // also surfaced `.callout` elements as callouts).
      out.push({ t: "callout", text: flat(nodeText(node)) });
      return;
    case "horizontalRule":
    case "horizontal_rule":
      out.push({ t: "divider" });
      return;
    case "image": {
      const url = String((node.attrs?.src as string) ?? "");
      if (/^https?:/.test(url)) out.push({ t: "image", url });
      return;
    }
    case "table": {
      const tb = tableBlock(node);
      if (tb) out.push(tb);
      return;
    }
    case "details":
    case "toggle": {
      // Tiptap "details": first child is the summary, the rest are the body —
      // mirror the legacy <details> → Notion toggle mapping.
      const kids = node.content ?? [];
      const summary = kids.find((k) => k.type === "detailsSummary" || k.type === "summary");
      const bodyHost = kids.find((k) => k.type === "detailsContent" || k.type === "details_content");
      const bodyNodes = bodyHost?.content ?? kids.filter((k) => k !== summary && k.type !== "detailsSummary");
      const children: Block[] = [];
      bodyNodes.forEach((ch) => walkNode(ch, children));
      out.push({ t: "toggle", text: flat(nodeText(summary)) || "Details", children });
      return;
    }
    default: {
      // Unknown container: recurse into children if it has block content,
      // otherwise emit any text it carries as a paragraph (legacy fallthrough).
      const kids = node.content ?? [];
      const hasBlockKids = kids.some((k) => k.type && k.type !== "text");
      if (hasBlockKids) kids.forEach((ch) => walkNode(ch, out));
      else {
        const text = flat(nodeText(node));
        if (text) out.push({ t: "p", text });
      }
    }
  }
}

/**
 * Convert a Tiptap / ProseMirror JSON document into portable Notion blocks.
 * Accepts either a full `{ type:'doc', content:[…] }` document or a bare array
 * of top-level nodes. Returns the SAME `{ t, ... }` blocks the server renders.
 */
export function blocksFromEditorDoc(doc: EditorNode | EditorNode[] | null | undefined): Block[] {
  const nodes: EditorNode[] = Array.isArray(doc) ? doc : (doc?.content ?? []);
  const out: Block[] = [];
  nodes.forEach((n) => walkNode(n, out));
  return out;
}

// ── internal: brief target ICPs / cost rows / chosen ICPs ───────────────────────
// Strategy plans open the brief with the targeted ICPs (legacy gpBriefTargetIcps).
// Targets carry their resolved icp on `.example` already in this decoupled port,
// so we map each target to a BriefIcp the brief builder can render.
function briefTargetIcpsFor(g: GrowthPlanState): BriefIcp[] {
  if (g.mode !== "strategy") return [];
  const out: BriefIcp[] = [];
  g.targets.forEach((t) => {
    const example = (t as GrowthTarget & { example?: IcpExample }).example;
    if (example) out.push({ title: t.title, example });
  });
  return out;
}

// Prospect plans target the prospect's chosen ICPs (legacy prospectChosenIcps).
function prospectChosenIcps(p: Prospect): BriefIcp[] {
  const chosen = new Set(p.targetIcpIds || []);
  return (p.icps || []).filter((i) => i.id && chosen.has(i.id));
}

export type { InfraRow, ToolCostRow };
