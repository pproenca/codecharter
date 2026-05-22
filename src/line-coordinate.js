const EDGE_EPSILON = 1e-12;

export class CodeRangeGeometryMapper {
  geometry(file, request) {
    return codeRangeGeometry(file, request);
  }

  requestForSelection(file, selectionBounds, targetMode) {
    return codeRangeRequestForSelection(file, selectionBounds, targetMode);
  }

  lineRangeForRequest(file, request) {
    return lineRangeForRequest(file, request);
  }

  tokenRangeForRequest(file, request) {
    return tokenRangeForRequest(file, request);
  }

  fragmentGeometries(file, fragments) {
    return fragmentGeometries(file, fragments);
  }

  fragmentGeometry(file, fragment) {
    return fragmentGeometry(file, fragment);
  }

  lineRangeBounds(file, lineRange) {
    return lineRangeBounds(file, lineRange);
  }

  tokenBounds(file, lineBounds, tokenRange) {
    return tokenBounds(file, lineBounds, tokenRange);
  }

  lineRangeForSelection(file, selectionBounds) {
    return lineRangeForSelection(file, selectionBounds);
  }

  tokenRangeForSelection(file, selectionBounds) {
    return tokenRangeForSelection(file, selectionBounds);
  }

  unionBounds(boundsList) {
    return unionBounds(boundsList);
  }

  normalizeRange(left, right) {
    return normalizeRange(left, right);
  }

  normalizeLine(value, lineCount) {
    return normalizeLine(value, lineCount);
  }

  normalizeColumn(value, maxLineLength) {
    return normalizeColumn(value, maxLineLength);
  }
}

export function codeRangeGeometry(file, request) {
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

export function codeRangeRequestForSelection(file, selectionBounds, targetMode) {
  const lineRange = lineRangeForSelection(file, selectionBounds);
  const tokenRange = targetMode === "tokenRange" ? tokenRangeForSelection(file, selectionBounds) : {};
  return {
    lineStart: lineRange.start,
    lineEnd: lineRange.end,
    ...tokenRange,
  };
}

function lineRangeForRequest(file, request) {
  const lineStart = normalizeLine(request.lineStart ?? request.lineEnd, file.lineCount);
  const lineEnd = normalizeLine(request.lineEnd ?? request.lineStart, file.lineCount);
  return normalizeRange(lineStart, lineEnd);
}

function tokenRangeForRequest(file, request) {
  if (request.columnStart === undefined && request.columnEnd === undefined) return null;
  const width = Math.max(1, file.maxLineLength ?? 1);
  const columnStart = normalizeColumn(request.columnStart ?? request.columnEnd, width);
  const columnEnd = normalizeColumn(request.columnEnd ?? request.columnStart, width);
  return normalizeRange(columnStart, columnEnd);
}

function fragmentGeometries(file, fragments) {
  if (!Array.isArray(fragments)) return [];
  return fragments
    .map((fragment) => fragmentGeometry(file, fragment))
    .filter(Boolean);
}

function fragmentGeometry(file, fragment) {
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

function lineRangeBounds(file, lineRange) {
  const startRatio = (lineRange.start - 1) / file.lineCount;
  const endRatio = lineRange.end / file.lineCount;
  return {
    x: file.bounds.x,
    y: round(file.bounds.y + file.bounds.height * startRatio),
    width: file.bounds.width,
    height: round(file.bounds.height * Math.max(endRatio - startRatio, 1 / file.lineCount)),
  };
}

function tokenBounds(file, lineBounds, tokenRange) {
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

function lineRangeForSelection(file, selectionBounds) {
  const top = clampRatio((selectionBounds.y - file.bounds.y) / file.bounds.height);
  const bottom = clampRatio((selectionBounds.y + selectionBounds.height - file.bounds.y) / file.bounds.height);
  const lineCount = Math.max(1, file.lineCount ?? 1);
  const start = startIndexForRatio(top, lineCount);
  const end = Math.max(start, endIndexForRatio(bottom, lineCount));
  return { start, end };
}

function tokenRangeForSelection(file, selectionBounds) {
  const left = clampRatio((selectionBounds.x - file.bounds.x) / file.bounds.width);
  const right = clampRatio((selectionBounds.x + selectionBounds.width - file.bounds.x) / file.bounds.width);
  const maxLineLength = Math.max(1, file.maxLineLength ?? 1);
  const columnStart = startIndexForRatio(left, maxLineLength);
  const columnEnd = Math.max(columnStart, endIndexForRatio(right, maxLineLength));
  return { columnStart, columnEnd };
}

function unionBounds(boundsList) {
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

function normalizeRange(left, right) {
  return {
    start: Math.min(left, right),
    end: Math.max(left, right),
  };
}

function normalizeLine(value, lineCount) {
  const line = Number(value);
  if (!Number.isInteger(line)) throw new Error(`Line must be an integer: ${value}`);
  return Math.min(lineCount, Math.max(1, line));
}

function normalizeColumn(value, maxLineLength) {
  const column = Number(value);
  if (!Number.isInteger(column)) throw new Error(`Column must be an integer: ${value}`);
  return Math.min(maxLineLength, Math.max(1, column));
}

function startIndexForRatio(ratio, size) {
  return Math.min(size, Math.floor(ratio * size + EDGE_EPSILON) + 1);
}

function endIndexForRatio(ratio, size) {
  return Math.min(size, Math.max(1, Math.ceil(ratio * size - EDGE_EPSILON)));
}

function clampRatio(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value) {
  return Number(value.toFixed(12));
}
