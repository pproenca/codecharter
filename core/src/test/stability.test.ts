import assert from "node:assert/strict";
/**
 * Behavior contract — Stable address preservation (BR-STABILITY-001/002/005).
 *
 * Stable coordinates are the whole point of the Map Sidecar, so these drive the
 * REAL generator end-to-end (scan -> layout -> stabilize -> serialize) against a
 * throwaway git repo and prove:
 *   - matched paths keep their exact bounds + geohash when a previous layout is
 *     reused (BR-STABILITY-002);
 *   - reuse only happens when the Projection Contract matches (BR-STABILITY-001);
 *   - omitting the previous layout ("--fresh") produces a fresh, deterministic
 *     layout that ignores any stored coordinates (BR-STABILITY-005).
 *
 * Renames are treated as delete + add (the moved path is a new node; the old
 * path's address is not carried over) — a documented limitation, asserted in
 * `stability.rename` below.
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { generateCodemap } from "../main/generator.ts";
import type { GeneratedCodemap } from "../main/generator.ts";

async function makeRepo(
  t: { after: (fn: () => unknown) => void },
  files: Record<string, string>,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codecharter-stability-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  await writeFiles(root, files);
  return root;
}

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [relPath, content] of Object.entries(files)) {
    const absPath = join(root, relPath);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, content);
  }
}

const SAMPLE = {
  "src/a.ts": "export const a = 1;\nexport const aa = 2;\n",
  "src/b.ts": "export const b = 1;\nexport const bb = 2;\nexport const bbb = 3;\n",
};

// ---------------------------------------------------------------------------
// BR-STABILITY-005 — fresh generation is deterministic and previous-free
// ---------------------------------------------------------------------------

test("BR-STABILITY-005 fresh generation is byte-deterministic for identical input", async (t) => {
  const root = await makeRepo(t, SAMPLE);
  const first = await generateCodemap({ root });
  const second = await generateCodemap({ root });
  assert.deepEqual(second, first);
});

// ---------------------------------------------------------------------------
// BR-STABILITY-002 — matched paths keep exact bounds + geohash on reuse
// ---------------------------------------------------------------------------

test("BR-STABILITY-002 reused layout preserves a matched file's pinned bounds + geohash", async (t) => {
  const root = await makeRepo(t, SAMPLE);
  const first = await generateCodemap({ root });

  // Pin src/a.ts to a distinct position (keep width/height so root occupancy is
  // unchanged and the sparse-root heuristic does not reject reuse).
  const pinned = structuredClone(first) as GeneratedCodemap;
  const pinnedBounds = { ...pinned.files["src/a.ts"]!.bounds, x: 0.123_456, y: 0.234_567 };
  pinned.files["src/a.ts"]!.bounds = pinnedBounds;
  const pinnedGeohash = "s00000000000";
  pinned.files["src/a.ts"]!.geo = { lat: 0, lon: 0, geohash: pinnedGeohash };

  const reused = await generateCodemap({ root, previousCodemap: pinned });
  assert.deepEqual(reused.files["src/a.ts"]!.bounds, pinnedBounds);
  assert.equal(reused.files["src/a.ts"]!.geo.geohash, pinnedGeohash);
});

test("BR-STABILITY-002 a newly added file appears with its own address while old ones stay put", async (t) => {
  const root = await makeRepo(t, SAMPLE);
  const first = await generateCodemap({ root });

  await writeFiles(root, { "src/c.ts": "export const c = 1;\n" });
  const second = await generateCodemap({ root, previousCodemap: first });

  assert.deepEqual(second.files["src/a.ts"]!.bounds, first.files["src/a.ts"]!.bounds);
  assert.deepEqual(second.files["src/b.ts"]!.bounds, first.files["src/b.ts"]!.bounds);
  assert.ok(second.files["src/c.ts"], "the new file should be on the map");
});

// ---------------------------------------------------------------------------
// BR-STABILITY-001 — Projection Contract gates coordinate reuse
// ---------------------------------------------------------------------------

test("BR-STABILITY-001 a mismatched projection version discards the previous coordinates", async (t) => {
  const root = await makeRepo(t, SAMPLE);
  const first = await generateCodemap({ root });

  const pinned = structuredClone(first) as GeneratedCodemap;
  const pinnedBounds = { ...pinned.files["src/a.ts"]!.bounds, x: 0.123_456, y: 0.234_567 };
  pinned.files["src/a.ts"]!.bounds = pinnedBounds;

  // Same projection -> coordinates honored.
  const reused = await generateCodemap({ root, previousCodemap: pinned });
  assert.deepEqual(reused.files["src/a.ts"]!.bounds, pinnedBounds);

  // Bump the layout version -> Projection Contract no longer matches -> fresh.
  const stale = structuredClone(pinned) as GeneratedCodemap;
  (stale.projection as { layoutVersion: number }).layoutVersion =
    pinned.projection.layoutVersion + 1;
  const fresh = await generateCodemap({ root, previousCodemap: stale });
  assert.notDeepEqual(fresh.files["src/a.ts"]!.bounds, pinnedBounds);
  assert.deepEqual(fresh.files["src/a.ts"]!.bounds, first.files["src/a.ts"]!.bounds);
});

// ---------------------------------------------------------------------------
// BR-STABILITY-004 — sparse-root reuse heuristic rejects an obsolete-heavy map
// ---------------------------------------------------------------------------

test("BR-STABILITY-004 a previous root dominated by deleted children forces a fresh layout", async (t) => {
  const root = await makeRepo(t, SAMPLE);
  const first = await generateCodemap({ root });

  const pinned = structuredClone(first) as GeneratedCodemap;
  const pinnedBounds = { ...pinned.files["src/a.ts"]!.bounds, x: 0.1, y: 0.1 };
  pinned.files["src/a.ts"]!.bounds = pinnedBounds;

  // Inject a large root-level child that no longer exists on disk so that the
  // obsolete root-child area exceeds the 0.18 threshold (MAX_OBSOLETE_ROOT_AREA).
  const rootBounds = pinned.folders[""]!.bounds;
  const rootArea = rootBounds.width * rootBounds.height;
  const side = Math.sqrt(rootArea * 0.3);
  const obsolete = structuredClone(pinned.folders["src"]!);
  obsolete.path = "deleted-huge";
  obsolete.bounds = { x: rootBounds.x, y: rootBounds.y, width: side, height: side };
  pinned.folders["deleted-huge"] = obsolete;
  pinned.folders[""]!.children.folders = [...pinned.folders[""]!.children.folders, "deleted-huge"];

  const regen = await generateCodemap({ root, previousCodemap: pinned });
  // reuse rejected -> a.ts is laid out fresh, NOT at the pinned slot
  assert.notDeepEqual(regen.files["src/a.ts"]!.bounds, pinnedBounds);
  assert.deepEqual(regen.files["src/a.ts"]!.bounds, first.files["src/a.ts"]!.bounds);
});

// ---------------------------------------------------------------------------
// BR-STABILITY-003 — renames are delete + add (documented limitation)
// ---------------------------------------------------------------------------

test("stability.rename a renamed file does NOT inherit the old path's address", async (t) => {
  const root = await makeRepo(t, SAMPLE);
  const first = await generateCodemap({ root });
  const originalBounds = first.files["src/a.ts"]!.bounds;

  // Rename src/a.ts -> src/renamed.ts, then regenerate against the old layout.
  await rm(join(root, "src/a.ts"), { force: true });
  await writeFiles(root, { "src/renamed.ts": SAMPLE["src/a.ts"] });
  const second = await generateCodemap({ root, previousCodemap: first });

  assert.equal(second.files["src/a.ts"], undefined, "old path is gone");
  assert.ok(second.files["src/renamed.ts"], "new path exists");
  // The new path is a fresh node; it is not guaranteed (and here does not) take
  // over the deleted path's exact slot. Pin current behavior: it is placed in
  // the parent growth area, not at the old address.
  assert.notDeepEqual(second.files["src/renamed.ts"]!.bounds, originalBounds);
});
