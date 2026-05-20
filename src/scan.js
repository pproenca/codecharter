import { readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isCodeFile } from "./extensions.js";

const execFileAsync = promisify(execFile);

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
    .filter(isCodeFile)
    .sort((a, b) => a.localeCompare(b));
}

export async function scanCodeFiles(root, options = {}) {
  const paths = await listIncludedFiles(root, options);
  const files = [];

  for (const path of paths) {
    const content = await readFile(join(root, path), "utf8");
    files.push({
      path,
      extension: extname(path).toLowerCase(),
      lineCount: countLines(content),
    });
  }

  return files;
}

export function normalizeRepoPath(root, path) {
  const normalized = path.replaceAll("\\", "/");
  if (!normalized.startsWith("/") && !normalized.startsWith(".")) return normalized;
  return relative(root, path).replaceAll("\\", "/");
}

function countLines(content) {
  if (content.length === 0) return 1;
  const matches = content.match(/\n/g);
  return (matches?.length ?? 0) + (content.endsWith("\n") ? 0 : 1);
}
