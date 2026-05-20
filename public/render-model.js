export const SOURCE_TEXT_MIN_LINE_HEIGHT = 14;
export const SOURCE_TEXT_MIN_WIDTH = 260;
export const SOURCE_TEXT_MAX_LINES_PER_FRAME = 200;
export const SOURCE_TEXT_PREFETCH_LINES = 12;
export const SOURCE_CACHE_LIMIT = 80;
export const SOURCE_TEXT_ZOOM_HEADROOM = 1.08;
export const SOURCE_PANEL_CONTEXT_BEFORE = 12;
export const SOURCE_PANEL_CONTEXT_AFTER = 24;
export const SOURCE_PANEL_MAX_LINES = 140;

export const DISTRICT_PALETTE = [
  { fill: [126, 176, 156], stroke: [41, 98, 73], label: "#24513d" },
  { fill: [111, 162, 190], stroke: [39, 92, 122], label: "#244e66" },
  { fill: [188, 154, 92], stroke: [126, 89, 34], label: "#6f4f1f" },
  { fill: [176, 128, 137], stroke: [118, 65, 77], label: "#6f3d49" },
  { fill: [126, 151, 117], stroke: [68, 101, 55], label: "#3f5d34" },
];

const LANDMARK_NAMES = new Set([
  "AGENTS.md",
  "CONTEXT.md",
  "README.md",
  "package.json",
  "app.js",
  "index.html",
  "server.js",
]);

export function detailBand(scale) {
  if (scale < 1.35) return "district";
  if (scale < 2.4) return "neighborhood";
  if (scale < 4.5) return "block";
  if (scale < 10) return "parcel";
  return "source";
}

export function maxFolderDepthForScale(scale) {
  const band = detailBand(scale);
  if (band === "district") return 1;
  if (band === "neighborhood") return 2;
  if (band === "block") return 3;
  return 99;
}

export function folderDepth(path) {
  return path ? path.split("/").length : 0;
}

export function folderStyle(path, depth) {
  const base = DISTRICT_PALETTE[hashString(path.split("/")[0]) % DISTRICT_PALETTE.length];
  const fillAlpha = depth === 1 ? 0.18 : 0.09;
  const strokeAlpha = depth === 1 ? 0.52 : 0.28;
  return {
    fill: rgba(base.fill, fillAlpha),
    stroke: rgba(base.stroke, strokeAlpha),
    label: base.label,
  };
}

export function shouldDrawFolder(scale, depth, box) {
  const minDimension = Math.min(box.width, box.height);
  if (minDimension < (depth <= 1 ? 6 : 10)) return false;
  if (depth <= maxFolderDepthForScale(scale)) return true;
  return depth <= 3 && box.width > 360 && box.height > 220;
}

export function shouldLabelFolder(scale, depth, box) {
  if (box.width <= 90 || box.height <= 28) return false;
  return depth <= maxFolderDepthForScale(scale) || (box.width > 260 && box.height > 120);
}

export function folderLabelPriority(depth, box) {
  return 80 - depth * 6 + Math.min(16, Math.log2(Math.max(1, box.width * box.height)));
}

export function landmarkScore(file) {
  let score = 0;
  if (LANDMARK_NAMES.has(file.name)) score += 24;
  if (file.path.startsWith("src/")) score += 8;
  if (file.path.startsWith("public/")) score += 6;
  if (file.path.includes("test")) score += 4;
  if (file.name.endsWith(".test.js")) score += 5;
  return score;
}

export function fileVisualState({ file, box, scale, selected }) {
  const landmark = landmarkScore(file) > 0 && box.width > 76 && box.height > 26;
  const readable = canRenderSourceText(file, box);
  const area = box.width * box.height;
  const shapedParcel = box.width >= 12 && box.height >= 10 && area >= 240;
  const clearParcel = box.width >= 42 && box.height >= 16 && area >= 780;
  const visibleParcel = selected
    || readable
    || landmark
    || clearParcel
    || (scale > 2.2 && shapedParcel);

  if (!visibleParcel) return "hidden";
  if (readable) return "source";
  if (selected) return "selected";
  if (landmark) return "landmark";
  if (!clearParcel) return "aggregate";
  return "parcel";
}

export function shouldLabelFile({ file, box, scale, selected }) {
  if (canRenderSourceText(file, box)) return false;
  if (selected) return true;
  if (landmarkScore(file) > 0 && box.width > 76 && box.height > 26) return true;
  return scale > 2.2 && box.width > 78 && box.height > 24;
}

export function fileLabelPriority({ file, selected }) {
  return (selected ? 120 : 40) + landmarkScore(file);
}

export function shouldDrawAggregateHint({ scale, depth, box, childCount }) {
  if (childCount < 4) return false;
  if (box.width < 110 || box.height < 42) return false;
  return depth >= maxFolderDepthForScale(scale) || detailBand(scale) !== "source";
}

export function aggregateLabel(folder) {
  const fileCount = folder.children?.files?.length ?? 0;
  const folderCount = folder.children?.folders?.length ?? 0;
  if (fileCount > 0 && folderCount > 0) return `${fileCount} files, ${folderCount} folders`;
  if (fileCount > 0) return `${fileCount} files`;
  return `${folderCount} folders`;
}

export function canRenderSourceText(file, box) {
  return box.width >= SOURCE_TEXT_MIN_WIDTH
    && lineHeightForFile(file, box) >= SOURCE_TEXT_MIN_LINE_HEIGHT
    && file.lineCount > 0;
}

export function lineHeightForFile(file, box) {
  return box.height / Math.max(1, file.lineCount);
}

export function labelBoxesOverlap(a, b) {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

export function rgba(rgb, alpha) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

export function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
