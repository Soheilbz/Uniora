import { and, asc, isNull, sql } from "drizzle-orm";
import { councilPermanentMembers, professors } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";

/**
 * Who sits on the council.
 *
 * The reading half; the writes are Server Actions in `roster-actions.ts`,
 * because a module a client component imports a type from must not also carry
 * `"use server"` exports it does not use.
 */

export interface RosterSeat {
  id: string;
  version: number;
  memberName: string;
  professorId: string | null;
  /** The directory's spelling, where the seat is linked to a directory row. */
  professorName: string | null;
  sortOrder: number;
}

export async function readRoster(tenantId: string): Promise<RosterSeat[]> {
  return readOnly(tenantId, (tx) =>
    tx
      .select({
        id: councilPermanentMembers.id,
        version: councilPermanentMembers.version,
        memberName: councilPermanentMembers.memberName,
        professorId: councilPermanentMembers.professorId,
        /*
         * Read live from the directory rather than copied onto the seat. The
         * roster answers «who sits on the council *now*», so a member who is
         * renamed should be renamed here — unlike a minute, which keeps the
         * spelling it was signed with.
         */
        professorName: sql<
          string | null
        >`(select p.first_name || ' ' || p.last_name from professors p
                                        where p.id = ${councilPermanentMembers.professorId}
                                          and p.deleted_at is null)`,
        sortOrder: councilPermanentMembers.sortOrder,
      })
      .from(councilPermanentMembers)
      .where(isNull(councilPermanentMembers.deletedAt))
      .orderBy(asc(councilPermanentMembers.sortOrder), asc(councilPermanentMembers.memberName)),
  );
}

/** The directory, for the pickers that link a name to a professor. */
export interface DirectoryEntry {
  id: string;
  name: string;
  rank: string | null;
  department: string | null;
}

/**
 * A bounded directory page for council pickers.
 *
 * The picker must be able to reach every academic without serialising the whole
 * directory into the page. The initial call returns a small surname-sorted
 * window; typing searches the indexed generated `professors.search_text`.
 * Visiting lecturers remain eligible exactly as before.
 */
export async function readDirectory(
  tenantId: string,
  search = "",
  limit = 40,
): Promise<DirectoryEntry[]> {
  const needle = search.trim().slice(0, 120);
  const cappedLimit = Math.min(Math.max(limit, 1), 60);
  return readOnly(tenantId, (tx) =>
    tx
      .select({
        id: professors.id,
        name: sql<string>`${professors.firstName} || ' ' || ${professors.lastName}`,
        rank: professors.academicRank,
        department: professors.department,
      })
      .from(professors)
      .where(
        and(
          isNull(professors.deletedAt),
          needle
            ? sql`${professors.searchText} LIKE '%' || app.fold_text(${needle}) || '%'`
            : undefined,
        ),
      )
      .orderBy(asc(professors.lastName), asc(professors.firstName))
      .limit(cappedLimit),
  );
}
