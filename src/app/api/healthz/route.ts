import { NextResponse } from "next/server";

/**
 * Process liveness probe.
 *
 * Database/schema/privilege health belongs to `/api/readyz`. Keeping liveness
 * independent prevents a database outage from making an orchestrator restart
 * an otherwise healthy Web process in a tight loop.
 */
export async function GET() {
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
