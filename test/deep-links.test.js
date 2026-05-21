import test from "node:test";
import assert from "node:assert/strict";
import {
  createAnnotationHashRoute,
  createBrowserHashRoute,
  createCodemapDeepLink,
  createSelectionHashRoute,
  parseCodemapDeepLink,
} from "../src/deep-links.js";
import {
  boundsFromRouteParams,
  parseHashRoute,
} from "../public/deep-links.js";

test("builds and parses canonical codecharter deep links", () => {
  const link = createCodemapDeepLink("lineRange", "u4pruydqqvj", {
    path: "src/search/index.ts",
    lines: "80-120",
  });

  assert.equal(link, "codecharter://lineRange/u4pruydqqvj?path=src%2Fsearch%2Findex.ts&lines=80-120");
  assert.deepEqual(parseCodemapDeepLink(link), {
    kind: "lineRange",
    locator: "u4pruydqqvj",
    metadata: {
      path: "src/search/index.ts",
      lines: "80-120",
    },
  });
});

test("parses legacy codemap deep links", () => {
  assert.deepEqual(parseCodemapDeepLink("codemap://file/s123456?path=src%2Fa.ts"), {
    kind: "file",
    locator: "s123456",
    metadata: {
      path: "src/a.ts",
    },
  });
});

test("parses browser hash routes for client-side focusing", () => {
  const annotation = parseHashRoute("#/annotation/annotation-1");
  assert.equal(annotation.type, "annotation");
  assert.equal(annotation.id, "annotation-1");

  const selection = parseHashRoute("#/selection?level=file&bounds=0.2,0.18,0.25,0.16");
  assert.equal(selection.type, "selection");
  assert.equal(selection.params.get("level"), "file");
  assert.deepEqual(boundsFromRouteParams(selection.params), { x: 0.2, y: 0.18, width: 0.25, height: 0.16 });

  const map = parseHashRoute("#/map/file/9tj2byn?path=src%2Fapp.ts");
  assert.equal(map.type, "map");
  assert.equal(map.kind, "file");
  assert.equal(map.locator, "9tj2byn");
  assert.equal(map.params.get("path"), "src/app.ts");
});

test("builds browser hash routes for map addresses, annotations, and selections", () => {
  assert.equal(
    createBrowserHashRoute("file", "9tj2byn", { path: ".agents/skills/code-map-visualization/SKILL.md" }),
    "#/map/file/9tj2byn?path=.agents%2Fskills%2Fcode-map-visualization%2FSKILL.md",
  );
  assert.equal(createAnnotationHashRoute("annotation-1"), "#/annotation/annotation-1");
  assert.equal(
    createSelectionHashRoute({ level: "file", bounds: { x: 0.2, y: 0.18, width: 0.25, height: 0.16 } }),
    "#/selection?level=file&bounds=0.2%2C0.18%2C0.25%2C0.16",
  );
});

test("selection hash routes preserve coordinate precision and reject degenerate regions", () => {
  const bounds = {
    x: 0.3330228173914,
    y: 0.0000000000014,
    width: 0.3321899757216,
    height: 0.1234567891234,
  };
  const route = parseHashRoute(createSelectionHashRoute({ level: "file", bounds }));
  const parsed = boundsFromRouteParams(route.params);

  assert.ok(Math.abs(parsed.x - bounds.x) <= 5e-13);
  assert.ok(Math.abs(parsed.y - bounds.y) <= 5e-13);
  assert.ok(Math.abs(parsed.width - bounds.width) <= 5e-13);
  assert.ok(Math.abs(parsed.height - bounds.height) <= 5e-13);
  assert.equal(
    boundsFromRouteParams(new URLSearchParams("level=file&bounds=0.333022817391,0,0.332189975722,0")),
    null,
  );
  assert.equal(
    boundsFromRouteParams(new URLSearchParams("level=file&bounds=0.8,0.2,0.3,0.2")),
    null,
  );
});
