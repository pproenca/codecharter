import { assignAddress, layoutChildren, roundBounds } from "./district-layout.js";
import { sortedChildren, sortedFiles, sortedFolders } from "./tree.js";

export function layoutTree(root) {
  assignFolderLayout(root, unitBounds(), { root: true });
  return root;
}

function assignFolderLayout(folder, bounds, options = {}) {
  folder.bounds = roundBounds(bounds);
  assignAddress(folder);

  const children = sortedChildren(folder);
  if (children.length === 0) {
    folder.growthArea = roundBounds(bounds);
    return;
  }

  const { growthArea } = layoutChildren(children, folder.bounds, options);
  folder.growthArea = growthArea;

  for (const child of sortedFolders(folder)) assignFolderLayout(child, child.bounds);
  for (const child of sortedFiles(folder)) {
    assignAddress(child);
  }
}

function unitBounds() {
  return { x: 0, y: 0, width: 1, height: 1 };
}
