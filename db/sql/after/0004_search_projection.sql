-- Unified search projection.
-- The projection is maintained in the same transaction as source mutations.
-- SECURITY INVOKER is intentional: RLS and the caller's tenant context remain authoritative.

CREATE OR REPLACE FUNCTION app.refresh_search_documents(p_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, app AS $$
BEGIN
  DELETE FROM search_documents WHERE tenant_id = p_tenant;

  INSERT INTO search_documents
    (tenant_id, entity_type, entity_id, title, subtitle, href, search_text, visibility_capability, source_updated_at)
  SELECT tenant_id, 'students', id::text,
         btrim(first_name || ' ' || last_name), coalesce(student_number, ''),
         '/students/' || id::text, search_text, 'students.view', updated_at
    FROM students
   WHERE tenant_id = p_tenant AND deleted_at IS NULL;

  INSERT INTO search_documents
    (tenant_id, entity_type, entity_id, title, subtitle, href, search_text, visibility_capability, source_updated_at)
  SELECT tenant_id, 'professors', id::text,
         btrim(first_name || ' ' || last_name),
         concat_ws(' — ', nullif(academic_rank, ''), nullif(department, ''), nullif(professor_code, '')),
         '/professors/' || id::text, search_text, 'professors.view', updated_at
    FROM professors
   WHERE tenant_id = p_tenant AND deleted_at IS NULL;

  INSERT INTO search_documents
    (tenant_id, entity_type, entity_id, title, subtitle, href, search_text, visibility_capability, source_updated_at)
  SELECT tenant_id, 'councilMeetings', id::text, meeting_number,
         concat_ws(' — ', meeting_date::text, nullif(research_deputy, '')),
         '/council-meetings/' || id::text, search_text, 'council.view', updated_at
    FROM council_meetings
   WHERE tenant_id = p_tenant AND deleted_at IS NULL;

  INSERT INTO search_documents
    (tenant_id, entity_type, entity_id, title, subtitle, href, search_text, visibility_capability, source_updated_at)
  SELECT tenant_id, 'councilDecisions', id::text,
         coalesce(nullif(student_name, ''), nullif(thesis_title, ''), meeting_number, 'Council decision'),
         concat_ws(' — ', nullif(meeting_number, ''), meeting_date::text, nullif(student_number, ''), nullif(thesis_title, '')),
         '/council-decisions/' || id::text, search_text, 'council.view', updated_at
    FROM council_decisions
   WHERE tenant_id = p_tenant AND deleted_at IS NULL;

  INSERT INTO search_documents
    (tenant_id, entity_type, entity_id, title, subtitle, href, search_text, visibility_capability, source_updated_at)
  SELECT tenant_id, 'workshops', id::text, title,
         concat_ws(' — ', workshop_date::text, nullif(venue, '')),
         '/workshops/' || id::text, search_text, 'workshops.view', updated_at
    FROM workshops
   WHERE tenant_id = p_tenant AND deleted_at IS NULL;
END
$$;

CREATE OR REPLACE FUNCTION app.sync_search_document() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, app AS $$
DECLARE
  v_tenant uuid := coalesce(NEW.tenant_id, OLD.tenant_id);
  v_entity_id text := coalesce(NEW.id, OLD.id)::text;
  v_type text;
  v_title text;
  v_subtitle text;
  v_href text;
  v_search text;
  v_capability text;
  v_updated timestamptz;
  v_deleted timestamptz;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'students' THEN
      v_type := 'students';
      v_title := btrim(NEW.first_name || ' ' || NEW.last_name);
      v_subtitle := coalesce(NEW.student_number, '');
      v_href := '/students/' || NEW.id::text;
      v_search := NEW.search_text;
      v_capability := 'students.view';
      v_updated := NEW.updated_at;
      v_deleted := NEW.deleted_at;
    WHEN 'professors' THEN
      v_type := 'professors';
      v_title := btrim(NEW.first_name || ' ' || NEW.last_name);
      v_subtitle := concat_ws(' — ', nullif(NEW.academic_rank, ''), nullif(NEW.department, ''), nullif(NEW.professor_code, ''));
      v_href := '/professors/' || NEW.id::text;
      v_search := NEW.search_text;
      v_capability := 'professors.view';
      v_updated := NEW.updated_at;
      v_deleted := NEW.deleted_at;
    WHEN 'council_meetings' THEN
      v_type := 'councilMeetings';
      v_title := NEW.meeting_number;
      v_subtitle := concat_ws(' — ', NEW.meeting_date::text, nullif(NEW.research_deputy, ''));
      v_href := '/council-meetings/' || NEW.id::text;
      v_search := NEW.search_text;
      v_capability := 'council.view';
      v_updated := NEW.updated_at;
      v_deleted := NEW.deleted_at;
    WHEN 'council_decisions' THEN
      v_type := 'councilDecisions';
      v_title := coalesce(nullif(NEW.student_name, ''), nullif(NEW.thesis_title, ''), NEW.meeting_number, 'Council decision');
      v_subtitle := concat_ws(' — ', nullif(NEW.meeting_number, ''), NEW.meeting_date::text, nullif(NEW.student_number, ''), nullif(NEW.thesis_title, ''));
      v_href := '/council-decisions/' || NEW.id::text;
      v_search := NEW.search_text;
      v_capability := 'council.view';
      v_updated := NEW.updated_at;
      v_deleted := NEW.deleted_at;
    WHEN 'workshops' THEN
      v_type := 'workshops';
      v_title := NEW.title;
      v_subtitle := concat_ws(' — ', NEW.workshop_date::text, nullif(NEW.venue, ''));
      v_href := '/workshops/' || NEW.id::text;
      v_search := NEW.search_text;
      v_capability := 'workshops.view';
      v_updated := NEW.updated_at;
      v_deleted := NEW.deleted_at;
    ELSE
      RETURN coalesce(NEW, OLD);
  END CASE;

  IF TG_OP = 'DELETE' OR v_deleted IS NOT NULL THEN
    DELETE FROM search_documents
     WHERE tenant_id = v_tenant AND entity_type = v_type AND entity_id = v_entity_id;
    RETURN coalesce(NEW, OLD);
  END IF;

  INSERT INTO search_documents
    (tenant_id, entity_type, entity_id, title, subtitle, href, search_text, visibility_capability, source_updated_at)
  VALUES
    (v_tenant, v_type, v_entity_id, v_title, nullif(v_subtitle, ''), v_href, v_search, v_capability, v_updated)
  ON CONFLICT (tenant_id, entity_type, entity_id)
  DO UPDATE SET title = excluded.title,
                subtitle = excluded.subtitle,
                href = excluded.href,
                search_text = excluded.search_text,
                visibility_capability = excluded.visibility_capability,
                source_updated_at = excluded.source_updated_at,
                updated_at = now();

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS students_search_projection_trg ON students;
CREATE TRIGGER students_search_projection_trg
AFTER INSERT OR UPDATE OR DELETE ON students
FOR EACH ROW EXECUTE FUNCTION app.sync_search_document();

DROP TRIGGER IF EXISTS professors_search_projection_trg ON professors;
CREATE TRIGGER professors_search_projection_trg
AFTER INSERT OR UPDATE OR DELETE ON professors
FOR EACH ROW EXECUTE FUNCTION app.sync_search_document();

DROP TRIGGER IF EXISTS council_meetings_search_projection_trg ON council_meetings;
CREATE TRIGGER council_meetings_search_projection_trg
AFTER INSERT OR UPDATE OR DELETE ON council_meetings
FOR EACH ROW EXECUTE FUNCTION app.sync_search_document();

DROP TRIGGER IF EXISTS council_decisions_search_projection_trg ON council_decisions;
CREATE TRIGGER council_decisions_search_projection_trg
AFTER INSERT OR UPDATE OR DELETE ON council_decisions
FOR EACH ROW EXECUTE FUNCTION app.sync_search_document();

DROP TRIGGER IF EXISTS workshops_search_projection_trg ON workshops;
CREATE TRIGGER workshops_search_projection_trg
AFTER INSERT OR UPDATE OR DELETE ON workshops
FOR EACH ROW EXECUTE FUNCTION app.sync_search_document();
