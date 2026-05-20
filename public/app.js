import {
  SOURCE_CACHE_LIMIT,
  SOURCE_TEXT_MAX_LINES_PER_FRAME,
  SOURCE_TEXT_PREFETCH_LINES,
  activityFragmentBounds,
  activityPrimaryBounds,
  activityStateStyle,
  activityTissueBox,
  activityVisualEncoding,
  boundsCenter as modelBoundsCenter,
  canRenderSourceText,
  fileLabelPriority,
  fileVisualState,
  folderDepth,
  folderLabelPriority,
  folderStyle,
  hashString,
  hitTestTargets,
  isScreenBoxVisible,
  KEYBOARD_PAN_PIXELS,
  KEYBOARD_ZOOM_FACTOR,
  labelBoxesOverlap,
  lineHeightForFile,
  lineAtWorldPoint,
  latestActivityByAgent,
  normalizeActivityState,
  organicRegionPoints,
  organicRegionStyle,
  panViewByScreenDelta,
  screenBoundsForView,
  screenToWorldPoint,
  shouldDrawFolder,
  shouldDrawOrganicRegion,
  shouldLabelFile,
  shouldLabelFolder,
  sourcePanelLineRangeForBox,
  sortedActivityEvents,
  viewForBounds,
  viewForReadableFile,
  visibleLineRangeForBox,
  worldToScreenPoint,
  zoomViewAt,
} from "./render-model.js";

const canvas = document.querySelector("#mapCanvas");
const ctx = canvas.getContext("2d");
const mapArea = document.querySelector(".map-area");
const DEFAULT_MAP_LEVEL = "file";

let frameLabels = [];
let activityPollTimer = null;
let mapPollTimer = null;

const state = {
  map: null,
  mapVersion: "",
  namedPlaces: [],
  overlaps: [],
  activity: [],
  sourceCache: new Map(),
  pendingSourceRequests: new Set(),
  activitySignature: "",
  view: { x: 0, y: 0, scale: 1 },
  dragging: null,
  lastPointerDown: null,
  drawing: false,
  draftSelection: null,
  resolvedSelection: null,
  selectedTarget: null,
};

const controls = {
  summary: document.querySelector("#mapSummary"),
  hover: document.querySelector("#hoverReadout"),
  viewport: document.querySelector("#viewportReadout"),
  selectionPopover: document.querySelector("#selectionPopover"),
  inspectorTitle: document.querySelector("#inspectorTitle"),
  inspectorSubtitle: document.querySelector("#inspectorSubtitle"),
  searchForm: document.querySelector("#searchForm"),
  searchInput: document.querySelector("#searchInput"),
  searchResult: document.querySelector("#searchResult"),
  drawTool: document.querySelector("#drawTool"),
  saveSelection: document.querySelector("#saveSelection"),
  selectionName: document.querySelector("#selectionName"),
  selectionComment: document.querySelector("#selectionComment"),
  selectionOutput: document.querySelector("#selectionOutput"),
  sourceTitle: document.querySelector("#sourceTitle"),
  sourceOutput: document.querySelector("#sourceOutput"),
  showFolders: document.querySelector("#showFolders"),
  showOrganicRegions: document.querySelector("#showOrganicRegions"),
  showFiles: document.querySelector("#showFiles"),
  showNames: document.querySelector("#showNames"),
  showActivity: document.querySelector("#showActivity"),
  showGrid: document.querySelector("#showGrid"),
  activityFeed: document.querySelector("#activityFeed"),
  activityForm: document.querySelector("#activityForm"),
};

await boot();

async function boot() {
  const [map, mapVersion, names, activity] = await Promise.all([
    fetchJson("/api/map"),
    fetchJson("/api/map-version"),
    fetchJson("/api/named-places"),
    fetchJson("/api/activity"),
  ]);
  applyMap(map, mapVersion.version);
  state.namedPlaces = names.places;
  state.overlaps = names.overlaps ?? [];
  state.activity = activity.events;
  state.activitySignature = activitySignature(state.activity);
  bindEvents();
  startMapPolling();
  startActivityPolling();
  resize();
  render();
}

function applyMap(map, version) {
  const previousSelection = state.selectedTarget;
  state.map = map;
  state.mapVersion = version ?? state.mapVersion;
  state.sourceCache.clear();
  state.pendingSourceRequests.clear();
  if (controls.summary) {
    controls.summary.textContent = `${Object.keys(map.files).length} files, ${Object.keys(map.folders).length} folders`;
  }
  reconcileSelectedTarget(previousSelection);
}

function reconcileSelectedTarget(target) {
  if (!target || target.targetType === "activity") return;
  if (target.targetType === "file") {
    state.selectedTarget = state.map.files[target.path] ? { ...state.map.files[target.path], targetType: "file" } : null;
    return;
  }
  if (target.targetType === "folder") {
    state.selectedTarget = state.map.folders[target.path] ? { ...state.map.folders[target.path], targetType: "folder" } : null;
  }
}

function bindEvents() {
  window.addEventListener("resize", () => {
    resize();
    render();
  });

  for (const control of [
    controls.showFolders,
    controls.showOrganicRegions,
    controls.showFiles,
    controls.showNames,
    controls.showActivity,
    controls.showGrid,
  ].filter(Boolean)) {
    control.addEventListener("change", render);
  }

  controls.drawTool?.addEventListener("click", () => {
    setDrawMode(!state.drawing);
    render();
  });

  controls.searchForm?.addEventListener("submit", searchMap);
  controls.saveSelection?.addEventListener("click", saveSelection);
  controls.activityForm?.addEventListener("submit", addActivity);

  mapArea.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerUp);
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-label", "Codemap canvas. Use arrow keys to pan, plus and minus to zoom, and Enter to select the center.");
  canvas.addEventListener("keydown", onCanvasKeyDown);
}

