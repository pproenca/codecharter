import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeGeohashBounds } from "../src/geohash.ts";
import { execFileText } from "../src/exec-file.ts";
import { generateCodemap } from "../src/generator.ts";
import { required } from "../test-support/assertions.ts";
import type { Bounds } from "../src/geometry.ts";

test("generated spatial sidecar keeps geohash and containment invariants", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-spatial-invariants-"));
  await execFileText("git", ["init"], { cwd: root });
  await mkdir(join(root, "src", "features"), { recursive: true });
  await mkdir(join(root, "test"), { recursive: true });
  await writeFile(join(root, "src", "index.ts"), "export const app = true;\n");
  await writeFile(join(root, "src", "features", "search.ts"), "export function search(value: string) {\n  return value.trim();\n}\n");
  await writeFile(join(root, "test", "search.test.ts"), "import { search } from '../src/features/search';\nsearch(' value ');\n");

  const codemap = await generateCodemap({ root });

  assertBoundsInsideUnit(required(codemap.folders[""]).bounds);
  for (const folder of Object.values(codemap.folders)) {
    assertBoundsInsideUnit(folder.bounds);
    assertGeohashContainsBoundsCenter(folder.geo.geohash, folder.bounds);
    for (const childPath of folder.children?.folders ?? []) {
      assertContained(required(codemap.folders[childPath]).bounds, folder.bounds);
    }
    for (const childPath of folder.children?.files ?? []) {
      assertContained(required(codemap.files[childPath]).bounds, folder.bounds);
    }
  }

  for (const file of Object.values(codemap.files)) {
    assertBoundsInsideUnit(file.bounds);
    assertGeohashContainsBoundsCenter(file.geo.geohash, file.bounds);
  }
});

function assertBoundsInsideUnit(bounds: Bounds) {
  assert.equal(bounds.x >= 0, true);
  assert.equal(bounds.y >= 0, true);
  assert.equal(bounds.x + bounds.width <= 1, true);
  assert.equal(bounds.y + bounds.height <= 1, true);
}

function assertContained(child: Bounds, parent: Bounds) {
  assert.equal(child.x >= parent.x, true);
  assert.equal(child.y >= parent.y, true);
  assert.equal(child.x + child.width <= parent.x + parent.width, true);
  assert.equal(child.y + child.height <= parent.y + parent.height, true);
}

function assertGeohashContainsBoundsCenter(geohash: string, bounds: Bounds) {
  const decoded = decodeGeohashBounds(geohash);
  const center = {
    lon: (bounds.x + bounds.width / 2) * 360 - 180,
    lat: 90 - (bounds.y + bounds.height / 2) * 180,
  };
  assert.equal(decoded.lat.min <= center.lat && center.lat <= decoded.lat.max, true);
  assert.equal(decoded.lon.min <= center.lon && center.lon <= decoded.lon.max, true);
}
