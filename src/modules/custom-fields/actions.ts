"use server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  correspondence,
  customFieldDefinitions,
  customFieldValues,
  professors,
  researchProjects,
  students,
  workshops,
} from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { isUuid } from "@/lib/uuid.ts";
import { requireCapability, requireViewer } from "@/lib/viewer.ts";
import {
  type CustomFieldDataType,
  type CustomFieldEntityType,
  canManageCustomValues,
  isCustomFieldDataType,
  isCustomFieldEntityType,
  parseOptions,
} from "./model.ts";

const SETTINGS = "/settings/custom-fields";
function bool(value: FormDataEntryValue | null) {
  return value === "on" || value === "true";
}
async function entityExists(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  type: CustomFieldEntityType,
  id: string,
) {
  if (!isUuid(id)) return false;
  if (type === "student")
    return Boolean(
      (
        await tx
          .select({ id: students.id })
          .from(students)
          .where(and(eq(students.id, id), isNull(students.deletedAt)))
          .limit(1)
      )[0],
    );
  if (type === "professor")
    return Boolean(
      (
        await tx
          .select({ id: professors.id })
          .from(professors)
          .where(and(eq(professors.id, id), isNull(professors.deletedAt)))
          .limit(1)
      )[0],
    );
  if (type === "workshop")
    return Boolean(
      (
        await tx
          .select({ id: workshops.id })
          .from(workshops)
          .where(and(eq(workshops.id, id), isNull(workshops.deletedAt)))
          .limit(1)
      )[0],
    );
  if (type === "research_project")
    return Boolean(
      (
        await tx
          .select({ id: researchProjects.id })
          .from(researchProjects)
          .where(and(eq(researchProjects.id, id), isNull(researchProjects.deletedAt)))
          .limit(1)
      )[0],
    );
  return Boolean(
    (
      await tx
        .select({ id: correspondence.id })
        .from(correspondence)
        .where(and(eq(correspondence.id, id), isNull(correspondence.deletedAt)))
        .limit(1)
    )[0],
  );
}
function normaliseValue(
  type: CustomFieldDataType,
  rawValues: FormDataEntryValue[],
  options: string[],
): unknown | undefined {
  const textValues = rawValues
    .filter((one): one is string => typeof one === "string")
    .map((one) => one.trim());
  const text = textValues[0] ?? "";
  if (text === "") return null;
  if (type === "text") return text.length <= 2000 ? text : undefined;
  if (type === "number") {
    const n = Number(text);
    return Number.isFinite(n) ? n : undefined;
  }
  if (type === "date") return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
  if (type === "boolean") return text === "true" ? true : text === "false" ? false : undefined;
  if (type === "select") return options.includes(text) ? text : undefined;
  if (type === "multiselect") {
    const values = textValues.filter(Boolean);
    return values.every((one) => options.includes(one)) && values.length <= options.length
      ? [...new Set(values)]
      : undefined;
  }
  return undefined;
}

export async function createCustomFieldDefinition(form: FormData) {
  const viewer = await requireCapability("custom-fields.manage");
  const entityType = String(form.get("entityType") ?? "");
  const key = String(form.get("key") ?? "").trim();
  const label = String(form.get("label") ?? "").trim();
  const dataType = String(form.get("dataType") ?? "");
  const position = Number(form.get("position") ?? 0);
  const required = bool(form.get("required"));
  if (
    !isCustomFieldEntityType(entityType) ||
    !isCustomFieldDataType(dataType) ||
    !/^[a-z][a-z0-9_]{1,63}$/.test(key) ||
    label.length < 1 ||
    label.length > 160 ||
    !Number.isInteger(position) ||
    position < 0 ||
    position > 10000
  )
    return;
  const options =
    dataType === "select" || dataType === "multiselect"
      ? parseOptions(String(form.get("options") ?? ""))
      : [];
  if (
    options === null ||
    ((dataType === "select" || dataType === "multiselect") && options.length === 0)
  )
    return;
  await withTenant(viewer.tenantId, async (tx) => {
    const [created] = await tx
      .insert(customFieldDefinitions)
      .values({
        tenantId: viewer.tenantId,
        entityType,
        key,
        label,
        dataType,
        required,
        optionsJson: JSON.stringify(options),
        position,
      })
      .onConflictDoNothing()
      .returning({ id: customFieldDefinitions.id });
    if (!created) return;
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "custom_field.create",
      entityType: "custom_field_definition",
      entityId: created.id,
      changes: JSON.stringify({ entityType, key, dataType, required }),
    });
  });
  revalidatePath(SETTINGS);
}

