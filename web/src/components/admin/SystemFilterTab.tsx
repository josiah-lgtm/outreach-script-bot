// Admin → System filter tab. Port of the legacy adminSystemFilter() screen
// (index.html:3171-3208) plus its handlers saveSystemFilter (:3531), runFilterAcrossAll
// (:3462) and runGroupAll (:3429). The bulk "run across everything" / "group everything"
// logic lives in @/lib/sync/adminBulk; this file is the form + the two run panels.
//
// LOAD-BEARING: the saved object shape is EXACTLY {enabled, model, lens, messaging,
// icpScripter, offers} and is written to cfg.settings.systemFilter.

"use client";

import { useState } from "react";
import {
  Button, Card, CardBody, FormField, Textarea, Select, Toggle, Hint, Grid2, Icon,
} from "@/components/ui";
import { useConfigStore } from "@/lib/store/configStore";
import { notify } from "@/lib/notify";
import { runFilterAcrossAll, runGroupAll } from "@/lib/sync/adminBulk";

const MODELS: Array<[string, string]> = [
  ["sonnet", "Claude Sonnet (recommended)"],
  ["opus", "Claude Opus"],
  ["haiku", "Claude Haiku"],
  ["gemini", "Gemini 2.5 Flash"],
];

interface SystemFilterShape {
  enabled?: boolean;
  model?: string;
  lens?: string;
  messaging?: string;
  icpScripter?: string;
  offers?: string;
}

