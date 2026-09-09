import { getTranslations } from "next-intl/server";
import { PageBody, PageHeader } from "@/components/page-header";
import { requireCapability } from "@/lib/viewer.ts";
import { RULING_FIELDS, RULING_GROUPS } from "@/modules/council/fields.ts";
import { buildCouncilForm } from "@/modules/council/form-data.ts";
import { saveRuling } from "@/modules/council/tab-actions.ts";
import { readPublishedDecisionTemplates } from "@/modules/governance/official-rules.ts";
import { RulingForm } from "../ruling-form.tsx";

export async function generateMetadata() {
  const words = await getTranslations("rulings");
  return { title: words("newTitle") };
}

export default async function NewRulingPage() {
  const viewer = await requireCapability("council.view", "council.manage");
  const [props, words, common, nav, templates] = await Promise.all([
    buildCouncilForm(viewer.tenantId, RULING_FIELDS, RULING_GROUPS, "decisions"),
    getTranslations("rulings"),
    getTranslations("common"),
    getTranslations("nav"),
    readPublishedDecisionTemplates(viewer.tenantId),
  ]);

  return (
    <PageBody>
      <PageHeader
        title={words("newTitle")}
        breadcrumbLabel={nav("breadcrumb")}
        breadcrumbs={[
          { label: words("title"), href: "/council-decisions?tab=rulings" },
          { label: words("newTitle") },
        ]}
      />
      <RulingForm
        action={saveRuling}
        fields={RULING_FIELDS}
        groups={RULING_GROUPS}
        multiline={["decisionText", "decisionDescription"]}
        cancelHref="/council-decisions?tab=rulings"
        submitLabel={common("save")}
        templates={templates}
        {...props}
      />
    </PageBody>
  );
}
