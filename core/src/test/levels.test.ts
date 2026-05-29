import assert from "node:assert/strict";
/**
 * P0 Behavior Contract — Map Levels (BR-LEVELS-001..003).
 *
 * Pins the canonical level -> geohash-precision table and the precision
 * resolver so a refactor cannot silently shift a zoom level's address
 * granularity. Values characterize the current implementation in
 * `../main/levels.ts`.
 *
 * Note on BR-LEVELS-003 (Open Question OQ-2): `precisionForLevel` currently
 * rejects an unknown level via a falsy `!precision` guard rather than a
 * membership check. These tests assert only the *observable* contract
 * (a genuinely unknown level throws with a stable message); they intentionally
 * do not freeze the falsy-vs-membership internal mechanism, which is pending
 * SME confirmation before Phase 1 ships.
 */
import test from "node:test";
import { FULL_GEOHASH_PRECISION, MAP_LEVELS, precisionForLevel } from "../main/levels.ts";
import type { MapLevel } from "../main/levels.ts";

// ---------------------------------------------------------------------------
// BR-LEVELS-001 — canonical level -> precision table, frozen
// ---------------------------------------------------------------------------

test("BR-LEVELS-001 maps each level to its canonical precision", () => {
  assert.deepEqual(
    { ...MAP_LEVELS },
    {
      world: 1,
      region: 2,
      folder: 4,
      file: 7,
      code: 10,
      lineRange: 12,
      tokenRange: 12,
    },
  );
});

test("BR-LEVELS-001 precision is monotonically non-decreasing from world to token", () => {
  const order: MapLevel[] = [
    "world",
    "region",
    "folder",
    "file",
    "code",
    "lineRange",
    "tokenRange",
  ];
  for (let index = 1; index < order.length; index += 1) {
    assert.ok(
      MAP_LEVELS[order[index]!] >= MAP_LEVELS[order[index - 1]!],
      `${order[index]} precision must be >= ${order[index - 1]}`,
    );
  }
});

test("BR-LEVELS-001 the level table is frozen (contract is immutable)", () => {
  assert.ok(Object.isFrozen(MAP_LEVELS));
});

// ---------------------------------------------------------------------------
// BR-LEVELS-002 — lineRange and tokenRange share precision 12
// ---------------------------------------------------------------------------

test("BR-LEVELS-002 lineRange and tokenRange resolve to the same precision (12)", () => {
  assert.equal(MAP_LEVELS.lineRange, 12);
  assert.equal(MAP_LEVELS.tokenRange, 12);
  assert.equal(precisionForLevel("lineRange"), precisionForLevel("tokenRange"));
});

test("BR-LEVELS-002 FULL_GEOHASH_PRECISION equals the lineRange precision (12)", () => {
  assert.equal(FULL_GEOHASH_PRECISION, 12);
  assert.equal(FULL_GEOHASH_PRECISION, MAP_LEVELS.lineRange);
});

// ---------------------------------------------------------------------------
// BR-LEVELS-003 — precisionForLevel resolves known levels, rejects unknown
// ---------------------------------------------------------------------------

test("BR-LEVELS-003 resolves every known level to its table precision", () => {
  for (const level of Object.keys(MAP_LEVELS) as MapLevel[]) {
    assert.equal(precisionForLevel(level), MAP_LEVELS[level]);
  }
});

test("BR-LEVELS-003 rejects an unknown level with a stable message", () => {
  assert.throws(() => precisionForLevel("galaxy" as MapLevel), {
    message: "Unknown map level: galaxy",
  });
  assert.throws(() => precisionForLevel("" as MapLevel), {
    message: "Unknown map level: ",
  });
});
