import { createHash } from "node:crypto";
import { and, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { decisionTemplateVersions, regulationVersions } from "@/db/schema.ts";
import { readOnly, withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import type { Viewer } from "@/lib/capabilities.ts";
import { appendDomainEvent } from "@/lib/domain/events.ts";
import {
  type CapacityRuleSet,
  DEFAULT_CAPACITY_RULESET,
  parseCapacityRuleSet,
} from "@/modules/capacity/regulation.ts";
import { DECISION_TEMPLATES, type DecisionTemplate } from "@/modules/council/decision-templates.ts";
import {
  buildDecisionTemplateSchema,
  parseDecisionTemplateSchema,
} from "@/modules/governance/decision-template-schema.ts";

export const CAPACITY_REGULATION_CODE = "supervision-capacity";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, sort(nested)]),
      );
    }
    return item;
  };
  return JSON.stringify(sort(value));
}

export interface ResolvedCapacityRegulation {
  id: string | null;
  versionCode: string;
  title: string;
  rules: CapacityRuleSet;
  rulesSha256: string;
  source: "database" | "bootstrap";
}

export async function resolveCapacityRegulation(
  tenantId: string,
  asOf?: string,
): Promise<ResolvedCapacityRegulation> {
  const rows = await readOnly(tenantId, (tx) =>
    tx
      .select({
        id: regulationVersions.id,
        versionCode: regulationVersions.versionCode,
        title: regulationVersions.title,
        rulesJson: regulationVersions.rulesJson,
        rulesSha256: regulationVersions.rulesSha256,
      })
      .from(regulationVersions)
      .where(
        and(
          eq(regulationVersions.regulationCode, CAPACITY_REGULATION_CODE),
          eq(regulationVersions.status, "published"),
          asOf
            ? lte(regulationVersions.effectiveFrom, asOf)
            : lte(regulationVersions.effectiveFrom, sql`current_date`),
          or(
            isNull(regulationVersions.effectiveTo),
            asOf
              ? sql`${regulationVersions.effectiveTo} >= ${asOf}`
              : sql`${regulationVersions.effectiveTo} >= current_date`,
          ),
        ),
      )
      .orderBy(desc(regulationVersions.effectiveFrom), desc(regulationVersions.createdAt))
      .limit(1),
  );
  const row = rows[0];
  if (!row) {
    const raw = canonicalJson(DEFAULT_CAPACITY_RULESET);
    return {
      id: null,
      versionCode: DEFAULT_CAPACITY_RULESET.metadata.revision,
      title: "Supervision capacity regulation — bootstrap revision",
      rules: DEFAULT_CAPACITY_RULESET,
      rulesSha256: sha256(raw),
      source: "bootstrap",
    };
  }
  const parsed = JSON.parse(row.rulesJson) as unknown;
  const canonical = canonicalJson(parsed);
  if (sha256(canonical) !== row.rulesSha256)
    throw new Error("published regulation integrity check failed");
  return {
    id: row.id,
    versionCode: row.versionCode,
    title: row.title,
    rules: parseCapacityRuleSet(parsed),
    rulesSha256: row.rulesSha256,
    source: "database",
  };
}

export async function listCapacityRegulations(tenantId: string) {
  return readOnly(tenantId, (tx) =>
    tx
      .select()
      .from(regulationVersions)
      .where(eq(regulationVersions.regulationCode, CAPACITY_REGULATION_CODE))
      .orderBy(desc(regulationVersions.createdAt)),
  );
}

