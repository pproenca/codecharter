import type { GeohashedCoordinate } from "./geohash.js";

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
    this.type = "file";
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
    this.type = "folder";
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
    if (!this.folders.has(name)) {
      this.folders.set(name, new FolderNode(joinPath(this.path, name)));
      this.sortedFolderCache = null;
    }
    return this.folders.get(name) as FolderNode;
  }

  addFile(file: ScannedFile): FileNode {
    const node = new FileNode(file);
    this.files.set(node.name, node);
    this.sortedFileCache = null;
    return node;
  }

  sortedChildren(): MapNode[] {
    const children: MapNode[] = [];
    for (const folder of this.sortedFolders()) children.push(folder);
    for (const file of this.sortedFiles()) children.push(file);
    return children;
  }

  sortedFolders(): FolderNode[] {
    if (!this.sortedFolderCache) {
      const folders: FolderNode[] = [];
      for (const folder of this.folders.values()) folders.push(folder);
      this.sortedFolderCache = nodesAreSorted(folders) ? folders : folders.sort(compareNodeNames);
    }
    return this.sortedFolderCache;
  }

  sortedFiles(): FileNode[] {
    if (!this.sortedFileCache) {
      const files: FileNode[] = [];
      for (const file of this.files.values()) files.push(file);
      this.sortedFileCache = nodesAreSorted(files) ? files : files.sort(compareNodeNames);
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

export function buildFileTree(files: ScannedFile[]): FolderNode {
  const root = new FolderNode("");

  for (const file of files) {
    let current = root;
    let segmentStart = 0;

    for (let index = 0; index <= file.path.length; index += 1) {
      if (index < file.path.length && file.path[index] !== "/") continue;
      if (index === file.path.length) {
        current.addFile(file);
        break;
      }
      current = current.childFolder(file.path.slice(segmentStart, index));
      segmentStart = index + 1;
    }
  }

  root.recalculateMetrics();
  return root;
}

export function flattenTree(root: FolderNode): FlattenedTree {
  const folders: Record<string, FolderNode> = {};
  const files: Record<string, FileNode> = {};

  function visitFolder(node: FolderNode): void {
    folders[node.path] = node;
    for (const child of sortedFolders(node)) visitFolder(child);
    for (const child of sortedFiles(node)) files[child.path] = child;
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

function nodesAreSorted(nodes: { name: string }[]): boolean {
  for (let index = 1; index < nodes.length; index += 1) {
    const previous = nodes[index - 1];
    const current = nodes[index];
    if (previous && current && compareNodeNames(previous, current) > 0) return false;
  }
  return true;
}

function joinPath(parent: string, child: string): string {
  return parent ? `${parent}/${child}` : child;
}

function lastPathSegment(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}
