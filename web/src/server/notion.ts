// Notion export. Block builders + the three Notion actions (page export, schema-aware
// database-row export, and database creation). Port of legacy index.ts:211-264 + 1480-1685.

import { json } from "./shared";

// Notion rich_text content caps at 2000 chars; keep a safe margin.
export function nRich(content: string) {
  return [{ type: "text", text: { content: String(content ?? "").slice(0, 1900) } }];
}

// Convert the app's portable block list into Notion API block objects.
// deno-lint-ignore no-explicit-any
export function toNotionBlock(b: { t: string; text?: string; headers?: string[]; rows?: string[][]; children?: Array<{ t: string }> }): any {
  switch (b.t) {
    case "h1": return { object: "block", type: "heading_1", heading_1: { rich_text: nRich(b.text ?? "") } };
    case "h2": return { object: "block", type: "heading_2", heading_2: { rich_text: nRich(b.text ?? "") } };
    case "h3": return { object: "block", type: "heading_3", heading_3: { rich_text: nRich(b.text ?? "") } };
    case "callout": return { object: "block", type: "callout", callout: { rich_text: nRich(b.text ?? ""), icon: { emoji: "📌" } } };
    case "bullet": return { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: nRich(b.text ?? "") } };
    case "todo": return { object: "block", type: "to_do", to_do: { rich_text: nRich(b.text ?? ""), checked: false } };
    case "code": return { object: "block", type: "code", code: { rich_text: nRich(b.text ?? ""), language: "plain text" } };
    case "toggle": {
      const kids = (b.children ?? []).map(toNotionBlock);
      return { object: "block", type: "toggle", toggle: { rich_text: nRich(b.text ?? ""), children: kids.slice(0, 100) } };
    }
    case "image": {
      const url = String((b as { url?: string }).url ?? "");
      return { object: "block", type: "image", image: { type: "external", external: { url } } };
    }
    case "bookmark": {
      return { object: "block", type: "bookmark", bookmark: { url: String((b as { url?: string }).url ?? "") } };
    }
    case "divider": return { object: "block", type: "divider", divider: {} };
    case "table": {
      const headers = b.headers ?? [];
      const rows = b.rows ?? [];
      const width = Math.max(1, headers.length || (rows[0]?.length ?? 1));
      const norm = (cells: string[]) => {
        const a = (cells || []).slice(0, width).map((c) => nRich(c));
        while (a.length < width) a.push(nRich(""));
        return a;
      };
      const tableRows: unknown[] = [];
      if (headers.length) tableRows.push({ type: "table_row", table_row: { cells: norm(headers) } });
      rows.forEach((r) => tableRows.push({ type: "table_row", table_row: { cells: norm(r) } }));
      if (!tableRows.length) tableRows.push({ type: "table_row", table_row: { cells: norm([""]) } });
      return { object: "block", type: "table", table: { table_width: width, has_column_header: headers.length > 0, has_row_header: false, children: tableRows.slice(0, 100) } };
    }
    default: return { object: "block", type: "paragraph", paragraph: { rich_text: nRich(b.text ?? "") } };
  }
}

export function dashifyId(raw: string): string {
  const id = String(raw).replace(/-/g, "");
  return id.length === 32 ? `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}` : raw;
}

