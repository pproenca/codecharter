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

export function isCodeFile(path: string): boolean {
  const lower = path.toLowerCase();
  const extension = extname(lower);
  return lower.endsWith(extension) && CODE_EXTENSIONS.has(extension);
}
