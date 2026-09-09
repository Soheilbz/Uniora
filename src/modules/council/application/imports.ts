import { revalidatePath } from "next/cache";
import { councilDecisions, councilMeetings } from "@/db/schema.ts";
import { importFor, planFor, rollbackFor } from "@/lib/register/import-action.ts";
import { schemaFor } from "@/lib/register/validation.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { COUNCIL_LOOKUP_SETS, DECISION_FIELDS, MEETING_FIELDS } from "../fields.ts";

const MEETINGS = "/council-meetings";
const DECISIONS = "/council-decisions";
const MEETING_IMPORT = {
  table: councilMeetings,
  id: councilMeetings.id,
  deletedAt: councilMeetings.deletedAt,
  version: councilMeetings.version,
  keyColumn: councilMeetings.meetingNumber,
  keyField: "meetingNumber",
  fields: MEETING_FIELDS,
  lookupSets: COUNCIL_LOOKUP_SETS,
  schema: schemaFor(MEETING_FIELDS),
  namespace: "council",
  entityType: "council_meeting",
};
const DECISION_IMPORT = {
  table: councilDecisions,
  id: councilDecisions.id,
  deletedAt: councilDecisions.deletedAt,
  version: councilDecisions.version,
  keyColumn: councilDecisions.thesisCode,
  keyField: "thesisCode",
  identity: [
    { field: "meetingNumber", column: councilDecisions.meetingNumber },
    { field: "reportCategory", column: councilDecisions.reportCategory },
    { field: "thesisCode", column: councilDecisions.thesisCode },
  ],
  fields: DECISION_FIELDS,
  lookupSets: COUNCIL_LOOKUP_SETS,
  schema: schemaFor(DECISION_FIELDS),
  namespace: "decisions",
  entityType: "council_decision",
};

export async function planMeetingImport(text: string) {
  const viewer = await requireCapability("council.view", "council.manage");
  const { plan } = await planFor(viewer.tenantId, MEETING_IMPORT, text);
  return plan;
}
export async function importMeetings(text: string) {
  const viewer = await requireCapability("council.view", "council.manage");
  const outcome = await importFor(viewer.tenantId, viewer.userId, MEETING_IMPORT, text);
  revalidatePath(MEETINGS);
  return outcome;
}
export async function rollbackMeetingImport(batchId: string) {
  const viewer = await requireCapability("council.view", "council.manage");
  const outcome = await rollbackFor(viewer.tenantId, viewer.userId, MEETING_IMPORT, batchId);
  if (outcome.rolledBack > 0) revalidatePath(MEETINGS);
  return outcome;
}
export async function planDecisionImport(text: string) {
  const viewer = await requireCapability("council.view", "council.manage");
  const { plan } = await planFor(viewer.tenantId, DECISION_IMPORT, text);
  return plan;
}
export async function importDecisions(text: string) {
  const viewer = await requireCapability("council.view", "council.manage");
  const outcome = await importFor(viewer.tenantId, viewer.userId, DECISION_IMPORT, text);
  revalidatePath(DECISIONS);
  return outcome;
}
export async function rollbackDecisionImport(batchId: string) {
  const viewer = await requireCapability("council.view", "council.manage");
  const outcome = await rollbackFor(viewer.tenantId, viewer.userId, DECISION_IMPORT, batchId);
  if (outcome.rolledBack > 0) revalidatePath(DECISIONS);
  return outcome;
}