function startActivityPolling() {
  if (activityPollTimer) clearInterval(activityPollTimer);
  activityPollTimer = setInterval(refreshActivity, 1800);
}

function startMapPolling() {
  if (mapPollTimer) clearInterval(mapPollTimer);
  mapPollTimer = setInterval(refreshMap, 1800);
}

async function refreshMap() {
  try {
    const mapVersion = await fetchJson("/api/map-version");
    if (!mapVersion.version || mapVersion.version === state.mapVersion) return;
    const [map, names] = await Promise.all([
      fetchJson("/api/map"),
      fetchJson("/api/named-places"),
    ]);
    applyMap(map, mapVersion.version);
    state.namedPlaces = names.places;
    state.overlaps = names.overlaps ?? [];
    render();
  } catch (error) {
    console.error(error);
  }
}

async function refreshActivity() {
  try {
    const activity = await fetchJson("/api/activity");
    const nextSignature = activitySignature(activity.events ?? []);
    if (nextSignature === state.activitySignature) return;
    state.activity = activity.events ?? [];
    state.activitySignature = nextSignature;
    render();
  } catch (error) {
    console.error(error);
  }
}

function activitySignature(events) {
  const latest = events.at(-1);
  return `${events.length}:${latest?.id ?? ""}:${latest?.timestamp ?? ""}`;
}

function setDrawMode(enabled) {
  state.drawing = enabled;
  controls.drawTool?.classList.toggle("active", enabled);
  controls.drawTool?.setAttribute("aria-pressed", String(enabled));
  if (enabled) state.selectedTarget = null;
  if (!enabled) clearDraftSelection();
  updateSelectionPopover();
}

function clearDraftSelection() {
  state.dragging = null;
  state.draftSelection = null;
  state.resolvedSelection = null;
  if (controls.saveSelection) controls.saveSelection.disabled = true;
  if (state.selectedTarget?.targetType !== "annotation") {
    if (controls.selectionOutput) controls.selectionOutput.textContent = "";
  }
  updateSelectionPopover();
}

