import test from "node:test";
import assert from "node:assert/strict";

import { mapRouteTarget, mapSearchMatch } from "../main/render/targets.ts";
import type { CodecharterCodemap, NamedPlace } from "../main/render/types.ts";

const codemap: CodecharterCodemap = {
  files: {
    "src/app.ts": {
      path: "src/app.ts",
      name: "app.ts",
      geo: { geohash: "s123" },
      bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    },
  },
  folders: {
    "": {
      path: "",
      name: "root",
      geo: { geohash: "s" },
      bounds: { x: 0, y: 0, width: 1, height: 1 },
    },
    src: {
      path: "src",
      name: "src",
      geo: { geohash: "s1" },
      bounds: { x: 0.05, y: 0.05, width: 0.4, height: 0.4 },
    },
    docs: {
      path: "docs",
      name: "docs",
      geo: { geohash: "d1" },
      bounds: { x: 0.5, y: 0.5, width: 0.2, height: 0.2 },
    },
  },
};

const namedPlaces: NamedPlace[] = [
  {
    id: "annotation-1",
    kind: "mapAnnotation",
    name: "Render hotspot",
    geometry: { bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
  },
  {
    id: "place-1",
    kind: "drawnSelection",
    name: "Saved area",
    geometry: { bounds: { x: 0.3, y: 0.3, width: 0.2, height: 0.2 } },
  },
];

test("mapSearchMatch returns discriminated payloads with their required targets", () => {
  const annotation = mapSearchMatch(codemap, namedPlaces, "render");
  assert.equal(annotation?.type, "annotation");
  assert.equal(annotation.place.id, "annotation-1");
  assert.equal(annotation.target.targetType, "annotation");

  const namedPlace = mapSearchMatch(codemap, namedPlaces, "saved");
  assert.equal(namedPlace?.type, "namedPlace");
  assert.equal(namedPlace.place.id, "place-1");
  assert.equal(namedPlace.target, null);

  const file = mapSearchMatch(codemap, namedPlaces, "app.ts");
  assert.equal(file?.type, "file");
  assert.equal(file.file.path, "src/app.ts");

  const folder = mapSearchMatch(codemap, namedPlaces, "docs");
  assert.equal(folder?.type, "folder");
  assert.equal(folder.folder.path, "docs");
});

test("mapRouteTarget resolves paths and geohash prefixes without synthetic root-folder hits", () => {
  assert.equal(mapRouteTarget(codemap, {
    type: "map",
    kind: "file",
    locator: "s123",
    params: new URLSearchParams("path=src/app.ts"),
  })?.targetType, "file");

  assert.deepEqual(mapRouteTarget(codemap, {
    type: "map",
    kind: "folder",
    locator: "s",
    params: new URLSearchParams(),
  }), { ...codemap.folders?.src, targetType: "folder" });

  assert.deepEqual(mapRouteTarget(codemap, {
    type: "map",
    kind: "file",
    locator: "s12345",
    params: new URLSearchParams(),
  }), { ...codemap.files?.["src/app.ts"], targetType: "file" });
});
