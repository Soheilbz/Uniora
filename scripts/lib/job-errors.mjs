/**
 * Error taxonomy for durable tenant jobs.
 *
 * Handlers should throw PermanentJobError when retrying cannot change the
 * outcome (invalid/corrupt durable state, unsupported operation, revoked
 * authority). RetryableJobError is for transient failures that optionally
 * provide an explicit retry delay.
 */
export class PermanentJobError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "PermanentJobError";
  }
}

export class RetryableJobError extends Error {
  constructor(message, retryAfterSeconds, options) {
    super(message, options);
    this.name = "RetryableJobError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function isRetryableJobError(error) {
  return !(error instanceof PermanentJobError);
}

export function errorMessage(value) {
  return value instanceof Error ? value.message : String(value);
}
