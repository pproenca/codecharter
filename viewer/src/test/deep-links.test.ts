import assert from "node:assert/strict";
import test from "node:test";
import { createMapHashRoute, parseHashRoute } from "../main/deep-links.ts";

test("createMapHashRoute writes resolver-backed map route kinds", () => {
  const route = createMapHashRoute("lineRange", "s123", {
    path: "src/app.ts",
    lines: "4-8",
  });

  assert.equal(route, "#/map/lineRange/s123?path=src%2Fapp.ts&lines=4-8");
  assert.deepEqual(parseHashRoute(route), {
    type: "map",
    kind: "lineRange",
    locator: "s123",
    params: new URLSearchParams("path=src%2Fapp.ts&lines=4-8"),
  });
});

test("parseHashRoute rejects unknown map route kinds", () => {
  assert.equal(parseHashRoute("#/map/symbol/s123?path=src%2Fapp.ts"), null);
});
