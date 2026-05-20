const canvas = document.querySelector("#mapCanvas");
const ctx = canvas.getContext("2d");
const mapArea = document.querySelector(".map-area");
const SOURCE_TEXT_MIN_LINE_HEIGHT = 14;
const SOURCE_TEXT_MIN_WIDTH = 260;
const SOURCE_TEXT_MAX_LINES_PER_FRAME = 200;
const SOURCE_TEXT_PREFETCH_LINES = 12;
const SOURCE_CACHE_LIMIT = 80;
const SOURCE_TEXT_ZOOM_HEADROOM = 1.08;

const state = {
  map: null,
  namedPlaces: [],
  overlaps: [],
  activity: [],
  sourceCache: new Map(),
  pendingSourceRequests: new Set(),
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
  showFiles: document.querySelector("#showFiles"),
  showNames: document.querySelector("#showNames"),
  showActivity: document.querySelector("#showActivity"),
  showGrid: document.querySelector("#showGrid"),
  activityForm: document.querySelector("#activityForm"),
};

await boot();

async function boot() {
  const [map, names, activity] = await Promise.all([
    fetchJson("/api/map"),
    fetchJson("/api/named-places"),
    fetchJson("/api/activity"),
  ]);
  state.map = map;
  state.namedPlaces = names.places;
  state.overlaps = names.overlaps ?? [];
  state.activity = activity.events;
  controls.summary.textContent = `${Object.keys(map.files).length} files, ${Object.keys(map.folders).length} folders`;
  bindEvents();
  resize();
  render();
}

function bindEvents() {
  window.addEventListener("resize", () => {
    resize();
    render();
  });

  for (const control of [controls.mapLevel, controls.showFolders, controls.showFiles, controls.showNames, controls.showActivity, controls.showGrid]) {
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
  ctx.clearRect(0, 0, rect.width, rect.height);
  controls.viewport.textContent = `scale ${state.view.scale.toFixed(2)} | level ${controls.mapLevel.value}`;

  drawCompassRose();
  if (controls.showGrid.checked) drawGrid();
  if (controls.showFolders.checked) drawFolders();
  if (controls.showFiles.checked) drawFiles();
  if (controls.showNames.checked) drawNamedPlaces();
  if (controls.showNames.checked) drawOverlaps();
  if (state.draftSelection) drawSelection(state.draftSelection.bounds, "rgba(245, 158, 11, 0.18)", "#f59e0b", [6, 4]);
  if (controls.showActivity.checked) drawActivity();
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
    const depth = folder.path.split("/").length;
    ctx.fillStyle = depth <= 2 ? "rgba(132, 178, 156, 0.16)" : "rgba(132, 178, 156, 0.08)";
    ctx.strokeStyle = depth <= 2 ? "rgba(49, 101, 69, 0.46)" : "rgba(49, 101, 69, 0.22)";
    ctx.lineWidth = depth <= 2 ? 1.6 : 1;
    drawRect(box);
    if (box.width > 90 && box.height > 28) drawLabel(labelForFolder(folder), box.x + 8, box.y + 18, "rgba(33, 79, 57, 0.76)", 13, "600");
  }
}

function drawFiles() {
  let renderedSourceLines = 0;
  for (const file of Object.values(state.map.files)) {
    const box = screenBounds(file.bounds);
    if (!visible(box)) continue;
    const selected = state.selectedTarget?.path === file.path;
    const landmark = box.width > 110 && box.height > 34;
    const visibleParcel = selected || landmark || state.view.scale > 1.8 || (box.width > 42 && box.height > 18);
    if (!visibleParcel) continue;

    ctx.fillStyle = selected ? "rgba(255, 255, 255, 0.82)" : "rgba(235, 248, 241, 0.48)";
    ctx.strokeStyle = selected ? "rgba(180, 84, 24, 0.95)" : "rgba(18, 128, 98, 0.34)";
    ctx.lineWidth = selected ? 2.6 : state.view.scale > 2.2 ? 1 : 0.65;
    drawRect(box);
    if (selected || landmark || (state.view.scale > 2.2 && box.width > 78 && box.height > 24)) {
      drawLabel(file.name, box.x + 6, box.y + 16, "rgba(3, 87, 67, 0.84)", 12, "500");
    }
    if (canRenderSourceText(file, box) && renderedSourceLines < SOURCE_TEXT_MAX_LINES_PER_FRAME) {
      renderedSourceLines += drawSourceText(file, box, SOURCE_TEXT_MAX_LINES_PER_FRAME - renderedSourceLines);
    } else if (state.view.scale > 6 && box.height > 34) {
      drawLineBands(file, box);
    }
  }
}

