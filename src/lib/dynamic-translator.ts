/**
 * Runtime bridge for catalogue keys that are intentionally data-driven.
 *
 * `next-intl` gives compile-time safety to literal catalogue keys. Worksheets,
 * however, store message paths in their audited form catalogue, so the key is a
 * runtime string by design. Keep that escape hatch in one place and verify the
 * result at runtime instead of scattering double assertions through pages.
 */
export type DynamicTranslator = (key: string, values?: Record<string, string>) => string;

export function dynamicTranslator(translator: unknown): DynamicTranslator {
  if (typeof translator !== "function") {
    throw new TypeError("Expected a callable message translator");
  }

  return (key, values) => {
    const args = values === undefined ? [key] : [key, values];
    const result = Reflect.apply(translator, undefined, args);
    if (typeof result !== "string") {
      throw new TypeError(`Message ${key} did not resolve to text`);
    }
    return result;
  };
}
