import { describe, expect, it } from "vitest";
import { decodeTimestampCursor, encodeTimestampCursor } from "./timestamp-cursor.ts";

describe("timestamp cursor", () => {
  it("round-trips a stable date+uuid cursor", () => {
    const value = {
      createdAt: new Date("2026-09-06T12:00:00.000Z"),
      id: "01990c2a-1111-7111-8111-111111111111",
    };
    expect(decodeTimestampCursor(encodeTimestampCursor(value))).toEqual(value);
  });
  it.each(["", "garbage", Buffer.from(JSON.stringify(["bad", "no"])).toString("base64url")])(
    "rejects malformed cursor %s",
    (raw) => expect(decodeTimestampCursor(raw)).toBeNull(),
  );
});
