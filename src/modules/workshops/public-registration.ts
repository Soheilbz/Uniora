import { sql } from "drizzle-orm";
import { db } from "@/db/client.ts";

export async function registerPublicWorkshopSubmission(input: {
  slug: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  reference: string | null;
  rateKey: string;
}): Promise<void> {
  await db().execute(sql`
    select app.register_public_workshop(
      ${input.slug}, ${input.fullName}, ${input.email}, ${input.phone}, ${input.reference}, ${input.rateKey}
    )
  `);
}
