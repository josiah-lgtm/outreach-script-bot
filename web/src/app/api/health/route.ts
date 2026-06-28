// Liveness probe for the Docker healthcheck.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ ok: true, service: "outreach-bot-web" });
}
