import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  createReadStream,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { escapeCsvCell as csvCell, csvScalar } from "../../src/lib/csv/safe-csv.ts";
import {
  EXPORT_ARTIFACT_TTL_MS,
  validateExportArtifactResult,
} from "../../src/lib/jobs/export-artifact.ts";
import { PermanentJobError } from "../lib/job-errors.mjs";

/**
 * Export-domain handler factory.
 *
 * The worker lifecycle owns queue/lease/publication. This module owns only the
 * export domain and receives the minimum tenant-transaction capabilities it
 * needs from the orchestrator.
 */
export function createExportHandler({
  artifactFile,
  withTenantSnapshot,
  assertRequesterEligible,
  requesterHasAnyCapability,
}) {
  function exportSpec(kind) {
    const specs = {
      students: {
        table: "students",
        alias: "x",
        capabilities: ["students.view", "data.export"],
        order: "last_name,first_name,id",
        sensitive: ["national_id"],
        sensitiveFlag: "includeNationalId",
        sensitiveCapabilities: ["students.sensitive.read", "students.nationality"],
        filters: {
          degree: "degree",
          status: "status",
          faculty: "faculty",
          department: "department",
          field: "field_of_study",
          gender: "gender",
        },
      },
      professors: {
        table: "professors",
        alias: "x",
        capabilities: ["professors.view", "data.export"],
        order: "last_name,first_name,id",
        sensitive: ["bank_account"],
        sensitiveFlag: "includeBank",
        sensitiveCapabilities: ["professors.bank.read"],
        filters: {
          status: "status",
          rank: "academic_rank",
          university: "university",
          faculty: "faculty",
          department: "department",
          specialization: { column: "specialization", folded: true },
        },
      },
      "council-meetings": {
        table: "council_meetings",
        alias: "x",
        capabilities: ["council.view", "data.export"],
        order: "meeting_date,id",
        filters: {
          day: "meeting_day",
          deputy: { column: "research_deputy", folded: true },
          location: { column: "meeting_location", folded: true },
        },
      },
      "council-decisions": {
        table: "council_decisions",
        alias: "x",
        capabilities: ["council.view", "data.export"],
        order: "meeting_date,id",
        filters: {
          category: "report_category",
          status: "review_status",
          level: "education_level",
          field: "field_of_study",
          research: "research_type",
        },
      },
      workshops: {
        table: "workshops",
        alias: "x",
        capabilities: ["workshops.view", "data.export"],
        order: "workshop_date,id",
        filters: { status: "status", location: "location_type" },
      },
      capacity: {
        table: "professor_capacities",
        alias: "x",
        capabilities: ["capacity.view", "data.export"],
        order: "academic_year desc,professor_id,id",
      },
      audit: {
        table: "audit_log",
        alias: "x",
        capabilities: ["audit.view", "data.export"],
        order: "created_at desc,id desc",
        includeDeleted: true,
      },
      reports: {
        table: "students",
        alias: "x",
        capabilities: ["students.view", "data.export"],
        order: "last_name,first_name,id",
      },
    };
    if (kind === "reviewer-counts") {
      return {
        capabilities: ["council.view", "professors.view", "data.export"],
        sql: `select p.id,p.professor_code,p.first_name,p.last_name,
                count(a.id) filter (where a.role='reviewer') as reviewer_count,
                count(a.id) filter (where a.role='examiner') as examiner_count
              from professors p left join council_appointments a
                on a.tenant_id=p.tenant_id and a.professor_id=p.id and a.deleted_at is null
             where p.deleted_at is null
             group by p.id,p.professor_code,p.first_name,p.last_name
             order by reviewer_count desc,p.last_name,p.first_name,p.id`,
      };
    }
    const spec = specs[kind];
    if (!spec) throw new PermanentJobError(`unsupported export kind ${kind}`);
    return spec;
  }

  async function exportCsv(client, spec, payload, file, heartbeat) {
    const query =
      payload.query && typeof payload.query === "object" && !Array.isArray(payload.query)
        ? payload.query
        : {};
    let sqlText;
    const values = [];
    if (spec.sql) {
      sqlText = spec.sql;
    } else {
      const where = [];
      if (!spec.includeDeleted && spec.table !== "audit_log")
        where.push(`${spec.alias}.deleted_at is null`);
      const search = typeof query.q === "string" ? query.q.trim().slice(0, 120) : "";
      if (
        search &&
        ["students", "professors", "council_decisions", "workshops"].includes(spec.table)
      ) {
        for (const word of search.split(/\s+/).filter(Boolean).slice(0, 6)) {
          values.push(word);
          where.push(
            `${spec.alias}.search_text like '%' || app.fold_text($${values.length}) || '%'`,
          );
        }
      }
      for (const [key, definition] of Object.entries(spec.filters ?? {})) {
        const raw = typeof query[key] === "string" ? query[key].trim().slice(0, 200) : "";
        if (!raw) continue;
        const filter =
          typeof definition === "string" ? { column: definition, folded: false } : definition;
        values.push(raw);
        const column = `${spec.alias}.${filter.column}`;
        where.push(
          filter.folded
            ? `app.fold_text(coalesce(${column}, '')) = app.fold_text($${values.length})`
            : `${column}=$${values.length}`,
        );
      }
      sqlText = `select to_jsonb(${spec.alias}) - 'tenant_id' - 'search_text' as row from ${spec.table} ${spec.alias}${where.length ? ` where ${where.join(" and ")}` : ""} order by ${spec.order}`;
    }
    const cursor = `job_${process.pid}_${randomBytes(7).toString("hex")}`;
    const statement = spec.sql ? `select to_jsonb(q) as row from (${sqlText}) q` : sqlText;
    await client.query(`declare ${cursor} no scroll cursor for ${statement}`, values);
    writeFileSync(file, "\ufeff", { mode: 0o600 });
    let header = null;
    let rowCount = 0;
    while (true) {
      const batch = await client.query(`fetch forward 500 from ${cursor}`);
      await heartbeat();
      if (batch.rows.length === 0) break;
      for (const item of batch.rows) {
        const row = { ...(item.row ?? {}) };
        if (spec.sensitive?.length) {
          const shouldInclude =
            payload[spec.sensitiveFlag] === true && payload.sensitiveAuthorized === true;
          if (!shouldInclude) for (const field of spec.sensitive) delete row[field];
        }
        if (!header) {
          header = Object.keys(row);
          appendFileSync(file, `${header.map(csvCell).join(",")}\r\n`);
        }
        appendFileSync(file, `${header.map((key) => csvCell(csvScalar(row[key]))).join(",")}\r\n`);
        rowCount += 1;
      }
    }
    await client.query(`close ${cursor}`);
    return { rowCount };
  }

  const TENANT_EXPORT_TABLES = [
    ["institution", "institutions"],
    ["lookups", "lookups"],
    ["roles", "roles"],
    ["roleCapabilities", "role_capabilities"],
    ["userRoles", "user_roles"],
    ["tenantOwner", "tenant_owners"],
    ["students", "students"],
    ["professors", "professors"],
    ["calendarEntries", "calendar_entries"],
    ["councilMeetings", "council_meetings"],
    ["councilPermanentMembers", "council_permanent_members"],
    ["councilDecisions", "council_decisions"],
    ["councilRulings", "council_rulings"],
    ["councilAppointments", "council_appointments"],
    ["professorCapacities", "professor_capacities"],
    ["workshops", "workshops"],
    ["workshopParticipants", "workshop_participants"],
    ["workshopInstructors", "workshop_instructors"],
    ["workshopCertificates", "workshop_certificates"],
    ["savedViews", "saved_views"],
    ["academicYears", "academic_years"],
    ["academicPeriods", "academic_periods"],
    ["organizationUnits", "organization_units"],
    ["organizationUnitVersions", "organization_unit_versions"],
    ["academicPrograms", "academic_programs"],
    ["studentSupervisionAssignments", "student_supervision_assignments"],
    ["attachments", "attachments"],
    ["documentVersions", "document_versions"],
    ["correspondence", "correspondence"],
    ["correspondenceRecipients", "correspondence_recipients"],
    ["tasks", "tasks"],
    ["taskTransitions", "task_transitions"],
    ["notifications", "notifications"],
    ["scheduledJobs", "scheduled_jobs"],
    ["regulationVersions", "regulation_versions"],
    ["decisionTemplateVersions", "decision_template_versions"],
    ["qualityRules", "quality_rules"],
    ["qualitySnapshots", "quality_snapshots"],
    ["retentionPolicies", "retention_policies"],
    ["serviceAccounts", "service_accounts"],
    ["webhookSubscriptions", "webhook_subscriptions"],
    ["integrationConnections", "integration_connections"],
    ["tenantFeatures", "tenant_features"],
    ["customFieldDefinitions", "custom_field_definitions"],
    ["customFieldValues", "custom_field_values"],
    ["researchProjects", "research_projects"],
    ["auditLog", "audit_log"],
  ];

  async function exportTenant(job, payload, heartbeat) {
    const partial = artifactFile(`${job.id}.${job.attempt}.part`);
    const finalName = `${job.id}.${job.attempt}.json`;
    const finalFile = artifactFile(finalName);
    rmSync(partial, { force: true });
    rmSync(finalFile, { force: true });
    const result = await withTenantSnapshot(job.tenant_id, async (client) => {
      await assertRequesterEligible(client, job.requested_by, ["data.export"], true);
      const tenant = (
        await client.query(`select id,slug,name from tenants where id=app.current_tenant()`)
      ).rows[0];
      const metadata = {
        format: "univ-web-tenant-export",
        schemaVersion: 3,
        applicationVersion: String(payload.applicationVersion ?? "0.8.2"),
        generatedAt: new Date().toISOString(),
        tenant,
      };
      writeFileSync(partial, `${JSON.stringify(metadata).slice(0, -1)},\n`, { mode: 0o600 });
      let rowCount = 0;
      rowCount += await writeJsonCursor(
        client,
        partial,
        "users",
        `select jsonb_build_object('id',u.id,'name',u.name,'localUsername',u.display_username,'email',case when u.email like '%@users.invalid' then null else u.email end,'emailVerified',u.email_verified,'image',u.image,'suspendedAt',u.suspended_at,'suspendedReason',u.suspended_reason,'lastLoginAt',u.last_login_at,'employmentStart',u.employment_start,'employmentEnd',u.employment_end,'accountExpiresAt',u.account_expires_at,'mfaEnabled',u.mfa_enabled,'mustChangePassword',u.must_change_password,'createdAt',u.created_at,'updatedAt',u.updated_at) as row from "user" u where u.tenant_id=app.current_tenant() order by u.id`,
        true,
        heartbeat,
      );
      for (const [key, table] of TENANT_EXPORT_TABLES)
        rowCount += await writeJsonCursor(
          client,
          partial,
          key,
          `select to_jsonb(x) - 'tenant_id' as row from ${table} x order by id`,
          false,
          heartbeat,
        );
      appendFileSync(partial, "\n}\n");
      return { rowCount };
    });
    chmodSync(partial, 0o600);
    const digest = await sha256(partial);
    renameSync(partial, finalFile);
    chmodSync(finalFile, 0o600);
    const expiresAt = new Date(Date.now() + EXPORT_ARTIFACT_TTL_MS).toISOString();
    return validateExportArtifactResult({
      artifactPath: finalName,
      artifactSha256: digest,
      rowCount: result.rowCount,
      expiresAt,
      filename: `univ-tenant-portability-${new Date().toISOString().slice(0, 10)}.json`,
      contentType: "application/json; charset=utf-8",
      size: statSync(finalFile).size,
    });
  }

  async function writeJsonCursor(client, file, key, selectSql, first, heartbeat) {
    const cursor = `tenant_${process.pid}_${randomBytes(7).toString("hex")}`;
    await client.query(`declare ${cursor} no scroll cursor for ${selectSql}`);
    appendFileSync(file, `${first ? "" : ",\n"}${JSON.stringify(key)}:[`);
    let comma = false;
    let count = 0;
    while (true) {
      const batch = await client.query(`fetch forward 250 from ${cursor}`);
      await heartbeat();
      if (!batch.rows.length) break;
      for (const item of batch.rows) {
        appendFileSync(file, `${comma ? "," : ""}${JSON.stringify(item.row)}`);
        comma = true;
        count += 1;
      }
    }
    await client.query(`close ${cursor}`);
    appendFileSync(file, "]");
    return count;
  }

  async function sha256(file) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest("hex");
  }

  return async function runExportJob(job, payload, heartbeat) {
    const kind = job.kind.slice("export.".length);
    if (kind === "tenant-portability") return exportTenant(job, payload, heartbeat);
    const spec = exportSpec(kind);
    const partial = artifactFile(`${job.id}.${job.attempt}.part`);
    const finalName = `${job.id}.${job.attempt}.csv`;
    const finalFile = artifactFile(finalName);
    rmSync(partial, { force: true });
    rmSync(finalFile, { force: true });
    const result = await withTenantSnapshot(job.tenant_id, async (client) => {
      await assertRequesterEligible(client, job.requested_by, spec.capabilities, false);
      let sensitiveAuthorized = false;
      if (spec.sensitive?.length && payload[spec.sensitiveFlag] === true) {
        sensitiveAuthorized = await requesterHasAnyCapability(
          client,
          job.requested_by,
          spec.sensitiveCapabilities ?? [spec.sensitiveCapability].filter(Boolean),
        );
      }
      return exportCsv(client, spec, { ...payload, sensitiveAuthorized }, partial, heartbeat);
    });
    chmodSync(partial, 0o600);
    const digest = await sha256(partial);
    renameSync(partial, finalFile);
    chmodSync(finalFile, 0o600);
    const expiresAt = new Date(Date.now() + EXPORT_ARTIFACT_TTL_MS).toISOString();
    return validateExportArtifactResult({
      artifactPath: finalName,
      artifactSha256: digest,
      rowCount: result.rowCount,
      expiresAt,
      filename: `univ-${kind}-${new Date().toISOString().slice(0, 10)}.csv`,
      contentType: "text/csv; charset=utf-8",
      size: statSync(finalFile).size,
    });
  };
}
