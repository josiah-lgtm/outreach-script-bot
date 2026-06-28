// Admin → Our Agency tab. Port of the legacy adminAgency() screen (index.html:3546-3577)
// with its nested Sales Document editor adminSalesDoc() (:3578-3657), plus the
// saveAgency (:3639), saveSalesDoc (:3612) and resetSalesDoc (:3633) handlers.
//
// LOAD-BEARING fidelity:
//  • NEVER save an empty agency name — the legacy guard (saveAgency :3644) keeps the
//    previous name (or the default) so migrateConfig can't re-seed defaults over edits.
//  • List fields are line-parsed: textarea, one item per line, trimmed, blanks dropped.
//    - whyDifferent / deliverables → string[]
//    - caseStudies   → "Name | result | optional link"  (split on "|")
//    - socialLinks   → "Label | url"  (label falls back to url; dropped if no url)
//    - process       → "Phase :: item; item; item"  (items split on ";")
//  • programCost = +value || 0 (number).
//  • Sales Document (sellerProfile.salesDoc):
//    - per-section SHOW toggle stored in sd.show[key]; a section is ON unless explicitly
//      false (legacy `sd.show?.[key] !== false`).
//    - per-section HEADING override stored in sd.headings[key]; only sections that have a
//      default heading get an input; saving a blank heading RESETS it to the default
//      (legacy `h.value.trim() || DEFAULT_SALES_DOC.headings[key]`). "Reset section to
//      default heading" affordance clears the override back to the default.
//    - prompt (string), mention (string[], one per line), custom ("Heading :: body" where
//      "/" marks a paragraph break → joined by "\n").
//    - Reset to defaults replaces sd with structuredClone(DEFAULT_SALES_DOC) behind a confirm.
//
// Mutations go ONLY through useConfigStore.getState().update((cfg) => {...}); reads use
// selectors. Local React state is seeded from sellerProfile and saved on explicit clicks.

"use client";

import { useState } from "react";
import {
  Button, IconButton, Card, CardBody, Input, Textarea, Toggle, FormField, Grid2, Icon, Badge,
  Hint,
} from "@/components/ui";
import { useConfigStore } from "@/lib/store/configStore";
import { notify } from "@/lib/notify";
import {
  DEFAULT_SELLER_PROFILE, DEFAULT_SALES_DOC, SALES_SECTION_DEFS,
} from "@/lib/sync/configClient";

declare const structuredClone: <T>(value: T) => T;

// ── Domain shapes (match configClient's sellerProfile / salesDoc EXACTLY) ──
// The shared Config type keeps `sellerProfile?: any`; these local interfaces give this
// screen real types without editing the shared types module.
interface CaseStudy { name: string; result: string; link: string }
interface SocialLink { label: string; url: string }
interface ProcessPhase { phase: string; items: string[] }
interface CustomSection { heading: string; body: string }
interface SalesDoc {
  prompt: string;
  mention: string[];
  custom: CustomSection[];
  show: Record<string, boolean>;
  headings: Record<string, string>;
}
interface SellerProfile {
  name?: string;
  website?: string;
  logo?: string;
  founder?: string;
  tagline?: string;
  whoWeAre?: string;
  trackRecord?: string;
  howWeFindLeads?: string;
  howWeQualify?: string;
  whyDifferent?: string[];
  caseStudies?: CaseStudy[];
  socialLinks?: SocialLink[];
  deliverables?: string[];
  process?: ProcessPhase[];
  programCost?: number;
  costNote?: string;
  guarantee?: string;
  salesDoc?: SalesDoc;
}
// SALES_SECTION_DEFS is `[key, label]` pairs; default headings/show are keyed records.
type SectionDef = [string, string];
const SECTION_DEFS = SALES_SECTION_DEFS as SectionDef[];
const DEFAULT_HEADINGS = (DEFAULT_SALES_DOC as SalesDoc).headings;
const SELLER_DEFAULTS = DEFAULT_SELLER_PROFILE as SellerProfile;

// ── Line helpers (verbatim semantics from saveAgency / saveSalesDoc) ──
const splitLines = (s: string): string[] => s.split("\n").map((x) => x.trim()).filter(Boolean);

// caseStudies: "Name | result | link"
const csToLines = (cs: CaseStudy[] | undefined): string =>
  (cs || []).map((c) => `${c.name} | ${c.result}${c.link ? " | " + c.link : ""}`).join("\n");
const csFromLines = (text: string): CaseStudy[] =>
  splitLines(text).map((l) => {
    const [name, result, link] = l.split("|").map((s) => (s || "").trim());
    return { name: name || "", result: result || "", link: link || "" };
  });

