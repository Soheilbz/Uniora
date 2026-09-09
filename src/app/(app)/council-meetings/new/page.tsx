import { getTranslations } from "next-intl/server";
import { CouncilMeetingForm } from "@/components/council/council-meeting-form";
import { PageBody, PageHeader } from "@/components/page-header";
import { requireCapability } from "@/lib/viewer.ts";
import { saveMeeting } from "@/modules/council/actions.ts";
import { MEETING_FIELDS, MEETING_GROUPS } from "@/modules/council/fields.ts";
import { buildCouncilForm } from "@/modules/council/form-data.ts";
import { readDirectory, readRoster } from "@/modules/council/roster.ts";

export async function generateMetadata() {
  const t = await getTranslations("council");
  return { title: t("newTitle") };
}

export default async function NewMeetingPage() {
  const viewer = await requireCapability("council.view", "council.manage");
  const [props, t, common, nav, seats, directory] = await Promise.all([
    buildCouncilForm(viewer.tenantId, MEETING_FIELDS, MEETING_GROUPS, "council"),
    getTranslations("council"),
    getTranslations("common"),
    getTranslations("nav"),
    readRoster(viewer.tenantId),
    readDirectory(viewer.tenantId),
  ]);

  return (
    <PageBody>
      <PageHeader
        title={t("newTitle")}
        breadcrumbLabel={nav("breadcrumb")}
        breadcrumbs={[{ label: t("title"), href: "/council-meetings" }, { label: t("newTitle") }]}
      />
      <CouncilMeetingForm
        action={saveMeeting}
        fields={MEETING_FIELDS}
        groups={MEETING_GROUPS}
        multiline={["notes"]}
        cancelHref="/council-meetings"
        submitLabel={common("save")}
        seats={seats}
        directory={directory}
        {...props}
      />
    </PageBody>
  );
}
