import assert from "node:assert/strict";
import { stableJson } from "../src/lib/stable-json.ts";

assert.equal(stableJson({ b: 2, a: { z: 3, y: 1 } }), '{"a":{"y":1,"z":3},"b":2}');
assert.equal(stableJson({ a: { y: 1, z: 3 }, b: 2 }), '{"a":{"y":1,"z":3},"b":2}');
assert.equal(stableJson({ values: [3, undefined, 1] }), '{"values":[3,null,1]}');
assert.equal(stableJson({ ignored: undefined, kept: true }), '{"kept":true}');
assert.equal(
  stableJson({ at: new Date("2026-09-06T12:00:00.000Z") }),
  '{"at":"2026-09-06T12:00:00.000Z"}',
);
assert.throws(() => stableJson({ n: Number.NaN }));
assert.throws(() => stableJson({ n: Number.POSITIVE_INFINITY }));
assert.throws(() => stableJson({ n: 1n }));
assert.throws(() => stableJson({ at: new Date(Number.NaN) }));
assert.throws(() => stableJson(undefined));
console.log("stable JSON contract ok");
