// The tool registry. Order matters: hosts show tools in this order, so the
// orientation tools come first, then the logic editors (the point of this server),
// then the ICP and script runtimes, then the power tools.

import type { McpTool } from "../types";
import { CORE_TOOLS } from "./core";
import { LOGIC_TOOLS } from "./logic";
import { ICP_TOOLS } from "./icp";
import { SCRIPT_TOOLS } from "./scripts";

const ORDER = [
  "whoami",
  "get_logic", "set_logic", "preview_prompt", "preview_lens",
  "list_clients", "get_client", "upsert_client",
  "build_icp", "list_icps", "upsert_icp", "find_icp_example",
  "generate_scripts", "list_scripts", "upsert_script", "refine_script",
  "list_frameworks", "upsert_framework", "extract_framework",
  "list_builder_buttons", "upsert_builder_button",
  "suggest_angles", "suggest_offers", "generate_followups",
  "list_niches", "upsert_niche",
  "research", "extract_transcript",
  "search", "fetch",
  "usage_report", "get_config", "patch_config",
];

const ALL: McpTool[] = [...CORE_TOOLS, ...LOGIC_TOOLS, ...ICP_TOOLS, ...SCRIPT_TOOLS];

export const TOOLS: McpTool[] = [...ALL].sort((a, b) => {
  const ia = ORDER.indexOf(a.name);
  const ib = ORDER.indexOf(b.name);
  return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
});

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): McpTool | undefined {
  return BY_NAME.get(name);
}

// Fail fast at import time on a duplicate name — two tools with the same name
// would silently shadow each other in the map above.
if (BY_NAME.size !== TOOLS.length) {
  const seen = new Set<string>();
  const dupes = TOOLS.map((t) => t.name).filter((n) => (seen.has(n) ? true : (seen.add(n), false)));
  throw new Error(`Duplicate MCP tool name(s): ${dupes.join(", ")}`);
}
