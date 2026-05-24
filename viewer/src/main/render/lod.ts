import {
  LANDMARK_NAMES,
  ORGANIC_REGION_EDGE_POSITIONS,
  SOURCE_TEXT_MIN_LINE_HEIGHT,
  SOURCE_TEXT_MIN_WIDTH,
} from "./constants.ts";
import {
  clamp,
  hashUnit,
  lastPathSegment,
  objectValues,
  paletteForPath,
  rgba,
  sortIfNeeded,
} from "./primitives.ts";
/**
 * Level-of-detail and parcel/district styling (BR-019). Decides, for a given
 * camera scale and on-screen box, which folders, files, labels, source text,
 * and organic region outlines are drawn, and how they are coloured.
 */
import type {
  BoxSize,
  MapFile,
  MapFolder,
  OrganicRegionEdge,
  Point,
  Bounds,
  CodecharterCodemap,
  DetailBand,
} from "./types.ts";

const ORGANIC_REGION_EDGES: readonly OrganicRegionEdge[] = [
  [
    "top",
    false,
    (bounds, t, inset) => ({ x: bounds.x + bounds.width * t, y: bounds.y + bounds.height * inset }),
  ],
  [
    "right",
    false,
    (bounds, t, inset) => ({
      x: bounds.x + bounds.width * (1 - inset),
      y: bounds.y + bounds.height * t,
    }),
  ],
  [
    "bottom",
    true,
    (bounds, t, inset) => ({
      x: bounds.x + bounds.width * t,
      y: bounds.y + bounds.height * (1 - inset),
    }),
  ],
  [
    "left",
    true,
    (bounds, t, inset) => ({ x: bounds.x + bounds.width * inset, y: bounds.y + bounds.height * t }),
  ],
];

export function detailBand(scale: number): DetailBand {
  if (scale < 1.35) {
    return "district";
  }
  if (scale < 2.4) {
    return "neighborhood";
  }
  if (scale < 4.5) {
    return "block";
  }
  if (scale < 10) {
    return "parcel";
  }
  return "source";
}

export function maxFolderDepthForScale(scale: number): number {
  const band = detailBand(scale);
  if (band === "district") {
    return 1;
  }
  if (band === "neighborhood") {
    return 2;
  }
  if (band === "block") {
    return 3;
  }
  return 99;
}

export function folderDepth(path: string): number {
  return path ? path.split("/").length : 0;
}

export function organicRegionFolders(codemap: CodecharterCodemap) {
  const folders = [...objectValues(codemap.folders ?? {})]
    .filter((folder) => folder.path)
    .map((folder) => ({ folder, depth: folderDepth(folder.path ?? "") }));
  return sortIfNeeded(folders, compareOrganicRegionFolders);
}

function compareOrganicRegionFolders(
  a: { folder: MapFolder; depth: number },
  b: { folder: MapFolder; depth: number },
): number {
  return a.depth - b.depth || a.folder.path.localeCompare(b.folder.path);
}

export function folderStyle(path: string, depth: number) {
  const base = paletteForPath(path);
  const fillAlpha = depth === 1 ? 0.18 : 0.09;
  const strokeAlpha = depth === 1 ? 0.52 : 0.28;
  return {
    fill: rgba(base.fill, fillAlpha),
    stroke: rgba(base.stroke, strokeAlpha),
    label: base.label,
  };
}

export function organicRegionStyle(path: string, depth: number) {
  const base = paletteForPath(path);
  const fillAlpha = depth === 1 ? 0.1 : 0.055;
  const strokeAlpha = depth === 1 ? 0.5 : 0.32;
  return {
    fill: rgba(base.fill, fillAlpha),
    stroke: rgba(base.stroke, strokeAlpha),
  };
}

export function shouldDrawOrganicRegion(scale: number, depth: number, box: BoxSize): boolean {
  if (depth > 4) {
    return false;
  }
  if (depth > maxFolderDepthForScale(scale) + 1) {
    return false;
  }
  if (Math.min(box.width, box.height) < 68) {
    return false;
  }
  return box.width * box.height >= 7200;
}

