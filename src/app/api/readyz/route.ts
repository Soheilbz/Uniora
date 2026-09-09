import { NextResponse } from "next/server";
import { databaseReady } from "@/db/readiness.ts";

/**
 * Readiness probe: unlike `/api/healthz`, this is allowed to fail while a
 * release has not completed migration/setup. Keep the response intentionally
 * opaque; operators need a yes/no signal, not schema details over HTTP.
 */
export async function GET() {
  try {
    if (await databaseReady()) {
      return NextResponse.json(
        { ok: true },
        { headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    }
  } catch {
    // The same 503 covers connection, schema and privilege failures. Details
    // belong in deployment logs, not in a public probe response.
  }
  return NextResponse.json(
    { ok: false },
    { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
