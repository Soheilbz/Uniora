ALTER TABLE "council_decisions" ADD COLUMN "search_text" text GENERATED ALWAYS AS (app.fold_text(
        coalesce(student_name, '') || ' ' ||
        coalesce(student_number, '') || ' ' ||
        coalesce(thesis_title, '') || ' ' ||
        coalesce(thesis_code, '') || ' ' ||
        coalesce(meeting_number, '') || ' ' ||
        coalesce(decision_text, '')
      )) STORED;--> statement-breakpoint
CREATE INDEX "council_decisions_search_idx" ON "council_decisions" USING gin ("search_text" gin_trgm_ops);