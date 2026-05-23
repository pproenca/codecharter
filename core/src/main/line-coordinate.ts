/**
 * Map a code range (lines/columns/fragments) to a sub-rectangle of a file's box,
 * and the inverse (a drawn selection → line/column indices).
 *
 * Implements **BR-011** (line/column range → bounds) and **BR-012** (selection
 * ratio → 1-based index with the `1e-12` edge epsilon). Arithmetic preserved
 * byte-for-byte. The legacy `CodeRangeGeometryMapper` wrapper class was test-only
 * scaffolding and is dropped.
 */

import { round } from "./math.ts";
import type { Bounds } from "./geometry.ts";

const EDGE_EPSILON = 1e-12;

type CodeFileGeometry = {
  bounds: Bounds;
  lineCount: number;
  maxLineLength?: number;
};

export type NormalizedRange = {
  start: number;
  end: number;
};

export type CodeRangeFragmentRequest = {
  lineStart?: number | string;
  lineEnd?: number | string;
  columnStart?: number | string;
  columnEnd?: number | string;
};

export type CodeRangeRequest = CodeRangeFragmentRequest & {
  fragments?: CodeRangeFragmentRequest[];
};

export type CodeRangeSelectionRequest = {
  lineStart: number;
  lineEnd: number;
  columnStart?: number;
  columnEnd?: number;
};

export type CodeRangeFragmentGeometry = {
  lineRange: NormalizedRange;
  tokenRange?: NormalizedRange;
  bounds: Bounds;
};

export type CodeRangeGeometry = {
  lineRange: NormalizedRange;
  tokenRange?: NormalizedRange;
  bounds: Bounds;
  anchorBounds: Bounds;
  fragments?: CodeRangeFragmentGeometry[];
  hasTokenFragments: boolean;
};

/** Resolve a code-range request into bounds + line/token ranges + per-fragment geometry. */
export function codeRangeGeometry(file: CodeFileGeometry, request: CodeRangeRequest): CodeRangeGeometry {
  const lineRange = lineRangeForRequest(file, request);
  const lineBounds = lineRangeBounds(file, lineRange);
  const tokenRange = tokenRangeForRequest(file, request);
  const fragments = fragmentGeometries(file, request.fragments);
  const bounds = fragments.length
    ? unionBounds(fragments.map((fragment) => fragment.bounds))
    : tokenRange ? tokenBounds(file, lineBounds, tokenRange) : lineBounds;

  return {
    lineRange,
    bounds,
    anchorBounds: fragments[0]?.bounds ?? bounds,
    ...(tokenRange ? { tokenRange } : {}),
    ...(fragments.length ? { fragments } : {}),
    hasTokenFragments: fragments.some((fragment) => fragment.tokenRange),
  };
}

/** Inverse: a drawn selection rectangle → a 1-based line (and optional column) request. */
export function codeRangeRequestForSelection(
  file: CodeFileGeometry,
  selectionBounds: Bounds,
  targetMode?: string,
): CodeRangeSelectionRequest {
  const lineRange = lineRangeForSelection(file, selectionBounds);
  const tokenRange = targetMode === "tokenRange" ? tokenRangeForSelection(file, selectionBounds) : {};
  return {
    lineStart: lineRange.start,
    lineEnd: lineRange.end,
    ...tokenRange,
  };
}

function lineRangeForRequest(file: CodeFileGeometry, request: CodeRangeFragmentRequest): NormalizedRange {
  const lineStart = normalizeLine(request.lineStart ?? request.lineEnd, file.lineCount);
  const lineEnd = normalizeLine(request.lineEnd ?? request.lineStart, file.lineCount);
  return normalizeRange(lineStart, lineEnd);
}

function tokenRangeForRequest(file: CodeFileGeometry, request: CodeRangeFragmentRequest): NormalizedRange | null {
  if (request.columnStart === undefined && request.columnEnd === undefined) return null;
  const width = Math.max(1, file.maxLineLength ?? 1);
  const columnStart = normalizeColumn(request.columnStart ?? request.columnEnd, width);
  const columnEnd = normalizeColumn(request.columnEnd ?? request.columnStart, width);
  return normalizeRange(columnStart, columnEnd);
}

function fragmentGeometries(
  file: CodeFileGeometry,
  fragments: CodeRangeFragmentRequest[] | undefined,
): CodeRangeFragmentGeometry[] {
  if (!Array.isArray(fragments)) return [];
  const geometries: CodeRangeFragmentGeometry[] = [];
  for (const fragment of fragments) {
    const geometry = fragmentGeometry(file, fragment);
    if (geometry) geometries.push(geometry);
  }
  return geometries;
}

