const EDGE_EPSILON = 1e-12;

export class CodeRangeGeometryMapper {
  geometry(file, request) {
    const lineRange = this.lineRangeForRequest(file, request);
    const lineBounds = this.lineRangeBounds(file, lineRange);
    const tokenRange = this.tokenRangeForRequest(file, request);
    const fragments = this.fragmentGeometries(file, request.fragments);
    const bounds = fragments.length
      ? this.unionBounds(fragments.map((fragment) => fragment.bounds))
      : tokenRange ? this.tokenBounds(file, lineBounds, tokenRange) : lineBounds;

    return {
      lineRange,
      bounds,
      anchorBounds: fragments[0]?.bounds ?? bounds,
      ...(tokenRange ? { tokenRange } : {}),
      ...(fragments.length ? { fragments } : {}),
      hasTokenFragments: fragments.some((fragment) => fragment.tokenRange),
    };
  }

  requestForSelection(file, selectionBounds, targetMode) {
    const lineRange = this.lineRangeForSelection(file, selectionBounds);
    const tokenRange = targetMode === "tokenRange" ? this.tokenRangeForSelection(file, selectionBounds) : {};
    return {
      lineStart: lineRange.start,
      lineEnd: lineRange.end,
      ...tokenRange,
    };
  }

  lineRangeForRequest(file, request) {
    const lineStart = this.normalizeLine(request.lineStart ?? request.lineEnd, file.lineCount);
    const lineEnd = this.normalizeLine(request.lineEnd ?? request.lineStart, file.lineCount);
    return this.normalizeRange(lineStart, lineEnd);
  }

  tokenRangeForRequest(file, request) {
    if (request.columnStart === undefined && request.columnEnd === undefined) return null;
    const width = Math.max(1, file.maxLineLength ?? 1);
    const columnStart = this.normalizeColumn(request.columnStart ?? request.columnEnd, width);
    const columnEnd = this.normalizeColumn(request.columnEnd ?? request.columnStart, width);
    return this.normalizeRange(columnStart, columnEnd);
  }

  fragmentGeometries(file, fragments) {
    if (!Array.isArray(fragments)) return [];
    return fragments
      .map((fragment) => this.fragmentGeometry(file, fragment))
      .filter(Boolean);
  }

  fragmentGeometry(file, fragment) {
    if (fragment?.lineStart === undefined && fragment?.lineEnd === undefined) return null;
    const lineRange = this.lineRangeForRequest(file, fragment);
    const lineBounds = this.lineRangeBounds(file, lineRange);
    const tokenRange = this.tokenRangeForRequest(file, fragment);
    const bounds = tokenRange ? this.tokenBounds(file, lineBounds, tokenRange) : lineBounds;
    return {
      lineRange,
      ...(tokenRange ? { tokenRange } : {}),
      bounds,
    };
  }

  lineRangeBounds(file, lineRange) {
    const startRatio = (lineRange.start - 1) / file.lineCount;
    const endRatio = lineRange.end / file.lineCount;
    return {
      x: file.bounds.x,
      y: round(file.bounds.y + file.bounds.height * startRatio),
      width: file.bounds.width,
      height: round(file.bounds.height * Math.max(endRatio - startRatio, 1 / file.lineCount)),
    };
  }

  tokenBounds(file, lineBounds, tokenRange) {
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

  lineRangeForSelection(file, selectionBounds) {
    const top = clampRatio((selectionBounds.y - file.bounds.y) / file.bounds.height);
    const bottom = clampRatio((selectionBounds.y + selectionBounds.height - file.bounds.y) / file.bounds.height);
    const lineCount = Math.max(1, file.lineCount ?? 1);
    const start = startIndexForRatio(top, lineCount);
    const end = Math.max(start, endIndexForRatio(bottom, lineCount));
    return { start, end };
  }

  tokenRangeForSelection(file, selectionBounds) {
    const left = clampRatio((selectionBounds.x - file.bounds.x) / file.bounds.width);
    const right = clampRatio((selectionBounds.x + selectionBounds.width - file.bounds.x) / file.bounds.width);
    const maxLineLength = Math.max(1, file.maxLineLength ?? 1);
    const columnStart = startIndexForRatio(left, maxLineLength);
    const columnEnd = Math.max(columnStart, endIndexForRatio(right, maxLineLength));
    return { columnStart, columnEnd };
  }

  unionBounds(boundsList) {
    const x1 = Math.min(...boundsList.map((bounds) => bounds.x));
    const y1 = Math.min(...boundsList.map((bounds) => bounds.y));
    const x2 = Math.max(...boundsList.map((bounds) => bounds.x + bounds.width));
    const y2 = Math.max(...boundsList.map((bounds) => bounds.y + bounds.height));
    return {
      x: round(x1),
      y: round(y1),
      width: round(x2 - x1),
      height: round(y2 - y1),
    };
  }

  normalizeRange(left, right) {
    return {
      start: Math.min(left, right),
      end: Math.max(left, right),
    };
  }

  normalizeLine(value, lineCount) {
    const line = Number(value);
    if (!Number.isInteger(line)) throw new Error(`Line must be an integer: ${value}`);
    return Math.min(lineCount, Math.max(1, line));
  }

  normalizeColumn(value, maxLineLength) {
    const column = Number(value);
    if (!Number.isInteger(column)) throw new Error(`Column must be an integer: ${value}`);
    return Math.min(maxLineLength, Math.max(1, column));
  }
}

const CODE_RANGE_GEOMETRY_MAPPER = new CodeRangeGeometryMapper();

export function codeRangeGeometry(file, request) {
  return CODE_RANGE_GEOMETRY_MAPPER.geometry(file, request);
}

export function codeRangeRequestForSelection(file, selectionBounds, targetMode) {
  return CODE_RANGE_GEOMETRY_MAPPER.requestForSelection(file, selectionBounds, targetMode);
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
