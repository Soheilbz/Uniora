import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { CouncilMeetingForm } from "@/components/council/council-meeting-form";
import { DeleteRecordButton } from "@/components/engine/delete-record-button";
import { PageBody, PageHeader } from "@/components/page-header";
import { toLocaleDigits } from "@/lib/digits.ts";
import { isUuid } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { deleteMeetings, saveMeeting } from "@/modules/council/actions.ts";
import { MEETING_FIELDS, MEETING_GROUPS } from "@/modules/council/fields.ts";
import { buildCouncilForm } from "@/modules/council/form-data.ts";
import { readMeeting } from "@/modules/council/queries.ts";
import { readDirectory, readRoster } from "@/modules/council/roster.ts";

export async function generateMetadata() {
  const t = await getTranslations("council");
  return { title: t("editTitle") };
}

export default async function EditMeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCapability("council.view", "council.manage");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const meeting = await readMeeting(viewer.tenantId, id);
  if (!meeting) notFound();

  const [props, t, common, nav, locale, seats, directory] = await Promise.all([
    buildCouncilForm(viewer.tenantId, MEETING_FIELDS, MEETING_GROUPS, "council", meeting),
    getTranslations("council"),
    getTranslations("common"),
    getTranslations("nav"),
    getLocale(),
    readRoster(viewer.tenantId),
    readDirectory(viewer.tenantId),
  ]);

  const name = t("sitting", { number: toLocaleDigits(meeting.meetingNumber, locale) });

  return (
    <PageBody>
      <PageHeader
        title={t("editTitle")}
        description={name}
        breadcrumbLabel={nav("breadcrumb")}
        breadcrumbs={[
          { label: t("title"), href: "/council-meetings" },
          { label: name, href: `/council-meetings/${meeting.id}` },
          { label: t("editTitle") },
        ]}
        actions={
          <DeleteRecordButton
            action={deleteMeetings}
            recordId={meeting.id}
            recordVersion={meeting.version}
            title={t("deleteTitle")}
            body={t("deleteBody")}
            confirmLabel={common("delete")}
            cancelLabel={common("cancel")}
            triggerLabel={common("delete")}
          />
        }
      />
      <CouncilMeetingForm
        action={saveMeeting}
        fields={MEETING_FIELDS}
        groups={MEETING_GROUPS}
        multiline={["notes"]}
        recordId={meeting.id}
        version={meeting.version}
        cancelHref={`/council-meetings/${meeting.id}`}
        submitLabel={common("save")}
        seats={seats}
        directory={directory}
        initialParticipants={meeting.participants ?? []}
        initialAbsentees={meeting.absentees ?? []}
        initialSubstitutions={meeting.substitutions ?? {}}
        {...props}
      />
    </PageBody>
  );
}
