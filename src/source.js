import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function readSourceRange(root, file, { lineStart = 1, lineEnd } = {}) {
  const start = normalizeLine(lineStart, file.lineCount);
  const end = normalizeLine(lineEnd ?? Math.min(file.lineCount, start + 80), file.lineCount);
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  const content = await readFile(join(root, file.path), "utf8");
  const lines = content.split(/\r?\n/);

  return {
    path: file.path,
    lineCount: file.lineCount,
    lineRange: { start: low, end: high },
    lines: lines.slice(low - 1, high).map((text, index) => ({
      number: low + index,
      text,
    })),
  };
}

function normalizeLine(value, lineCount) {
  const line = Number(value);
  if (!Number.isInteger(line)) throw new Error(`Line must be an integer: ${value}`);
  return Math.min(lineCount, Math.max(1, line));
}
