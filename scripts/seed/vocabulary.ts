import { and, eq } from "drizzle-orm";
import type { adminDb } from "../../src/db/admin.ts";
import * as schema from "../../src/db/schema.ts";
import { VOCABULARY } from "../../src/db/vocabulary.ts";

export async function seedVocabulary(db: ReturnType<typeof adminDb>, tenantId: string) {
  /*
   * Set by set, not all-or-nothing.
   *
   * A release that adds a starting vocabulary has to be able to deliver it to
   * an institution that already runs this software — otherwise the eight lists
   * behind the personnel fields exist for a university installed tomorrow and
   * for nobody installed yesterday, and the fields that resolve through them
   * render as empty selects on every existing tenant.
   *
   * Per *set* rather than per entry, and that is the careful half: these lists
   * are the office's to edit. Topping up a set they already hold would
   * resurrect every entry they have retired, one release after they retired it.
   * A set they have never seen is one they cannot have had an opinion about.
   */
  const held = await db
    .selectDistinct({ set: schema.lookups.set })
    .from(schema.lookups)
    .where(eq(schema.lookups.tenantId, tenantId));
  const alreadyHere = new Set(held.map((row) => row.set));

  /** `set:value` → row id, so a child can name its parent by value. */
  const ids = new Map<string, string>();
  let total = 0;
  let added = 0;

  for (const vocabulary of VOCABULARY) {
    if (alreadyHere.has(vocabulary.set)) {
      /*
       * Its ids are still needed: a nested set seeded in this run names its
       * parent by value, and the parent may be one the tenant already holds.
       */
      const rows = await db
        .select({ id: schema.lookups.id, value: schema.lookups.value })
        .from(schema.lookups)
        .where(and(eq(schema.lookups.tenantId, tenantId), eq(schema.lookups.set, vocabulary.set)));
      for (const row of rows) ids.set(`${vocabulary.set}:${row.value}`, row.id);
      continue;
    }

    const rows = vocabulary.entries.map((entry, index) => {
      let parentId: string | null = null;
      if (entry.parent) {
        if (!vocabulary.parentSet) {
          throw new Error(`${vocabulary.set}.${entry.value} names a parent but the set has none`);
        }
        parentId = ids.get(`${vocabulary.parentSet}:${entry.parent}`) ?? null;
        if (!parentId) {
          throw new Error(
            `${vocabulary.set}.${entry.value} names ${vocabulary.parentSet}.${entry.parent}, which is not seeded`,
          );
        }
      }
      return {
        tenantId,
        set: vocabulary.set,
        value: entry.value,
        label: entry.label,
        parentId,
        // The office's order, spaced so an entry can be inserted between two
        // existing ones later without renumbering the whole set.
        position: (index + 1) * 10,
      };
    });

    const written = await db
      .insert(schema.lookups)
      .values(rows)
      .returning({ id: schema.lookups.id, value: schema.lookups.value });

    for (const row of written) ids.set(`${vocabulary.set}:${row.value}`, row.id);
    total += written.length;
    added += 1;
  }

  console.log(
    added === 0
      ? "vocabulary already present"
      : `vocabulary: ${added} of ${VOCABULARY.length} sets installed, ${total} entries`,
  );
}
