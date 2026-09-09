/** Whether reversing an update would touch a field this caller may not mutate. */
export function rollbackTouchesRestrictedField(
  restore: Record<string, unknown>,
  restrictedUpdateFields: readonly string[],
): boolean {
  return restrictedUpdateFields.some((field) => Object.hasOwn(restore, field));
}
