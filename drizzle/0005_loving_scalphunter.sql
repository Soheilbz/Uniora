ALTER TABLE "students" ADD COLUMN "search_text" text GENERATED ALWAYS AS (app.fold_text(
        coalesce(student_number, '') || ' ' ||
        coalesce(national_id, '') || ' ' ||
        coalesce(first_name, '') || ' ' ||
        coalesce(last_name, '') || ' ' ||
        coalesce(father_name, '')
      )) STORED;--> statement-breakpoint
CREATE INDEX "students_search_idx" ON "students" USING gin ("search_text" gin_trgm_ops);