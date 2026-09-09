import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DeleteRecordButton } from "@/components/engine/delete-record-button";
import { EntityForm } from "@/components/engine/entity-form";
import { PageBody, PageHeader } from "@/components/page-header";
import { isUuid } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { deleteProfessor, updateProfessor } from "@/modules/professors/actions.ts";
import { PROFESSOR_FIELDS, PROFESSOR_GROUPS } from "@/modules/professors/fields.ts";
import { buildProfessorForm } from "@/modules/professors/form-data.ts";
import { readProfessor } from "@/modules/professors/register.ts";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const metaId = (await params).id;
  if (!isUuid(metaId)) notFound();
  const viewer = await requireCapability("professors.view", "professors.manage");
  const professor = await readProfessor(viewer.tenantId, metaId);
  const t = await getTranslations("professors");
  return {
    title: professor
      ? `${t("editTitle")} — ${professor.firstName} ${professor.lastName}`
      : t("editTitle"),
  };
}

export default async function EditProfessorPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCapability("professors.view", "professors.manage");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const professor = await readProfessor(viewer.tenantId, id);
  if (!professor) notFound();

  const [props, t, common, nav, errors] = await Promise.all([
    buildProfessorForm(viewer.tenantId, professor),
    getTranslations("professors"),
    getTranslations("common"),
    getTranslations("nav"),
    getTranslations("errors"),
  ]);

  const name = `${professor.firstName} ${professor.lastName}`;

  return (
    <PageBody>
      <PageHeader
        title={t("editTitle")}
        description={name}
        breadcrumbLabel={nav("breadcrumb")}
        breadcrumbs={[
          { label: nav("professors"), href: "/professors" },
          { label: name, href: `/professors/${professor.id}` },
          { label: t("editTitle") },
        ]}
        actions={
          <DeleteRecordButton
            action={deleteProfessor}
            recordId={professor.id}
            recordVersion={professor.version}
            title={t("deleteTitle")}
            body={t("deleteBody")}
            confirmLabel={common("delete")}
            cancelLabel={common("cancel")}
            triggerLabel={common("delete")}
            /* The one refusal this delete can give: a professor still holding a
               supervision seat. Worded here, where the catalogue is — a
               function cannot cross into a client component. */
            refusals={{ "professor.supervising": errors("professor.supervising") }}
          />
        }
      />
      {/*
       * `version` goes in as a hidden field and comes back with the save. It is
       * what makes two clerks editing the same professor a reported conflict
       * rather than one of them silently losing their work.
       */}
      <EntityForm
        action={updateProfessor}
        fields={PROFESSOR_FIELDS}
        groups={PROFESSOR_GROUPS}
        recordId={professor.id}
        version={professor.version}
        cancelHref={`/professors/${professor.id}`}
        submitLabel={common("save")}
        {...props}
      />
    </PageBody>
  );
}
