/**
 * Stream a bounded line range from a source file for the viewer's source overlay.
 * Line numbers are clamped into the file (BR-039); when no end is given a default
 * window of 80 lines is read (BR-056).
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export type SourceFileReference = {
  path: string;
  lineCount: number;
};

export type SourceRangeOptions = {
  lineStart?: number;
  lineEnd?: number;
};

export type SourceLine = {
  number: number;
  text: string;
};

export type SourceRange = {
  path: string;
  lineCount: number;
  lineRange: { start: number; end: number };
  lines: SourceLine[];
};

export async function readSourceRange(
  absolutePath: string,
  file: SourceFileReference,
  { lineStart = 1, lineEnd }: SourceRangeOptions = {},
): Promise<SourceRange> {
  const start = normalizeLine(lineStart, file.lineCount);
  const end = normalizeLine(lineEnd ?? Math.min(file.lineCount, start + 80), file.lineCount);
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  // HARDENING (CWE-367): read the exact symlink-resolved path the caller already
  // validated; do not re-derive it here, or a swap between check and read could
  // escape root.
  const lines = await readLines(absolutePath, low, high);

  return {
    path: file.path,
    lineCount: file.lineCount,
    lineRange: { start: low, end: high },
    lines,
  };
}

async function readLines(path: string, low: number, high: number): Promise<SourceLine[]> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  const lines: SourceLine[] = [];
  let number = 0;

  try {
    for await (const text of reader) {
      number += 1;
      if (number < low) {
        continue;
      }
      if (number > high) {
        break;
      }
      lines.push({ number, text });
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  return lines;
}

function normalizeLine(value: number, lineCount: number): number {
  if (!Number.isInteger(value)) {
    throw new Error(`Line must be an integer: ${value}`);
  }
  return Math.min(lineCount, Math.max(1, value));
}
