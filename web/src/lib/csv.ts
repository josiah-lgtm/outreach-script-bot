// CSV export for script records — verbatim port of legacy exportCsv()
// (legacy/index.html ~L2386). Split into a PURE builder (buildCsv) and a
// DOM-only trigger (downloadCsv).
//
// SECURITY INVARIANTS (kept exactly as the legacy source):
//   - RFC4180 quoting: internal double-quotes are doubled, every field is
//     wrapped in double-quotes.
//   - Spreadsheet formula-injection defang: a cell whose first char is one of
//     = + - @ tab CR is executed as a formula by Excel/Sheets, so prefix it
//     with a single quote (').

/** A single script record as produced by the legacy flatScripts(). */
export interface ScriptRow {
  framework: unknown;
  category: unknown;
  angle: unknown;
  label: unknown;
  /** variant number (legacy field name: n). Maps to the `variant` column. */
  n: unknown;
  script: unknown;
}

// Quote-double per RFC4180, AND defang spreadsheet formula injection: a cell
// starting with = + - @ (or tab/CR) is executed as a formula by Excel/Sheets,
// so prefix it with a single quote. Affects AI-generated labels/angles and
// script lines (bullets start '-').
const q = (v: unknown): string => {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
};

/**
 * PURE: build the CSV text from script rows. Header line is exactly
 * `framework,category,angle,label,variant,script`. The `variant` column comes
 * from each row's `n` field (legacy mapping).
 */
export function buildCsv(rows: ScriptRow[]): string {
  return [
    'framework,category,angle,label,variant,script',
    ...rows.map((s) =>
      [s.framework, s.category, s.angle, s.label, s.n, s.script].map(q).join(',')
    ),
  ].join('\n');
}

/**
 * DOM side-effect: trigger a browser download of the given CSV text. Mirrors
 * the legacy Blob + anchor.click() trigger. Defaults the filename to match the
 * legacy export ('outreach-scripts.csv').
 */
export function downloadCsv(csv: string, filename = 'outreach-scripts.csv'): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
