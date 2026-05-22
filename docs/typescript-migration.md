# TypeScript Migration

CodeCharter is migrating from JavaScript to modern TypeScript incrementally.

Current state:

- `allowJs` is disabled for the main TypeScript project. Checked-in JavaScript is generated output, not TypeScript input.
- `checkJs` stays off because generated JavaScript is not typechecked directly; typecheck the TypeScript sources instead.
- `skipLibCheck` is temporary migration noise control for dependency types.
- `strict` is enabled in the main and browser TypeScript projects, and the package build inherits the main strict configuration.
- `isolatedModules` and `noEmitOnError` are enabled from the start so future emitted files stay compatible with single-file transpilers and failed checks do not produce stale output.
- `noImplicitAny` is enforced in the main, package build, and browser TypeScript projects.
- `strictNullChecks` is enforced in the main, package build, and browser TypeScript projects.
- `useUnknownInCatchVariables` is enabled in the main project so catch blocks narrow filesystem, process, fetch, and test-runner errors before reading properties.
- `noUncheckedIndexedAccess` is enabled in the main and browser TypeScript projects so indexed reads must account for missing entries.
- `exactOptionalPropertyTypes` is enabled in the main and browser TypeScript projects so optional keys are omitted when absent instead of being written as explicit `undefined`.
- Runtime, CLI, test-support, test, and browser sources have moved to `.ts`/`.mts`.
- Browser source lives under `public-src/`; `public/*.js` files are generated browser-served assets. Regenerate them with `pnpm build:public` rather than editing them directly.
- `public-src/` is checked by `tsc -p tsconfig.public.json`; do not add `// @ts-nocheck` or `noCheck` bridges back.
- Remaining migration cleanup is focused on unsafe JSON/fetch/error boundaries, unnecessary casts, and any explicitly generated JavaScript exceptions.

Target conventions:

- Source files should move from `.js`/`.mjs` to `.ts`/`.mts`; generated build output belongs under `dist/`.
- Published package entrypoints run from built `dist` JavaScript because Node does not strip TypeScript under `node_modules`.
- Local source entrypoints may import converted runtime modules with `.ts` extensions; `tsconfig.build.json` rewrites those relative extensions to `.js` for emitted files.
- Browser modules must keep browser-local imports ending in `.js`, because the static server serves generated JavaScript from `public/`.
- Exported functions and classes should get explicit parameter and return types as they are converted.
- Use `unknown` and narrowing at JSON, filesystem, process, fetch, and request-body boundaries.
- Use `@ts-expect-error` only for temporary migration suppressions, with a nearby explanation.
- Reach for design patterns only when they make an existing boundary clearer during migration; avoid unrelated pattern refactors.
