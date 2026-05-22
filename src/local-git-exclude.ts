import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const CODECHARTER_GITIGNORE_PATTERNS: readonly string[] = [
  ".codecharter/",
  "codecharter.json",
  "codemap.json",
];

export const LOCAL_CODECHARTER_EXCLUDES: readonly string[] = [
  ".codecharter/",
  "codecharter.json",
  "codemap.json",
];

export type IgnoreFileResult = {
  skipped: boolean;
  patternsAdded: string[];
};

export async function ensureCodecharterGitignore(
  root: string,
  patterns: readonly string[] = CODECHARTER_GITIGNORE_PATTERNS,
): Promise<IgnoreFileResult> {
  return ensureIgnoreFile(join(root, ".gitignore"), patterns);
}

export async function ensureLocalGitExcludes(
  root: string,
  patterns: readonly string[] = LOCAL_CODECHARTER_EXCLUDES,
): Promise<IgnoreFileResult> {
  const excludePath = await localGitExcludePath(root);
  if (!excludePath) return { skipped: true, patternsAdded: [] };
  return ensureIgnoreFile(excludePath, patterns);
}

async function ensureIgnoreFile(path: string, patterns: readonly string[]): Promise<IgnoreFileResult> {
  let current = "";
  try {
    current = await readFile(path, "utf8");
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ENOENT") throw error;
  }

  const existing = ignorePatterns(current);
  const missing: string[] = [];
  for (const pattern of patterns) {
    if (!existing.has(pattern)) missing.push(pattern);
  }
  if (missing.length === 0) return { skipped: false, patternsAdded: [] };

  await mkdir(dirname(path), { recursive: true });
  const separator = current.length === 0 || current.endsWith("\n") ? "" : "\n";
  await writeFile(path, `${current}${separator}${missing.join("\n")}\n`);
  return { skipped: false, patternsAdded: missing };
}

function ignorePatterns(content: string): Set<string> {
  const patterns = new Set<string>();
  let start = 0;
  for (let index = 0; index <= content.length; index += 1) {
    if (index < content.length && content[index] !== "\n") continue;
    const line = content.slice(start, content[index - 1] === "\r" ? index - 1 : index).trim();
    if (line) patterns.add(line);
    start = index + 1;
  }
  return patterns;
}

async function localGitExcludePath(root: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: root });
    const path = stdout.trim();
    if (!path) return null;
    return isAbsolute(path) ? path : join(root, path);
  } catch {
    return null;
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
