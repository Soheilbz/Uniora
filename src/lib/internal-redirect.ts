const INTERNAL_ORIGIN = "https://internal.invalid";
// biome-ignore lint/suspicious/noControlCharactersInRegex: This expression intentionally rejects ASCII control bytes in untrusted redirect paths.
const CONTROL_OR_BACKSLASH = /[\x00-\x1f\x7f\\]/;
const ENCODED_SEPARATOR = /%(?:2f|5c)/i;
const ENCODED_CONTROL = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i;

export interface InternalRedirectOptions {
  fallback?: string;
  pathnamePrefix?: string;
  maxLength?: number;
}

/**
 * Canonicalize a user-controlled post-auth/navigation target to a same-origin path.
 *
 * This deliberately rejects backslashes, controls, and percent-encoded slash/backslash
 * separators before URL parsing. That closes browser/proxy normalization ambiguity such
 * as `/\\evil.example` and encoded variants instead of trying to maintain an ad-hoc
 * blocklist of external URL spellings.
 */
export function safeInternalRedirectPath(
  value: unknown,
  options: InternalRedirectOptions = {},
): string {
  const fallback = options.fallback ?? "/";
  const maxLength = options.maxLength ?? 2048;
  const input = typeof value === "string" ? value.trim() : "";

  if (!input || input.length > maxLength) return fallback;
  if (!input.startsWith("/") || input.startsWith("//")) return fallback;
  const pathname = input.split(/[?#]/, 1)[0] ?? input;
  if (
    CONTROL_OR_BACKSLASH.test(input) ||
    ENCODED_SEPARATOR.test(pathname) ||
    ENCODED_CONTROL.test(input)
  )
    return fallback;

  let parsed: URL;
  try {
    parsed = new URL(input, INTERNAL_ORIGIN);
  } catch {
    return fallback;
  }
  if (parsed.origin !== INTERNAL_ORIGIN || parsed.username || parsed.password) return fallback;

  if (options.pathnamePrefix) {
    const prefix = options.pathnamePrefix.endsWith("/")
      ? options.pathnamePrefix.slice(0, -1)
      : options.pathnamePrefix;
    if (parsed.pathname !== prefix && !parsed.pathname.startsWith(`${prefix}/`)) return fallback;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function isSafeInternalPath(value: unknown, maxLength = 500): boolean {
  return safeInternalRedirectPath(value, { fallback: "", maxLength }) !== "";
}
