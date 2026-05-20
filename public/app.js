const canvas = document.querySelector("#mapCanvas");
const ctx = canvas.getContext("2d");
const mapArea = document.querySelector(".map-area");

const state = {
  map: null,
  namedPlaces: [],
  overlaps: [],
  activity: [],
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
    state.drawing = !state.drawing;
    controls.drawTool.classList.toggle("active", state.drawing);
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
    if (state.view.scale > 6 && box.height > 34) drawLineBands(file, box);
  }
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
    zoomToBounds(file.bounds, 3.2);
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
  const body = {
    name: controls.selectionName.value || "Preview",
    level: controls.mapLevel.value,
    geometry: state.draftSelection,
  };
  state.resolvedSelection = await postJson("/api/selections/resolve", body);
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
