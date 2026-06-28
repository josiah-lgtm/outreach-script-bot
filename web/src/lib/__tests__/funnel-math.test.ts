import { describe, it, expect } from 'vitest';
import {
  PD_RATE_KEYS,
  rateFractionToDisplay,
  rateDisplayToFraction,
  gpMoney,
  gpInt,
  gpPct,
  computeChannel,
  computeReverse,
  computeTargetNeed,
  gpInfraRows,
  toolMonthlyCost,
  gpAggregate,
  gpCostRows,
  type EmailAssumptions,
  type LinkedinAssumptions,
  type GrowthState,
  type Tool,
  type Aggregate,
} from '../funnel-math';

// Representative assumptions = the legacy planDefaults (index.html ~L1288-1289).
const EMAIL: EmailAssumptions = {
  leadsPerMonth: 3000, verifyRate: 0.65, sendsPerLead: 3,
  replyRate: 0.04, positiveRate: 0.30, bookRate: 0.40,
  sendsPerInboxPerDay: 30, sendingDays: 22, inboxCostMo: 3,
};
const LINKEDIN: LinkedinAssumptions = {
  connectsPerDay: 25, daysPerMonth: 22, acceptRate: 0.30,
  replyRate: 0.25, positiveRate: 0.40, bookRate: 0.40,
  connectsPerProfilePerDay: 20, profileCostMo: 80,
};

describe('computeChannel — golden numbers', () => {
  it('email forward funnel (exact)', () => {
    expect(computeChannel('email', EMAIL)).toEqual({
      leads: 3000,
      verified: 1950,
      outreaches: 5850,
      replies: 78,
      positive: 23.4,
      booked: 9.36,
      conversion: 0.00312,
    });
  });

  it('linkedin forward funnel (exact)', () => {
    expect(computeChannel('linkedin', LINKEDIN)).toEqual({
      leads: 550,
      connects: 550,
      accepted: 165,
      outreaches: 550,
      replies: 41.25,
      positive: 16.5,
      booked: 6.6000000000000005,
      conversion: 0.012,
    });
  });
});

describe('computeReverse — golden numbers (target = 10 bookings)', () => {
  it('email reverse funnel (exact)', () => {
    const r = computeReverse('email', EMAIL, 10);
    expect(r.booked).toBe(10);
    expect(r.positive).toBe(25);
    expect(r.replies).toBeCloseTo(83.33333333333334, 12);
    expect(r.verified).toBeCloseTo(2083.3333333333335, 12);
    expect(r.leads).toBeCloseTo(3205.128205128205, 12);
    expect(r.outreaches).toBe(6250);
    expect(r.conversion).toBeCloseTo(0.00312, 12);
  });

  it('linkedin reverse funnel (exact)', () => {
    const r = computeReverse('linkedin', LINKEDIN, 10);
    expect(r.booked).toBe(10);
    expect(r.positive).toBe(25);
    expect(r.replies).toBe(62.5);
    expect(r.accepted).toBe(250);
    expect(r.connects).toBeCloseTo(833.3333333333334, 12);
    expect(r.leads).toBeCloseTo(833.3333333333334, 12);
    expect(r.outreaches).toBeCloseTo(833.3333333333334, 12);
    expect(r.conversion).toBeCloseTo(0.012, 12);
    expect(r.connectsPerDayDerived).toBeCloseTo(37.87878787878788, 12);
  });
});

describe('div-by-zero guards', () => {
  it('computeReverse with a zero rate yields 0 (no Infinity/NaN)', () => {
    const r = computeReverse('email', { ...EMAIL, bookRate: 0 }, 10);
    expect(r.positive).toBe(0);
    expect(r.leads).toBe(0);
    expect(r.conversion).toBe(0);
  });

  it('computeChannel conversion is 0 when leads is 0', () => {
    const r = computeChannel('email', { ...EMAIL, leadsPerMonth: 0 });
    expect(r.leads).toBe(0);
    expect(r.conversion).toBe(0);
  });
});

