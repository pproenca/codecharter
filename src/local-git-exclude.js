import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const CODECHARTER_GITIGNORE_PATTERNS = [
  ".codecharter/",
  "codecharter.json",
  "codemap.json",
];

export const LOCAL_CODECHARTER_EXCLUDES = [
  ".codecharter/",
  "codecharter.json",
  "codemap.json",
];

export async function ensureCodecharterGitignore(root, patterns = CODECHARTER_GITIGNORE_PATTERNS) {
  return ensureIgnoreFile(join(root, ".gitignore"), patterns);
}

export async function ensureLocalGitExcludes(root, patterns = LOCAL_CODECHARTER_EXCLUDES) {
  const excludePath = await localGitExcludePath(root);
  if (!excludePath) return { skipped: true, patternsAdded: [] };
  return ensureIgnoreFile(excludePath, patterns);
}

async function ensureIgnoreFile(path, patterns) {
  let current = "";
  try {
    current = await readFile(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const existing = new Set(current.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const missing = patterns.filter((pattern) => !existing.has(pattern));
  if (missing.length === 0) return { skipped: false, patternsAdded: [] };

  await mkdir(dirname(path), { recursive: true });
  const separator = current.length === 0 || current.endsWith("\n") ? "" : "\n";
  await writeFile(path, `${current}${separator}${missing.join("\n")}\n`);
  return { skipped: false, patternsAdded: missing };
}

async function localGitExcludePath(root) {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: root });
    const path = stdout.trim();
    if (!path) return null;
    return isAbsolute(path) ? path : join(root, path);
  } catch {
    return null;
  }
}