export async function createCapacityRegulationDraft(
  viewer: Viewer,
  input: {
    versionCode: string;
    title: string;
    effectiveFrom: string;
    effectiveTo?: string | null;
    publicationReference?: string | null;
    approvedBy?: string | null;
    rulesJson?: string | null;
  },
): Promise<string> {
  const versionCode = input.versionCode.trim();
  const title = input.title.trim();
  if (!versionCode || versionCode.length > 40 || !title || title.length > 240)
    throw new Error("invalid regulation identity");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) throw new Error("invalid effective date");
  if (input.effectiveTo && !/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveTo))
    throw new Error("invalid end date");
  const supplied = input.rulesJson?.trim()
    ? (JSON.parse(input.rulesJson) as unknown)
    : {
        ...DEFAULT_CAPACITY_RULESET,
        metadata: { ...DEFAULT_CAPACITY_RULESET.metadata, revision: versionCode },
      };
  const rules = parseCapacityRuleSet(supplied);
  const canonical = canonicalJson(rules);
  const digest = sha256(canonical);
  return withTenant(viewer.tenantId, async (tx) => {
    const [created] = await tx
      .insert(regulationVersions)
      .values({
        tenantId: viewer.tenantId,
        regulationCode: CAPACITY_REGULATION_CODE,
        versionCode,
        title,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo || null,
        publicationReference: input.publicationReference?.trim() || null,
        approvedBy: input.approvedBy?.trim() || null,
        rulesJson: canonical,
        rulesSha256: digest,
        status: "draft",
      })
      .returning({ id: regulationVersions.id });
    if (!created) throw new Error("regulation draft was not created");
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "regulation.create",
      entityType: "regulation_version",
      entityId: created.id,
      changes: JSON.stringify({ versionCode: { to: versionCode }, rulesSha256: { to: digest } }),
    });
    return created.id;
  });
}

export async function publishCapacityRegulation(viewer: Viewer, id: string): Promise<void> {
  await withTenant(viewer.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(regulationVersions)
      .where(eq(regulationVersions.id, id))
      .limit(1);
    if (row?.status !== "draft") throw new Error("only a draft regulation can be published");
    const parsed = parseCapacityRuleSet(JSON.parse(row.rulesJson) as unknown);
    const canonical = canonicalJson(parsed);
    if (sha256(canonical) !== row.rulesSha256) throw new Error("regulation integrity check failed");
    const overlap = await tx
      .select({ id: regulationVersions.id })
      .from(regulationVersions)
      .where(
        and(
          eq(regulationVersions.regulationCode, row.regulationCode),
          eq(regulationVersions.status, "published"),
          sql`${regulationVersions.effectiveFrom} <= coalesce(${row.effectiveTo}::date, 'infinity'::date)`,
          sql`coalesce(${regulationVersions.effectiveTo}, 'infinity'::date) >= ${row.effectiveFrom}::date`,
        ),
      )
      .limit(1);
    if (overlap.length) throw new Error("published regulation effective periods may not overlap");
    await tx
      .update(regulationVersions)
      .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(regulationVersions.id, id), eq(regulationVersions.status, "draft")));
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "regulation.publish",
      entityType: "regulation_version",
      entityId: id,
      changes: JSON.stringify({
        status: { from: "draft", to: "published" },
        rulesSha256: row.rulesSha256,
      }),
    });
    await appendDomainEvent(tx, viewer.tenantId, {
      type: "RegulationVersionPublished",
      aggregateType: "regulation_version",
      aggregateId: id,
      payload: { code: row.regulationCode, version: row.versionCode, rulesSha256: row.rulesSha256 },
    });
  });
}

export async function retireCapacityRegulation(viewer: Viewer, id: string): Promise<void> {
  await withTenant(viewer.tenantId, async (tx) => {
    const [row] = await tx
      .select({ status: regulationVersions.status, versionCode: regulationVersions.versionCode })
      .from(regulationVersions)
      .where(eq(regulationVersions.id, id))
      .limit(1);
    if (row?.status !== "published") throw new Error("only a published regulation can be retired");
    await tx
      .update(regulationVersions)
      .set({ status: "retired", updatedAt: new Date() })
      .where(eq(regulationVersions.id, id));
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "regulation.retire",
      entityType: "regulation_version",
      entityId: id,
      changes: JSON.stringify({ status: { from: "published", to: "retired" } }),
    });
  });
}

export interface PublishedDecisionTemplate extends DecisionTemplate {
  versionId: string | null;
  versionNo: number;
  source: "database" | "bootstrap";
}