function fragmentGeometry(file: CodeFileGeometry, fragment: CodeRangeFragmentRequest | undefined): CodeRangeFragmentGeometry | null {
  if (fragment?.lineStart === undefined && fragment?.lineEnd === undefined) return null;
  const lineRange = lineRangeForRequest(file, fragment);
  const lineBounds = lineRangeBounds(file, lineRange);
  const tokenRange = tokenRangeForRequest(file, fragment);
  const bounds = tokenRange ? tokenBounds(file, lineBounds, tokenRange) : lineBounds;
  return {
    lineRange,
    ...(tokenRange ? { tokenRange } : {}),
    bounds,
  };
}

function lineRangeBounds(file: CodeFileGeometry, lineRange: NormalizedRange): Bounds {
  const startRatio = (lineRange.start - 1) / file.lineCount;
  const endRatio = lineRange.end / file.lineCount;
  return {
    x: file.bounds.x,
    y: round(file.bounds.y + file.bounds.height * startRatio),
    width: file.bounds.width,
    height: round(file.bounds.height * Math.max(endRatio - startRatio, 1 / file.lineCount)),
  };
}

function tokenBounds(file: CodeFileGeometry, lineBounds: Bounds, tokenRange: NormalizedRange): Bounds {
  const width = Math.max(1, file.maxLineLength ?? 1);
  const startRatio = (tokenRange.start - 1) / width;
  const endRatio = tokenRange.end / width;
  return {
    x: round(file.bounds.x + file.bounds.width * startRatio),
    y: lineBounds.y,
    width: round(file.bounds.width * Math.max(endRatio - startRatio, 1 / width)),
    height: lineBounds.height,
  };
}

function lineRangeForSelection(file: CodeFileGeometry, selectionBounds: Bounds): NormalizedRange {
  const top = clampRatio((selectionBounds.y - file.bounds.y) / file.bounds.height);
  const bottom = clampRatio((selectionBounds.y + selectionBounds.height - file.bounds.y) / file.bounds.height);
  const lineCount = Math.max(1, file.lineCount ?? 1);
  const start = startIndexForRatio(top, lineCount);
  const end = Math.max(start, endIndexForRatio(bottom, lineCount));
  return { start, end };
}

function tokenRangeForSelection(file: CodeFileGeometry, selectionBounds: Bounds): { columnStart: number; columnEnd: number } {
  const left = clampRatio((selectionBounds.x - file.bounds.x) / file.bounds.width);
  const right = clampRatio((selectionBounds.x + selectionBounds.width - file.bounds.x) / file.bounds.width);
  const maxLineLength = Math.max(1, file.maxLineLength ?? 1);
  const columnStart = startIndexForRatio(left, maxLineLength);
  const columnEnd = Math.max(columnStart, endIndexForRatio(right, maxLineLength));
  return { columnStart, columnEnd };
}

function unionBounds(boundsList: Bounds[]): Bounds {
  let x1 = Number.POSITIVE_INFINITY;
  let y1 = Number.POSITIVE_INFINITY;
  let x2 = Number.NEGATIVE_INFINITY;
  let y2 = Number.NEGATIVE_INFINITY;
  for (const bounds of boundsList) {
    x1 = Math.min(x1, bounds.x);
    y1 = Math.min(y1, bounds.y);
    x2 = Math.max(x2, bounds.x + bounds.width);
    y2 = Math.max(y2, bounds.y + bounds.height);
  }
  return {
    x: round(x1),
    y: round(y1),
    width: round(x2 - x1),
    height: round(y2 - y1),
  };
}

function normalizeRange(left: number, right: number): NormalizedRange {
  return {
    start: Math.min(left, right),
    end: Math.max(left, right),
  };
}

function normalizeLine(value: number | string | undefined, lineCount: number): number {
  const line = Number(value);
  if (!Number.isInteger(line)) throw new Error(`Line must be an integer: ${value}`);
  return Math.min(lineCount, Math.max(1, line));
}

function normalizeColumn(value: number | string | undefined, maxLineLength: number): number {
  const column = Number(value);
  if (!Number.isInteger(column)) throw new Error(`Column must be an integer: ${value}`);
  return Math.min(maxLineLength, Math.max(1, column));
}

function startIndexForRatio(ratio: number, size: number): number {
  return Math.min(size, Math.floor(ratio * size + EDGE_EPSILON) + 1);
}

function endIndexForRatio(ratio: number, size: number): number {
  return Math.min(size, Math.max(1, Math.ceil(ratio * size - EDGE_EPSILON)));
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