// socialLinks: "Label | url" (label falls back to url; dropped if no url)
const socialToLines = (s: SocialLink[] | undefined): string =>
  (s || []).map((x) => `${x.label} | ${x.url}`).join("\n");
const socialFromLines = (text: string): SocialLink[] =>
  splitLines(text)
    .map((l) => {
      const [label, url] = l.split("|").map((s) => (s || "").trim());
      return { label: label || url, url: url || "" };
    })
    .filter((s) => s.url);

// process: "Phase :: item; item; item"
const processToLines = (p: ProcessPhase[] | undefined): string =>
  (p || []).map((x) => `${x.phase} :: ${(x.items || []).join("; ")}`).join("\n");
const processFromLines = (text: string): ProcessPhase[] =>
  splitLines(text).map((l) => {
    const [phase, items] = l.split("::");
    return { phase: (phase || "").trim(), items: (items || "").split(";").map((s) => s.trim()).filter(Boolean) };
  });

export function AgencyTab() {
  const sp: SellerProfile = useConfigStore((s) => s.config.sellerProfile as SellerProfile | undefined) || {};

  // ── Agency-profile draft (seeded once from sellerProfile) ──
  const seed = () => ({
    name: sp.name || "",
    website: sp.website || "",
    logo: sp.logo || "",
    founder: sp.founder || "",
    tagline: sp.tagline || "",
    whoWeAre: sp.whoWeAre || "",
    trackRecord: sp.trackRecord || "",
    howWeFindLeads: sp.howWeFindLeads || "",
    howWeQualify: sp.howWeQualify || "",
    whyDifferent: (sp.whyDifferent || []).join("\n"),
    caseStudies: csToLines(sp.caseStudies),
    socialLinks: socialToLines(sp.socialLinks),
    deliverables: (sp.deliverables || []).join("\n"),
    process: processToLines(sp.process),
    programCost: String(sp.programCost ?? ""),
    costNote: sp.costNote || "",
    guarantee: sp.guarantee || "",
  });
  const [form, setForm] = useState(seed);
  const set = (k: keyof ReturnType<typeof seed>, v: string) => setForm((p) => ({ ...p, [k]: v }));

  // saveAgency (legacy :3639) — list fields line-parsed; name never goes empty.
  function saveAgency() {
    useConfigStore.getState().update((cfg) => {
      const t: SellerProfile = (cfg.sellerProfile = (cfg.sellerProfile as SellerProfile) || {});
      // Never let the name go empty — migrate would re-seed defaults over your edits.
      t.name = form.name.trim() || t.name || SELLER_DEFAULTS.name;
      t.website = form.website.trim();
      t.logo = form.logo.trim();
      t.founder = form.founder.trim();
      t.tagline = form.tagline.trim();
      t.whoWeAre = form.whoWeAre.trim();
      t.trackRecord = form.trackRecord.trim();
      t.howWeFindLeads = form.howWeFindLeads.trim();
      t.howWeQualify = form.howWeQualify.trim();
      t.whyDifferent = splitLines(form.whyDifferent);
      t.deliverables = splitLines(form.deliverables);
      t.caseStudies = csFromLines(form.caseStudies);
      t.socialLinks = socialFromLines(form.socialLinks);
      t.process = processFromLines(form.process);
      t.programCost = +form.programCost || 0;
      t.costNote = form.costNote.trim();
      t.guarantee = form.guarantee.trim();
    });
    notify("Agency profile saved");
  }

  return (
    <div className="space-y-5">
      {/* ── Intro ── */}
      <Card>
        <CardBody>
          <div className="flex items-center gap-2 text-sm font-semibold text-text">
            <Icon name="id-badge-2" />
            Our agency profile
          </div>
          <Hint className="mt-1.5">
            This is what the Sales growth plan pitches. The prospect&apos;s own research is pulled per client; this is
            the part about us. Everything here is editable.
          </Hint>
        </CardBody>
      </Card>

      {/* ── Agency profile editor ── */}
      <Card>
        <CardBody>
          <Grid2>
            <FormField label="Name">
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
            </FormField>
            <FormField label="Website">
              <Input value={form.website} onChange={(e) => set("website", e.target.value)} />
            </FormField>
          </Grid2>
          <Grid2>
            <FormField label="Logo image URL">
              <Input value={form.logo} onChange={(e) => set("logo", e.target.value)} />
            </FormField>
            <FormField label="Founder (name, title)">
              <Input value={form.founder} onChange={(e) => set("founder", e.target.value)} />
            </FormField>
          </Grid2>
          <FormField label="Tagline">
            <Input value={form.tagline} onChange={(e) => set("tagline", e.target.value)} />
          </FormField>
          <FormField label="Who we are">
            <Textarea value={form.whoWeAre} onChange={(e) => set("whoWeAre", e.target.value)} />
          </FormField>
          <FormField label="Track record (one line)">
            <Input value={form.trackRecord} onChange={(e) => set("trackRecord", e.target.value)} />
          </FormField>
          <FormField label="How we find leads">
            <Textarea value={form.howWeFindLeads} onChange={(e) => set("howWeFindLeads", e.target.value)} />
          </FormField>
          <FormField label="How we keep leads qualified">
            <Textarea value={form.howWeQualify} onChange={(e) => set("howWeQualify", e.target.value)} />
          </FormField>
          <FormField label="Why we are different (one per line)">
            <Textarea
              className="min-h-[90px]"
              value={form.whyDifferent}
              onChange={(e) => set("whyDifferent", e.target.value)}
            />
          </FormField>
          <FormField label="Case studies (Name | result | optional video link, one per line)">
            <Textarea
              className="min-h-[110px]"
              value={form.caseStudies}
              onChange={(e) => set("caseStudies", e.target.value)}
            />
          </FormField>
          <FormField label="Social / proof links (Label | url, one per line)">
            <Textarea value={form.socialLinks} onChange={(e) => set("socialLinks", e.target.value)} />
          </FormField>
          <FormField label="What is included (one per line)">
            <Textarea
              className="min-h-[110px]"
              value={form.deliverables}
              onChange={(e) => set("deliverables", e.target.value)}
            />
          </FormField>
          <FormField label="Process (Phase :: item; item; item, one phase per line)">
            <Textarea
              className="min-h-[90px]"
              value={form.process}
              onChange={(e) => set("process", e.target.value)}
            />
          </FormField>
          <Grid2>
            <FormField label="Program cost (number)">
              <Input
                type="number"
                value={form.programCost}
                onChange={(e) => set("programCost", e.target.value)}
              />
            </FormField>
            <FormField label="Cost note">
              <Input value={form.costNote} onChange={(e) => set("costNote", e.target.value)} />
            </FormField>
          </Grid2>
          <FormField label="Guarantee / promise" className="mb-0">
            <Textarea value={form.guarantee} onChange={(e) => set("guarantee", e.target.value)} />
          </FormField>

          <div className="flex gap-2 mt-3">
            <Button variant="mini" size="sm" icon="device-floppy" onClick={saveAgency}>
              Save agency profile
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* ── Nested Sales Document editor ── */}
      <SalesDocEditor sp={sp} />
    </div>
  );
}

