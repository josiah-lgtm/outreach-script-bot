// The read-only export actions consumed by the AA Client Growth Engine.
// These are a cross-app CONTRACT: the dashboard's `outreach-bot-sync` edge
// function parses these exact response shapes, so the assertions here are
// deliberately about the wire format, not the internals.

import { describe, it, expect, vi, beforeEach } from "vitest";

const getConfigRev = vi.fn();
const exportClientsLite = vi.fn();
const exportClientScripts = vi.fn();

vi.mock("../db", () => ({
  getConfigRev,
  exportClientsLite,
  exportClientScripts,
  // dispatch imports these too; never reached by the export actions.
  getConfig: vi.fn(),
  casSaveConfig: vi.fn(),
  kvGet: vi.fn().mockResolvedValue(null),
  kvSet: vi.fn(),
  kvDel: vi.fn(),
  kvKeys: vi.fn().mockResolvedValue([]),
}));

const { dispatch } = await import("../outreach");

const body = async (res: Response) => (await res.json()) as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("export_rev", () => {
  it("returns the current config revision", async () => {
    getConfigRev.mockResolvedValue(42);
    const r = await dispatch("export_rev", {});
    expect(r.status).toBe(200);
    expect(await body(r)).toEqual({ ok: true, rev: 42 });
  });

  // A brand-new install has no config row at all. The consumer compares revs
  // numerically, so a null here must not surface as `rev: null`.
  it("reports rev 0 when nothing has been saved yet", async () => {
    getConfigRev.mockResolvedValue(null);
    expect(await body(await dispatch("export_rev", {}))).toEqual({ ok: true, rev: 0 });
  });
});

describe("export_clients", () => {
  it("returns the id/name/count projection alongside the rev", async () => {
    exportClientsLite.mockResolvedValue({
      rev: 7,
      clients: [{ id: "c1", name: "Acme", meta: "SaaS", website: null, scriptCount: 3 }],
    });
    const r = await dispatch("export_clients", {});
    expect(r.status).toBe(200);
    expect(await body(r)).toEqual({
      ok: true,
      rev: 7,
      clients: [{ id: "c1", name: "Acme", meta: "SaaS", website: null, scriptCount: 3 }],
    });
  });
});

describe("export_scripts", () => {
  const payload = {
    rev: 9,
    clients: [{ id: "c1", name: "Acme", scripts: [{ id: "s1", script: "hi", status: "winning" }] }],
    niches: [{ id: "n1", name: "Dentists" }],
    frameworks: [{ id: "f1", name: "PAS", category: "cold" }],
  };

  it("passes every client through when no filter is given", async () => {
    exportClientScripts.mockResolvedValue(payload);
    const r = await dispatch("export_scripts", {});
    expect(exportClientScripts).toHaveBeenCalledWith(null);
    expect(await body(r)).toEqual({ ok: true, ...payload });
  });

  it("forwards a clientIds filter, trimmed and blank-stripped", async () => {
    exportClientScripts.mockResolvedValue(payload);
    await dispatch("export_scripts", { clientIds: [" c1 ", "", "c2", null] });
    expect(exportClientScripts).toHaveBeenCalledWith(["c1", "c2"]);
  });

  // A non-array clientIds must mean "everything", not "nothing" — silently
  // returning an empty export would look like the client has no scripts.
  it("treats a non-array clientIds as no filter", async () => {
    exportClientScripts.mockResolvedValue(payload);
    await dispatch("export_scripts", { clientIds: "c1" });
    expect(exportClientScripts).toHaveBeenCalledWith(null);
  });

  it("rejects an oversized clientIds filter", async () => {
    const r = await dispatch("export_scripts", {
      clientIds: Array.from({ length: 501 }, (_, i) => "c" + i),
    });
    expect(r.status).toBe(400);
    expect((await body(r)).ok).toBe(false);
    expect(exportClientScripts).not.toHaveBeenCalled();
  });
});
