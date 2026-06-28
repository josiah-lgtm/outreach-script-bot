// Create-script wizard — the modal state machine. Faithful port of legacy v9Wizard
// (index.html:7420) and its ~40 osWiz* handlers (7475-7664): a flow menu, the 6-step
// "new scripts" builder (ICP → pain → desire → mechanism → proof → framework), the
// generating screen, and the swipe deck. Also the "From a script" variation flow and the
// "Find angles" flow. Launched from the board's "Create new script" button.
//
// The legacy `V9.wiz` global is replaced by local React state (immer `produce`); every
// PERSISTED change routes through the actions in lib/sync/wizard.ts → the config store.

"use client";

import { useState } from "react";
import { produce } from "immer";
import { Modal, Button, Icon, cn } from "@/components/ui";
import { ScriptEditModal } from "@/components/ScriptEditModal";
import { useConfigStore } from "@/lib/store/configStore";
import { getAdminKey } from "@/lib/sync/adminKey";
import { notify } from "@/lib/notify";
import type { Client, Niche, Config, Framework } from "@/lib/sync/types";
import {
  type WizState,
  type WizFlow,
  type DeckCard,
  type Mechanism,
  type Group,
  primaryNicheId,
  nichePains,
  nicheDesires,
  nicheOffers,
  clientCaseStudies,
  dedupeStr,
  builderButtonsOf,
  wizCount,
  addPain,
  addDesire,
  aiMorePains,
  aiMoreOffers,
  categorize,
  moreInTopic,
  buildMechanism,
  pickMechanism,
  saveMechanismSummary,
  runFilterStep,
  commitWizardSelections,
  generateDeck,
  variateScript,
  suggestAngles,
  addAngleToNiche,
  keepCard,
  keepCards,
} from "@/lib/sync/wizard";
import { StepBar, WizMenu, GroupedPicker, PickRow, AddRow, MechanismCards } from "./parts";
import { SwipeDeck } from "./SwipeDeck";

const PAIN_LIMIT_NOTE = "Pick up to 3 pain points";

function initWiz(c: Client | undefined, config: Config): WizState {
  const icps = (c?.icps as Array<{ id: string }>) || [];
  return {
    menu: true,
    flow: null,
    step: 1,
    icpId: (icps[0] && icps[0].id) || null,
    niche: primaryNicheId(c) || ((c?.nicheIds as string[]) || [])[0] || (config.niches?.[0]?.id ?? null),
    angles: [],
    desires: [],
    offers: [],
    guarantees: [],
    caseStudies: [],
    fws: {},
    variants: 1,
    useP: true,
    useD: true,
    useM: true,
    openGroups: {},
    customPains: [],
    aiPains: [],
    customDesires: [],
    customOffers: [],
    aiOffers: [],
    foundAngles: [],
    transNote: "",
    deck: [],
    i: 0,
    kept: 0,
    keptIds: [],
    phase: "steps",
    generating: false,
    genError: "",
    dedupNote: "",
    editing: false,
    busy: false,
    mechError: "",
  };
}

