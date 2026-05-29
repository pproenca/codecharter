import assert from "node:assert/strict";
import test from "node:test";
import { limitToRecent } from "../main/collections.ts";

// CWE-400: limitToRecent bounds how much of an append-ordered log (the activity
// archive) is held in memory — it keeps only the most recent N items, in order,
// and is a no-op when already within the limit.
test("limitToRecent keeps the most recent items in order", () => {
  assert.deepEqual(limitToRecent([1, 2, 3, 4, 5], 3), [3, 4, 5]);
});

test("limitToRecent returns the input untouched when within the limit", () => {
  const input = [1, 2, 3];
  const result = limitToRecent(input, 5);
  assert.equal(result, input);
  assert.deepEqual(result, [1, 2, 3]);
});

test("limitToRecent keeps all items at the exact-limit boundary", () => {
  assert.deepEqual(limitToRecent([1, 2, 3], 3), [1, 2, 3]);
});