// ─── export_notion: create a page under a parent page ─────────────────────────
export async function exportNotion(body: Record<string, unknown>): Promise<Response> {
  const key = process.env.NOTION_API_KEY;
  if (!key) return json({ ok: false, error: "NOTION_API_KEY not set on the server — add it as an env secret and redeploy" }, 400);
  const parentId = dashifyId(String(body.parentId ?? "").trim());
  if (!parentId) return json({ ok: false, error: "parentId (Notion page) required" }, 400);
  const headers = { "Authorization": `Bearer ${key}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" };

  if (body.test) {
    const res = await fetch(`https://api.notion.com/v1/pages/${parentId}`, { headers });
    if (!res.ok) return json({ ok: false, error: `Notion ${res.status}: ${(await res.text()).slice(0, 200)}` }, 422);
    const data = await res.json();
    const titleProp = data?.properties ? Object.values(data.properties).find((p: unknown) => (p as { type?: string }).type === "title") : null;
    const title = (titleProp as { title?: Array<{ plain_text?: string }> })?.title?.[0]?.plain_text;
    return json({ ok: true, title: title || "(page found)" });
  }

  const blocks = Array.isArray(body.blocks) && body.blocks.length
    ? (body.blocks as Array<{ t: string }>).map(toNotionBlock)
    : [{ object: "block", type: "paragraph", paragraph: { rich_text: nRich("(empty plan)") } }];
  const createRes = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers,
    body: JSON.stringify({
      parent: { page_id: parentId },
      properties: { title: { title: nRich(String(body.title ?? "Growth Plan")) } },
      children: blocks.slice(0, 100),
    }),
  });
  if (!createRes.ok) return json({ ok: false, error: `Notion ${createRes.status}: ${(await createRes.text()).slice(0, 300)}` }, 422);
  const page = await createRes.json();
  let rest = blocks.slice(100);
  let appended = Math.min(blocks.length, 100);
  let warning = "";
  while (rest.length) {
    const chunk = rest.slice(0, 100);
    rest = rest.slice(100);
    const ap = await fetch(`https://api.notion.com/v1/blocks/${page.id}/children`, { method: "PATCH", headers, body: JSON.stringify({ children: chunk }) });
    if (!ap.ok) { warning = `Exported ${appended} of ${blocks.length} blocks — Notion ${ap.status}: ${(await ap.text()).slice(0, 200)}`; break; }
    appended += chunk.length;
  }
  return json({ ok: true, url: page.url, ...(warning ? { warning } : {}) });
}

// ─── export_notion_db: one schema-aware row in a Notion database ──────────────
export async function exportNotionDb(body: Record<string, unknown>): Promise<Response> {
  const key = process.env.NOTION_API_KEY;
  if (!key) return json({ ok: false, error: "NOTION_API_KEY not set on the server — add it as an env secret and redeploy" }, 400);
  const headers = { "Authorization": `Bearer ${key}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" };

  let dbId = dashifyId(String(body.databaseId ?? "").trim());
  const wantName = String(body.databaseName ?? "clients script testing board").trim();
  if (!dbId && wantName) {
    const sr = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers,
      body: JSON.stringify({ query: wantName, filter: { property: "object", value: "database" } }),
    });
    if (sr.ok) {
      const sd = await sr.json();
      const wn = wantName.toLowerCase();
      // deno-lint-ignore no-explicit-any
      const hit = (sd.results || []).find((r: any) => {
        const t = (r.title || []).map((x: { plain_text?: string }) => x.plain_text || "").join("").toLowerCase();
        return t === wn || t.includes(wn);
      }) || (sd.results || [])[0];
      if (hit) dbId = hit.id;
    }
  }
  if (!dbId) return json({ ok: false, error: `Couldn't find the Notion database. Set its ID in Settings, or share a database named "${wantName}" with the integration.` }, 422);

  const dbRes = await fetch(`https://api.notion.com/v1/databases/${dbId}`, { headers });
  if (!dbRes.ok) return json({ ok: false, error: `Notion ${dbRes.status}: ${(await dbRes.text()).slice(0, 200)}` }, 422);
  const db = await dbRes.json();
  // deno-lint-ignore no-explicit-any
  const props: Record<string, any> = db.properties || {};
  const names = Object.keys(props);
  const READONLY_TYPES = new Set(["formula", "rollup", "created_time", "last_edited_time", "created_by", "last_edited_by", "unique_id", "button", "verification"]);
  const writable = (nm: string) => !READONLY_TYPES.has(props[nm]?.type);
  const findProp = (aliases: string[]) => {
    for (const a of aliases) { const n = names.find((nm) => writable(nm) && nm.toLowerCase() === a); if (n) return n; }
    for (const a of aliases) { const n = names.find((nm) => writable(nm) && nm.toLowerCase().includes(a)); if (n) return n; }
    return null;
  };
  // deno-lint-ignore no-explicit-any
  const out: Record<string, any> = {};
  const titleName = names.find((n) => props[n].type === "title");
  if (titleName) out[titleName] = { title: nRich(String(body.title ?? "Script testing")) };
  const matchOption = (value: string, options: Array<{ name?: string }>): string | null => {
    const opts = (options || []).map((o) => o.name || "").filter(Boolean);
    if (!opts.length) return null;
    const v = value.toLowerCase().trim();
    const exact = opts.find((o) => o.toLowerCase() === v);
    if (exact) return exact;
    const sub = opts.find((o) => {
      const lo = o.toLowerCase();
      const short = lo.length < v.length ? lo : v;
      return short.length >= 4 && (lo.includes(v) || v.includes(lo));
    });
    return sub || null;
  };
  const setProp = (aliases: string[], value: unknown) => {
    if (value === undefined || value === null || value === "") return;
    const name = findProp(aliases);
    if (!name || name === titleName) return;
    const type = props[name].type;
    const sv = String(value);
    if (type === "rich_text") out[name] = { rich_text: nRich(sv) };
    else if (type === "select") {
      const m = matchOption(sv, props[name].select?.options || []);
      out[name] = { select: { name: m || sv } };
    } else if (type === "multi_select") {
      const opts = props[name].multi_select?.options || [];
      out[name] = { multi_select: sv.split(",").map((s) => s.trim()).filter(Boolean).map((s) => ({ name: matchOption(s, opts) || s })) };
    } else if (type === "status") {
      const m = matchOption(sv, props[name].status?.options || []);
      if (m) out[name] = { status: { name: m } };
    } else if (type === "date") out[name] = { date: { start: sv } };
    else if (type === "number") out[name] = { number: Number(value) };
    else if (type === "url") out[name] = { url: sv };
    else if (type === "title") out[name] = { title: nRich(sv) };
  };
  const f = (body.fields ?? {}) as Record<string, unknown>;
  setProp(["client", "account", "company", "customer"], f.client);
  setProp(["niche", "industry", "vertical", "category"], f.niche);
  setProp(["status", "stage", "state", "type"], f.status);
  setProp(["who", "target", "audience", "icp", "prospect"], f.target);
  setProp(["number of test", "# test", "tests", "test count", "count"], f.tests);
  setProp(["date", "day", "when"], f.date);

  const blocks = Array.isArray(body.blocks) && body.blocks.length
    ? (body.blocks as Array<{ t: string }>).map(toNotionBlock)
    : [{ object: "block", type: "paragraph", paragraph: { rich_text: nRich("(no scripts)") } }];
  const createRes = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers,
    body: JSON.stringify({ parent: { database_id: dbId }, properties: out, children: blocks.slice(0, 100) }),
  });
  if (!createRes.ok) return json({ ok: false, error: `Notion ${createRes.status}: ${(await createRes.text()).slice(0, 300)}` }, 422);
  const page = await createRes.json();
  let rest = blocks.slice(100);
  let appended = Math.min(blocks.length, 100);
  let warning = "";
  while (rest.length) {
    const chunk = rest.slice(0, 100);
    rest = rest.slice(100);
    const ap = await fetch(`https://api.notion.com/v1/blocks/${page.id}/children`, { method: "PATCH", headers, body: JSON.stringify({ children: chunk }) });
    if (!ap.ok) { warning = `Exported ${appended} of ${blocks.length} blocks — Notion ${ap.status}: ${(await ap.text()).slice(0, 200)}`; break; }
    appended += chunk.length;
  }
  return json({ ok: true, url: page.url, ...(warning ? { warning } : {}) });
}

