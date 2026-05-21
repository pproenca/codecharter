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
  const files = [];

  for (const path of paths) {
    const content = await readFile(join(root, path), "utf8");
    const metrics = contentMetrics(content);
    files.push({
      path,
      extension: extname(path).toLowerCase(),
      ...metrics,
    });
  }

  return files;
}

export function normalizeRepoPath(root, path) {
  const normalized = path.replaceAll("\\", "/");
  if (!normalized.startsWith("/") && !normalized.startsWith(".")) return normalized;
  return relative(root, path).replaceAll("\\", "/");
}

function contentMetrics(content) {
  const lines = content.length === 0 ? [""] : content.split("\n");
  if (content.endsWith("\n")) lines.pop();
  return {
    lineCount: Math.max(1, lines.length),
    maxLineLength: Math.max(1, ...lines.map((line) => line.length)),
    tokenCount: Math.max(1, countMatches(content, TOKEN_PATTERN)),
  };
}

const TOKEN_PATTERN = /[A-Za-z_$][A-Za-z0-9_$]*|\d+(?:\.\d+)?|[^\s]/g;

function countMatches(content, pattern) {
  return content.match(pattern)?.length ?? 0;
}
