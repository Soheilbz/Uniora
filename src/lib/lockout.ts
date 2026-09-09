/**
 * The rule a sign-in ledger follows, with no database in it.
 *
 * Separated from `login-guard.ts` for the reason every rule in this project is
 * separated from its query: the arithmetic of "is this the fifth failure inside
 * fifteen minutes" is the part that can be wrong, and it is the part a test can
 * reach without a PostgreSQL, a Better Auth instance and an HTTP request.
 */

export interface LockoutPolicy {
  /** Consecutive failures that trip the brake. */
  attempts: number;
  /** How far apart two failures may be and still count as consecutive. */
  windowMs: number;
  /** How long a tripped brake refuses sign-ins without verifying anything. */
  cooldownMs: number;
}

/**
 * Five failures within a quarter of an hour, then one attempt a minute.
 *
 * ── Why a minute and not fifteen ────────────────────────────────────────────
 *
 * A hard fifteen-minute account lock is a denial-of-service primitive: anybody
 * who knows a colleague's username can keep them out of the registry all
 * morning without ever knowing their password. What this needs to stop is *rate*
 * — a guesser trying thousands — and a sixty-second cooldown takes an attacker
 * from thousands of attempts an hour to sixty, which collapses guessing while
 * costing an owner who mistyped five times exactly one minute.
 *
 * ── Why the window ──────────────────────────────────────────────────────────
 *
 * Without it the count never resets and four typos in March put May one attempt
 * from a lock. A failure outside the window starts a fresh streak.
 */
export const DEFAULT_LOCKOUT: LockoutPolicy = {
  attempts: 5,
  windowMs: 15 * 60_000,
  cooldownMs: 60_000,
};

export interface Ledger {
  failedCount: number;
  lastFailedAt: Date;
  lockedUntil: Date | null;
}

/** Whether the brake is on right now. */
export function isLocked(ledger: Pick<Ledger, "lockedUntil"> | null, now: Date): boolean {
  const until = ledger?.lockedUntil;
  return until !== null && until !== undefined && until.getTime() > now.getTime();
}

/**
 * The ledger after one more failed verification.
 *
 * `previous` is null for an account with a clean slate. The returned
 * `lockedUntil` is non-null exactly when this failure tripped the brake, which
 * is also when the office gets its `auth.lockout` audit row — «somebody was
 * locked out» is a fact an administrator asks about separately from the
 * attempts that caused it.
 */
export function afterFailure(
  previous: Ledger | null,
  now: Date,
  policy: LockoutPolicy = DEFAULT_LOCKOUT,
): Ledger & { tripped: boolean } {
  const consecutive =
    previous && now.getTime() - previous.lastFailedAt.getTime() <= policy.windowMs
      ? previous.failedCount + 1
      : 1;

  const tripped = consecutive >= policy.attempts;
  return {
    failedCount: consecutive,
    lastFailedAt: now,
    lockedUntil: tripped ? new Date(now.getTime() + policy.cooldownMs) : null,
    tripped,
  };
}
