export class UnifiedDiffChangeRangeParser {
  lineRange(diff: string): LineRange {
    return lineRangeFromUnifiedDiff(diff);
  }

  changedRange(diff: string): ChangedRange {
    return changedRangeFromUnifiedDiff(diff);
  }

  changedHunkRange(startRaw: string, countRaw?: string): HunkRange {
    return changedHunkRange(startRaw, countRaw);
  }

  tokenFragments(diff: string): TokenFragment[] {
    return tokenFragments(diff);
  }

  columnSpanFromFragments(fragments: TokenFragment[]): ColumnSpan | null {
    return columnSpanFromFragments(fragments);
  }

  tokenColumnSpan(line: string): ColumnSpan | null {
    return tokenColumnSpan(line);
  }
}

export type LineRange = {
  lineStart?: number;
  lineEnd?: number;
};

export type TokenFragment = {
  lineStart: number;
  lineEnd: number;
  columnStart: number;
  columnEnd: number;
};

export type ChangedRange = LineRange & {
  columnStart?: number;
  columnEnd?: number;
  fragments?: TokenFragment[];
};

type HunkRange = {
  start: number;
  end: number;
};

type ColumnSpan = {
  start: number;
  end: number;
};

export function lineRangeFromUnifiedDiff(diff: string): LineRange {
  const range = changedRangeFromUnifiedDiff(diff);
  if (range.lineStart === undefined) return {};
  return {
    lineStart: range.lineStart,
    ...(range.lineEnd === undefined ? {} : { lineEnd: range.lineEnd }),
  };
}

export function changedRangeFromUnifiedDiff(diff: string): ChangedRange {
  let lineStart = Number.POSITIVE_INFINITY;
  let lineEnd = Number.NEGATIVE_INFINITY;
  let matchedHunks = 0;
  for (const match of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = match[1];
    if (start === undefined) continue;
    const range = changedHunkRange(start, match[2]);
    lineStart = Math.min(lineStart, range.start);
    lineEnd = Math.max(lineEnd, range.end);
    matchedHunks += 1;
  }

  if (matchedHunks === 0) return {};
  const fragments = tokenFragments(diff);
  const tokenSpan = columnSpanFromFragments(fragments);
  return {
    lineStart,
    lineEnd,
    ...(tokenSpan ? {
      columnStart: tokenSpan.start,
      columnEnd: tokenSpan.end,
    } : {}),
    ...(fragments.length ? { fragments } : {}),
  };
}

function changedHunkRange(startRaw: string, countRaw?: string): HunkRange {
  const hunkStart = Number(startRaw);
  const count = countRaw === undefined ? 1 : Number(countRaw);
  const start = count === 0 ? Math.max(1, hunkStart + 1) : hunkStart;
  return {
    start,
    end: start + Math.max(1, count) - 1,
  };
}

function tokenFragments(diff: string): TokenFragment[] {
  const fragments: TokenFragment[] = [];
  let nextLine: number | null = null;

  for (const rawLine of diffLines(diff)) {
    const hunk = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      nextLine = Number(hunk[1]);
      continue;
    }
    if (nextLine === null) continue;
    if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
      const span = tokenColumnSpan(rawLine.slice(1));
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

function* diffLines(diff: string): Generator<string> {
  let start = 0;
  for (let index = 0; index <= diff.length; index += 1) {
    if (index < diff.length && diff[index] !== "\n") continue;
    yield diff.slice(start, diff[index - 1] === "\r" ? index - 1 : index);
    start = index + 1;
  }
}

function columnSpanFromFragments(fragments: TokenFragment[]): ColumnSpan | null {
  if (!fragments.length) return null;
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const fragment of fragments) {
    start = Math.min(start, fragment.columnStart);
    end = Math.max(end, fragment.columnEnd);
  }
  return {
    start,
    end,
  };
}

function tokenColumnSpan(line: string): ColumnSpan | null {
  if (line.length === 0) return null;
  const pattern = /[A-Za-z_$][A-Za-z0-9_$]*|\d+(?:\.\d+)?|[^\s]/g;
  let match: RegExpExecArray | null;
  let minColumn = Infinity;
  let maxColumn = 0;
  while ((match = pattern.exec(line))) {
    minColumn = Math.min(minColumn, match.index + 1);
    maxColumn = Math.max(maxColumn, match.index + match[0].length);
  }
  if (Number.isFinite(minColumn)) return { start: minColumn, end: maxColumn };
  return { start: 1, end: line.length };
}
