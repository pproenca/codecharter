import test from "node:test";
import assert from "node:assert/strict";

import { screenBoundsForView, canRenderSourceText } from "../main/render/index.ts";
import type { MapFile } from "../main/render/index.ts";

test("source text is readable at the zoom level where source lines visibly fit", () => {
  const bounds = {
    x: 0.088427453269,
    y: 0.135377478822,
    width: 0.057340231302,
    height: 0.037828193743,
  };
  const file: MapFile = {
    targetType: "file",
    path: "core/src/main/codex-hook.ts",
    name: "codex-hook.ts",
    lineCount: 660,
    bounds,
  };
  const box = screenBoundsForView(bounds, { x: 0, y: 0, scale: 179.48 }, { width: 2142, height: 1324 });

  assert.equal(canRenderSourceText(file, box), true);
});
