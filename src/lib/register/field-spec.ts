/**
 * Shared field vocabulary for every registry-style domain.
 *
 * This deliberately lives below the domain modules: client form/rendering code,
 * validation builders and each register's field catalogue may depend on it,
 * but no register has to depend on another register merely to describe a field.
 */
export type FieldKind = "text" | "number" | "date" | "boolean" | "lookup" | "reference" | "choice";

export type FieldFormat =
  | "text"
  | "digits"
  | "nationalId"
  | "code"
  | "tel"
  | "email"
  | "sittingNumber"
  | "time"
  | "clockText";

export interface FieldSpec<Group extends string = string> {
  key: string;
  kind: FieldKind;
  group: Group;
  format?: FieldFormat;
  required?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  scale?: number;
  /** For lookup fields: the institution-maintained vocabulary. */
  set?: string;
  /** Whether a lookup accepts a value not yet present in that vocabulary. */
  allowCustom?: boolean;
  /** For program-owned closed lists such as yes/no/not-recorded. */
  choices?: readonly { value: string; labelKey: string }[];
  /** For dependent vocabularies such as faculty -> department. */
  narrowedBy?: string;
  /** For structured references between registers. */
  references?: "professor";
  /** Catalogue key for contextual help. */
  hint?: string;
}

/** Shape consumed by generic register UI where the owning domain's group union is irrelevant. */
export type AnyFieldSpec = FieldSpec<string>;
