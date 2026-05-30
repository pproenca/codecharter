/**
 * Code-file extension allowlist (**BR-021**) — decides what is eligible to appear
 * on the map.
 *
 * A file is eligible iff its lower-cased extension is in the known set; that
 * membership check is the whole rule.
 */

import { extname } from "node:path";

export const CODE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".c",
  ".cc",
  ".cjs",
  ".cpp",
  ".cs",
  ".css",
  ".cts",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".json",
  ".kt",
  ".mjs",
  ".md",
  ".mdx",
  ".mts",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".xml",
  ".yaml",
  ".yml",
]);

/** True when the path's (lowercased) extension is in the allowlist. */
export function isCodeFile(path: string): boolean {
  return CODE_EXTENSIONS.has(extname(path.toLowerCase()));
}
