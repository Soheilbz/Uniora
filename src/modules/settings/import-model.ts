export const PARTICIPANT_IMPORT_FIELDS = [
  "studentNumber",
  "name",
  "affiliation",
  "attendance",
] as const;
export type ParticipantImportField = (typeof PARTICIPANT_IMPORT_FIELDS)[number];
export type ParticipantImportMapping = Partial<Record<ParticipantImportField, string>>;
export type ParticipantImportConflictPolicy = "skip" | "update";

export interface ImportMappingProfileView {
  id: string;
  name: string;
  mapping: ParticipantImportMapping;
  conflictPolicy: ParticipantImportConflictPolicy;
  version: number;
  valid: boolean;
}

const MAX_MAPPING_HEADER_LENGTH = 512;

export function parseParticipantImportMapping(value: unknown): ParticipantImportMapping {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("participant import mapping must be an object");
  }
  const mapping: ParticipantImportMapping = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!PARTICIPANT_IMPORT_FIELDS.includes(key as ParticipantImportField)) {
      throw new TypeError(`unsupported participant import field ${key}`);
    }
    if (typeof raw !== "string" || raw.length < 1 || raw.length > MAX_MAPPING_HEADER_LENGTH) {
      throw new TypeError(`invalid participant import header for ${key}`);
    }
    mapping[key as ParticipantImportField] = raw;
  }
  return mapping;
}

export function parseParticipantImportMappingJson(raw: string): ParticipantImportMapping {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TypeError("participant import mapping is not valid JSON");
  }
  return parseParticipantImportMapping(parsed);
}

export function parseParticipantImportProfileJson(
  mappingJson: string,
  matchStrategyJson: string,
): { mapping: ParticipantImportMapping; conflictPolicy: ParticipantImportConflictPolicy } {
  const mapping = parseParticipantImportMappingJson(mappingJson);
  let parsedStrategy: unknown;
  try {
    parsedStrategy = JSON.parse(matchStrategyJson);
  } catch {
    throw new TypeError("participant import match strategy is not valid JSON");
  }
  if (!parsedStrategy || typeof parsedStrategy !== "object" || Array.isArray(parsedStrategy)) {
    throw new TypeError("participant import match strategy must be an object");
  }
  const entries = Object.entries(parsedStrategy);
  if (entries.some(([key]) => key !== "conflictPolicy")) {
    throw new TypeError("participant import match strategy contains unsupported fields");
  }
  const rawPolicy = (parsedStrategy as Record<string, unknown>).conflictPolicy;
  if (rawPolicy !== "skip" && rawPolicy !== "update") {
    throw new TypeError("participant import conflict policy is invalid");
  }
  return { mapping, conflictPolicy: rawPolicy };
}

export interface ParticipantImportPreview {
  headers: string[];
  mapping: ParticipantImportMapping;
  sample: string[][];
  read: number;
  valid: number;
  invalid: number;
  matchedStudents: number;
  unmatchedStudentNumbers: number;
  existingParticipants: number;
  wouldCreate: number;
  wouldUpdate: number;
  wouldSkip: number;
  capacityRemaining: number | null;
  capacityOverflow: number;
  faults: Array<{ row: number; reason: string; detail: string }>;
}

const DEFAULT_HEADINGS: Record<ParticipantImportField, string[]> = {
  studentNumber: ["شماره دانشجویی", "شماره دانشجوئی", "student number", "student_number"],
  name: ["نام و نام خانوادگی", "نام", "name", "full name"],
  affiliation: ["محل خدمت", "سازمان", "affiliation", "organisation", "organization"],
  attendance: ["وضعیت حضور", "حضور", "attendance"],
};

function fold(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[أإآ]/g, "ا")
    .replace(/[ۀة]/g, "ه")
    .replace(/[‌‏‎]/g, " ")
    .replace(/\s+/g, " ");
}

export function parseParticipantCsv(text: string): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") field += character;
  }
  if (quoted) return null;
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some((cell) => cell.trim() !== ""));
}

export function suggestParticipantMapping(headers: string[]): ParticipantImportMapping {
  const mapping: ParticipantImportMapping = {};
  for (const field of PARTICIPANT_IMPORT_FIELDS) {
    const found = headers.find((header) =>
      DEFAULT_HEADINGS[field].some((candidate) => fold(candidate) === fold(header)),
    );
    if (found !== undefined) mapping[field] = found;
  }
  return mapping;
}