function updateSelectionPopover() {
  if (!controls.selectionPopover) return;
  controls.selectionPopover.hidden = !(state.draftSelection || state.resolvedSelection || state.selectedTarget?.targetType === "annotation");
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function render() {
  const rect = canvas.getBoundingClientRect();
  frameLabels = [];
  ctx.clearRect(0, 0, rect.width, rect.height);
  controls.viewport.textContent = `scale ${state.view.scale.toFixed(2)} | level ${DEFAULT_MAP_LEVEL}`;

  drawCompassRose();
  if (layerEnabled("showGrid", false)) drawGrid();
  if (layerEnabled("showFolders")) drawFolders();
  if (layerEnabled("showOrganicRegions")) drawOrganicRegions();
  if (layerEnabled("showFiles")) drawFiles();
  drawQueuedLabels();
  if (layerEnabled("showNames")) drawNamedPlaces();
  if (layerEnabled("showNames")) drawOverlaps();
  if (state.draftSelection) drawSelection(state.draftSelection.bounds, "rgba(245, 158, 11, 0.18)", "#f59e0b", [6, 4]);
  if (layerEnabled("showActivity")) drawActivity();
  renderActivityFeed();
}

function layerEnabled(name, fallback = true) {
  return controls[name]?.checked ?? fallback;
}

function drawGrid() {
  const step = 0.1;
  ctx.save();
  ctx.strokeStyle = "rgba(15, 23, 42, 0.12)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 10; i += 1) {
    const p = worldToScreen({ x: i * step, y: i * step });
    ctx.beginPath();
    ctx.moveTo(p.x, 0);
    ctx.lineTo(p.x, canvas.clientHeight);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p.y);
    ctx.lineTo(canvas.clientWidth, p.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCompassRose() {
  ctx.save();
  ctx.fillStyle = "rgba(18, 61, 53, 0.08)";
  ctx.strokeStyle = "rgba(18, 61, 53, 0.16)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(canvas.clientWidth - 44, canvas.clientHeight - 44, 22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.fillText("N", canvas.clientWidth - 48, canvas.clientHeight - 50);
  ctx.fillText("Code Plane", canvas.clientWidth - 96, canvas.clientHeight - 16);
  ctx.restore();
}

function drawFolders() {
  for (const folder of Object.values(state.map.folders)) {
    if (!folder.path) continue;
    const box = screenBounds(folder.bounds);
    if (!visible(box)) continue;
    const depth = folderDepth(folder.path);
    if (!shouldDrawFolder(state.view.scale, depth, box)) continue;
    const style = folderStyle(folder.path, depth);
    ctx.fillStyle = style.fill;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = depth === 1 ? 2.1 : 1;
    drawRect(box);
    if (shouldLabelFolder(state.view.scale, depth, box)) {
      queueLabelInBox({
        text: labelForFolder(folder),
        box,
        color: style.label,
        size: 13,
        weight: "600",
        priority: folderLabelPriority(depth, box),
      });
    }
  }
}

function drawOrganicRegions() {
  const folders = Object.values(state.map.folders)
    .filter((folder) => folder.path)
    .sort((a, b) => folderDepth(a.path) - folderDepth(b.path) || a.path.localeCompare(b.path));

  for (const folder of folders) {
    const box = screenBounds(folder.bounds);
    if (!visible(box)) continue;
    const depth = folderDepth(folder.path);
    if (!shouldDrawOrganicRegion(state.view.scale, depth, box)) continue;
    const points = organicRegionPoints(folder.bounds, folder.path, depth);
    if (points.length < 3) continue;
    const style = organicRegionStyle(folder.path, depth);

    ctx.save();
    drawOrganicPath(points);
    ctx.fillStyle = style.fill;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = depth === 1 ? 2.4 : 1.4;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function drawFiles() {
  let renderedSourceLines = 0;
  for (const file of Object.values(state.map.files)) {
    const box = screenBounds(file.bounds);
    if (!visible(box)) continue;
    const selected = state.selectedTarget?.path === file.path;
    const visualState = fileVisualState({ file, box, scale: state.view.scale, selected });
    if (visualState === "hidden") continue;

    ctx.fillStyle = selected ? "rgba(255, 255, 255, 0.82)" : "rgba(235, 248, 241, 0.48)";
    ctx.strokeStyle = selected
      ? "rgba(180, 84, 24, 0.95)"
      : visualState === "aggregate"
        ? "rgba(18, 128, 98, 0.16)"
        : "rgba(18, 128, 98, 0.34)";
    ctx.lineWidth = selected ? 2.6 : visualState === "aggregate" ? 0.35 : state.view.scale > 2.2 ? 1 : 0.65;
    drawRect(box);
    if (shouldLabelFile({ file, box, scale: state.view.scale, selected })) {
      queueLabelInBox({
        text: file.name,
        box,
        color: "rgba(3, 87, 67, 0.84)",
        size: 12,
        weight: "500",
        priority: fileLabelPriority({ file, selected }),
      });
    }
    if (canRenderSourceText(file, box) && renderedSourceLines < SOURCE_TEXT_MAX_LINES_PER_FRAME) {
      renderedSourceLines += drawSourceText(file, box, SOURCE_TEXT_MAX_LINES_PER_FRAME - renderedSourceLines);
    } else if (state.view.scale > 6 && box.height > 34) {
      drawLineBands(file, box);
    }
  }
}

function drawOrganicPath(points) {
  const first = worldToScreen(points[0]);
  const second = worldToScreen(points[1]);
  ctx.beginPath();
  ctx.moveTo((first.x + second.x) / 2, (first.y + second.y) / 2);

  for (let index = 1; index <= points.length; index += 1) {
    const control = worldToScreen(points[index % points.length]);
    const next = worldToScreen(points[(index + 1) % points.length]);
    ctx.quadraticCurveTo(control.x, control.y, (control.x + next.x) / 2, (control.y + next.y) / 2);
  }

  ctx.closePath();
}

function drawSourceText(file, box, remainingBudget) {
  const visibleRange = visibleLineRange(file, box);
  if (!visibleRange) return 0;

  const budgetedEnd = Math.min(visibleRange.end, visibleRange.start + remainingBudget - 1);
  const fetchStart = Math.max(1, visibleRange.start - SOURCE_TEXT_PREFETCH_LINES);
  const fetchEnd = Math.min(file.lineCount, budgetedEnd + SOURCE_TEXT_PREFETCH_LINES);
  const cacheKey = sourceCacheKey(file.path, fetchStart, fetchEnd);
  const cached = getCachedSourceRange(file.path, fetchStart, fetchEnd);

  if (!cached) {
    requestSourceRange(file.path, fetchStart, fetchEnd, cacheKey);
    drawSourcePlaceholder(box);
    return 0;
  }

  const linesByNumber = new Map(cached.lines.map((line) => [line.number, line.text]));
  const lineHeight = lineHeightForFile(file, box);
  const firstBaseline = box.y + (visibleRange.start - 1) * lineHeight + Math.min(13, lineHeight * 0.78);
  const maxChars = Math.max(12, Math.floor((box.width - 44) / 7.2));
  let drawn = 0;

  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height);
  ctx.clip();
  ctx.font = "12px SFMono-Regular, Consolas, Liberation Mono, monospace";
  ctx.textBaseline = "alphabetic";

  for (let lineNumber = visibleRange.start; lineNumber <= budgetedEnd; lineNumber += 1) {
    const y = firstBaseline + drawn * lineHeight;
    if (y > box.y + box.height) break;
    const text = linesByNumber.get(lineNumber) ?? "";
    ctx.fillStyle = "rgba(63, 83, 97, 0.58)";
    ctx.fillText(String(lineNumber).padStart(4, " "), box.x + 6, y);
    ctx.fillStyle = "rgba(12, 34, 48, 0.86)";
    ctx.fillText(truncateLine(text, maxChars), box.x + 42, y);
    drawn += 1;
  }

  ctx.restore();
  return drawn;
}

function drawSourcePlaceholder(box) {
  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.36)";
  ctx.fillRect(box.x + 4, box.y + 4, Math.max(0, box.width - 8), Math.min(24, Math.max(0, box.height - 8)));
  ctx.restore();
}

function visibleLineRange(file, box) {
  return visibleLineRangeForBox(file, box, canvas.clientHeight);
}

function requestSourceRange(path, lineStart, lineEnd, cacheKey) {
  if (state.pendingSourceRequests.has(cacheKey)) return;
  state.pendingSourceRequests.add(cacheKey);
  fetchJson(`/api/source?path=${encodeURIComponent(path)}&lineStart=${lineStart}&lineEnd=${lineEnd}`)
    .then((source) => {
      rememberSource(cacheKey, source);
      render();
    })
    .catch((error) => {
      console.error(error);
    })
    .finally(() => {
      state.pendingSourceRequests.delete(cacheKey);
    });
}

function rememberSource(cacheKey, source) {
  if (state.sourceCache.has(cacheKey)) state.sourceCache.delete(cacheKey);
  state.sourceCache.set(cacheKey, source);
  while (state.sourceCache.size > SOURCE_CACHE_LIMIT) {
    state.sourceCache.delete(state.sourceCache.keys().next().value);
  }
}

function getCachedSourceRange(path, lineStart, lineEnd) {
  for (const [cacheKey, source] of state.sourceCache) {
    if (source.path !== path) continue;
    if (source.lineRange.start > lineStart || source.lineRange.end < lineEnd) continue;
    state.sourceCache.delete(cacheKey);
    state.sourceCache.set(cacheKey, source);
    return source;
  }
  return null;
}

function sourceCacheKey(path, lineStart, lineEnd) {
  return `${path}:${lineStart}-${lineEnd}`;
}

function truncateLine(text, maxChars) {
  return text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 3))}...` : text;
}

function drawLineBands(file, box) {
  const lines = Math.min(file.lineCount, 80);
  ctx.strokeStyle = "rgba(4, 120, 87, 0.18)";
  ctx.lineWidth = 1;
  for (let i = 1; i < lines; i += 1) {
    const y = box.y + (box.height * i) / lines;
    ctx.beginPath();
    ctx.moveTo(box.x, y);
    ctx.lineTo(box.x + box.width, y);
    ctx.stroke();
  }
}

function drawNamedPlaces() {
  const annotations = [];
  for (const place of state.namedPlaces) {
    if (place.kind === "mapAnnotation") {
      annotations.push(place);
      continue;
    }
    if (place.kind !== "drawnSelection") continue;
    drawSelection(place.geometry.bounds, "rgba(245, 158, 11, 0.08)", "#f59e0b", []);
    const box = screenBounds(place.geometry.bounds);
    drawLabel(place.name, box.x + 6, box.y + 16, "#92400e");
  }

  annotations.forEach((annotation, index) => {
    const selected = state.selectedTarget?.targetType === "annotation" && state.selectedTarget.id === annotation.id;
    drawAnnotation(annotation, index + 1, selected);
  });
}

function drawAnnotation(annotation, markerNumber, selected) {
  drawSelection(
    annotation.geometry.bounds,
    selected ? "rgba(37, 99, 235, 0.13)" : "rgba(37, 99, 235, 0.07)",
    selected ? "#1d4ed8" : "rgba(37, 99, 235, 0.8)",
    selected ? [] : [4, 4],
  );

  const box = screenBounds(annotation.geometry.bounds);
  if (box.width > 68 && box.height > 22) {
    drawLabel(annotation.name, box.x + 8, box.y + 18, "#1e3a8a", 12, "700");
  }
  drawAnnotationMarker(annotation, markerNumber, selected);
}

function drawAnnotationMarker(annotation, markerNumber, selected) {
  const center = worldToScreen(boundsCenter(annotation.geometry.bounds));
  const radius = selected ? 13 : 11;
  ctx.save();
  ctx.fillStyle = selected ? "#1d4ed8" : "#2563eb";
  ctx.strokeStyle = "#eff6ff";
  ctx.lineWidth = selected ? 3 : 2.4;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "700 11px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(markerNumber), center.x, center.y + 0.5);
  ctx.restore();
}

function drawOverlaps() {
  for (const overlap of state.overlaps) {
    const box = screenBounds(overlap.bounds);
    if (!visible(box)) continue;
    ctx.save();
    ctx.fillStyle = "rgba(225, 29, 72, 0.18)";
    ctx.strokeStyle = "#e11d48";
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    drawRect(box);
    ctx.restore();
    if (box.width > 44 && box.height > 16) drawLabel("Overlap", box.x + 6, box.y + 16, "#9f1239");
  }
}

function drawActivity() {
  const events = sortedActivityEvents(state.activity);
  const latestByAgent = latestActivityByAgent(events);
  drawActivityMembranes(events, latestByAgent);
  drawActivityTrails(events, latestByAgent);

  for (const event of events) {
    const latest = latestByAgent.get(event.agentId) === event;
    const primaryBounds = activityPrimaryBounds(event);
    if (!primaryBounds) continue;
    const center = boundsCenter(primaryBounds);
    const p = worldToScreen(center);
    const selected = state.selectedTarget?.targetType === "activity" && state.selectedTarget.id === event.id;
    const encoding = activityVisualEncoding(event, { latest, selected });
    const style = activityStateStyle(encoding.activityState);
    ctx.save();
    ctx.globalAlpha = encoding.alpha;
    ctx.fillStyle = style.stroke;
    ctx.beginPath();
    ctx.arc(p.x, p.y, encoding.haloRadius * 0.46, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = style.fill;
    ctx.strokeStyle = selected ? "#111827" : style.stroke;
    ctx.lineWidth = selected ? 3 : latest ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, encoding.coreRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (latest) {
      ctx.globalAlpha = encoding.membraneAlpha * 1.25;
      ctx.beginPath();
      drawActivityCell(p, encoding.haloRadius, event.id ?? event.agentId);
      ctx.strokeStyle = style.fill;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
      drawLabel(`${event.agentId}: ${encoding.activityState}`, p.x + 10, p.y - 8, style.label, 12, "700");
    }
    ctx.restore();
  }
}

function drawActivityMembranes(events, latestByAgent) {
  for (const event of events) {
    const latest = latestByAgent.get(event.agentId) === event;
    const selected = state.selectedTarget?.targetType === "activity" && state.selectedTarget.id === event.id;
    const encoding = activityVisualEncoding(event, { latest, selected });
    if (encoding.membraneAlpha <= 0.08 && !selected) continue;

    const style = activityStateStyle(encoding.activityState);

    for (const bounds of activityFragmentBounds(event)) {
      const tissueBox = activityTissueBox(screenBounds(bounds), encoding);
      const p = {
        x: tissueBox.x + tissueBox.width / 2,
        y: tissueBox.y + tissueBox.height / 2,
      };
      const radius = Math.max(tissueBox.width, tissueBox.height) * 0.82;
      const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      gradient.addColorStop(0, hexToRgba(style.fill, encoding.membraneAlpha));
      gradient.addColorStop(0.58, hexToRgba(style.fill, encoding.membraneAlpha * 0.45));
      gradient.addColorStop(1, hexToRgba(style.fill, 0));

      ctx.save();
      ctx.fillStyle = gradient;
      ctx.beginPath();
      drawActivityTissue(tissueBox, `${event.id ?? event.agentId}:${bounds.x}:${bounds.y}`);
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawActivityTrails(events, latestByAgent) {
  const byAgent = new Map();
  for (const event of events) {
    if (!byAgent.has(event.agentId)) byAgent.set(event.agentId, []);
    byAgent.get(event.agentId).push(event);
  }

  for (const agentEvents of byAgent.values()) {
    if (agentEvents.length < 2) continue;
    const latest = latestByAgent.get(agentEvents[0].agentId);
    const selected = state.selectedTarget?.targetType === "activity" && state.selectedTarget.agentId === agentEvents[0].agentId;
    const encoding = activityVisualEncoding(latest, { latest: true, selected });
    const style = activityStateStyle(encoding.activityState);
    ctx.save();
    ctx.strokeStyle = style.fill;
    ctx.globalAlpha = encoding.trailAlpha;
    ctx.lineWidth = encoding.lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    drawMyceliumPath(agentEvents);
    ctx.stroke();
    ctx.restore();
  }
}

function drawMyceliumPath(events) {
  const points = events
    .map((event) => activityPrimaryBounds(event))
    .filter(Boolean)
    .map((bounds) => worldToScreen(boundsCenter(bounds)));
  if (points.length < 2) return;

  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const mid = {
      x: (previous.x + current.x) / 2,
      y: (previous.y + current.y) / 2,
    };
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const unit = hashUnit(`${events[index].id ?? events[index].timestamp}:bend`);
    const direction = unit > 0.5 ? 1 : -1;
    const bend = Math.min(110, length * 0.28) * (0.45 + Math.abs(unit - 0.5)) * direction;
    const control = {
      x: mid.x - (dy / length) * bend,
      y: mid.y + (dx / length) * bend,
    };
    ctx.quadraticCurveTo(control.x, control.y, current.x, current.y);
  }
}

function drawActivityCell(center, radius, key) {
  const points = 10;
  ctx.moveTo(center.x + radius, center.y);
  for (let index = 1; index <= points; index += 1) {
    const angle = (index / points) * Math.PI * 2;
    const wobble = 0.82 + hashUnit(`${key}:cell:${index}`) * 0.26;
    const r = radius * wobble;
    ctx.lineTo(center.x + Math.cos(angle) * r, center.y + Math.sin(angle) * r);
  }
  ctx.closePath();
}

function drawActivityTissue(box, key) {
  const center = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
  const radiusX = box.width / 2;
  const radiusY = box.height / 2;
  const points = 14;
  ctx.moveTo(center.x + radiusX, center.y);
  for (let index = 1; index <= points; index += 1) {
    const angle = (index / points) * Math.PI * 2;
    const wobble = 0.86 + hashUnit(`${key}:tissue:${index}`) * 0.22;
    ctx.lineTo(
      center.x + Math.cos(angle) * radiusX * wobble,
      center.y + Math.sin(angle) * radiusY * wobble,
    );
  }
  ctx.closePath();
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const rgb = [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function hashUnit(value) {
  return hashString(value) / 0xffffffff;
}

function renderActivityFeed() {
  if (!controls.activityFeed) return;
  const latest = [...latestActivityByAgent(state.activity).values()]
    .sort((a, b) => Date.parse(b.timestamp ?? 0) - Date.parse(a.timestamp ?? 0));

  controls.activityFeed.replaceChildren();
  if (latest.length === 0) {
    controls.activityFeed.textContent = "No activity yet.";
    return;
  }

  for (const event of latest.slice(0, 5)) {
    const item = document.createElement("button");
    item.className = "activity-item";
    item.type = "button";
    item.addEventListener("click", () => selectActivityEvent(event));

    const title = document.createElement("strong");
    title.textContent = `${event.agentId}: ${normalizeActivityState(event.activityState)}`;
    const detail = document.createElement("span");
    detail.textContent = activityPathLabel(event);
    item.append(title, detail);
    controls.activityFeed.append(item);
  }
}

function drawSelection(bounds, fill, stroke, dash) {
  const box = screenBounds(bounds);
  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.setLineDash(dash);
  drawRect(box);
  ctx.restore();
}

function drawRect(box) {
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height);
  ctx.fill();
  ctx.stroke();
}

function drawLabel(text, x, y, color, size = 12, weight = "400") {
  ctx.save();
  ctx.font = `${weight} ${size}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function queueLabelInBox(label) {
  const placement = labelPlacement(label.text, label.box, label.size, label.weight);
  if (!placement) return;
  frameLabels.push({ ...label, ...placement });
}

