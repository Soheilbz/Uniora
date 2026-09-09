import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { saveCustomFieldValues } from "@/modules/custom-fields/actions.ts";
import type { CustomFieldEntityType } from "@/modules/custom-fields/model.ts";

interface FieldView {
  id: string;
  key: string;
  label: string;
  dataType: string;
  required: boolean;
  options: string[];
  value: unknown;
}
export function CustomFieldsPanel({
  entityType,
  entityId,
  fields,
  canManage,
  words,
}: {
  entityType: CustomFieldEntityType;
  entityId: string;
  fields: FieldView[];
  canManage: boolean;
  words: {
    title: string;
    description: string;
    empty: string;
    save: string;
    yes: string;
    no: string;
  };
}) {
  if (fields.length === 0) return null;
  const inputClass =
    "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:bg-muted/40 disabled:text-muted-foreground";
  return (
    <Card>
      <CardHeader>
        <CardTitle>{words.title}</CardTitle>
        <CardDescription>{words.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={saveCustomFieldValues} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <input type="hidden" name="entityType" value={entityType} />
          <input type="hidden" name="entityId" value={entityId} />
          {fields.map((field) => (
            <label
              key={field.id}
              htmlFor={`custom-field-${field.key}`}
              className="grid gap-1.5 text-sm"
            >
              <span className="font-medium">
                {field.label}
                {field.required ? (
                  <span aria-hidden className="text-destructive">
                    {" "}
                    *
                  </span>
                ) : null}
              </span>
              {field.dataType === "boolean" ? (
                <select
                  id={`custom-field-${field.key}`}
                  className={inputClass}
                  name={`custom:${field.key}`}
                  defaultValue={
                    field.value === true ? "true" : field.value === false ? "false" : ""
                  }
                  disabled={!canManage}
                >
                  <option value="">—</option>
                  <option value="true">{words.yes}</option>
                  <option value="false">{words.no}</option>
                </select>
              ) : field.dataType === "select" ? (
                <select
                  id={`custom-field-${field.key}`}
                  className={inputClass}
                  name={`custom:${field.key}`}
                  defaultValue={typeof field.value === "string" ? field.value : ""}
                  disabled={!canManage}
                >
                  <option value="">—</option>
                  {field.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : field.dataType === "multiselect" ? (
                <select
                  id={`custom-field-${field.key}`}
                  className={`${inputClass} h-auto min-h-24 py-2`}
                  name={`custom:${field.key}`}
                  multiple
                  defaultValue={
                    Array.isArray(field.value)
                      ? field.value.filter((one): one is string => typeof one === "string")
                      : []
                  }
                  disabled={!canManage}
                >
                  {field.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`custom-field-${field.key}`}
                  className={inputClass}
                  name={`custom:${field.key}`}
                  type={
                    field.dataType === "number"
                      ? "number"
                      : field.dataType === "date"
                        ? "date"
                        : "text"
                  }
                  defaultValue={
                    typeof field.value === "string" || typeof field.value === "number"
                      ? String(field.value)
                      : ""
                  }
                  required={field.required}
                  disabled={!canManage}
                  maxLength={field.dataType === "text" ? 2000 : undefined}
                />
              )}
            </label>
          ))}
          {canManage ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <Button type="submit">{words.save}</Button>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