describe('computeTargetNeed', () => {
  it('email back-solve (exact)', () => {
    // perLead = 0.65*0.04*0.30*0.40 = 0.00312 ; leadsNeeded = 10/0.00312
    const r = computeTargetNeed('email', EMAIL, 10);
    expect(r.leadsNeeded).toBeCloseTo(3205.128205128205, 9);
    expect(r.verified).toBeCloseTo(2083.3333333333335, 9);
    expect(r.sendsNeeded).toBeCloseTo(6250, 9);
  });

  it('linkedin back-solve (exact)', () => {
    // perConnect = 0.30*0.25*0.40*0.40 = 0.012 ; connectsNeeded = 10/0.012
    const r = computeTargetNeed('linkedin', LINKEDIN, 10);
    expect(r.connectsNeeded).toBeCloseTo(833.3333333333334, 9);
    expect(r.leadsNeeded).toBe(r.sendsNeeded);
    expect(r.leadsNeeded).toBe(r.connectsNeeded);
  });
});

describe('rate %<->fraction round-trip', () => {
  it('PD_RATE_KEYS is the exact legacy set', () => {
    expect([...PD_RATE_KEYS].sort()).toEqual(
      ['acceptRate', 'bookRate', 'positiveRate', 'replyRate', 'verifyRate'].sort()
    );
  });

  it('store(display(v)) ≈ v for the canonical rates', () => {
    for (const frac of [0.65, 0.04, 0.3, 0.4, 0.25]) {
      // display = Math.round(v*1000)/10 ; store = pct/100
      const pct = rateFractionToDisplay(frac);
      expect(rateDisplayToFraction(pct)).toBeCloseTo(frac, 12);
    }
  });

  it('display uses one-decimal rounding rule', () => {
    expect(rateFractionToDisplay(0.04)).toBe(4);
    expect(rateFractionToDisplay(0.655)).toBe(65.5);
    expect(rateFractionToDisplay(0.1234)).toBe(12.3); // Math.round(123.4)/10
    expect(rateDisplayToFraction(65)).toBe(0.65);
  });
});

describe('formatters', () => {
  it('gpMoney rounds and groups with en-US locale', () => {
    expect(gpMoney(1234.4)).toBe('$1,234');
    expect(gpMoney(1234.5)).toBe('$1,235');
    expect(gpMoney(0)).toBe('$0');
    expect(gpMoney(NaN as unknown as number)).toBe('$0'); // n||0 coercion
  });

  it('gpInt rounds and groups with en-US locale', () => {
    expect(gpInt(5850)).toBe('5,850');
    expect(gpInt(9.36)).toBe('9');
    expect(gpInt(0)).toBe('0');
  });

  it('gpPct edge: 0 < v < 10 uses one decimal, else rounds', () => {
    // 0.04 -> 4% (4 < 10 && > 0) -> one decimal "4.0%"
    expect(gpPct(0.04)).toBe('4.0%');
    expect(gpPct(0.099)).toBe('9.9%');
    // >= 10 rounds to integer
    expect(gpPct(0.30)).toBe('30%');
    expect(gpPct(0.105)).toBe('11%'); // Math.round(10.5)
    // exactly 0 is NOT in (0,10): falls to Math.round(0) = 0
    expect(gpPct(0)).toBe('0%');
    // exactly 10 is NOT < 10: rounds
    expect(gpPct(0.10)).toBe('10%');
  });
});

// ── decoupled growth-state helpers ──
function makeGrowth(overrides: Partial<GrowthState> = {}): GrowthState {
  return {
    channels: ['email'],
    mode: 'strategy',
    targetBookings: 10,
    toggles: { replyAgent: false },
    toolIds: [],
    assumptions: {
      email: { ...EMAIL },
      linkedin: { ...LINKEDIN },
      personalization: { inputTokensPerLead: 2000, outputTokensPerLead: 200, model: 'Gemini 2.5 Flash' },
    },
    ...overrides,
  };
}

