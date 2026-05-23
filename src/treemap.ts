import { assignAddress, layoutChildren, roundBounds } from "./district-layout.ts";
import { sortedChildren, sortedFiles, sortedFolders } from "./tree.ts";
import type { FolderNode, LayoutBounds } from "./tree.js";

export function layoutTree(root: FolderNode): FolderNode {
  assignFolderLayout(root, { x: 0, y: 0, width: 1, height: 1 }, { root: true });
  return root;
}

function assignFolderLayout(folder: FolderNode, bounds: LayoutBounds, options: { root?: boolean } = {}): void {
  folder.bounds = roundBounds(bounds);
  assignAddress(folder);

  const children = sortedChildren(folder);
  if (children.length === 0) {
    folder.growthArea = roundBounds(bounds);
    return;
  }

  const { growthArea } = layoutChildren(children, folder.bounds, options);
  folder.growthArea = growthArea;

  for (const child of sortedFolders(folder)) {
    if (child.bounds) assignFolderLayout(child, child.bounds);
  }
  for (const child of sortedFiles(folder)) {
    assignAddress(child);
  }
}
