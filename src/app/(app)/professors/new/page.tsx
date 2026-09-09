import { getTranslations } from "next-intl/server";
import { EntityForm } from "@/components/engine/entity-form";
import { PageBody, PageHeader } from "@/components/page-header";
import { requireCapability } from "@/lib/viewer.ts";
import { createProfessor } from "@/modules/professors/actions.ts";
import { PROFESSOR_FIELDS, PROFESSOR_GROUPS } from "@/modules/professors/fields.ts";
import { buildProfessorForm } from "@/modules/professors/form-data.ts";

/**
 * A new professor.
 *
 * Gated on `professors.manage` as well as the module's own view right: reading
 * the directory and adding to it are different permissions. The action
 * re-checks both — the gate here decides whether the form is drawn, the action
 * decides whether the record is written.
 */

export async function generateMetadata() {
  const t = await getTranslations("professors");
  return { title: t("newTitle") };
}

export default async function NewProfessorPage() {
  const viewer = await requireCapability("professors.view", "professors.manage");
  const [props, t, common, nav] = await Promise.all([
    buildProfessorForm(viewer.tenantId),
    getTranslations("professors"),
    getTranslations("common"),
    getTranslations("nav"),
  ]);

  return (
    <PageBody>
      <PageHeader
        title={t("newTitle")}
        breadcrumbLabel={nav("breadcrumb")}
        breadcrumbs={[{ label: nav("professors"), href: "/professors" }, { label: t("newTitle") }]}
      />
      <EntityForm
        action={createProfessor}
        fields={PROFESSOR_FIELDS}
        groups={PROFESSOR_GROUPS}
        cancelHref="/professors"
        submitLabel={common("save")}
        {...props}
      />
    </PageBody>
  );
}
