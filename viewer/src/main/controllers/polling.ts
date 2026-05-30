/**
 * Map + activity polling lifecycle. Owns the two PollingTask instances, the
 * pollingErrors backoff map, and all URL/signature helpers. The semantic state
 * fields (activity, activitySignature, activityVersion, activityDetail,
 * mapVersion, overlaps) stay in app state and are accessed through injected
 * getters/setters so this controller holds no second identity model. The error
 * notice control (controls.hover text) is reached through the injected
 * setHoverText callback, keeping the controller DOM-free.
 *
 * `activitySignature` is a pure function (no state access); app.ts also calls it
 * directly during boot/clear before the controller's other deps matter.
 */

import type { ActivityEvent, Bounds, CodecharterMap, NamedPlace } from "../render/types.ts";

type TimerHandle = number | ReturnType<typeof setTimeout> | null;
type PollingTask = {
  start(callback: () => void | Promise<void>, intervalMs: number): void;
  stop(): void;
};
type PollingFailure = { count: number; lastLoggedAt: number };
type ActivityDetail = "summary" | "full";
type MapVersionResponse = { version?: string };
type NamedPlacesResponse = { places: NamedPlace[]; overlaps?: Array<{ bounds: Bounds }> };
type ActivityResponse = { events?: ActivityEvent[]; version?: string; unchanged?: true };

const POLLING_ERROR_NOTICE_THRESHOLD = 2;

function createPollingTask(): PollingTask {
  let timer: TimerHandle = null;
  const stop = () => {
    if (timer) {
      clearInterval(timer);
    }
    timer = null;
  };
  return {
    start(callback: () => void | Promise<void>, intervalMs: number) {
      stop();
      timer = setInterval(callback, intervalMs);
    },
    stop,
  };
}

export type PollingControllerDeps = {
  // --- activity state (read + write) ---
  getActivityDetail: () => ActivityDetail;
  setActivityDetail: (detail: ActivityDetail) => void;
  getActivityVersion: () => string;
  setActivityVersion: (version: string) => void;
  getActivitySignature: () => string;
  setActivitySignature: (sig: string) => void;
  setActivity: (events: ActivityEvent[]) => void;
  // --- map state (read + write) ---
  getMapVersion: () => string;
  setOverlaps: (overlaps: Array<{ bounds: Bounds }>) => void;
  // --- discovery toggle (read-only) ---
  activityDiscoveryEnabled: () => boolean;
  // --- app-owned side-effects ---
  fetchJson: <T = unknown>(url: string) => Promise<T>;
  applyMap: (map: CodecharterMap, version: string | undefined) => void;
  setNamedPlaces: (places: NamedPlace[]) => void;
  rebuildActivityFog: () => void;
  render: () => void;
  /** setText(controls.hover, msg) — "Reconnecting..." / "Reconnected" */
  setHoverText: (message: string) => void;
};

export type PollingController = ReturnType<typeof createPollingController>;

export function createPollingController(deps: PollingControllerDeps) {
  const pollingErrors = new Map<string, PollingFailure>();
  const activityPolling = createPollingTask();
  const mapPolling = createPollingTask();

  function startActivityPolling() {
    activityPolling.start(refreshActivity, 1800);
  }

  function startMapPolling() {
    mapPolling.start(refreshMap, 1800);
  }

  async function refreshMap() {
    try {
      const mapVersion = await deps.fetchJson<MapVersionResponse>("/api/map-version");
      clearPollingError("map");
      if (!mapVersion.version || mapVersion.version === deps.getMapVersion()) {
        return;
      }
      const [map, names] = await Promise.all([
        deps.fetchJson<CodecharterMap>("/api/map"),
        deps.fetchJson<NamedPlacesResponse>("/api/named-places"),
      ]);
      deps.applyMap(map, mapVersion.version);
      deps.setNamedPlaces(names.places);
      deps.setOverlaps(names.overlaps ?? []);
      deps.render();
    } catch (error) {
      reportPollingError("map", error);
    }
  }

  async function refreshActivity() {
    try {
      const changed = await loadActivity(deps.activityDiscoveryEnabled() ? "full" : "summary");
      if (changed) {
        deps.render();
      }
    } catch (error) {
      reportPollingError("activity", error);
    }
  }

  async function handleActivityToggle() {
    if (deps.activityDiscoveryEnabled()) {
      await loadActivity("full", { force: deps.getActivityDetail() !== "full" });
    } else if (deps.getActivityDetail() !== "summary") {
      await loadActivity("summary", { force: true });
    }
    deps.render();
  }

  async function loadActivity(detail: ActivityDetail, { force = false } = {}) {
    const activity = await deps.fetchJson<ActivityResponse>(activityRequestUrl(detail, { force }));
    clearPollingError("activity");
    if (activity.unchanged === true) {
      return false;
    }
    const events = activity.events ?? [];
    const nextSignature = activitySignature(events);
    const nextVersion = typeof activity.version === "string" ? activity.version : nextSignature;
    const replacingDetail = force || deps.getActivityDetail() !== detail;
    deps.setActivityVersion(nextVersion);
    deps.setActivityDetail(detail);
    if (!replacingDetail && nextSignature === deps.getActivitySignature()) {
      if (events.length) {
        deps.rebuildActivityFog();
      }
      return events.length > 0;
    }
    deps.setActivity(events);
    deps.setActivitySignature(nextSignature);
    deps.rebuildActivityFog();
    return true;
  }

  function activityRequestUrl(detail: ActivityDetail, { force = false } = {}) {
    const params = new URLSearchParams({ view: "viewer", detail });
    const activityVersion = deps.getActivityVersion();
    if (!force && activityVersion && deps.getActivityDetail() === detail) {
      params.set("version", activityVersion);
    }
    return `/api/activity?${params.toString()}`;
  }

  function reportPollingError(key: string, error: unknown) {
    const failure = pollingErrors.get(key) ?? { count: 0, lastLoggedAt: 0 };
    failure.count += 1;
    const now = Date.now();
    if (failure.count === POLLING_ERROR_NOTICE_THRESHOLD) {
      deps.setHoverText("Reconnecting...");
    }
    if (failure.count === 1 || now - failure.lastLoggedAt > 15000) {
      console.warn(error);
      failure.lastLoggedAt = now;
    }
    pollingErrors.set(key, failure);
  }

  function clearPollingError(key: string) {
    if (!pollingErrors.has(key)) {
      return;
    }
    pollingErrors.delete(key);
    if (pollingErrors.size === 0) {
      deps.setHoverText("Reconnected");
    }
  }

  return {
    startActivityPolling,
    startMapPolling,
    handleActivityToggle,
    refreshActivity,
    activityRequestUrl,
    activitySignature,
  };
}

export function activitySignature(events: ActivityEvent[]): string {
  const latest = events.at(-1);
  return `${events.length}:${latest?.id ?? ""}:${latest?.timestamp ?? ""}`;
}