function drawQueuedLabels() {
  const placed = [];
  frameLabels.sort((a, b) => b.priority - a.priority);
  for (const label of frameLabels) {
    if (placed.some((other) => labelBoxesOverlap(label.collisionBox, other))) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(label.box.x, label.box.y, label.box.width, label.box.height);
    ctx.clip();
    drawLabel(label.text, label.x, label.y, label.color, label.size, label.weight);
    ctx.restore();
    placed.push(label.collisionBox);
  }
}

function labelPlacement(text, box, size = 12, weight = "400") {
  const area = screenIntersection(box);
  if (!area || area.width < 56 || area.height < size + 8) return null;

  ctx.save();
  ctx.font = `${weight} ${size}px Inter, system-ui, sans-serif`;
  const width = Math.min(area.width - 12, ctx.measureText(text).width);
  ctx.restore();

  const x = clamp(box.x + 8, area.x + 8, area.x + Math.max(8, area.width - width - 6));
  const naturalY = box.y + size + 5;
  const stickyY = area.y + Math.min(Math.max(size + 8, area.height * 0.35), Math.max(size + 8, area.height - 8));
  const y = clamp(naturalY < area.y + size + 6 ? stickyY : naturalY, area.y + size + 6, area.y + area.height - 8);

  return {
    x,
    y,
    collisionBox: {
      x: x - 3,
      y: y - size - 4,
      width: width + 8,
      height: size + 8,
    },
  };
}

