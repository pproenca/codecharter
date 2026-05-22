import { readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isCodeFile } from "./extensions.js";

const execFileAsync = promisify(execFile);
const DEFAULT_EXCLUDED_FILES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

export async function listIncludedFiles(root, { excludePaths = [] } = {}) {
  const excluded = new Set(excludePaths.map((path) => normalizeRepoPath(root, path)));
  const { stdout } = await execFileAsync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    maxBuffer: 10 * 1024 * 1024,
  });

  return stdout
    .split("\n")
    .map((path) => path.trim())
    .filter(Boolean)
    .filter((path) => !excluded.has(path))
    .filter((path) => !DEFAULT_EXCLUDED_FILES.has(path))
    .filter(isCodeFile)
    .sort((a, b) => a.localeCompare(b));
}

export async function scanCodeFiles(root, options = {}) {
  const paths = await listIncludedFiles(root, options);
  return Promise.all(paths.map(async (path) => {
    const content = await readFile(join(root, path), "utf8");
    return {
      path,
      extension: extname(path).toLowerCase(),
      ...contentMetrics(content),
    };
  }));
}

export function normalizeRepoPath(root, path) {
  const normalized = path.replaceAll("\\", "/");
  if (!normalized.startsWith("/") && !normalized.startsWith(".")) return normalized;
  return relative(root, path).replaceAll("\\", "/");
}

function contentMetrics(content) {
  const { lineCount, maxLineLength } = lineMetrics(content);
  return {
    lineCount,
    maxLineLength,
    tokenCount: Math.max(1, countMatches(content, TOKEN_PATTERN)),
  };
}

function lineMetrics(content) {
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

function countMatches(content, pattern) {
  pattern.lastIndex = 0;
  let count = 0;
  while (pattern.exec(content)) count += 1;
  return count;
}
