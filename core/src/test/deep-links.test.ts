import assert from "node:assert/strict";
import test from "node:test";
import { createCodemapDeepLink, parseCodemapDeepLink } from "../main/deep-links.ts";
import { MAP_LEVELS } from "../main/levels.ts";
import type { MapLevel } from "../main/levels.ts";

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

// ---------------------------------------------------------------------------
// BR-DEEPLINK-001 — codecharter:// is the canonical scheme; round-trips
// ---------------------------------------------------------------------------

test("BR-DEEPLINK-001 created links always use the codecharter:// scheme", () => {
  const link = createCodemapDeepLink("file", "gcpvj0d", { path: "src/app.ts", lines: "1-10" });
  assert.ok(link.startsWith("codecharter://file/"));
  const parsed = parseCodemapDeepLink(link);
  assert.equal(parsed.kind, "file");
  assert.equal(parsed.locator, "gcpvj0d");
  assert.deepEqual(parsed.metadata, { path: "src/app.ts", lines: "1-10" });
});

test("BR-DEEPLINK-001 kind and locator are percent-encoded in the URL", () => {
  const link = createCodemapDeepLink("file", "a b/c", { path: "x y.ts" });
  assert.ok(!link.includes(" "), "spaces must be encoded");
  assert.equal(parseCodemapDeepLink(link).locator, "a b/c");
});

// ---------------------------------------------------------------------------
// BR-DEEPLINK-002 — legacy codemap:// is parse-only input
// ---------------------------------------------------------------------------

test("BR-DEEPLINK-002 legacy codemap:// links still parse", () => {
  assert.deepEqual(parseCodemapDeepLink("codemap://file/s123?path=src%2Fapp.ts"), {
    kind: "file",
    locator: "s123",
    metadata: { path: "src/app.ts" },
  });
});

test("BR-DEEPLINK-002 the writer never emits codemap:// (only codecharter://)", () => {
  assert.ok(createCodemapDeepLink("file", "s123").startsWith("codecharter://"));
});

test("BR-DEEPLINK-002 a non-codecharter/codemap scheme is rejected", () => {
  assert.throws(
    () => parseCodemapDeepLink("https://file/s123"),
    /Unsupported deep link protocol: https:/,
  );
});

// ---------------------------------------------------------------------------
// BR-DEEPLINK-003 — valid kinds are the map levels plus "annotation"
// ---------------------------------------------------------------------------

test("BR-DEEPLINK-003 every map level and 'annotation' is a valid kind", () => {
  for (const level of Object.keys(MAP_LEVELS) as MapLevel[]) {
    const parsed = parseCodemapDeepLink(createCodemapDeepLink(level, "s1"));
    assert.equal(parsed.kind, level);
  }
  assert.equal(parseCodemapDeepLink(createCodemapDeepLink("annotation", "id1")).kind, "annotation");
});

// ---------------------------------------------------------------------------
// BR-DEEPLINK-004 — empty kind/locator rejected; empty metadata dropped
// ---------------------------------------------------------------------------

test("BR-DEEPLINK-004 empty kind is rejected", () => {
  assert.throws(() => createCodemapDeepLink("" as MapLevel, "s1"), {
    message: "Deep link kind is required",
  });
});

test("BR-DEEPLINK-004 empty locator is rejected", () => {
  assert.throws(() => createCodemapDeepLink("file", ""), {
    message: "Deep link locator is required",
  });
});

test("BR-DEEPLINK-004 undefined and empty-string metadata values are dropped", () => {
  const link = createCodemapDeepLink("file", "s1", {
    path: "src/app.ts",
    lines: "",
    columns: undefined,
  });
  assert.deepEqual(parseCodemapDeepLink(link).metadata, { path: "src/app.ts" });
});
