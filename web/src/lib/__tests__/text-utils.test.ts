import { describe, it, expect } from 'vitest';
import {
  substitute,
  nextScriptName,
  esc,
  uid,
  cleanKey,
} from '../text-utils';

describe('substitute', () => {
  it('fills both {{first_name}} and {{company}} tags', () => {
    const out = substitute('Hi {{first_name}} at {{company}}', {
      firstName: 'Ada',
      company: 'Acme',
    });
    expect(out).toBe('Hi Ada at Acme');
  });

  it('fills {{company_name}} as a company alias', () => {
    const out = substitute('Hi {{first_name}} at {{company_name}}', {
      firstName: 'Ada',
      company: 'Acme',
    });
    expect(out).toBe('Hi Ada at Acme');
  });

  it('falls back to the merge tags when values are absent', () => {
    const out = substitute('Hi {{first_name}} at {{company}}', {
      firstName: '',
      company: '',
    });
    expect(out).toBe('Hi {{first_name}} at {{company}}');
  });

  it('falls back to {{company}} for an empty {{company_name}} too', () => {
    const out = substitute('{{company_name}}', { firstName: '', company: '' });
    expect(out).toBe('{{company}}');
  });

  it('trims whitespace-only values and treats them as absent', () => {
    const out = substitute('{{first_name}} {{company}}', {
      firstName: '   ',
      company: '\t',
    });
    expect(out).toBe('{{first_name}} {{company}}');
  });

  it('replaces every occurrence (global)', () => {
    const out = substitute('{{first_name}} {{first_name}}', {
      firstName: 'Bo',
      company: 'X',
    });
    expect(out).toBe('Bo Bo');
  });
});

describe('nextScriptName', () => {
  const now = new Date('2026-06-27T10:00:00.000Z');

  it('starts at v1 when no scripts were saved today', () => {
    expect(nextScriptName({ scriptReservoir: [] }, now)).toBe('27 Jun · v1');
  });

  it('starts at v1 when scriptReservoir is missing', () => {
    expect(nextScriptName({}, now)).toBe('27 Jun · v1');
  });

  it('increments per-day with an injected now', () => {
    const client = {
      scriptReservoir: [
        { savedAt: '2026-06-27T08:00:00.000Z' },
        { savedAt: '2026-06-27T09:30:00.000Z' },
      ],
    };
    expect(nextScriptName(client, now)).toBe('27 Jun · v3');
  });

  it('only counts scripts saved on the same day (UTC date match)', () => {
    const client = {
      scriptReservoir: [
        { savedAt: '2026-06-26T23:00:00.000Z' }, // yesterday
        { savedAt: '2026-06-27T01:00:00.000Z' }, // today
        { savedAt: '2025-06-27T01:00:00.000Z' }, // last year, same M/D
      ],
    };
    // Only the one 2026-06-27 item counts -> n = 1 + 1 = 2
    expect(nextScriptName(client, now)).toBe('27 Jun · v2');
  });

  it('formats the month from the Jan..Dec array', () => {
    const jan = new Date('2026-01-05T00:00:00.000Z');
    expect(nextScriptName({ scriptReservoir: [] }, jan)).toBe('5 Jan · v1');
    const dec = new Date('2026-12-31T00:00:00.000Z');
    expect(nextScriptName({ scriptReservoir: [] }, dec)).toBe('31 Dec · v1');
  });
});

describe('cleanKey', () => {
  it('strips an ADMIN_KEY= prefix (case-insensitive)', () => {
    expect(cleanKey('ADMIN_KEY=abc123')).toBe('abc123');
    expect(cleanKey('admin_key=abc123')).toBe('abc123');
  });

  it('strips surrounding quotes', () => {
    expect(cleanKey('"abc123"')).toBe('abc123');
    expect(cleanKey("'abc123'")).toBe('abc123');
  });

  it('strips zero-width characters, BOM, and non-breaking space', () => {
    // ​ zero-width space, ‌ ZWNJ, ‍ ZWJ, ﻿ BOM,   NBSP
    expect(cleanKey('a​b‌c‍d﻿e f')).toBe('abcdef');
  });

  it('strips whitespace', () => {
    expect(cleanKey('  ab cd  ')).toBe('abcd');
  });

  it('handles the full copy-paste case at once', () => {
    expect(cleanKey('ADMIN_KEY="  abc​ 123 "')).toBe('abc123');
  });

  it('returns empty string for nullish input', () => {
    expect(cleanKey(null)).toBe('');
    expect(cleanKey(undefined)).toBe('');
  });
});

describe('esc', () => {
  it('escapes the five HTML entities', () => {
    expect(esc(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('returns empty string for nullish input', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });
});

describe('uid', () => {
  it('is prefix + "-" + base36 slice(2,8) of an injected rng', () => {
    // 0.5 -> "0.i" in base36; slice(2,8) -> "i"
    expect(uid('sr', () => 0.5)).toBe('sr-i');
  });

  it('uses prefix and a dash separator', () => {
    const out = uid('px', () => 0.123456789);
    expect(out.startsWith('px-')).toBe(true);
    expect(out).toBe('px-' + (0.123456789).toString(36).slice(2, 8));
  });
});
