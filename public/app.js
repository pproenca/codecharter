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
};

const controls = {
  summary: document.querySelector("#mapSummary"),
  hover: document.querySelector("#hoverReadout"),
  viewport: document.querySelector("#viewportReadout"),
  mapLevel: document.querySelector("#mapLevel"),
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

  for (const control of [controls.mapLevel, controls.showFolders, controls.showFiles, controls.showNames, controls.showActivity]) {
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

  drawGrid();
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

function drawFolders() {
  for (const folder of Object.values(state.map.folders)) {
    if (!folder.path) continue;
    const box = screenBounds(folder.bounds);
    if (!visible(box)) continue;
    ctx.fillStyle = "rgba(219, 234, 254, 0.22)";
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 1;
    drawRect(box);
    if (box.width > 58 && box.height > 18) drawLabel(folder.path, box.x + 5, box.y + 14, "#1d4ed8");
  }
}

function drawFiles() {
  for (const file of Object.values(state.map.files)) {
    const box = screenBounds(file.bounds);
    if (!visible(box)) continue;
    ctx.fillStyle = "rgba(236, 253, 245, 0.72)";
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 1;
    drawRect(box);
    if (box.width > 46 && box.height > 16) drawLabel(file.name, box.x + 4, box.y + 13, "#047857");
    if (state.view.scale > 8 && box.height > 30) drawLineBands(file, box);
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

function drawLabel(text, x, y, color) {
  ctx.save();
  ctx.font = "12px Inter, system-ui, sans-serif";
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
    controls.sourceTitle.textContent = "No file selected";
    controls.sourceOutput.textContent = "";
    return;
  }

  if (hit.targetType !== "file") {
    controls.sourceTitle.textContent = hit.path || ".";
    controls.sourceOutput.textContent = "Folder selected.";
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
