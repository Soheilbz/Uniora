import { NextResponse } from "next/server";
import { isValidTenantSlug } from "@/lib/auth-username.ts";
import { readPublicSsoProviders } from "@/modules/integrations/public-sso.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const tenant = new URL(request.url).searchParams.get("tenant")?.trim().toLowerCase() ?? "";
  if (!isValidTenantSlug(tenant)) {
    return NextResponse.json(
      { providers: [] },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const providers = await readPublicSsoProviders(tenant);

  return NextResponse.json(
    { providers },
    { headers: { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" } },
  );
}
