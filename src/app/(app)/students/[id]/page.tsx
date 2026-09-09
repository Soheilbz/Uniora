import { Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { CustomFieldsPanel } from "@/components/engine/custom-fields-panel.tsx";
import { PrintButton } from "@/components/engine/print-anchor";
import { RecordActivity } from "@/components/engine/record-activity.tsx";
import { RecordField, RecordSection } from "@/components/engine/record-detail";
import { RecordHeader } from "@/components/engine/record-header";
import { historyTab } from "@/components/engine/record-history";
import { RecordTabs } from "@/components/engine/record-tabs";
import { SensitiveReveal } from "@/components/engine/sensitive-reveal";
import { TONES } from "@/components/engine/tones.ts";
import { type Crumb, PageBody, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/capabilities.ts";
import { toLocaleDigits } from "@/lib/digits.ts";
import { lookupTable } from "@/lib/lookups.ts";
import { cn } from "@/lib/utils";
import { isUuid } from "@/lib/uuid.ts";
import { requireModule } from "@/lib/viewer.ts";
import { readCustomFieldRecord } from "@/modules/custom-fields/queries.ts";
import { readProfessorOptions } from "@/modules/directory/options.ts";
import { isPinned } from "@/modules/experience/records.ts";
import {
  FIELD_GROUPS,
  type FieldSpec,
  fieldsIn,
  labelKey,
  STUDENT_LOOKUP_SETS,
} from "@/modules/students/fields.ts";
import { readStudent } from "@/modules/students/record.ts";
import { revealStudentNationalId } from "@/modules/students/sensitive.ts";

/**
 * One student's record.
 *
 * Rendered from `STUDENT_FIELDS`, so a column added to the schema and the field
 * list appears here without this file being touched. Four cards, in the order of
 * the paper folder somebody is transcribing from.
 */

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const metaId = (await params).id;
  if (!isUuid(metaId)) notFound();
  const { viewer } = await requireModule("/students");
  const student = await readStudent(viewer.tenantId, metaId);
  const t = await getTranslations("students");
  /*
   * The tab is named for the person, which is what makes six open records
   * distinguishable. Falling back to the register's own title rather than
   * leaving it blank when the record is gone.
   */
  return { title: student ? `${student.firstName} ${student.lastName}` : t("title") };
}

export default async function StudentRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { viewer } = await requireModule("/students");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [student, lookups, professorOptions, customFields, t, common, nav, customT] =
    await Promise.all([
      readStudent(viewer.tenantId, id),
      lookupTable(viewer.tenantId, STUDENT_LOOKUP_SETS),
      readProfessorOptions(viewer.tenantId),
      readCustomFieldRecord(viewer, "student", id),
      getTranslations("students"),
      getTranslations("common"),
      getTranslations("nav"),
      getTranslations("customFields"),
    ]);
  const sensitive = await getTranslations("sensitive");

  if (!student) notFound();

  const format = await getFormatter();
  const locale = await getLocale();
  const canManage = can(viewer, "students.manage");
  const canReadHistory = can(viewer, "audit.view");
  /*
   * Resolved here, not inside the JSX below.
   *
   * `await` inside the array handed to `RecordTabs` makes this panel stream as
   * its own chunk, and Base UI's tabs — which register on mount — ended up
   * holding two entries: two tabs reporting `aria-selected="true"`, two panels
   * on screen, and with the full component in place a re-render loop that took
   * the page down. Awaited up here, the array the client component receives is
   * an ordinary resolved value.
   */
  const history = canReadHistory ? await historyTab(viewer.tenantId, "student", student.id) : null;
  const professorNames = new Map(professorOptions.map((option) => [option.id, option.name]));

  /**
   * Whether this viewer may read the national identity number.
   *
   * A separate capability from `students.view`, because it is a separate
   * decision: most staff have every reason to open a student's record and no
   * reason at all to read their national id. Withheld, the field still appears
   * — it is a field this record has — and says it is restricted rather than
   * saying the number is not recorded, which would be a lie about the data.
   */
  const canSeeNationalId = can(viewer, "students.sensitive.read");

  const value = (field: FieldSpec): React.ReactNode => {
    const raw = student[field.key as keyof typeof student];

    if (field.key === "nationalId") {
      if (!canSeeNationalId)
        return <span className="text-muted-foreground">{common("restricted")}</span>;
      return (
        <SensitiveReveal
          entityId={student.id}
          action={revealStudentNationalId}
          revealLabel={sensitive("reveal")}
          hideLabel={sensitive("hide")}
          emptyLabel={sensitive("empty")}
          locale={locale}
        />
      );
    }

    switch (field.kind) {
      case "lookup": {
        if (!raw) return null;
        /*
         * The chip's colour comes from the entry's position in its own
         * vocabulary, not from a map of value to colour.
         *
         * A standing is a taxonomy, and none of «فارغ‌التحصیل», «انصراف»,
         * «اخراج» is a success or a failure this software is entitled to have
         * an opinion about. A value-to-colour map gets «اخراج» a destructive
         * red beside «انتقالی» in the same red, and gives every value it has
         * never heard of one default — so the column reads as a single smear.
         * Position gives each value a stable identity, distinct from its
         * neighbours, and works for a vocabulary invented this morning.
         */
        const entries = lookups.get(field.set ?? "") ?? [];
        const index = entries.findIndex((entry) => entry.value === String(raw));
        if (index < 0) {
          // A value no vocabulary defines: shown as itself, in outline. That is
          // a data fault, and putting it in front of the person who can correct
          // it beats an empty cell that reads as "not recorded".
          return (
            <Badge variant="outline" className="font-normal">
              {String(raw)}
            </Badge>
          );
        }
        return (
          <Badge variant="outline" className={cn("font-normal", TONES[index % TONES.length])}>
            {entries[index]?.label}
          </Badge>
        );
      }

      case "reference":
        /*
         * A supervisor whose id resolves to nobody is shown as the id rather
         * than as blank. That happens when a professor's record is removed —
         * the foreign key sets the column to null, so a *stale* id should be
         * impossible, and if one appears it is a fault worth seeing.
         */
        return raw ? (professorNames.get(String(raw)) ?? String(raw)) : null;

      case "date":
        // Jalali, because the locale is `fa` — the column holds an ISO date and
        // the calendar is a rendering decision. See `validation.ts`.
        return raw ? format.dateTime(new Date(String(raw)), { dateStyle: "long" }) : null;

      case "boolean":
        return raw === null ? null : raw ? common("yes") : common("no");

      case "number":
        return raw === null ? null : format.number(Number(raw));

      default: {
        if (!raw) return null;
        /*
         * Identifiers and telephone numbers are shown in the reader's numerals;
         * a passport number and an email address are not. A passport number is
         * alphanumeric and belongs to another country's system, and an address
         * with Persian digits in it is an address that does not resolve.
         */
        const shown = String(raw);
        const localised =
          field.format === "digits" || field.format === "nationalId" || field.format === "tel";
        return localised ? toLocaleDigits(shown, locale) : shown;
      }
    }
  };

  /** Identifiers, figures and addresses are laid out left-to-right. */
  const isLtr = (field: FieldSpec) =>
    field.kind === "number" ||
    field.format === "digits" ||
    field.format === "nationalId" ||
    field.format === "code" ||
    field.format === "tel" ||
    field.format === "email";

  const name = `${student.firstName} ${student.lastName}`;
  const pinned = await isPinned(viewer, "student", student.id);
  const standingIndex = (lookups.get("student_statuses") ?? []).findIndex(
    (entry) => entry.value === student.status,
  );
  const standing = lookups.get("student_statuses")?.[standingIndex];

  const crumbs: Crumb[] = [{ label: nav("students"), href: "/students" }, { label: name }];

  return (
    <PageBody>
      {/*
       * Breadcrumbs without a title: `RecordHeader` below carries the `h1`, and
       * a visible page title above it printed the same name twice, stacked.
       */}
      <PageHeader breadcrumbLabel={nav("breadcrumb")} breadcrumbs={crumbs} />

      <RecordHeader
        name={name}
        identifier={toLocaleDigits(student.studentNumber, locale)}
        secondary={
          student.department
            ? (lookups.get("departments")?.find((entry) => entry.value === student.department)
                ?.label ?? student.department)
            : null
        }
        standing={
          standing ? (
            <Badge
              variant="outline"
              className={cn("font-normal", TONES[standingIndex % TONES.length])}
            >
              {standing.label}
            </Badge>
          ) : null
        }
        actions={
          <>
            <RecordActivity
              entityType="student"
              entityId={student.id}
              label={name}
              href={`/students/${student.id}`}
              initialPinned={pinned}
              pinLabel={common("pin")}
              unpinLabel={common("unpin")}
            />
            <PrintButton label={common("print")} />
            {canManage && (
              <Button
                nativeButton={false}
                render={
                  <Link href={`/students/${student.id}/edit`}>
                    <Pencil className="size-4" aria-hidden />
                    {common("edit")}
                  </Link>
                }
              />
            )}
          </>
        }
      />

      {/*
       * Four tabs rather than four stacked cards. A student record is fifty
       * fields; stacked, finding the prior-degree section means scrolling past
       * the other thirty-five every time, and the office reads one section at a
       * sitting.
       */}
      <RecordTabs
        tabs={[
          ...FIELD_GROUPS.map((group) => ({
            value: group,
            label: t(`group.${group}`),
            content: (
              <RecordSection title={t(`group.${group}`)} description={t(`section.${group}Hint`)}>
                {fieldsIn(group).map((field) => (
                  <RecordField key={field.key} label={t(labelKey(field))} ltr={isLtr(field)}>
                    {value(field)}
                  </RecordField>
                ))}
              </RecordSection>
            ),
          })),
          ...(customFields.fields.length > 0
            ? [
                {
                  value: "custom-fields",
                  label: customT("recordTitle"),
                  content: (
                    <CustomFieldsPanel
                      entityType="student"
                      entityId={student.id}
                      fields={customFields.fields}
                      canManage={customFields.canManage}
                      words={{
                        title: customT("recordTitle"),
                        description: customT("recordDescription"),
                        empty: customT("empty"),
                        save: customT("save"),
                        yes: common("yes"),
                        no: common("no"),
                      }}
                    />
                  ),
                },
              ]
            : []),
          /*
           * Who changed what, and when — only for a reader of the trail.
           *
           * The tab is dropped rather than shown empty. `audit.view` is a real
           * permission, because the log names every colleague's edits, and a
           * tab that is always there but never has anything in it reads as a
           * broken screen rather than as a closed door.
           */
          ...(history ? [history] : []),
        ]}
      />
    </PageBody>
  );
}
