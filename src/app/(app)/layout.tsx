import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireViewer } from "@/lib/viewer";

/**
 * The gate every authenticated screen sits behind.
 *
 * One `requireViewer` here rather than one per page, and it is a real boundary
 * rather than a convenience: a page added under this segment is authenticated
 * whether or not its author remembered to be, because the layout renders first
 * and redirects before the page function is ever called.
 *
 * It is not a substitute for scoping. Knowing *who* is asking is what this
 * establishes; every query still has to say which university's rows it wants,
 * through `withTenant`, and row-level security is what enforces that. This layer
 * decides whether there is a viewer at all.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await requireViewer();
  if (viewer.mustChangePassword) redirect("/change-password");
  if (viewer.requireMfa && !viewer.mfaEnabled) redirect("/security/setup");
  if (viewer.requireMfa && viewer.mfaEnabled && !viewer.mfaVerified)
    redirect("/security/challenge");
  return <AppShell viewer={viewer}>{children}</AppShell>;
}
