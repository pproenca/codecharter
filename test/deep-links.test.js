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

test("builds and parses canonical codemap deep links", () => {
  const link = createCodemapDeepLink("lineRange", "u4pruydqqvj", {
    path: "src/search/index.ts",
    lines: "80-120",
  });

  assert.equal(link, "codemap://lineRange/u4pruydqqvj?path=src%2Fsearch%2Findex.ts&lines=80-120");
  assert.deepEqual(parseCodemapDeepLink(link), {
    kind: "lineRange",
    locator: "u4pruydqqvj",
    metadata: {
      path: "src/search/index.ts",
      lines: "80-120",
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
