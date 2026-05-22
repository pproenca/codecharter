import test from "node:test";
import assert from "node:assert/strict";
import { DistrictLayoutEngine, layoutChildren } from "../src/district-layout.js";

test("places weighted district children deterministically by type, weight, and path", () => {
  const children = [
    file("src/small.ts", 4),
    folder("src/feature", 25, 2),
    file("src/large.ts", 100),
    folder("src/core", 49, 1),
  ];

  const result = layoutChildren(children, { x: 0, y: 0, width: 1, height: 1 }, { reserveGrowth: false });

  assert.deepEqual(result.growthArea, { x: 0.012, y: 0.012, width: 0.976, height: 0.976 });
  assert.deepEqual(boundsByPath(children), {
    "src/core": { x: 0.028, y: 0.028, width: 0.529861318474, height: 0.516408339148 },
    "src/feature": { x: 0.028, y: 0.552408339148, width: 0.529861318474, height: 0.419591660852 },
    "src/large.ts": { x: 0.565861318474, y: 0.028, width: 0.406138681526, height: 0.785333333333 },
    "src/small.ts": { x: 0.565861318474, y: 0.821333333333, width: 0.406138681526, height: 0.150666666667 },
  });
});

test("splits district layout entries into the closest balanced weight groups", () => {
  const first = { item: file("src/a.ts", 1), weight: 1 };
  const second = { item: file("src/b.ts", 1), weight: 1 };
  const third = { item: file("src/c.ts", 8), weight: 8 };

  const split = new DistrictLayoutEngine().splitEntries([first, second, third]);

  assert.deepEqual(split, {
    first: [first, second],
    second: [third],
  });
});

test("splits district layout entries at the earlier balanced point on ties", () => {
  const first = { item: file("src/a.ts", 2), weight: 2 };
  const second = { item: file("src/b.ts", 4), weight: 4 };
  const third = { item: file("src/c.ts", 2), weight: 2 };

  const split = new DistrictLayoutEngine().splitEntries([first, second, third]);

  assert.deepEqual(split, {
    first: [first],
    second: [second, third],
  });
});

function folder(path, weight, childCount = 0) {
  return {
    type: "folder",
    path,
    weight,
    lineCount: weight,
    folders: new Map(Array.from({ length: childCount }, (_, index) => [`folder-${index}`, {}])),
    files: new Map(),
  };
}

function file(path, weight) {
  return {
    type: "file",
    path,
    weight,
    lineCount: weight,
  };
}

function boundsByPath(children) {
  return Object.fromEntries(children.map((child) => [child.path, child.bounds]));
}
