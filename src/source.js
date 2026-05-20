import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";

export async function readSourceRange(root, file, { lineStart = 1, lineEnd } = {}) {
  const start = normalizeLine(lineStart, file.lineCount);
  const end = normalizeLine(lineEnd ?? Math.min(file.lineCount, start + 80), file.lineCount);
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  const lines = await readLines(join(root, file.path), low, high);

  return {
    path: file.path,
    lineCount: file.lineCount,
    lineRange: { start: low, end: high },
    lines,
  };
}

async function readLines(path, low, high) {
  const stream = createReadStream(path, { encoding: "utf8" });
  const reader = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });
  const lines = [];
  let number = 0;

  try {
    for await (const text of reader) {
      number += 1;
      if (number < low) continue;
      if (number > high) break;
      lines.push({ number, text });
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  return lines;
}

function normalizeLine(value, lineCount) {
  const line = Number(value);
  if (!Number.isInteger(line)) throw new Error(`Line must be an integer: ${value}`);
  return Math.min(lineCount, Math.max(1, line));
}
