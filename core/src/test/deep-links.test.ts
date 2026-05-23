import test from "node:test";
import assert from "node:assert/strict";

import { createCodemapDeepLink, parseCodemapDeepLink } from "../main/deep-links.ts";

test("parseCodemapDeepLink returns a typed supported kind", () => {
  const link = createCodemapDeepLink("lineRange", "s123", { path: "src/app.ts" });

  assert.deepEqual(parseCodemapDeepLink(link), {
    kind: "lineRange",
    locator: "s123",
    metadata: { path: "src/app.ts" },
  });
});

test("parseCodemapDeepLink rejects unknown kinds", () => {
  assert.throws(
    () => parseCodemapDeepLink("codecharter://symbol/s123"),
    /Unsupported deep link kind: symbol/,
  );
});
