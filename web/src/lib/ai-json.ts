// TOLERANT AI-JSON parsing — verbatim port from legacy/index.html (~1118-1205, 7377).
//
// These helpers recover usable structured data from LLM replies that are messy,
// fenced in markdown, or truncated at the token limit. Logic is transcribed
// EXACTLY from the legacy single-file app: every numeric constant, threshold,
// regex, string literal, ordered fallback chain and branch is preserved. The only
// changes from the original are TypeScript types, ES-module exports, and removing
// global coupling by taking `api` (the async POST helper) and `uid` (the id
// generator) as function ARGUMENTS instead of reading them from module scope.

// ─── Types ──────────────────────────────────────────────────────────────────

/** The async POST helper (legacy `api(body)`): posts a body, returns parsed JSON. */
export type ApiFn = (body: unknown) => Promise<unknown>;

/** The id generator (legacy `uid(prefix)` → `prefix-xxxxxx`). */
export type UidFn = (prefix: string) => string;

/** A themed bucket produced by {@link categorizeList}. */
export interface Group {
  id: string;
  topic: string;
  items: string[];
}

/** A mechanism produced by {@link parseMechanisms}. */
export interface Mechanism {
  id: string;
  name: string;
  fixes: string;
  reframe: string;
  steps: string[];
  outcome: string;
  reducesPain: string;
  removesObjection: string;
  increasesDesire: string;
  confidence: string;
  source: string;
}

