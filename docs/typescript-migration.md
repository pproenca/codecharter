# TypeScript Migration

CodeCharter is migrating from JavaScript to modern TypeScript incrementally.

Current bridge:

- `allowJs` is enabled so TypeScript can resolve the existing JavaScript graph while files are renamed.
- `checkJs` stays off globally until a module is ready for migration; enable it locally with `// @ts-check` or convert the file to TypeScript when paying down that module's type debt.
- `skipLibCheck` is temporary migration noise control for dependency types.
- `isolatedModules` and `noEmitOnError` are enabled from the start so future emitted files stay compatible with single-file transpilers and failed checks do not produce stale output.
- Runtime, CLI, test-support, and test sources have moved to `.ts`/`.mts`. The remaining checked-in `.js` files are browser-served public assets and the generated Codex hook shim.

Target conventions:

- Source files should move from `.js`/`.mjs` to `.ts`/`.mts`; generated build output belongs under `dist/`.
- Published package entrypoints run from built `dist` JavaScript because Node does not strip TypeScript under `node_modules`.
- Local source entrypoints may import converted runtime modules with `.ts` extensions; `tsconfig.build.json` rewrites those relative extensions to `.js` for emitted files.
- Browser modules must keep browser-local imports ending in `.js`, because the static server serves the browser bundle as JavaScript rather than TypeScript source.
- Migrating the browser bundle needs a separate source/output decision: keep browser-loadable generated `.js` files for local serving, but make the TypeScript sources authoritative before tightening `checkJs` or `strict`.
- Exported functions and classes should get explicit parameter and return types as they are converted.
- Use `unknown` and narrowing at JSON, filesystem, process, fetch, and request-body boundaries.
- Use `@ts-expect-error` only for temporary migration suppressions, with a nearby explanation.
- Reach for design patterns only when they make an existing boundary clearer during migration; avoid unrelated pattern refactors.
