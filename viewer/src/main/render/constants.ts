/**
 * Render-model tuning constants (BR-018 activity decay, BR-019 LOD scale clamp,
 * source-text legibility thresholds, keyboard step sizes, fog texture).
 */
import type { PaletteColor } from "./types.ts";

export const SOURCE_TEXT_MIN_LINE_HEIGHT = 13;
export const SOURCE_TEXT_MIN_WIDTH = 260;
export const SOURCE_TEXT_MAX_LINES_PER_FRAME = 200;
export const SOURCE_TEXT_PREFETCH_LINES = 12;
export const SOURCE_CACHE_LIMIT = 80;
export const SOURCE_TEXT_ZOOM_HEADROOM = 1.08;
export const SOURCE_PANEL_CONTEXT_BEFORE = 12;
export const SOURCE_PANEL_CONTEXT_AFTER = 24;
export const SOURCE_PANEL_MAX_LINES = 140;
export const MAP_MIN_SCALE = 0.65;
export const MAP_MAX_SCALE = 320;
export const ORGANIC_REGION_EDGE_POSITIONS = [0.08, 0.24, 0.42, 0.6, 0.78, 0.92];
export const KEYBOARD_PAN_PIXELS = 72;
export const KEYBOARD_ZOOM_FACTOR = 1.25;
export const ACTIVITY_DORMANT_AFTER_MINUTES = 30;
export const ACTIVITY_DECAY_HALF_LIFE_MINUTES = 90;
export const ACTIVITY_LIVE_WINDOW_MINUTES = 360;
export const ACTIVITY_MIN_ALPHA = 0.18;
export const ACTIVITY_TRAIL_MIN_SEGMENT_PX = 8;
export const ACTIVITY_TRAIL_MAX_SEGMENT_PX = 220;
export const ACTIVITY_TRAIL_TENSION = 0.72;
export const ACTIVITY_TRAIL_MAX_GAP_MINUTES = 20;
export const DISCOVERY_FOG_TEXTURE_STEP_PX = 28;

export const DISTRICT_PALETTE: readonly PaletteColor[] = [
  { fill: [126, 176, 156], stroke: [41, 98, 73], label: "#24513d" },
  { fill: [111, 162, 190], stroke: [39, 92, 122], label: "#244e66" },
  { fill: [188, 154, 92], stroke: [126, 89, 34], label: "#6f4f1f" },
  { fill: [176, 128, 137], stroke: [118, 65, 77], label: "#6f3d49" },
  { fill: [126, 151, 117], stroke: [68, 101, 55], label: "#3f5d34" },
];

export const LANDMARK_NAMES = new Set([
  "AGENTS.md",
  "CONTEXT.md",
  "README.md",
  "package.json",
  "app.js",
  "index.html",
  "server.js",
]);