function onWheel(event) {
  event.preventDefault();
  const mouse = screenPoint(event);
  if (event.ctrlKey || event.metaKey) {
    zoomAt(mouse, Math.exp(-normalizeWheelDelta(event.deltaY, event.deltaMode) * 0.0025));
  } else {
    panByWheel(event);
  }
  render();
}

function zoomAt(screenAnchor, factor) {
  state.view = zoomViewAt(state.view, screenAnchor, factor, viewportSize());
}

function panByWheel(event) {
  const deltaX = normalizeWheelDelta(event.deltaX, event.deltaMode);
  const deltaY = normalizeWheelDelta(event.deltaY, event.deltaMode);
  state.view = panViewByScreenDelta(state.view, { x: deltaX, y: deltaY }, viewportSize());
}

function normalizeWheelDelta(delta, deltaMode) {
  if (!Number.isFinite(delta)) return 0;
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * 16;
  if (deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * canvas.clientHeight;
  return delta;
}

function onCanvasKeyDown(event) {
  const keyDeltas = {
    ArrowRight: { x: KEYBOARD_PAN_PIXELS, y: 0 },
    ArrowLeft: { x: -KEYBOARD_PAN_PIXELS, y: 0 },
    ArrowDown: { x: 0, y: KEYBOARD_PAN_PIXELS },
    ArrowUp: { x: 0, y: -KEYBOARD_PAN_PIXELS },
  };
  const delta = keyDeltas[event.key];
  if (delta) {
    event.preventDefault();
    state.view = panViewByScreenDelta(state.view, delta, viewportSize());
    render();
    return;
  }

  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    zoomAt(viewportCenter(), KEYBOARD_ZOOM_FACTOR);
    render();
    return;
  }

  if (event.key === "-" || event.key === "_") {
    event.preventDefault();
    zoomAt(viewportCenter(), 1 / KEYBOARD_ZOOM_FACTOR);
    render();
    return;
  }

  if (event.key === "0") {
    event.preventDefault();
    state.view = { x: 0, y: 0, scale: 1 };
    render();
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    selectMapTarget(screenToWorld(viewportCenter()));
  }
}

