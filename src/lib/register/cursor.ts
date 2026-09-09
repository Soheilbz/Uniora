import { createHash } from "node:crypto";
import type { RegisterQuery } from "./spec.ts";
import { sortSequence } from "./spec.ts";

export type CursorScalar = string | number | null;
export type CursorMode = "after" | "before";

interface CursorPayload {
  v: 1;
  q: string;
  mode: CursorMode;
  page: number;
  total: number;
  values: CursorScalar[];
  id: string;
}

export interface DecodedRegisterCursor {
  mode: CursorMode;
  page: number;
  total: number;
  values: CursorScalar[];
  id: string;
}

const MAX_CURSOR_LENGTH = 1800;
const MAX_CURSOR_VALUES = 6;

/** Stable fingerprint that prevents a cursor being reused with a different view. */
export function registerCursorFingerprint(query: RegisterQuery): string {
  const filters = Object.fromEntries(
    Object.entries(query.filters).sort(([a], [b]) => a.localeCompare(b)),
  );
  return createHash("sha256")
    .update(
      JSON.stringify({
        search: query.search,
        filters,
        sorts: sortSequence(query),
        size: query.size,
      }),
    )
    .digest("base64url")
    .slice(0, 22);
}

export function encodeRegisterCursor(
  query: RegisterQuery,
  input: Omit<DecodedRegisterCursor, "values"> & { values: CursorScalar[] },
): string {
  if (input.values.length < 1 || input.values.length > MAX_CURSOR_VALUES) {
    throw new Error("invalid cursor value count");
  }
  const payload: CursorPayload = {
    v: 1,
    q: registerCursorFingerprint(query),
    mode: input.mode,
    page: boundedInteger(input.page, 1, 10_000),
    total: boundedInteger(input.total, 0, 10_000_000),
    values: input.values.map(cleanScalar),
    id: cleanId(input.id),
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeRegisterCursor(
  query: RegisterQuery,
  token: string,
  expectedValues: number,
): DecodedRegisterCursor | null {
  if (
    !token ||
    token.length > MAX_CURSOR_LENGTH ||
    expectedValues < 1 ||
    expectedValues > MAX_CURSOR_VALUES
  )
    return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(token, "base64url").toString("utf8"),
    ) as Partial<CursorPayload>;
    if (parsed.v !== 1 || parsed.q !== registerCursorFingerprint(query)) return null;
    if (parsed.mode !== "after" && parsed.mode !== "before") return null;
    if (!Array.isArray(parsed.values) || parsed.values.length !== expectedValues) return null;
    const values = parsed.values.map(validateScalar);
    if (values.some((value) => value === INVALID)) return null;
    if (typeof parsed.id !== "string" || !/^[0-9a-f-]{36}$/i.test(parsed.id)) return null;
    if (
      !Number.isSafeInteger(parsed.page) ||
      Number(parsed.page) < 1 ||
      Number(parsed.page) > 10_000
    )
      return null;
    if (
      !Number.isSafeInteger(parsed.total) ||
      Number(parsed.total) < 0 ||
      Number(parsed.total) > 10_000_000
    )
      return null;
    return {
      mode: parsed.mode,
      page: Number(parsed.page),
      total: Number(parsed.total),
      values: values as CursorScalar[],
      id: parsed.id,
    };
  } catch {
    return null;
  }
}

function cleanScalar(value: CursorScalar): CursorScalar {
  if (value === null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("invalid numeric cursor value");
    return value;
  }
  return String(value).slice(0, 500);
}

const INVALID = Symbol("invalid-cursor-scalar");
function validateScalar(value: unknown): CursorScalar | typeof INVALID {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length <= 500) return value;
  return INVALID;
}
function boundedInteger(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error("invalid cursor integer");
  return value;
}
function cleanId(value: string): string {
  const id = String(value).trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("invalid cursor id");
  return id;
}