function _schemaForTemplate(template: DecisionTemplate): string {
  return canonicalJson({
    placeholders: template.placeholders,
    description: template.description ?? null,
  });
}

export async function readPublishedDecisionTemplates(
  tenantId: string,
  includeVersionId?: string | null,
): Promise<Record<string, PublishedDecisionTemplate[]>> {
  const rows = await readOnly(tenantId, (tx) =>
    tx
      .select()
      .from(decisionTemplateVersions)
      .where(
        includeVersionId
          ? or(
              eq(decisionTemplateVersions.status, "published"),
              eq(decisionTemplateVersions.id, includeVersionId),
            )
          : eq(decisionTemplateVersions.status, "published"),
      )
      .orderBy(decisionTemplateVersions.templateCode, desc(decisionTemplateVersions.versionNo)),
  );
  /*
   * Published tenant templates override only their matching built-in template.
   * Starting from the bootstrap catalogue is deliberate: publishing one
   * tenant-specific template must not make every untouched built-in template
   * disappear from the ruling editor. Historical versions requested by id are
   * appended under a version-qualified id so an old ruling remains editable
   * without changing the currently published choice.
   */
  const result: Record<string, PublishedDecisionTemplate[]> = Object.fromEntries(
    Object.entries(DECISION_TEMPLATES).map(([category, templates]) => [
      category,
      templates.map((template) => ({
        ...template,
        versionId: null,
        versionNo: 1,
        source: "bootstrap" as const,
      })),
    ]),
  );
  const currentCodeSeen = new Set<string>();
  for (const row of rows) {
    const code = row.templateCode;
    const separator = code.indexOf(":");
    const category = separator > 0 ? code.slice(0, separator) : "other";
    const baseTemplateId = separator > 0 ? code.slice(separator + 1) : code;
    const isCurrentPublished = row.status === "published" && !currentCodeSeen.has(code);
    if (isCurrentPublished) currentCodeSeen.add(code);
    const templateId = isCurrentPublished ? baseTemplateId : `${baseTemplateId}@v${row.versionNo}`;
    const digest = sha256(
      canonicalJson({
        bodyTemplate: row.bodyTemplate,
        schemaJson: row.schemaJson,
        title: row.title,
      }),
    );
    if (digest !== row.contentSha256)
      throw new Error("published decision template integrity check failed");
    const parsed = parseDecisionTemplateSchema(row.schemaJson);
    const placeholders = parsed.placeholders;
    const resolved: PublishedDecisionTemplate = {
      id: templateId,
      name: row.title,
      template: row.bodyTemplate,
      placeholders,
      description: typeof parsed.description === "string" ? parsed.description : "",
      versionId: row.id,
      versionNo: row.versionNo,
      source: "database",
    };
    const categoryTemplates = result[category] ?? [];
    result[category] = categoryTemplates;
    if (isCurrentPublished) {
      const existing = categoryTemplates.findIndex((template) => template.id === baseTemplateId);
      if (existing >= 0) categoryTemplates.splice(existing, 1, resolved);
      else categoryTemplates.push(resolved);
    } else {
      categoryTemplates.push(resolved);
    }
  }
  return result;
}

export async function listDecisionTemplateVersions(tenantId: string) {
  return readOnly(tenantId, (tx) =>
    tx
      .select()
      .from(decisionTemplateVersions)
      .orderBy(decisionTemplateVersions.templateCode, desc(decisionTemplateVersions.versionNo)),
  );
}