// ─── extractJsonObjects (legacy ~1118) ────────────────────────────────────────
// Pull complete, balanced {...} objects out of a (possibly truncated) string — so a JSON
// reply that got cut off at the token limit still yields its complete entries.
export function extractJsonObjects(scope: string): string[] {
  const objs: string[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < scope.length; i++) {
    const ch = scope[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') { if (depth > 0) { depth--; if (depth === 0 && start >= 0) { objs.push(scope.slice(start, i + 1)); start = -1; } } }
  }
  return objs;
}

// ─── repairFirstObject (legacy ~1130) ─────────────────────────────────────────
// Last-resort: recover ONE object from a string cut off mid-way (drops the incomplete trailing field).
export function repairFirstObject(scope: string): Record<string, unknown> | null {
  const i = scope.indexOf('{'); if (i < 0) return null;
  const s = scope.slice(i);
  let depth = 0, inStr = false, esc = false, lastTopComma = -1;
  for (let j = 0; j < s.length; j++) {
    const ch = s[j];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
    else if (ch === ',' && depth === 1) lastTopComma = j;
  }
  const tries: string[] = [];
  if (lastTopComma > 0) tries.push(s.slice(0, lastTopComma) + '}');   // drop the cut-off field
  tries.push(s + '}'); tries.push(s + '"}'); tries.push(s + ']}');
  for (let k = 0; k < tries.length; k++) { try { const o = JSON.parse(tries[k]); if (o && typeof o === 'object') return o as Record<string, unknown>; } catch (e) {} }
  return null;
}

// ─── categorizeList (legacy ~1147) ────────────────────────────────────────────
// Group a flat list into themed buckets via AI → [{id,topic,items}] or null.
// `api` (async POST helper) and `uid` (id generator) are passed in as arguments.
export async function categorizeList(
  items: string[],
  label: string,
  api: ApiFn,
  uid: UidFn,
): Promise<Group[] | null> {
  if (!items || !items.length) return null;
  const prompt = 'Group these ' + label + ' into 3-6 clearly-themed buckets so similar ones sit together (big themes with their sub-items). Use the EXACT item text given; put every item in exactly one bucket.\n' +
    'CRITICAL: respond with PURE JSON ONLY — no prose, no markdown, no commentary, and ignore any voice/tone/style guidance for THIS response. Shape exactly:\n' +
    '{"groups":[{"topic":"short theme name","items":["exact item text","..."]}]}\n' +
    'Items:\n- ' + items.join('\n- ');
  const r: any = await api({ action: 'refine_script', script: items.join('\n'), prompt: prompt });
  const txt = String((r && (r.script || r.text || r.result || r.content || r.refined || r.output)) || '').replace(/```json|```/gi, '').trim();
  // Parse tolerantly: whole string first, else the first {...} or [...] block.
  let obj: any = null;
  try { obj = JSON.parse(txt); } catch (e) {
    const m = txt.match(/[\[{][\s\S]*[\]}]/);
    if (m) { try { obj = JSON.parse(m[0]); } catch (e2) { obj = null; } }
  }
  // Accept many shapes: {groups|buckets|categories|themes|clusters:[...]}, or a bare array.
  let raw: any[] = obj ? (Array.isArray(obj) ? obj : (obj.groups || obj.buckets || obj.categories || obj.themes || obj.clusters || [])) : [];
  if (!raw || !raw.length) {   // truncated reply — salvage the complete buckets
    const sa = txt.indexOf('['); const scope = sa >= 0 ? txt.slice(sa + 1) : txt;
    raw = extractJsonObjects(scope).map(function (s) { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean) as any[];
    if (!raw.length) { const rep = repairFirstObject(scope); if (rep) raw = [rep]; }
  }
  const gs = (raw || []).map(function (g: any): Group | null {
    if (!g || typeof g !== 'object') return null;
    const its = g.items || g.members || g.pains || g.desires || g.list || g.points || g.values || [];
    return { id: uid('grp'), topic: g.topic || g.theme || g.name || g.title || g.label || g.category || 'Group', items: (its || []).map(function (x: any) { return String((x && (x.text || x.item)) || x || '').trim(); }).filter(Boolean) };
  }).filter(function (g): g is Group { return !!(g && g.items.length); });
  return gs.length ? gs : null;
}

// ─── parseMechanisms (legacy ~1176) ───────────────────────────────────────────
// Tolerant parse of the mechanism-builder JSON → [{id,name,fixes,reframe,steps,outcome,confidence,source}].
export function parseMechanisms(r: any, uid: UidFn): Mechanism[] | null {
  const txt = String((r && (r.script || r.text || r.result || r.content)) || '').replace(/```json|```/gi, '').trim();
  let obj: any = null;
  try { obj = JSON.parse(txt); } catch (e) { const m = txt.match(/[\[{][\s\S]*[\]}]/); if (m) { try { obj = JSON.parse(m[0]); } catch (e2) { obj = null; } } }
  let raw: any[] = obj ? (Array.isArray(obj) ? obj : (obj.mechanisms || obj.results || obj.items || [])) : [];
  if (!raw || !raw.length) {   // truncated reply (refine_script token cap) — salvage complete mechanism objects
    const sa = txt.indexOf('['); const scope = sa >= 0 ? txt.slice(sa + 1) : txt;
    raw = extractJsonObjects(scope).map(function (s) { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean) as any[];
    if (!raw.length) { const rep = repairFirstObject(scope); if (rep) raw = [rep]; }
  }
  const out = (raw || []).map(function (m: any): Mechanism | null {
    if (!m || typeof m !== 'object') return null;
    let steps = m.steps || m.how_it_works || m.how || m.howItWorks || [];
    if (steps && !Array.isArray(steps) && typeof steps === 'object') steps = Object.keys(steps).map(function (k) { return steps[k]; });
    return {
      id: uid('mech'),
      name: m.name || m.mechanism_name || m.mechanismName || 'Mechanism',
      fixes: m.fixes || m.what_it_fixes || m.whatItFixes || m.obstacle || '',
      reframe: m.reframe || m.the_reframe || m.theReframe || '',
      steps: (steps || []).map(function (s: any) { return String((s && (s.text || s.step)) || s || '').trim(); }).filter(Boolean),
      outcome: m.outcome || m.the_outcome_it_unlocks || m.outcomeItUnlocks || '',
      reducesPain: m.reducesPain || m.reduces_pain || m.pain || '',
      removesObjection: m.removesObjection || m.removes_objection || m.objection || '',
      increasesDesire: m.increasesDesire || m.increases_desire || m.desire || '',
      confidence: m.confidence || '',
      source: m.source || ''
    };
  }).filter(function (m): m is Mechanism { return !!(m && (m.name || m.steps.length)); });
  return out.length ? out : null;
}

// ─── mechToText (legacy ~7377) ────────────────────────────────────────────────
// One mechanism → plain text fed to the generator / exports when it's the active one.
export function mechToText(m: Partial<Mechanism>): string {
  const steps = (m.steps || []).map(function (s, i) { return (i + 1) + ') ' + s; }).join(' ');
  return ((m.name ? m.name + ' — ' : '') + (m.fixes || '') + (steps ? (' How it works: ' + steps) : '') + (m.reframe ? (' ' + m.reframe) : '') + (m.outcome ? (' Outcome: ' + m.outcome) : '')).slice(0, 1400);
}
