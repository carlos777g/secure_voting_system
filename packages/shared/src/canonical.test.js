import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalStringify } from "./canonical.js";

test("key order does not affect the output", () => {
  const a = canonicalStringify({ b: 2, a: 1 });
  const b = canonicalStringify({ a: 1, b: 2 });
  assert.equal(a, b);
});

test("nested objects and arrays are sorted deeply", () => {
  const result = canonicalStringify({ z: [{ y: 1, x: 2 }], a: 1 });
  assert.equal(result, '{"a":1,"z":[{"x":2,"y":1}]}');
});

test("uses compact separators, matching Python's (',', ':')", () => {
  const result = canonicalStringify({ a: 1, b: 2 });
  assert.equal(result.includes(" "), false);
});
