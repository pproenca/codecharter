import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { decodeGeohashBounds } from "../src/geohash.js";
import { generateCodemap } from "../src/generator.js";

const execFileAsync = promisify(execFile);

test("generated spatial sidecar keeps geohash and containment invariants", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-spatial-invariants-"));
  await execFileAsync("git", ["init"], { cwd: root });
  await mkdir(join(root, "src", "features"), { recursive: true });
  await mkdir(join(root, "test"), { recursive: true });
  await writeFile(join(root, "src", "index.ts"), "export const app = true;\n");
  await writeFile(join(root, "src", "features", "search.ts"), "export function search(value: string) {\n  return value.trim();\n}\n");
  await writeFile(join(root, "test", "search.test.ts"), "import { search } from '../src/features/search';\nsearch(' value ');\n");

  const codemap = await generateCodemap({ root });

  assertBoundsInsideUnit(codemap.folders[""].bounds);
  for (const folder of Object.values(codemap.folders)) {
    assertBoundsInsideUnit(folder.bounds);
    assertGeohashContainsBoundsCenter(folder.geo.geohash, folder.bounds);
    for (const childPath of folder.children?.folders ?? []) {
      assertContained(codemap.folders[childPath].bounds, folder.bounds);
    }
    for (const childPath of folder.children?.files ?? []) {
      assertContained(codemap.files[childPath].bounds, folder.bounds);
    }
  }

  for (const file of Object.values(codemap.files)) {
    assertBoundsInsideUnit(file.bounds);
    assertGeohashContainsBoundsCenter(file.geo.geohash, file.bounds);
  }
});

function assertBoundsInsideUnit(bounds) {
  assert.equal(bounds.x >= 0, true);
  assert.equal(bounds.y >= 0, true);
  assert.equal(bounds.x + bounds.width <= 1, true);
  assert.equal(bounds.y + bounds.height <= 1, true);
}

function assertContained(child, parent) {
  assert.equal(child.x >= parent.x, true);
  assert.equal(child.y >= parent.y, true);
  assert.equal(child.x + child.width <= parent.x + parent.width, true);
  assert.equal(child.y + child.height <= parent.y + parent.height, true);
}

function assertGeohashContainsBoundsCenter(geohash, bounds) {
  const decoded = decodeGeohashBounds(geohash);
  const center = {
    lon: (bounds.x + bounds.width / 2) * 360 - 180,
    lat: 90 - (bounds.y + bounds.height / 2) * 180,
  };
  assert.equal(decoded.lat.min <= center.lat && center.lat <= decoded.lat.max, true);
  assert.equal(decoded.lon.min <= center.lon && center.lon <= decoded.lon.max, true);
}
