// SSRF guard + site fetching. fetchSiteText pulls arbitrary user-supplied URLs server-side,
// so it must refuse loopback / link-local / private / cloud-metadata addresses and re-check
// every redirect hop. Port of legacy index.ts:485-567 + 600-604
// (Deno.resolveDns → node:dns/promises).

import { promises as dns } from "node:dns";

function ipIsPrivate(ip: string): boolean {
  const s = ip.trim().toLowerCase();
  if (s.includes(":")) { // IPv6
    if (s === "::1" || s === "::") return true;
    if (s.startsWith("fe80") || s.startsWith("fc") || s.startsWith("fd")) return true; // link-local + unique-local
    const m = s.match(/(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped (::ffff:a.b.c.d)
    return m ? ipIsPrivate(m[1]) : false;
  }
  const p = s.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true;     // this-network, private, loopback
  if (a === 169 && b === 254) return true;               // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true;      // private
  if (a === 192 && b === 168) return true;               // private
  if (a === 100 && b >= 64 && b <= 127) return true;     // CGNAT
  return false;
}

function hostIsBlocked(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase(); // strip IPv6 brackets
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^[0-9.]+$/.test(h) || h.includes(":")) return ipIsPrivate(h); // literal IP
  return false;
}

// Best-effort DNS-rebinding defense: reject if a hostname resolves to a private IP.
async function hostResolvesPrivate(hostname: string): Promise<boolean> {
  const h = hostname.replace(/^\[|\]$/g, "");
  if (/^[0-9.]+$/.test(h) || h.includes(":")) return false; // literal IP already checked
  try {
    const a4 = await dns.resolve4(h).catch(() => [] as string[]);
    const a6 = await dns.resolve6(h).catch(() => [] as string[]);
    const all = [...a4, ...a6];
    return all.length > 0 && all.some(ipIsPrivate);
  } catch { return false; }
}

async function assertPublicUrl(u: URL): Promise<void> {
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`blocked scheme ${u.protocol}`);
  if (hostIsBlocked(u.hostname)) throw new Error(`blocked host ${u.hostname}`);
  if (await hostResolvesPrivate(u.hostname)) throw new Error(`host resolves to a private address: ${u.hostname}`);
}

// fetch that validates the initial URL and every redirect hop.
async function safeFetch(target: string, init: RequestInit, maxHops = 5): Promise<Response> {
  let url = new URL(target);
  for (let hop = 0; hop <= maxHops; hop++) {
    await assertPublicUrl(url);
    const res = await fetch(url, { ...init, redirect: "manual" });
    const loc = (res.status >= 300 && res.status < 400) ? res.headers.get("location") : null;
    if (loc) { url = new URL(loc, url); continue; }
    return res;
  }
  throw new Error("too many redirects");
}

export function normalizeUrl(rawUrl: string): string {
  let target = rawUrl.trim();
  if (!/^https?:\/\//i.test(target)) target = "https://" + target;
  return target;
}

export async function fetchSiteText(rawUrl: string): Promise<{ ok: true; target: string; text: string } | { ok: false; error: string }> {
  let target = rawUrl.trim();
  if (!/^https?:\/\//i.test(target)) target = "https://" + target;
  try {
    const res = await safeFetch(target, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OutreachBot/3.0)" },
      signal: AbortSignal.timeout(12_000),
    });
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 11_000);
    if (text.length < 100) return { ok: false, error: `Fetched ${target} but found almost no readable text (JS-rendered site?)` };
    return { ok: true, target, text };
  } catch (err) {
    return { ok: false, error: `Could not fetch ${target}: ${String((err as Error).message ?? err)}` };
  }
}
