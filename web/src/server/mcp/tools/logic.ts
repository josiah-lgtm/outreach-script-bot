// The headline tools: read and rewrite the LOGIC behind the ICP builder and the
// outreach-script maker, and preview the exact prompt a change would produce.
//
// "Logic" here is three layers, and get_logic returns all three so a model never
// has to guess which one to edit:
//
//   1. HOUSE LENS   settings.systemFilter.{lens,messaging,icpScripter,offers}
//                   Free-text knowledge injected above every AI call.
//   2. ENGINES      settings.engines.<slot>
//                   Overrides for the baked-in methodology prompts (the ICP
//                   builder's brain, the first-liner engines, the writer persona).
//                   Empty = use the shipped default. See server/prompts.ts.
//   3. STRUCTURE    settings.globalRules, frameworks[], settings.builderButtons
//                   The style rules, script templates and rewrite chips.

import {
  SLOTS, SLOT_KEYS, slotDef, loadEngineOverrides, resolveSlot, invalidateEngineCache,
} from "../../prompts";
import { readConfig, mutateConfig, findClient, findFramework, mkId, type Cfg } from "../config-io";
import { buildLensPrefix, composeLens, composeLensLite } from "../../lens";
import { buildSystemPrompt } from "../../generate";
import { buildGenerateBody, icpDossier } from "../context";
import { schema, str, bool, arr, num, argStr, argBool, argArr, argNum, required, type McpTool } from "../types";

const SF_FIELDS = ["lens", "messaging", "icpScripter", "offers"] as const;
const SF_DOC: Record<string, string> = {
  lens: "The overall house filter — read everything through this. Injected FIRST into every AI call.",
  messaging: "Voice, tone, structure and rules EVERY script must follow. Injected into script generation (lens-lite) and all other calls.",
  icpScripter: "How to find, judge and create pain points, desires and angles — for the client account, the ICP and the niche. Injected into ICP/angle/offer calls.",
  offers: "Offers, guarantees and the offer-creation framework. Injected into ICP/angle/offer calls.",
};

function areaOf(args: Record<string, unknown>): "icp" | "script" | "all" {
  const a = argStr(args, "area", "all").toLowerCase();
  return a === "icp" || a === "script" ? a : "all";
}

// ─── get_logic ───────────────────────────────────────────────────────────────

export const getLogic: McpTool = {
  name: "get_logic",
  title: "Read the ICP-builder / script-maker logic",
  description:
    "Read every editable piece of logic behind the ICP builder and the outreach-script maker: the house lens (settings.systemFilter), the engine prompt slots (the ICP builder's system prompt, the first-liner engines, the script-writer persona, …), the global style rules, and a summary of the script frameworks. Each slot reports whether it is still the shipped default or has been customised, plus where it is injected. START HERE before changing anything — the returned `slot` keys are what set_logic takes.",
  annotations: { readOnlyHint: true, idempotentHint: true },
  inputSchema: schema({
    area: str("Which surface to read: 'icp', 'script', or 'all' (default).", {
      enum: ["icp", "script", "all"],
    }),
    full: bool("Include the FULL text of every prompt slot. Default false, which truncates long slots to a 600-character preview and reports their length."),
  }),
  handler: async (args) => {
    const area = areaOf(args);
    const full = argBool(args, "full", false);
    const cfg = await readConfig();
    const settings = cfg.settings || {};
    const sf = settings.systemFilter || {};
    const overrides = await loadEngineOverrides(true);

    const clip = (s: string) =>
      full || s.length <= 600 ? s : s.slice(0, 600) + `\n… [truncated — ${s.length} chars total; call get_logic with full=true]`;

    const slots = SLOTS
      .filter((d) => area === "all" || d.area === area || d.area === "shared")
      .map((d) => {
        const effective = resolveSlot(d.key, overrides);
        const customised = Object.prototype.hasOwnProperty.call(overrides, d.key);
        return {
          slot: d.key,
          label: d.label,
          area: d.area,
          kind: d.kind,
          kindMeans:
            d.kind === "full"
              ? "Your text replaces the whole system prompt. The JSON output contract is re-appended automatically and cannot be broken."
              : d.kind === "preamble"
                ? "Your text replaces only the persona/instruction preamble. The structural remainder is assembled by code."
                : "Injected as a cached methodology block above the call (used by both the web app and this MCP server).",
          usedBy: d.usedBy,
          what: d.what,
          customised,
          chars: effective.length,
          text: clip(effective),
        };
      });

    const houseLens = SF_FIELDS.map((f) => ({
      field: `systemFilter.${f}`,
      what: SF_DOC[f],
      set: !!String(sf[f] ?? "").trim(),
      chars: String(sf[f] ?? "").length,
      text: clip(String(sf[f] ?? "")),
    }));

    return {
      area,
      configRev: cfg._rev ?? null,
      houseLens: {
        enabled: sf.enabled !== false,
        note: "Disabled (enabled=false) means NO house lens is injected anywhere — the engines still apply.",
        fields: houseLens,
      },
      engines: {
        note: "Each slot: clear it (set_logic mode='reset') to fall back to the shipped default.",
        customisedCount: Object.keys(overrides).length,
        slots,
      },
      structure:
        area === "icp"
          ? undefined
          : {
            globalRules: {
              field: "settings.globalRules",
              what: "Prepended as GLOBAL STYLE RULES inside every script-generation prompt.",
              chars: String(settings.globalRules ?? "").length,
              text: clip(String(settings.globalRules ?? "")),
            },
            frameworks: (cfg.frameworks || []).map((f: any) => ({
              id: f.id, name: f.name, category: f.category,
              templateChars: String(f.template ?? "").length,
              rules: f.rules ?? "",
            })),
            builderButtonCount: (settings.builderButtons || []).length,
          },
      nextSteps: [
        "set_logic — change a slot or a house-lens field",
        "preview_prompt — see the exact prompt a change produces, without spending tokens",
        "upsert_framework — change a script template/rules",
      ],
    };
  },
};

