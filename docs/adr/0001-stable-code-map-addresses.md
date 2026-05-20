# Stable code map addresses

Codemaps will create its first layout from the filesystem tree, then persist coordinates so existing Map Addresses remain stable as the codebase changes. New and deleted files should be handled locally within the affected folder region by default rather than triggering a full map reflow, because stable addresses protect human spatial memory, Drawn Selections, and Codex navigation history.

## Considered Options

- Reflow the whole map whenever the filesystem changes.
- Keep existing places fixed and place changes locally inside the affected folder region.

## Consequences

The map behaves more like a real map than a live packing algorithm. This may leave reusable space or less optimal packing after edits, but saved Regions, Drawn Selections, and agent activity traces keep their meaning over time.
