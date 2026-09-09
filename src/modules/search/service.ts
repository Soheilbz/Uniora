import { and, desc, inArray, sql } from "drizzle-orm";
import { getLocale, getTranslations } from "next-intl/server";
import { searchDocuments } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import { type Capability, can } from "@/lib/capabilities.ts";
import { toLocaleDigits } from "@/lib/digits.ts";
import { requireViewer } from "@/lib/viewer.ts";

export type GlobalSearchCategory =
  | "students"
  | "professors"
  | "councilMeetings"
  | "councilDecisions"
  | "workshops";

export interface GlobalSearchResultItem {
  id: string;
  title: string;
  subtitle?: string | null | undefined;
  href: string;
  category: GlobalSearchCategory;
}

export interface GlobalSearchResults {
  students: GlobalSearchResultItem[];
  professors: GlobalSearchResultItem[];
  councilMeetings: GlobalSearchResultItem[];
  councilDecisions: GlobalSearchResultItem[];
  workshops: GlobalSearchResultItem[];
}

const CATEGORY_CAPABILITY: Readonly<Record<GlobalSearchCategory, Capability>> = {
  students: "students.view",
  professors: "professors.view",
  councilMeetings: "council.view",
  councilDecisions: "council.view",
  workshops: "workshops.view",
};

const CATEGORIES = Object.keys(CATEGORY_CAPABILITY) as GlobalSearchCategory[];

function emptyResults(): GlobalSearchResults {
  return {
    students: [],
    professors: [],
    councilMeetings: [],
    councilDecisions: [],
    workshops: [],
  };
}

/**
 * Unified global search backed by the PostgreSQL projection.
 *
 * Source-table triggers keep `search_documents` transactionally fresh. The
 * projection does not replace source authorization: every returned category is
 * checked again against the current viewer's closed capability vocabulary.
 */
export async function searchGlobalDatabase(rawQuery: string): Promise<GlobalSearchResults> {
  const viewer = await requireViewer();
  const query = rawQuery.trim();
  if (!query || query.length < 2 || query.length > 200) return emptyResults();

  const allowedCategories = CATEGORIES.filter((category) =>
    can(viewer, CATEGORY_CAPABILITY[category]),
  );
  if (allowedCategories.length === 0) return emptyResults();

  const allowedCapabilities = [
    ...new Set(allowedCategories.map((category) => CATEGORY_CAPABILITY[category])),
  ];
  const words = query.split(/\s+/).filter(Boolean).slice(0, 5);
  const [t, locale] = await Promise.all([getTranslations("search"), getLocale()]);
  const digits = (value: string | null | undefined) => toLocaleDigits(value ?? "", locale);

  const rows = await readOnly(viewer.tenantId, (tx) => {
    const predicates = [
      inArray(searchDocuments.entityType, allowedCategories),
      inArray(searchDocuments.visibilityCapability, allowedCapabilities),
    ];
    for (const word of words) {
      predicates.push(sql`${searchDocuments.searchText} LIKE '%' || app.fold_text(${word}) || '%'`);
    }

    return tx
      .select({
        id: searchDocuments.entityId,
        entityType: searchDocuments.entityType,
        title: searchDocuments.title,
        subtitle: searchDocuments.subtitle,
        href: searchDocuments.href,
        visibilityCapability: searchDocuments.visibilityCapability,
      })
      .from(searchDocuments)
      .where(and(...predicates))
      .orderBy(
        desc(sql`similarity(${searchDocuments.searchText}, app.fold_text(${query}))`),
        desc(searchDocuments.sourceUpdatedAt),
      )
      .limit(40);
  });

  const results = emptyResults();
  for (const row of rows) {
    const category = row.entityType as GlobalSearchCategory;
    if (!(category in CATEGORY_CAPABILITY)) continue;
    const required = CATEGORY_CAPABILITY[category];
    if (row.visibilityCapability !== required || !can(viewer, required)) continue;
    if (results[category].length >= 5) continue;

    const title =
      category === "councilMeetings" ? t("meetingTitle", { number: digits(row.title) }) : row.title;

    results[category].push({
      id: row.id,
      title,
      subtitle: row.subtitle ? digits(row.subtitle) : null,
      href: row.href,
      category,
    });
  }

  return results;
}
