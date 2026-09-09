import { CheckCircle2, Circle, ExternalLink, Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { CouncilWorkflowPanel } from "@/components/council/workflow-panel.tsx";
import { PrintButton } from "@/components/engine/print-anchor";
import { RecordField, RecordSection } from "@/components/engine/record-detail";
import { RecordHeader } from "@/components/engine/record-header";
import { historyTab } from "@/components/engine/record-history";
import { RecordTabs } from "@/components/engine/record-tabs";
import { TONES } from "@/components/engine/tones.ts";
import { PageBody, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/capabilities.ts";
import { toLocaleDigits } from "@/lib/digits.ts";
import { entriesForDisplay, lookupTable } from "@/lib/lookups.ts";
import { cn } from "@/lib/utils";
import { isUuid } from "@/lib/uuid.ts";
import { requireModule } from "@/lib/viewer.ts";
import {
  CHECKLISTS,
  COUNCIL_LOOKUP_SETS,
  type CouncilField,
  DECISION_FIELDS,
  DECISION_GROUPS,
  fieldsIn,
} from "@/modules/council/fields.ts";
import { readDecision } from "@/modules/council/queries.ts";

/**
 * One decision: a student's file as the council saw it.
 *
 * Nine tabs, drawn from `DECISION_FIELDS`, plus the two paperwork checklists —
 * which are counted rather than merely ticked, because the office's question is
 * «چند تا جای خالی مانده» and thirteen ticks leave the arithmetic to a person.
 */

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const metaId = (await params).id;
  if (!isUuid(metaId)) notFound();
  const { viewer } = await requireModule("/council-decisions");
  const decision = await readDecision(viewer.tenantId, metaId);
  const t = await getTranslations("decisions");
  return { title: decision?.studentName ?? decision?.thesisTitle ?? t("title") };
}

export default async function DecisionRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { viewer } = await requireModule("/council-decisions");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const decision = await readDecision(viewer.tenantId, id);
  if (!decision) notFound();

  const [lookups, locale, format, t, council, common, nav] = await Promise.all([
    lookupTable(viewer.tenantId, COUNCIL_LOOKUP_SETS),
    getLocale(),
    getFormatter(),
    getTranslations("decisions"),
    getTranslations("council"),
    getTranslations("common"),
    getTranslations("nav"),
  ]);

  const canManage = can(viewer, "council.manage");

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
    ? await historyTab(viewer.tenantId, "council_decision", decision.id)
    : null;

  const lookupEntries = (set: string, raw: unknown) => {
    const value = String(raw);
    return entriesForDisplay(lookups, set, value);
  };

  const value = (field: CouncilField): React.ReactNode => {
    const raw = decision[field.key as keyof typeof decision];

    switch (field.kind) {
      case "lookup": {
        if (!raw) return null;
        const entries = lookupEntries(field.set ?? "", raw);
        const index = entries.findIndex((entry) => entry.value === String(raw));
        return (
          <Badge
            variant="outline"
            className={cn("font-normal", index >= 0 && TONES[index % TONES.length])}
          >
            {index >= 0 ? entries[index]?.label : String(raw)}
          </Badge>
        );
      }
      case "date":
        return raw ? format.dateTime(new Date(String(raw)), { dateStyle: "long" }) : null;
      case "boolean":
        /*
         * A tick or an empty circle, not «بله»/«خیر».
         *
         * These thirteen fields are a checklist, and a column of «بله» reads as
         * prose while a column of ticks reads as a state somebody can scan. The
         * word is still the accessible name — the icon is `aria-hidden` and the
         * text beside it is what a screen reader announces.
         */
        return raw ? (
          <span className="flex items-center gap-1.5 text-success-subtle-foreground">
            <CheckCircle2 className="size-4" aria-hidden />
            {common("yes")}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Circle className="size-4" aria-hidden />
            {common("no")}
          </span>
        );
      default: {
        if (!raw) return null;
        const shown = String(raw);
        return field.format === "digits" ? toLocaleDigits(shown, locale) : shown;
      }
    }
  };

  /** How many items of a checklist are still missing. */
  const remaining = (fields: readonly string[]) =>
    fields.filter((key) => !decision[key as keyof typeof decision]).length;

  const name = decision.studentName ?? decision.thesisTitle ?? decision.meetingNumber;
  const statusEntries = lookups.get("council_review_statuses") ?? [];
  const statusIndex = statusEntries.findIndex((entry) => entry.value === decision.reviewStatus);

  return (
    <PageBody>
      <PageHeader
        breadcrumbLabel={nav("breadcrumb")}
        breadcrumbs={[{ label: t("title"), href: "/council-decisions" }, { label: name }]}
      />

      <RecordHeader
        name={name}
        secondary={decision.thesisTitle && decision.studentName ? decision.thesisTitle : null}
        identifier={decision.studentNumber ? toLocaleDigits(decision.studentNumber, locale) : null}
        standing={
          statusIndex >= 0 ? (
            <Badge
              variant="outline"
              className={cn("font-normal", TONES[statusIndex % TONES.length])}
            >
              {statusEntries[statusIndex]?.label}
            </Badge>
          ) : null
        }
        actions={
          <>
            {/*
             * The sitting this was decided at, when it is linked. A decision
             * filed before its sitting existed has no link, and offering a dead
             * one would be worse than offering none.
             */}
            {decision.meetingId && (
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  <Link href={`/council-meetings/${decision.meetingId}`}>
                    <ExternalLink className="size-4" aria-hidden />
                    {t("openMeeting")}
                  </Link>
                }
              />
            )}
            <PrintButton label={common("print")} />
            {canManage && (
              <Button
                nativeButton={false}
                render={
                  <Link href={`/council-decisions/${decision.id}/edit`}>
                    <Pencil className="size-4" aria-hidden />
                    {common("edit")}
                  </Link>
                }
              />
            )}
          </>
        }
      />

      <CouncilWorkflowPanel
        decisionId={decision.id}
        state={decision.workflowState ?? "draft"}
        version={decision.version}
        canManage={canManage}
      />

      {/*
       * The two checklists, counted, above the tabs.
       *
       * They are the thing the council actually asks about a file, and burying
       * them in the seventh and eighth tabs would mean opening two tabs to
       * answer one question.
       */}
      <div className="grid gap-3 sm:grid-cols-2">
        {CHECKLISTS.map((checklist) => {
          const missing = remaining(checklist.fields);
          return (
            <div
              key={checklist.group}
              className="flex items-center justify-between gap-3 rounded-md border p-3"
            >
              <span className="text-sm">{t(`group.${checklist.group}`)}</span>
              {missing === 0 ? (
                <Badge
                  variant="outline"
                  className="border-success-subtle-border bg-success-subtle font-normal text-success-subtle-foreground"
                >
                  {t("checklistComplete")}
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="border-warning-subtle-border bg-warning-subtle font-normal text-warning-subtle-foreground"
                >
                  {t("checklistMissing", { count: missing })}
                </Badge>
              )}
            </div>
          );
        })}
      </div>

      <RecordTabs
        tabs={[
          ...DECISION_GROUPS.map((group) => ({
            value: group,
            label: t(`group.${group}`),
            content: (
              <RecordSection title={t(`group.${group}`)} description={t(`section.${group}Hint`)}>
                {fieldsIn(DECISION_FIELDS, group).map((field) => (
                  <RecordField
                    key={field.key}
                    label={t(`field.${field.key}`)}
                    ltr={field.format === "digits" || field.format === "code"}
                  >
                    {value(field)}
                  </RecordField>
                ))}
              </RecordSection>
            ),
          })),
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

      {/* Named so a screen reader can tell the two sittings apart — this one is
          the council's, the one in the «جلسه‌ی دفاع» tab is the defence's. */}
      <span className="sr-only">
        {council("sitting", { number: toLocaleDigits(decision.meetingNumber ?? "", locale) })}
      </span>
    </PageBody>
  );
}
