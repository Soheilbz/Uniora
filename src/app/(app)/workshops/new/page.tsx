import { getTranslations } from "next-intl/server";
import { EntityForm } from "@/components/engine/entity-form";
import { PageBody, PageHeader } from "@/components/page-header";
import { formOptions, lookupTable } from "@/lib/lookups.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { saveWorkshop } from "@/modules/workshops/actions.ts";
import {
  WORKSHOP_FIELDS,
  WORKSHOP_GROUPS,
  WORKSHOP_LOOKUP_SETS,
} from "@/modules/workshops/model.ts";

export async function generateMetadata() {
  const t = await getTranslations("workshops");
  return { title: t("newTitle") };
}

export default async function NewWorkshopPage() {
  const viewer = await requireCapability("workshops.view", "workshops.manage");
  const [lookups, t, common, nav] = await Promise.all([
    lookupTable(viewer.tenantId, WORKSHOP_LOOKUP_SETS),
    getTranslations("workshops"),
    getTranslations("common"),
    getTranslations("nav"),
  ]);

  const options: Record<string, { value: string; label: string }[]> = {};
  for (const field of WORKSHOP_FIELDS) {
    if (field.kind === "lookup" && field.set) options[field.key] = formOptions(lookups, field.set);
  }

  return (
    <PageBody>
      <PageHeader
        title={t("newTitle")}
        breadcrumbLabel={nav("breadcrumb")}
        breadcrumbs={[{ label: t("title"), href: "/workshops" }, { label: t("newTitle") }]}
      />
      <EntityForm
        action={saveWorkshop}
        fields={WORKSHOP_FIELDS}
        groups={WORKSHOP_GROUPS}
        multiline={["description"]}
        options={options}
        values={Object.fromEntries(WORKSHOP_FIELDS.map((field) => [field.key, ""]))}
        labels={Object.fromEntries(WORKSHOP_FIELDS.map((f) => [f.key, t(`field.${f.key}`)]))}
        groupLabels={Object.fromEntries(
          WORKSHOP_GROUPS.map((group) => [
            group,
            { title: t(`group.${group}`), hint: t(`section.${group}Hint`) },
          ]),
        )}
        hints={{}}
        cancelHref="/workshops"
        submitLabel={common("save")}
      />
    </PageBody>
  );
}
