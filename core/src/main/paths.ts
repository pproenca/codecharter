/**
 * Single source of truth for CodeCharter's recognized on-disk paths.
 *
 * These string literals are a cross-tool contract: the CLI, codex hook,
 * server, generator metadata excludes, watcher ignore list, and git-exclude
 * wiring all key off the SAME forward-slash relative paths. Defining them once
 * here prevents the drift that happens when a new store path is added in one
 * module but not the others. Keep the values forward-slash and relative to the
 * repo root; callers `join(root, …)` when they need an absolute path.
 */

export const CODECHARTER_DIR = ".codecharter";
export const CODEX_DIR = ".codex";

/** Canonical Map Sidecar location. */
export const MAP_FILE = `${CODECHARTER_DIR}/codecharter.json`;
/** Repo-root fallback map file (pre-`.codecharter/` layout). */
export const ROOT_MAP_FILE = "codecharter.json";
/** Legacy map file name (parse-only input). */
export const LEGACY_MAP_FILE = "codemap.json";

export const ACTIVITY_ARCHIVE_FILE = `${CODECHARTER_DIR}/activity.jsonl`;
export const CONFIG_FILE = `${CODECHARTER_DIR}/config.json`;
export const NAMED_PLACES_FILE = `${CODECHARTER_DIR}/named-places.json`;

export const HOOKS_JSON_FILE = `${CODEX_DIR}/hooks.json`;
export const HOOK_SHIM_FILE = `${CODEX_DIR}/hooks/codecharter-codex-hook.mjs`;

/**
 * Recognized map files in resolution precedence: `.codecharter/codecharter.json`
 * → root `codecharter.json` → legacy `codemap.json`.
 */
export const RECOGNIZED_MAP_FILES = [MAP_FILE, ROOT_MAP_FILE, LEGACY_MAP_FILE] as const;