export function SystemFilterTab() {
  // Seed the form once from the saved filter (legacy read it inline from `config`).
  const saved = (useConfigStore((s) => s.config.settings?.systemFilter) ?? {}) as SystemFilterShape;

  const [enabled, setEnabled] = useState<boolean>(saved.enabled !== false); // default on
  const [model, setModel] = useState<string>(saved.model || "sonnet");
  const [lens, setLens] = useState<string>(saved.lens || "");
  const [messaging, setMessaging] = useState<string>(saved.messaging || "");
  const [icpScripter, setIcpScripter] = useState<string>(saved.icpScripter || "");
  const [offers, setOffers] = useState<string>(saved.offers || "");

  // "Run filter across everything" — the five toggles default ON (legacy `checked`).
  const [cf, setCf] = useState({ scripts: true, pains: true, desires: true, offers: true, sizes: true });
  const [cfBusy, setCfBusy] = useState(false);
  const [cfStatus, setCfStatus] = useState("");

  // "Group everything" panel.
  const [gaBusy, setGaBusy] = useState(false);
  const [gaStatus, setGaStatus] = useState("");

  function save() {
    // MUTATE ONLY via update() (immer draft) — never touch config directly.
    useConfigStore.getState().update((cfg) => {
      cfg.settings = cfg.settings || {};
      cfg.settings.systemFilter = { enabled, model, lens, messaging, icpScripter, offers };
    });
    notify("System filter saved — now applied to every AI request");
  }

  async function onRunFilter() {
    if (cfBusy) return;
    setCfBusy(true);
    setCfStatus("");
    try {
      const r = await runFilterAcrossAll({
        ...cf,
        onProgress: (done, total) => setCfStatus(`Filtering ${done} / ${total}…`),
        confirm: (count) =>
          window.confirm(
            `Run the filter through ${count} item(s) across all clients?\n\n` +
              "This rewrites existing text to match your filter. Scripts keep their previous version; " +
              "angles, desires and offers are replaced in place. Continue?",
          ),
      });
      setCfStatus(r.ran ? r.message : "");
    } finally {
      setCfBusy(false);
    }
  }

  async function onGroupAll() {
    if (gaBusy) return;
    setGaBusy(true);
    setGaStatus("");
    try {
      const r = await runGroupAll((done, total) => setGaStatus(`Grouping ${done} / ${total}…`));
      setGaStatus(r.ran ? r.message : "");
    } finally {
      setGaBusy(false);
    }
  }

  const toggleCf = (k: keyof typeof cf) => setCf((p) => ({ ...p, [k]: !p[k] }));

  return (
    <div className="space-y-5">
      {/* Intro */}
      <Card>
        <CardBody>
          <div className="flex items-center gap-2 text-sm font-semibold text-text">
            <Icon name="adjustments-horizontal" />
            System filter — your lens on everything the AI does
          </div>
          <Hint className="mt-1.5">
            A house knowledge + filter layer fed into <b>every</b> AI action — finding and creating angles,
            building ICPs, suggesting offers, writing and refining scripts, research. The bot picks, judges and
            phrases things through this lens. The more you put here (offers, guarantees, your offer-creation
            sheet), the smarter and more on-brand it gets. It applies on top of any research or info the bot
            pulls in.
          </Hint>
        </CardBody>
      </Card>

      {/* Filter form */}
      <Card>
        <CardBody className="space-y-1">
          <Grid2>
            <FormField label="Filter">
              <label className="flex items-center gap-2 mt-2 cursor-pointer">
                <Toggle checked={enabled} onChange={setEnabled} aria-label="Auto-apply filter to everything new" />
                <span className="text-xs text-subtle">Auto-apply to everything new</span>
              </label>
            </FormField>
            <FormField label="Model used for the filter" htmlFor="sf-model">
              <Select id="sf-model" value={model} onChange={(e) => setModel(e.target.value)}>
                {MODELS.map(([val, lbl]) => (
                  <option key={val} value={val}>
                    {lbl}
                  </option>
                ))}
              </Select>
            </FormField>
          </Grid2>

          <Hint className="!mt-0 mb-3">
            When on, everything the AI creates — new scripts, ICPs, offers and angles — automatically runs
            through this filter as it&apos;s made. The knowledge below applies immediately (it&apos;s folded into
            the prompt); the model choice takes effect on the server when supported. To fix what&apos;s already in
            the app, use “Run the filter across everything” at the bottom.
          </Hint>

          <FormField label="System — the overall lens">
            <Textarea
              value={lens}
              onChange={(e) => setLens(e.target.value)}
              className="min-h-[100px]"
              placeholder="How we see outreach. What good looks like. What to always avoid. The bot reads everything else through this."
            />
          </FormField>

          <FormField label="Messaging & scripting — voice & rules every script runs through">
            <Textarea
              value={messaging}
              onChange={(e) => setMessaging(e.target.value)}
              className="min-h-[120px]"
              placeholder="Tone of voice, sentence length, openers/CTAs to use or avoid, banned words, structure, what makes a script worth keeping vs cutting. Every script the bot writes or chooses runs through this."
            />
          </FormField>

          <FormField label="ICP builder scripter — pain points, desires & angles">
            <Textarea
              value={icpScripter}
              onChange={(e) => setIcpScripter(e.target.value)}
              className="min-h-[120px]"
              placeholder="How to find, judge and create pain points, desires and angles. Applied across the client account, the ICP and the niche."
            />
          </FormField>

          <FormField label="Offer creation & guarantees">
            <Textarea
              value={offers}
              onChange={(e) => setOffers(e.target.value)}
              className="min-h-[150px]"
              placeholder="Everything about offers and guarantees, plus your offer-creation sheet / framework — the bot uses it as the template for thinking about offers and risk-reversal."
            />
          </FormField>

          <div className="flex justify-end mt-2.5">
            <Button variant="mini" size="sm" icon="device-floppy" onClick={save}>
              Save system filter
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Run filter across everything */}
      <Card>
        <CardBody>
          <div className="flex items-center gap-2 text-sm font-semibold text-text">
            <Icon name="refresh" />
            Run the filter across everything we already have
          </div>
          <Hint className="mt-1 mb-2.5">
            Applies your saved filter to existing content via AI, fixing what&apos;s already in the app. Scripts
            keep their previous version (you can roll back); angles, desires and offers are rewritten in place.
            Save your filter above first.
          </Hint>

          <div className="flex flex-wrap gap-4 mb-3">
            {([
              ["scripts", "Scripts"],
              ["pains", "Pain points"],
              ["desires", "Desires"],
              ["offers", "Offers"],
              ["sizes", "Sizes"],
            ] as Array<[keyof typeof cf, string]>).map(([k, lbl]) => (
              <label key={k} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cf[k]}
                  onChange={() => toggleCf(k)}
                  disabled={cfBusy}
                  className="accent-accent cursor-pointer"
                />
                <span className="text-xs text-subtle">{lbl}</span>
              </label>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <Button variant="mini" size="sm" icon="wand" loading={cfBusy} onClick={onRunFilter}>
              Run filter now
            </Button>
            {cfStatus && <Hint className="!mt-0">{cfStatus}</Hint>}
          </div>
        </CardBody>
      </Card>

      {/* Group everything */}
      <Card>
        <CardBody>
          <div className="flex items-center gap-2 text-sm font-semibold text-text">
            <Icon name="layout-grid" />
            Group pain points &amp; desires into themes (AI)
          </div>
          <Hint className="mt-1 mb-2.5">
            Runs the AI grouping across <b>every client and every ICP</b> — pain points and desired outcomes get
            sorted into themed buckets (saved on each client + ICP), so the create-script wizard shows them
            neatly. Re-run any time you&apos;ve added a lot of new ideas.
          </Hint>

          <div className="flex items-center gap-3">
            <Button variant="mini" size="sm" icon="layout-grid" loading={gaBusy} onClick={onGroupAll}>
              Group everything now
            </Button>
            {gaStatus && <Hint className="!mt-0">{gaStatus}</Hint>}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
