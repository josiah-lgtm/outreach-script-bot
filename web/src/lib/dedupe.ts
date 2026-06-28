// Near-duplicate script filter.
//
// VERBATIM port of _sig / _jac / dedupeScripts from legacy/index.html (~lines 7627-7629).
// Keeps up to `max` scripts whose wording is meaningfully different (word-set Jaccard < 0.82).
//
// Permitted changes vs. legacy: TypeScript types + ES module exports. The logic, numeric
// constants (0.82, default 30), regexes, and branching are transcribed exactly.

/** An item carrying script text. The legacy caller dedupes objects with a `.text` field. */
export interface ScriptItem {
  text?: string | null;
  [key: string]: unknown;
}

/**
 * Word-set signature of a script: lowercase, strip {{tags}}, strip non-alphanumerics to spaces,
 * split on whitespace, keep tokens with length > 2.
 *
 * Legacy:
 *   function _sig(t){return String(t||'').toLowerCase().replace(/\{\{[^}]+\}\}/g,'').replace(/[^a-z0-9 ]+/g,' ').split(/\s+/).filter(function(x){return x.length>2;});}
 */
export function _sig(t: unknown): string[] {
  return String(t || '')
    .toLowerCase()
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(function (x) {
      return x.length > 2;
    });
}

/**
 * Jaccard similarity between two word-set signatures (intersection / union).
 * Returns 0 if either is empty.
 *
 * Legacy:
 *   function _jac(a,b){if(!a.length||!b.length)return 0;var sb={};b.forEach(function(x){sb[x]=1;});var inter=0,sa={};a.forEach(function(x){if(!sa[x]){sa[x]=1;if(sb[x])inter++;}});var uni={};a.concat(b).forEach(function(x){uni[x]=1;});return inter/Object.keys(uni).length;}
 */
export function _jac(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sb: Record<string, number> = {};
  b.forEach(function (x) {
    sb[x] = 1;
  });
  let inter = 0;
  const sa: Record<string, number> = {};
  a.forEach(function (x) {
    if (!sa[x]) {
      sa[x] = 1;
      if (sb[x]) inter++;
    }
  });
  const uni: Record<string, number> = {};
  a.concat(b).forEach(function (x) {
    uni[x] = 1;
  });
  return inter / Object.keys(uni).length;
}

/**
 * Keep up to `max` scripts whose wording is meaningfully different (word-set Jaccard < 0.82).
 * A candidate is REJECTED when its Jaccard similarity to an already-kept signature is >= 0.82.
 * Order-preserving. Default cap is 30. The legacy caller passes items.slice(0,36) with max=30.
 *
 * Legacy:
 *   function dedupeScripts(items,max){var kept=[],sigs=[];for(var i=0;i<items.length;i++){var s=_sig(items[i].text);var dup=false;for(var j=0;j<sigs.length;j++){if(_jac(s,sigs[j])>=0.82){dup=true;break;}}if(!dup){kept.push(items[i]);sigs.push(s);if(kept.length>=(max||30))break;}}return kept;}
 */
export function dedupeScripts<T extends ScriptItem>(items: T[], max?: number): T[] {
  const kept: T[] = [],
    sigs: string[][] = [];
  for (let i = 0; i < items.length; i++) {
    const s = _sig(items[i].text);
    let dup = false;
    for (let j = 0; j < sigs.length; j++) {
      if (_jac(s, sigs[j]) >= 0.82) {
        dup = true;
        break;
      }
    }
    if (!dup) {
      kept.push(items[i]);
      sigs.push(s);
      if (kept.length >= (max || 30)) break;
    }
  }
  return kept;
}

export default dedupeScripts;
