import assert from "node:assert/strict";
import {
  buildScheduleSpec,
  calculateNextRunAt,
  calculateNextScheduledOccurrence,
  parseScheduleSpec,
  validateTimeZone,
} from "../src/lib/scheduling-core.ts";
import { isRetryableJobError, PermanentJobError, RetryableJobError } from "./lib/job-errors.mjs";
import { parseStoredArray, parseStoredObject } from "./lib/stored-json.mjs";
import {
  createMaintenanceClock,
  maintenanceDue,
  markMaintenanceRun,
  workerMaintenanceIntervals,
} from "./lib/worker-maintenance.mjs";

assert.deepEqual(parseStoredObject('{"a":1}', "object"), { a: 1 });
assert.deepEqual(parseStoredObject({ a: 1 }, "object"), { a: 1 });
assert.deepEqual(parseStoredArray("[1,2]", "array"), [1, 2]);
assert.deepEqual(parseStoredArray([1, 2], "array"), [1, 2]);
assert.throws(() => parseStoredObject("{", "corrupt object"), PermanentJobError);
assert.throws(() => parseStoredArray("{}", "wrong shape"), PermanentJobError);
assert.throws(() => parseStoredObject("[]", "wrong shape"), PermanentJobError);
assert.equal(isRetryableJobError(new PermanentJobError("bad durable state")), false);
assert.equal(isRetryableJobError(new RetryableJobError("transient", 30)), true);
assert.equal(isRetryableJobError(new Error("transient")), true);

const maintenanceIntervals = workerMaintenanceIntervals(180);
assert.deepEqual(maintenanceIntervals, { staleRecoveryMs: 60_000, artifactExpiryMs: 60_000 });
assert.equal(workerMaintenanceIntervals(60).staleRecoveryMs, 20_000);
assert.equal(workerMaintenanceIntervals(10).staleRecoveryMs, 10_000);
assert.throws(() => workerMaintenanceIntervals(0), TypeError);
const maintenanceClock = createMaintenanceClock(1_000);
assert.deepEqual(maintenanceDue(maintenanceClock, 999), {
  recoverStaleJobs: false,
  expireArtifacts: false,
});
assert.deepEqual(maintenanceDue(maintenanceClock, 1_000), {
  recoverStaleJobs: true,
  expireArtifacts: true,
});
markMaintenanceRun(
  maintenanceClock,
  "recoverStaleJobs",
  maintenanceIntervals.staleRecoveryMs,
  2_000,
);
assert.equal(maintenanceClock.recoverStaleJobsAt, 62_000);
assert.equal(maintenanceClock.expireArtifactsAt, 1_000);

assert.deepEqual(parseScheduleSpec("interval:6h"), { type: "interval", everyMinutes: 360 });
assert.deepEqual(parseScheduleSpec('{"type":"weekly","at":"08:30","weekdays":[5,1,5,9]}'), {
  type: "weekly",
  at: "08:30",
  weekdays: [1, 5],
});
assert.throws(() => parseScheduleSpec('{"type":"weekly","at":"08:30","weekdays":[]}'));
assert.throws(() => parseScheduleSpec('{"type":"daily","at":"25:00"}'));
assert.throws(() => validateTimeZone("Not/A_Timezone"));

const interval = buildScheduleSpec({ type: "interval", intervalMinutes: 60 });
const initial = new Date("2026-09-06T10:00:00.000Z");
assert.equal(
  calculateNextRunAt(interval, "UTC", initial)?.toISOString(),
  "2026-09-06T11:00:00.000Z",
);
assert.equal(
  calculateNextScheduledOccurrence(
    interval,
    "UTC",
    new Date("2026-09-06T10:00:00.000Z"),
    new Date("2026-09-06T13:20:00.000Z"),
  )?.toISOString(),
  "2026-09-06T14:00:00.000Z",
);

const weekly = parseScheduleSpec('{"type":"weekly","at":"08:30","weekdays":[1,3,5]}');
assert.equal(
  calculateNextScheduledOccurrence(
    weekly,
    "UTC",
    new Date("2026-09-04T08:30:00.000Z"),
    new Date("2026-09-06T12:00:00.000Z"),
  )?.toISOString(),
  "2026-09-07T08:30:00.000Z",
);

// Europe/Berlin skips 02:30 on the spring-forward date; the recurrence must
// advance to the next valid local occurrence instead of inventing an instant.
const daily = parseScheduleSpec('{"type":"daily","at":"02:30"}');
assert.equal(
  calculateNextScheduledOccurrence(
    daily,
    "Europe/Berlin",
    new Date("2026-03-28T01:30:00.000Z"),
    new Date("2026-03-29T00:00:00.000Z"),
  )?.toISOString(),
  "2026-03-30T00:30:00.000Z",
);

console.log("worker semantics contract ok");
