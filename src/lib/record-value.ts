/** Read a field selected by a register definition from a typed record object. */
export function recordValue(record: object, key: PropertyKey): unknown {
  return Reflect.get(record, key);
}
