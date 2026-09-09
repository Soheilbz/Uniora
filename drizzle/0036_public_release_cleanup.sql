-- Public-release cleanup: retire the legacy export_jobs queue after the shared jobs engine became authoritative.
DO $$
BEGIN
  IF to_regclass('public.export_jobs') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM export_jobs legacy
      JOIN jobs current ON current.id = legacy.id
    ) THEN
      RAISE EXCEPTION 'cannot migrate export_jobs: id collision with jobs';
    END IF;

    INSERT INTO jobs (
      id, tenant_id, kind, execution_class, status, payload, requested_by,
      dedupe_key, attempt, max_attempts, scheduled_at, started_at, completed_at,
      public_error, private_error, result, created_at, updated_at
    )
    SELECT
      id,
      tenant_id,
      'export.' || kind,
      'tenant',
      CASE status
        WHEN 'running' THEN 'retry'
        WHEN 'expired' THEN 'expired'
        ELSE status
      END,
      CASE
        WHEN kind='students' THEN jsonb_build_object(
          'query', jsonb_strip_nulls(jsonb_build_object(
            'q', nullif(parameters::jsonb->>'search',''),
            'degree', nullif(parameters::jsonb#>>'{filters,degree}',''),
            'status', nullif(parameters::jsonb#>>'{filters,status}',''),
            'faculty', nullif(parameters::jsonb#>>'{filters,faculty}',''),
            'department', nullif(parameters::jsonb#>>'{filters,department}',''),
            'field', nullif(parameters::jsonb#>>'{filters,field}',''),
            'gender', nullif(parameters::jsonb#>>'{filters,gender}','')
          )),
          'includeNationalId', coalesce((parameters::jsonb->>'includeNationalId')::boolean,false)
        )::text
        ELSE parameters
      END,
      requested_by,
      'legacy:' || id::text,
      0,
      5,
      created_at,
      started_at,
      completed_at,
      CASE WHEN status='failed' THEN left(error_message, 500) ELSE NULL END,
      error_message,
      CASE
        WHEN artifact_path IS NOT NULL OR artifact_sha256 IS NOT NULL OR row_count IS NOT NULL OR expires_at IS NOT NULL THEN
          jsonb_strip_nulls(jsonb_build_object(
            'artifactPath', artifact_path,
            'artifactSha256', artifact_sha256,
            'rowCount', row_count,
            'expiresAt', expires_at
          ))::text
        ELSE NULL
      END,
      created_at,
      updated_at
    FROM export_jobs;

    DROP TABLE export_jobs;
  END IF;
END $$;