// ── Sales document customization — every part of the pitch, in your control ──
// Port of adminSalesDoc() (:3578) + saveSalesDoc() (:3612) + resetSalesDoc() (:3633).
function SalesDocEditor({ sp }: { sp: SellerProfile }) {
  const sd: SalesDoc = sp.salesDoc || (DEFAULT_SALES_DOC as SalesDoc);

  // custom lines: "Heading :: body" with "/" for paragraph breaks (legacy customLines).
  const customToLines = (custom: CustomSection[] | undefined): string =>
    (custom || []).map((cs) => `${cs.heading || ""} :: ${String(cs.body || "").replace(/\n/g, " / ")}`).join("\n");

  // Drafts seeded once from salesDoc.
  const [show, setShow] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    SECTION_DEFS.forEach(([key]) => { o[key] = sd.show?.[key] !== false; });
    return o;
  });
  const [headings, setHeadings] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    SECTION_DEFS.forEach(([key]) => {
      if (DEFAULT_HEADINGS[key] !== undefined) {
        o[key] = sd.headings?.[key] || DEFAULT_HEADINGS[key];
      }
    });
    return o;
  });
  const [prompt, setPrompt] = useState<string>(sd.prompt || "");
  const [mention, setMention] = useState<string>((sd.mention || []).join("\n"));
  const [custom, setCustom] = useState<string>(customToLines(sd.custom));

  // saveSalesDoc (legacy :3612): blank heading → default; custom "Heading :: body" with "/" paragraph breaks.
  function saveSalesDoc() {
    useConfigStore.getState().update((cfg) => {
      const t: SellerProfile = (cfg.sellerProfile = (cfg.sellerProfile as SellerProfile) || {});
      const next: SalesDoc = (t.salesDoc = t.salesDoc || structuredClone(DEFAULT_SALES_DOC as SalesDoc));
      next.show = next.show || {};
      next.headings = next.headings || {};
      SECTION_DEFS.forEach(([key]) => {
        next.show[key] = !!show[key];
        if (DEFAULT_HEADINGS[key] !== undefined) {
          next.headings[key] = (headings[key] || "").trim() || DEFAULT_HEADINGS[key];
        }
      });
      next.prompt = prompt.trim();
      next.mention = splitLines(mention);
      next.custom = splitLines(custom)
        .map((l) => {
          const [heading, body] = l.split("::");
          return {
            heading: (heading || "").trim(),
            body: (body || "").split("/").map((p) => p.trim()).filter(Boolean).join("\n"),
          };
        })
        .filter((cs) => cs.heading || cs.body);
    });
    notify("Sales document defaults saved");
  }

  // resetSalesDoc (legacy :3633): confirm → replace salesDoc with the defaults, reseed drafts.
  function resetSalesDoc() {
    if (!window.confirm("Reset the sales document sections, prompt and mentions to the defaults?")) return;
    useConfigStore.getState().update((cfg) => {
      const t: SellerProfile = (cfg.sellerProfile = (cfg.sellerProfile as SellerProfile) || {});
      t.salesDoc = structuredClone(DEFAULT_SALES_DOC as SalesDoc);
    });
    // Reseed local drafts from defaults so the UI reflects the reset.
    const d = DEFAULT_SALES_DOC as SalesDoc;
    const s: Record<string, boolean> = {};
    const h: Record<string, string> = {};
    SECTION_DEFS.forEach(([key]) => {
      s[key] = d.show?.[key] !== false;
      if (d.headings[key] !== undefined) h[key] = d.headings[key];
    });
    setShow(s);
    setHeadings(h);
    setPrompt("");
    setMention("");
    setCustom("");
    notify("Sales document reset");
  }

  // "Reset section to default heading" — clears the override back to the default.
  function resetHeading(key: string) {
    setHeadings((p) => ({ ...p, [key]: DEFAULT_HEADINGS[key] }));
  }

  return (
    <Card className="border-accent/50">
      <CardBody>
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <Icon name="file-text" />
          Sales document — customize every part
        </div>
        <Hint className="mt-1.5 mb-3">
          These are the defaults for every sales plan. Toggle parts on or off, rename headings (use {"{client}"} for
          the prospect&apos;s name), steer the AI, and add your own sections.
        </Hint>

        {/* Sections — show / hide / rename */}
        <div className="text-xs font-semibold text-accent2 mb-2">Sections — show / hide / rename</div>
        <div className="flex flex-col gap-1.5">
          {SECTION_DEFS.map(([key, label]) => {
            const hasHeading = DEFAULT_HEADINGS[key] !== undefined;
            const isOverridden =
              hasHeading && (headings[key] || "").trim() !== DEFAULT_HEADINGS[key];
            return (
              <div
                key={key}
                className="grid grid-cols-[auto_1.1fr_1fr] gap-2 items-center"
              >
                <Toggle
                  checked={!!show[key]}
                  onChange={(v) => setShow((p) => ({ ...p, [key]: v }))}
                  aria-label={`Show ${label}`}
                />
                <span className="text-xs text-subtle">{label}</span>
                {hasHeading ? (
                  <div className="flex items-center gap-1">
                    <Input
                      value={headings[key] ?? ""}
                      onChange={(e) => setHeadings((p) => ({ ...p, [key]: e.target.value }))}
                      placeholder="heading"
                    />
                    <IconButton
                      icon="refresh"
                      label="Reset to default heading"
                      variant="mini"
                      size="sm"
                      disabled={!isOverridden}
                      onClick={() => resetHeading(key)}
                      className="shrink-0"
                    />
                  </div>
                ) : (
                  <Badge tone="neutral">no heading</Badge>
                )}
              </div>
            );
          })}
        </div>

        {/* Extra AI prompt */}
        <div className="text-xs font-semibold text-accent2 mt-4 mb-2">
          ✨ Extra AI prompt (steers the personalised intro, expectations and closing)
        </div>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. Mention that we never lock clients into long contracts. Sound like Josiah texting a friend. Reference their industry by name."
        />

        {/* Always mention */}
        <div className="text-xs font-semibold text-accent2 mt-3 mb-2">
          📌 Always mention (one per line — woven in naturally, never as a list)
        </div>
        <Textarea
          value={mention}
          onChange={(e) => setMention(e.target.value)}
          placeholder={"e.g. We launch within 3 weeks\nThey keep the plan free even if we never work together"}
        />

        {/* Custom sections */}
        <div className="text-xs font-semibold text-accent2 mt-3 mb-2">
          ➕ Custom sections (Heading :: body, one per line — use / for a paragraph break, {"{client}"} for their name)
        </div>
        <Textarea
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Why now :: Every week without outbound is booked calls your competitors take. / We can have {client} live in three weeks."
        />

        <div className="flex gap-2 mt-3">
          <Button variant="mini" size="sm" icon="device-floppy" onClick={saveSalesDoc}>
            Save sales document defaults
          </Button>
          <Button variant="danger" size="sm" icon="refresh" onClick={resetSalesDoc}>
            Reset to defaults
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
