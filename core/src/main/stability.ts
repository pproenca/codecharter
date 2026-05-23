/**
 * Stable address preservation across regenerations (**BR-051**).
 *
 * When a previous layout is reusable, every node whose path matched before keeps
 * its exact bounds + geohash; only newly-added nodes get fresh addresses placed
 * into the parent's reserved growth area. Matching is by exact path (renames are
 * treated as delete + add — a documented limitation, brief Open Question Q3).
 */

import { assignAddress, layoutChildren, nextGrowthArea, placeChildrenInGrowth, roundBounds } from "./district-layout.ts";
import { sortedChildren, sortedFiles, sortedFolders } from "./tree.ts";
import type { Bounds } from "./geometry.ts";
import type { GeohashedCoordinate } from "./geo-types.ts";
import type { LayoutTarget } from "./district-layout.ts";
import type { FileNode, FolderNode, MapNode } from "./tree.ts";

type PreviousFolderTarget = {
  bounds: Bounds;
  geo?: GeohashedCoordinate;
  growthArea?: Bounds;
  children?: {
    folders?: string[];
    files?: string[];
  };
};

type PreviousFileTarget = {
  bounds: Bounds;
  geo?: GeohashedCoordinate;
};

export type PreviousCodemapLayout = {
  folders?: Record<string, PreviousFolderTarget>;
  files?: Record<string, PreviousFileTarget>;
};

type StableFileNode = FileNode & LayoutTarget;
type StableFolderNode = FolderNode & LayoutTarget & { growthArea?: Bounds };
type StableMapNode = MapNode & LayoutTarget;

/** Reconcile a freshly-built tree against a previous layout to keep addresses stable. */
export function stabilizeTreeLayout(root: StableFolderNode, previous: PreviousCodemapLayout | null | undefined): StableFolderNode {
  if (!previous) return root;
  stabilizeFolder(root, previous, root.bounds);
  return root;
}

function stabilizeFolder(folder: StableFolderNode, previous: PreviousCodemapLayout, fallbackBounds: Bounds | undefined): void {
  const previousFolder = previous.folders?.[folder.path];
  if (previousFolder) {
    folder.bounds = previousFolder.bounds;
    if (previousFolder.geo) folder.geo = previousFolder.geo;
    folder.growthArea = previousFolder.growthArea ?? previousFolder.bounds;
  } else {
    if (!folder.bounds && fallbackBounds) folder.bounds = fallbackBounds;
    assignAddress(folder);
    if (!folder.growthArea && folder.bounds) folder.growthArea = folder.bounds;
  }

  const newChildren: StableMapNode[] = [];

  for (const child of sortedFolders(folder)) {
    if (previous.folders?.[child.path]) {
      stabilizeFolder(child, previous, child.bounds);
    } else {
      newChildren.push(child);
    }
  }

  for (const child of sortedFiles(folder)) {
    const previousFile = previous.files?.[child.path];
    if (previousFile) {
      child.bounds = previousFile.bounds;
      if (previousFile.geo) child.geo = previousFile.geo;
    } else {
      newChildren.push(child);
    }
  }

  if (newChildren.length > 0) {
    const growthBounds = folder.growthArea ?? folder.bounds;
    if (!growthBounds) throw new Error(`Cannot place new children without bounds: ${folder.path}`);
    placeChildrenInGrowth(newChildren, growthBounds);
    folder.growthArea = nextGrowthArea(growthBounds);
    const newFiles: StableFileNode[] = [];
    const newFolders: StableFolderNode[] = [];
    for (const child of newChildren) {
      if (child.type === "file") newFiles.push(child);
      else if (child.type === "folder") newFolders.push(child);
    }
    for (const child of newFiles) assignAddress(child);
    for (const child of newFolders) layoutNewFolder(child, child.bounds);
  }
}

function layoutNewFolder(folder: StableFolderNode, bounds: Bounds | undefined): void {
  if (!bounds) throw new Error(`Cannot layout folder without bounds: ${folder.path}`);
  folder.bounds = roundBounds(bounds);
  assignAddress(folder);

  const children = sortedChildren(folder);
  if (children.length === 0) {
    folder.growthArea = folder.bounds;
    return;
  }

  const { growthArea } = layoutChildren(children, folder.bounds);
  folder.growthArea = growthArea;

  for (const child of sortedFolders(folder)) layoutNewFolder(child, child.bounds);
  for (const child of sortedFiles(folder)) {
    assignAddress(child);
  }
}
