import test from "node:test";
import assert from "node:assert/strict";

import { annotationClipboardText } from "../main/render/source-panel.ts";
import type { MapAnnotationPlace } from "../main/render/types.ts";

test("annotation clipboard prompt includes a server activity tracking command for resolved targets", () => {
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

  assert.match(prompt, /Resolve: npx --yes codecharter@latest --json resolve "codecharter:\/\/annotation\/annotation-1" --server "http:\/\/127\.0\.0\.1:4173"/);
  assert.match(prompt, /Track: npx --yes codecharter@latest --json activity "scripts\/build\.mjs" --state reading --note "go explore here" --server "http:\/\/127\.0\.0\.1:4173"/);
});
