import assert from "node:assert/strict";
import test from "node:test";
import {
  buildActivityFogState,
  discoveryFogRevealStyle,
  fogStateForFile,
  fogStateForFolder,
  shouldShowFogLabel,
} from "../main/render/fog.ts";
import type { ActivityEvent, CodecharterCodemap } from "../main/render/types.ts";

const CODEMAP: CodecharterCodemap = {
  files: { "src/a.ts": { path: "src/a.ts" }, "src/b.ts": { path: "src/b.ts" } },
  folders: { "": { path: "" }, src: { path: "src" } },
};

// viewerFogState markers classify deterministically (no time dependence):
// "visible" => visited + visible, "explored" => visited only. Unmapped paths drop.
test("buildActivityFogState classifies files and ranks ancestor folders", () => {
  const events: ActivityEvent[] = [
    { path: "src/a.ts", viewerFogState: "explored" },
    { path: "src/b.ts", viewerFogState: "visible" },
    { path: "missing.ts", viewerFogState: "visible" },
  ];
  const fog = buildActivityFogState(CODEMAP, events);

  assert.equal(fog.files.get("src/a.ts"), "explored");
  assert.equal(fog.files.get("src/b.ts"), "visible");
  assert.equal(fog.files.has("missing.ts"), false);
  assert.deepEqual([...fog.visitedFiles].toSorted(), ["src/a.ts", "src/b.ts"]);
  assert.deepEqual([...fog.visibleFiles], ["src/b.ts"]);

  // Folders take the strongest fog of any descendant: visible > explored.
  assert.equal(fog.folders.get("src"), "visible");
  assert.equal(fog.folders.get(""), "visible");
});

test("fogStateForFile resolves lookup, selected override, and defaults", () => {
  const fog = buildActivityFogState(CODEMAP, [{ path: "src/a.ts", viewerFogState: "explored" }]);

  assert.equal(fogStateForFile(fog, "src/a.ts"), "explored");
  // A file with no recorded activity is unexplored.
  assert.equal(fogStateForFile(fog, "src/b.ts"), "unexplored");
  // Selection forces visibility regardless of fog.
  assert.equal(fogStateForFile(fog, "src/b.ts", { selected: true }), "visible");
  // No fog state at all renders everything visible (fog disabled).
  assert.equal(fogStateForFile(null, "src/b.ts"), "visible");
});

test("fogStateForFolder mirrors the file resolution rules", () => {
  const fog = buildActivityFogState(CODEMAP, [{ path: "src/a.ts", viewerFogState: "explored" }]);
  assert.equal(fogStateForFolder(fog, "src"), "explored");
  assert.equal(fogStateForFolder(fog, "other"), "unexplored");
  assert.equal(fogStateForFolder(null, "other"), "visible");
});

test("shouldShowFogLabel hides only unexplored, unselected targets", () => {
  assert.equal(shouldShowFogLabel("unexplored"), false);
  assert.equal(shouldShowFogLabel("unexplored", { selected: true }), true);
  assert.equal(shouldShowFogLabel("explored"), true);
  assert.equal(shouldShowFogLabel("visible"), true);
});

test("discoveryFogRevealStyle varies with visibility and readability", () => {
  assert.equal(discoveryFogRevealStyle({ visibleFile: true, readable: true }).padding, 68);
  assert.equal(discoveryFogRevealStyle({ visibleFile: true, readable: true }).alpha, 1);
  assert.equal(discoveryFogRevealStyle({ visibleFile: true }).padding, 64);
  assert.equal(discoveryFogRevealStyle().alpha, 0.28);
});
