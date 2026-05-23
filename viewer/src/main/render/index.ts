/**
 * Public render-model surface for the viewer. Mirrors the export set of legacy
 * `public-src/render-model.ts` so `app.ts` can be ported with an unchanged
 * import list. Internal helpers in `primitives.ts` stay private; only the five
 * that the legacy bundle exported are re-published here.
 */
export type * from "./types.ts";
export * from "./constants.ts";
export * from "./lod.ts";
export * from "./camera.ts";
export * from "./fog.ts";
export * from "./activity.ts";
export * from "./source-panel.ts";
export * from "./targets.ts";
export { boundsCenter, containsBoundsPoint, hashString, normalizeMapPath, rgba } from "./primitives.ts";
