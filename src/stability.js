import { assignAddress, layoutChildren, nextGrowthArea, placeChildrenInGrowth, roundBounds } from "./district-layout.js";
import { sortedChildren, sortedFiles, sortedFolders } from "./tree.js";

export function stabilizeTreeLayout(root, previous) {
  if (!previous) return root;
  new TreeLayoutStabilizer(previous).stabilize(root, root.bounds);
  return root;
}

class TreeLayoutStabilizer {
  constructor(previous) {
    this.previous = previous;
  }

  stabilize(folder, fallbackBounds) {
    const previousFolder = this.previous.folders?.[folder.path];
    if (previousFolder) {
      folder.bounds = previousFolder.bounds;
      folder.geo = previousFolder.geo;
      folder.growthArea = previousFolder.growthArea ?? previousFolder.bounds;
    } else {
      folder.bounds = folder.bounds ?? fallbackBounds;
      assignAddress(folder);
      folder.growthArea = folder.growthArea ?? folder.bounds;
    }

    const newChildren = [];

    for (const child of sortedFolders(folder)) {
      if (this.previous.folders?.[child.path]) {
        this.stabilize(child, child.bounds);
      } else {
        newChildren.push(child);
      }
    }

    for (const child of sortedFiles(folder)) {
      const previousFile = this.previous.files?.[child.path];
      if (previousFile) {
        child.bounds = previousFile.bounds;
        child.geo = previousFile.geo;
      } else {
        newChildren.push(child);
      }
    }

    if (newChildren.length > 0) {
      placeChildrenInGrowth(newChildren, folder.growthArea ?? folder.bounds);
      folder.growthArea = nextGrowthArea(folder.growthArea ?? folder.bounds);
      for (const child of newChildren.filter((child) => child.type === "file")) assignAddress(child);
    }

    for (const child of newChildren.filter((child) => child.type === "folder")) {
      this.layoutNewFolder(child, child.bounds);
    }
  }

  layoutNewFolder(folder, bounds) {
    folder.bounds = roundBounds(bounds);
    assignAddress(folder);

    const children = sortedChildren(folder);
    if (children.length === 0) {
      folder.growthArea = folder.bounds;
      return;
    }

    const { growthArea } = layoutChildren(children, folder.bounds);
    folder.growthArea = growthArea;

    for (const child of sortedFolders(folder)) this.layoutNewFolder(child, child.bounds);
    for (const child of sortedFiles(folder)) {
      assignAddress(child);
    }
  }
}
