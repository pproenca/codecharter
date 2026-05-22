# TypeScript Migration

CodeCharter is migrating from JavaScript to modern TypeScript incrementally.

Current bridge:

- `allowJs` is enabled so TypeScript can resolve the existing JavaScript graph while files are renamed.
- `checkJs` stays off globally until a module is ready for migration; enable it locally with `// @ts-check` or convert the file to TypeScript when paying down that module's type debt.
- `skipLibCheck` is temporary migration noise control for dependency types.
- `isolatedModules` and `noEmitOnError` are enabled from the start so future emitted files stay compatible with single-file transpilers and failed checks do not produce stale output.

Target conventions:

- Source files should move from `.js`/`.mjs` to `.ts`/`.mts`; generated build output belongs under `dist/`.
- Keep import specifiers ending in `.js` for runtime ESM compatibility after TypeScript emits JavaScript.
- Exported functions and classes should get explicit parameter and return types as they are converted.
- Use `unknown` and narrowing at JSON, filesystem, process, fetch, and request-body boundaries.
- Use `@ts-expect-error` only for temporary migration suppressions, with a nearby explanation.
- Reach for design patterns only when they make an existing boundary clearer during migration; avoid unrelated pattern refactors.
