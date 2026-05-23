import test from "node:test";
import assert from "node:assert/strict";

import { annotationClipboardText } from "../main/render/source-panel.ts";
import type { MapAnnotationPlace } from "../main/render/types.ts";

test("annotation clipboard prompt is compact and resolves targets with one local command", () => {
  const annotation: MapAnnotationPlace = {
    id: "annotation-1",
    comment: "go explore here",
    deepLink: "codecharter://annotation/annotation-1",
    browserHash: "#/annotation/annotation-1",
    resolvedTargets: [
      { targetType: "file", path: "scripts/build.mjs" },
    ],
  };

  const prompt = annotationClipboardText(annotation, {
    origin: "http://127.0.0.1:4173",
    href: "http://127.0.0.1:4173/#/annotation/annotation-1",
  });

  assert.equal(prompt, [
    "CodeCharter annotation: codecharter://annotation/annotation-1",
    "Note: go explore here",
    "Resolve: codecharter --json resolve \"codecharter://annotation/annotation-1\" --server \"http://127.0.0.1:4173\"",
  ].join("\n"));
  assert.equal(prompt.includes("Track:"), false);
  assert.equal(prompt.includes("CodeCharter URL:"), false);
  assert.equal(prompt.length < 220, true);
});
