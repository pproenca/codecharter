import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { generateCodemap } from "../src/generator.ts";
import { listIncludedFiles } from "../src/scan.ts";
import type { GeneratedCodemap } from "../src/generator.ts";
import type { Bounds } from "../src/geometry.ts";

const execFileAsync = promisify(execFile);

test("lists git-visible code files with deterministic excludes", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-scan-"));
  await execFileAsync("git", ["init"], { cwd: root });
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, ".gitignore"), "dist/\n");
  await writeFile(join(root, "src", "z.ts"), "const z = true;\n");
  await writeFile(join(root, "src", "a.ts"), "const a = true;\n");
  await writeFile(join(root, "src", "skip.ts"), "const skip = true;\n");
  await writeFile(join(root, "src", "notes.txt"), "notes\n");
  await writeFile(join(root, "dist", "generated.ts"), "const generated = true;\n");
  await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

  assert.deepEqual(await listIncludedFiles(root, { excludePaths: ["src/skip.ts"] }), ["src/a.ts", "src/z.ts"]);
});

test("keeps dot-prefixed excludes repo-relative when cwd differs from root", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-scan-root-"));
  await execFileAsync("git", ["init"], { cwd: root });
  await mkdir(join(root, ".codecharter"), { recursive: true });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, ".codecharter", "config.js"), "export const generated = true;\n");
  await writeFile(join(root, "src", "app.js"), "export const app = true;\n");

  const previousCwd = process.cwd();
  try {
    process.chdir(tmpdir());
    assert.deepEqual(await listIncludedFiles(root, {
      excludePaths: ["./.codecharter/config.js"],
    }), ["src/app.js"]);
  } finally {
    process.chdir(previousCwd);
  }
});

test("excludes directory descendants without excluding similarly prefixed files", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-scan-dir-exclude-"));
  await execFileAsync("git", ["init"], { cwd: root });
  await mkdir(join(root, "src", "generated"), { recursive: true });
  await writeFile(join(root, "src", "generated", "client.js"), "export const generated = true;\n");
  await writeFile(join(root, "src", "generated-client.js"), "export const handWritten = true;\n");
  await writeFile(join(root, "src", "app.js"), "export const app = true;\n");

  assert.deepEqual(await listIncludedFiles(root, {
    excludePaths: ["src/generated"],
  }), ["src/app.js", "src/generated-client.js"]);
});

test("generates a path-keyed map sidecar from gitignore-filtered code files", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-"));
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
  const appFile = required(codemap.files["src/app.ts"]);
  const wideFile = required(codemap.files["src/wide.ts"]);
  assert.equal(wideFile.weight > appFile.weight, true);
  assert.equal("tokenCount" in codemap.files["src/app.ts"], false);
  assert.equal("wordCount" in codemap.files["src/app.ts"], false);
  assert.equal(codemap.files["src/image.png"], undefined);
  assert.equal(codemap.files["dist/generated.ts"], undefined);
  assert.equal(codemap.files["codecharter.json"], undefined);
  assert.equal(codemap.files["pnpm-lock.yaml"], undefined);
  assert.equal(typeof codemap.files["src/app.ts"].geo.geohash, "string");
});

test("serializes folder children deterministically by name", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-child-order-"));
  await execFileAsync("git", ["init"], { cwd: root });
  await mkdir(join(root, "src", "z-folder"), { recursive: true });
  await mkdir(join(root, "src", "a-folder"), { recursive: true });
  await writeFile(join(root, "src", "z-file.ts"), "const z = true;\n");
  await writeFile(join(root, "src", "a-file.ts"), "const a = true;\n");
  await writeFile(join(root, "src", "z-folder", "index.ts"), "const zFolder = true;\n");
  await writeFile(join(root, "src", "a-folder", "index.ts"), "const aFolder = true;\n");

  const codemap = await generateCodemap({ root });

  const srcFolder = required(codemap.folders.src);
  assert.deepEqual(srcFolder.children.folders, ["src/a-folder", "src/z-folder"]);
  assert.deepEqual(srcFolder.children.files, ["src/a-file.ts", "src/z-file.ts"]);
});

test("stabilizes existing file addresses when new files are added", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-stable-"));
  await execFileAsync("git", ["init"], { cwd: root });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), "const a = 1;\nconst b = 2;\n");

  const first = await generateCodemap({ root });
  const previousApp = required(first.files["src/app.ts"]);
  const previousSrcGrowth = required(first.folders.src).growthArea;

  await writeFile(join(root, "src", "new-feature.ts"), "export const feature = true;\n");

  const second = await generateCodemap({ root, previousCodemap: first });

  const nextApp = required(second.files["src/app.ts"]);
  const newFeature = required(second.files["src/new-feature.ts"]);
  assert.deepEqual(nextApp.bounds, previousApp.bounds);
  assert.deepEqual(nextApp.geo, previousApp.geo);
  assert.ok(second.files["src/new-feature.ts"]);
  assert.equal(isInside(newFeature.bounds, previousSrcGrowth), true);
});