// ─── set_logic ───────────────────────────────────────────────────────────────

export const setLogic: McpTool = {
  name: "set_logic",
  title: "Change the ICP-builder / script-maker logic",
  description:
    "Change how the ICP builder or the script maker thinks. Targets either an engine prompt slot (target='icpBuilder', 'scriptWriter', 'icpAngles', … — see get_logic) or a house-lens field (target='systemFilter.lens' | '.messaging' | '.icpScripter' | '.offers' | 'globalRules'). Modes: 'replace' overwrites the slot, 'append' adds to the end of what is currently in force (on a slot that has never been customised, that means appending to the SHIPPED DEFAULT, not replacing it), 'reset' clears the override so the shipped default comes back. Prefer 'append' for adding a rule and 'replace' only when you intend to rewrite the whole prompt. Saves atomically to the shared config, so the web app and every teammate pick the change up immediately. Use dryRun=true first to see the before/after without writing.",
  write: true,
  annotations: { idempotentHint: true, destructiveHint: false },
  inputSchema: schema(
    {
      target: str(
        "What to change. An engine slot key (e.g. 'icpBuilder', 'icpAngles', 'scriptWriter', 'scriptFirstLiner', 'scriptRefiner', 'angleSuggester', 'offerSuggester', 'frameworkExtractor', 'followupWriter', 'mechanismBuilder', 'transcriptExtractor', 'clientBrief', 'icpExample', 'fuseAngle', 'selectionRefiner'), or a house-lens field: 'systemFilter.lens', 'systemFilter.messaging', 'systemFilter.icpScripter', 'systemFilter.offers', 'systemFilter.enabled', or 'globalRules'.",
      ),
      value: str("The new text. Required for mode 'replace' and 'append'; ignored for 'reset'. For 'systemFilter.enabled' pass 'true' or 'false'."),
      mode: str("'replace' (default), 'append', or 'reset'.", { enum: ["replace", "append", "reset"] }),
      dryRun: bool("Show what would change without saving. Default false."),
    },
    ["target"],
  ),
  handler: async (args) => {
    const target = required(args, "target");
    const mode = (argStr(args, "mode", "replace").toLowerCase() || "replace") as "replace" | "append" | "reset";
    const dryRun = argBool(args, "dryRun", false);
    const value = argStr(args, "value", "");

    if (mode !== "reset" && !value.trim() && target !== "systemFilter.enabled") {
      throw new Error(`"value" is required for mode '${mode}'. Use mode='reset' to clear a slot back to its shipped default.`);
    }

    const isSlot = SLOT_KEYS.includes(target);
    const isSf = target.startsWith("systemFilter.");
    const isGlobalRules = target === "globalRules";
    if (!isSlot && !isSf && !isGlobalRules) {
      throw new Error(
        `Unknown target "${target}". Engine slots: ${SLOT_KEYS.join(", ")}. House lens: systemFilter.lens, systemFilter.messaging, systemFilter.icpScripter, systemFilter.offers, systemFilter.enabled, globalRules.`,
      );
    }
    if (isSf) {
      const field = target.slice("systemFilter.".length);
      if (![...SF_FIELDS, "enabled"].includes(field as never)) {
        throw new Error(`Unknown systemFilter field "${field}". Allowed: ${[...SF_FIELDS, "enabled"].join(", ")}.`);
      }
    }

    const cfg = await readConfig();
    const settings = cfg.settings || {};
    const storedBefore = isSlot
      ? String((settings.engines || {})[target] ?? "")
      : isGlobalRules
        ? String(settings.globalRules ?? "")
        : String((settings.systemFilter || {})[target.slice("systemFilter.".length)] ?? "");

    // An engine slot with no override is not "empty" — it is running the shipped
    // default. Appending must therefore append TO that default, or the caller
    // would silently replace the whole ICP-builder brain with one extra line.
    const wasDefault = isSlot && !storedBefore.trim();
    const effectiveBefore = wasDefault ? (slotDef(target)?.default ?? "") : storedBefore;

    const compute = (prev: string): string => {
      if (mode === "reset") return "";
      const base = isSlot && !prev.trim() ? (slotDef(target)?.default ?? "") : prev;
      if (mode === "append") return base.trim() ? base.replace(/\s+$/, "") + "\n\n" + value : value;
      return value;
    };
    const after = compute(storedBefore);

    const clip = (s: string) => s.slice(0, 800) + (s.length > 800 ? "…" : "");
    const preview = {
      target,
      mode,
      before: {
        chars: effectiveBefore.length,
        isShippedDefault: wasDefault,
        text: clip(effectiveBefore),
      },
      after: { chars: after.length, text: clip(after) },
      ...(isSlot
        ? {
          slot: slotDef(target)?.label,
          effectAfterSave: mode === "reset"
            ? "Reverts to the shipped default."
            : `Overrides the shipped default for: ${slotDef(target)?.usedBy.join(", ")}.` +
              (wasDefault && mode === "append"
                ? " This slot had no override yet, so the shipped default was carried over and your text appended to it."
                : ""),
        }
        : {}),
    };

    if (dryRun) return { dryRun: true, saved: false, ...preview };

    const { rev } = await mutateConfig((draft: Cfg) => {
      draft.settings = draft.settings || {};
      if (isSlot) {
        draft.settings.engines = draft.settings.engines || {};
        const prev = String(draft.settings.engines[target] ?? "");
        const next = compute(prev);
        if (next) draft.settings.engines[target] = next;
        else delete draft.settings.engines[target];
      } else if (isGlobalRules) {
        draft.settings.globalRules = compute(String(draft.settings.globalRules ?? ""));
      } else {
        const field = target.slice("systemFilter.".length);
        draft.settings.systemFilter = draft.settings.systemFilter || {};
        if (field === "enabled") {
          draft.settings.systemFilter.enabled = mode === "reset" ? true : /^(true|1|yes)$/i.test(value.trim());
        } else {
          draft.settings.systemFilter[field] = compute(String(draft.settings.systemFilter[field] ?? ""));
        }
      }
    });
    invalidateEngineCache();

    return {
      saved: true,
      configRev: rev,
      ...preview,
      tip: "Run preview_prompt to see the assembled prompt this now produces, then build_icp / generate_scripts to test it live.",
    };
  },
};