export async function setCustomFieldDefinitionStatus(form: FormData) {
  const viewer = await requireCapability("custom-fields.manage");
  const id = String(form.get("id") ?? "");
  const version = Number(form.get("version"));
  const status = String(form.get("status") ?? "");
  if (!isUuid(id) || !Number.isInteger(version) || !["active", "retired"].includes(status)) return;
  await withTenant(viewer.tenantId, async (tx) => {
    const [changed] = await tx
      .update(customFieldDefinitions)
      .set({ status, version: sql`${customFieldDefinitions.version}+1`, updatedAt: sql`now()` })
      .where(
        and(
          eq(customFieldDefinitions.id, id),
          eq(customFieldDefinitions.version, version),
          isNull(customFieldDefinitions.deletedAt),
        ),
      )
      .returning({ id: customFieldDefinitions.id });
    if (!changed) return;
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "custom_field.status",
      entityType: "custom_field_definition",
      entityId: id,
      changes: JSON.stringify({ status }),
    });
  });
  revalidatePath(SETTINGS);
}

export async function saveCustomFieldValues(form: FormData) {
  const viewer = await requireViewer();
  const entityType = String(form.get("entityType") ?? "");
  const entityId = String(form.get("entityId") ?? "");
  if (
    !isCustomFieldEntityType(entityType) ||
    !canManageCustomValues(viewer, entityType) ||
    !isUuid(entityId)
  )
    return;
  await withTenant(viewer.tenantId, async (tx) => {
    if (!(await entityExists(tx, entityType, entityId))) return;
    const definitions = await tx
      .select({
        id: customFieldDefinitions.id,
        key: customFieldDefinitions.key,
        dataType: customFieldDefinitions.dataType,
        required: customFieldDefinitions.required,
        optionsJson: customFieldDefinitions.optionsJson,
      })
      .from(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.entityType, entityType),
          eq(customFieldDefinitions.status, "active"),
          isNull(customFieldDefinitions.deletedAt),
        ),
      );
    for (const definition of definitions) {
      if (!isCustomFieldDataType(definition.dataType)) continue;
      let parsedOptions: unknown;
      try {
        parsedOptions = JSON.parse(definition.optionsJson);
      } catch (error) {
        throw new Error("custom field options contain invalid JSON", { cause: error });
      }
      if (!Array.isArray(parsedOptions) || parsedOptions.some((one) => typeof one !== "string")) {
        throw new Error("custom field options violate the stored JSON contract");
      }
      const options = parsedOptions as string[];
      const value = normaliseValue(
        definition.dataType,
        form.getAll(`custom:${definition.key}`),
        options,
      );
      if (value === undefined || (definition.required && value === null)) return;
      if (value === null)
        await tx
          .delete(customFieldValues)
          .where(
            and(
              eq(customFieldValues.definitionId, definition.id),
              eq(customFieldValues.entityType, entityType),
              eq(customFieldValues.entityId, entityId),
            ),
          );
      else
        await tx
          .insert(customFieldValues)
          .values({
            tenantId: viewer.tenantId,
            definitionId: definition.id,
            entityType,
            entityId,
            valueJson: JSON.stringify(value),
          })
          .onConflictDoUpdate({
            target: [
              customFieldValues.tenantId,
              customFieldValues.definitionId,
              customFieldValues.entityType,
              customFieldValues.entityId,
            ],
            set: { valueJson: JSON.stringify(value), updatedAt: sql`now()` },
          });
    }
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "custom_field_values.update",
      entityType,
      entityId,
      changes: JSON.stringify({ fields: definitions.map((one) => one.key) }),
    });
  });
  revalidatePath(
    `/${entityType === "research_project" ? "research-projects" : entityType === "correspondence" ? "correspondence" : `${entityType}s`}/${entityId}`,
  );
}
