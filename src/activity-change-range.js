export class UnifiedDiffChangeRangeParser {
  lineRange(diff) {
    const range = this.changedRange(diff);
    if (range.lineStart === undefined) return {};
    return {
      lineStart: range.lineStart,
      lineEnd: range.lineEnd,
    };
  }

  changedRange(diff) {
    const ranges = [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)]
      .map((match) => this.changedHunkRange(match[1], match[2]));

    if (ranges.length === 0) return {};
    const fragments = this.tokenFragments(diff);
    const tokenSpan = this.columnSpanFromFragments(fragments);
    return {
      lineStart: Math.min(...ranges.map((range) => range.start)),
      lineEnd: Math.max(...ranges.map((range) => range.end)),
      ...(tokenSpan ? {
        columnStart: tokenSpan.start,
        columnEnd: tokenSpan.end,
      } : {}),
      ...(fragments.length ? { fragments } : {}),
    };
  }

  changedHunkRange(startRaw, countRaw) {
    const hunkStart = Number(startRaw);
    const count = countRaw === undefined ? 1 : Number(countRaw);
    const start = count === 0 ? Math.max(1, hunkStart + 1) : hunkStart;
    return {
      start,
      end: start + Math.max(1, count) - 1,
    };
  }

  tokenFragments(diff) {
    const fragments = [];
    let nextLine = null;

    for (const rawLine of diff.split("\n")) {
      const hunk = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (hunk) {
        nextLine = Number(hunk[1]);
        continue;
      }
      if (nextLine === null) continue;
      if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
        const span = this.tokenColumnSpan(rawLine.slice(1));
        if (span) {
          fragments.push({
            lineStart: nextLine,
            lineEnd: nextLine,
            columnStart: span.start,
            columnEnd: span.end,
          });
        }
        nextLine += 1;
      } else if (!rawLine.startsWith("-")) {
        nextLine += 1;
      }
    }

    return fragments;
  }

  columnSpanFromFragments(fragments) {
    if (!fragments.length) return null;
    return {
      start: Math.min(...fragments.map((fragment) => fragment.columnStart)),
      end: Math.max(...fragments.map((fragment) => fragment.columnEnd)),
    };
  }

  tokenColumnSpan(line) {
    if (line.length === 0) return null;
    const pattern = /[A-Za-z_$][A-Za-z0-9_$]*|\d+(?:\.\d+)?|[^\s]/g;
    let match;
    let minColumn = Infinity;
    let maxColumn = 0;
    while ((match = pattern.exec(line))) {
      minColumn = Math.min(minColumn, match.index + 1);
      maxColumn = Math.max(maxColumn, match.index + match[0].length);
    }
    if (Number.isFinite(minColumn)) return { start: minColumn, end: maxColumn };
    return { start: 1, end: line.length };
  }
}

const UNIFIED_DIFF_CHANGE_RANGE_PARSER = new UnifiedDiffChangeRangeParser();

export function lineRangeFromUnifiedDiff(diff) {
  return UNIFIED_DIFF_CHANGE_RANGE_PARSER.lineRange(diff);
}

export function changedRangeFromUnifiedDiff(diff) {
  return UNIFIED_DIFF_CHANGE_RANGE_PARSER.changedRange(diff);
}