// ─── preview_prompt ──────────────────────────────────────────────────────────

export const previewPrompt: McpTool = {
  name: "preview_prompt",
  title: "Preview the exact prompt an action will send",
  description:
    "Render the EXACT system + user prompt that an action would send to Claude right now, including the house lens, the engine slots and the client's own data — without calling the model or spending a token. This is the fast feedback loop for tuning logic: change a slot with set_logic, preview it here, then run it for real. Supports action='build_icp' (needs clientId) and action='generate' (needs clientId, optionally nicheId/icpId/frameworkIds/angles).",
  annotations: { readOnlyHint: true, idempotentHint: true },
  inputSchema: schema(
    {
      action: str("Which action to preview: 'build_icp' or 'generate'.", { enum: ["build_icp", "generate"] }),
      clientId: str("Client id or name — the dossier/case-study data is pulled from this client."),
      nicheId: str("generate only: niche id or name. Defaults to the client's first niche."),
      icpId: str("generate only: which saved ICP to write to."),
      frameworkIds: arr("generate only: which frameworks to preview. Defaults to the first one.", { type: "string" }),
      angles: arr("generate only: the angles to write against. Defaults to the client's top pains.", { type: "string" }),
      variantsPerAngle: num("generate only: 1-3, default 1."),
    },
    ["action", "clientId"],
  ),
  handler: async (args) => {
    const action = required(args, "action");
    const cfg = await readConfig();
    const c = findClient(cfg, required(args, "clientId"));
    if (!c) throw new Error(`No client matching "${argStr(args, "clientId")}". Use list_clients to see the ids.`);

    if (action === "build_icp") {
      const lens = await buildLensPrefix("build_icp", c.id);
      const { prompts } = await import("../../prompts");
      const P = await prompts();
      const dossier = icpDossier(cfg, c);
      return {
        action: "build_icp",
        client: { id: c.id, name: c.name },
        note: "The lens block is sent as the FIRST system block (cached); the engine prompt follows it.",
        systemBlocks: [
          { source: "house lens + icpAngles engine (server/lens.ts)", chars: lens.length, text: lens },
          { source: "engine slot: icpBuilder", chars: P.icpBuilder.length, text: P.icpBuilder },
        ],
        userMessage: `CLIENT DOSSIER:\n${dossier}`,
        totals: { systemChars: lens.length + P.icpBuilder.length, userChars: dossier.length + 17 },
      };
    }

    if (action === "generate") {
      const nicheId = argStr(args, "nicheId") || (c.nicheIds || [])[0] || null;
      const resolvedNiche = nicheId
        ? (cfg.niches || []).find((n: any) => n.id === nicheId || String(n.name).toLowerCase() === nicheId.toLowerCase())
        : null;
      const frameworkIds = argArr(args, "frameworkIds")
        .map((f) => findFramework(cfg, f)?.id)
        .filter(Boolean) as string[];
      const body = buildGenerateBody(cfg, c, {
        nicheId: resolvedNiche?.id ?? null,
        icpId: argStr(args, "icpId") || null,
        frameworkIds: frameworkIds.length ? frameworkIds : [(cfg.frameworks || [])[0]?.id].filter(Boolean),
        angles: argArr(args, "angles"),
        variantsPerAngle: argNum(args, "variantsPerAngle", 1),
      }) as any;
      const fw = body.frameworks[0];
      if (!fw) throw new Error("No frameworks configured — add one with upsert_framework first.");
      const lens = await buildLensPrefix("generate", c.id);
      const { prompts } = await import("../../prompts");
      const persona = (await prompts()).scriptWriter;
      const { shared, framework } = buildSystemPrompt(body, fw, persona);
      return {
        action: "generate",
        client: { id: c.id, name: c.name },
        niche: resolvedNiche?.name ?? "(none)",
        framework: { id: fw.id, name: fw.name },
        note: "Blocks are sent in this order. The last STABLE block carries the cache breakpoint; the per-framework block is the volatile tail.",
        systemBlocks: [
          { source: "house lens-lite + scriptFirstLiner engine (server/lens.ts)", chars: lens.length, text: lens },
          { source: "shared prefix (engine slot: scriptWriter + client/niche/ICP/emphasis)", chars: shared.length, text: shared },
          { source: "per-framework tail (volatile)", chars: framework.length, text: framework },
        ],
        userMessage: body.angles.map((a: string, i: number) => `${i + 1}. ${a}`).join("\n"),
        totals: { systemChars: lens.length + shared.length + framework.length },
      };
    }

    throw new Error(`preview_prompt supports action 'build_icp' or 'generate', got "${action}".`);
  },
};

