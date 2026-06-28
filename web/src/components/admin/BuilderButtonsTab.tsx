// Admin → Script Builder buttons tab. Port of the legacy adminBuilderButtons() screen
// (index.html:3210-3257) plus its handlers osBtnField/osBtnAdd/osBtnDel/osBtnReset/
// osBtnSaveAll (:3258-3280) and the builderButtons() reader (:1430).
//
// Data shape (read verbatim from BuilderButton in lib/sync/wizard.ts + defaultBuilderButtons
// in lib/sync/configClient.ts):
//   { id, label, icon, prompt, examples, enabled, keepStructure, model }
// The buttons live at cfg.settings.builderButtons (array) and the default model at
// cfg.settings.builderModel.
//
// Editing holds a local React draft array seeded from config; EVERY persisted change still
// goes through useConfigStore.getState().update() so the single save queue stays correct
// (write-through per change, mirroring the legacy persistConfig() on each handler).

"use client";

import { useState } from "react";
import {
  Button, IconButton, Card, CardBody, Input, Select, Textarea, Toggle,
  FormField, Grid2, Icon, Badge, EmptyState,
} from "@/components/ui";
import { useConfigStore } from "@/lib/store/configStore";
import { defaultBuilderButtons } from "@/lib/sync/configClient";
import type { BuilderButton } from "@/lib/sync/wizard";
import { notify } from "@/lib/notify";

// Per-button model options (legacy modelOpts, :3214). '' = use the default below.
const MODEL_OPTS: [string, string][] = [
  ["", "Use default (below)"],
  ["sonnet", "Claude Sonnet"],
  ["opus", "Claude Opus (smartest)"],
  ["haiku", "Claude Haiku (fastest)"],
];
// Default-model options (legacy dModelOpts, :3237).
const DEFAULT_MODEL_OPTS: [string, string][] = [
  ["sonnet", "Claude Sonnet (recommended)"],
  ["opus", "Claude Opus (smartest)"],
  ["haiku", "Claude Haiku (fastest)"],
];

// uid (legacy :3259 used 'btn' + Date.now().toString(36)). Date.now() is fine in a client
// component — only workflow scripts forbid it.
const newButtonId = () => "btn" + Date.now().toString(36);