export function CreateScriptWizard({
  open,
  onClose,
  clientId,
  onStartFollowups,
}: {
  open: boolean;
  onClose: () => void;
  clientId: string;
  /** The "Follow-up sequence" flow closes the wizard and hands the chosen parent up to the board's FollowupBuilder. */
  onStartFollowups?: (parent: { parentLabel: string; parentText: string }) => void;
}) {
  const client = useConfigStore((s) => (s.config.clients || []).find((c: Client) => c.id === clientId)) as Client | undefined;
  const config = useConfigStore((s) => s.config) as Config;
  const niches = (config.niches as Niche[]) || [];
  const frameworks = (config.frameworks as Framework[]) || [];
  const builderButtons = builderButtonsOf();

  // Fresh wizard state per open — the parent mounts this only while `open` (so the useState
  // initializer reseeds each time), avoiding a reset effect.
  const [w, setW] = useState<WizState>(() => initWiz(client, config));
  const [editOpen, setEditOpen] = useState(false);

  const patch = (fn: (d: WizState) => void) => setW((prev) => produce(prev, fn));

  if (!client) return null;

  const ic = ((client.icps as Array<{ id: string }>) || []).find((x) => x.id === w.icpId) as
    | Record<string, unknown>
    | undefined;
  const target = (ic || client) as Record<string, unknown>;

  // ── Step 1: group / ICP pick ──
  function pickGroup(id: string) {
    const pains = nichePains(client, id);
    const des = nicheDesires(client, id);
    const offs = nicheOffers(client, id);
    patch((d) => {
      d.niche = id;
      d.angles = pains.slice(0, 3);
      d.desires = dedupeStr([...des, ...offs]).slice(0, 3);
    });
    const nm = (niches.find((n) => n.id === id) || {}).name || "Group";
    const miss: string[] = [];
    if (!pains.length) miss.push("pain points");
    if (!des.length && !offs.length) miss.push("desired outcomes / offers");
    const hasMech = !!(client!.caseStudy?.mechanism) || ((client!.mechanisms as unknown[]) || []).length > 0;
    if (!hasMech) miss.push("a mechanism");
    if (miss.length) notify(`"${nm}" still needs ${miss.join(", ")} — the next steps will help you add them.`);
    else notify(`Loaded "${nm}" — pains, outcomes & mechanism are ready.`);
  }

  function selectIcp(id: string) {
    patch((d) => {
      d.icpId = d.icpId === id ? null : id;
      if (d.icpId) {
        const icp = ((client!.icps as Array<Record<string, unknown>>) || []).find((x) => x.id === id);
        if (icp && icp.niche) {
          const match =
            niches.find((n) => ((client!.nicheIds as string[]) || []).indexOf(n.id) > -1 && n.name.toLowerCase() === String(icp.niche).toLowerCase()) ||
            niches.find((n) => n.name.toLowerCase() === String(icp.niche).toLowerCase());
          if (match) d.niche = match.id;
        }
      }
    });
  }

  function toggleAngle(a: string) {
    patch((d) => {
      const i = d.angles.indexOf(a);
      if (i > -1) d.angles.splice(i, 1);
      else {
        if (d.angles.length >= 3) {
          notify(PAIN_LIMIT_NOTE, true);
          return;
        }
        d.angles.push(a);
      }
    });
  }
  function toggleDesire(o: string) {
    patch((d) => {
      const i = d.desires.indexOf(o);
      if (i > -1) d.desires.splice(i, 1);
      else d.desires.push(o);
    });
  }
  const toggleGroup = (id: string) => patch((d) => { d.openGroups[id] = !d.openGroups[id]; });

  // ── AI helpers (busy-guarded) ──
  async function runBusy(fn: () => Promise<void>) {
    patch((d) => { d.busy = true; });
    try {
      await fn();
    } catch {
      notify("AI failed", true);
    }
    patch((d) => { d.busy = false; });
  }

  const onMorePains = () =>
    runBusy(async () => {
      const got = await aiMorePains(clientId, w);
      patch((d) => { d.aiPains = [...d.aiPains, ...got]; });
    });
  const onMoreOffers = () =>
    runBusy(async () => {
      const got = await aiMoreOffers(clientId, w);
      patch((d) => { d.aiOffers = [...d.aiOffers, ...got]; });
    });
  const onCategorize = (kind: "pain" | "outcome") =>
    runBusy(async () => {
      const gs = await categorize(clientId, w, kind);
      if (gs) {
        patch((d) => {
          const og: Record<string, boolean> = {};
          gs.forEach((g) => (og[g.id] = true));
          d.openGroups = og;
        });
        notify(`Grouped into ${gs.length} themes`);
      } else notify("Could not categorize — try again", true);
    });
  const onMoreInTopic = (kind: "pain" | "outcome", gid: string) =>
    runBusy(async () => {
      const n = await moreInTopic(clientId, w, kind, gid);
      patch((d) => { d.openGroups[gid] = true; });
      if (n) notify(`Added ${n} to the theme`);
    });

  const onFilterStep = (kind: string) =>
    runBusy(async () => {
      const s = await runFilterStep(clientId, w, kind);
      if (s.error === "admin") return notify("Admin key required to run the filter", true);
      if (s.error === "lens") return notify("Turn the system filter on (Admin → System Filter) first", true);
      if (s.error === "empty") return notify("Nothing to filter on this step yet", true);
      if (s.changed) notify(`Filtered ${s.changed} of ${s.total} through your lens${s.failed ? ` · ${s.failed} couldn’t be reached` : s.unchanged ? ` · ${s.unchanged} came back unchanged` : ""}`);
      else if (s.failed) notify("Filter couldn’t reach the rewriter — check your connection / admin key and try again.", true);
      else notify("Filter ran but the lens returned everything unchanged — sharpen the lens text, then try again", true);
    });

  const onBuildMechanism = () => {
    if (!getAdminKey()) {
      patch((d) => { d.mechError = "No admin key — open the app with your admin key to use AI."; });
      return;
    }
    runBusy(async () => {
      patch((d) => { d.mechError = ""; });
      const res = await buildMechanism(clientId, w.angles, w.desires);
      if (res.mechs.length) notify(`Built ${res.mechs.length} mechanism${res.mechs.length > 1 ? "s" : ""}`);
      else patch((d) => { d.mechError = "The AI replied but no mechanisms could be read. First 240 chars:\n\n" + (res.raw || "(empty reply)").slice(0, 240); });
    });
  };

  // ── Step nav ──
  function next() {
    if (w.step === 1 && !w.niche && !w.icpId) return;
    if (w.step === 2 && !w.angles.length) return;
    patch((d) => { d.step++; });
  }
  const back = () => patch((d) => { d.step--; });

  // ── Generate ──
  async function gen() {
    const fwCount = Object.keys(w.fws).filter((k) => w.fws[k]).length;
    if (!fwCount) {
      notify("Pick at least one framework", true);
      return;
    }
    commitWizardSelections(clientId, w);
    patch((d) => { d.generating = true; d.genError = ""; });
    const { deck, genError, dedupNote } = await generateDeck(clientId, w);
    patch((d) => {
      d.deck = deck;
      d.i = 0;
      d.kept = 0;
      d.keptIds = [];
      d.generating = false;
      d.phase = "swipe";
      d.genError = genError;
      d.dedupNote = dedupNote;
    });
  }

  // ── "From a script" variation ──
  async function variate(baseText: string, fw: string, angle: string) {
    if (!String(baseText || "").trim()) {
      notify("Paste a script first", true);
      return;
    }
    patch((d) => { d.busy = true; d.generating = true; d.phase = "steps"; });
    const deck = await variateScript(baseText, fw, angle);
    patch((d) => {
      d.deck = deck;
      d.i = 0;
      d.kept = 0;
      d.keptIds = [];
      d.busy = false;
      d.generating = false;
      d.phase = "swipe";
    });
  }

  // ── Swipe deck operations ──
  const curCard = w.deck[w.i];
  const curText = curCard ? curCard.text : "";

  function swSet(t: string) {
    patch((d) => {
      const card = d.deck[d.i];
      if (!card) return;
      if (!card._hist) {
        card._hist = [card.text];
        card._hi = 0;
      }
      card._hist = card._hist.slice(0, (card._hi ?? 0) + 1);
      card._hist.push(t);
      card._hi = card._hist.length - 1;
      card.text = t;
    });
  }
  const onUndo = () =>
    patch((d) => {
      const card = d.deck[d.i];
      if (card && card._hist && (card._hi ?? 0) > 0) {
        card._hi = (card._hi ?? 0) - 1;
        card.text = card._hist[card._hi];
      }
    });
  const onRedo = () =>
    patch((d) => {
      const card = d.deck[d.i];
      if (card && card._hist && (card._hi ?? 0) < card._hist.length - 1) {
        card._hi = (card._hi ?? 0) + 1;
        card.text = card._hist[card._hi];
      }
    });
  function onCleanup() {
    if (!curText) return;
    const out = curText
      .replace(/\s*[—–]\s*/g, ", ")
      .replace(/\s+-\s+/g, " ")
      .replace(/ ,/g, ",")
      .replace(/,\s*,/g, ", ")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
    swSet(out);
    notify("Dashes cleaned up");
  }

  const STRUCT =
    " Keep the SAME framework, structure and roughly the same length (within ~15% of the original character count). Keep the same offer/pain/desire/mechanism context, the same ask, and every {{merge_tag}}. Only change the style described — do not regenerate a different script. Return only the rewritten script.";

  async function swRefine(prompt: string, model?: string) {
    if (!curText) return;
    await runBusy(async () => {
      const { api } = await import("@/lib/sync/api");
      const { notifyFiltered } = await import("@/lib/sync/lens");
      const r = await api({ action: "refine_script", script: curText, prompt, model: model || config.settings?.builderModel || "sonnet" });
      const out = String((r && (r.script || r.text || r.result || r.content)) || "").replace(/\n*\(mock refinement applied\)\s*$/, "").trim();
      if (out) swSet(out);
      notifyFiltered();
    });
  }
  function onTx(id: string) {
    const b = builderButtons.find((x) => x.id === id);
    if (!b) return notify("Button not found", true);
    let p = String(b.prompt || "").trim();
    if (!p) return notify("This button has no prompt yet", true);
    if (b.examples && String(b.examples).trim()) p += "\n\nMatch the STYLE of these examples (not the literal words):\n" + String(b.examples).trim();
    swRefine(p + (b.keepStructure === false ? " Return only the rewritten script." : STRUCT), b.model || config.settings?.builderModel || "sonnet");
  }
  async function onMoreVariants(n: number) {
    if (!curCard || !curText) return;
    n = Math.max(1, Math.min(n || 1, 5));
    await runBusy(async () => {
      const { api } = await import("@/lib/sync/api");
      const { notifyFiltered } = await import("@/lib/sync/lens");
      const made: DeckCard[] = [];
      for (let k = 0; k < n; k++) {
        try {
          const r = await api({ action: "refine_script", script: curText, prompt: "Rewrite as a fresh variation — same offer and angle, different wording and structure. Keep every {{merge_tag}}. Return only the script." });
          const t = String((r && (r.script || r.text || r.result || r.content)) || "").replace(/\n*\(mock refinement applied\)\s*$/, "").trim();
          if (t) made.push({ text: t, fw: curCard.fw || "Variation", angle: curCard.angle || "" });
        } catch {
          /* skip one failed variant */
        }
      }
      if (made.length) patch((d) => { d.deck.splice(d.i + 1, 0, ...made); });
      notifyFiltered();
      notify(`Added ${made.length} variant${made.length === 1 ? "" : "s"} to review next`);
    });
  }
  function onSwipe(keep: boolean) {
    if (keep && curCard) {
      const id = keepCard(clientId, curCard);
      patch((d) => { d.keptIds.push(id); d.kept += 1; d.i += 1; d.editing = false; });
    } else {
      patch((d) => { d.i += 1; d.editing = false; });
    }
  }
  function onKeepAll() {
    const rest = w.deck.slice(w.i);
    if (!rest.length) return;
    const ids = keepCards(clientId, rest);
    patch((d) => { d.keptIds.push(...ids); d.kept += rest.length; d.i = d.deck.length; });
    notify(`${w.kept + rest.length} scripts saved to the board`);
  }
  const onBackToFw = () => patch((d) => { d.phase = "steps"; d.step = 6; d.genError = ""; });

  // ── Header title per screen ──
  const title = w.phase === "swipe"
    ? "Review scripts"
    : w.generating
      ? "Generating…"
      : w.menu
        ? "Create"
        : w.flow === "new"
          ? "Create new scripts"
          : w.flow === "angles"
            ? "Find angles"
            : w.flow === "winning"
              ? "From a script"
              : "Follow-up sequence";

  // ── Footer (only the 6-step builder gets a sticky nav) ──
  const showStepFooter = w.flow === "new" && !w.menu && !w.generating && w.phase === "steps";
  const fwCount = Object.keys(w.fws).filter((k) => w.fws[k]).length;
  const footer = showStepFooter ? (
    <>
      {w.step === 1 ? (
        <Button variant="ghost" size="sm" onClick={() => patch((d) => { d.menu = true; d.flow = null; })}>
          Back
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={back}>
          Back
        </Button>
      )}
      <div className="ml-auto" />
      {w.step < 6 ? (
        <Button variant="primary" size="sm" disabled={(w.step === 1 && !w.niche && !w.icpId) || (w.step === 2 && !w.angles.length)} onClick={next}>
          Next →
        </Button>
      ) : (
        <Button variant="primary" size="sm" icon="sparkles" disabled={!fwCount} onClick={gen}>
          Generate {fwCount * Math.max(1, w.angles.length) * w.variants || 0}
        </Button>
      )}
    </>
  ) : undefined;

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg" footer={footer} dismissible={!editOpen}>
      {w.menu ? (
        <WizMenu onPick={(flow) => patch((d) => { d.menu = false; d.flow = flow as WizFlow; d.step = 1; })} />
      ) : w.generating ? (
        <GeneratingScreen w={w} client={client} />
      ) : w.phase === "swipe" ? (
        <SwipeDeck
          deck={w.deck}
          i={w.i}
          kept={w.kept}
          busy={w.busy}
          dedupNote={w.dedupNote}
          genError={w.genError}
          builderButtons={builderButtons}
          currentText={curText}
          canUndo={!!(curCard && curCard._hist && (curCard._hi ?? 0) > 0)}
          canRedo={!!(curCard && curCard._hist && (curCard._hi ?? 0) < curCard._hist.length - 1)}
          onSwipe={onSwipe}
          onUndo={onUndo}
          onRedo={onRedo}
          onCleanup={onCleanup}
          onTx={onTx}
          onMoreVariants={onMoreVariants}
          onEdit={() => setEditOpen(true)}
          onKeepAll={onKeepAll}
          onBackToFw={onBackToFw}
          onClose={onClose}
        />
      ) : w.flow === "new" ? (
        <div>
          <StepBar step={w.step} />
          <div className="rounded-xl border border-border bg-bg p-3.5">
            <StepBody
              w={w}
              client={client}
              niches={niches}
              frameworks={frameworks}
              ic={ic}
              target={target}
              onPickGroup={pickGroup}
              onSelectIcp={selectIcp}
              onToggleAngle={toggleAngle}
              onToggleDesire={toggleDesire}
              onToggleGroup={toggleGroup}
              onMorePains={onMorePains}
              onMoreOffers={onMoreOffers}
              onCategorize={onCategorize}
              onMoreInTopic={onMoreInTopic}
              onFilterStep={onFilterStep}
              onAddPain={(v) => { addPain(clientId, w, v); patch((d) => { if (d.angles.length < 3 && d.angles.indexOf(v) < 0) d.angles.push(v); }); }}
              onAddDesire={(v) => { addDesire(clientId, w, v); patch((d) => { if (d.desires.indexOf(v) < 0) d.desires.push(v); }); }}
              onBuildMechanism={onBuildMechanism}
              onPickMechanism={(id) => { const nm = pickMechanism(clientId, id); notify(`✓ Using "${nm}" in your scripts`); }}
              onSaveMech={(t) => { saveMechanismSummary(clientId, t); notify("Mechanism saved"); }}
              onToggleGuarantee={(g) => patch((d) => { const i = d.guarantees.indexOf(g); if (i > -1) d.guarantees.splice(i, 1); else d.guarantees.push(g); })}
              onToggleCase={(c) => patch((d) => { const i = d.caseStudies.indexOf(c); if (i > -1) d.caseStudies.splice(i, 1); else d.caseStudies.push(c); })}
              onToggleFw={(id) => patch((d) => { d.fws[id] = !d.fws[id]; })}
              onToggleDim={(dim) => patch((d) => { const k = ("use" + dim) as "useP" | "useD" | "useM"; d[k] = d[k] === false; })}
              onSetVariants={(v) => patch((d) => { d.variants = v; })}
            />
          </div>
        </div>
      ) : w.flow === "winning" ? (
        <FromScriptScreen client={client} busy={w.busy} onVariate={variate} />
      ) : w.flow === "angles" ? (
        <AnglesScreen
          w={w}
          client={client}
          niches={niches}
          onSetNiche={(id) => patch((d) => { d.niche = id; d.foundAngles = []; })}
          onFind={(prompt) =>
            runBusy(async () => {
              const got = await suggestAngles(clientId, w.niche, prompt);
              patch((d) => { d.foundAngles = got; });
            })
          }
          onAdd={(a) => { addAngleToNiche(w.niche, a); patch((d) => { d.foundAngles = d.foundAngles.filter((x) => x !== a); }); notify("Angle added to niche"); }}
        />
      ) : (
        <FollowupFlow
          client={client}
          onBack={() => patch((d) => { d.menu = true; d.flow = null; })}
          onStart={(parent) => { onClose(); onStartFollowups?.(parent); }}
        />
      )}

      {editOpen && curCard && (
        <ScriptEditModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          title={curCard.fw || "Script"}
          sub={curCard.angle || ""}
          initialText={curText}
          applyLabel="Save"
          onApply={(text) => { swSet(text); setEditOpen(false); }}
        />
      )}
    </Modal>
  );
}