// ─── lens debug ──────────────────────────────────────────────────────────────

export const previewLens: McpTool = {
  name: "preview_lens",
  title: "Preview the composed house lens",
  description:
    "Show the house-lens prefix exactly as it is injected for a given action, including which sections made it in and whether the 4500/8000-character caps trimmed anything. Useful when a change to settings.systemFilter does not seem to be landing.",
  annotations: { readOnlyHint: true, idempotentHint: true },
  inputSchema: schema({
    action: str("The action to compose for, e.g. 'generate', 'build_icp', 'suggest_angles'. Default 'generate'."),
    clientId: str("Optional client id — includes that client's transcripts/sources as the RESEARCH block (ICP/angle/offer actions only)."),
  }),
  handler: async (args) => {
    const action = argStr(args, "action", "generate");
    const cfg = await readConfig();
    const c = argStr(args, "clientId") ? findClient(cfg, argStr(args, "clientId")) : null;
    const sf = (cfg.settings || {}).systemFilter || {};
    const prefix = await buildLensPrefix(action, c?.id ?? null);
    return {
      action,
      client: c ? { id: c.id, name: c.name } : null,
      enabled: sf.enabled !== false,
      composed: {
        chars: prefix.length,
        trimmed: prefix.endsWith("…(filter trimmed to fit)") || prefix.endsWith("\n…"),
        text: prefix,
      },
      variants: {
        full: { chars: composeLens(sf).length, note: "used by every action except generate" },
        lite: { chars: composeLensLite(sf).length, note: "used by generate; capped at 4500 chars" },
      },
    };
  },
};

