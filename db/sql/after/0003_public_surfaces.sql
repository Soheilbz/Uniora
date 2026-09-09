-- Narrow SECURITY DEFINER surfaces for requests that intentionally have no
-- authenticated tenant context yet. They return only explicitly public/auth
-- bootstrap fields and never expose arbitrary tenant rows.

CREATE OR REPLACE FUNCTION app.verify_certificate(p_code text)
RETURNS TABLE(
  valid boolean,
  certificate_number text,
  participant_name text,
  workshop_title text,
  issue_date date,
  institution_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  PERFORM set_config('app.public_surface', 'verify_certificate', true);

  RETURN QUERY
  SELECT true,
         c.certificate_number,
         coalesce(nullif(btrim(concat_ws(' ',s.first_name,s.last_name)),''), nullif(btrim(p.external_name),''), 'Participant'),
         w.title,
         c.issue_date,
         nullif(btrim(i.name),'')
    FROM public.workshop_certificates c
    JOIN public.workshop_participants p ON p.id=c.participant_id AND p.tenant_id=c.tenant_id AND p.deleted_at IS NULL
    LEFT JOIN public.students s ON s.id=p.student_id AND s.tenant_id=p.tenant_id AND s.deleted_at IS NULL
    JOIN public.workshops w ON w.id=c.workshop_id AND w.tenant_id=c.tenant_id AND w.deleted_at IS NULL
    LEFT JOIN public.institutions i ON i.tenant_id=c.tenant_id
    JOIN public.tenants t ON t.id=c.tenant_id AND t.status='active' AND t.provisioning_status='active'
   WHERE c.deleted_at IS NULL
     AND upper(btrim(c.verification_code)) = upper(btrim(p_code))
   LIMIT 1;
END $$;

CREATE INDEX IF NOT EXISTS workshop_certificates_verification_code_upper_idx
  ON public.workshop_certificates (upper(btrim(verification_code)))
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION app.public_workshop(p_slug text)
RETURNS TABLE(
  public_slug text,
  title text,
  description text,
  workshop_date date,
  duration_hours numeric,
  location_type text,
  venue text,
  capacity integer,
  registration_closes_at date,
  registration_open boolean,
  registered_count bigint,
  institution_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  PERFORM set_config('app.public_surface', 'public_workshop', true);

  RETURN QUERY
  SELECT w.public_slug,w.title,w.description,w.workshop_date,w.duration_hours,w.location_type,w.venue,w.capacity,w.registration_closes_at,
         (w.public_registration IS TRUE AND w.status IN ('planned','held') AND (w.registration_closes_at IS NULL OR w.registration_closes_at>=current_date)
          AND (w.capacity=0 OR count(r.id) FILTER (WHERE r.deleted_at IS NULL AND r.status IN ('pending','approved','attended')) < w.capacity)) AS registration_open,
         count(r.id) FILTER (WHERE r.deleted_at IS NULL AND r.status IN ('pending','approved','attended')) AS registered_count,
         nullif(btrim(i.name),'')
    FROM public.workshops w
    JOIN public.tenants t ON t.id=w.tenant_id AND t.status='active' AND t.provisioning_status='active'
    LEFT JOIN public.institutions i ON i.tenant_id=w.tenant_id
    LEFT JOIN public.workshop_registrations r ON r.tenant_id=w.tenant_id AND r.workshop_id=w.id
   WHERE w.deleted_at IS NULL AND w.public_registration IS TRUE AND w.public_slug=btrim(p_slug)
   GROUP BY w.id,i.name
   LIMIT 1;
END $$;

CREATE OR REPLACE FUNCTION app.register_public_workshop(
  p_slug text,
  p_full_name text,
  p_email text,
  p_phone text,
  p_external_reference text,
  p_rate_key text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  v_workshop public.workshops%ROWTYPE;
  v_count integer;
  v_id uuid;
  v_identity_key text;
  v_now_ms bigint := floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_rate public.rate_limit%ROWTYPE;
BEGIN
  PERFORM set_config('app.public_surface', 'register_public_workshop', true);

  IF length(btrim(coalesce(p_full_name,''))) < 2 OR length(p_full_name) > 200 THEN RAISE EXCEPTION 'invalid registration name'; END IF;
  IF p_email IS NOT NULL AND (length(p_email)>254 OR p_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$') THEN RAISE EXCEPTION 'invalid registration email'; END IF;
  IF p_phone IS NOT NULL AND length(p_phone)>40 THEN RAISE EXCEPTION 'invalid registration phone'; END IF;
  IF length(coalesce(p_external_reference,''))>120 THEN RAISE EXCEPTION 'invalid external reference'; END IF;
  IF length(coalesce(p_rate_key,''))<16 OR length(p_rate_key)>200 THEN RAISE EXCEPTION 'invalid rate key'; END IF;

  v_identity_key := md5(
    lower(btrim(p_full_name)) || chr(31) ||
    lower(btrim(coalesce(p_email,''))) || chr(31) ||
    btrim(coalesce(p_phone,'')) || chr(31) ||
    lower(btrim(coalesce(p_external_reference,'')))
  );

  -- Shared PostgreSQL limiter: one atomic UPSERT owns both the first-write and
  -- concurrent-update paths, so a burst cannot reset the counter back to one.
  INSERT INTO public.rate_limit(id,key,count,last_request)
  VALUES(gen_random_uuid()::text,'public-workshop:'||p_rate_key,1,v_now_ms)
  ON CONFLICT (key) DO UPDATE
     SET count = CASE
                   WHEN excluded.last_request-public.rate_limit.last_request < 60000
                     THEN public.rate_limit.count+1
                   ELSE 1
                 END,
         last_request = excluded.last_request
  RETURNING * INTO v_rate;
  IF v_rate.count > 10 THEN RAISE EXCEPTION 'registration rate limit exceeded'; END IF;

  SELECT w.* INTO v_workshop
    FROM public.workshops w
    JOIN public.tenants t ON t.id=w.tenant_id AND t.status='active' AND t.provisioning_status='active'
   WHERE w.deleted_at IS NULL AND w.public_registration IS TRUE AND w.public_slug=btrim(p_slug)
   FOR UPDATE;
  IF NOT FOUND OR v_workshop.status NOT IN ('planned','held') OR (v_workshop.registration_closes_at IS NOT NULL AND v_workshop.registration_closes_at<current_date) THEN
    RAISE EXCEPTION 'public registration is closed';
  END IF;
  SELECT r.id INTO v_id
    FROM public.workshop_registrations r
   WHERE r.tenant_id=v_workshop.tenant_id AND r.workshop_id=v_workshop.id
     AND r.identity_key=v_identity_key AND r.deleted_at IS NULL
     AND r.status IN ('pending','approved','attended')
   LIMIT 1;
  IF FOUND THEN RETURN v_id; END IF;
  SELECT count(*) INTO v_count FROM public.workshop_registrations r WHERE r.tenant_id=v_workshop.tenant_id AND r.workshop_id=v_workshop.id AND r.deleted_at IS NULL AND r.status IN ('pending','approved','attended');
  IF v_workshop.capacity>0 AND v_count>=v_workshop.capacity THEN RAISE EXCEPTION 'workshop capacity reached'; END IF;
  INSERT INTO public.workshop_registrations(tenant_id,workshop_id,full_name,email,phone,external_reference,identity_key,status,source)
  VALUES(v_workshop.tenant_id,v_workshop.id,btrim(p_full_name),nullif(btrim(p_email),''),nullif(btrim(p_phone),''),nullif(btrim(p_external_reference),''),v_identity_key,'pending','public')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION app.resolve_service_account(p_token_hash text)
RETURNS TABLE(
  tenant_id uuid,
  service_account_id uuid,
  name text,
  capabilities text,
  rate_limit_per_minute integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM set_config('app.public_surface', 'resolve_service_account', true);

  IF p_token_hash IS NULL OR length(p_token_hash) <> 64 THEN RETURN; END IF;

  SELECT s.id INTO v_id
    FROM public.service_accounts s
    JOIN public.tenants t ON t.id=s.tenant_id
   WHERE s.token_hash=p_token_hash
     AND s.status='active' AND s.deleted_at IS NULL
     AND (s.expires_at IS NULL OR s.expires_at>clock_timestamp())
     AND t.status='active' AND t.provisioning_status='active'
   LIMIT 1;
  IF v_id IS NULL THEN RETURN; END IF;

  UPDATE public.service_accounts
     SET last_used_at=clock_timestamp()
   WHERE id=v_id
     AND (last_used_at IS NULL OR last_used_at<clock_timestamp()-interval '5 minutes');

  RETURN QUERY
  SELECT s.tenant_id,s.id,s.name,s.capabilities,s.rate_limit_per_minute
    FROM public.service_accounts s
   WHERE s.id=v_id;
END
$$;

CREATE OR REPLACE FUNCTION app.resolve_calendar_subscription(p_token_hash text)
RETURNS TABLE(tenant_id uuid,user_id text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  PERFORM set_config('app.public_surface', 'resolve_calendar_subscription', true);

  IF p_token_hash IS NULL OR length(p_token_hash) <> 64 THEN RETURN; END IF;

  RETURN QUERY
  UPDATE public.calendar_subscription_tokens c
     SET last_used_at = CASE
                          WHEN c.last_used_at IS NULL OR c.last_used_at < clock_timestamp()-interval '15 minutes'
                            THEN clock_timestamp()
                          ELSE c.last_used_at
                        END,
         updated_at = CASE
                        WHEN c.last_used_at IS NULL OR c.last_used_at < clock_timestamp()-interval '15 minutes'
                          THEN clock_timestamp()
                        ELSE c.updated_at
                      END
    FROM public.tenants t, public."user" u
   WHERE c.token_hash=p_token_hash
     AND c.revoked_at IS NULL
     AND (c.expires_at IS NULL OR c.expires_at>clock_timestamp())
     AND t.id=c.tenant_id
     AND t.status='active'
     AND t.provisioning_status='active'
     AND u.id=c.user_id
     AND u.tenant_id=c.tenant_id
     AND u.suspended_at IS NULL
     AND (u.account_expires_at IS NULL OR u.account_expires_at>clock_timestamp())
     AND (u.employment_start IS NULL OR u.employment_start<=current_date)
     AND (u.employment_end IS NULL OR u.employment_end>=current_date)
   RETURNING c.tenant_id,c.user_id;
END
$$;

REVOKE ALL ON FUNCTION app.verify_certificate(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.public_workshop(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.register_public_workshop(text,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_service_account(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_calendar_subscription(text) FROM PUBLIC;
