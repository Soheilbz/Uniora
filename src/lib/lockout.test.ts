import { describe, expect, it } from "vitest";
import { afterFailure, DEFAULT_LOCKOUT, isLocked } from "./lockout.ts";

/**
 * The sign-in ledger's arithmetic.
 *
 * Every case here is one an office actually produces: somebody who mistypes
 * twice a month apart, somebody who mistypes five times in a row, somebody
 * coming back a minute after being slowed down. None of them needs a database
 * to be wrong.
 */

const AT = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes, 0));

describe("afterFailure", () => {
  it("starts a streak at one", () => {
    const ledger = afterFailure(null, AT(0));
    expect(ledger.failedCount).toBe(1);
    expect(ledger.tripped).toBe(false);
    expect(ledger.lockedUntil).toBeNull();
  });

  it("counts consecutive failures inside the window", () => {
    let ledger = afterFailure(null, AT(0));
    for (let minute = 1; minute < DEFAULT_LOCKOUT.attempts - 1; minute += 1) {
      ledger = afterFailure(ledger, AT(minute));
    }
    expect(ledger.failedCount).toBe(DEFAULT_LOCKOUT.attempts - 1);
    expect(ledger.tripped).toBe(false);
  });

  it("trips exactly on the fifth", () => {
    let ledger = afterFailure(null, AT(0));
    for (let minute = 1; minute <= 3; minute += 1) ledger = afterFailure(ledger, AT(minute));
    expect(ledger.failedCount).toBe(4);
    expect(ledger.tripped).toBe(false);

    ledger = afterFailure(ledger, AT(4));
    expect(ledger.failedCount).toBe(5);
    expect(ledger.tripped).toBe(true);
    expect(ledger.lockedUntil).toEqual(new Date(AT(4).getTime() + DEFAULT_LOCKOUT.cooldownMs));
  });

  it("starts fresh after the window, rather than reviving a stale streak", () => {
    /*
     * The case this exists for: four typos in March must not put May one attempt
     * from a lock. Without the window the count never resets, and the person it
     * eventually catches is always the owner rather than an attacker.
     */
    const old = afterFailure(
      afterFailure(afterFailure(afterFailure(null, AT(0)), AT(1)), AT(2)),
      AT(3),
    );
    expect(old.failedCount).toBe(4);

    const later = afterFailure(old, AT(3 + DEFAULT_LOCKOUT.windowMs / 60_000 + 1));
    expect(later.failedCount).toBe(1);
    expect(later.tripped).toBe(false);
  });

  it("counts a failure exactly at the window's edge as consecutive", () => {
    const first = afterFailure(null, AT(0));
    const edge = new Date(first.lastFailedAt.getTime() + DEFAULT_LOCKOUT.windowMs);
    expect(afterFailure(first, edge).failedCount).toBe(2);
  });
});

describe("isLocked", () => {
  it("is false for an account with no ledger", () => {
    expect(isLocked(null, AT(0))).toBe(false);
  });

  it("is false while the count is below the threshold", () => {
    expect(isLocked(afterFailure(null, AT(0)), AT(0))).toBe(false);
  });

  it("is true for the cooldown and false the moment it passes", () => {
    let ledger = afterFailure(null, AT(0));
    for (let minute = 1; minute <= 4; minute += 1) ledger = afterFailure(ledger, AT(0));
    expect(ledger.tripped).toBe(true);

    const until = ledger.lockedUntil;
    expect(until).not.toBeNull();
    if (!until) return;

    expect(isLocked(ledger, new Date(until.getTime() - 1))).toBe(true);
    /* At the instant itself, not after it: a cooldown that ends "some time
       after" the stated moment is one an owner watches a clock for and is still
       refused. */
    expect(isLocked(ledger, until)).toBe(false);
    expect(isLocked(ledger, new Date(until.getTime() + 1))).toBe(false);
  });
});