// ─── frameworks ──────────────────────────────────────────────────────────────

export const listFrameworks: McpTool = {
  name: "list_frameworks",
  title: "List script frameworks",
  description:
    "List the script frameworks (the templates + rules the generator writes against). Each framework is one Claude call per generation run, so which ones are selected directly shapes the output. Pass frameworkId to get one in full.",
  annotations: { readOnlyHint: true, idempotentHint: true },
  inputSchema: schema({
    frameworkId: str("Optional id or name — returns that framework's full template and rules."),
  }),
  handler: async (args) => {
    const cfg = await readConfig();
    const one = argStr(args, "frameworkId");
    if (one) {
      const f = findFramework(cfg, one);
      if (!f) throw new Error(`No framework matching "${one}".`);
      return f;
    }
    return {
      count: (cfg.frameworks || []).length,
      frameworks: (cfg.frameworks || []).map((f: any) => ({
        id: f.id, name: f.name, category: f.category,
        nicheIds: f.nicheIds || [],
        rules: f.rules ?? "",
        template: f.template ?? "",
      })),
    };
  },
};

export const upsertFramework: McpTool = {
  name: "upsert_framework",
  title: "Create, edit or delete a script framework",
  description:
    "Create a new script framework or edit an existing one — this is how you change the SHAPE of the scripts the generator writes. `template` uses {{snake_case}} variables the model fills; `rules` states length, tone, rhythm and what each part must do. Pass frameworkId to edit, omit it to create. Pass remove=true to delete.",
  write: true,
  annotations: { idempotentHint: true, destructiveHint: true },
  inputSchema: schema({
    frameworkId: str("Existing framework id or name. Omit to create a new one."),
    name: str("Short memorable name, e.g. 'Proof Bridge'."),
    category: str("What it is: 'Proof-led', 'Pain-led', 'Curiosity-led', 'Ultra-short', …"),
    template: str("The structure, with {{variable}} placeholders the model fills. Newlines are structural."),
    rules: str("The rules that make it win: word counts, tone, what each part must do."),
    nicheIds: arr("Restrict this framework to specific niches. Empty = available everywhere.", { type: "string" }),
    remove: bool("Delete this framework instead of upserting it."),
  }),
  handler: async (args) => {
    const id = argStr(args, "frameworkId");
    const remove = argBool(args, "remove", false);

    if (remove) {
      if (!id) throw new Error('"frameworkId" is required when remove=true.');
      const cfg = await readConfig();
      const existing = findFramework(cfg, id);
      if (!existing) throw new Error(`No framework matching "${id}".`);
      const { rev } = await mutateConfig((draft: Cfg) => {
        draft.frameworks = (draft.frameworks || []).filter((f: any) => f.id !== existing.id);
      });
      return { deleted: true, id: existing.id, name: existing.name, configRev: rev };
    }

    const cfg = await readConfig();
    const existing = id ? findFramework(cfg, id) : null;
    if (id && !existing) throw new Error(`No framework matching "${id}". Omit frameworkId to create a new one.`);
    if (!existing && !argStr(args, "name").trim()) throw new Error('"name" is required when creating a framework.');
    if (!existing && !argStr(args, "template").trim()) throw new Error('"template" is required when creating a framework.');

    const targetId = existing?.id ?? mkId("fw", argStr(args, "name"));
    const { rev, result } = await mutateConfig((draft: Cfg) => {
      draft.frameworks = draft.frameworks || [];
      let f = draft.frameworks.find((x: any) => x.id === targetId);
      if (!f) { f = { id: targetId, nicheIds: [] }; draft.frameworks.push(f); }
      for (const k of ["name", "category", "template", "rules"] as const) {
        const v = argStr(args, k);
        if (v) f[k] = v;
      }
      if (Array.isArray(args.nicheIds)) f.nicheIds = argArr(args, "nicheIds");
      f.nicheIds = f.nicheIds || [];
      return { ...f };
    });
    return { saved: true, created: !existing, configRev: rev, framework: result };
  },
};

