import { Award, Pencil, UserCheck, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { StatCard } from "@/components/dashboard/panels";
import { PrintButton } from "@/components/engine/print-anchor";
import { RecordField, RecordSection } from "@/components/engine/record-detail";
import { RecordHeader } from "@/components/engine/record-header";
import { historyTab } from "@/components/engine/record-history";
import { RecordTabs } from "@/components/engine/record-tabs";
import { TONES } from "@/components/engine/tones.ts";
import { PageBody, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ParticipantList, type ParticipantView } from "@/components/workshops/participant-list";
import { RegistrationList } from "@/components/workshops/registration-list";
import { can } from "@/lib/capabilities.ts";
import { toLocaleDigits } from "@/lib/digits.ts";
import { lookupTable } from "@/lib/lookups.ts";
import { cn } from "@/lib/utils";
import { isUuid } from "@/lib/uuid.ts";
import { requireModule } from "@/lib/viewer.ts";
import {
  issueCertificates,
  setAttendance,
  transitionWorkshopRegistration,
} from "@/modules/workshops/actions.ts";
import { WORKSHOP_LOOKUP_SETS } from "@/modules/workshops/model.ts";
import {
  readWorkshop,
  readWorkshopLists,
  readWorkshopRegistrations,
} from "@/modules/workshops/queries.ts";

/**
 * One workshop: what it was, who taught it, and who was in the room.
 */

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  if (!isUuid(id)) notFound();
  const { viewer } = await requireModule("/workshops");
  const workshop = await readWorkshop(viewer.tenantId, id);
  const t = await getTranslations("workshops");
  return { title: workshop?.title ?? t("title") };
}

