import assert from "node:assert/strict";
import test from "node:test";
import { deleteAnnotationRequest } from "../main/annotations.ts";

test("deleting a missing annotation is treated as deleted so stale local UI can clear", async () => {
  const result = await deleteAnnotationRequest("stale-annotation", {
    fetch: async () =>
      new Response(JSON.stringify({ error: "No annotation found" }), { status: 404 }),
  });

  assert.deepEqual(result, { deleted: true, missing: true });
});
