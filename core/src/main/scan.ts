/**
 * Repository scanner — the eligible-file list and per-file metrics that feed the
 * map.
 *
 * Implements **BR-006** (token/line/max-line metrics), **BR-021** (extension
 * allowlist via `extensions`), **BR-022** (lockfile exclusion), **BR-023/024**
 * (`git ls-files` gitignore-aware inclusion; no size cap / no binary detection —
 * preserved as the documented BR-024 gap).
 *
 * The internal `normalizeRepoPath` is module-private (it had no external caller).
 */

import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative } from "node:path";
import { compareStrings, mapConcurrent, sortIfNeeded } from "./collections.ts";
import { execFileText } from "./exec-file.ts";
import { isCodeFile } from "./extensions.ts";
import type { ScannedFile } from "./tree.ts";

const DEFAULT_EXCLUDED_FILES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);
const DEFAULT_SCAN_CONCURRENCY = 32;
const TOKEN_PATTERN = /[A-Za-z_$][A-Za-z0-9_$]*|\d+(?:\.\d+)?|[^\s]/g;

export type ScanOptions = {
  excludePaths?: string[];
  scanConcurrency?: number;
};

/** List repo-relative code files git knows about, minus excludes/lockfiles, sorted. */
export async function listIncludedFiles(
  root: string,
  { excludePaths = [] }: ScanOptions = {},
): Promise<string[]> {
  const excluded = excludePaths.map((path) => normalizeRepoPath(root, path).replace(/\/+$/, ""));
  const { stdout } = await execFileText(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    {
      cwd: root,
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  const paths: string[] = [];
  for (const line of stdout.split("\n")) {
    const path = line.trim();
    if (
      path &&
      !excluded.some(
        (excludedPath) => path === excludedPath || path.startsWith(`${excludedPath}/`),
      ) &&
      !DEFAULT_EXCLUDED_FILES.has(path) &&
      isCodeFile(path)
    ) {
      paths.push(path);
    }
  }
  return sortIfNeeded(paths, compareStrings);
}

/** Scan every included file, computing its metrics (parallel, order-preserving). */
export async function scanCodeFiles(
  root: string,
  options: ScanOptions = {},
): Promise<ScannedFile[]> {
  const paths = await listIncludedFiles(root, options);
  return mapConcurrent(paths, options.scanConcurrency || DEFAULT_SCAN_CONCURRENCY, (path) =>
    scanPath(root, path),
  );
}

async function scanPath(root: string, path: string): Promise<ScannedFile> {
  const content = await readFile(join(root, path), "utf8");
  const { lineCount, maxLineLength } = lineMetrics(content);
  return {
    path,
    extension: extname(path).toLowerCase(),
    lineCount,
    maxLineLength,
    tokenCount: Math.max(1, countMatches(content, TOKEN_PATTERN)),
  };
}

function normalizeRepoPath(root: string, path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (isAbsolute(path)) {
    return relative(root, path).replaceAll("\\", "/");
  }
  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}

function lineMetrics(content: string): Pick<ScannedFile, "lineCount" | "maxLineLength"> {
  if (content.length === 0) {
    return { lineCount: 1, maxLineLength: 1 };
  }
  let lineCount = 1;
  let maxLineLength = 1;
  let currentLineLength = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      maxLineLength = Math.max(maxLineLength, currentLineLength);
      currentLineLength = 0;
      if (index !== content.length - 1) {
        lineCount += 1;
      }
    } else {
      currentLineLength += 1;
    }
  }
  if (!content.endsWith("\n")) {
    maxLineLength = Math.max(maxLineLength, currentLineLength);
  }
  return { lineCount, maxLineLength };
}

function countMatches(content: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  let count = 0;
  while (pattern.test(content)) {
    count += 1;
  }
  return count;
}
