// Scoped styling for the growth-plan document (preview + Tiptap editor). The doc renders
// semantic tags (h1/h2/h3/ul/table/pre.scriptbox/.callout/etc.) the same way the legacy
// `.doc` block did; this keeps that look without touching the shared globals.css. Mounted
// once near the doc; selectors are namespaced under `.gp-doc`.

"use client";

export function DocStyles() {
  return (
    <style>{`
      .gp-doc { color: var(--text); font-size: 13px; line-height: 1.6; }
      .gp-doc h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
      .gp-doc h2 { font-size: 16px; font-weight: 700; margin: 22px 0 8px; }
      .gp-doc h3 { font-size: 13px; font-weight: 700; margin: 14px 0 5px; text-transform: none; }
      .gp-doc p { margin: 0 0 9px; }
      .gp-doc ul { margin: 0 0 10px; padding-left: 20px; list-style: disc; }
      .gp-doc li { margin: 2px 0; }
      .gp-doc b, .gp-doc strong { font-weight: 700; }
      .gp-doc .doc-sub { color: var(--muted); font-size: 12px; margin-bottom: 10px; }
      .gp-doc .muted { color: var(--muted); }
      .gp-doc .warn { color: var(--amber); }
      .gp-doc .rowdesc { font-weight: 400; font-size: 10.5px; color: var(--muted); }
      .gp-doc table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; font-size: 12px; }
      .gp-doc th, .gp-doc td { border: 1px solid var(--border); padding: 7px 9px; text-align: left; vertical-align: top; }
      .gp-doc th { background: var(--bg3); font-weight: 600; }
      .gp-doc .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .gp-doc .tot { font-weight: 700; }
      .gp-doc .scriptbox {
        background: var(--bg3); border: 1px solid var(--border); border-radius: 7px;
        padding: 11px 13px; font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 12px; white-space: pre-wrap; margin: 0 0 9px; overflow: auto;
      }
      .gp-doc .callout {
        background: var(--tint-accent, rgba(37,99,235,.08)); border: 1px solid var(--border);
        border-left: 3px solid var(--accent); border-radius: 8px; padding: 11px 13px; margin: 12px 0;
      }
      .gp-doc .callout.pledge { border-left-color: var(--green, #16a34a); }
      .gp-doc .big-stat { font-size: 26px; font-weight: 700; margin: 4px 0 0; }
      .gp-doc .stat-row { display: flex; gap: 16px; margin: 12px 0; }
      .gp-doc .stat-row .s { flex: 1; background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 12px; text-align: center; }
      .gp-doc .stat-row .lab { font-size: 11px; color: var(--muted); }
      .gp-doc .opt-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 12px; margin: 8px 0; }
      .gp-doc .opt-card .oc-title { font-weight: 700; font-size: 13px; margin-bottom: 3px; }
      .gp-doc .gp-fold { border: 1px solid var(--border); border-radius: 8px; background: var(--bg2); padding: 0 12px; margin-bottom: 8px; }
      .gp-doc .gp-fold > summary { cursor: pointer; padding: 10px 0; font-weight: 600; font-size: 13px; }
      .gp-doc-edit { min-height: 300px; }
      .gp-doc-edit:focus { outline: none; }
    `}</style>
  );
}
