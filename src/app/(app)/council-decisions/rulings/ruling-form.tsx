"use client";

import { DecisionTemplateEditor } from "@/components/council/decision-template-editor";
import { EntityForm, type EntityFormProps } from "@/components/engine/entity-form";
import type { PublishedDecisionTemplate } from "@/modules/governance/official-rules.ts";

export function RulingForm(
  props: EntityFormProps & { templates?: Record<string, PublishedDecisionTemplate[]> },
) {
  const { templates, ...formProps } = props;
  return (
    <EntityForm
      {...formProps}
      customGroupSlots={{
        text: ({ formValues, onFieldChange, fieldError }) => (
          <DecisionTemplateEditor
            reportCategory={formValues.reportCategory ?? ""}
            value={formValues.decisionText ?? ""}
            onChange={(val) => onFieldChange("decisionText", val)}
            descriptionValue={formValues.decisionDescription}
            onDescriptionChange={(val) => onFieldChange("decisionDescription", val)}
            error={fieldError("decisionText")}
            descriptionError={fieldError("decisionDescription")}
            templates={templates}
          />
        ),
      }}
    />
  );
}