export function organicRegionPoints(
  bounds: Bounds | null | undefined,
  key: string,
  depth = 1,
): Point[] {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return [];
  }
  const edgePositions = ORGANIC_REGION_EDGE_POSITIONS;
  const minInset = 0.018;
  const baseInset = clamp(0.024 + depth * 0.004, minInset, 0.058);
  const wobble = clamp(0.018 - depth * 0.002, 0.006, 0.018);
  const points: Point[] = [];

  for (const [side, reversed, point] of ORGANIC_REGION_EDGES) {
    if (reversed) {
      for (let index = edgePositions.length - 1; index >= 0; index -= 1) {
        const t = edgePositions[index];
        if (t === undefined) {
          continue;
        }
        points.push(point(bounds, t, edgeInset(key, side, index, baseInset, wobble)));
      }
      continue;
    }

    for (let index = 0; index < edgePositions.length; index += 1) {
      const t = edgePositions[index];
      if (t === undefined) {
        continue;
      }
      points.push(point(bounds, t, edgeInset(key, side, index, baseInset, wobble)));
    }
  }

  return points;
}

export function shouldDrawFolder(scale: number, depth: number, box: BoxSize): boolean {
  const minDimension = Math.min(box.width, box.height);
  if (minDimension < (depth <= 1 ? 6 : 10)) {
    return false;
  }
  if (depth <= maxFolderDepthForScale(scale)) {
    return true;
  }
  return depth <= 3 && box.width > 360 && box.height > 220;
}

export function shouldLabelFolder(scale: number, depth: number, box: BoxSize): boolean {
  if (box.width <= 90 || box.height <= 28) {
    return false;
  }
  return depth <= maxFolderDepthForScale(scale) || (box.width > 260 && box.height > 120);
}

export function folderLabelPriority(depth: number, box: BoxSize): number {
  return 80 - depth * 6 + Math.min(16, Math.log2(Math.max(1, box.width * box.height)));
}

export function landmarkScore(file: Pick<MapFile, "name" | "path">): number {
  let score = 0;
  const name = file.name ?? lastPathSegment(file.path);
  if (LANDMARK_NAMES.has(name)) {
    score += 24;
  }
  if (file.path.startsWith("src/")) {
    score += 8;
  }
  if (file.path.startsWith("public/")) {
    score += 6;
  }
  if (file.path.includes("test")) {
    score += 4;
  }
  if (name.endsWith(".test.js")) {
    score += 5;
  }
  return score;
}

export function fileVisualState({
  file,
  box,
  scale,
  selected,
}: {
  file: MapFile;
  box: BoxSize;
  scale: number;
  selected?: boolean;
}) {
  const landmark = landmarkScore(file) > 0 && box.width > 76 && box.height > 26;
  const readable = canRenderSourceText(file, box);
  const area = box.width * box.height;
  const shapedParcel = box.width >= 12 && box.height >= 10 && area >= 240;
  const clearParcel = box.width >= 42 && box.height >= 16 && area >= 780;
  const visibleParcel =
    selected || readable || landmark || clearParcel || (scale > 2.2 && shapedParcel);

  if (!visibleParcel) {
    return "hidden";
  }
  if (readable) {
    return "source";
  }
  if (selected) {
    return "selected";
  }
  if (landmark) {
    return "landmark";
  }
  if (!clearParcel) {
    return "aggregate";
  }
  return "parcel";
}

export function shouldLabelFile({
  file,
  box,
  scale,
  selected,
}: {
  file: MapFile;
  box: BoxSize;
  scale: number;
  selected?: boolean;
}) {
  if (canRenderSourceText(file, box)) {
    return false;
  }
  if (selected) {
    return true;
  }
  if (landmarkScore(file) > 0 && box.width > 76 && box.height > 26) {
    return true;
  }
  return scale > 2.2 && box.width > 78 && box.height > 24;
}

export function fileLabelPriority({ file, selected }: { file: MapFile; selected?: boolean }) {
  return (selected ? 120 : 40) + landmarkScore(file);
}

export function canRenderSourceText(file: MapFile, box: BoxSize): boolean {
  return (
    box.width >= SOURCE_TEXT_MIN_WIDTH &&
    lineHeightForFile(file, box) >= SOURCE_TEXT_MIN_LINE_HEIGHT &&
    (file.lineCount ?? 0) > 0
  );
}

export function lineHeightForFile(file: MapFile, box: BoxSize): number {
  return box.height / Math.max(1, file.lineCount ?? 0);
}

function edgeInset(
  key: string,
  edge: string,
  index: number,
  baseInset: number,
  wobble: number,
): number {
  const unit = hashUnit(`${key}:${edge}:${index}`);
  return clamp(baseInset + (unit - 0.5) * wobble, 0.012, 0.08);
}
