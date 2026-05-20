import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { generateCodemap } from "../src/generator.js";

const execFileAsync = promisify(execFile);

test("generates a path-keyed map sidecar from gitignore-filtered code files", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-"));
  await execFileAsync("git", ["init"], { cwd: root });
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, ".gitignore"), "dist/\n");
  await writeFile(join(root, "src", "app.ts"), "const a = 1;\nconst b = 2;\n");
  await writeFile(join(root, "src", "image.png"), "not really an image");
  await writeFile(join(root, "dist", "generated.ts"), "const generated = true;\n");
  await writeFile(join(root, "codemap.json"), "{}\n");

  const codemap = await generateCodemap({ root });

  assert.equal(codemap.version, 1);
  assert.equal(codemap.projection.type, "filesystem-treemap");
  assert.equal(codemap.mapLevels.file, 7);
  assert.ok(codemap.folders[""]);
  assert.ok(codemap.folders.src);
  assert.ok(codemap.files["src/app.ts"]);
  assert.equal(codemap.files["src/app.ts"].lineCount, 2);
  assert.equal(codemap.files["src/image.png"], undefined);
  assert.equal(codemap.files["dist/generated.ts"], undefined);
  assert.equal(codemap.files["codemap.json"], undefined);
  assert.equal(typeof codemap.files["src/app.ts"].geo.geohash, "string");
});

test("stabilizes existing file addresses when new files are added", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-stable-"));
  await execFileAsync("git", ["init"], { cwd: root });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), "const a = 1;\nconst b = 2;\n");

  const first = await generateCodemap({ root });
  const previousApp = first.files["src/app.ts"];
  const previousSrcGrowth = first.folders.src.growthArea;

  await writeFile(join(root, "src", "new-feature.ts"), "export const feature = true;\n");

  const second = await generateCodemap({ root, previousCodemap: first });

  assert.deepEqual(second.files["src/app.ts"].bounds, previousApp.bounds);
  assert.deepEqual(second.files["src/app.ts"].geo, previousApp.geo);
  assert.ok(second.files["src/new-feature.ts"]);
  assert.equal(isInside(second.files["src/new-feature.ts"].bounds, previousSrcGrowth), true);
});

function isInside(bounds, container) {
  return bounds.x >= container.x
    && bounds.y >= container.y
    && bounds.x + bounds.width <= container.x + container.width
    && bounds.y + bounds.height <= container.y + container.height;
}