export default async function WorkshopRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { viewer } = await requireModule("/workshops");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const workshop = await readWorkshop(viewer.tenantId, id);
  if (!workshop) notFound();

  const [lists, registrations, lookups, locale, format, t, common, nav] = await Promise.all([
    readWorkshopLists(viewer.tenantId, id),
    readWorkshopRegistrations(viewer.tenantId, id),
    lookupTable(viewer.tenantId, WORKSHOP_LOOKUP_SETS),
    getLocale(),
    getFormatter(),
    getTranslations("workshops"),
    getTranslations("common"),
    getTranslations("nav"),
  ]);

  const canManage = can(viewer, "workshops.manage");

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
    ? await historyTab(viewer.tenantId, "workshop", workshop.id)
    : null;

  const entry = (set: string, value: string | null) => {
    if (!value) return null;
    const entries = lookups.get(set) ?? [];
    const index = entries.findIndex((candidate) => candidate.value === value);
    return index < 0
      ? { label: value, tone: null }
      : { label: entries[index]?.label ?? value, tone: index };
  };

  const label = (set: string, value: string | null) => entry(set, value)?.label ?? null;

  const participants: ParticipantView[] = lists.participants.map((participant) => {
    const attendance = entry("attendance_statuses", participant.attendanceStatus);
    return {
      id: participant.id,
      version: participant.version,
      name: participant.name ?? common("notRecorded"),
      studentId: participant.studentId,
      studentNumber: participant.studentNumber
        ? toLocaleDigits(participant.studentNumber, locale)
        : null,
      affiliation: participant.affiliation,
      attendanceStatus: participant.attendanceStatus,
      attendanceLabel: attendance?.label ?? participant.attendanceStatus,
      attendanceTone: attendance?.tone ?? null,
      paymentLabel: label("payment_statuses", participant.paymentStatus),
      certificateNumber: participant.certificateNumber,
    };
  });

  const attended = participants.filter((one) => one.attendanceStatus === "attended");
  const certificates = participants.filter((one) => one.certificateNumber !== null);
  /*
   * Who would get a certificate if the button were pressed: attended, and not
   * already holding one. The action computes the same set — this is only what
   * lets the button say so before it is pressed.
   */
  const pending = attended.filter((one) => one.certificateNumber === null).length;

  const statusEntry = entry("workshop_statuses", workshop.status);
  const attendanceOptions = (lookups.get("attendance_statuses") ?? [])
    .filter((option) => !option.retired)
    .map((option) => ({ value: option.value, label: option.label }));

  return (
    <PageBody>
      <PageHeader
        breadcrumbLabel={nav("breadcrumb")}
        breadcrumbs={[{ label: t("title"), href: "/workshops" }, { label: workshop.title }]}
      />

      <RecordHeader
        name={workshop.title}
        secondary={workshop.venue}
        identifier={
          workshop.workshopDate
            ? format.dateTime(new Date(workshop.workshopDate), { dateStyle: "long" })
            : null
        }
        standing={
          statusEntry ? (
            <Badge
              variant="outline"
              className={cn(
                "font-normal",
                statusEntry.tone !== null && TONES[statusEntry.tone % TONES.length],
              )}
            >
              {statusEntry.label}
            </Badge>
          ) : null
        }
        actions={
          <>
            <PrintButton label={common("print")} />
            {canManage && (
              <Button
                nativeButton={false}
                render={
                  <Link href={`/workshops/${workshop.id}/edit`}>
                    <Pencil className="size-4" aria-hidden />
                    {common("edit")}
                  </Link>
                }
              />
            )}
          </>
        }
      />

      <section aria-label={t("title")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label={t("stats.registered")}
            value={format.number(participants.length)}
            icon={Users}
          />
          <StatCard
            label={t("stats.attended")}
            value={format.number(attended.length)}
            icon={UserCheck}
          />
          <StatCard
            label={t("stats.certificates")}
            value={format.number(certificates.length)}
            icon={Award}
          />
          <StatCard
            label={t("stats.capacity")}
            value={workshop.capacity > 0 ? format.number(workshop.capacity) : "—"}
          />
        </div>
      </section>

      <RecordSection title={t("group.session")} description={t("section.sessionHint")}>
        <RecordField label={t("field.workshopDate")}>
          {workshop.workshopDate
            ? format.dateTime(new Date(workshop.workshopDate), { dateStyle: "long" })
            : null}
        </RecordField>
        <RecordField label={t("field.durationHours")}>
          {workshop.durationHours
            ? t("hours", { hours: format.number(Number(workshop.durationHours)) })
            : null}
        </RecordField>
        <RecordField label={t("field.locationType")}>
          {label("workshop_locations", workshop.locationType)}
        </RecordField>
        <RecordField label={t("field.venue")}>{workshop.venue}</RecordField>
        <RecordField label={t("field.cost")} ltr>
          {/* Zero is «رایگان», not «۰ ریال» — a free workshop is a fact about the
              workshop, and a price of nothing reads as a missing price. */}
          {workshop.cost && Number(workshop.cost) > 0
            ? format.number(Number(workshop.cost))
            : t("free")}
        </RecordField>
        <RecordField label={t("field.description")}>
          <span className="whitespace-pre-line">{workshop.description}</span>
        </RecordField>
      </RecordSection>

      <RecordTabs
        tabs={[
          {
            value: "participants",
            label: `${t("tab.participants")} (${format.number(participants.length)})`,
            content: (
              <ParticipantList
                participants={participants}
                canManage={canManage}
                setAttendance={setAttendance}
                issueCertificates={issueCertificates}
                workshopId={workshop.id}
                pendingCertificates={pending}
                certificateIssuanceAllowed={workshop.status === "held"}
                attendanceOptions={attendanceOptions}
              />
            ),
          },
          ...(workshop.publicRegistration || registrations.length > 0
            ? [
                {
                  value: "registrations",
                  label: `${t("tab.registrations")} (${format.number(registrations.length)})`,
                  content: (
                    <RegistrationList
                      rows={registrations}
                      canManage={canManage}
                      transition={transitionWorkshopRegistration}
                    />
                  ),
                },
              ]
            : []),
          {
            value: "instructors",
            label: `${t("tab.instructors")} (${format.number(lists.instructors.length)})`,
            content:
              lists.instructors.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noInstructors")}</p>
              ) : (
                <ul className="flex flex-col divide-y rounded-md border">
                  {lists.instructors.map((instructor) => (
                    <li key={instructor.id} className="flex flex-wrap items-center gap-2 p-3">
                      {instructor.professorId ? (
                        <Link
                          href={`/professors/${instructor.professorId}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {instructor.name}
                        </Link>
                      ) : (
                        <>
                          <span className="font-medium">{instructor.name}</span>
                          <Badge variant="outline" className="font-normal text-muted-foreground">
                            {t("external")}
                          </Badge>
                        </>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {label("instructor_roles", instructor.role)}
                        {instructor.affiliation && <> · {instructor.affiliation}</>}
                      </span>
                    </li>
                  ))}
                </ul>
              ),
          },
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
