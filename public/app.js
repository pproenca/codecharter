import {
  SOURCE_CACHE_LIMIT,
  SOURCE_TEXT_MAX_LINES_PER_FRAME,
  SOURCE_TEXT_PREFETCH_LINES,
  activityStateStyle,
  boundsCenter as modelBoundsCenter,
  canRenderSourceText,
  fileLabelPriority,
  fileVisualState,
  folderDepth,
  folderLabelPriority,
  folderStyle,
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
  inspectorTitle: document.querySelector("#inspectorTitle"),
  inspectorSubtitle: document.querySelector("#inspectorSubtitle"),
  searchForm: document.querySelector("#searchForm"),
  searchInput: document.querySelector("#searchInput"),
  searchResult: document.querySelector("#searchResult"),
  mapLevel: document.querySelector("#mapLevel"),
  zoomIn: document.querySelector("#zoomIn"),
  zoomOut: document.querySelector("#zoomOut"),
  drawTool: document.querySelector("#drawTool"),
  resetView: document.querySelector("#resetView"),
  saveSelection: document.querySelector("#saveSelection"),
  selectionName: document.querySelector("#selectionName"),
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
  controls.summary.textContent = `${Object.keys(map.files).length} files, ${Object.keys(map.folders).length} folders`;
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
    controls.mapLevel,
    controls.showFolders,
    controls.showOrganicRegions,
    controls.showFiles,
    controls.showNames,
    controls.showActivity,
    controls.showGrid,
  ]) {
    control.addEventListener("change", render);
  }

  controls.drawTool.addEventListener("click", () => {
    setDrawMode(!state.drawing);
    render();
  });

  controls.resetView.addEventListener("click", () => {
    state.view = { x: 0, y: 0, scale: 1 };
    render();
  });
  controls.zoomIn.addEventListener("click", () => {
    zoomAt({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, 1.6);
    render();
  });
  controls.zoomOut.addEventListener("click", () => {
    zoomAt({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, 1 / 1.6);
    render();
  });

  controls.searchForm.addEventListener("submit", searchMap);
  controls.saveSelection.addEventListener("click", saveSelection);
  controls.activityForm.addEventListener("submit", addActivity);

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
  controls.drawTool.classList.toggle("active", enabled);
  if (!enabled) clearDraftSelection();
}

function clearDraftSelection() {
  state.dragging = null;
  state.draftSelection = null;
  state.resolvedSelection = null;
  controls.saveSelection.disabled = true;
  controls.selectionOutput.textContent = "Draw an area to resolve files.";
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
  controls.viewport.textContent = `scale ${state.view.scale.toFixed(2)} | level ${controls.mapLevel.value}`;

  drawCompassRose();
  if (controls.showGrid.checked) drawGrid();
  if (controls.showFolders.checked) drawFolders();
  if (controls.showOrganicRegions.checked) drawOrganicRegions();
  if (controls.showFiles.checked) drawFiles();
  drawQueuedLabels();
  if (controls.showNames.checked) drawNamedPlaces();
  if (controls.showNames.checked) drawOverlaps();
  if (state.draftSelection) drawSelection(state.draftSelection.bounds, "rgba(245, 158, 11, 0.18)", "#f59e0b", [6, 4]);
  if (controls.showActivity.checked) drawActivity();
  renderActivityFeed();
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
  for (const place of state.namedPlaces) {
    if (place.kind !== "drawnSelection") continue;
    drawSelection(place.geometry.bounds, "rgba(245, 158, 11, 0.08)", "#f59e0b", []);
    const box = screenBounds(place.geometry.bounds);
    drawLabel(place.name, box.x + 6, box.y + 16, "#92400e");
  }
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
  drawActivityTrails(events, latestByAgent);

  for (const event of events) {
    const latest = latestByAgent.get(event.agentId) === event;
    const center = boundsCenter(event.address.bounds);
    const p = worldToScreen(center);
    const activityState = normalizeActivityState(event.activityState);
    const style = activityStateStyle(activityState);
    const selected = state.selectedTarget?.targetType === "activity" && state.selectedTarget.id === event.id;
    ctx.save();
    ctx.globalAlpha = latest ? 1 : 0.28;
    ctx.fillStyle = style.fill;
    ctx.strokeStyle = selected ? "#111827" : style.stroke;
    ctx.lineWidth = selected ? 3 : latest ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, latest ? 7 : 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (latest) {
      ctx.globalAlpha = 0.16;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      drawLabel(`${event.agentId}: ${activityState}`, p.x + 10, p.y - 8, style.label, 12, "700");
    }
    ctx.restore();
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
    const style = activityStateStyle(normalizeActivityState(latest?.activityState));
    ctx.save();
    ctx.strokeStyle = style.fill;
    ctx.globalAlpha = 0.34;
    ctx.lineWidth = 2;
    ctx.beginPath();
    agentEvents.forEach((event, index) => {
      const p = worldToScreen(boundsCenter(event.address.bounds));
      if (index === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    ctx.restore();
  }
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
    controls.inspectorTitle.textContent = "No place selected";
    controls.inspectorSubtitle.textContent = "Click a district, parcel, or activity marker.";
    controls.sourceTitle.textContent = "No file selected";
    controls.sourceOutput.textContent = "";
    render();
    return;
  }

  state.selectedTarget = hit;
  if (hit.targetType === "activity") {
    await selectActivityEvent(hit);
    return;
  }

  controls.inspectorTitle.textContent = hit.targetType === "file" ? hit.name : labelForFolder(hit);
  controls.inspectorSubtitle.textContent = `${hit.targetType}: ${hit.path || "."} | ${hit.geo.geohash}`;

  if (hit.targetType !== "file") {
    controls.sourceTitle.textContent = hit.path || ".";
    controls.sourceOutput.textContent = "Folder selected.";
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

  controls.sourceTitle.textContent = `${hit.path} · ${address.deepLink}`;
  controls.sourceOutput.textContent = source.lines
    .map((item) => `${String(item.number).padStart(4, " ")}  ${item.text}`)
    .join("\n");
  controls.sourceOutput.scrollTop = 0;
  render();
}

async function selectActivityEvent(event) {
  state.selectedTarget = { ...event, targetType: "activity" };
  controls.inspectorTitle.textContent = `${event.agentId}: ${normalizeActivityState(event.activityState)}`;
  controls.inspectorSubtitle.textContent = `activity: ${activityPathLabel(event)} | ${event.address.geohash}`;

  const path = pathFromActivity(event);
  if (!path) {
    controls.sourceTitle.textContent = event.address.deepLink;
    controls.sourceOutput.textContent = event.note || "Activity selected.";
    render();
    return;
  }

  const lineRange = event.address.lineRange ?? { start: 1, end: undefined };
  const query = `path=${encodeURIComponent(path)}&lineStart=${lineRange.start}&lineEnd=${lineRange.end ?? lineRange.start}`;
  const source = await fetchJson(`/api/source?${query}`);
  controls.sourceTitle.textContent = `${path} · ${event.address.deepLink}`;
  controls.sourceOutput.textContent = source.lines
    .map((item) => `${String(item.number).padStart(4, " ")}  ${item.text}`)
    .join("\n");
  controls.sourceOutput.scrollTop = 0;
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
  const query = controls.searchInput.value.trim().toLowerCase();
  if (!query) return;

  const namedPlace = state.namedPlaces.find((place) => place.name.toLowerCase().includes(query));
  if (namedPlace?.geometry?.bounds) {
    zoomToBounds(namedPlace.geometry.bounds, 1.35);
    controls.searchResult.textContent = `Named place: ${namedPlace.name}`;
    state.selectedTarget = null;
    render();
    return;
  }

  const file = Object.values(state.map.files).find((candidate) =>
    candidate.path.toLowerCase().includes(query) || candidate.geo.geohash.startsWith(query)
  );
  if (file) {
    zoomToReadableFile(file);
    await selectMapTarget(boundsCenter(file.bounds));
    controls.searchResult.textContent = `File: ${file.path}`;
    return;
  }

  const folder = Object.values(state.map.folders).find((candidate) =>
    candidate.path.toLowerCase().includes(query) || candidate.geo.geohash.startsWith(query)
  );
  if (folder) {
    zoomToBounds(folder.bounds, 1.6);
    state.selectedTarget = { ...folder, targetType: "folder" };
    controls.inspectorTitle.textContent = labelForFolder(folder);
    controls.inspectorSubtitle.textContent = `folder: ${folder.path || "."} | ${folder.geo.geohash}`;
    controls.searchResult.textContent = `Folder: ${folder.path || "."}`;
    render();
    return;
  }

  controls.searchResult.textContent = "No matching place found.";
}

async function previewSelection() {
  const draftSelection = state.draftSelection;
  if (!draftSelection) return;
  const body = {
    name: controls.selectionName.value || "Preview",
    level: controls.mapLevel.value,
    geometry: draftSelection,
  };
  const resolvedSelection = await postJson("/api/selections/resolve", body);
  if (state.draftSelection !== draftSelection) return;
  state.resolvedSelection = resolvedSelection;
  controls.saveSelection.disabled = false;
  controls.selectionOutput.textContent = JSON.stringify({
    coveringSet: state.resolvedSelection.coveringSet,
    resolvedTargets: state.resolvedSelection.resolvedTargets.slice(0, 20),
    totalTargets: state.resolvedSelection.resolvedTargets.length,
  }, null, 2);
  render();
}

async function saveSelection() {
  if (!state.resolvedSelection) return;
  const saved = await postJson("/api/named-places", {
    name: controls.selectionName.value || "Named Area",
    level: controls.mapLevel.value,
    geometry: state.resolvedSelection.geometry,
  });
  state.namedPlaces.push(saved.place);
  state.overlaps = saved.overlaps ?? [];
  controls.selectionOutput.textContent = `Saved ${saved.place.name}\n${saved.place.coveringSet.join(", ")}\nOverlaps: ${state.overlaps.length}`;
  state.draftSelection = null;
  state.resolvedSelection = null;
  controls.saveSelection.disabled = true;
  render();
}

async function addActivity(event) {
  event.preventDefault();
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
  const activity = hitTestActivity(point);
  if (activity) return activity;
  return hitTestTargets(state.map, point);
}

function hitTestActivity(point) {
  if (!controls.showActivity.checked) return null;
  const radiusX = 13 / (canvas.clientWidth * state.view.scale);
  const radiusY = 13 / (canvas.clientHeight * state.view.scale);
  const events = [...sortedActivityEvents(state.activity)].reverse();
  const event = events.find((candidate) => {
    const center = boundsCenter(candidate.address.bounds);
    return Math.abs(point.x - center.x) <= radiusX && Math.abs(point.y - center.y) <= radiusY;
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
  if (hit.targetType === "activity") {
    return `activity: ${hit.agentId} ${normalizeActivityState(hit.activityState)} | ${hit.address.geohash}`;
  }
  return `${hit.targetType}: ${hit.path} | ${hit.geo.geohash}`;
}

function activityPathLabel(event) {
  const path = pathFromActivity(event);
  const lines = event.address.lineRange ? `:${event.address.lineRange.start}-${event.address.lineRange.end}` : "";
  return `${path || event.address.deepLink}${lines}`;
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
