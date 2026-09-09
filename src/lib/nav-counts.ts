import { eq, sql } from "drizzle-orm";
import { cache } from "react";
import { councilDecisions, professors, students, tenants } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import { logError } from "@/lib/logger.ts";
import { can, type Viewer } from "./capabilities.ts";

/**
 * The figures beside the menu entries.
 *
 * ── Why the sidebar counts anything at all ──────────────────────────────────
 *
 * «دانشجویان ۵٬۸۱۶» answers, without a click, the question a clerk otherwise
 * opens the register to ask. It is also how somebody notices that an import
 * landed, or that it did not.
 *
 * Counted only for the registers this person may open — a count is a fact about
 * the institution's records, and somebody without `students.view` should not
 * learn the size of the student body from the menu.
 *
 * One transaction, and `cache()` around it: the shell renders on every
 * navigation, and these three counts are cheap individually and not cheap
 * multiplied by every page load of every operator.
 */

export type NavCounts = Partial<Record<string, number>>;

export const navCounts = cache(async (viewer: Viewer): Promise<NavCounts> => {
  const wanted = {
    students: can(viewer, "students.view"),
    professors: can(viewer, "professors.view"),
    council: can(viewer, "council.view"),
  };

  if (!wanted.students && !wanted.professors && !wanted.council) return {};

  try {
    return await readOnly(viewer.tenantId, async (tx) => {
      /*
       * The shell is rendered on every navigation. Three independent count
       * queries made the common case pay three database round trips even
       * though the figures are read together and share the same tenant scope.
       * Scalar subqueries keep each count's exact predicate while selecting
       * the complete menu snapshot in one round trip.
       */
      const [row] = await tx
        .select({
          students: wanted.students
            ? sql<number>`(select count(*)::int from ${students} where ${students.tenantId} = ${viewer.tenantId} and ${students.deletedAt} is null and ${students.status} = 'enrolled')`
            : sql<number>`0`,
          professors: wanted.professors
            ? sql<number>`(select count(*)::int from ${professors} where ${professors.tenantId} = ${viewer.tenantId} and ${professors.deletedAt} is null)`
            : sql<number>`0`,
          council: wanted.council
            ? sql<number>`(select count(*)::int from ${councilDecisions} where ${councilDecisions.tenantId} = ${viewer.tenantId} and ${councilDecisions.deletedAt} is null)`
            : sql<number>`0`,
        })
        .from(tenants)
        .where(eq(tenants.id, viewer.tenantId))
        .limit(1);

      const counts: NavCounts = {};
      if (wanted.students) counts.students = row?.students ?? 0;
      if (wanted.professors) counts.professors = row?.professors ?? 0;
      if (wanted.council) counts["council-decisions"] = row?.council ?? 0;
      return counts;
    });
  } catch (cause) {
    /*
     * No counts rather than zeroes, and never an error.
     *
     * The menu has to render — it is how somebody navigates away from whatever
     * is broken. A badge is an ornament on that; «۰ دانشجو» beside a register
     * holding six thousand is worse than no badge, and a thrown error here would
     * take down every page in the application at once.
     */
    logError("navigation.counts_read_failed", cause, { tenantId: viewer.tenantId });
    return {};
  }
});
