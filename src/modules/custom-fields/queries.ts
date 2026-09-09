import { and, asc, eq, isNull } from "drizzle-orm";
import { customFieldDefinitions, customFieldValues } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import type { Viewer } from "@/lib/capabilities.ts";
import { type CustomFieldEntityType, canManageCustomValues, canReadCustomValues } from "./model.ts";

export interface CustomFieldDefinitionView {
  id: string;
  version: number;
  entityType: string;
  key: string;
  label: string;
  dataType: string;
  required: boolean;
  options: string[];
  position: number;
  status: string;
}

function decodeOptions(raw: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error("custom field options contain invalid JSON", { cause: error });
  }
  if (!Array.isArray(value) || value.some((one) => typeof one !== "string")) {
    throw new Error("custom field options violate the stored JSON contract");
  }
  return value;
}
function decodeValue(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("custom field value contains invalid JSON", { cause: error });
  }
}

export async function readCustomFieldDefinitions(
  tenantId: string,
  entityType?: CustomFieldEntityType,
) {
  return readOnly(tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: customFieldDefinitions.id,
        version: customFieldDefinitions.version,
        entityType: customFieldDefinitions.entityType,
        key: customFieldDefinitions.key,
        label: customFieldDefinitions.label,
        dataType: customFieldDefinitions.dataType,
        required: customFieldDefinitions.required,
        optionsJson: customFieldDefinitions.optionsJson,
        position: customFieldDefinitions.position,
        status: customFieldDefinitions.status,
      })
      .from(customFieldDefinitions)
      .where(
        and(
          isNull(customFieldDefinitions.deletedAt),
          ...(entityType ? [eq(customFieldDefinitions.entityType, entityType)] : []),
        ),
      )
      .orderBy(
        asc(customFieldDefinitions.entityType),
        asc(customFieldDefinitions.position),
        asc(customFieldDefinitions.label),
      );
    return rows.map((row) => ({
      ...row,
      required: row.required,
      options: decodeOptions(row.optionsJson),
    }));
  });
}

export async function readCustomFieldRecord(
  viewer: Viewer,
  entityType: CustomFieldEntityType,
  entityId: string,
) {
  if (!canReadCustomValues(viewer, entityType)) return { fields: [], canManage: false };
  return readOnly(viewer.tenantId, async (tx) => {
    const fields = await tx
      .select({
        id: customFieldDefinitions.id,
        key: customFieldDefinitions.key,
        label: customFieldDefinitions.label,
        dataType: customFieldDefinitions.dataType,
        required: customFieldDefinitions.required,
        optionsJson: customFieldDefinitions.optionsJson,
        position: customFieldDefinitions.position,
        valueJson: customFieldValues.valueJson,
      })
      .from(customFieldDefinitions)
      .leftJoin(
        customFieldValues,
        and(
          eq(customFieldValues.definitionId, customFieldDefinitions.id),
          eq(customFieldValues.entityType, entityType),
          eq(customFieldValues.entityId, entityId),
        ),
      )
      .where(
        and(
          eq(customFieldDefinitions.entityType, entityType),
          eq(customFieldDefinitions.status, "active"),
          isNull(customFieldDefinitions.deletedAt),
        ),
      )
      .orderBy(asc(customFieldDefinitions.position), asc(customFieldDefinitions.label));
    return {
      fields: fields.map((row) => ({
        id: row.id,
        key: row.key,
        label: row.label,
        dataType: row.dataType,
        required: row.required,
        options: decodeOptions(row.optionsJson),
        value: decodeValue(row.valueJson),
      })),
      canManage: canManageCustomValues(viewer, entityType),
    };
  });
}
