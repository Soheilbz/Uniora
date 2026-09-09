"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DECISION_TEMPLATES,
  type DecisionTemplate,
  extractValuesFromText,
  generateFinalText,
} from "@/modules/council/decision-templates.ts";

type RuntimeDecisionTemplate = DecisionTemplate & { versionId?: string | null };

interface DecisionTemplateEditorProps {
  reportCategory: string;
  value: string;
  onChange: (text: string) => void;
  descriptionValue?: string | undefined;
  onDescriptionChange?: ((desc: string) => void) | undefined;
  professorOptions?: { value: string; label: string }[] | undefined;
  studentOptions?: { value: string; label: string }[] | undefined;
  error?: string | undefined;
  descriptionError?: string | undefined;
  templates?: Record<string, RuntimeDecisionTemplate[]> | undefined;
}

export function DecisionTemplateEditor({
  reportCategory,
  value,
  onChange,
  descriptionValue,
  onDescriptionChange,
  professorOptions = [],
  studentOptions = [],
  error,
  descriptionError,
  templates,
}: DecisionTemplateEditorProps) {
  const t = useTranslations("decisions.editor");
  const isOtherCategory = reportCategory === "other";

  const availableTemplates = useMemo<RuntimeDecisionTemplate[]>(() => {
    return (templates?.[reportCategory] ??
      DECISION_TEMPLATES[reportCategory] ??
      []) as RuntimeDecisionTemplate[];
  }, [reportCategory, templates]);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    () => availableTemplates[0]?.id ?? "",
  );
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({});
  const initialExtractionDone = useRef(false);

  /* A category change is a new template namespace. Reset local template state
     before trying to recognise any existing decision text in that namespace. */
  useEffect(() => {
    initialExtractionDone.current = false;
    setSelectedTemplateId(availableTemplates[0]?.id ?? "");
    setTemplateValues({});
  }, [availableTemplates]);

  // Auto-detect template and extract placeholder values on initial load / edit
  useEffect(() => {
    if (initialExtractionDone.current) return;

    if (value && availableTemplates.length > 0) {
      for (const tmpl of availableTemplates) {
        const extracted = extractValuesFromText(tmpl.template, value, tmpl.placeholders);
        if (Object.keys(extracted).length > 0) {
          setSelectedTemplateId(tmpl.id);
          setTemplateValues(extracted);
          initialExtractionDone.current = true;
          return;
        }
      }
    }
    initialExtractionDone.current = true;
  }, [availableTemplates, value]);

  const selectedTemplate = useMemo(() => {
    return availableTemplates.find((t) => t.id === selectedTemplateId);
  }, [availableTemplates, selectedTemplateId]);

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const tmpl = availableTemplates.find((t) => t.id === templateId);
    if (tmpl) {
      const newText = generateFinalText(tmpl.template, templateValues);
      onChange(newText);
    }
  };

  const handlePlaceholderChange = (placeholderName: string, val: string) => {
    const nextValues = { ...templateValues, [placeholderName]: val };
    setTemplateValues(nextValues);
    if (selectedTemplate) {
      const generated = generateFinalText(selectedTemplate.template, nextValues);
      onChange(generated);
    }
  };

  const templateOptions = useMemo(() => {
    return availableTemplates.map((t) => ({
      value: t.id,
      label: `${t.name}${t.description ? ` — ${t.description}` : ""}`,
    }));
  }, [availableTemplates]);

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border/80 bg-card p-4 sm:p-5 shadow-2xs">
      {!isOtherCategory && availableTemplates.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="decision-template" className="text-xs font-semibold text-foreground/90">
            <span>{t("templateLabel")}</span>
          </Label>
          <Combobox
            id="decision-template"
            name="templateId"
            value={selectedTemplateId}
            onChange={handleTemplateChange}
            options={templateOptions}
            placeholder={t("templatePlaceholder")}
            allowCustom={false}
          />
          {selectedTemplate?.versionId ? (
            <input type="hidden" name="templateVersionId" value={selectedTemplate.versionId} />
          ) : null}
        </div>
      )}

      {!isOtherCategory && selectedTemplate && (
        <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/20 p-3.5 sm:p-4">
          <div className="flex items-center justify-between border-b border-border/40 pb-2">
            <span className="text-xs font-bold text-foreground">{t("variables")}</span>
            <span className="text-[11px] text-muted-foreground">{selectedTemplate.name}</span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {selectedTemplate.placeholders.map((placeholder, index: number) => {
              const isProf = [
                "نام استاد",
                "استاد درخواست‌دهنده",
                "همکار",
                "اسامی اساتید",
                "نام فرد جدید",
              ].some((kw) => placeholder.includes(kw));

              const isStudent = placeholder.includes("دانشجو");
              const inputId = `decision-placeholder-${index}`;

              return (
                <div key={placeholder} className="flex flex-col gap-1">
                  <Label htmlFor={inputId} className="text-[11px] font-medium text-foreground/80">
                    {placeholder}
                  </Label>
                  {isProf && professorOptions.length > 0 ? (
                    <Combobox
                      id={inputId}
                      name={`placeholder_${placeholder}`}
                      value={templateValues[placeholder] ?? ""}
                      onChange={(val) => handlePlaceholderChange(placeholder, val)}
                      options={professorOptions}
                      placeholder={placeholder}
                      allowCustom={true}
                    />
                  ) : isStudent && studentOptions.length > 0 ? (
                    <Combobox
                      id={inputId}
                      name={`placeholder_${placeholder}`}
                      value={templateValues[placeholder] ?? ""}
                      onChange={(val) => handlePlaceholderChange(placeholder, val)}
                      options={studentOptions}
                      placeholder={placeholder}
                      allowCustom={true}
                    />
                  ) : (
                    <Input
                      id={inputId}
                      type="text"
                      value={templateValues[placeholder] ?? ""}
                      onChange={(e) => handlePlaceholderChange(placeholder, e.target.value)}
                      placeholder={placeholder}
                      className="text-xs"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Final Decision Text */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="decision-text" className="text-xs font-semibold text-foreground/90">
          <span>{t("finalText")}</span>
          <span aria-hidden="true" className="text-destructive font-bold text-sm leading-none ms-1">
            *
          </span>
        </Label>
        <Textarea
          id="decision-text"
          name="decisionText"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
          placeholder={t("decisionPlaceholder")}
          className="text-xs leading-relaxed"
          required
          maxLength={4000}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "decision-text-error" : undefined}
        />
        {error && (
          <span id="decision-text-error" className="text-xs text-destructive" role="alert">
            {error}
          </span>
        )}
      </div>

      {/* Optional Description */}
      {onDescriptionChange !== undefined && (
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor="decision-description"
            className="text-xs font-semibold text-foreground/90"
          >
            <span>{t("descriptionLabel")}</span>
          </Label>
          <Textarea
            id="decision-description"
            name="decisionDescription"
            value={descriptionValue ?? ""}
            onChange={(e) => onDescriptionChange(e.target.value)}
            rows={2}
            placeholder={t("descriptionPlaceholder")}
            className="text-xs"
            maxLength={4000}
            aria-invalid={descriptionError ? true : undefined}
            aria-describedby={descriptionError ? "decision-description-error" : undefined}
          />
          {descriptionError && (
            <span id="decision-description-error" className="text-xs text-destructive" role="alert">
              {descriptionError}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