export async function createDecisionTemplateDraft(
  viewer: Viewer,
  input: {
    category: string;
    templateId: string;
    title: string;
    bodyTemplate: string;
    placeholders: string[];
    description?: string | null;
  },
): Promise<string> {
  const category = input.category.trim();
  const templateId = input.templateId.trim();
  const title = input.title.trim();
  const bodyTemplate = input.bodyTemplate.trim();
  if (!/^[a-z0-9_-]{2,80}$/.test(category) || !/^[a-z0-9_-]{2,100}$/.test(templateId))
    throw new Error("invalid template code");
  if (!title || title.length > 240 || !bodyTemplate || bodyTemplate.length > 8000)
    throw new Error("invalid template content");
  const schemaJson = canonicalJson(
    buildDecisionTemplateSchema({
      placeholders: input.placeholders,
      ...(input.description !== undefined ? { description: input.description } : {}),
    }),
  );
  const templateCode = `${category}:${templateId}`;
  return withTenant(viewer.tenantId, async (tx) => {
    const [{ next } = { next: 1 }] = await tx
      .select({ next: sql<number>`coalesce(max(${decisionTemplateVersions.versionNo}),0)+1` })
      .from(decisionTemplateVersions)
      .where(eq(decisionTemplateVersions.templateCode, templateCode));
    const digest = sha256(canonicalJson({ bodyTemplate, schemaJson, title }));
    const [created] = await tx
      .insert(decisionTemplateVersions)
      .values({
        tenantId: viewer.tenantId,
        templateCode,
        versionNo: Number(next),
        title,
        bodyTemplate,
        schemaJson,
        contentSha256: digest,
        status: "draft",
        createdBy: viewer.userId,
      })
      .returning({ id: decisionTemplateVersions.id });
    if (!created) throw new Error("template draft was not created");
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "decision_template.create",
      entityType: "decision_template_version",
      entityId: created.id,
      changes: JSON.stringify({
        templateCode: { to: templateCode },
        contentSha256: { to: digest },
      }),
    });
    return created.id;
  });
}

export async function publishDecisionTemplate(viewer: Viewer, id: string): Promise<void> {
  await withTenant(viewer.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(decisionTemplateVersions)
      .where(eq(decisionTemplateVersions.id, id))
      .limit(1);
    if (row?.status !== "draft") throw new Error("only a draft template can be published");
    const digest = sha256(
      canonicalJson({
        bodyTemplate: row.bodyTemplate,
        schemaJson: row.schemaJson,
        title: row.title,
      }),
    );
    if (digest !== row.contentSha256) throw new Error("template integrity check failed");
    parseDecisionTemplateSchema(row.schemaJson);
    await tx
      .update(decisionTemplateVersions)
      .set({ status: "retired", retiredAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(decisionTemplateVersions.templateCode, row.templateCode),
          eq(decisionTemplateVersions.status, "published"),
        ),
      );
    await tx
      .update(decisionTemplateVersions)
      .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(decisionTemplateVersions.id, id), eq(decisionTemplateVersions.status, "draft")),
      );
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "decision_template.publish",
      entityType: "decision_template_version",
      entityId: id,
      changes: JSON.stringify({
        status: { from: "draft", to: "published" },
        contentSha256: row.contentSha256,
      }),
    });
    await appendDomainEvent(tx, viewer.tenantId, {
      type: "DecisionTemplateVersionPublished",
      aggregateType: "decision_template_version",
      aggregateId: id,
      payload: {
        templateCode: row.templateCode,
        versionNo: row.versionNo,
        contentSha256: row.contentSha256,
      },
    });
  });
}

export async function bootstrapDecisionTemplateDrafts(viewer: Viewer): Promise<number> {
  let created = 0;
  for (const [category, templates] of Object.entries(DECISION_TEMPLATES)) {
    for (const template of templates) {
      const code = `${category}:${template.id}`;
      const exists = await readOnly(viewer.tenantId, async (tx) => {
        const rows = await tx
          .select({ id: decisionTemplateVersions.id })
          .from(decisionTemplateVersions)
          .where(eq(decisionTemplateVersions.templateCode, code))
          .limit(1);
        return Boolean(rows[0]);
      });
      if (exists) continue;
      await createDecisionTemplateDraft(viewer, {
        category,
        templateId: template.id,
        title: template.name,
        bodyTemplate: template.template,
        placeholders: template.placeholders,
        description: template.description ?? null,
      });
      created += 1;
    }
  }
  return created;
}
