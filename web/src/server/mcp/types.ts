// Shared shapes for the MCP tool registry.

import type { Principal } from "./auth";

export type JsonSchema = Record<string, unknown>;

export interface ToolCtx {
  principal: Principal;
  /** Absolute origin of this deployment, for building resource URLs. */
  baseUrl: string;
}

/**
 * A tool handler returns either a string (surfaced verbatim as the text content)
 * or any JSON value (pretty-printed). Throw to signal a tool error — the protocol
 * layer converts it into an `isError` result the model can read and recover from.
 */
export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolCtx,
) => Promise<string | unknown>;

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  /** Requires the outreach:write scope. */
  write?: boolean;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  handler: ToolHandler;
}

/** Small helper so every schema is a proper object schema with no surprises. */
export function schema(
  properties: Record<string, JsonSchema>,
  required: string[] = [],
): JsonSchema {
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

export const str = (description: string, extra: JsonSchema = {}): JsonSchema =>
  ({ type: "string", description, ...extra });
export const num = (description: string, extra: JsonSchema = {}): JsonSchema =>
  ({ type: "number", description, ...extra });
export const bool = (description: string, extra: JsonSchema = {}): JsonSchema =>
  ({ type: "boolean", description, ...extra });
export const arr = (description: string, items: JsonSchema): JsonSchema =>
  ({ type: "array", description, items });

// ─── Argument coercion ───────────────────────────────────────────────────────
// Hosts occasionally send numbers as strings or a single string where an array is
// declared. Being liberal here removes a whole class of "invalid arguments" retries.

export function argStr(args: Record<string, unknown>, key: string, fallback = ""): string {
  const v = args[key];
  return v == null ? fallback : String(v);
}

export function argNum(args: Record<string, unknown>, key: string, fallback: number): number {
  const n = Number(args[key]);
  return Number.isFinite(n) ? n : fallback;
}

export function argBool(args: Record<string, unknown>, key: string, fallback = false): boolean {
  const v = args[key];
  if (v == null) return fallback;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

export function argArr(args: Record<string, unknown>, key: string): string[] {
  const v = args[key];
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x ?? "")).filter((x) => x.trim());
  const s = String(v).trim();
  return s ? [s] : [];
}

export function required(args: Record<string, unknown>, key: string): string {
  const v = argStr(args, key).trim();
  if (!v) throw new Error(`"${key}" is required`);
  return v;
}
