import { describe, it, expect } from 'vitest';
import {
  extractJsonObjects,
  repairFirstObject,
  categorizeList,
  parseMechanisms,
  mechToText,
} from '../ai-json';

// Deterministic uid for assertions (legacy used Math.random; tests need stability).
function makeUid() {
  let n = 0;
  return (p: string) => `${p}-${(n++).toString().padStart(6, '0')}`;
}

describe('extractJsonObjects', () => {
  it('recovers complete balanced objects from a truncated array', () => {
    // Callers slice off the opening '[' first, so `scope` is the inner content:
    // two complete objects then a cut-off third (no closing brace).
    const truncated = '{"topic":"A","items":["x"]},{"topic":"B","items":["y"]},{"topic":"C","items';
    const out = extractJsonObjects(truncated);
    expect(out).toHaveLength(2);
    expect(JSON.parse(out[0])).toEqual({ topic: 'A', items: ['x'] });
    expect(JSON.parse(out[1])).toEqual({ topic: 'B', items: ['y'] });
  });

  it('is string/escape aware — braces inside strings do not break balancing', () => {
    const scope = '{"a":"a } { b","b":"c"}';
    const out = extractJsonObjects(scope);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0])).toEqual({ a: 'a } { b', b: 'c' });
  });

  it('handles escaped quotes inside strings', () => {
    const scope = '{"a":"he said \\"hi}\\" "}';
    const out = extractJsonObjects(scope);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0]).a).toBe('he said "hi}" ');
  });

  it('returns no objects when there is no closing brace at all', () => {
    expect(extractJsonObjects('{"topic":"A","items":["x"')).toEqual([]);
  });
});

describe('repairFirstObject', () => {
  it('closes a cut-off object by dropping the incomplete trailing field', () => {
    // top-level comma at depth 1 separates the complete field from the cut-off one
    const cut = '{"topic":"A","items":["x","y"],"note":"unfinished';
    const o = repairFirstObject(cut);
    expect(o).toEqual({ topic: 'A', items: ['x', 'y'] });
  });

  it('appends a closing brace when there is no top-level comma', () => {
    const o = repairFirstObject('{"topic":"A"');
    expect(o).toEqual({ topic: 'A' });
  });

  it('returns null when there is no opening brace', () => {
    expect(repairFirstObject('no object here')).toBeNull();
  });
});

describe('parseMechanisms', () => {
  it('maps alternate keys (how_it_works, what_it_fixes, the_reframe, etc.)', () => {
    const uid = makeUid();
    const r = {
      script: JSON.stringify({
        mechanisms: [
          {
            mechanism_name: 'The Reset',
            what_it_fixes: 'stuck pipeline',
            the_reframe: 'it is a system not a hustle',
            how_it_works: ['step one', 'step two'],
            the_outcome_it_unlocks: 'predictable booked calls',
            reduces_pain: 'less stress',
            removes_objection: 'no risk',
            increases_desire: 'more revenue',
            confidence: 'high',
            source: 'call notes',
          },
        ],
      }),
    };
    const out = parseMechanisms(r, uid)!;
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      id: 'mech-000000',
      name: 'The Reset',
      fixes: 'stuck pipeline',
      reframe: 'it is a system not a hustle',
      steps: ['step one', 'step two'],
      outcome: 'predictable booked calls',
      reducesPain: 'less stress',
      removesObjection: 'no risk',
      increasesDesire: 'more revenue',
      confidence: 'high',
      source: 'call notes',
    });
  });

  it('falls back through container keys (results) and step object → values', () => {
    const uid = makeUid();
    const r = {
      text: JSON.stringify({
        results: [{ name: 'M', how: { a: 'first', b: 'second' } }],
      }),
    };
    const out = parseMechanisms(r, uid)!;
    expect(out[0].name).toBe('M');
    expect(out[0].steps).toEqual(['first', 'second']);
  });

  it('salvages a complete mechanism from a truncated array reply', () => {
    const uid = makeUid();
    const r = {
      result:
        '{"mechanisms":[{"name":"Done","steps":["a"]},{"name":"Cut',
    };
    const out = parseMechanisms(r, uid)!;
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Done');
    expect(out[0].steps).toEqual(['a']);
  });

  it('returns null when nothing parses', () => {
    expect(parseMechanisms({ script: 'not json at all' }, makeUid())).toBeNull();
  });
});

describe('categorizeList', () => {
  const uid = makeUid();

  it('returns null for empty input without calling api', async () => {
    let called = false;
    const api = async () => {
      called = true;
      return {};
    };
    expect(await categorizeList([], 'pains', api, uid)).toBeNull();
    expect(called).toBe(false);
  });

  it('parses {groups:[...]} and uses exact item text', async () => {
    const api = async () => ({
      script: '{"groups":[{"topic":"Time","items":["no time","always busy"]}]}',
    });
    const out = (await categorizeList(['no time', 'always busy'], 'pains', api, uid))!;
    expect(out).toHaveLength(1);
    expect(out[0].topic).toBe('Time');
    expect(out[0].items).toEqual(['no time', 'always busy']);
    expect(out[0].id.startsWith('grp-')).toBe(true);
  });

  it('strips markdown fences and falls back through container keys (buckets)', async () => {
    const api = async () => ({
      script: '```json\n{"buckets":[{"theme":"Cost","members":["too expensive"]}]}\n```',
    });
    const out = (await categorizeList(['too expensive'], 'pains', api, uid))!;
    expect(out[0].topic).toBe('Cost');
    expect(out[0].items).toEqual(['too expensive']);
  });

  it('salvages buckets from a truncated reply', async () => {
    const api = async () => ({
      script: '{"groups":[{"topic":"A","items":["x"]},{"topic":"B","items":["y"]},{"topic":"C',
    });
    const out = (await categorizeList(['x', 'y'], 'pains', api, uid))!;
    expect(out).toHaveLength(2);
    expect(out.map((g) => g.topic)).toEqual(['A', 'B']);
  });
});

describe('mechToText', () => {
  it('formats a mechanism into the exact prompt string and numbers steps', () => {
    const txt = mechToText({
      name: 'The Reset',
      fixes: 'stuck pipeline',
      reframe: 'system not hustle',
      steps: ['audit', 'rebuild'],
      outcome: 'booked calls',
    });
    expect(txt).toBe(
      'The Reset — stuck pipeline How it works: 1) audit 2) rebuild system not hustle Outcome: booked calls',
    );
  });

  it('caps output at 1400 chars', () => {
    const txt = mechToText({ name: 'A', fixes: 'x'.repeat(5000) });
    expect(txt.length).toBe(1400);
  });
});