// ─── builder buttons (the rewrite chips) ─────────────────────────────────────

export const listBuilderButtons: McpTool = {
  name: "list_builder_buttons",
  title: "List the script rewrite chips",
  description:
    "List the one-click rewrite chips shown under a script in the editor and the swipe deck (Shorten, Simpler, Conversational, …). Each chip's `prompt` is the instruction sent to the refiner, so editing them changes how one-click rewrites behave.",
  annotations: { readOnlyHint: true, idempotentHint: true },
  inputSchema: schema({}),
  handler: async () => {
    const cfg = await readConfig();
    const stored = (cfg.settings || {}).builderButtons;
    const usingDefaults = !Array.isArray(stored) || !stored.length;
    const { defaultBuilderButtons } = await import("@/lib/sync/configClient");
    return {
      usingDefaults,
      note: usingDefaults
        ? "No custom chips saved — the shipped defaults are in use. Editing any chip persists the whole set."
        : "Custom chips in use.",
      buttons: usingDefaults ? defaultBuilderButtons() : stored,
    };
  },
};

export const upsertBuilderButton: McpTool = {
  name: "upsert_builder_button",
  title: "Create, edit or delete a rewrite chip",
  description:
    "Create or edit a one-click rewrite chip, or delete one with remove=true. `prompt` is the instruction handed to the refiner. `keepStructure=true` tells it to preserve the script's shape and only change wording.",
  write: true,
  annotations: { idempotentHint: true, destructiveHint: true },
  inputSchema: schema({
    buttonId: str("Existing chip id (e.g. 'shorten'). Omit to create a new one."),
    label: str("Button label shown in the UI."),
    prompt: str("The rewrite instruction sent to the model."),
    icon: str("Tabler icon name, e.g. 'ti-feather'. Unknown names render as a dot."),
    keepStructure: bool("Preserve the script's structure and only change wording."),
    enabled: bool("Show this chip in the UI."),
    examples: str("Optional few-shot examples appended to the instruction."),
    remove: bool("Delete this chip."),
  }),
  handler: async (args) => {
    const id = argStr(args, "buttonId");
    const remove = argBool(args, "remove", false);
    const { defaultBuilderButtons } = await import("@/lib/sync/configClient");

    const { rev, result } = await mutateConfig((draft: Cfg) => {
      draft.settings = draft.settings || {};
      // First edit materialises the shipped defaults so the saved set is complete.
      if (!Array.isArray(draft.settings.builderButtons) || !draft.settings.builderButtons.length) {
        draft.settings.builderButtons = defaultBuilderButtons();
      }
      const list: any[] = draft.settings.builderButtons;

      if (remove) {
        if (!id) throw new Error('"buttonId" is required when remove=true.');
        const before = list.length;
        draft.settings.builderButtons = list.filter((b) => b.id !== id);
        if (draft.settings.builderButtons.length === before) throw new Error(`No chip with id "${id}".`);
        return { deleted: id };
      }

      const targetId = id || mkId("btn", argStr(args, "label"));
      let b = list.find((x) => x.id === targetId);
      const created = !b;
      if (!b) {
        if (!argStr(args, "label").trim() || !argStr(args, "prompt").trim()) {
          throw new Error('"label" and "prompt" are required when creating a chip.');
        }
        b = { id: targetId, icon: "ti-wand", keepStructure: true, enabled: true, examples: "" };
        list.push(b);
      }
      for (const k of ["label", "prompt", "icon", "examples"] as const) {
        const v = argStr(args, k);
        if (v) b[k] = v;
      }
      if ("keepStructure" in args) b.keepStructure = argBool(args, "keepStructure", true);
      if ("enabled" in args) b.enabled = argBool(args, "enabled", true);
      return { created, button: { ...b } };
    });
    return { saved: true, configRev: rev, ...(result as object) };
  },
};

export const LOGIC_TOOLS: McpTool[] = [
  getLogic,
  setLogic,
  previewPrompt,
  previewLens,
  listFrameworks,
  upsertFramework,
  listBuilderButtons,
  upsertBuilderButton,
];
