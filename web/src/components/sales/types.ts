// Local, component-facing config slice for the Sales screen. The config document is
// loosely shaped (the legacy app was untyped JS); these interfaces name only the fields
// the sales components read, with an index signature for the rest — keeping the
// components free of bare `any` (the eslint rule that's off only inside lib/server/store).

import type { ChannelAssumptions } from "@/lib/funnel-math";

/** The sales-doc visibility/section config (legacy sellerProfile.salesDoc). */
export interface SpSalesDoc {
  prompt?: string;
  mention?: string[];
  custom?: Array<{ heading?: string; body?: string }>;
  show?: Partial<
    Record<"intro" | "brief" | "how" | "expect" | "who" | "included" | "investment" | "next", boolean>
  >;
  headings?: Record<string, string>;
}

/** The agency's own profile, pitched in the doc (legacy config.sellerProfile). */
export interface SellerProfile {
  name?: string;
  founder?: string;
  logo?: string;
  whoWeAre?: string;
  trackRecord?: string;
  whyDifferent?: string[];
  caseStudies?: Array<{ name?: string; result?: string; link?: string }>;
  socialLinks?: Array<{ url?: string; label?: string }>;
  deliverables?: string[];
  guarantee?: string;
  programCost?: number;
  costNote?: string;
  process?: Array<{ phase?: string; items?: string[] }>;
  howWeFindLeads?: string;
  howWeQualify?: string;
  salesDoc?: SpSalesDoc;
  [k: string]: unknown;
}

export interface SaFramework {
  id: string;
  name: string;
  category?: string;
  template?: string;
  rules?: string;
  [k: string]: unknown;
}

/** The slice of config the sales components read. */
export interface SaConfig {
  prospects?: unknown[];
  frameworks?: SaFramework[];
  sellerProfile?: SellerProfile;
  settings?: {
    growthRules?: string;
    globalRules?: string;
    notionParentId?: string;
    planDefaults?: Record<string, ChannelAssumptions>;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
