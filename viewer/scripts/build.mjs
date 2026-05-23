/**
 * Bundle the viewer SPA. esbuild inlines `app.ts` together with the render
 * model and deep-link codec into a single ES module, then the static shell
 * (index.html, style.css) is copied alongside it. The output `dist/` is what
 * the @codecharter/core server serves via `publicRoot`.
 */
import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: [join(root, "src/main/app.ts")],
  bundle: true,
  format: "esm",
  // Behavioral equivalence: match the legacy bundle's compile target
  // (codecharter `tsconfig.public.json` -> "target": "ES2024"). The pixel-diff
  // harness catches rendering drift; this keeps engine-semantics emit aligned.
  target: "es2024",
  // Deterministic, reviewable emit (no minification / charset surprises).
  minify: false,
  charset: "utf8",
  outfile: join(dist, "app.js"),
  sourcemap: false,
  legalComments: "none",
});

await cp(join(root, "web/index.html"), join(dist, "index.html"));
await cp(join(root, "web/style.css"), join(dist, "style.css"));

console.log(`built viewer → ${dist}`);
