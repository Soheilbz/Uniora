import { getLocale, getTranslations } from "next-intl/server";
import { sittingDate } from "@/components/council/paper.tsx";
import { toLocaleDigits } from "@/lib/digits.ts";
import { formOptions, lookupTable } from "@/lib/lookups.ts";
import { recordValue } from "@/lib/record-value.ts";
import { readProfessorOptions, readStudentOptions } from "@/modules/directory/options.ts";
import {
  BOARD_SEATS,
  COUNCIL_LOOKUP_SETS,
  type CouncilField,
  type CouncilGroup,
  SUPERVISION_SEATS,
} from "./fields.ts";
import { readSittings } from "./papers.ts";

/**
 * Everything a council form needs, assembled on the server.
 */
export async function buildCouncilForm(
  tenantId: string,
  fields: readonly CouncilField[],
  groups: readonly CouncilGroup[],
  namespace: "council" | "decisions",
  record?: object,
  professors?: { id: string; name: string }[],
) {
  const isDecisionOrRelated = namespace === "decisions";
  const [lookups, t, sittings, directoryProfessors, directoryStudents, locale, documents] =
    await Promise.all([
      lookupTable(tenantId, COUNCIL_LOOKUP_SETS),
      getTranslations(namespace),
      isDecisionOrRelated ? readSittings(tenantId) : Promise.resolve([]),
      readProfessorOptions(tenantId),
      isDecisionOrRelated ? readStudentOptions(tenantId) : Promise.resolve([]),
      getLocale(),
      getTranslations("documents"),
    ]);

  const activeProfessors = professors ?? directoryProfessors;
  const options: Record<string, { value: string; label: string; parent?: string }[]> = {};
  const autofillMap: Record<string, Record<string, Record<string, string>>> = {};

  // 1. Sittings / Meetings Options & Autofill
  if (isDecisionOrRelated && sittings.length > 0) {
    options.meetingNumber = sittings.map((s) => ({
      value: s.meetingNumber,
      label: `${documents("meetingOption", {
        number: toLocaleDigits(s.meetingNumber, locale),
        count: toLocaleDigits(String(s.items), locale),
      })}${s.meetingDate ? ` — ${toLocaleDigits(sittingDate(s.meetingDate), locale)}` : ""}`,
    }));

    autofillMap.meetingNumber = {};
    for (const s of sittings) {
      autofillMap.meetingNumber[s.meetingNumber] = {
        meetingDate: s.meetingDate ?? "",
        meetingTime: s.meetingTime ?? "",
        meetingDay: s.meetingDay ?? "",
        meetingLocation: s.meetingLocation ?? "",
        researchDeputy: s.researchDeputy ?? "",
      };
    }
  }

  // 2. Students Options & Autofill
  if (isDecisionOrRelated && directoryStudents.length > 0) {
    options.studentNumber = directoryStudents.map((st) => ({
      value: st.studentNumber,
      label: `${toLocaleDigits(st.studentNumber, locale)} — ${st.name}`,
    }));

    options.studentName = directoryStudents.map((st) => ({
      value: st.name,
      label: st.name,
    }));

    autofillMap.studentNumber = {};
    for (const st of directoryStudents) {
      autofillMap.studentNumber[st.studentNumber] = {
        studentName: st.name,
        educationLevel: st.degree ?? "",
        fieldOfStudy: st.fieldOfStudy ?? "",
      };
    }
  }

  // 3. Professors Options for Supervisors, Examination Board & Signatories
  const profNameOptions = activeProfessors.map((p) => ({
    value: p.name,
    label: p.name,
  }));

  const officerKeys = [
    "facultyDean",
    "departmentCouncil",
    "educationOffice",
    "educationalCulturalDeputy",
    "researchDeputy",
    "departmentHead",
    "groupManager",
  ];

  for (const seat of [...SUPERVISION_SEATS, ...BOARD_SEATS, ...officerKeys]) {
    if (fields.some((f) => f.key === seat) && !options[seat]) {
      options[seat] = profNameOptions;
    }
  }

  for (const field of fields) {
    if (options[field.key]) {
      continue;
    }
    if (field.kind === "reference") {
      options[field.key] = activeProfessors.map((professor) => ({
        value: professor.id,
        label: professor.name,
      }));
      continue;
    }
    if (field.kind !== "lookup" || !field.set) continue;
    options[field.key] = formOptions(lookups, field.set);
  }

  const values: Record<string, string> = {};
  for (const field of fields) {
    const raw = record ? recordValue(record, field.key) : undefined;
    values[field.key] = Array.isArray(raw)
      ? raw.join("\n")
      : raw === null || raw === undefined
        ? ""
        : String(raw);
  }

  const labels = Object.fromEntries(fields.map((field) => [field.key, t(`field.${field.key}`)]));
  const groupLabels = Object.fromEntries(
    groups.map((group) => [group, { title: t(`group.${group}`), hint: t(`section.${group}Hint`) }]),
  );

  return {
    options,
    values,
    labels,
    groupLabels,
    hints: {} as Record<string, string>,
    autofillMap,
  };
}
