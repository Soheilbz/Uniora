import { revalidatePath } from "next/cache";
import { workshops } from "@/db/schema.ts";
import { importFor, planFor, rollbackFor } from "@/lib/register/import-action.ts";
import { schemaFor } from "@/lib/register/validation.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { WORKSHOP_FIELDS, WORKSHOP_LOOKUP_SETS } from "../model.ts";

const BASE = "/workshops";
const WORKSHOP_IMPORT = {
  table: workshops,
  id: workshops.id,
  deletedAt: workshops.deletedAt,
  version: workshops.version,
  keyColumn: workshops.title,
  keyField: "title",
  fields: WORKSHOP_FIELDS,
  lookupSets: WORKSHOP_LOOKUP_SETS,
  schema: schemaFor(WORKSHOP_FIELDS),
  namespace: "workshops",
  entityType: "workshop",
};

export async function planWorkshopImport(text: string) {
  const viewer = await requireCapability("workshops.view", "workshops.manage");
  const { plan } = await planFor(viewer.tenantId, WORKSHOP_IMPORT, text);
  return plan;
}

export async function importWorkshops(text: string) {
  const viewer = await requireCapability("workshops.view", "workshops.manage");
  const outcome = await importFor(viewer.tenantId, viewer.userId, WORKSHOP_IMPORT, text);
  revalidatePath(BASE);
  return outcome;
}

export async function rollbackWorkshopImport(batchId: string) {
  const viewer = await requireCapability("workshops.view", "workshops.manage");
  const outcome = await rollbackFor(viewer.tenantId, viewer.userId, WORKSHOP_IMPORT, batchId);
  if (outcome.rolledBack > 0) revalidatePath(BASE);
  return outcome;
}
