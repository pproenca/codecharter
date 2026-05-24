/**
 * The file-system tree domain model: `FileNode`/`FolderNode` and tree building.
 *
 * Implements **BR-005** (file weight = max(tokenCount, 3); folder weight = sum,
 * floored at 3). These classes are the real domain model consumed by the layout
 * engine (district-layout / treemap / stability), so they are kept as classes.
 */

import { sortIfNeeded } from "./collections.ts";
import type { GeohashedCoordinate } from "./geo-types.ts";

const MIN_VISIBLE_WEIGHT = 3;

export type ScannedFile = {
  path: string;
  extension: string;
  lineCount: number;
  maxLineLength: number;
  tokenCount: number;
};

export type LayoutBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MapNode = FileNode | FolderNode;

export class FileNode {
  readonly type = "file";
  readonly name: string;
  readonly path: string;
  readonly extension: string;
  readonly lineCount: number;
  readonly maxLineLength: number;
  readonly weight: number;
  bounds?: LayoutBounds;
  geo?: GeohashedCoordinate;

  constructor(file: ScannedFile) {
    this.name = lastPathSegment(file.path);
    this.path = file.path;
    this.extension = file.extension;
    this.lineCount = file.lineCount;
    this.maxLineLength = file.maxLineLength;
    this.weight = Math.max(file.tokenCount, MIN_VISIBLE_WEIGHT);
  }
}

export class FolderNode {
  readonly type = "folder";
  readonly name: string;
  readonly path: string;
  readonly folders: Map<string, FolderNode>;
  readonly files: Map<string, FileNode>;
  private sortedFolderCache: FolderNode[] | null;
  private sortedFileCache: FileNode[] | null;
  weight: number;
  lineCount: number;
  bounds?: LayoutBounds;
  geo?: GeohashedCoordinate;
  growthArea?: LayoutBounds;

  constructor(path: string) {
    this.name = path === "" ? "" : lastPathSegment(path);
    this.path = path;
    this.folders = new Map();
    this.files = new Map();
    this.sortedFolderCache = null;
    this.sortedFileCache = null;
    this.weight = 0;
    this.lineCount = 0;
  }

  childFolder(name: string): FolderNode {
    let folder = this.folders.get(name);
    if (!folder) {
      folder = new FolderNode(this.path ? `${this.path}/${name}` : name);
      this.folders.set(name, folder);
      this.sortedFolderCache = null;
    }
    return folder;
  }

  addFile(file: ScannedFile): FileNode {
    const node = new FileNode(file);
    this.files.set(node.name, node);
    this.sortedFileCache = null;
    return node;
  }

  sortedChildren(): MapNode[] {
    return [...this.sortedFolders(), ...this.sortedFiles()];
  }

  sortedFolders(): FolderNode[] {
    if (!this.sortedFolderCache) {
      this.sortedFolderCache = sortIfNeeded([...this.folders.values()], compareNodeNames);
    }
    return this.sortedFolderCache;
  }

  sortedFiles(): FileNode[] {
    if (!this.sortedFileCache) {
      this.sortedFileCache = sortIfNeeded([...this.files.values()], compareNodeNames);
    }
    return this.sortedFileCache;
  }

  recalculateMetrics(): void {
    let weight = 0;
    let lineCount = 0;

    for (const child of this.folders.values()) {
      child.recalculateMetrics();
      weight += child.weight;
      lineCount += child.lineCount;
    }

    for (const child of this.files.values()) {
      weight += child.weight;
      lineCount += child.lineCount;
    }

    this.weight = Math.max(weight, MIN_VISIBLE_WEIGHT);
    this.lineCount = lineCount;
  }
}

export type FlattenedTree = {
  folders: Record<string, FolderNode>;
  files: Record<string, FileNode>;
};

/** Build the folder tree from a flat list of scanned files and recompute metrics. */
export function buildFileTree(files: ScannedFile[]): FolderNode {
  const root = new FolderNode("");

  for (const file of files) {
    let current = root;
    const segments = file.path.split("/");
    for (const segment of segments.slice(0, -1)) {
      current = current.childFolder(segment);
    }
    current.addFile(file);
  }

  root.recalculateMetrics();
  return root;
}

/** Flatten a tree into path-keyed folder/file records (depth-first, sorted). */
export function flattenTree(root: FolderNode): FlattenedTree {
  const folders: Record<string, FolderNode> = {};
  const files: Record<string, FileNode> = {};

  function visitFolder(node: FolderNode): void {
    folders[node.path] = node;
    for (const child of sortedFolders(node)) {
      visitFolder(child);
    }
    for (const child of sortedFiles(node)) {
      files[child.path] = child;
    }
  }

  visitFolder(root);
  return { folders, files };
}

export function sortedChildren(folder: FolderNode): MapNode[] {
  return folder.sortedChildren();
}

export function sortedFolders(folder: FolderNode): FolderNode[] {
  return folder.sortedFolders();
}

export function sortedFiles(folder: FolderNode): FileNode[] {
  return folder.sortedFiles();
}

function compareNodeNames(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}

function lastPathSegment(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}