function onPointerDown(event) {
  canvas.setPointerCapture(event.pointerId);
  const screen = screenPoint(event);
  const point = screenToWorld(screen);
  state.lastPointerDown = { screen, world: point };
  if (state.drawing) {
    state.selectedTarget = null;
    state.dragging = { type: "draw", start: point, current: point };
    state.draftSelection = { type: "rect", bounds: { x: point.x, y: point.y, width: 0, height: 0 } };
  } else {
    state.dragging = { type: "pan", start: screenPoint(event), view: { ...state.view } };
  }
}

function onPointerMove(event) {
  const screen = screenPoint(event);
  const world = screenToWorld(screen);
  const hit = hitTest(world);
  controls.hover.textContent = hit ? hoverLabel(hit) : `x ${world.x.toFixed(4)}, y ${world.y.toFixed(4)}`;

  if (!state.dragging) return;
  if (state.dragging.type === "pan") {
    const dx = (screen.x - state.dragging.start.x) / (canvas.clientWidth * state.view.scale);
    const dy = (screen.y - state.dragging.start.y) / (canvas.clientHeight * state.view.scale);
    state.view.x = state.dragging.view.x - dx;
    state.view.y = state.dragging.view.y - dy;
  } else {
    state.dragging.current = world;
    state.draftSelection = {
      type: "rect",
      bounds: {
        x: state.dragging.start.x,
        y: state.dragging.start.y,
        width: world.x - state.dragging.start.x,
        height: world.y - state.dragging.start.y,
      },
    };
  }
  render();
}

async function onPointerUp(event) {
  if (state.dragging?.type === "draw" && state.draftSelection) {
    await previewSelection();
  } else if (state.dragging?.type === "pan" && state.lastPointerDown && event) {
    const current = screenPoint(event);
    const moved = Math.hypot(current.x - state.lastPointerDown.screen.x, current.y - state.lastPointerDown.screen.y);
    if (moved < 4) await selectMapTarget(state.lastPointerDown.world);
  }
  state.dragging = null;
}

async function selectMapTarget(worldPoint) {
  const hit = hitTest(worldPoint);
  if (!hit) {
    state.selectedTarget = null;
    setText(controls.inspectorTitle, "No place selected");
    setText(controls.inspectorSubtitle, "Click a district, parcel, or activity marker.");
    setText(controls.sourceTitle, "No file selected");
    setText(controls.sourceOutput, "");
    updateSelectionPopover();
    render();
    return;
  }

  state.selectedTarget = hit;
  if (hit.targetType === "annotation") {
    selectAnnotation(hit);
    return;
  }
  if (hit.targetType === "activity") {
    await selectActivityEvent(hit);
    return;
  }
  clearAnnotationForm();

  setText(controls.inspectorTitle, hit.targetType === "file" ? hit.name : labelForFolder(hit));
  setText(controls.inspectorSubtitle, `${hit.targetType}: ${hit.path || "."} | ${hit.geo.geohash}`);

  if (hit.targetType !== "file") {
    setText(controls.sourceTitle, hit.path || ".");
    setText(controls.sourceOutput, "Folder selected.");
    render();
    return;
  }

  const line = lineAtPoint(hit, worldPoint);
  const lineRatio = (line - 0.5) / Math.max(1, hit.lineCount);
  let box = screenBounds(hit.bounds);
  if (!canRenderSourceText(hit, box)) {
    zoomToReadableFile(hit, lineRatio);
    box = screenBounds(hit.bounds);
  }
  const { start: lineStart, end: lineEnd } = sourcePanelLineRange(hit, line, box);
  const query = `path=${encodeURIComponent(hit.path)}&lineStart=${lineStart}&lineEnd=${lineEnd}`;
  const [address, source] = await Promise.all([
    fetchJson(`/api/resolve?${query}`),
    fetchJson(`/api/source?${query}`),
  ]);

  setText(controls.sourceTitle, `${hit.path} · ${address.deepLink}`);
  setText(controls.sourceOutput, source.lines
    .map((item) => `${String(item.number).padStart(4, " ")}  ${item.text}`)
    .join("\n"));
  if (controls.sourceOutput) controls.sourceOutput.scrollTop = 0;
  render();
}

