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
  await writeFile(join(root, "src", "wide.ts"), "export const wide = call(alpha, beta, gamma, delta, epsilon);\n");
  await writeFile(join(root, "src", "image.png"), "not really an image");
  await writeFile(join(root, "dist", "generated.ts"), "const generated = true;\n");
  await writeFile(join(root, "codecharter.json"), "{}\n");
  await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

  const codemap = await generateCodemap({ root });

  assert.equal(codemap.version, 1);
  assert.equal(codemap.projection.type, "filesystem-district-map");
  assert.equal(codemap.projection.layoutVersion, 3);
  assert.equal(codemap.projection.mapOrder, "bounded-weight-binary-districts-folders-first");
  assert.equal(codemap.projection.areaWeight, "sqrt-token-count-with-structural-floor");
  assert.equal(codemap.mapLevels.file, 7);
  assert.ok(codemap.folders[""]);
  assert.ok(codemap.folders.src);
  assert.ok(codemap.files["src/app.ts"]);
  assert.equal(codemap.files["src/app.ts"].lineCount, 2);
  assert.equal(codemap.files["src/app.ts"].maxLineLength, 12);
  assert.equal(codemap.files["src/app.ts"].weight, 10);
  assert.equal(codemap.files["src/wide.ts"].weight > codemap.files["src/app.ts"].weight, true);
  assert.equal("tokenCount" in codemap.files["src/app.ts"], false);
  assert.equal("wordCount" in codemap.files["src/app.ts"], false);
  assert.equal(codemap.files["src/image.png"], undefined);
  assert.equal(codemap.files["dist/generated.ts"], undefined);
  assert.equal(codemap.files["codecharter.json"], undefined);
  assert.equal(codemap.files["pnpm-lock.yaml"], undefined);
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

test("does not anchor a district map to an obsolete projection", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-projection-"));
  await execFileAsync("git", ["init"], { cwd: root });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), "const a = 1;\n");
  const obsoleteBounds = { x: 0, y: 0, width: 1, height: 1 };

  const codemap = await generateCodemap({
    root,
    previousCodemap: {
      projection: { type: "filesystem-treemap" },
      folders: {
        src: { bounds: obsoleteBounds, geo: { geohash: "old" }, growthArea: obsoleteBounds },
      },
      files: {
        "src/app.ts": { bounds: obsoleteBounds, geo: { geohash: "old" } },
      },
    },
  });

  assert.equal(codemap.projection.type, "filesystem-district-map");
  assert.notDeepEqual(codemap.files["src/app.ts"].bounds, obsoleteBounds);
});

test("does not anchor when the district layout algorithm changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-order-"));
  await execFileAsync("git", ["init"], { cwd: root });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), "const a = 1;\n");
  const obsoleteBounds = { x: 0, y: 0, width: 1, height: 1 };

  const codemap = await generateCodemap({
    root,
    previousCodemap: {
      projection: {
        type: "filesystem-district-map",
        layoutVersion: 2,
        mapOrder: "bounded-weight-squarified-folders-first",
        areaWeight: "sqrt-line-count-with-structural-floor",
      },
      folders: {
        src: { bounds: obsoleteBounds, geo: { geohash: "old" }, growthArea: obsoleteBounds },
      },
      files: {
        "src/app.ts": { bounds: obsoleteBounds, geo: { geohash: "old" } },
      },
    },
  });

  assert.equal(codemap.projection.mapOrder, "bounded-weight-binary-districts-folders-first");
  assert.equal(codemap.projection.layoutVersion, 3);
  assert.notDeepEqual(codemap.files["src/app.ts"].bounds, obsoleteBounds);
});

function isInside(bounds, container) {
  return bounds.x >= container.x
    && bounds.y >= container.y
    && bounds.x + bounds.width <= container.x + container.width
    && bounds.y + bounds.height <= container.y + container.height;
}
