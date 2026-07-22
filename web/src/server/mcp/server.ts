// MCP protocol dispatch (JSON-RPC 2.0 over Streamable HTTP, stateless mode).
//
// Stateless is the right shape here: every tool call reads and writes the one
// shared config document, so there is no per-session state worth keeping. A POST
// carries a request (or a batch), we answer with a single JSON body, done. No
// session ids to expire, nothing to lose across a redeploy, and it survives
// multiple app replicas behind nginx without sticky routing.
//
// Implemented methods: initialize, notifications/initialized, ping, tools/list,
// tools/call, resources/list, resources/read, resources/templates/list,
// prompts/list, prompts/get, logging/setLevel.

import { TOOLS, getTool } from "./tools";
import { RESOURCES, getResource, PROMPTS, getPrompt } from "./resources";
import { canWrite, type Principal } from "./auth";
import type { ToolCtx } from "./types";

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const LATEST_PROTOCOL_VERSION = "2025-06-18";

export const SERVER_INFO = {
  name: "outreach-script-bot",
  title: "Outreach Script Bot",
  version: "1.0.0",
};

const INSTRUCTIONS = `Drives an agency's outreach tooling: builds ideal customer profiles for a client and writes cold outreach scripts — and lets you change the LOGIC behind both.

Orientation: call whoami first, then read the outreach://guide resource.

To change how the ICP builder or the script maker thinks:
  get_logic → set_logic (use dryRun first) → preview_prompt (free) → build_icp / generate_scripts

Three layers of logic, all editable:
  • house lens   settings.systemFilter.*  — agency-wide knowledge injected into every call
  • engine slots settings.engines.*       — the builder's own system prompts (empty = shipped default)
  • structure    globalRules, frameworks, builder buttons

Before blaming a prompt for weak output, check the client's MATERIAL with get_client: a thin case study with no transcripts and no saved ICP produces generic output no prompt can rescue.

Writes go to a shared config that the web app is editing live. They are atomic and retried on conflict, but they are real and immediate — use dryRun on set_logic and patch_config, and save=false on the generators, until you have shown the user what you are about to do.`;

// ─── JSON-RPC types ──────────────────────────────────────────────────────────

export interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface RpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

function ok(id: RpcRequest["id"], result: unknown): RpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function err(id: RpcRequest["id"], code: number, message: string, data?: unknown): RpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

export { PARSE_ERROR, INVALID_REQUEST };

// ─── dispatch ────────────────────────────────────────────────────────────────

export interface HandleOpts {
  principal: Principal;
  baseUrl: string;
  /** Protocol version negotiated on this connection, if the client sent one. */
  protocolVersion?: string;
}

/**
 * Handle one JSON-RPC message. Returns null for notifications (no id), which the
 * transport answers with 202 Accepted and an empty body.
 */
export async function handleRpc(msg: unknown, opts: HandleOpts): Promise<RpcResponse | null> {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
    return err(null, INVALID_REQUEST, "Request must be a JSON-RPC object");
  }
  const req = msg as RpcRequest;
  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return err(req.id ?? null, INVALID_REQUEST, "Malformed JSON-RPC request");
  }
  const isNotification = req.id === undefined || req.id === null;
  const params = (req.params ?? {}) as Record<string, unknown>;
  const ctx: ToolCtx = { principal: opts.principal, baseUrl: opts.baseUrl };

  try {
    switch (req.method) {
      // ── lifecycle ──
      case "initialize": {
        const asked = String(params.protocolVersion ?? "");
        const version = SUPPORTED_PROTOCOL_VERSIONS.includes(asked) ? asked : LATEST_PROTOCOL_VERSION;
        return ok(req.id, {
          protocolVersion: version,
          capabilities: {
            tools: { listChanged: false },
            resources: { listChanged: false, subscribe: false },
            prompts: { listChanged: false },
            logging: {},
          },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        });
      }

      case "notifications/initialized":
      case "notifications/cancelled":
      case "notifications/progress":
      case "notifications/roots/list_changed":
        return null;

      case "ping":
        return ok(req.id, {});

      case "logging/setLevel":
        return ok(req.id, {});

      // ── tools ──
      case "tools/list":
        return ok(req.id, {
          tools: TOOLS.map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: {
              title: t.title,
              readOnlyHint: t.annotations?.readOnlyHint ?? false,
              destructiveHint: t.annotations?.destructiveHint ?? false,
              idempotentHint: t.annotations?.idempotentHint ?? false,
              openWorldHint: t.annotations?.openWorldHint ?? false,
            },
          })),
        });

      case "tools/call": {
        const name = String(params.name ?? "");
        const tool = getTool(name);
        if (!tool) {
          return err(req.id, INVALID_PARAMS, `Unknown tool "${name}". Call tools/list to see what is available.`);
        }
        const args = (params.arguments ?? {}) as Record<string, unknown>;
        if (tool.write && !canWrite(opts.principal)) {
          return ok(req.id, toolError(
            `"${name}" changes saved data and this connection only has read access (scopes: ${opts.principal.scopes.join(", ") || "none"}). Reconnect with write access to use it.`,
          ));
        }
        try {
          const value = await tool.handler(args, ctx);
          return ok(req.id, toolResult(value));
        } catch (e) {
          // Tool failures are results, not protocol errors — the model can read the
          // message and correct itself without the host tearing the call down.
          return ok(req.id, toolError(String((e as Error)?.message ?? e)));
        }
      }

      // ── resources ──
      case "resources/list":
        return ok(req.id, {
          resources: RESOURCES.map((r) => ({
            uri: r.uri, name: r.name, title: r.title,
            description: r.description, mimeType: r.mimeType,
          })),
        });

      case "resources/templates/list":
        return ok(req.id, { resourceTemplates: [] });

      case "resources/read": {
        const uri = String(params.uri ?? "");
        const res = getResource(uri);
        if (!res) return err(req.id, INVALID_PARAMS, `Unknown resource "${uri}".`);
        const text = await res.read(ctx);
        return ok(req.id, { contents: [{ uri: res.uri, name: res.name, title: res.title, mimeType: res.mimeType, text }] });
      }

      // ── prompts ──
      case "prompts/list":
        return ok(req.id, {
          prompts: PROMPTS.map((p) => ({
            name: p.name, title: p.title, description: p.description, arguments: p.arguments,
          })),
        });

      case "prompts/get": {
        const name = String(params.name ?? "");
        const p = getPrompt(name);
        if (!p) return err(req.id, INVALID_PARAMS, `Unknown prompt "${name}".`);
        const args = (params.arguments ?? {}) as Record<string, string>;
        for (const a of p.arguments) {
          if (a.required && !String(args[a.name] ?? "").trim()) {
            return err(req.id, INVALID_PARAMS, `Prompt "${name}" requires the "${a.name}" argument.`);
          }
        }
        return ok(req.id, {
          description: p.description,
          messages: [{ role: "user", content: { type: "text", text: p.build(args) } }],
        });
      }

      default:
        if (isNotification) return null; // ignore unknown notifications
        return err(req.id, METHOD_NOT_FOUND, `Method "${req.method}" is not supported by this server.`);
    }
  } catch (e) {
    console.error("mcp dispatch error:", req.method, e);
    return err(req.id, INTERNAL_ERROR, String((e as Error)?.message ?? e));
  }
}

// ─── result shaping ──────────────────────────────────────────────────────────

function toolResult(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }], isError: false };
}

function toolError(message: string) {
  return { content: [{ type: "text", text: message }], isError: true };
}