describe('gpAggregate / gpInfraRows / toolMonthlyCost / gpCostRows', () => {
  it('gpAggregate in strategy mode reverse-engineers from target', () => {
    const g = makeGrowth({ channels: ['email'] });
    const agg = gpAggregate(g);
    expect(agg.booked).toBe(10);
    expect(agg.leads).toBeCloseTo(3205.128205128205, 9);
    expect(agg.verified).toBeCloseTo(2083.3333333333335, 9);
    expect(agg.per.email.outreaches).toBe(6250);
  });

  it('gpAggregate in plan mode uses forward funnel', () => {
    const g = makeGrowth({ channels: ['email'], mode: 'plan' });
    const agg = gpAggregate(g);
    expect(agg.leads).toBe(3000);
    expect(agg.verified).toBe(1950);
    expect(agg.booked).toBe(9.36);
  });

  it('gpInfraRows: email inboxes use Math.ceil + Math.max(1) floor', () => {
    const g = makeGrowth({ channels: ['email'] });
    const agg = gpAggregate(g);
    const rows = gpInfraRows(agg.per, g);
    // sendsPerDay = 6250/22 = 284.09... ; ceil(284.09/30)=ceil(9.469)=10
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(10);
    expect(rows[0].cost).toBe(30); // 10 inboxes * $3/mo
    expect(rows[0].name).toBe('📥 Email inboxes (10)');
    expect(rows[0].why).toBe('30 sends/inbox/day · ~284 sends/day');
  });

  it('gpInfraRows: linkedin profiles floor at 1 when connectsPerDay > 0', () => {
    const g = makeGrowth({ channels: ['linkedin'] });
    const agg = gpAggregate(g);
    const rows = gpInfraRows(agg.per, g);
    // ceil(25/20) = 2 profiles
    expect(rows[0].count).toBe(2);
    expect(rows[0].cost).toBe(160); // 2 * $80
    expect(rows[0].name).toBe('🔗 LinkedIn profiles (2)');
  });

  it('toolMonthlyCost: flat / per_1k_leads / per_1k_verified / tokens', () => {
    const agg: Aggregate = { per: {}, leads: 3000, verified: 1950, booked: 10 };
    const pers = { inputTokensPerLead: 2000, outputTokensPerLead: 200 };
    expect(toolMonthlyCost(null, agg, pers)).toBe(0);
    expect(toolMonthlyCost({ id: 'f', costModel: 'flat', cost: 99 }, agg, pers)).toBe(99);
    expect(toolMonthlyCost({ id: 'l', costModel: 'per_1k_leads', cost: 5 }, agg, pers)).toBe(15); // 3000/1000*5
    expect(toolMonthlyCost({ id: 'v', costModel: 'per_1k_verified', cost: 0.37 }, agg, pers))
      .toBeCloseTo(0.7215, 12); // 1950/1000*0.37
    // tokens: leads*(in*inPerM + out*outPerM)/1e6 = 3000*(2000*0.30 + 200*2.50)/1e6
    expect(toolMonthlyCost({ id: 't', costModel: 'tokens', inPerM: 0.30, outPerM: 2.50 }, agg, pers))
      .toBeCloseTo(3.3, 12);
  });

  it('gpCostRows maps included tools to {tool, cost}', () => {
    const g = makeGrowth({ channels: ['email'], mode: 'plan' });
    const tools: Tool[] = [
      { id: 'tool-mv', costModel: 'per_1k_verified', cost: 0.37 },
      { id: 'tool-smartlead', costModel: 'flat', cost: 94 },
    ];
    const rows = gpCostRows(tools, g);
    expect(rows).toHaveLength(2);
    expect(rows[0].tool.id).toBe('tool-mv');
    // verified = 1950 -> 1950/1000*0.37 = 0.7215
    expect(rows[0].cost).toBeCloseTo(0.7215, 12);
    expect(rows[1].cost).toBe(94);
  });
});
