// Minimal className joiner (clsx-lite). Falsy values are dropped; later classes win
// only by source order — primitives keep variant classes ahead of the passthrough
// `className` so callers can override.
export type ClassValue = string | number | false | null | undefined;

export function cn(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(" ");
}
