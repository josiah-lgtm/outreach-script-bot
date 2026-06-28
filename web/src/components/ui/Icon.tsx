// Tabler icon wrapper. The legacy app referenced icons by their webfont class name
// (e.g. "ti-arrows-minimize") — including user-configurable ones stored in config
// (builder-button icons). This maps those names to the tree-shakeable
// @tabler/icons-react components (importing the whole namespace would bloat the
// client bundle). Unknown names fall back to a neutral dot so nothing ever crashes.
//
// NOTE: the legacy Tabler webfont was never actually loaded, so icons were invisible.
// Rendering real SVGs here is the deliberate, acceptable visual change noted in HANDOFF.

import {
  IconAdjustmentsHorizontal,
  IconAlertTriangle,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowLeft,
  IconArrowsMinimize,
  IconArrowsMove,
  IconBandage,
  IconBolt,
  IconBrandNotion,
  IconBulb,
  IconCheck,
  IconCheckbox,
  IconChecks,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconCrosshair,
  IconDeviceFloppy,
  IconDownload,
  IconEdit,
  IconEraser,
  IconFeather,
  IconFilePlus,
  IconFileText,
  IconFilter,
  IconFlag,
  IconFlask,
  IconHeart,
  IconHistory,
  IconIdBadge2,
  IconInbox,
  IconLayoutDashboard,
  IconLayoutGrid,
  IconLayoutList,
  IconLoader2,
  IconMessageCircle,
  IconMoodSmile,
  IconPlug,
  IconPlus,
  IconPoint,
  IconRefresh,
  IconSearch,
  IconShieldCheck,
  IconSparkles,
  IconTarget,
  IconTrash,
  IconTrendingUp,
  IconTrophy,
  IconUpload,
  IconWand,
  IconWorldSearch,
  IconX,
  type IconProps as TablerIconProps,
} from "@tabler/icons-react";
import type { ComponentType } from "react";

type TablerIcon = ComponentType<TablerIconProps>;

// Keyed by the legacy `ti-*` name (the `ti-` prefix is optional at call sites).
const MAP: Record<string, TablerIcon> = {
  "adjustments-horizontal": IconAdjustmentsHorizontal,
  "alert-triangle": IconAlertTriangle,
  "arrow-back-up": IconArrowBackUp,
  "arrow-forward-up": IconArrowForwardUp,
  "arrow-left": IconArrowLeft,
  "arrows-minimize": IconArrowsMinimize,
  "arrows-move": IconArrowsMove,
  bandage: IconBandage,
  bolt: IconBolt,
  "brand-notion": IconBrandNotion,
  bulb: IconBulb,
  check: IconCheck,
  checkbox: IconCheckbox,
  checks: IconChecks,
  "chevron-down": IconChevronDown,
  "chevron-left": IconChevronLeft,
  "chevron-right": IconChevronRight,
  "chevron-up": IconChevronUp,
  crosshair: IconCrosshair,
  "device-floppy": IconDeviceFloppy,
  download: IconDownload,
  edit: IconEdit,
  eraser: IconEraser,
  feather: IconFeather,
  "file-plus": IconFilePlus,
  "file-text": IconFileText,
  filter: IconFilter,
  flag: IconFlag,
  flask: IconFlask,
  heart: IconHeart,
  history: IconHistory,
  "id-badge-2": IconIdBadge2,
  inbox: IconInbox,
  "layout-dashboard": IconLayoutDashboard,
  "layout-grid": IconLayoutGrid,
  "layout-list": IconLayoutList,
  "loader-2": IconLoader2,
  "message-circle": IconMessageCircle,
  "mood-smile": IconMoodSmile,
  plug: IconPlug,
  plus: IconPlus,
  point: IconPoint,
  refresh: IconRefresh,
  search: IconSearch,
  "shield-check": IconShieldCheck,
  sparkles: IconSparkles,
  target: IconTarget,
  trash: IconTrash,
  "trending-up": IconTrendingUp,
  trophy: IconTrophy,
  upload: IconUpload,
  wand: IconWand,
  "world-search": IconWorldSearch,
  x: IconX,
};

export interface IconProps extends Omit<TablerIconProps, "ref"> {
  /** Legacy `ti-*` name (prefix optional) or bare name, e.g. "ti-search" / "search". */
  name: string;
  /** Pixel size; defaults to 1em so it inherits font-size like the webfont did. */
  size?: number | string;
}

export function Icon({ name, size = "1em", stroke = 1.75, ...rest }: IconProps) {
  const key = String(name || "").replace(/^ti-/, "");
  const Cmp = MAP[key] ?? IconPoint;
  return <Cmp size={size} stroke={stroke} aria-hidden {...rest} />;
}

/** True when an icon name resolves to a real glyph (for admin icon-pickers). */
export function hasIcon(name: string): boolean {
  return String(name || "").replace(/^ti-/, "") in MAP;
}

/** All known icon names (with `ti-` prefix) — useful for pickers. */
export const ICON_NAMES: string[] = Object.keys(MAP).map((k) => "ti-" + k);