// ─── Step bodies ─────────────────────────────────────────────────────────────
interface StepBodyProps {
  w: WizState;
  client: Client;
  niches: Niche[];
  frameworks: Framework[];
  ic?: Record<string, unknown>;
  target: Record<string, unknown>;
  onPickGroup: (id: string) => void;
  onSelectIcp: (id: string) => void;
  onToggleAngle: (a: string) => void;
  onToggleDesire: (o: string) => void;
  onToggleGroup: (id: string) => void;
  onMorePains: () => void;
  onMoreOffers: () => void;
  onCategorize: (kind: "pain" | "outcome") => void;
  onMoreInTopic: (kind: "pain" | "outcome", gid: string) => void;
  onFilterStep: (kind: string) => void;
  onAddPain: (v: string) => void;
  onAddDesire: (v: string) => void;
  onBuildMechanism: () => void;
  onPickMechanism: (id: string) => void;
  onSaveMech: (t: string) => void;
  onToggleGuarantee: (g: string) => void;
  onToggleCase: (c: string) => void;
  onToggleFw: (id: string) => void;
  onToggleDim: (dim: "P" | "D" | "M") => void;
  onSetVariants: (v: number) => void;
}

function StepBody(p: StepBodyProps) {
  const { w, client, niches } = p;

  if (w.step === 1) {
    const groupIds = ((client.nicheIds as string[]) || []).filter((id) => niches.find((n) => n.id === id));
    const hasMech = !!(client.caseStudy?.mechanism) || ((client.mechanisms as unknown[]) || []).length > 0;
    const icps = (client.icps as Array<{ id: string; title?: string }>) || [];
    return (
      <div>
        <div className="text-[13px] font-semibold mb-1">Pick a Group</div>
        <div className="text-[12px] text-muted mb-3">
          A group bundles a niche’s pain points, desired outcomes, offers & mechanism. Selecting one loads them all into the next steps.
        </div>
        {groupIds.length ? (
          <div className="flex flex-col gap-2">
            {groupIds.map((id) => {
              const nm = (niches.find((n) => n.id === id) || {}).name || id;
              const np = nichePains(client, id).length;
              const nd = nicheDesires(client, id).length;
              const no = nicheOffers(client, id).length;
              const complete = np && (nd || no) && hasMech;
              const on = w.niche === id;
              return (
                <PickRow key={id} selected={on} onClick={() => p.onPickGroup(id)}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{nm}</span>
                    <span className={cn("text-[11px]", complete ? "text-green" : "text-amber")}>{complete ? "✓ ready" : "needs setup"}</span>
                  </div>
                  <div className="text-[11px] text-muted mt-1">
                    {np} pains · {nd + no} outcomes/offers · {hasMech ? "mechanism ✓" : "no mechanism"}
                  </div>
                </PickRow>
              );
            })}
          </div>
        ) : (
          <div className="text-[12px] text-muted">No groups yet — add a niche to this client first.</div>
        )}
        {icps.length > 0 && (
          <>
            <div className="text-[12px] text-muted mt-4 mb-1.5">Optional — narrow to one ICP inside this group</div>
            <div className="flex flex-wrap gap-1.5">
              {icps.map((icp) => (
                <ChipBtn key={icp.id} on={w.icpId === icp.id} onClick={() => p.onSelectIcp(icp.id)}>
                  {icp.title || "ICP"}
                </ChipBtn>
              ))}
            </div>
          </>
        )}
        {w.icpId && (
          <div className="mt-3.5">
            <Button variant="secondary" size="sm" icon="filter" disabled={w.busy} onClick={() => p.onFilterStep("icp")}>
              {w.busy ? "Filtering…" : "Filter this ICP’s data through the lens"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (w.step === 2) {
    const items = dedupeStr([...nichePains(client, w.niche), ...((p.ic?.pains as string[]) || []), ...w.customPains, ...w.aiPains]);
    const grouped = !!((p.target.painGroups as Group[]) && (p.target.painGroups as Group[]).length);
    return (
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-[12px] text-muted">Pick up to 3 pain points {w.angles.length ? `(${w.angles.length}/3)` : ""}</div>
          <div className="flex gap-1.5">
            {items.length > 0 && (
              <Button variant="secondary" size="sm" icon="layout-grid" disabled={w.busy} onClick={() => p.onCategorize("pain")}>
                {grouped ? "Re-group" : "Group (AI)"}
              </Button>
            )}
            <Button variant="secondary" size="sm" icon="sparkles" disabled={w.busy} onClick={p.onMorePains}>
              AI ideas
            </Button>
            <Button variant="secondary" size="sm" icon="filter" disabled={w.busy} onClick={() => p.onFilterStep("pain")}>
              Filter all
            </Button>
          </div>
        </div>
        <GroupedPicker
          items={items}
          groups={p.target.painGroups as Group[]}
          selected={w.angles}
          onToggle={p.onToggleAngle}
          openGroups={w.openGroups}
          onToggleGroup={p.onToggleGroup}
          onMore={(gid) => p.onMoreInTopic("pain", gid)}
          busy={w.busy}
        />
        <AddRow placeholder="Add your own pain point…" onAdd={p.onAddPain} busy={w.busy} />
      </div>
    );
  }

  if (w.step === 3) {
    const items = dedupeStr([
      ...nicheDesires(client, w.niche),
      ...((p.ic?.desires as string[]) || []),
      ...nicheOffers(client, w.niche),
      ...w.customDesires,
      ...w.aiOffers,
    ]);
    const grouped = !!((p.target.desireGroups as Group[]) && (p.target.desireGroups as Group[]).length);
    return (
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-[12px] text-muted">Desired outcomes — what they want + the offers that get them there</div>
          <div className="flex gap-1.5">
            {items.length > 0 && (
              <Button variant="secondary" size="sm" icon="layout-grid" disabled={w.busy} onClick={() => p.onCategorize("outcome")}>
                {grouped ? "Re-group" : "Group (AI)"}
              </Button>
            )}
            <Button variant="secondary" size="sm" icon="sparkles" disabled={w.busy} onClick={p.onMoreOffers}>
              AI ideas
            </Button>
            <Button variant="secondary" size="sm" icon="filter" disabled={w.busy} onClick={() => p.onFilterStep("outcome")}>
              Filter
            </Button>
          </div>
        </div>
        <GroupedPicker
          items={items}
          groups={p.target.desireGroups as Group[]}
          selected={w.desires}
          onToggle={p.onToggleDesire}
          openGroups={w.openGroups}
          onToggleGroup={p.onToggleGroup}
          onMore={(gid) => p.onMoreInTopic("outcome", gid)}
          busy={w.busy}
        />
        <AddRow placeholder="Add a desired outcome / offer…" onAdd={p.onAddDesire} busy={w.busy} />
      </div>
    );
  }

  if (w.step === 4) {
    const mech = (client.caseStudy?.mechanism as string) || "";
    const mechs = (client.mechanisms as Mechanism[]) || [];
    return (
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="text-[13px] font-semibold">Mechanism — how we actually get the result</div>
          <div className="flex gap-1.5">
            <Button variant="secondary" size="sm" icon="wand" disabled={w.busy} onClick={p.onBuildMechanism}>
              {w.busy ? "Building…" : mechs.length ? "Rebuild (AI)" : "Build mechanism (AI)"}
            </Button>
            {mech && (
              <Button variant="secondary" size="sm" icon="filter" disabled={w.busy} onClick={() => p.onFilterStep("mech")}>
                Filter
              </Button>
            )}
          </div>
        </div>
        <div className="text-[12px] text-muted mb-3">
          Built from the client’s services + the ICP’s pains/desires — the obstacle we remove and how. Credibility for downstream, not the opening hook.
        </div>
        {w.mechError && (
          <div className="rounded-lg border border-red bg-[var(--tint-red)] p-2.5 mb-3 text-[12px] text-red whitespace-pre-wrap inline-flex items-start gap-1.5">
            <Icon name="alert-triangle" size={14} className="mt-0.5 shrink-0" /> {w.mechError}
          </div>
        )}
        <MechanismCards mechs={mechs} activeId={client.activeMechId as string} onPick={p.onPickMechanism} helpLabel="How this helps what you picked" />
        <MechSummary key={mech} initial={mech} onSave={p.onSaveMech} />
      </div>
    );
  }

  if (w.step === 5) {
    const gtees = ((client.guarantees as Array<{ text?: string } | string>) || []).map((g) => (typeof g === "string" ? g : g.text || "")).filter(Boolean);
    const cases = clientCaseStudies(client);
    return (
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-[13px] font-semibold">Proof</div>
          <Button variant="secondary" size="sm" icon="filter" disabled={w.busy} onClick={() => p.onFilterStep("proof")}>
            Filter all
          </Button>
        </div>
        <div className="text-[12px] text-muted mb-1.5">Guarantees — optional, pick any to include</div>
        {gtees.length ? (
          <div className="flex flex-col gap-1.5">
            {gtees.map((g) => (
              <PickRow key={g} selected={w.guarantees.indexOf(g) > -1} onClick={() => p.onToggleGuarantee(g)}>
                {g}
              </PickRow>
            ))}
          </div>
        ) : (
          <div className="text-[12px] text-muted">No guarantees on file — add them in the client profile.</div>
        )}
        <div className="text-[12px] text-muted mt-4 mb-1.5">Case studies — pick which proof to lead with</div>
        {cases.length ? (
          <div className="flex flex-col gap-1.5">
            {cases.map((c) => (
              <PickRow key={c} selected={w.caseStudies.indexOf(c) > -1} onClick={() => p.onToggleCase(c)}>
                {c}
              </PickRow>
            ))}
          </div>
        ) : (
          <div className="text-[12px] text-muted">No case studies on file — leave blank to use all.</div>
        )}
      </div>
    );
  }

  // Step 6 — frameworks + dimensions + variants
  const count = wizCount(w, client);
  return (
    <div>
      <div className="text-[12px] text-muted mb-1.5">Frameworks — hover for the template with its {"{{variables}}"}</div>
      <div className="flex flex-wrap gap-1.5">
        {p.frameworks.map((f) => (
          <ChipBtn key={f.id} on={!!w.fws[f.id]} onClick={() => p.onToggleFw(f.id)} title={f.template || "(no template)"}>
            {f.name} <span className="opacity-60">{f.category || ""}</span>
          </ChipBtn>
        ))}
      </div>

      <div className="text-[12px] text-muted mt-4 mb-1.5">Each variant = 1 framework × 1 pain × 1 desire × 1 mechanism. Toggle which to vary:</div>
      <div className="flex flex-wrap gap-1.5">
        {([["P", "Pain"], ["D", "Desire"], ["M", "Mechanism"]] as Array<["P" | "D" | "M", string]>).map(([k, label]) => {
          const on = w[("use" + k) as "useP" | "useD" | "useM"] !== false;
          return (
            <ChipBtn key={k} on={on} onClick={() => p.onToggleDim(k)}>
              {label}
            </ChipBtn>
          );
        })}
      </div>

      <div className="text-[12px] text-muted mt-3 mb-1.5">Variants per combo</div>
      <div className="flex gap-1.5">
        {[1, 2, 3].map((v) => (
          <ChipBtn key={v} on={w.variants === v} onClick={() => p.onSetVariants(v)}>
            {String(v)}
          </ChipBtn>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-bg2 mt-4 p-3 text-center">
        <b className="text-[15px]">{count.total || 0}</b> <span className="text-[13px]">scripts will generate</span>
        <div className="text-[12px] text-muted mt-0.5">
          {count.fw} framework{count.fw === 1 ? "" : "s"} × {count.p} pain{count.p === 1 ? "" : "s"}
          {w.useD !== false ? ` × ${count.d} desire${count.d === 1 ? "" : "s"}` : ""}
          {count.m ? " + the selected mechanism" : ""}
          {count.v > 1 ? ` × ${count.v} variants` : ""}
        </div>
      </div>
    </div>
  );
}

// ─── Small shared bits ───────────────────────────────────────────────────────
function ChipBtn({ on, onClick, title, children }: { on: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "rounded-full border px-3 py-1.5 text-[12px] transition-colors",
        on ? "border-accent2 bg-[var(--tint-accent)] text-accent2 font-medium" : "border-border bg-bg2 text-subtle hover:border-accent",
      )}
    >
      {on && <Icon name="check" size={12} className="inline-block mr-1 -mt-0.5" />}
      {children}
    </button>
  );
}

function MechSummary({ initial, onSave }: { initial: string; onSave: (t: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <div className="rounded-xl border border-border bg-bg2 p-3">
      <div className="text-[12px] font-semibold mb-1.5">Mechanism summary (used when writing scripts)</div>
      <textarea
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="e.g. 30 buyer interviews → repackage pricing → controlled migration"
        className="w-full min-h-[80px] resize-y bg-bg border border-border rounded-lg px-3 py-2 text-[13px] outline-none focus:border-accent2"
      />
      <div className="flex justify-end mt-2">
        <Button variant="secondary" size="sm" onClick={() => onSave(v)}>
          Save summary
        </Button>
      </div>
    </div>
  );
}

function GeneratingScreen({ w, client }: { w: WizState; client: Client }) {
  const k = wizCount(w, client);
  return (
    <div>
      <div className="text-[15px] font-semibold mb-1">
        Generating {k.total} script{k.total === 1 ? "" : "s"}…
      </div>
      <div className="text-[13px] text-muted mb-4">
        {k.fw} framework{k.fw === 1 ? "" : "s"} × {k.p} pain{k.p === 1 ? "" : "s"}
        {w.useD !== false ? ` × ${k.d} desire${k.d === 1 ? "" : "s"}` : ""}
        {k.m ? " + the selected mechanism" : ""}
        {k.v > 1 ? ` × ${k.v} variants` : ""}.
      </div>
      <div className="rounded-xl border border-border bg-bg2 p-4 inline-flex items-center gap-2.5 text-[13px] text-muted">
        <Icon name="loader-2" size={16} className="animate-[spin_0.8s_linear_infinite]" /> Working… combining each framework with your pains, desires and mechanism through the system filter.
      </div>
    </div>
  );
}

function FromScriptScreen({ client, busy, onVariate }: { client: Client; busy: boolean; onVariate: (text: string, fw: string, angle: string) => void }) {
  const scripts = (client.scriptReservoir as Array<{ id: string; name?: string; framework?: string; angle?: string; label?: string; script?: string }>) || [];
  const [paste, setPaste] = useState("");
  return (
    <div>
      <div className="text-[13px] text-muted mb-3">
        Pick a script (winning or any on the board): tap it for variations — all run through your system filter.
      </div>
      {scripts.length ? (
        <div className="flex flex-col gap-1.5 mb-4">
          {scripts.map((s) => {
            const ttl = s.name || s.framework || "Script";
            const sub = [s.framework, s.angle || s.label].filter(Boolean).join(" · ");
            return (
              <button
                key={s.id}
                disabled={busy}
                onClick={() => onVariate(s.script || "", s.framework || "", s.angle || "")}
                title={s.script || "(empty)"}
                className="text-left rounded-lg border border-border bg-bg2 hover:border-accent2 px-3 py-2 text-[13px] disabled:opacity-50"
              >
                <b>{ttl}</b> {sub && <span className="text-[12px] text-muted">{sub}</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="text-[12px] text-muted mb-4">No scripts on the board yet.</div>
      )}
      <div className="rounded-xl border border-border bg-bg2 p-3">
        <div className="text-[12px] font-semibold mb-1.5">Or paste a script</div>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder="Paste a script to use as the basis…"
          className="w-full min-h-[90px] resize-y bg-bg border border-border rounded-lg px-3 py-2 text-[13px] outline-none focus:border-accent2"
        />
        <div className="flex justify-end mt-2">
          <Button variant="primary" size="sm" icon="sparkles" loading={busy} onClick={() => onVariate(paste, "Pasted", "")}>
            Generate variations
          </Button>
        </div>
      </div>
    </div>
  );
}

function AnglesScreen({
  w,
  client,
  niches,
  onSetNiche,
  onFind,
  onAdd,
}: {
  w: WizState;
  client: Client;
  niches: Niche[];
  onSetNiche: (id: string) => void;
  onFind: (prompt: string) => void;
  onAdd: (a: string) => void;
}) {
  const myNiches = ((client.nicheIds as string[]) || []).map((id) => niches.find((n) => n.id === id)).filter(Boolean) as Niche[];
  const list = myNiches.length ? myNiches : niches;
  const nd = niches.find((n) => n.id === w.niche);
  const existing = dedupeStr([...(((nd?.angles as string[]) || [])), ...nichePains(client, w.niche)]).slice(0, 24);
  return (
    <div>
      <div className="text-[13px] text-muted mb-3">Pick a niche for {client.name}, review its pains/angles, then find more.</div>
      <div className="text-[12px] text-muted mb-1.5">Niche</div>
      {list.length ? (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {list.map((n) => (
            <ChipBtn key={n.id} on={w.niche === n.id} onClick={() => onSetNiche(n.id)}>
              {n.name}
            </ChipBtn>
          ))}
        </div>
      ) : (
        <div className="text-[12px] text-muted mb-4">No niche linked to this client yet.</div>
      )}

      <div className="rounded-xl border border-border bg-bg2 p-3 mb-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-[12px] font-semibold">Pain points & angles in {nd?.name || ""}</div>
          <Button variant="secondary" size="sm" icon="sparkles" disabled={w.busy} onClick={() => onFind("")}>
            {w.busy ? "Finding…" : "Find more angles"}
          </Button>
        </div>
        {existing.length ? (
          <div className="flex flex-wrap gap-1.5">
            {existing.map((a) => (
              <button
                key={a}
                disabled={w.busy}
                onClick={() => onFind(`Find angles closely related to "${a}" — variations, sharper cuts, and adjacent angles.`)}
                className="rounded-full border border-border bg-bg px-2.5 py-1 text-[12px] hover:border-accent2 disabled:opacity-50"
              >
                {a}
              </button>
            ))}
          </div>
        ) : (
          <div className="text-[12px] text-muted">None yet.</div>
        )}
      </div>

      {w.foundAngles.length > 0 && (
        <div className="rounded-xl border border-border bg-bg2 p-3">
          <div className="text-[12px] font-semibold mb-2">Suggested angles</div>
          <div className="flex flex-col gap-1.5">
            {w.foundAngles.map((a, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-[13px] border-b border-border last:border-0 pb-1.5">
                <span>{a}</span>
                <Button variant="ghost" size="sm" icon="plus" onClick={() => onAdd(a)}>
                  Add
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Follow-up flow — pick a board script to follow up on, or start a standalone sequence.
// Selecting either closes the wizard and opens the board's FollowupBuilder (legacy
// osWizFollowupBlank :7659 / osWizFollowupFrom :7660 both closed the wizard first).
function FollowupFlow({
  client,
  onBack,
  onStart,
}: {
  client: Client;
  onBack: () => void;
  onStart: (parent: { parentLabel: string; parentText: string }) => void;
}) {
  const reservoir =
    (client.scriptReservoir as Array<{ id: string; label?: string; framework?: string; angle?: string; script?: string }>) ||
    [];
  return (
    <div>
      <div className="text-[15px] font-semibold mb-1">Follow-up sequence</div>
      <div className="text-[13px] text-muted mb-4">
        Write outbound follow-ups that build on a first script — or a standalone sequence.
      </div>

      <button
        onClick={() => onStart({ parentLabel: "Standalone sequence", parentText: "" })}
        className="w-full text-left rounded-xl border border-border bg-bg2 hover:border-accent2 hover:bg-bg3 transition-colors p-3.5 mb-4"
      >
        <div className="font-semibold text-[13px] flex items-center gap-2">
          <Icon name="arrow-forward-up" size={16} className="text-accent2" /> Standalone sequence
        </div>
        <div className="text-[12px] text-muted mt-1">No first script needed — the follow-ups stand alone.</div>
      </button>

      <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
        Or follow up on a board script
      </div>
      {reservoir.length ? (
        <div className="flex flex-col gap-1.5 max-h-[280px] overflow-auto">
          {reservoir.map((s) => {
            const label = s.label || `${s.framework || ""} · ${s.angle || ""}`;
            const snip = String(s.script || "").replace(/\s+/g, " ").trim().slice(0, 80);
            return (
              <button
                key={s.id}
                onClick={() => onStart({ parentLabel: label, parentText: String(s.script || "") })}
                className="text-left rounded-lg border border-border bg-bg2 hover:border-accent2 transition-colors p-2.5"
              >
                <div className="text-[12px] font-semibold truncate">{label}</div>
                <div className="text-[11px] text-muted truncate">{snip || "(no text)"}</div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="text-[12px] text-muted">
          No board scripts yet — create scripts first, or build a standalone sequence.
        </div>
      )}

      <div className="mt-5">
        <Button variant="secondary" size="sm" onClick={onBack}>
          ← Back
        </Button>
      </div>
    </div>
  );
}
