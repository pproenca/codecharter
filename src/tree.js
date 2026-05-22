import { basename } from "node:path/posix";

const MIN_VISIBLE_WEIGHT = 3;

export class FileNode {
  constructor(file) {
    this.type = "file";
    this.name = file.path.split("/").at(-1);
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
    this.name = path === "" ? "" : basename(path);
    this.path = path;
    this.folders = new Map();
    this.files = new Map();
    this.weight = 0;
    this.lineCount = 0;
  }

  childFolder(name) {
    if (!this.folders.has(name)) this.folders.set(name, new FolderNode(joinPath(this.path, name)));
    return this.folders.get(name);
  }

  addFile(file) {
    const node = new FileNode(file);
    this.files.set(node.name, node);
    return node;
  }

  sortedChildren() {
    return [...this.sortedFolders(), ...this.sortedFiles()];
  }

  sortedFolders() {
    return [...this.folders.values()].sort(compareNodeNames);
  }

  sortedFiles() {
    return [...this.files.values()].sort(compareNodeNames);
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
    const parts = file.path.split("/");
    let current = root;

    for (const part of parts.slice(0, -1)) {
      current = current.childFolder(part);
    }

    current.addFile(file);
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
