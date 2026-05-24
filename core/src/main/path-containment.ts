import { lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { isErrnoException } from "./errors.ts";

export function pathWithinRoot(root: string, path: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  const rootPrefix = resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`;
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(rootPrefix);
}

export async function realPathWithinRoot(root: string, path: string): Promise<boolean> {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(root, path);
  if (!pathWithinRoot(resolvedRoot, resolvedPath)) {
    return false;
  }

  try {
    const [realRoot, realCandidate] = await Promise.all([
      realpath(resolvedRoot),
      realpath(resolvedPath),
    ]);
    return pathWithinRoot(realRoot, realCandidate);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function isRegularFileWithinRoot(root: string, path: string): Promise<boolean> {
  const resolvedPath = resolve(root, path);
  if (!pathWithinRoot(root, resolvedPath)) {
    return false;
  }

  try {
    const status = await lstat(resolvedPath);
    return status.isFile() && (await realPathWithinRoot(root, path));
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function assertSafeRootWritePath(root: string, path: string): Promise<void> {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  if (!pathWithinRoot(resolvedRoot, resolvedPath)) {
    throw new Error(`Refusing to write outside repository root: ${path}`);
  }

  const parent = dirname(resolvedPath);
  await mkdir(parent, { recursive: true });
  const [realRoot, realParent] = await Promise.all([realpath(resolvedRoot), realpath(parent)]);
  if (!pathWithinRoot(realRoot, realParent)) {
    throw new Error(`Refusing to write through path outside repository root: ${path}`);
  }
  await assertNotSymlink(resolvedPath);
}

export async function assertNotSymlink(path: string): Promise<void> {
  try {
    const status = await lstat(path);
    if (status.isSymbolicLink()) {
      throw new Error(`Refusing to write through symlink: ${path}`);
    }
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

export async function assertNoSymlinkWritePath(path: string): Promise<void> {
  await assertNotSymlink(dirname(resolve(path)));
  await assertNotSymlink(resolve(path));
}
