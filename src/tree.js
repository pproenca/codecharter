const MIN_VISIBLE_WEIGHT = 3;

export class FileNode {
  constructor(file) {
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
  constructor(path) {
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

  childFolder(name) {
    if (!this.folders.has(name)) {
      this.folders.set(name, new FolderNode(joinPath(this.path, name)));
      this.sortedFolderCache = null;
    }
    return this.folders.get(name);
  }

  addFile(file) {
    const node = new FileNode(file);
    this.files.set(node.name, node);
    this.sortedFileCache = null;
    return node;
  }

  sortedChildren() {
    return [...this.sortedFolders(), ...this.sortedFiles()];
  }

  sortedFolders() {
    if (!this.sortedFolderCache) this.sortedFolderCache = [...this.folders.values()].sort(compareNodeNames);
    return this.sortedFolderCache;
  }

  sortedFiles() {
    if (!this.sortedFileCache) this.sortedFileCache = [...this.files.values()].sort(compareNodeNames);
    return this.sortedFileCache;
  }

  recalculateMetrics() {
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

export function buildFileTree(files) {
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

export function flattenTree(root) {
  const folders = {};
  const files = {};

  function visitFolder(node) {
    folders[node.path] = node;
    for (const child of sortedFolders(node)) visitFolder(child);
    for (const child of sortedFiles(node)) files[child.path] = child;
  }

  visitFolder(root);
  return { folders, files };
}

export function sortedChildren(folder) {
  return folder.sortedChildren();
}

export function sortedFolders(folder) {
  return folder.sortedFolders();
}

export function sortedFiles(folder) {
  return folder.sortedFiles();
}

function compareNodeNames(a, b) {
  return a.name.localeCompare(b.name);
}

function joinPath(parent, child) {
  return parent ? `${parent}/${child}` : child;
}

function lastPathSegment(path) {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}
