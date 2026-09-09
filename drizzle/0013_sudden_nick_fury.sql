-- Faculty membership regains its third state.
--
-- The column was `boolean NOT NULL DEFAULT true`. A personnel file transcribed
-- into this directory often does not answer the question at all, and a boolean
-- has nowhere to put that: every one of those records arrived carrying a stated
-- «yes» — which is precisely the answer that qualifies somebody to chair an
-- examining board. The directory is allowed not to know something. It is not
-- allowed to invent the answer.
--
-- Text and not an enum, matching the register it is a rewrite of: the stored
-- value is the word itself, so a query, an export and a printed return all read
-- the same as the screen.
--
-- WHAT HAPPENS TO THE ROWS THAT ARE HERE
--
-- A `false` was necessarily written by somebody — the default could not produce
-- it — so it becomes «no».
--
-- A `true` cannot be told apart from the default that produced it. Every row in
-- this database holds one, and every one of them came from the seeder, which
-- never wrote this column at all; nothing has ever recorded an answer here. So
-- a `true` becomes NULL rather than «yes»: keeping it would carry the very
-- fabrication this migration exists to undo, and re-asking four development
-- records is nothing against a directory that states memberships nobody
-- granted.
ALTER TABLE "professors"
  ALTER COLUMN "is_faculty_member" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "professors"
  ALTER COLUMN "is_faculty_member" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "professors"
  ALTER COLUMN "is_faculty_member" SET DATA TYPE text
  USING (CASE WHEN "is_faculty_member" IS FALSE THEN 'no' END);--> statement-breakpoint
-- One person, one place, on one workshop's register — see the note on the two
-- indexes in `schema.ts`. Both are partial: over live rows only, because a
-- tombstone would reserve somebody's place for ever, and skipping the guest
-- identifier when it is blank, because two guests with no id recorded are
-- either one person twice or two people and nothing here can tell which.
CREATE UNIQUE INDEX "participants_tenant_workshop_student_idx" ON "workshop_participants" USING btree ("tenant_id","workshop_id","student_id") WHERE deleted_at is null and student_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "participants_tenant_workshop_guest_idx" ON "workshop_participants" USING btree ("tenant_id","workshop_id","external_national_id") WHERE deleted_at is null and external_national_id is not null and btrim(external_national_id) <> '';
