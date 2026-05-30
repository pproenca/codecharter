import { cp, mkdir, rm, chmod, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
/**
 * Build the publishable `codecharter` artifact into dist/ — the package that
 * `npx codecharter` runs. Because the engine has zero runtime dependencies, the
 * CLI is bundled into a single self-contained ESM file; the browser SPA is
 * bundled alongside it so the server can serve it.
 *
 *   dist/
 *     bin/codecharter.mjs   self-contained CLI (shebang, esm) -> the `codecharter` bin
 *     public/           bundled viewer (index.html, style.css, app.js)
 *     package.json      copied root manifest (CLI reads ../package.json for --version)
 */
import { build } from "esbuild";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "bin"), { recursive: true });
await mkdir(join(dist, "public"), { recursive: true });

// 1. CLI — bundle core/bin + all of @codecharter/core into one runnable ESM file.
await build({
  entryPoints: [join(root, "core/bin/codecharter.mts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: join(dist, "bin/codecharter.mjs"),
  // esbuild preserves the entry file's existing `#!/usr/bin/env node` shebang.
  minify: false,
  legalComments: "none",
});
await chmod(join(dist, "bin/codecharter.mjs"), 0o755);

// 2. Viewer SPA — served from dist/public by the CLI's server.
await build({
  entryPoints: [join(root, "viewer/src/main/app.ts")],
  bundle: true,
  format: "esm",
  target: "es2024",
  outfile: join(dist, "public/app.js"),
  minify: false,
  legalComments: "none",
});
await cp(join(root, "viewer/web/index.html"), join(dist, "public/index.html"));
await cp(join(root, "viewer/web/style.css"), join(dist, "public/style.css"));

// 3. Manifest the CLI reads for `--version`.
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
await writeFile(
  join(dist, "package.json"),
  JSON.stringify({ name: manifest.name, version: manifest.version, type: "module" }, null, 2) +
    "\n",
);

console.log(`built publishable codecharter -> ${dist}`);
