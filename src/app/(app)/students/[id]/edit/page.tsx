import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DeleteRecordButton } from "@/components/engine/delete-record-button";
import { EntityForm } from "@/components/engine/entity-form";
import { PageBody, PageHeader } from "@/components/page-header";
import { isUuid } from "@/lib/uuid.ts";
import { can, requireCapability } from "@/lib/viewer.ts";
import { deleteStudent, updateStudent } from "@/modules/students/actions.ts";
import { FIELD_GROUPS, STUDENT_FIELDS } from "@/modules/students/fields.ts";
import { buildFormProps } from "@/modules/students/form-data.ts";
import { readStudent } from "@/modules/students/record.ts";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const metaId = (await params).id;
  if (!isUuid(metaId)) notFound();
  const viewer = await requireCapability("students.view", "students.manage");
  const student = await readStudent(viewer.tenantId, metaId);
  const t = await getTranslations("students");
  return {
    title: student
      ? `${t("editTitle")} — ${student.firstName} ${student.lastName}`
      : t("editTitle"),
  };
}

export default async function EditStudentPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCapability("students.view", "students.manage");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const student = await readStudent(viewer.tenantId, id);
  if (!student) notFound();

  const [props, t, common, nav] = await Promise.all([
    buildFormProps(viewer.tenantId, student),
    getTranslations("students"),
    getTranslations("common"),
    getTranslations("nav"),
  ]);

  const name = `${student.firstName} ${student.lastName}`;

  return (
    <PageBody>
      <PageHeader
        title={t("editTitle")}
        description={name}
        breadcrumbLabel={nav("breadcrumb")}
        breadcrumbs={[
          { label: nav("students"), href: "/students" },
          { label: name, href: `/students/${student.id}` },
          { label: t("editTitle") },
        ]}
        actions={
          <DeleteRecordButton
            action={deleteStudent}
            recordId={student.id}
            recordVersion={student.version}
            title={t("deleteTitle")}
            body={t("deleteBody")}
            confirmLabel={common("delete")}
            cancelLabel={common("cancel")}
            triggerLabel={common("delete")}
          />
        }
      />
      {/*
       * `version` goes in as a hidden field and comes back with the save. It is
       * what makes two clerks editing the same student a reported conflict
       * rather than one of them silently losing their work.
       */}
      <EntityForm
        action={updateStudent}
        fields={STUDENT_FIELDS}
        groups={FIELD_GROUPS}
        recordId={student.id}
        version={student.version}
        cancelHref={`/students/${student.id}`}
        submitLabel={common("save")}
        lockedFields={can(viewer, "students.degree") ? [] : ["degree"]}
        {...props}
      />
    </PageBody>
  );
}