async function selectActivityEvent(event) {
  state.selectedTarget = { ...event, targetType: "activity" };
  clearAnnotationForm();
  setText(controls.inspectorTitle, `${event.agentId}: ${normalizeActivityState(event.activityState)}`);
  setText(controls.inspectorSubtitle, `activity: ${activityPathLabel(event)} | ${event.address.geohash}`);

  const path = pathFromActivity(event);
  if (!path) {
    setText(controls.sourceTitle, event.address.deepLink);
    setText(controls.sourceOutput, event.note || "Activity selected.");
    render();
    return;
  }

  const lineRange = event.address.lineRange ?? { start: 1, end: undefined };
  const query = `path=${encodeURIComponent(path)}&lineStart=${lineRange.start}&lineEnd=${lineRange.end ?? lineRange.start}`;
  const source = await fetchJson(`/api/source?${query}`);
  setText(controls.sourceTitle, `${path} · ${event.address.deepLink}`);
  setText(controls.sourceOutput, source.lines
    .map((item) => `${String(item.number).padStart(4, " ")}  ${item.text}`)
    .join("\n"));
  if (controls.sourceOutput) controls.sourceOutput.scrollTop = 0;
  render();
}

function selectAnnotation(annotation) {
  state.selectedTarget = { ...annotation, targetType: "annotation" };
  state.draftSelection = null;
  state.resolvedSelection = null;
  if (controls.selectionName) controls.selectionName.value = annotation.name ?? "";
  if (controls.selectionComment) controls.selectionComment.value = annotation.comment ?? "";
  if (controls.saveSelection) controls.saveSelection.disabled = true;
  setText(controls.selectionOutput, annotationSummary(annotation));
  updateSelectionPopover();
  render();
}

function lineAtPoint(file, worldPoint) {
  return lineAtWorldPoint(file, worldPoint);
}

function sourcePanelLineRange(file, focusLine, box) {
  return sourcePanelLineRangeForBox(file, focusLine, box, canvas.clientHeight);
}

async function searchMap(event) {
  event.preventDefault();
  const query = controls.searchInput?.value.trim().toLowerCase();
  if (!query) return;

  const namedPlace = state.namedPlaces.find((place) => place.name.toLowerCase().includes(query));
  if (namedPlace?.geometry?.bounds) {
    zoomToBounds(namedPlace.geometry.bounds, 1.35);
    setSearchResult(namedPlace.kind === "mapAnnotation" ? `Annotation: ${namedPlace.name}` : `Named place: ${namedPlace.name}`);
    state.selectedTarget = namedPlace.kind === "mapAnnotation" ? { ...namedPlace, targetType: "annotation" } : null;
    if (state.selectedTarget?.targetType === "annotation") selectAnnotation(state.selectedTarget);
    render();
    return;
  }

  const file = Object.values(state.map.files).find((candidate) =>
    candidate.path.toLowerCase().includes(query) || candidate.geo.geohash.startsWith(query)
  );
  if (file) {
    zoomToReadableFile(file);
    await selectMapTarget(boundsCenter(file.bounds));
    setSearchResult(`File: ${file.path}`);
    return;
  }

  const folder = Object.values(state.map.folders).find((candidate) =>
    candidate.path.toLowerCase().includes(query) || candidate.geo.geohash.startsWith(query)
  );
  if (folder) {
    zoomToBounds(folder.bounds, 1.6);
    state.selectedTarget = { ...folder, targetType: "folder" };
    setText(controls.inspectorTitle, labelForFolder(folder));
    setText(controls.inspectorSubtitle, `folder: ${folder.path || "."} | ${folder.geo.geohash}`);
    setSearchResult(`Folder: ${folder.path || "."}`);
    render();
    return;
  }

  setSearchResult("No matching place found.");
}

function setSearchResult(message) {
  if (controls.searchResult) controls.searchResult.textContent = message;
}

function setText(element, value) {
  if (element) element.textContent = value;
}

async function previewSelection() {
  const draftSelection = state.draftSelection;
  if (!draftSelection) return;
  const body = {
    name: controls.selectionName?.value || "Preview",
    level: DEFAULT_MAP_LEVEL,
    geometry: draftSelection,
  };
  const resolvedSelection = await postJson("/api/selections/resolve", body);
  if (state.draftSelection !== draftSelection) return;
  state.resolvedSelection = resolvedSelection;
  if (controls.saveSelection) controls.saveSelection.disabled = false;
  setText(controls.selectionOutput, selectionSummary(state.resolvedSelection));
  updateSelectionPopover();
  render();
}

async function saveSelection() {
  if (!state.resolvedSelection) return;
  const saved = await postJson("/api/annotations", {
    name: controls.selectionName?.value || "Annotation",
    comment: controls.selectionComment?.value || "",
    level: DEFAULT_MAP_LEVEL,
    geometry: state.resolvedSelection.geometry,
  });
  state.namedPlaces.push(saved.annotation);
  setText(controls.selectionOutput, annotationSummary(saved.annotation));
  state.selectedTarget = { ...saved.annotation, targetType: "annotation" };
  state.draftSelection = null;
  state.resolvedSelection = null;
  if (controls.saveSelection) controls.saveSelection.disabled = true;
  updateSelectionPopover();
  render();
}

