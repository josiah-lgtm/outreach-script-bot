// Local, component-facing types for the Growth screen. The config document is loosely
// shaped (the legacy app was untyped JS), so these interfaces name only the fields the
// growth components actually read — with an index signature for the rest. This keeps the
// components free of bare `any` (the eslint rule that's off only inside lib/server/store)
// while staying faithful to the dynamic data model.

export interface GpCaseStudy {
  pains?: string[];
  desires?: string[];
  offers?: string[];
  caseStudies?: string[];
  mechanism?: string;
  proofLine?: string;
  [k: string]: unknown;
}

export interface GpIcp {
  id: string;
  title: string;
  niche?: string;
  score?: number | string;
  marketSize?: string;
  jobTitles?: string[];
  locations?: string[];
  employeeSize?: string;
  revenue?: string;
  outboundNotes?: string;
  why?: string;
  example?: { company: string; website?: string; why?: string };
  [k: string]: unknown;
}

export interface GpBrief {
  services?: string[];
  positioning?: string;
  caseStudies?: string[];
  competitors?: string[];
  builtAt?: string;
}

export interface GpReservoirScript {
  id?: string;
  framework?: string;
  angle?: string;
  script?: string;
  status?: string;
  note?: string;
  [k: string]: unknown;
}

export interface GpFollowupItem {
  day: number;
  framework?: string;
  text: string;
}

export interface GpFollowupSeq {
  id: string;
  parentLabel: string;
  items: GpFollowupItem[];
  gapDays?: number;
  createdAt?: string;
}

export interface GpSavedPlan {
  id: string;
  mode: string;
  title: string;
  channels?: string[];
  createdAt?: string;
  notionUrl?: string;
  [k: string]: unknown;
}

export interface GpClient {
  id: string;
  name: string;
  meta?: string;
  nicheIds?: string[];
  caseStudy?: GpCaseStudy;
  favorites?: { pains?: string[]; desires?: string[]; caseStudies?: string[]; offers?: string[] };
  guarantees?: Array<{ text?: string }>;
  avoid?: string[];
  frameworkOverrides?: Record<string, string>;
  competitorIntel?: Array<{ name?: string; offer?: string; mechanism?: string; guarantee?: string }>;
  icps?: GpIcp[];
  brief?: GpBrief | null;
  followups?: GpFollowupSeq[];
  growthPlans?: GpSavedPlan[];
  [k: string]: unknown;
}

export interface GpFramework {
  id: string;
  name: string;
  category?: string;
  template?: string;
  rules?: string;
  [k: string]: unknown;
}

export interface GpNiche {
  id: string;
  name?: string;
  triggerWords?: string[];
  angles?: string[];
  [k: string]: unknown;
}

export interface GpToolKB {
  id: string;
  name?: string;
  category?: string;
  channels?: string[];
  costModel?: string;
  cost?: number;
  inPerM?: number;
  outPerM?: number;
  why?: string;
  [k: string]: unknown;
}

/** The slice of config the growth components read. */
export interface GpConfig {
  clients?: GpClient[];
  frameworks?: GpFramework[];
  niches?: GpNiche[];
  toolsKB?: GpToolKB[];
  winningScripts?: Array<{ name?: string; script?: string; scope?: string }>;
  settings?: {
    growthRules?: string;
    globalRules?: string;
    notionParentId?: string;
    planDefaults?: Record<string, Record<string, unknown>>;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
