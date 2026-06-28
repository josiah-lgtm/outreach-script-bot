// Deterministic funnel + cost math — VERBATIM port of the legacy Growth Plan
// Builder math (legacy/index.html). These produce CLIENT-FACING numbers and
// must match the legacy output EXACTLY.
//
// Source anchors (legacy/index.html):
//   PD_RATE_KEYS              ~L4881
//   gpMoney / gpInt / gpPct   ~L4931-4933
//   computeChannel            ~L5016
//   computeReverse            ~L5035
//   computeTargetNeed         ~L5055
//   gpInfraRows               ~L5070
//   toolMonthlyCost           ~L5093
//   gpAggregate               ~L5101
//   gpCostRows                ~L5113
//
// FIDELITY RULES applied here:
//   - Every numeric constant, threshold, branch, and string literal preserved.
//   - All `+x || 0` coercions, div-by-zero guards, Math.ceil / Math.max floors,
//     and the exact tokens cost formula are kept byte-for-byte.
//   - The ONLY changes vs. legacy: TypeScript types, DOM/global decoupling
//     (state.growth / config are now ARGUMENTS), and ES module exports.
//   - gpMoney / gpInt use toLocaleString with the locale PINNED to 'en-US' so
//     server/client SSR can never drift on number grouping.
//
// PURE module: no React, no DOM, no network.

// ── rate keys ───────────────────────────────────────────────────────────────
// Plan-default fields that are stored as fractions (0..1) but displayed as
// percentages. The %<->fraction conversion used by the legacy UI is:
//   display = Math.round(v * 1000) / 10   (fraction -> one-decimal percent)
//   store   = v / 100                     (percent input -> fraction)
export const PD_RATE_KEYS: Set<string> = new Set([
  'verifyRate',
  'replyRate',
  'positiveRate',
  'bookRate',
  'acceptRate',
]);

/**
 * Convert a stored fraction (e.g. 0.04) to its display percent value
 * (e.g. 4) using the legacy rule `Math.round(v * 1000) / 10`. This yields a
 * one-decimal-precision percent NUMBER (not a string).
 */
export const rateFractionToDisplay = (v: number): number =>
  Math.round((+v || 0) * 1000) / 10;

/**
 * Convert a percent input value (e.g. 4) back to its stored fraction
 * (e.g. 0.04) using the legacy rule `v / 100`.
 */
export const rateDisplayToFraction = (v: number): number => (+v || 0) / 100;

// ── formatters ───────────────────────────────────────────────────────────────
// NOTE: gpMoney / gpInt pin the locale to 'en-US' explicitly. The legacy code
// called `.toLocaleString()` with no locale, which resolves to the host
// locale — under SSR the server and client can disagree (e.g. '1,000' vs
// '1.000'). Pinning 'en-US' removes that drift while matching the values seen
// in the original (en-US) deployment.
export const gpMoney = (n: number): string =>
  '$' + Math.round(n || 0).toLocaleString('en-US');
export const gpInt = (n: number): string =>
  Math.round(n || 0).toLocaleString('en-US');
export const gpPct = (n: number): string => {
  const v = (n || 0) * 100;
  return (v < 10 && v > 0 ? v.toFixed(1) : Math.round(v)) + '%';
};

// ── types ─────────────────────────────────────────────────────────────────────
export type Channel = 'email' | 'linkedin';

/** Email channel assumptions (legacy planDefaults.email). */
export interface EmailAssumptions {
  leadsPerMonth?: number;
  verifyRate?: number;
  sendsPerLead?: number;
  replyRate?: number;
  positiveRate?: number;
  bookRate?: number;
  sendsPerInboxPerDay?: number;
  sendingDays?: number;
  inboxCostMo?: number;
  [k: string]: unknown;
}

/** LinkedIn channel assumptions (legacy planDefaults.linkedin). */
export interface LinkedinAssumptions {
  connectsPerDay?: number;
  daysPerMonth?: number;
  acceptRate?: number;
  replyRate?: number;
  positiveRate?: number;
  bookRate?: number;
  connectsPerProfilePerDay?: number;
  profileCostMo?: number;
  [k: string]: unknown;
}

/** Personalization assumptions (legacy planDefaults.personalization). */
export interface PersonalizationAssumptions {
  inputTokensPerLead?: number;
  outputTokensPerLead?: number;
  model?: string;
  [k: string]: unknown;
}

/** Any channel assumption object passed to compute* helpers. */
export type ChannelAssumptions = EmailAssumptions & LinkedinAssumptions;

export interface Assumptions {
  email: EmailAssumptions;
  linkedin: LinkedinAssumptions;
  personalization: PersonalizationAssumptions;
}