export function BuilderButtonsTab() {
  // Reader mirrors builderButtons() (:1430): fall back to defaults when missing/empty.
  const stored = useConfigStore((s) => s.config.settings?.builderButtons);
  const storedModel = useConfigStore((s) => s.config.settings?.builderModel);

  const [buttons, setButtons] = useState<BuilderButton[]>(() =>
    Array.isArray(stored) && stored.length ? structuredClone(stored) : defaultBuilderButtons(),
  );
  const [model, setModel] = useState<string>(() => storedModel || "sonnet");

  // Write-through: persist the whole array (and optionally the default model) on each change,
  // exactly as the legacy handlers called persistConfig() after every edit.
  function persist(next: BuilderButton[], nextModel: string = model) {
    setButtons(next);
    useConfigStore.getState().update((cfg) => {
      cfg.settings = cfg.settings || {};
      cfg.settings.builderButtons = next;
      cfg.settings.builderModel = nextModel;
    });
  }

  function patch(id: string, field: keyof BuilderButton, value: string | boolean) {
    persist(buttons.map((b) => (b.id === id ? { ...b, [field]: value } : b)));
  }

  function addButton() {
    // Legacy osBtnAdd (:3259) — new button seeded with the same defaults.
    const b: BuilderButton = {
      id: newButtonId(),
      label: "New button",
      icon: "ti-wand",
      keepStructure: true,
      enabled: true,
      examples: "",
      prompt: "",
    };
    persist([...buttons, b]);
  }

  function deleteButton(id: string) {
    // Legacy osBtnDel (:3260) — confirm, then splice + toast.
    if (!window.confirm("Delete this button?")) return;
    persist(buttons.filter((b) => b.id !== id));
    notify("Button deleted");
  }

  function resetDefaults() {
    // Legacy osBtnReset (:3261) — confirm, restore the built-in buttons.
    if (!window.confirm("Reset all Script Builder buttons to the defaults? Your custom buttons and prompt edits will be lost.")) return;
    persist(defaultBuilderButtons());
    notify("Builder buttons reset to defaults");
  }

  function changeDefaultModel(next: string) {
    setModel(next);
    persist(buttons, next);
  }

  function saveAll() {
    // Legacy osBtnSaveAll (:3263) — flush the whole array + default model and toast.
    persist(buttons, model);
    notify("✅ Builder buttons saved");
  }

  const saveBar = (
    <div className="flex justify-end gap-2">
      <Button variant="mini" size="sm" icon="refresh" onClick={resetDefaults}>
        Reset to defaults
      </Button>
      <Button variant="mini" size="sm" icon="plus" onClick={addButton}>
        Add button
      </Button>
      <Button variant="primary" size="sm" icon="device-floppy" onClick={saveAll}>
        Save
      </Button>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="info-block">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <Icon name="wand" />
          Script Builder buttons
        </div>
        <p className="mt-1 text-xs text-subtle">
          These are the one-click rewrite buttons in the create-script review (the swipe screen).
          Edit each button&apos;s prompt, add example scripts to steer its style, rename it, turn it
          on/off, or add your own. &ldquo;Keep structure &amp; length&rdquo; keeps the same framework
          and size (good for tone tweaks); turn it off for buttons that should restructure or resize
          (like Shorten or Reformat). Pick the Claude model each button uses to get sharper rewrites.
          Hit <b>Save</b> when you&apos;re done.
        </p>
      </div>

      <Card>
        <CardBody className="space-y-3">
          <Grid2 className="items-end">
            <FormField
              label="Default model for these buttons"
              htmlFor="bb-model"
              hint="Used by any button set to “Use default”. Opus is the smartest (best rewrites), Haiku the fastest/cheapest."
            >
              <Select id="bb-model" value={model} onChange={(e) => changeDefaultModel(e.target.value)}>
                {DEFAULT_MODEL_OPTS.map(([v, lbl]) => (
                  <option key={v} value={v}>
                    {lbl}
                  </option>
                ))}
              </Select>
            </FormField>
            <div className="flex items-end justify-end pb-3">{saveBar}</div>
          </Grid2>

          <div className="text-sm font-semibold text-text">
            <Badge tone="accent">
              {buttons.length} button{buttons.length === 1 ? "" : "s"}
            </Badge>
          </div>

          {buttons.length === 0 ? (
            <EmptyState
              icon="wand"
              title="No buttons yet"
              description="Add a one-click rewrite button for the swipe screen."
              action={
                <Button variant="mini" size="sm" icon="plus" onClick={addButton}>
                  Add button
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {buttons.map((b) => {
                const enabled = b.enabled !== false;
                const keep = b.keepStructure !== false;
                return (
                  <Card key={b.id}>
                    <CardBody className="space-y-1">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2 text-sm font-semibold text-text">
                          <Icon name={b.icon} />
                          {b.label || "Untitled button"}
                        </div>
                        <IconButton
                          icon="trash"
                          label="Delete this button"
                          size="sm"
                          variant="danger"
                          onClick={() => deleteButton(b.id)}
                        />
                      </div>

                      <Grid2>
                        <FormField label="Button label" htmlFor={`bb-label-${b.id}`}>
                          <Input
                            id={`bb-label-${b.id}`}
                            value={b.label || ""}
                            placeholder="e.g. Punchier"
                            onChange={(e) => patch(b.id, "label", e.target.value)}
                          />
                        </FormField>
                        <FormField label="Icon (Tabler name, optional)" htmlFor={`bb-icon-${b.id}`}>
                          <Input
                            id={`bb-icon-${b.id}`}
                            value={b.icon || ""}
                            placeholder="ti-wand"
                            onChange={(e) => patch(b.id, "icon", e.target.value)}
                          />
                        </FormField>
                      </Grid2>

                      <FormField
                        label="Prompt — what this button tells the AI to do to the script"
                        htmlFor={`bb-prompt-${b.id}`}
                      >
                        <Textarea
                          id={`bb-prompt-${b.id}`}
                          value={b.prompt || ""}
                          placeholder="e.g. Make this punchier — short, high-energy sentences…"
                          className="min-h-[90px]"
                          onChange={(e) => patch(b.id, "prompt", e.target.value)}
                        />
                      </FormField>

                      <FormField
                        label="Examples (optional) — the AI matches their STYLE, not the words"
                        htmlFor={`bb-examples-${b.id}`}
                      >
                        <Textarea
                          id={`bb-examples-${b.id}`}
                          value={b.examples || ""}
                          placeholder="Paste 1–3 example scripts written the way you want this button to sound."
                          className="min-h-[60px]"
                          onChange={(e) => patch(b.id, "examples", e.target.value)}
                        />
                      </FormField>

                      <div className="flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-2 text-xs text-subtle cursor-pointer">
                          <Toggle
                            checked={enabled}
                            onChange={(v) => patch(b.id, "enabled", v)}
                            aria-label="Show in builder"
                          />
                          Show in builder
                        </label>
                        <label
                          className="flex items-center gap-2 text-xs text-subtle cursor-pointer"
                          title="Keep the same framework, structure and length — only change the style. Turn off for buttons that should restructure or change length (e.g. Shorten, Reformat)."
                        >
                          <Toggle
                            checked={keep}
                            onChange={(v) => patch(b.id, "keepStructure", v)}
                            aria-label="Keep structure & length"
                          />
                          Keep structure &amp; length
                        </label>
                        <label className="flex items-center gap-2 text-xs text-subtle">
                          Model
                          <Select
                            value={b.model || ""}
                            onChange={(e) => patch(b.id, "model", e.target.value)}
                            className="w-auto"
                          >
                            {MODEL_OPTS.map(([v, lbl]) => (
                              <option key={v} value={v}>
                                {lbl}
                              </option>
                            ))}
                          </Select>
                        </label>
                      </div>
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          )}

          <div className="flex justify-end pt-1">{saveBar}</div>
        </CardBody>
      </Card>
    </div>
  );
}
