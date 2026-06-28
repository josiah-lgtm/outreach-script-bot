// House-lens helpers used by the create-script wizard and the manual-add flows.
// Verbatim port of legacy index.html:1078-1113 (filterIdea / refineBatch / notifyFiltered).
// They run hand-typed lines through the house lens so anything added by hand stays
// on-brand. All three degrade gracefully: with no admin key / empty lens / on any
// failure they keep the original text and never lose or misalign data.

import { api } from "./api";
import { composeLens } from "./systemFilter";
import { getAdminKey } from "./adminKey";
import { notify } from "@/lib/notify";

const MOCK_TAIL = /\n*\(mock refinement applied\)\s*$/;

// Run a single manually-typed idea (offer, angle, pain or desire) through the house
// filter. Falls back to the raw text when the filter is off / empty / no admin key.
export async function filterIdea(text: string): Promise<{ text: string; filtered: boolean }> {
  const raw = String(text || "").trim();
  if (!raw || !getAdminKey() || !composeLens()) return { text: raw, filtered: false };
  try {
    const r = await api({
      action: "refine_script",
      script: raw,
      prompt:
        "Rewrite this single short line to match our house lens and messaging. Keep it short. Return only the rewritten line — no quotes, no extra text.",
    });
    let out = (r && (r.script || r.text || r.result || r.refined || r.output || r.content)) || "";
    out = String(out).replace(MOCK_TAIL, "").trim();
    return out ? { text: out, filtered: out !== raw } : { text: raw, filtered: false };
  } catch {
    return { text: raw, filtered: false };
  }
}

// Rewrite many short lines through the house lens in ONE backend call per chunk (instead
// of one Claude call per line). Returns { items: array aligned to input, ok: per-item
// success flags }. On any failure it keeps the original text for that item.
export async function refineBatch(
  items: string[],
  prompt: string,
  extra?: Record<string, unknown>,
): Promise<{ items: string[]; ok: boolean[] }> {
  const out = items.slice();
  const ok = items.map(() => false);
  const CHUNK = 25;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    try {
      const r = await api(Object.assign({ action: "refine_batch", items: chunk, prompt }, extra || {}));
      const got = r && Array.isArray(r.items) ? r.items : [];
      if (got.length !== chunk.length) continue; // mismatched count → keep originals, never shift onto the wrong item
      for (let j = 0; j < chunk.length; j++) {
        const v = String(got[j] == null ? "" : got[j]).replace(MOCK_TAIL, "").trim();
        if (v) {
          out[i + j] = v;
          ok[i + j] = true;
        }
      }
    } catch {
      /* whole chunk failed → keep originals, ok stays false */
    }
  }
  return { items: out, ok };
}

// Visible confirmation that an AI action just ran through the house filter.
export function notifyFiltered(): void {
  try {
    if (composeLens()) notify("✨ Run through your system filter");
  } catch {
    /* ignore */
  }
}
