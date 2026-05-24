/**
 * Manage codecharter's ignore patterns in `.gitignore` and `.git/info/exclude`
 * (part of **BR-054** setup idempotency): append the patterns only if absent.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { isErrnoException } from "./errors.ts";
import { execFileText } from "./exec-file.ts";

export const CODECHARTER_GITIGNORE_PATTERNS: readonly string[] = [
  ".codecharter/",
  "codecharter.json",
  "codemap.json",
];

export const LOCAL_CODECHARTER_EXCLUDES: readonly string[] = CODECHARTER_GITIGNORE_PATTERNS;

export type IgnoreFileResult = {
  skipped: boolean;
  patternsAdded: string[];
};

/** Ensure the patterns exist in the repo's `.gitignore`. */
export async function ensureCodecharterGitignore(
  root: string,
  patterns: readonly string[] = CODECHARTER_GITIGNORE_PATTERNS,
): Promise<IgnoreFileResult> {
  return ensureIgnoreFile(join(root, ".gitignore"), patterns);
}

/** Ensure the patterns exist in the repo's local `.git/info/exclude` (skipped if not a repo). */
export async function ensureLocalGitExcludes(
  root: string,
  patterns: readonly string[] = LOCAL_CODECHARTER_EXCLUDES,
): Promise<IgnoreFileResult> {
  const excludePath = await localGitExcludePath(root);
  if (!excludePath) {
    return { skipped: true, patternsAdded: [] };
  }
  return ensureIgnoreFile(excludePath, patterns);
}

async function ensureIgnoreFile(
  path: string,
  patterns: readonly string[],
): Promise<IgnoreFileResult> {
  let current = "";
  try {
    current = await readFile(path, "utf8");
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  const existing = new Set(
    current
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const missing = patterns.filter((pattern) => !existing.has(pattern));
  if (missing.length === 0) {
    return { skipped: false, patternsAdded: [] };
  }

  await mkdir(dirname(path), { recursive: true });
  const separator = current.length === 0 || current.endsWith("\n") ? "" : "\n";
  await writeFile(path, `${current}${separator}${missing.join("\n")}\n`);
  return { skipped: false, patternsAdded: missing };
}

async function localGitExcludePath(root: string): Promise<string | null> {
  try {
    const { stdout } = await execFileText("git", ["rev-parse", "--git-path", "info/exclude"], {
      cwd: root,
    });
    const path = stdout.trim();
    if (!path) {
      return null;
    }
    return isAbsolute(path) ? path : join(root, path);
  } catch {
    return null;
  }
}
