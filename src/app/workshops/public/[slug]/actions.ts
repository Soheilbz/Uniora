"use server";
import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { currentRequestMetadata } from "@/lib/request-context.ts";
import { registerPublicWorkshopSubmission } from "@/modules/workshops/public-registration.ts";

export async function registerPublicWorkshop(formData: FormData) {
  const slug = String(formData.get("slug") ?? "").trim();
  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const reference = String(formData.get("reference") ?? "").trim();
  const consent = formData.get("consent") === "on";
  if (
    !consent ||
    !/^[A-Za-z0-9_-]{3,120}$/.test(slug) ||
    fullName.length < 2 ||
    fullName.length > 200
  )
    redirect(`/workshops/public/${encodeURIComponent(slug)}?error=invalid`);
  const request = await currentRequestMetadata();
  const salt = process.env.PUBLIC_FORM_RATE_SALT?.trim();
  if (!salt) throw new Error("PUBLIC_FORM_RATE_SALT is required for public forms");
  const rateKey = createHash("sha256")
    .update(`${salt}\0${request.ipAddress ?? "unknown"}\0${slug}`)
    .digest("hex");
  try {
    await registerPublicWorkshopSubmission({
      slug,
      fullName,
      email: email || null,
      phone: phone || null,
      reference: reference || null,
      rateKey,
    });
  } catch {
    redirect(`/workshops/public/${encodeURIComponent(slug)}?error=closed`);
  }
  redirect(`/workshops/public/${encodeURIComponent(slug)}?registered=1`);
}
