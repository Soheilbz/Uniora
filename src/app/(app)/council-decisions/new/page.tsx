import { getTranslations } from "next-intl/server";
import { EntityForm } from "@/components/engine/entity-form";
import { PageBody, PageHeader } from "@/components/page-header";
import { requireCapability } from "@/lib/viewer.ts";
import { saveDecision } from "@/modules/council/actions.ts";
import { DECISION_FIELDS, DECISION_GROUPS } from "@/modules/council/fields.ts";
import { buildCouncilForm } from "@/modules/council/form-data.ts";

export async function generateMetadata() {
  const t = await getTranslations("decisions");
  return { title: t("newTitle") };
}

export default async function NewDecisionPage() {
  const viewer = await requireCapability("council.view", "council.manage");
  const [props, t, common, nav] = await Promise.all([
    buildCouncilForm(viewer.tenantId, DECISION_FIELDS, DECISION_GROUPS, "decisions"),
    getTranslations("decisions"),
    getTranslations("common"),
    getTranslations("nav"),
  ]);

  return (
    <PageBody>
      <PageHeader
        title={t("newTitle")}
        breadcrumbLabel={nav("breadcrumb")}
        breadcrumbs={[{ label: t("title"), href: "/council-decisions" }, { label: t("newTitle") }]}
      />
      <EntityForm
        action={saveDecision}
        fields={DECISION_FIELDS}
        groups={DECISION_GROUPS}
        multiline={["thesisTitle", "decisionText", "councilNotes", "achievements"]}
        cancelHref="/council-decisions"
        submitLabel={common("save")}
        {...props}
      />
    </PageBody>
  );
}
