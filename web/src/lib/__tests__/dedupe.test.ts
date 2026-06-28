import { describe, it, expect } from 'vitest';
import { _sig, _jac, dedupeScripts } from '../dedupe';

describe('_sig', () => {
  it('strips {{tags}}, lowercases, strips non-alphanumerics, splits on whitespace, keeps tokens with length > 2', () => {
    // "Hi" (len 2), "on" (len 2), "it" (len 2), "a" (len 1), "bc" (len 2) are all dropped.
    // "{{name}}" is stripped before tokenizing. Punctuation becomes whitespace.
    expect(_sig('Hi {{name}}, on it! a bc def GHIJ.')).toEqual(['def', 'ghij']);
  });

  it('returns [] for null/undefined/empty', () => {
    expect(_sig(null)).toEqual([]);
    expect(_sig(undefined)).toEqual([]);
    expect(_sig('')).toEqual([]);
  });
});

describe('_jac', () => {
  it('returns 0 when either signature is empty', () => {
    expect(_jac([], ['alpha', 'bravo'])).toBe(0);
    expect(_jac(['alpha', 'bravo'], [])).toBe(0);
  });

  it('computes intersection over union', () => {
    // shared {alpha, bravo} = 2; union {alpha, bravo, charlie, delta} = 4 -> 0.5
    expect(_jac(['alpha', 'bravo', 'charlie'], ['alpha', 'bravo', 'delta'])).toBe(0.5);
  });
});

describe('dedupeScripts', () => {
  it('REJECTS a candidate whose Jaccard similarity is >= 0.82 (just-above pair: one dropped)', () => {
    // 10 shared tokens + 1 unique each => inter=10, union=12 => 0.8333... >= 0.82 -> duplicate.
    const base = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet';
    const a = { text: base + ' kilo' };
    const b = { text: base + ' lima' };

    // Sanity: confirm the pair really is above the threshold.
    expect(_jac(_sig(a.text), _sig(b.text))).toBeGreaterThanOrEqual(0.82);

    const kept = dedupeScripts([a, b]);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toBe(a); // order-preserving: the first one is kept, the later near-dup dropped
  });

  it('KEEPS both when the pair is below 0.82 (both kept)', () => {
    // 6 shared + 3 unique each => inter=6, union=12 => 0.5 < 0.82 -> not a duplicate.
    const shared = 'alpha bravo charlie delta echo foxtrot';
    const a = { text: shared + ' mango papaya guava' };
    const b = { text: shared + ' quince raisin tomato' };

    expect(_jac(_sig(a.text), _sig(b.text))).toBeLessThan(0.82);

    const kept = dedupeScripts([a, b]);
    expect(kept).toHaveLength(2);
    expect(kept).toEqual([a, b]);
  });

  it('caps the output at max=30 when given more distinct items', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      text: `word${i}aaa word${i}bbb word${i}ccc completely distinct ${i}`,
    }));
    expect(dedupeScripts(items, 30)).toHaveLength(30);
  });

  it('defaults the cap to 30 when max is omitted', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      text: `word${i}aaa word${i}bbb word${i}ccc completely distinct ${i}`,
    }));
    expect(dedupeScripts(items)).toHaveLength(30);
  });

  it('matches the legacy call shape: slice(0,36) then max=30 is order-preserving', () => {
    // Mirror the legacy caller: deck=dedupeScripts(deck.slice(0,36),30).
    const deck = Array.from({ length: 50 }, (_, i) => ({
      text: `unique${i}xxx unique${i}yyy unique${i}zzz token ${i}`,
      fw: `fw${i}`,
    }));
    const kept = dedupeScripts(deck.slice(0, 36), 30);
    expect(kept).toHaveLength(30);
    // Order preserved: the kept items are the first 30 of the sliced input.
    expect(kept.map((k) => k.fw)).toEqual(deck.slice(0, 30).map((k) => k.fw));
  });

  it('preserves order: keeps the first occurrence and drops the later near-duplicate', () => {
    const base = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet';
    const first = { text: base + ' kilo', fw: 'first' };
    const middle = { text: 'totally different unrelated words here nothing shared common', fw: 'middle' };
    const dup = { text: base + ' lima', fw: 'dup-of-first' };

    const kept = dedupeScripts([first, middle, dup]);
    expect(kept.map((k) => k.fw)).toEqual(['first', 'middle']);
  });
});
