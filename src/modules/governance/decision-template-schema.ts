export interface DecisionTemplateSchema {
  placeholders: string[];
  description: string | null;
}

export function buildDecisionTemplateSchema(input: {
  placeholders: readonly string[];
  description?: string | null;
}): DecisionTemplateSchema {
  const placeholders = [...new Set(input.placeholders.map((item) => item.trim()).filter(Boolean))];
  return validateDecisionTemplateSchema({
    placeholders,
    description: input.description?.trim() || null,
  });
}

/** Parse durable decision-template schema without hiding corruption. */
export function parseDecisionTemplateSchema(raw: string): DecisionTemplateSchema {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error("decision template schema contains malformed JSON", { cause: error });
  }
  return validateDecisionTemplateSchema(parsed);
}

function validateDecisionTemplateSchema(value: unknown): DecisionTemplateSchema {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("decision template schema must be an object");
  }

  const object = value as Record<string, unknown>;
  if (
    !Array.isArray(object.placeholders) ||
    object.placeholders.some((item) => typeof item !== "string")
  ) {
    throw new Error("decision template placeholders are invalid");
  }
  if (object.placeholders.length > 50)
    throw new Error("decision template has too many placeholders");

  const placeholders = object.placeholders.map((item) => item.trim());
  if (placeholders.some((item) => !item || item.length > 120)) {
    throw new Error("decision template placeholder is invalid");
  }
  if (new Set(placeholders).size !== placeholders.length) {
    throw new Error("decision template placeholders must be unique");
  }

  const description = object.description;
  if (description !== null && description !== undefined && typeof description !== "string") {
    throw new Error("decision template description is invalid");
  }
  if (typeof description === "string" && description.length > 2000) {
    throw new Error("decision template description is too long");
  }

  return { placeholders, description: typeof description === "string" ? description : null };
}
