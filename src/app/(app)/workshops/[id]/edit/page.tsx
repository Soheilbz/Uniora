import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DeleteRecordButton } from "@/components/engine/delete-record-button";
import { EntityForm } from "@/components/engine/entity-form";
import { PageBody, PageHeader } from "@/components/page-header";
import { formOptions, lookupTable } from "@/lib/lookups.ts";
import { recordValue } from "@/lib/record-value.ts";
import { isUuid } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { deleteWorkshops, saveWorkshop } from "@/modules/workshops/actions.ts";
import {
  WORKSHOP_FIELDS,
  WORKSHOP_GROUPS,
  WORKSHOP_LOOKUP_SETS,
} from "@/modules/workshops/model.ts";
import { readWorkshop } from "@/modules/workshops/queries.ts";

export async function generateMetadata() {
  const t = await getTranslations("workshops");
  return { title: t("editTitle") };
}

export default async function EditWorkshopPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCapability("workshops.view", "workshops.manage");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const workshop = await readWorkshop(viewer.tenantId, id);
  if (!workshop) notFound();

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
        title={t("editTitle")}
        description={workshop.title}
        breadcrumbLabel={nav("breadcrumb")}
        breadcrumbs={[
          { label: t("title"), href: "/workshops" },
          { label: workshop.title, href: `/workshops/${workshop.id}` },
          { label: t("editTitle") },
        ]}
        actions={
          <DeleteRecordButton
            action={deleteWorkshops}
            recordId={workshop.id}
            recordVersion={workshop.version}
            title={t("deleteTitle")}
            body={t("deleteBody")}
            confirmLabel={common("delete")}
            cancelLabel={common("cancel")}
            triggerLabel={common("delete")}
          />
        }
      />
      <EntityForm
        action={saveWorkshop}
        fields={WORKSHOP_FIELDS}
        groups={WORKSHOP_GROUPS}
        multiline={["description"]}
        options={options}
        values={Object.fromEntries(
          WORKSHOP_FIELDS.map((field) => {
            const raw = recordValue(workshop, field.key);
            return [field.key, raw === null || raw === undefined ? "" : String(raw)];
          }),
        )}
        labels={Object.fromEntries(WORKSHOP_FIELDS.map((f) => [f.key, t(`field.${f.key}`)]))}
        groupLabels={Object.fromEntries(
          WORKSHOP_GROUPS.map((group) => [
            group,
            { title: t(`group.${group}`), hint: t(`section.${group}Hint`) },
          ]),
        )}
        hints={{}}
        recordId={workshop.id}
        version={workshop.version}
        cancelHref={`/workshops/${workshop.id}`}
        submitLabel={common("save")}
      />
    </PageBody>
  );
}
