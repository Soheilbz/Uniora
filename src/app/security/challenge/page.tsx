import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/viewer";

export default async function MfaChallengePage({
  searchParams: _searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const viewer = await requireViewer();
  if (viewer.mustChangePassword) redirect("/change-password");
  /* This legacy route is intentionally retained as a safe redirect for old
     bookmarks. Tenant MFA is not an available user capability. */
  redirect("/");
}
