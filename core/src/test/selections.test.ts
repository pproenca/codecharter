import assert from "node:assert/strict";
import test from "node:test";
import type { CodecharterCodemap } from "../main/resolver.ts";
import { createMapAnnotation } from "../main/selections.ts";

test("map annotation codex prompt is compact and uses one resolve command", () => {
  const annotation = createMapAnnotation(fixtureCodemap(), {
    id: "annotation-1",
    comment: "go explore here",
    level: "file",
    geometry: { type: "rect", bounds: { x: 0, y: 0, width: 0.5, height: 0.5 } },
  });

  assert.equal(
    annotation.codexPrompt,
    [
      "CodeCharter annotation: codecharter://annotation/annotation-1",
      "Note: go explore here",
      'Resolve: codecharter --json resolve "codecharter://annotation/annotation-1"',
    ].join("\n"),
  );
  assert.equal(annotation.codexPrompt.includes("npx --yes"), false);
  assert.equal(annotation.codexPrompt.length < 180, true);
});

function fixtureCodemap(): CodecharterCodemap {
  return {
    folders: {},
    files: {
      "scripts/build.mjs": {
        path: "scripts/build.mjs",
        bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        geo: { lat: 0, lon: 0, geohash: "s00000000000" },
        lineCount: 10,
      },
    },
  };
}
