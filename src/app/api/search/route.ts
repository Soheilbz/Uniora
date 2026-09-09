import { NextResponse } from "next/server";
import { MAX_SEARCH_LENGTH } from "@/lib/input-limits";
import { searchGlobalDatabase } from "@/modules/search/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2 || query.length > MAX_SEARCH_LENGTH) {
    return NextResponse.json({
      students: [],
      professors: [],
      councilMeetings: [],
      councilDecisions: [],
      workshops: [],
    });
  }
  const results = await searchGlobalDatabase(query);
  return NextResponse.json(results, { headers: { "Cache-Control": "private, no-store" } });
}