/** Result of computeChannel / computeReverse. Fields differ per channel. */
export interface FunnelResult {
  leads: number;
  verified?: number;
  outreaches: number;
  replies: number;
  positive: number;
  booked: number;
  conversion: number;
  connects?: number;
  accepted?: number;
  connectsPerDayDerived?: number;
}

export interface TargetNeedResult {
  leadsNeeded: number;
  sendsNeeded: number;
  verified?: number;
  connectsNeeded?: number;
}

/** A KB tool entry (legacy config.toolsKB). */
export interface Tool {
  id: string;
  name?: string;
  category?: string;
  channels?: string[];
  costModel?: 'flat' | 'per_1k_leads' | 'per_1k_verified' | 'tokens' | string;
  cost?: number;
  inPerM?: number;
  outPerM?: number;
  [k: string]: unknown;
}

/** Aggregated volumes (legacy gpAggregate output). */
export interface Aggregate {
  per: Record<string, FunnelResult>;
  leads: number;
  verified: number;
  booked: number;
}

/** A cost/infra row. */
export interface InfraRow {
  name: string;
  why: string;
  cost: number;
  count: number;
}

/** A tool cost row (legacy gpCostRows output). */
export interface ToolCostRow {
  tool: Tool;
  cost: number;
}

/**
 * The subset of `state.growth` the cost/aggregate helpers read. Passed in as an
 * argument instead of being read from the `state.growth` global.
 */
export interface GrowthState {
  channels: string[];
  assumptions: Assumptions;
  mode: string;
  targetBookings: number;
  toggles: { replyAgent?: boolean; [k: string]: unknown };
  toolIds: string[];
  [k: string]: unknown;
}

// ── compute (deterministic — never the model) ──
export function computeChannel(channel: Channel, a: ChannelAssumptions): FunnelResult {
  if (channel === 'email') {
    const leads = Math.max(0, +(a.leadsPerMonth as number) || 0);
    const verified = leads * (+(a.verifyRate as number) || 0);
    const outreaches = verified * (+(a.sendsPerLead as number) || 0);
    const replies = verified * (+(a.replyRate as number) || 0);
    const positive = replies * (+(a.positiveRate as number) || 0);
    const booked = positive * (+(a.bookRate as number) || 0);
    return { leads, verified, outreaches, replies, positive, booked, conversion: leads ? booked / leads : 0 };
  }
  const connects = (+(a.connectsPerDay as number) || 0) * (+(a.daysPerMonth as number) || 0);
  const accepted = connects * (+(a.acceptRate as number) || 0);
  const replies = accepted * (+(a.replyRate as number) || 0);
  const positive = replies * (+(a.positiveRate as number) || 0);
  const booked = positive * (+(a.bookRate as number) || 0);
  return { leads: connects, connects, accepted, outreaches: connects, replies, positive, booked, conversion: connects ? booked / connects : 0 };
}

// Reverse-engineer the whole funnel from the booking target: start at the goal
// and divide back up through each rate. Everything is derived from the target.
export function computeReverse(channel: Channel, a: ChannelAssumptions, targetBookings: number): FunnelResult {
  const booked = Math.max(0, +targetBookings || 0);
  const div = (n: number, r: unknown) => ((+(r as number) || 0) > 0 ? n / (+(r as number)) : 0);
  if (channel === 'email') {
    const pos = div(booked, a.bookRate);
    const replies = div(pos, a.positiveRate);
    const verified = div(replies, a.replyRate);
    const leads = div(verified, a.verifyRate);
    const outreaches = verified * (+(a.sendsPerLead as number) || 0);
    return { leads, verified, outreaches, replies, positive: pos, booked, conversion: leads > 0 ? booked / leads : 0 };
  }
  const pos = div(booked, a.bookRate);
  const replies = div(pos, a.positiveRate);
  const accepted = div(replies, a.replyRate);
  const connects = div(accepted, a.acceptRate);
  const perDay = (+(a.daysPerMonth as number) || 0) > 0 ? connects / (+(a.daysPerMonth as number)) : 0;
  return { leads: connects, connects, accepted, replies, positive: pos, booked, outreaches: connects, conversion: connects > 0 ? booked / connects : 0, connectsPerDayDerived: perDay };
}

