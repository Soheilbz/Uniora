import { ExternalLink, Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { PrintButton } from "@/components/engine/print-anchor";
import { RecordField, RecordSection } from "@/components/engine/record-detail";
import { RecordHeader } from "@/components/engine/record-header";
import { historyTab } from "@/components/engine/record-history";
import { RecordTabs } from "@/components/engine/record-tabs";
import { PageBody, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/capabilities.ts";
import { toLocaleDigits } from "@/lib/digits.ts";
import { lookupTable } from "@/lib/lookups.ts";
import { isUuid } from "@/lib/uuid.ts";
import { requireModule } from "@/lib/viewer.ts";
import { APPOINTMENT_SEATS, COUNCIL_LOOKUP_SETS } from "@/modules/council/fields.ts";
import { readAppointment } from "@/modules/council/registers.ts";
import { readProfessorOptions } from "@/modules/directory/options.ts";

/**
 * One appointment: the sitting at which a student was given their supervisors.
 *
 * Three groups and the trail, on the same terms as every other record here — a
 * supervision seat is the kind of fact somebody eventually has to ask «who
 * changed this, and when» about.
 */

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const metaId = (await params).id;
  if (!isUuid(metaId)) notFound();
  const { viewer } = await requireModule("/council-decisions");
  const appointment = await readAppointment(viewer.tenantId, metaId);
  const words = await getTranslations("appointments");
  return { title: appointment?.studentName ?? words("title") };
}

export default async function AppointmentRecordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { viewer } = await requireModule("/council-decisions");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const appointment = await readAppointment(viewer.tenantId, id);
  if (!appointment) notFound();

  const [lookups, professors, locale, format, t, words, common, nav] = await Promise.all([
    lookupTable(viewer.tenantId, COUNCIL_LOOKUP_SETS),
    readProfessorOptions(viewer.tenantId),
    getLocale(),
    getFormatter(),
    getTranslations("decisions"),
    /*
     * Two namespaces: `t` for the field labels, which the three registers
     * share, and `words` for what this one is called. See the register page.
     */
    getTranslations("appointments"),
    getTranslations("common"),
    getTranslations("nav"),
  ]);

  const canManage = can(viewer, "council.manage");
  const names = new Map(professors.map((professor) => [professor.id, professor.name]));

  /*
   * Awaited here rather than inside the array handed to `RecordTabs` — an
   * `await` in there makes the panel stream as its own chunk, and Base UI's
   * tabs register on mount, so the strip ends up holding the entry twice. The
   * sitting record carries the same note and the same fix.
   */
  const history = can(viewer, "audit.view")
    ? await historyTab(viewer.tenantId, "council_appointment", appointment.id)
    : null;
  const label = (set: string, value: string | null) =>
    value ? (lookups.get(set)?.find((entry) => entry.value === value)?.label ?? value) : null;

  const name = appointment.studentName ?? appointment.studentNumber ?? words("title");

  return (
    <PageBody>
      <PageHeader
        breadcrumbLabel={nav("breadcrumb")}
        breadcrumbs={[
          { label: words("title"), href: "/council-decisions?tab=appointments" },
          { label: name },
        ]}
      />

      <RecordHeader
        name={name}
        identifier={
          appointment.studentNumber ? toLocaleDigits(appointment.studentNumber, locale) : null
        }
        secondary={label("degrees", appointment.educationLevel)}
        actions={
          <>
            {appointment.meetingId && (
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  <Link href={`/council-meetings/${appointment.meetingId}`}>
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
                  <Link href={`/council-decisions/appointments/${appointment.id}/edit`}>
                    <Pencil className="size-4" aria-hidden />
                    {common("edit")}
                  </Link>
                }
              />
            )}
          </>
        }
      />

      <RecordTabs
        tabs={[
          {
            value: "meeting",
            label: t("group.meeting"),
            content: (
              <RecordSection title={t("group.meeting")} description={t("section.meetingHint")}>
                <RecordField label={t("field.meetingNumber")}>
                  {toLocaleDigits(appointment.meetingNumber, locale)}
                </RecordField>
                <RecordField label={t("field.meetingDate")}>
                  {appointment.meetingDate
                    ? format.dateTime(new Date(appointment.meetingDate), { dateStyle: "long" })
                    : null}
                </RecordField>
                <RecordField label={t("field.meetingDay")}>
                  {label("weekdays", appointment.meetingDay)}
                </RecordField>
                <RecordField label={t("field.meetingLocation")}>
                  {appointment.meetingLocation}
                </RecordField>
              </RecordSection>
            ),
          },
          {
            value: "student",
            label: t("group.student"),
            content: (
              <RecordSection title={t("group.student")} description={t("section.studentHint")}>
                <RecordField label={t("field.studentNumber")} ltr>
                  {appointment.studentNumber
                    ? toLocaleDigits(appointment.studentNumber, locale)
                    : null}
                </RecordField>
                <RecordField label={t("field.studentName")}>{appointment.studentName}</RecordField>
                <RecordField label={t("field.educationLevel")}>
                  {label("degrees", appointment.educationLevel)}
                </RecordField>
                <RecordField label={t("field.fieldOfStudy")}>
                  {label("fields_of_study", appointment.fieldOfStudy)}
                </RecordField>
              </RecordSection>
            ),
          },
          {
            value: "seats",
            label: t("group.seats"),
            content: (
              <RecordSection title={t("group.seats")} description={t("section.seatsHint")}>
                {APPOINTMENT_SEATS.map((seat) => {
                  const value = appointment[seat as keyof typeof appointment];
                  return (
                    <RecordField key={seat} label={t(`field.${seat}`)}>
                      {/*
                       * A seat whose id resolves to nobody shows the id rather
                       * than blank. The foreign key sets the column to null when
                       * a professor is removed, so a stale id should be
                       * impossible — and if one appears it is a fault worth
                       * seeing rather than an empty chair.
                       */}
                      {value ? (names.get(String(value)) ?? String(value)) : null}
                    </RecordField>
                  );
                })}
              </RecordSection>
            ),
          },
          /* Dropped rather than shown empty, without `audit.view` — the same
             rule every other record page here follows. */
          ...(history ? [history] : []),
        ]}
      />
    </PageBody>
  );
}
