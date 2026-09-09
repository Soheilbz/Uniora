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
import { isPinned } from "@/modules/experience/records.ts";
import {
  PROFESSOR_FIELDS,
  PROFESSOR_GROUPS,
  PROFESSOR_LOOKUP_SETS,
  type ProfessorFieldSpec,
} from "@/modules/professors/fields.ts";
import { readProfessor, supervisedStudents } from "@/modules/professors/register.ts";
import {
  revealProfessorBankAccount,
  revealProfessorNationalId,
} from "@/modules/professors/sensitive.ts";

/**
 * One professor's record.
 *
 * Rendered from `PROFESSOR_FIELDS`, so a column added to the schema and the
 * field list appears here without this file being touched. Four tabs, in the
 * order of the personnel folder somebody is transcribing from.
 */

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const metaId = (await params).id;
  if (!isUuid(metaId)) notFound();
  const { viewer } = await requireModule("/professors");
  const professor = await readProfessor(viewer.tenantId, metaId);
  const t = await getTranslations("professors");
  return { title: professor ? `${professor.firstName} ${professor.lastName}` : t("title") };
}

export default async function ProfessorRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { viewer } = await requireModule("/professors");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [professor, lookups, customFields, t, common, nav, root, customT] = await Promise.all([
    readProfessor(viewer.tenantId, id),
    /* The student seats below name a degree and a standing, so those two
       vocabularies come along with the professor's own. */
    lookupTable(viewer.tenantId, [...PROFESSOR_LOOKUP_SETS, "degrees", "student_statuses"]),
    readCustomFieldRecord(viewer, "professor", id),
    getTranslations("professors"),
    getTranslations("common"),
    getTranslations("nav"),
    /* Unnamespaced: a choice's `labelKey` is a path from the root, so the same
       wording serves every register that offers the same answer. */
    getTranslations(),
    getTranslations("customFields"),
  ]);

  if (!professor) notFound();

  const format = await getFormatter();
  const locale = await getLocale();
  const canManage = can(viewer, "professors.manage");
  const canSeeNationalId = can(viewer, "professors.sensitive.read");
  const canSeeFinancial = can(viewer, "professors.bank.read");
  const sensitive = await getTranslations("sensitive");
  const canSeeStudents = can(viewer, "students.view");
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
  const history = canReadHistory
    ? await historyTab(viewer.tenantId, "professor", professor.id)
    : null;

  /* Awaited here for the same reason `history` is — what reaches `RecordTabs`
     has to be a resolved array, not something that settles later. */
  const supervised = canSeeStudents ? await supervisedStudents(viewer.tenantId, professor.id) : [];

  const value = (field: ProfessorFieldSpec): React.ReactNode => {
    const raw = (professor as Record<string, unknown>)[field.key];

    if (field.key === "nationalId") {
      if (!canSeeNationalId)
        return <span className="text-muted-foreground">{common("restricted")}</span>;
      return (
        <SensitiveReveal
          entityId={professor.id}
          action={revealProfessorNationalId}
          revealLabel={sensitive("reveal")}
          hideLabel={sensitive("hide")}
          emptyLabel={sensitive("empty")}
          locale={locale}
        />
      );
    }
    if (field.key === "bankAccountNumber") {
      if (!canSeeFinancial)
        return <span className="text-muted-foreground">{common("restricted")}</span>;
      return (
        <SensitiveReveal
          entityId={professor.id}
          action={revealProfessorBankAccount}
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
         * vocabulary rather than from a map of value to colour — the same rule
         * the student record follows, and for the same reason: an academic rank
         * is a taxonomy and none of its values is a success or a failure this
         * software is entitled to have an opinion about.
         */
        const entries = lookups.get(field.set ?? "") ?? [];
        const index = entries.findIndex((entry) => entry.value === String(raw));
        if (index < 0) {
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

      case "choice": {
        /* A value the code no longer offers is shown as itself rather than
           dropped — the same rule as an unknown vocabulary key above: a stored
           value nothing recognises is a fault, and an empty cell would report
           it as «not recorded». */
        if (!raw) return null;
        const choice = field.choices?.find((one) => one.value === String(raw));
        return choice ? root(choice.labelKey) : String(raw);
      }

      case "date":
        return raw ? format.dateTime(new Date(String(raw)), { dateStyle: "long" }) : null;

      case "boolean":
        return raw === null || raw === undefined ? null : raw ? common("yes") : common("no");

      case "number":
        return raw === null || raw === undefined ? null : format.number(Number(raw));

      default: {
        if (!raw) return null;
        /*
         * Identifiers and telephone numbers are shown in the reader's numerals;
         * an email address and a link are not — an address with Persian digits
         * in it is an address that does not resolve.
         */
        const shown = String(raw);
        const localised =
          field.format === "digits" || field.format === "nationalId" || field.format === "tel";
        return localised ? toLocaleDigits(shown, locale) : shown;
      }
    }
  };

  const isLtr = (field: ProfessorFieldSpec) =>
    field.kind === "number" ||
    field.format === "digits" ||
    field.format === "nationalId" ||
    field.format === "code" ||
    field.format === "tel" ||
    field.format === "email";

  /** The catalogue spells the four seats in title case; the column does not. */
  const seatName = (seat: string) => seat.charAt(0).toUpperCase() + seat.slice(1);

  const name = `${professor.firstName} ${professor.lastName}`;
  const pinned = await isPinned(viewer, "professor", professor.id);

  /** One vocabulary word, or nothing recorded. */
  const label = (set: string, value: string | null) =>
    value ? (lookups.get(set)?.find((entry) => entry.value === value)?.label ?? value) : null;

  const standingEntries = lookups.get("professor_statuses") ?? [];
  const standingIndex = standingEntries.findIndex((entry) => entry.value === professor.status);
  const standing = standingEntries[standingIndex];

  const crumbs: Crumb[] = [{ label: nav("professors"), href: "/professors" }, { label: name }];

  return (
    <PageBody>
      <PageHeader breadcrumbLabel={nav("breadcrumb")} breadcrumbs={crumbs} />

      <RecordHeader
        name={name}
        identifier={
          professor.professorCode ? toLocaleDigits(professor.professorCode, locale) : null
        }
        /*
         * «rank · university · department» on one line — where somebody is,
         * read outward. Only the parts on file: a directory holds plenty of
         * people with no university recorded, and separators drawn regardless
         * turn those headers into a row of punctuation.
         */
        secondary={
          [
            label("academic_ranks", professor.academicRank),
            label("universities", professor.university),
            label("departments", professor.department),
          ]
            .filter(Boolean)
            .join(" · ") || null
        }
        /*
         * The standing, not the rank.
         *
         * A rank is an identity and it is already in the line above; what the
         * badge is for is the fact that changes what somebody may be appointed
         * to — «بازنشسته», «مرخصی بدون حقوق». Putting the rank here said
         * «دانشیار» twice and left the standing nowhere on the header at all.
         */
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
              entityType="professor"
              entityId={professor.id}
              label={name}
              href={`/professors/${professor.id}`}
              initialPinned={pinned}
              pinLabel={common("pin")}
              unpinLabel={common("unpin")}
            />
            <PrintButton label={common("print")} />
            {canManage && (
              <Button
                nativeButton={false}
                render={
                  <Link href={`/professors/${professor.id}/edit`}>
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
       * Four tabs rather than four stacked cards. A personnel record is thirty
       * fields; stacked, finding the bank details means scrolling past the other
       * twenty-five every time, and the office reads one section at a sitting.
       */}
      <RecordTabs
        tabs={[
          ...PROFESSOR_GROUPS.map((group) => ({
            value: group,
            label: t(`group.${group}`),
            content: (
              <RecordSection title={t(`group.${group}`)} description={t(`section.${group}Hint`)}>
                {PROFESSOR_FIELDS.filter((field) => field.group === group).map((field) => (
                  <RecordField key={field.key} label={t(`field.${field.key}`)} ltr={isLtr(field)}>
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
                      entityType="professor"
                      entityId={professor.id}
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
           * Who this professor supervises, and in which chair.
           *
           * On the record rather than as a column on the register: a bare «۹» in
           * a directory is a number with no denominator, and the seat is what
           * makes it answerable — a first supervisor carries the work, a third is
           * a name on a panel.
           *
           * `canSeeStudents`, because this lists people from another register.
           * Somebody who may read the directory but not the student roll gets
           * the tab dropped rather than shown empty, which would read as a
           * professor with no students.
           */
          ...(canSeeStudents
            ? [
                {
                  value: "students",
                  label: t("record.students"),
                  content: (
                    <RecordSection
                      title={t("record.students")}
                      description={t("record.studentsHint", {
                        enrolled: supervised.filter((one) => one.status === "enrolled").length,
                        total: supervised.length,
                      })}
                    >
                      {supervised.length === 0 ? (
                        <p className="text-sm text-muted-foreground sm:col-span-3">
                          {t("record.noStudents")}
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 sm:col-span-3">
                          {supervised.map((student) => {
                            const seat = seatName(student.seat);
                            const roleTone =
                              seat === "FirstSupervisor"
                                ? "border-primary/40 bg-primary/5 text-primary"
                                : seat === "SecondSupervisor"
                                  ? "border-sky-500/40 bg-sky-500/5 text-sky-700 dark:text-sky-300"
                                  : "border-warning-subtle-border bg-warning-subtle text-warning-subtle-foreground";

                            return (
                              <div
                                key={`${student.id}-${student.seat}`}
                                className="group relative flex flex-col justify-between gap-3 rounded-xl border border-border/70 bg-background/70 p-3.5 shadow-2xs transition-all duration-150 hover:border-primary/50 hover:bg-background hover:shadow-xs"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex min-w-0 flex-col gap-0.5">
                                    <Link
                                      href={`/students/${student.id}`}
                                      className="truncate text-sm font-bold text-foreground transition-colors group-hover:text-primary hover:underline"
                                    >
                                      {student.firstName} {student.lastName}
                                    </Link>
                                    <span
                                      className="numeric text-xs font-semibold text-muted-foreground"
                                      dir="ltr"
                                    >
                                      {toLocaleDigits(student.studentNumber, locale)}
                                    </span>
                                  </div>
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold",
                                      roleTone,
                                    )}
                                  >
                                    {t(`record.seat${seat}`)}
                                  </Badge>
                                </div>

                                <div className="flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-2 text-xs">
                                  {student.degree && (
                                    <Badge
                                      variant="outline"
                                      className="rounded-md bg-muted/30 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
                                    >
                                      {label("degrees", student.degree)}
                                    </Badge>
                                  )}
                                  {student.status && (
                                    <Badge
                                      variant="outline"
                                      className="rounded-md bg-muted/30 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
                                    >
                                      {label("student_statuses", student.status)}
                                    </Badge>
                                  )}
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                                      student.hasCouncilDecision
                                        ? "border-success-subtle-border bg-success-subtle text-success-subtle-foreground"
                                        : "border-warning-subtle-border bg-warning-subtle text-warning-subtle-foreground",
                                    )}
                                  >
                                    {student.hasCouncilDecision
                                      ? t("record.hasDecision")
                                      : t("record.noDecision")}
                                  </Badge>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </RecordSection>
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
