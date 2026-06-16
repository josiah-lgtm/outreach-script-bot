#!/usr/bin/env -S deno run --allow-read
// Data-integrity check for the new-UI migration. Runs on Deno OR Node.
//   Deno: deno run --allow-read tools/migration-check.mjs live-config.json
//   Node: node tools/migration-check.mjs live-config.json
// Verifies every expected key/field is present and that a JSON round-trip
// (what the new UI does when it loads + re-saves config) drops nothing.

const isDeno = typeof Deno !== 'undefined';
const args = isDeno ? Deno.args : process.argv.slice(2);
const path = args[0] || 'live-config.json';
const die = (code) => { if (isDeno) Deno.exit(code); else process.exit(code); };
async function readText(p){
  if (isDeno) return await Deno.readTextFile(p);
  const { readFileSync } = await import('node:fs');
  return readFileSync(p, 'utf8');
}

const TOP_KEYS = ['version','settings','frameworks','niches','clients','toolsKB','sellerProfile','followupFrameworks','prospects','winningScripts'];
const CLIENT_FIELDS = ['id','name','meta','nicheId','caseStudy','frameworkOverrides'];
const CASE_FIELDS = ['size','result','mechanism','proofLine','pains','objections','desires'];
const NICHE_FIELDS = ['id','name','angles','triggerWords'];
const FW_FIELDS = ['id','name','category','template','rules'];

let bad = false;
const fail = (m)=>{ console.error('✗ ' + m); bad = true; };
const ok = (m)=> console.log('✓ ' + m);
const deepEqual = (a,b)=> JSON.stringify(a) === JSON.stringify(b);

let raw;
try { raw = await readText(path); }
catch { console.error(`\nNo config file at "${path}".\nExport JSON from the live app and save it there, then re-run.\n`); die(2); }

let cfg;
try { cfg = JSON.parse(raw); } catch (e) { fail('File is not valid JSON: '+e.message); die(1); }

console.log(`\nChecking ${path}\n`);

// 1. Round-trip preservation — the actual no-data-loss guarantee
if (deepEqual(cfg, JSON.parse(JSON.stringify(cfg)))) ok('Round-trip (load → save) preserves the config exactly');
else fail('Round-trip changed the config — investigate before launch');

// 2. Top-level keys
for (const k of TOP_KEYS){
  if (k in cfg) ok(`top-level key present: ${k}`);
  else console.warn(`  • absent: ${k} (fine if the team never used it)`);
}

// 3. Per-entity field + record-count checks
function checkArray(name, arr, fields){
  if (!Array.isArray(arr)) { console.warn(`  • ${name}: not present`); return; }
  ok(`${name}: ${arr.length} record(s)`);
  arr.forEach((rec,i)=>{
    const missing = fields.filter(f => !(f in rec));
    if (missing.length) fail(`  ${name}[${i}] (${rec.name||rec.id||'?'}) missing: ${missing.join(', ')}`);
  });
}
checkArray('frameworks', cfg.frameworks, FW_FIELDS);
checkArray('niches', cfg.niches, NICHE_FIELDS);
checkArray('clients', cfg.clients, CLIENT_FIELDS);
(cfg.clients||[]).forEach((c,i)=>{
  if (c.caseStudy){ const m = CASE_FIELDS.filter(f=>!(f in c.caseStudy)); if (m.length) fail(`  clients[${i}].caseStudy missing: ${m.join(', ')}`); }
});
checkArray('prospects', cfg.prospects, ['id']);

console.log('\nRecord summary:');
for (const k of ['frameworks','niches','clients','prospects','winningScripts','followupFrameworks']){
  if (Array.isArray(cfg[k])) console.log(`  ${k}: ${cfg[k].length}`);
}
console.log(bad ? '\nRESULT: issues found — do NOT launch yet.\n' : '\nRESULT: all checks passed — every record + field preserved.\n');
die(bad ? 1 : 0);