function clearAnnotationForm() {
  if (state.draftSelection || state.resolvedSelection) return;
  if (controls.selectionName) controls.selectionName.value = "";
  if (controls.selectionComment) controls.selectionComment.value = "";
  if (controls.selectionOutput) controls.selectionOutput.textContent = "";
  if (controls.saveSelection) controls.saveSelection.disabled = true;
  updateSelectionPopover();
}

function selectionSummary(selection) {
  return JSON.stringify({
    coveringSet: selection.coveringSet,
    resolvedTargets: selection.resolvedTargets.map(targetLabel).slice(0, 20),
    totalTargets: selection.resolvedTargets.length,
  }, null, 2);
}

function annotationSummary(annotation) {
  return JSON.stringify({
    id: annotation.id,
    coveringSet: annotation.coveringSet,
    resolvedTargets: annotation.resolvedTargets.map(targetLabel).slice(0, 20),
    totalTargets: annotation.resolvedTargets.length,
    codexPrompt: annotation.codexPrompt,
  }, null, 2);
}

async function addActivity(event) {
  event.preventDefault();
  if (!controls.activityForm) return;
  const data = Object.fromEntries(new FormData(controls.activityForm).entries());
  await postJson("/api/activity", {
    agentId: data.agentId,
    activityState: data.activityState,
    path: data.path,
    lineStart: Number(data.lineStart),
    lineEnd: Number(data.lineEnd),
  });
  setTimeout(refreshActivity, 250);
}

function hitTest(point) {
  const annotation = hitTestAnnotation(point);
  if (annotation) return annotation;
  const activity = hitTestActivity(point);
  if (activity) return activity;
  return hitTestTargets(state.map, point);
}

function hitTestAnnotation(point) {
  const radiusX = 15 / (canvas.clientWidth * state.view.scale);
  const radiusY = 15 / (canvas.clientHeight * state.view.scale);
  const annotations = state.namedPlaces
    .filter((place) => place.kind === "mapAnnotation")
    .reverse();
  const annotation = annotations.find((place) => {
    const center = boundsCenter(place.geometry.bounds);
    return Math.abs(point.x - center.x) <= radiusX && Math.abs(point.y - center.y) <= radiusY;
  });
  return annotation ? { ...annotation, targetType: "annotation" } : null;
}

function hitTestActivity(point) {
  if (!layerEnabled("showActivity")) return null;
  const radiusX = 13 / (canvas.clientWidth * state.view.scale);
  const radiusY = 13 / (canvas.clientHeight * state.view.scale);
  const events = [...sortedActivityEvents(state.activity)].reverse();
  const event = events.find((candidate) => {
    return activityFragmentBounds(candidate).some((bounds) => {
      const center = boundsCenter(bounds);
      return Math.abs(point.x - center.x) <= radiusX && Math.abs(point.y - center.y) <= radiusY;
    });
  });
  return event ? { ...event, targetType: "activity" } : null;
}

function zoomToBounds(bounds, paddingFactor = 1.2) {
  state.view = viewForBounds(bounds, viewportSize(), paddingFactor);
}

function zoomToReadableFile(file, lineRatio = 0.5) {
  state.view = viewForReadableFile(file, viewportSize(), lineRatio);
}

function labelForFolder(folder) {
  if (!folder.path) return "Codebase";
  return folder.path.split("/").at(-1);
}

function hoverLabel(hit) {
  if (hit.targetType === "annotation") {
    return `annotation: ${hit.name} | ${hit.coveringSet?.[0] ?? "unresolved"}`;
  }
  if (hit.targetType === "activity") {
    return `activity: ${hit.agentId} ${normalizeActivityState(hit.activityState)} | ${hit.address.geohash}`;
  }
  return `${hit.targetType}: ${hit.path} | ${hit.geo.geohash}`;
}

function targetLabel(target) {
  if (target.tokenRange) {
    return `${target.path}:${target.lineRange.start}-${target.lineRange.end}@${target.tokenRange.start}-${target.tokenRange.end}`;
  }
  if (target.lineRange) return `${target.path}:${target.lineRange.start}-${target.lineRange.end}`;
  return target.path;
}

function activityPathLabel(event) {
  const path = pathFromActivity(event);
  const lines = event.address.lineRange ? `:${event.address.lineRange.start}-${event.address.lineRange.end}` : "";
  const columns = event.address.tokenRange ? `@${event.address.tokenRange.start}-${event.address.tokenRange.end}` : "";
  return `${path || event.address.deepLink}${lines}${columns}`;
}

function pathFromActivity(event) {
  const deepLink = event.address?.deepLink;
  if (!deepLink) return "";
  try {
    return new URL(deepLink).searchParams.get("path") ?? "";
  } catch {
    return "";
  }
}

function worldToScreen(point) {
  return worldToScreenPoint(point, state.view, viewportSize());
}

function screenToWorld(point) {
  return screenToWorldPoint(point, state.view, viewportSize());
}

function screenBounds(bounds) {
  return screenBoundsForView(bounds, state.view, viewportSize());
}

function screenPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clamp(event.clientX - rect.left, 0, rect.width),
    y: clamp(event.clientY - rect.top, 0, rect.height),
  };
}

function visible(box) {
  return isScreenBoxVisible(box, viewportSize());
}

function screenIntersection(box) {
  const x1 = Math.max(0, box.x);
  const y1 = Math.max(0, box.y);
  const x2 = Math.min(canvas.clientWidth, box.x + box.width);
  const y2 = Math.min(canvas.clientHeight, box.y + box.height);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function boundsCenter(bounds) {
  return modelBoundsCenter(bounds);
}

function viewportSize() {
  return { width: canvas.clientWidth, height: canvas.clientHeight };
}

function viewportCenter() {
  return { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