// ─── create_notion_db: build the "clients script testing board" database ──────
export async function createNotionDb(body: Record<string, unknown>): Promise<Response> {
  const key = process.env.NOTION_API_KEY;
  if (!key) return json({ ok: false, error: "NOTION_API_KEY not set on the server" }, 400);
  const parentId = dashifyId(String(body.parentId ?? "").trim());
  if (!parentId) return json({ ok: false, error: "parentId (Notion page) required" }, 400);
  const headers = { "Authorization": `Bearer ${key}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" };
  const title = String(body.title ?? "clients script testing board");
  const res = await fetch("https://api.notion.com/v1/databases", {
    method: "POST",
    headers,
    body: JSON.stringify({
      parent: { type: "page_id", page_id: parentId },
      title: [{ type: "text", text: { content: title } }],
      properties: {
        "Name": { title: {} },
        "Client": { rich_text: {} },
        "Niche": { rich_text: {} },
        "Status": { select: { options: [
          { name: "Test idea", color: "gray" },
          { name: "Testing", color: "yellow" },
          { name: "Winner", color: "green" },
        ] } },
        "Who we're targeting": { rich_text: {} },
        "Number of tests": { number: {} },
        "Date": { date: {} },
      },
    }),
  });
  if (!res.ok) return json({ ok: false, error: `Notion ${res.status}: ${(await res.text()).slice(0, 300)}` }, 422);
  const db = await res.json();
  return json({ ok: true, id: db.id, url: db.url });
}
