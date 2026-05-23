import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { interactionModeUiState } from "../main/render/camera.ts";

const viewerRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test("static toolbar shell marks Pan as the default active tool", async () => {
  const html = await readFile(join(viewerRoot, "web", "index.html"), "utf8");

  assert.match(html, /id="selectTool" class="icon-tool"[^>]*aria-pressed="false"/);
  assert.match(html, /id="panTool" class="icon-tool active"[^>]*aria-pressed="true"/);
});

test("interaction state exposes Pan as active when panning is the current mode", () => {
  assert.deepEqual(interactionModeUiState({ panning: true }), {
    selectActive: false,
    panActive: true,
    drawActive: false,
    panningMode: true,
    drawingMode: false,
    spacePanningMode: false,
    panning: false,
  });
});

test("temporary Space/touch pan overrides Select without changing persistent mode", () => {
  assert.deepEqual(interactionModeUiState({ spacePanning: true }), {
    selectActive: false,
    panActive: true,
    drawActive: false,
    panningMode: false,
    drawingMode: false,
    spacePanningMode: true,
    panning: false,
  });
});

test("active pan drag keeps Pan pressed without showing persistent pan mode", () => {
  assert.deepEqual(interactionModeUiState({ dragging: { type: "pan" } }), {
    selectActive: false,
    panActive: true,
    drawActive: false,
    panningMode: false,
    drawingMode: false,
    spacePanningMode: false,
    panning: true,
  });
});
