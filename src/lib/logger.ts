type LogContext = Record<string, boolean | number | string | null | undefined>;

function serializeError(error: unknown) {
  if (error instanceof Error) {
    const serialized: {
      name: string;
      message: string;
      stack: string | undefined;
      cause?: { name: string; message: string } | { message: string };
    } = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
    if (error.cause instanceof Error) {
      serialized.cause = { name: error.cause.name, message: error.cause.message };
    } else if (error.cause !== undefined) {
      serialized.cause = { message: String(error.cause) };
    }
    return serialized;
  }

  return { message: String(error) };
}

/**
 * Small structured logger for server-side operational events.
 *
 * JSON keeps logs useful in both a local terminal and a collector, while the
 * call sites decide explicitly which safe identifiers are worth recording.
 * Passwords, cookies, request bodies and national identifiers must never be
 * passed as context.
 */
export function logError(event: string, error: unknown, context: LogContext = {}) {
  console.error(
    JSON.stringify({
      level: "error",
      event,
      timestamp: new Date().toISOString(),
      error: serializeError(error),
      ...context,
    }),
  );
}

export function logWarn(event: string, context: LogContext = {}) {
  console.warn(
    JSON.stringify({
      level: "warn",
      event,
      timestamp: new Date().toISOString(),
      ...context,
    }),
  );
}