function canRenderSourceText(file, box) {
  return box.width >= SOURCE_TEXT_MIN_WIDTH
    && lineHeightForFile(file, box) >= SOURCE_TEXT_MIN_LINE_HEIGHT
    && file.lineCount > 0;
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
  const viewportTop = 0;
  const viewportBottom = canvas.clientHeight;
  const top = Math.max(box.y, viewportTop);
  const bottom = Math.min(box.y + box.height, viewportBottom);
  if (bottom <= top) return null;

  const startRatio = clamp((top - box.y) / box.height, 0, 1);
  const endRatio = clamp((bottom - box.y) / box.height, 0, 1);
  return {
    start: Math.max(1, Math.floor(startRatio * file.lineCount) + 1),
    end: Math.min(file.lineCount, Math.ceil(endRatio * file.lineCount)),
  };
}

function lineHeightForFile(file, box) {
  return box.height / Math.max(1, file.lineCount);
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
  const latestByAgent = new Map();
  for (const event of state.activity) latestByAgent.set(event.agentId, event);
  for (const event of latestByAgent.values()) {
    const center = boundsCenter(event.address.bounds);
    const p = worldToScreen(center);
    ctx.fillStyle = "#e11d48";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    drawLabel(`${event.agentId}: ${event.activityState}`, p.x + 10, p.y - 8, "#9f1239");
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
  const before = screenToWorld(screenAnchor);
  state.view.scale = clamp(state.view.scale * factor, 0.65, 80);
  const after = screenToWorld(screenAnchor);
  state.view.x += before.x - after.x;
  state.view.y += before.y - after.y;
}

function panByWheel(event) {
  const deltaX = normalizeWheelDelta(event.deltaX, event.deltaMode);
  const deltaY = normalizeWheelDelta(event.deltaY, event.deltaMode);
  state.view.x += deltaX / (canvas.clientWidth * state.view.scale);
  state.view.y += deltaY / (canvas.clientHeight * state.view.scale);
}

function normalizeWheelDelta(delta, deltaMode) {
  if (!Number.isFinite(delta)) return 0;
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * 16;
  if (deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * canvas.clientHeight;
  return delta;
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
  controls.hover.textContent = hit ? `${hit.targetType}: ${hit.path} | ${hit.geo.geohash}` : `x ${world.x.toFixed(4)}, y ${world.y.toFixed(4)}`;

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
  controls.inspectorTitle.textContent = hit.targetType === "file" ? hit.name : labelForFolder(hit);
  controls.inspectorSubtitle.textContent = `${hit.targetType}: ${hit.path || "."} | ${hit.geo.geohash}`;

  if (hit.targetType !== "file") {
    controls.sourceTitle.textContent = hit.path || ".";
    controls.sourceOutput.textContent = "Folder selected.";
    render();
    return;
  }

  const rawLine = ((worldPoint.y - hit.bounds.y) / hit.bounds.height) * hit.lineCount;
  const line = Math.max(1, Math.min(hit.lineCount, Math.floor(rawLine) + 1));
  const lineRatio = (line - 0.5) / Math.max(1, hit.lineCount);
  if (!canRenderSourceText(hit, screenBounds(hit.bounds))) zoomToReadableFile(hit, lineRatio);
  const lineStart = Math.max(1, line - 12);
  const lineEnd = Math.min(hit.lineCount, line + 24);
  const query = `path=${encodeURIComponent(hit.path)}&lineStart=${lineStart}&lineEnd=${lineEnd}`;
  const [address, source] = await Promise.all([
    fetchJson(`/api/resolve?${query}`),
    fetchJson(`/api/source?${query}`),
  ]);

  controls.sourceTitle.textContent = `${hit.path} · ${address.deepLink}`;
  controls.sourceOutput.textContent = source.lines
    .map((item) => `${String(item.number).padStart(4, " ")}  ${item.text}`)
    .join("\n");
  render();
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
  const created = await postJson("/api/activity", {
    agentId: data.agentId,
    activityState: data.activityState,
    path: data.path,
    lineStart: Number(data.lineStart),
    lineEnd: Number(data.lineEnd),
  });
  state.activity.push(created);
  render();
}

function hitTest(point) {
  const files = Object.values(state.map.files).filter((file) => contains(file.bounds, point));
  if (files.length > 0) return { ...files.sort(smallerArea)[0], targetType: "file" };
  const folders = Object.values(state.map.folders).filter((folder) => folder.path && contains(folder.bounds, point));
  if (folders.length > 0) return { ...folders.sort(smallerArea)[0], targetType: "folder" };
  return null;
}

function zoomToBounds(bounds, paddingFactor = 1.2) {
  const scaleX = 1 / Math.max(bounds.width * paddingFactor, 0.001);
  const scaleY = 1 / Math.max(bounds.height * paddingFactor, 0.001);
  const scale = clamp(Math.min(scaleX, scaleY), 0.65, 80);
  state.view.scale = scale;
  state.view.x = bounds.x + bounds.width / 2 - 0.5 / scale;
  state.view.y = bounds.y + bounds.height / 2 - 0.5 / scale;
}

function zoomToReadableFile(file, lineRatio = 0.5) {
  const widthScale = SOURCE_TEXT_MIN_WIDTH / Math.max(file.bounds.width * canvas.clientWidth, 0.001);
  const lineScale = (SOURCE_TEXT_MIN_LINE_HEIGHT * Math.max(1, file.lineCount)) / Math.max(file.bounds.height * canvas.clientHeight, 0.001);
  const scale = clamp(Math.max(widthScale, lineScale) * SOURCE_TEXT_ZOOM_HEADROOM, 0.65, 80);
  const screenWidth = file.bounds.width * canvas.clientWidth * scale;
  const focusX = file.bounds.x + file.bounds.width / 2;
  const focusY = file.bounds.y + file.bounds.height * clamp(lineRatio, 0, 1);
  state.view.scale = scale;
  state.view.x = screenWidth > canvas.clientWidth * 0.9
    ? file.bounds.x - 24 / (canvas.clientWidth * scale)
    : focusX - 0.5 / scale;
  state.view.y = focusY - 0.5 / scale;
}

function labelForFolder(folder) {
  if (!folder.path) return "Codebase";
  return folder.path.split("/").at(-1);
}

function worldToScreen(point) {
  return {
    x: (point.x - state.view.x) * canvas.clientWidth * state.view.scale,
    y: (point.y - state.view.y) * canvas.clientHeight * state.view.scale,
  };
}

function screenToWorld(point) {
  return {
    x: point.x / (canvas.clientWidth * state.view.scale) + state.view.x,
    y: point.y / (canvas.clientHeight * state.view.scale) + state.view.y,
  };
}

function screenBounds(bounds) {
  const p = worldToScreen({ x: bounds.x, y: bounds.y });
  return {
    x: p.x,
    y: p.y,
    width: bounds.width * canvas.clientWidth * state.view.scale,
    height: bounds.height * canvas.clientHeight * state.view.scale,
  };
}

function screenPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clamp(event.clientX - rect.left, 0, rect.width),
    y: clamp(event.clientY - rect.top, 0, rect.height),
  };
}

function visible(box) {
  return box.x + box.width >= 0 && box.y + box.height >= 0 && box.x <= canvas.clientWidth && box.y <= canvas.clientHeight;
}

function boundsCenter(bounds) {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

function contains(bounds, point) {
  return point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height;
}

function smallerArea(a, b) {
  return a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height;
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
