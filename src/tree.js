import { basename } from "node:path/posix";

const MIN_VISIBLE_WEIGHT = 3;

export function buildFileTree(files) {
  const root = folderNode("");

  for (const file of files) {
    const parts = file.path.split("/");
    let current = root;

    for (const part of parts.slice(0, -1)) {
      if (!current.folders.has(part)) current.folders.set(part, folderNode(joinPath(current.path, part)));
      current = current.folders.get(part);
    }

    const name = parts.at(-1);
    current.files.set(name, {
      type: "file",
      name,
      path: file.path,
      extension: file.extension,
      lineCount: file.lineCount,
      weight: Math.max(file.lineCount, MIN_VISIBLE_WEIGHT),
    });
  }

  computeFolderWeights(root);
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
  return [...sortedFolders(folder), ...sortedFiles(folder)];
}

export function sortedFolders(folder) {
  return [...folder.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function sortedFiles(folder) {
  return [...folder.files.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function folderNode(path) {
  return {
    type: "folder",
    name: path === "" ? "" : basename(path),
    path,
    folders: new Map(),
    files: new Map(),
    weight: 0,
    lineCount: 0,
  };
}

function computeFolderWeights(folder) {
  let weight = 0;
  let lineCount = 0;

  for (const child of folder.folders.values()) {
    computeFolderWeights(child);
    weight += child.weight;
    lineCount += child.lineCount;
  }

  for (const child of folder.files.values()) {
    weight += child.weight;
    lineCount += child.lineCount;
  }

  folder.weight = Math.max(weight, MIN_VISIBLE_WEIGHT);
  folder.lineCount = lineCount;
}

function joinPath(parent, child) {
  return parent ? `${parent}/${child}` : child;
}
