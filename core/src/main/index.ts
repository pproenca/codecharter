/**
 * Public entry point for `@codecharter/core`.
 *
 * The first transformation slice seeds the package with the geohash addressing
 * kernel plus the shared geometry/math primitives it needs. Later slices
 * (geometry, levels, generation, resolution) extend this surface.
 */

export {
  encodeGeohash,
  decodeGeohashBounds,
  codePointToGeo,
  geohashForBoundsCenter,
  codePlaneDescriptor,
} from "./geohash.ts";

export type {
  GeoCoordinate,
  GeohashBounds,
  GeohashedCoordinate,
  CodePlaneDescriptor,
} from "./geohash.ts";

export { clamp, round } from "./math.ts";
export { compareStrings, sortIfNeeded, sortedUniqueStrings, objectValues, objectRecord } from "./collections.ts";
export {
  intersects,
  normalizeRect,
  clampBounds,
  roundBounds,
} from "./geometry.ts";
export type { Point, Bounds } from "./geometry.ts";
export {
  MAP_LEVELS,
  FULL_GEOHASH_PRECISION,
  precisionForLevel,
} from "./levels.ts";
export type { MapLevel } from "./levels.ts";

export {
  createCodemapDeepLink,
  parseCodemapDeepLink,
  createBrowserHashRoute,
  createAnnotationHashRoute,
  createSelectionHashRoute,
} from "./deep-links.ts";
export type { DeepLinkMetadata, ParsedCodemapDeepLink, SelectionHashRouteInput } from "./deep-links.ts";

export { findNamedPlaceOverlaps } from "./overlaps.ts";
export type { NamedPlaceOverlap } from "./overlaps.ts";

export { tilePrefixForTarget, buildTileIndex, getTile, visiblePrefixes } from "./tiles.ts";
export type { Tile, TileCodemap, TileMapTarget, TileSerializedTarget, TileTargetType } from "./tiles.ts";

export { codeRangeGeometry, codeRangeRequestForSelection } from "./line-coordinate.ts";
export type {
  NormalizedRange,
  CodeRangeRequest,
  CodeRangeFragmentRequest,
  CodeRangeSelectionRequest,
  CodeRangeFragmentGeometry,
  CodeRangeGeometry,
} from "./line-coordinate.ts";

export { resolveAddress, normalizePathForMap, isCodecharterCodemap } from "./resolver.ts";
export type {
  CodecharterCodemap,
  MapFolderTarget,
  MapFileTarget,
  AddressRequest,
  AddressTargetType,
  ResolvedAddress,
  ResolvedAddressFragment,
} from "./resolver.ts";

export {
  resolveSelection,
  createNamedSelection,
  createMapAnnotation,
  createNamedAddress,
  refreshPlaceResolution,
} from "./selections.ts";
export type {
  SelectionGeometry,
  SelectionInput,
  ResolvedSelection,
  ResolvedSelectionTarget,
  SpatialFrame,
  NamedSelection,
  MapAnnotation,
  NamedAddress,
} from "./selections.ts";

// --- Map-generation layout engine -----------------------------------------
export { buildFileTree, flattenTree, sortedChildren, sortedFolders, sortedFiles, FileNode, FolderNode } from "./tree.ts";
export type { ScannedFile, LayoutBounds, MapNode, FlattenedTree } from "./tree.ts";

// Note: district-layout's `roundBounds` (which floors extent) is intentionally
// NOT re-exported here to avoid clashing with geometry's `roundBounds`; intra-core
// modules import it directly. (BR-004 dual-roundBounds.)
export {
  assignAddress,
  layoutChildren,
  placeChildrenInGrowth,
  nextGrowthArea,
  PROJECTION_TYPE,
  PROJECTION_LAYOUT_VERSION,
  PROJECTION_ORDER,
  PROJECTION_AREA_WEIGHT,
} from "./district-layout.ts";
export type { LayoutTarget, LayoutOptions, GrowthLayoutResult } from "./district-layout.ts";

export { layoutTree } from "./treemap.ts";
export { stabilizeTreeLayout } from "./stability.ts";
export type { PreviousCodemapLayout } from "./stability.ts";

// --- I/O pipeline (scan + generate) ---------------------------------------
export { CODE_EXTENSIONS, isCodeFile } from "./extensions.ts";
export { execFileText } from "./exec-file.ts";
export type { ExecFileTextOptions } from "./exec-file.ts";
export { listIncludedFiles, scanCodeFiles } from "./scan.ts";
export type { ScanOptions } from "./scan.ts";
export { generateCodemap } from "./generator.ts";
export type {
  GenerateCodemapOptions,
  GeneratedCodemap,
  CodemapProjection,
  SerializedFolder,
  SerializedFile,
} from "./generator.ts";
export { mapConcurrent } from "./collections.ts";

// --- Persistence + activity data layer ------------------------------------
export { readJson, writeJson } from "./store.ts";
export { isErrnoException, errorMessage } from "./errors.ts";
export { createActivityEvent, normalizeActivityState } from "./activity.ts";
export type { ActivityEvent, ActivityEventInput, ActivityState, ActivityStateInput, ActivityAddress } from "./activity.ts";
export { changedRangeFromUnifiedDiff, lineRangeFromUnifiedDiff } from "./activity-change-range.ts";
export type { ChangedRange, LineRange, TokenFragment } from "./activity-change-range.ts";
export {
  ActivityStore,
  createActivityStore,
  appendActivityEvents,
  ensureActivityArchive,
  clearActivityArchive,
} from "./activity-store.ts";
export type { StoredActivityEvent, ActivityStoreOptions, ActivitySnapshot } from "./activity-store.ts";

export { packageJsonFromValue, stringRecordFromValue, stringArrayFromValue, PACKAGE_DEPENDENCY_SECTIONS } from "./records.ts";
export type { PackageJsonWithDependencies, PackageDependencySection } from "./records.ts";

export { readSourceRange } from "./source.ts";
export type { SourceFileReference, SourceRange, SourceRangeOptions, SourceLine } from "./source.ts";

export {
  ensureCodecharterGitignore,
  ensureLocalGitExcludes,
  CODECHARTER_GITIGNORE_PATTERNS,
  LOCAL_CODECHARTER_EXCLUDES,
} from "./local-git-exclude.ts";
export type { IgnoreFileResult } from "./local-git-exclude.ts";

// --- HTTP server (hardened per Q4) ----------------------------------------
export { startServer } from "./server.ts";

// --- Dev activity watcher --------------------------------------------------
export {
  ActivityWatcher,
  startActivityWatcher,
  changedCodeChanges,
  changedLineRange,
  parseGitStatusPorcelain,
} from "./activity-watcher.ts";
export type { CodeChange, ActivityWatcherPayload, ActivityWatcherOptions } from "./activity-watcher.ts";

// --- Setup / provisioning --------------------------------------------------
export {
  initializeCodecharter,
  ensureCodecharterConfig,
  ensurePackageDevDependency,
  ensureCodexAdapter,
  ensureCodecharterSkill,
  ensureGitMapHooks,
  mergeCodexHooks,
} from "./init.ts";
export type { InitializeCodecharterOptions } from "./init.ts";

// --- Codex agent hook ------------------------------------------------------
export { runCodexHook } from "./codex-hook.ts";
