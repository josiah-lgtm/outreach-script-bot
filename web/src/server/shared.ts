// Small shared helpers + limits for the action handlers. Port of legacy index.ts
// (limits 181-192, pickModel 25-28, textOf 194-196, parseJson 198-209).

import { CLAUDE_HAIKU, CLAUDE_MODEL, CLAUDE_MODEL_OPUS, type Tool } from "./anthropic";

// ─── Limits ─────────────────────────────────────────────────────────────────
export const MAX_FRAMEWORKS = 6;
export const MAX_ANGLES = 8;
export const MAX_VARIANTS_PER_ANGLE = 3;
export const MAX_TOTAL_SCRIPTS = Number(process.env.MAX_TOTAL_SCRIPTS || 24);
export const MAX_PROMPT_CHARS = Number(process.env.MAX_PROMPT_CHARS || 80_000);

// Map a safe model alias (from the UI) to a real Claude model id. Unknown → default.
export function pickModel(alias: unknown): string {
  const map: Record<string, string> = { sonnet: CLAUDE_MODEL, opus: CLAUDE_MODEL_OPUS, haiku: CLAUDE_HAIKU };
  return map[String(alias ?? "").toLowerCase()] || CLAUDE_MODEL;
}

// Anthropic server-side web search tool (executed by the API, not by us).
export const webSearchTool = (maxUses: number): Tool =>
  ({ type: "web_search_20250305", name: "web_search", max_uses: maxUses }) as unknown as Tool;

export function textOf(content: Array<{ type: string }>): string {
  return content.filter((b) => b.type === "text").map((b) => (b as unknown as { text: string }).text).join("");
}

export function parseJson<T>(raw: string, fallback: T): T {
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) return fallback;
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return fallback;
  }
}

// JSON Response helper (mirrors the legacy `json(body, status)`). Same-origin in the new
// app, so CORS headers aren't required, but we keep a permissive set for parity/robustness.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-key",
};
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
export const corsHeaders = CORS;
