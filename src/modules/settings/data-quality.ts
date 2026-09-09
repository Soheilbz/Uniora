import { and, desc, eq, gte, sql } from "drizzle-orm";
import { qualityRules, qualitySnapshots } from "@/db/schema.ts";
import { readOnly, withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { ADMINISTRATOR_TIER, type Viewer } from "@/lib/capabilities.ts";
import {
  FINAL_DEFENSE_DECISION_CATEGORIES,
  STUDENT_DECISION_CATEGORIES,
  sqlInList,
  VALID_DECISION_STATUSES,
} from "@/lib/council-stage-policy.ts";

export type DataQualityIssue = {
  key: string;
  count: number;
  severity: "error" | "warning";
};

/**
 * Read-consistent integrity checks for tenant data and tenant administration.
 * Database constraints reject impossible relationships; this layer catches
 * incomplete, contradictory or operationally unsafe states that are valid SQL
 * but still require an administrator's attention.
 */
export async function readDataQuality(tenantId: string): Promise<DataQualityIssue[]> {
  return readOnly(tenantId, async (tx) => {
    const result = await tx.execute(sql`
      select key, count::int, severity
      from (
        select 'institution_profile_incomplete' as key,
          count(*) filter (
            where nullif(btrim(name), '') is null
               or nullif(btrim(faculty), '') is null
               or nullif(btrim(timezone), '') is null
          ) as count,
          'warning' as severity
        from institutions

        union all

        select 'tenant_owner_missing',
          case when exists (select 1 from tenant_owners) then 0 else 1 end,
          'error'

        union all

        select 'tenant_owner_invalid',
          count(*),
          'error'
        from tenant_owners o
        left join "user" u on u.id = o.user_id and u.tenant_id = o.tenant_id
        where u.id is null
           or u.suspended_at is not null
           or (u.account_expires_at is not null and u.account_expires_at <= now())
           or (u.employment_start is not null and u.employment_start > current_date)
           or (u.employment_end is not null and u.employment_end < current_date)
           or u.must_change_password
           or not exists (
             select 1
             from user_roles ur
             join roles r on r.id = ur.role_id and r.tenant_id = ur.tenant_id
             where ur.tenant_id = o.tenant_id
               and ur.user_id = o.user_id
               and r.tier >= ${ADMINISTRATOR_TIER}
           )
           or not exists (
             select 1
             from user_roles ur
             join role_capabilities rc on rc.role_id = ur.role_id
             where ur.tenant_id = o.tenant_id
               and ur.user_id = o.user_id
               and rc.capability = 'users.manage'
           )
           or not exists (
             select 1
             from user_roles ur
             join role_capabilities rc on rc.role_id = ur.role_id
             where ur.tenant_id = o.tenant_id
               and ur.user_id = o.user_id
               and rc.capability = 'roles.manage'
           )

        union all

        select 'active_users_without_roles',
          count(*),
          'error'
        from "user" u
        where u.tenant_id = ${tenantId}
          and u.suspended_at is null
          and (u.account_expires_at is null or u.account_expires_at > now())
          and (u.employment_start is null or u.employment_start <= current_date)
          and (u.employment_end is null or u.employment_end >= current_date)
          and not exists (
            select 1 from user_roles ur
            where ur.tenant_id = ${tenantId} and ur.user_id = u.id
          )

        union all

        select 'users_missing_local_username',
          count(*),
          'error'
        from "user" u
        where u.tenant_id = ${tenantId}
          and nullif(btrim(coalesce(u.display_username, '')), '') is null
          and exists (select 1 from account a where a.user_id = u.id)

        union all

        select 'suspended_users_with_live_sessions',
          count(distinct u.id),
          'error'
        from "user" u
        join session s on s.user_id = u.id and s.expires_at > now()
        where u.tenant_id = ${tenantId} and u.suspended_at is not null

        union all

        select 'expired_users_with_live_sessions',
          count(distinct u.id),
          'error'
        from "user" u
        join session s on s.user_id = u.id and s.expires_at > now()
        where u.tenant_id = ${tenantId}
          and (
            (u.account_expires_at is not null and u.account_expires_at <= now())
            or (u.employment_end is not null and u.employment_end < current_date)
          )

        union all

        select 'scheduled_users_with_live_sessions',
          count(distinct u.id),
          'error'
        from "user" u
        join session s on s.user_id = u.id and s.expires_at > now()
        where u.tenant_id = ${tenantId}
          and u.employment_start is not null
          and u.employment_start > current_date

        union all

        select 'students_missing_supervisor',
          count(*) filter (
            where primary_supervisor_id is null
              and secondary_supervisor_id is null
              and third_supervisor_id is null
          ),
          'warning'
        from students
        where deleted_at is null and status = 'enrolled'

        union all

        select 'students_missing_academic',
          count(*) filter (
            where nullif(btrim(coalesce(degree, '')), '') is null
               or nullif(btrim(coalesce(field_of_study, '')), '') is null
          ),
          'warning'
        from students
        where deleted_at is null and status = 'enrolled'

        union all

        select 'students_duplicate_numbers', count(*), 'error'
        from (
          select student_number
          from students
          where deleted_at is null and nullif(btrim(student_number), '') is not null
          group by student_number
          having count(*) > 1
        ) duplicate_numbers

        union all

        select 'professors_duplicate_names', count(*), 'warning'
        from (
          select app.fold_person(concat_ws(' ', first_name, last_name)) as folded_name
          from professors
          where deleted_at is null
          group by app.fold_person(concat_ws(' ', first_name, last_name))
          having count(*) > 1
        ) duplicate_professors

        union all

        select 'professors_missing_directory',
          count(*) filter (
            where nullif(btrim(coalesce(faculty, '')), '') is null
               or nullif(btrim(coalesce(specialization, '')), '') is null
          ),
          'warning'
        from professors
        where deleted_at is null

        union all

        select 'decisions_unknown_category', count(*), 'error'
        from council_decisions d
        where d.deleted_at is null
          and d.report_category not in (${sqlInList(STUDENT_DECISION_CATEGORIES)})

        union all

        select 'decisions_missing_text', count(*), 'error'
        from council_decisions
        where deleted_at is null
          and nullif(btrim(coalesce(decision_text, '')), '') is null

        union all

        select 'decisions_missing_student', count(*), 'error'
        from council_decisions d
        where d.deleted_at is null
          and (
            (d.student_id is not null and not exists (
              select 1 from students s where s.deleted_at is null and s.id = d.student_id
            ))
            or (d.student_id is null and nullif(btrim(coalesce(d.student_number, '')), '') is not null
              and not exists (
                select 1 from students s where s.deleted_at is null and s.student_number = d.student_number
              ))
            or (d.student_id is null and nullif(btrim(coalesce(d.student_number, '')), '') is null)
          )

        union all

        select 'decisions_student_reference_mismatch', count(*), 'error'
        from council_decisions d
        join students s on s.id = d.student_id and s.deleted_at is null
        where d.deleted_at is null
          and nullif(btrim(coalesce(d.student_number, '')), '') is not null
          and d.student_number <> s.student_number

        union all

        select 'decisions_missing_defense_date', count(*), 'warning'
        from council_decisions d
        where d.deleted_at is null
          and d.review_status in (${sqlInList(VALID_DECISION_STATUSES)})
          and d.report_category in (${sqlInList(FINAL_DEFENSE_DECISION_CATEGORIES)})
          and d.defense_meeting_date is null

        union all

        select 'students_duplicate_stage_decisions', count(*), 'warning'
        from (
          select coalesce(d.student_id::text, nullif(btrim(d.student_number), '')) as student_key,
                 d.report_category
          from council_decisions d
          where d.deleted_at is null
            and d.review_status in (${sqlInList(VALID_DECISION_STATUSES)})
            and d.report_category in (${sqlInList(STUDENT_DECISION_CATEGORIES)})
            and (d.student_id is not null or nullif(btrim(coalesce(d.student_number, '')), '') is not null)
          group by coalesce(d.student_id::text, nullif(btrim(d.student_number), '')), d.report_category
          having count(*) > 1
        ) duplicate_stage_decisions

        union all

        select 'appointments_missing_student', count(*), 'error'
        from council_appointments a
        where a.deleted_at is null
          and (
            (a.student_id is not null and not exists (
              select 1 from students s where s.deleted_at is null and s.id = a.student_id
            ))
            or (a.student_id is null and nullif(btrim(coalesce(a.student_number, '')), '') is not null
              and not exists (
                select 1 from students s where s.deleted_at is null and s.student_number = a.student_number
              ))
            or (a.student_id is null and nullif(btrim(coalesce(a.student_number, '')), '') is null)
          )

        union all

        select 'appointments_student_reference_mismatch', count(*), 'error'
        from council_appointments a
        join students s on s.id = a.student_id and s.deleted_at is null
        where a.deleted_at is null
          and nullif(btrim(coalesce(a.student_number, '')), '') is not null
          and a.student_number <> s.student_number

        union all

        select 'appointments_missing_primary', count(*), 'warning'
        from council_appointments a
        where a.deleted_at is null and a.primary_supervisor_id is null

        union all

        select 'decisions_unknown_supervisor', count(*), 'warning'
        from council_decisions d
        cross join lateral (values
          (d.primary_supervisor),
          (d.secondary_supervisor),
          (d.third_supervisor)
        ) as seat(name)
        where d.deleted_at is null
          and d.review_status in (${sqlInList(VALID_DECISION_STATUSES)})
          and nullif(btrim(coalesce(seat.name, '')), '') is not null
          and not exists (
            select 1 from professors p
            where p.deleted_at is null
              and app.fold_person(concat_ws(' ', p.first_name, p.last_name)) = app.fold_person(seat.name)
          )

        union all

        select 'rulings_missing_text', count(*), 'error'
        from council_rulings
        where deleted_at is null
          and nullif(btrim(coalesce(decision_text, '')), '') is null

        union all

        select 'meetings_missing_attendance', count(*), 'warning'
        from council_meetings
        where deleted_at is null
          and coalesce(jsonb_array_length(participants), 0) = 0

        union all

        select 'retired_lookups_in_use', count(*), 'warning'
        from (
          select ref.set_name, ref.value
          from students s
          cross join lateral (values
            ('student_statuses', s.status),
            ('degrees', s.degree),
            ('faculties', s.faculty),
            ('departments', s.department),
            ('fields_of_study', s.field_of_study),
            ('genders', s.gender),
            ('admission_types', s.admission_type),
            ('funding_types', s.funding_type),
            ('nationalities', s.nationality)
          ) ref(set_name, value)
          where s.deleted_at is null and nullif(btrim(coalesce(ref.value, '')), '') is not null
          union all
          select ref.set_name, ref.value
          from professors p
          cross join lateral (values
            ('academic_ranks', p.academic_rank),
            ('faculties', p.faculty),
            ('departments', p.department),
            ('universities', p.university)
          ) ref(set_name, value)
          where p.deleted_at is null and nullif(btrim(coalesce(ref.value, '')), '') is not null
        ) used
        where exists (
          select 1 from lookups l
          where l.set = used.set_name and l.value = used.value and l.retired_at is not null
        )

        union all

        select 'workshops_missing_schedule',
          count(*) filter (where workshop_date is null or capacity = 0),
          'warning'
        from workshops
        where deleted_at is null

        union all

        select 'workshop_participants_missing_identity', count(*), 'error'
        from workshop_participants p
        where p.deleted_at is null
          and p.student_id is null
          and nullif(btrim(coalesce(p.external_name, '')), '') is null

        union all

        select 'workshop_certificates_wrong_workshop', count(*), 'error'
        from workshop_certificates c
        join workshop_participants p on p.id = c.participant_id and p.deleted_at is null
        where c.deleted_at is null and c.workshop_id <> p.workshop_id

        union all

        select 'workshop_certificates_without_attendance', count(*), 'warning'
        from workshop_certificates c
        join workshop_participants p on p.id = c.participant_id and p.deleted_at is null
        where c.deleted_at is null and p.attendance_status <> 'attended'
      ) checks
      order by case when severity = 'error' then 0 else 1 end, count desc, key`);

    return (
      result.rows as { key: string; count: number; severity: DataQualityIssue["severity"] }[]
    ).map((row) => ({ key: row.key, count: Number(row.count), severity: row.severity }));
  });
}

function issueEntity(code: string): string {
  const prefix = code.split("_")[0] ?? "system";
  const mapped: Record<string, string> = {
    institution: "institution",
    tenant: "tenant",
    active: "user",
    users: "user",
    suspended: "user",
    expired: "user",
    scheduled: "user",
    students: "student",
    professors: "professor",
    decisions: "council_decision",
    appointments: "council_appointment",
    meetings: "council_meeting",
    retired: "lookup",
    workshops: "workshop",
    workshop: "workshop",
  };
  return mapped[prefix] ?? "system";
}

/**
 * Capture an immutable quality snapshot from the governed built-in checks.
 *
 * `quality_rules.evaluator` is metadata only in this release. Arbitrary SQL is
 * deliberately not executed from a database field; custom evaluator execution
 * would turn configuration into a privileged code path.
 */
export async function captureDataQualitySnapshot(viewer: Viewer): Promise<number> {
  const issues = await readDataQuality(viewer.tenantId);
  const capturedAt = new Date();

  await withTenant(viewer.tenantId, async (tx) => {
    for (const issue of issues) {
      const [existing] = await tx
        .select({ id: qualityRules.id, severity: qualityRules.severity })
        .from(qualityRules)
        .where(and(eq(qualityRules.code, issue.key), eq(qualityRules.tenantId, viewer.tenantId)))
        .limit(1);

      let ruleId = existing?.id;
      if (!ruleId) {
        const [created] = await tx
          .insert(qualityRules)
          .values({
            tenantId: viewer.tenantId,
            code: issue.key,
            entity: issueEntity(issue.key),
            severity: issue.severity,
            enabled: true,
            ownerCapability: "data.quality.manage",
            description: issue.key,
            remediationRoute: "/settings/data-quality",
            evaluator: `builtin:${issue.key}`,
          })
          .returning({ id: qualityRules.id });
        ruleId = created?.id;
      } else if (existing && existing.severity !== issue.severity) {
        await tx
          .update(qualityRules)
          .set({ severity: issue.severity, updatedAt: capturedAt })
          .where(eq(qualityRules.id, existing.id));
      }

      if (!ruleId) throw new Error("failed to resolve quality rule");
      await tx.insert(qualitySnapshots).values({
        tenantId: viewer.tenantId,
        ruleId,
        capturedAt,
        count: issue.count,
        sampleEntityIds: "[]",
      });
    }

    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "data_quality.snapshot",
      entityType: "data_quality",
      entityId: capturedAt.toISOString(),
      changes: JSON.stringify({
        checks: issues.length,
        total: issues.reduce((sum, issue) => sum + issue.count, 0),
      }),
    });
  });

  return issues.length;
}

export type DataQualityTrendPoint = {
  code: string;
  severity: string;
  capturedAt: Date;
  count: number;
};

/** Latest bounded history for trend cards and charts. */
export async function readDataQualityHistory(
  tenantId: string,
  days = 90,
): Promise<DataQualityTrendPoint[]> {
  const safeDays = Math.min(Math.max(Math.trunc(days), 1), 365);
  const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);
  return readOnly(tenantId, (tx) =>
    tx
      .select({
        code: qualityRules.code,
        severity: qualityRules.severity,
        capturedAt: qualitySnapshots.capturedAt,
        count: qualitySnapshots.count,
      })
      .from(qualitySnapshots)
      .innerJoin(
        qualityRules,
        and(
          eq(qualityRules.tenantId, qualitySnapshots.tenantId),
          eq(qualityRules.id, qualitySnapshots.ruleId),
        ),
      )
      .where(gte(qualitySnapshots.capturedAt, since))
      .orderBy(desc(qualitySnapshots.capturedAt), qualityRules.code)
      .limit(2000),
  );
}
