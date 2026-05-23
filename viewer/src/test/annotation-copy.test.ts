import test from "node:test";
import assert from "node:assert/strict";

import { annotationPromptCopyOutcome } from "../main/annotation-copy.ts";

test("successful annotation prompt copy closes the annotation action panel", () => {
  assert.deepEqual(annotationPromptCopyOutcome(true), {
    copied: true,
    closeActions: true,
    buttonLabel: "Copied",
    selectionStatus: "Copied.",
  });
});

test("failed annotation prompt copy keeps the annotation action panel open with feedback", () => {
  assert.deepEqual(annotationPromptCopyOutcome(false), {
    copied: false,
    closeActions: false,
    buttonLabel: "Copy failed",
    selectionStatus: "Copy failed.",
    feedback: {
      message: "Copy failed. Try Copy Prompt again.",
      tone: "error",
    },
  });
});
