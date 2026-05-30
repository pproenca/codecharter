# TypeScript Layout

CodeCharter is a TypeScript monorepo. The core engine and browser viewer are
separate pnpm workspaces, and the root build creates the publishable CLI package.

## Workspaces

- `core/`: `@codecharter/core`, NodeNext TypeScript for the generator,
  Address Resolver, selections, activity pipeline, localhost server, setup
  helpers, and `core/bin/codemap.mts`.
- `viewer/`: `@codecharter/viewer`, browser TypeScript for the canvas app
  shell, Browser Hash Routes, render model, source panel, activity visuals, and
  Discovery Fog.
- `dist/`: root publishable output from `pnpm build`, containing
  `dist/bin/codemap.mjs`, `dist/public/`, and `dist/package.json`.
- `viewer/dist/`: viewer-only bundle from `pnpm --filter @codecharter/viewer
build`.

## Typecheck Rules

- `pnpm typecheck` runs `tsgo` against the core and viewer TypeScript configs.
- `core/tsconfig.json` checks `core/src/**/*.ts` and `core/bin/**/*.mts` with
  `module` and `moduleResolution` set to `NodeNext`.
- `viewer/tsconfig.json` checks `viewer/src/**/*.ts` with `module` set to
  `ESNext` and `moduleResolution` set to `Bundler`.
- Both workspaces use `strict`, `isolatedModules`, `noEmitOnError`,
  `noImplicitAny`, `strictNullChecks`, `useUnknownInCatchVariables`,
  `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`.
- `allowImportingTsExtensions` is enabled because local source imports keep
  explicit `.ts` extensions.
- Checked-in JavaScript is generated output or a local shim, not TypeScript
  input.

## Build Rules

- Root `pnpm build` bundles `core/bin/codemap.mts` and the core engine into
  `dist/bin/codemap.mjs`, then bundles `viewer/src/main/app.ts` into
  `dist/public/app.js`.
- Viewer `pnpm --filter @codecharter/viewer build` bundles
  `viewer/src/main/app.ts` into `viewer/dist/app.js` and copies
  `viewer/web/index.html` and `viewer/web/style.css`.
- Do not edit generated JavaScript in `dist/` or `viewer/dist/` when TypeScript
  source or static viewer source is available.
- Browser-served source HTML and CSS live under `viewer/web/`.

## Editing Rules

- Keep exported functions and classes typed at package boundaries.
- Use `unknown` and explicit narrowing at JSON, filesystem, process, fetch, and
  request-body boundaries.
- Prefer existing guard, builder, and validation helpers before adding new
  parsing logic.
- Use `@ts-expect-error` only for temporary suppressions with a nearby reason.
- Keep generated or shim-only JavaScript exceptions explicit.
