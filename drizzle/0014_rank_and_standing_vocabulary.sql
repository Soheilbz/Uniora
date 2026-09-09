-- The academic ladder gets the spelling the regulation types on.
--
-- The four rungs were stored as `assistant` / `associate` / `professor`. The
-- supervision-capacity regulation keys its allowance tables by rank and spells
-- them `assistant_professor` / `associate_professor` / `full_professor`, so a
-- register using the short forms produces a professor with no allowance at all
-- rather than an error anybody sees. Cheap now, when four rows hold a rank;
-- expensive once the engine reads them.
--
-- `instructor` is unchanged and is left alone rather than rewritten to itself.
--
-- Both halves, in this order: the vocabulary row first, then the records that
-- resolve through it. The reverse would leave every professor pointing at a
-- value the lookup table no longer offers, and the register renders that as the
-- raw stored key.
UPDATE "lookups" SET "value" = 'assistant_professor'
  WHERE "set" = 'academic_ranks' AND "value" = 'assistant';--> statement-breakpoint
UPDATE "lookups" SET "value" = 'associate_professor'
  WHERE "set" = 'academic_ranks' AND "value" = 'associate';--> statement-breakpoint
UPDATE "lookups" SET "value" = 'full_professor'
  WHERE "set" = 'academic_ranks' AND "value" = 'professor';--> statement-breakpoint

UPDATE "professors" SET "academic_rank" = 'assistant_professor'
  WHERE "academic_rank" = 'assistant';--> statement-breakpoint
UPDATE "professors" SET "academic_rank" = 'associate_professor'
  WHERE "academic_rank" = 'associate';--> statement-breakpoint
UPDATE "professors" SET "academic_rank" = 'full_professor'
  WHERE "academic_rank" = 'professor';--> statement-breakpoint

-- Employment standing gets the office's own list.
--
-- The starting set was invented here — «فرصت مطالعاتی», «مأمور به خدمت» — while
-- the register models the ten states an office actually files people
-- under, including the three that a personnel department has to be able to
-- record and this list could not hold at all: «انفصال از خدمت», «فوت», and
-- «در انتظار بازنشستگی».
--
-- Only rows nobody has edited and nobody is using are touched. `label` matching
-- the seeded wording is the test of "unedited": an administrator who renamed an
-- entry has made a decision about it, and this migration is not entitled to
-- undo that. A standing some professor actually holds is left in place for the
-- same reason — it would orphan their record.
DELETE FROM "lookups" l
 WHERE l."set" = 'professor_statuses'
   AND (l."value", l."label") IN (
     ('sabbatical', 'فرصت مطالعاتی'),
     ('leave', 'مرخصی'),
     ('seconded', 'مأمور به خدمت'),
     ('resigned', 'قطع همکاری')
   )
   AND NOT EXISTS (
     SELECT 1 FROM "professors" p
      WHERE p."tenant_id" = l."tenant_id" AND p."status" = l."value"
   );--> statement-breakpoint

-- The states the office files people under, added for every tenant that has this
-- vocabulary at all. `position` continues past whatever the tenant already
-- holds, so an administrator's own ordering is not renumbered underneath them.
INSERT INTO "lookups" ("tenant_id", "set", "value", "label", "position")
SELECT t."tenant_id", 'professor_statuses', v."value", v."label",
       t."next" + v."offset"
  FROM (
    SELECT "tenant_id", coalesce(max("position"), 0) + 10 AS "next"
      FROM "lookups" WHERE "set" = 'professor_statuses' GROUP BY "tenant_id"
  ) t
  CROSS JOIN (VALUES
    ('pending_retirement', 'در انتظار بازنشستگی', 0),
    ('unpaid_leave',       'مرخصی بدون حقوق',     10),
    ('sick_leave',         'مرخصی استعلاجی',      20),
    ('study_leave',        'اعزام به تحصیل',      30),
    ('on_mission',         'مأموریت',             40),
    ('resigned',           'استعفا داده',         50),
    ('dismissed',          'انفصال از خدمت',      60),
    ('deceased',           'فوت',                 70)
  ) AS v("value", "label", "offset")
 WHERE NOT EXISTS (
   SELECT 1 FROM "lookups" x
    WHERE x."tenant_id" = t."tenant_id"
      AND x."set" = 'professor_statuses'
      AND x."value" = v."value"
 );
