import assert from "node:assert/strict";
import test from "node:test";
import {
  boundsCenter,
  clamp,
  compareTargetAreaThenPath,
  containsBoundsPoint,
  firstPathSegment,
  hashString,
  hashUnit,
  lastPathSegment,
  normalizeMapPath,
  pathFromDeepLink,
  pointDistance,
  rgba,
  sortIfNeeded,
  valuesAreSorted,
} from "../main/render/primitives.ts";
import type { MapTarget } from "../main/render/types.ts";

test("clamp bounds a value to [min, max]", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-3, 0, 10), 0);
  assert.equal(clamp(42, 0, 10), 10);
});

test("sortIfNeeded sorts in place and is a no-op when already ordered", () => {
  const unsorted = [3, 1, 2];
  const result = sortIfNeeded(unsorted, (a, b) => a - b);
  assert.equal(result, unsorted); // same reference (in place)
  assert.deepEqual(unsorted, [1, 2, 3]);

  const sorted = [1, 2, 3];
  assert.equal(
    valuesAreSorted(sorted, (a, b) => a - b),
    true,
  );
  assert.equal(
    valuesAreSorted([2, 1], (a, b) => a - b),
    false,
  );
});

test("hashString is deterministic and unsigned 32-bit; hashUnit is in [0,1)", () => {
  assert.equal(hashString("core/src/main/app.ts"), hashString("core/src/main/app.ts"));
  assert.notEqual(hashString("a"), hashString("b"));
  assert.ok(hashString("anything") >= 0 && hashString("anything") <= 0xffffffff);
  const unit = hashUnit("core/src");
  assert.ok(unit >= 0 && unit <= 1);
});

test("normalizeMapPath canonicalizes slashes, ./ prefix, trailing slash, and '.'", () => {
  assert.equal(normalizeMapPath("src\\main\\app.ts"), "src/main/app.ts");
  assert.equal(normalizeMapPath("./src/app.ts"), "src/app.ts");
  assert.equal(normalizeMapPath("src/main/"), "src/main");
  assert.equal(normalizeMapPath("."), "");
  assert.equal(normalizeMapPath(null), "");
});

test("pathFromDeepLink extracts the path param, '' on garbage", () => {
  assert.equal(pathFromDeepLink("codecharter://map?path=core/src/app.ts"), "core/src/app.ts");
  assert.equal(pathFromDeepLink("not a url"), "");
  assert.equal(pathFromDeepLink(null), "");
});

test("geometry helpers", () => {
  assert.equal(pointDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.deepEqual(boundsCenter({ x: 0, y: 0, width: 4, height: 2 }), { x: 2, y: 1 });
  const box = { x: 0, y: 0, width: 10, height: 10 };
  assert.equal(containsBoundsPoint(box, { x: 5, y: 5 }), true);
  assert.equal(containsBoundsPoint(box, { x: 11, y: 5 }), false);
});

test("path segment helpers", () => {
  assert.equal(firstPathSegment("core/src/app.ts"), "core");
  assert.equal(firstPathSegment("app.ts"), "app.ts");
  assert.equal(lastPathSegment("core/src/app.ts"), "app.ts");
  assert.equal(lastPathSegment("app.ts"), "app.ts");
});

test("rgba formats a color string", () => {
  assert.equal(rgba([1, 2, 3], 0.5), "rgba(1, 2, 3, 0.5)");
});

test("compareTargetAreaThenPath orders by area, then path", () => {
  const small: MapTarget = { path: "z.ts", bounds: { x: 0, y: 0, width: 1, height: 1 } };
  const large: MapTarget = { path: "a.ts", bounds: { x: 0, y: 0, width: 2, height: 2 } };
  assert.ok(compareTargetAreaThenPath(small, large) < 0); // smaller area first
  const sameAreaA: MapTarget = { path: "a.ts", bounds: { x: 0, y: 0, width: 1, height: 1 } };
  const sameAreaB: MapTarget = { path: "b.ts", bounds: { x: 0, y: 0, width: 1, height: 1 } };
  assert.ok(compareTargetAreaThenPath(sameAreaA, sameAreaB) < 0); // tiebreak by path
});
