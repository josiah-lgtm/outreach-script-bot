// text-utils.ts
// VERBATIM port of small text helpers from legacy/index.html.
// The ONLY permitted changes vs. the legacy source:
//   (a) TypeScript types,
//   (b) DOM/global coupling removed by taking inputs as ARGUMENTS,
//   (c) ES module export syntax.
// Logic, numeric constants, regexes, and string literals are preserved exactly.

// ─── cleanKey (legacy ~1013) ───────────────────────────────────────────────
// Strip everything that sneaks in via copy-paste: quotes, whitespace,
// zero-width characters, an accidental "ADMIN_KEY=" prefix.
export const cleanKey = (s: unknown): string =>
  String(s || '')
    .replace(/^ADMIN_KEY=/i, '')
    .replace(/["'\u200B-\u200D\uFEFF\u00A0]/g, '')
    .replace(/\s+/g, '');

// ─── esc (legacy ~1392) ────────────────────────────────────────────────────
// HTML-entity escape.
export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, c => (({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  } as Record<string, string>)[c] as string));

// ─── uid (legacy ~1393) ────────────────────────────────────────────────────
// uid = prefix + '-' + Math.random().toString(36).slice(2, 8).
// `rng` arg is optional (defaults to Math.random) so tests can inject a value.
export const uid = (p: string, rng: () => number = Math.random): string =>
  p + '-' + rng().toString(36).slice(2, 8);

// ─── substitute (legacy ~2260) ─────────────────────────────────────────────
// Fill {{first_name}} and {{company}}/{{company_name}} merge tags.
// Legacy read #fname/#company DOM inputs (trimmed); here those values are
// passed in as ARGUMENTS. Fallback-to-merge-tag behavior preserved exactly.
export interface SubstituteVars {
  firstName: string;
  company: string;
}

export function substitute(script: unknown, vars: SubstituteVars): string {
  const fname = String(vars.firstName ?? '').trim();
  const company = String(vars.company ?? '').trim();
  return String(script)
    .replace(/\{\{first_name\}\}/g, fname || '{{first_name}}')
    .replace(/\{\{company(_name)?\}\}/g, company || '{{company}}');
}

// ─── nextScriptName (legacy ~2881) ─────────────────────────────────────────
// Shared script name: "<day Mon> · v<n>" where n counts scripts saved on the
// same day for this client (so each day's scripts run v1, v2, v3…). Call
// BEFORE the new item is pushed so the count excludes it.
// Legacy used `new Date()`; here `now` is an injectable argument (default
// `new Date()`) so tests can pin the date.
export interface ScriptReservoirItem {
  savedAt?: string;
}

export interface NextScriptNameClient {
  scriptReservoir?: ScriptReservoirItem[];
}

export function nextScriptName(c: NextScriptNameClient, now: Date = new Date()): string {
  const d = now;
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  const today = d.toISOString().slice(0, 10);
  const n = (c.scriptReservoir || []).filter(s => String(s.savedAt || '').slice(0, 10) === today).length + 1;
  return `${d.getDate()} ${mo} · v${n}`;
}
