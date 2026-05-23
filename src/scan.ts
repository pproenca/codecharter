import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative } from "node:path";
import { execFileText } from "./exec-file.ts";
import { isCodeFile } from "./extensions.ts";
import { compareStrings, mapConcurrent, sortIfNeeded } from "./util.ts";
import type { ScannedFile } from "./tree.js";
const DEFAULT_EXCLUDED_FILES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);
const DEFAULT_SCAN_CONCURRENCY = 32;

export type ScanOptions = {
  excludePaths?: string[];
  scanConcurrency?: number;
};

export async function listIncludedFiles(root: string, { excludePaths = [] }: ScanOptions = {}): Promise<string[]> {
  const excluded = excludePaths.map((path) => normalizeExcludedPath(root, path));
  const { stdout } = await execFileText("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    maxBuffer: 10 * 1024 * 1024,
  });

  const paths: string[] = [];
  for (const line of stdout.split("\n")) {
    const path = line.trim();
    if (shouldIncludePath(path, excluded)) paths.push(path);
  }
  return sortIfNeeded(paths, compareStrings);
}

function shouldIncludePath(path: string, excluded: string[]): boolean {
  return Boolean(path)
    && !isExcludedPath(path, excluded)
    && !DEFAULT_EXCLUDED_FILES.has(path)
    && isCodeFile(path);
}

function isExcludedPath(path: string, excluded: string[]): boolean {
  return excluded.some((excludedPath) => path === excludedPath || path.startsWith(`${excludedPath}/`));
}

export async function scanCodeFiles(root: string, options: ScanOptions = {}): Promise<ScannedFile[]> {
  const paths = await listIncludedFiles(root, options);
  return scanPaths(root, paths, options.scanConcurrency ?? DEFAULT_SCAN_CONCURRENCY);
}

export function normalizeRepoPath(root: string, path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (isAbsolute(path)) return relative(root, path).replaceAll("\\", "/");
  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}

function normalizeExcludedPath(root: string, path: string): string {
  return normalizeRepoPath(root, path).replace(/\/+$/, "");
}

function contentMetrics(content: string): Pick<ScannedFile, "lineCount" | "maxLineLength" | "tokenCount"> {
  const { lineCount, maxLineLength } = lineMetrics(content);
  return {
    lineCount,
    maxLineLength,
    tokenCount: Math.max(1, countMatches(content, TOKEN_PATTERN)),
  };
}

async function scanPaths(root: string, paths: string[], concurrency: number): Promise<ScannedFile[]> {
  return mapConcurrent(paths, concurrency || DEFAULT_SCAN_CONCURRENCY, (path) => scanPath(root, path));
}

async function scanPath(root: string, path: string): Promise<ScannedFile> {
  const content = await readFile(join(root, path), "utf8");
  return {
    path,
    extension: extname(path).toLowerCase(),
    ...contentMetrics(content),
  };
}

function lineMetrics(content: string): Pick<ScannedFile, "lineCount" | "maxLineLength"> {
  if (content.length === 0) return { lineCount: 1, maxLineLength: 1 };
  let lineCount = 1;
  let maxLineLength = 1;
  let currentLineLength = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      maxLineLength = Math.max(maxLineLength, currentLineLength);
      currentLineLength = 0;
      if (index !== content.length - 1) lineCount += 1;
    } else {
      currentLineLength += 1;
    }
  }
  if (!content.endsWith("\n")) maxLineLength = Math.max(maxLineLength, currentLineLength);
  return {
    lineCount,
    maxLineLength,
  };
}

const TOKEN_PATTERN = /[A-Za-z_$][A-Za-z0-9_$]*|\d+(?:\.\d+)?|[^\s]/g;

function countMatches(content: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  let count = 0;
  while (pattern.exec(content)) count += 1;
  return count;
}