test("stabilizes existing districts while placing new nested folders in growth area", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-stable-nested-"));
  await execFileAsync("git", ["init"], { cwd: root });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), "const a = 1;\nconst b = 2;\n");

  const first = await generateCodemap({ root });
  const previousApp = required(first.files["src/app.ts"]);
  const previousSrc = required(first.folders.src);

  await mkdir(join(root, "src", "feature"), { recursive: true });
  await writeFile(join(root, "src", "feature", "new.ts"), "export const feature = true;\n");

  const second = await generateCodemap({ root, previousCodemap: first });
  const nextApp = required(second.files["src/app.ts"]);
  const nextSrc = required(second.folders.src);
  const featureFolder = required(second.folders["src/feature"]);
  const featureFile = required(second.files["src/feature/new.ts"]);

  assert.deepEqual(nextApp.bounds, previousApp.bounds);
  assert.deepEqual(nextApp.geo, previousApp.geo);
  assert.equal(isInside(featureFolder.bounds, previousSrc.growthArea), true);
  assert.equal(isInside(featureFile.bounds, featureFolder.bounds), true);
  assert.equal(typeof featureFolder.geo.geohash, "string");
  assert.equal(typeof featureFile.geo.geohash, "string");
  assert.notDeepEqual(nextSrc.growthArea, previousSrc.growthArea);
});

test("recompacts stale root layouts when ignored districts leave visible empty geography", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-stale-root-"));
  await execFileAsync("git", ["init"], { cwd: root });
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, ".agents", "skills", "local"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), "export const app = true;\n");
  await writeFile(
    join(root, ".agents", "skills", "local", "SKILL.md"),
    Array.from({ length: 500 }, (_, index) => `instruction_${index}: keep this stable`).join("\n"),
  );

  const first = await generateCodemap({ root });
  assert.ok(first.folders[".agents"]);

  await writeFile(join(root, ".gitignore"), ".agents/\n");
  const second = await generateCodemap({ root, previousCodemap: first });

  assert.equal(second.folders[".agents"], undefined);
  assert.notDeepEqual(required(second.folders.src).bounds, required(first.folders.src).bounds);
  assert.ok(rootChildOccupancy(second) > 0.75);
});

test("does not anchor a district map to an obsolete projection", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-projection-"));
  await execFileAsync("git", ["init"], { cwd: root });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), "const a = 1;\n");
  const obsoleteBounds = { x: 0, y: 0, width: 1, height: 1 };

  const codemap = await generateCodemap({
    root,
    previousCodemap: {
      projection: { type: "filesystem-treemap" },
      folders: {
        src: { bounds: obsoleteBounds, geo: { geohash: "old", lat: 0, lon: 0 }, growthArea: obsoleteBounds },
      },
      files: {
        "src/app.ts": { bounds: obsoleteBounds, geo: { geohash: "old", lat: 0, lon: 0 } },
      },
    },
  });

  assert.equal(codemap.projection.type, "filesystem-district-map");
  assert.notDeepEqual(required(codemap.files["src/app.ts"]).bounds, obsoleteBounds);
});

test("does not anchor when the district layout algorithm changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-order-"));
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
        src: { bounds: obsoleteBounds, geo: { geohash: "old", lat: 0, lon: 0 }, growthArea: obsoleteBounds },
      },
      files: {
        "src/app.ts": { bounds: obsoleteBounds, geo: { geohash: "old", lat: 0, lon: 0 } },
      },
    },
  });

  assert.equal(codemap.projection.mapOrder, "bounded-weight-binary-districts-folders-first");
  assert.equal(codemap.projection.layoutVersion, 3);
  assert.notDeepEqual(required(codemap.files["src/app.ts"]).bounds, obsoleteBounds);
});

function isInside(bounds: Bounds, container: Bounds) {
  return bounds.x >= container.x
    && bounds.y >= container.y
    && bounds.x + bounds.width <= container.x + container.width
    && bounds.y + bounds.height <= container.y + container.height;
}

function rootChildOccupancy(codemap: GeneratedCodemap) {
  const root = required(codemap.folders[""]);
  const rootArea = area(root.bounds);
  let childArea = 0;
  for (const path of root.children.folders) childArea += area(required(codemap.folders[path]).bounds);
  for (const path of root.children.files) childArea += area(required(codemap.files[path]).bounds);
  return childArea / rootArea;
}

function area(bounds: Bounds) {
  return bounds.width * bounds.height;
}

function required<T>(value: T | null | undefined): T {
  assert.ok(value);
  return value;
}