// Back-solve: what volume is needed to hit a booking target, given the rates.
export function computeTargetNeed(channel: Channel, a: ChannelAssumptions, targetBookings: number): TargetNeedResult {
  const T = Math.max(0, +targetBookings || 0);
  if (channel === 'email') {
    const perLead = (+(a.verifyRate as number) || 0) * (+(a.replyRate as number) || 0) * (+(a.positiveRate as number) || 0) * (+(a.bookRate as number) || 0);
    const leadsNeeded = perLead > 0 ? T / perLead : 0;
    const verified = leadsNeeded * (+(a.verifyRate as number) || 0);
    const sendsNeeded = verified * (+(a.sendsPerLead as number) || 0);
    return { leadsNeeded, sendsNeeded, verified };
  }
  const perConnect = (+(a.acceptRate as number) || 0) * (+(a.replyRate as number) || 0) * (+(a.positiveRate as number) || 0) * (+(a.bookRate as number) || 0);
  const connectsNeeded = perConnect > 0 ? T / perConnect : 0;
  return { leadsNeeded: connectsNeeded, sendsNeeded: connectsNeeded, connectsNeeded };
}

// Email inboxes + LinkedIn profiles needed for a given monthly volume, as cost rows.
// DECOUPLED: `state.growth` is now the `g` argument (was a global).
export function gpInfraRows(per: Record<string, FunnelResult>, g: GrowthState): InfraRow[] {
  const rows: InfraRow[] = [];
  if (g.channels.includes('email') && per.email) {
    const a = g.assumptions.email;
    const days = +(a.sendingDays as number) || 22, perInbox = +(a.sendsPerInboxPerDay as number) || 30;
    const sendsPerDay = (per.email.outreaches || 0) / days;
    const inboxes = Math.max(per.email.outreaches > 0 ? 1 : 0, Math.ceil(sendsPerDay / perInbox) || 0);
    rows.push({ name: `📥 Email inboxes (${inboxes})`, why: `${gpInt(perInbox)} sends/inbox/day · ~${gpInt(Math.round(sendsPerDay))} sends/day`, cost: inboxes * (+(a.inboxCostMo as number) || 0), count: inboxes });
  }
  if (g.channels.includes('linkedin') && per.linkedin) {
    const a = g.assumptions.linkedin, perProfile = +(a.connectsPerProfilePerDay as number) || 20;
    const profiles = Math.max((+(a.connectsPerDay as number) || 0) > 0 ? 1 : 0, Math.ceil((+(a.connectsPerDay as number) || 0) / perProfile) || 0);
    rows.push({ name: `🔗 LinkedIn profiles (${profiles})`, why: `${gpInt(perProfile)} connects/profile/day`, cost: profiles * (+(a.profileCostMo as number) || 0), count: profiles });
  }
  return rows;
}

export function toolMonthlyCost(tool: Tool | null | undefined, agg: Aggregate, pers: PersonalizationAssumptions): number {
  if (!tool) return 0;
  if (tool.costModel === 'per_1k_leads') return (agg.leads || 0) / 1000 * (+(tool.cost as number) || 0);
  if (tool.costModel === 'per_1k_verified') return (agg.verified || 0) / 1000 * (+(tool.cost as number) || 0);
  if (tool.costModel === 'tokens') return (agg.leads || 0) * ((+(pers.inputTokensPerLead as number) || 0) * (+(tool.inPerM as number) || 0) + (+(pers.outputTokensPerLead as number) || 0) * (+(tool.outPerM as number) || 0)) / 1e6;
  return +(tool.cost as number) || 0; // flat
}

// Aggregate volumes across the selected channels for cost math.
// DECOUPLED: `state.growth` is now the `g` argument (was a global).
export function gpAggregate(g: GrowthState): Aggregate {
  let leads = 0, verified = 0, booked = 0;
  const per: Record<string, FunnelResult> = {};
  // Strategy is reverse-engineered from the booking target; everything (leads,
  // sends, inboxes, cost) sizes to hit that target.
  g.channels.forEach((ch) => {
    const m = g.mode === 'strategy'
      ? computeReverse(ch as Channel, g.assumptions[ch as Channel], g.targetBookings)
      : computeChannel(ch as Channel, g.assumptions[ch as Channel]);
    per[ch] = m; leads += m.leads; verified += (ch === 'email' ? (m.verified || 0) : 0); booked += m.booked;
  });
  return { per, leads, verified, booked };
}

// DECOUPLED: legacy gpCostRows() read `state.growth` + computed gpIncludedTools()
// from `config.toolsKB`. Here the caller passes the already-resolved included
// tools (the legacy gpIncludedTools() output) and the growth state. This keeps
// the cost math identical while removing the global reads.
export function gpCostRows(includedTools: Tool[], g: GrowthState): ToolCostRow[] {
  const agg = gpAggregate(g);
  return includedTools.map((t) => ({ tool: t, cost: toolMonthlyCost(t, agg, g.assumptions.personalization) }));
}
