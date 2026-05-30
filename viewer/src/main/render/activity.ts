import {
  ACTIVITY_DECAY_HALF_LIFE_MINUTES,
  ACTIVITY_DORMANT_AFTER_MINUTES,
  ACTIVITY_LIVE_WINDOW_MINUTES,
  ACTIVITY_MIN_ALPHA,
  ACTIVITY_TRAIL_MAX_GAP_MINUTES,
  ACTIVITY_TRAIL_MAX_SEGMENT_PX,
  ACTIVITY_TRAIL_MIN_SEGMENT_PX,
  ACTIVITY_TRAIL_TENSION,
} from "./constants.ts";
import { drawMyceliumPathForContext } from "./fog.ts";
import {
  boundsCenter,
  clamp,
  pathFromDeepLink,
  pointDistance,
  sortIfNeeded,
} from "./primitives.ts";
/**
 * Agent-activity visual model (BR-018): age-based decay/dormancy/vitality, marker
 * encoding, trail simplification + curve generation, live-window filtering, and
 * per-agent latest/feed selection. Time inputs accept an explicit `now` so the
 * math is deterministic in tests.
 *
 * The canvas *drawing* counterpart is the {@link createActivityDrawer} factory:
 * it closes over the 2D context and the projection/state accessors that `app.ts`
 * owns and draws membranes/cells/trails/tissue markers plus the activity feed,
 * so the shell stays wiring-only without this module creating a second state
 * model. The pure colour/age helpers (`activityFillColor`, `activityHaloColor`,
 * `formatActivityAge`, `hexToRgba`, `hexRgb`) are exported at module level so
 * they are unit-testable without a deps object; the factory keeps a private
 * hex-RGB cache for the hot draw path.
 */
import type {
  ActivityEvent,
  ActivityFeedItem,
  ActivityFogOptions,
  ActivityHitOptions,
  ActivityState,
  ActivityStateInput,
  ActivitySummary,
  ActivityTissueEncoding,
  Bounds,
  Point,
  TrailSegment,
} from "./types.ts";

export type ActivityEncoding = ReturnType<typeof activityVisualEncoding>;
export type ActivityStyle = ReturnType<typeof activityStateStyle>;

const ACTIVITY_STATES = [
  "reading",
  "editing",
  "testing",
  "reviewing",
] as const satisfies readonly ActivityState[];
const ACTIVITY_STATE_SET: ReadonlySet<string> = new Set(ACTIVITY_STATES);
const ACTIVITY_STATE_STYLES: Record<
  ActivityState,
  { fill: string; stroke: string; label: string }
> = {
  reading: { fill: "#2563eb", stroke: "#dbeafe", label: "#1e3a8a" },
  editing: { fill: "#e11d48", stroke: "#ffe4e6", label: "#9f1239" },
  testing: { fill: "#7c3aed", stroke: "#ede9fe", label: "#4c1d95" },
  reviewing: { fill: "#f59e0b", stroke: "#fef3c7", label: "#92400e" },
};

export function activityActorLabel(event: ActivityEvent): string {
  const thread = event.threadId ?? event.sessionId;
  if (!thread) {
    return event.agentId ?? "agent";
  }
  return `${event.agentId ?? "agent"} ${shortActivityId(thread)}`;
}

export function activityActorKey(event: ActivityEvent): string {
  return `${event.agentId ?? "agent"}:${event.threadId ?? event.sessionId ?? "manual"}`;
}

export function activityPathLabel(event: ActivityEvent): string {
  const path = pathFromDeepLink(event.address?.deepLink);
  const address = event.address;
  const lines = address?.lineRange ? `:${address.lineRange.start}-${address.lineRange.end}` : "";
  const columns = address?.tokenRange
    ? `@${address.tokenRange.start}-${address.tokenRange.end}`
    : "";
  return `${path || (address?.deepLink ?? "")}${lines}${columns}`;
}

export function shortActivityId(value: string): string {
  return String(value).slice(0, 8);
}

export function activityStateStyle(activityState: ActivityStateInput) {
  return ACTIVITY_STATE_STYLES[normalizeActivityState(activityState)];
}

export function normalizeActivityState(activityState: ActivityStateInput): ActivityState {
  if (activityState === "blocked") {
    return "reviewing";
  }
  return isActivityState(activityState) ? activityState : "reading";
}

function isActivityState(activityState: ActivityStateInput): activityState is ActivityState {
  return activityState !== undefined && ACTIVITY_STATE_SET.has(activityState);
}

export function activityVisualEncoding(
  event: ActivityEvent,
  { latest = false, selected = false, now = Date.now() } = {},
) {
  const activityState = normalizeActivityState(event.activityState);
  const ageMinutes = activityAgeMinutes(event, now);
  const decay = 2 ** (-ageMinutes / ACTIVITY_DECAY_HALF_LIFE_MINUTES);
  const vitality = selected ? 1 : clamp(1 - ageMinutes / ACTIVITY_LIVE_WINDOW_MINUTES, 0, 1);
  const dormant = !selected && ageMinutes > ACTIVITY_DORMANT_AFTER_MINUTES;
  const dormancy = selected
    ? 0
    : clamp(
        (ageMinutes - ACTIVITY_DORMANT_AFTER_MINUTES) /
          (ACTIVITY_LIVE_WINDOW_MINUTES - ACTIVITY_DORMANT_AFTER_MINUTES),
        0,
        1,
      );
  const activeAlpha = selected
    ? 1
    : clamp(
        ((latest ? 0.42 : ACTIVITY_MIN_ALPHA) + decay * (latest ? 0.58 : 0.38)) * vitality,
        0,
        1,
      );
  const alpha = dormant ? activeAlpha * (0.38 - dormancy * 0.18) : activeAlpha;
  const activeScale = Math.max(0.55, vitality);
  const dormantScale = 0.42 + (1 - dormancy) * 0.22;
  const presenceScale = selected ? 1 : dormant ? dormantScale : activeScale;

  return {
    activityState,
    active: !dormant,
    dormant,
    selected,
    ageMinutes,
    alpha,
    coreRadius: (selected ? 8 : latest ? 6.5 : 3.8) * presenceScale,
    haloRadius: dormant
      ? (latest ? 8 : 5) * presenceScale
      : (selected ? 28 : latest ? 22 : 12) * presenceScale,
    membraneAlpha: dormant
      ? (selected ? 0.18 : latest ? 0.045 : 0.025) * vitality
      : (selected ? 0.22 : latest ? 0.15 : 0.07) * (selected ? 1 : vitality),
    trailAlpha: dormant
      ? (selected ? 0.36 : latest ? 0.09 : 0.045) * vitality
      : (selected ? 0.72 : latest ? 0.42 : 0.18) * (selected ? 1 : vitality),
    lineWidth: selected ? 3.2 : latest && !dormant ? 2.2 : latest ? 1.15 : 1.1,
  };
}

export function activityTissueBox(
  screenBox: Bounds,
  encoding: ActivityTissueEncoding = {},
): Bounds {
  const minWidth = encoding.selected ? 30 : 18;
  const minHeight = encoding.selected ? 18 : 10;
  const width = Math.max(screenBox.width, minWidth);
  const height = Math.max(screenBox.height, minHeight);
  return {
    x: screenBox.x + screenBox.width / 2 - width / 2,
    y: screenBox.y + screenBox.height / 2 - height / 2,
    width,
    height,
  };
}

export function activityFragmentBounds(event: ActivityEvent): Bounds[] {
  const fragments = event.address?.fragments;
  if (fragments) {
    const bounds: Bounds[] = [];
    for (const { bounds: fragmentBounds } of fragments) {
      if (fragmentBounds) {
        bounds.push(fragmentBounds);
      }
    }
    if (bounds.length) {
      return bounds;
    }
  }
  return event.address?.bounds ? [event.address.bounds] : [];
}

export function activityPrimaryBounds(event: ActivityEvent): Bounds | null {
  return (
    event.address?.fragments?.find((fragment) => fragment.bounds)?.bounds ??
    event.address?.bounds ??
    null
  );
}

export function simplifyTrailPoints(
  points: Point[],
  minDistance = ACTIVITY_TRAIL_MIN_SEGMENT_PX,
): Point[] {
  if (points.length <= 2) {
    return points.slice();
  }
  const first = points[0];
  if (!first) {
    return [];
  }
  const simplified = [first];

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = simplified[simplified.length - 1];
    const point = points[index];
    if (!previous || !point) {
      continue;
    }
    if (pointDistance(previous, point) >= minDistance) {
      simplified.push(point);
    }
  }

  const last = points[points.length - 1];
  const previous = simplified[simplified.length - 1];
  if (!last || !previous) {
    return [];
  }
  if (pointDistance(previous, last) > 0) {
    simplified.push(last);
  }

  return simplified.length > 1 ? simplified : [first, last];
}

export function activityTrailGroups(
  events: ActivityEvent[],
  {
    maxGapMinutes = ACTIVITY_TRAIL_MAX_GAP_MINUTES,
    now = Date.now(),
    maxAgeMinutes = ACTIVITY_LIVE_WINDOW_MINUTES,
    presorted = false,
  } = {},
) {
  const byTrail = new Map<string, ActivityEvent[]>();
  const sortedEvents = presorted
    ? events
    : sortedActivityEvents(events, Number.POSITIVE_INFINITY, { now, maxAgeMinutes });
  for (const event of sortedEvents) {
    if (!activityPrimaryBounds(event)) {
      continue;
    }
    const key = activityActorKey(event);
    const trailEvents = byTrail.get(key);
    if (trailEvents) {
      trailEvents.push(event);
    } else {
      byTrail.set(key, [event]);
    }
  }

  const groups: ActivityEvent[][] = [];
  for (const trailEvents of byTrail.values()) {
    let current: ActivityEvent[] = [];
    for (const event of trailEvents) {
      if (shouldStartActivityTrailGroup(current.at(-1), event, maxGapMinutes)) {
        if (current.length > 1) {
          groups.push(current);
        }
        current = [];
      }
      current.push(event);
    }
    if (current.length > 1) {
      groups.push(current);
    }
  }

  return sortIfNeeded(groups, compareActivityGroupsByTime);
}

export function activityTrailPointGroups(
  points: Point[],
  { maxSegmentDistance = ACTIVITY_TRAIL_MAX_SEGMENT_PX } = {},
) {
  const groups: Point[][] = [];
  let current: Point[] = [];

  for (const point of points) {
    const previous = current.at(-1);
    if (previous && pointDistance(previous, point) > maxSegmentDistance) {
      if (current.length > 1) {
        groups.push(current);
      }
      current = [];
    }
    current.push(point);
  }

  if (current.length > 1) {
    groups.push(current);
  }
  return groups;
}

export function organicTrailSegments(
  points: Point[],
  { minDistance = ACTIVITY_TRAIL_MIN_SEGMENT_PX, tension = ACTIVITY_TRAIL_TENSION } = {},
): TrailSegment[] {
  const trail = simplifyTrailPoints(points, minDistance);
  if (trail.length < 2) {
    return [];
  }

  const segments: TrailSegment[] = [];
  for (let index = 0; index < trail.length - 1; index += 1) {
    const previous = trail[index - 1] ?? trail[index];
    const start = trail[index];
    const end = trail[index + 1];
    const next = trail[index + 2] ?? end;
    if (!previous || !start || !end || !next) {
      continue;
    }
    const scalar = tension / 6;
    const segmentDistance = pointDistance(start, end);
    segments.push({
      start,
      control1: boundedTrailControlPoint({
        point: {
          x: start.x + (end.x - previous.x) * scalar,
          y: start.y + (end.y - previous.y) * scalar,
        },
        start,
        end,
        segmentDistance,
      }),
      control2: boundedTrailControlPoint({
        point: {
          x: end.x - (next.x - start.x) * scalar,
          y: end.y - (next.y - start.y) * scalar,
        },
        start,
        end,
        segmentDistance,
      }),
      end,
    });
  }
  return segments;
}

export function isLiveActivityEvent(
  event: ActivityEvent,
  { now = Date.now(), maxAgeMinutes = ACTIVITY_LIVE_WINDOW_MINUTES }: ActivityFogOptions = {},
) {
  return activityPrimaryBounds(event) !== null && activityAgeMinutes(event, now) <= maxAgeMinutes;
}

export function sortedActivityEvents(
  events: ActivityEvent[],
  limit = 80,
  options: ActivityFogOptions = {},
): ActivityEvent[] {
  if (limit <= 0) {
    return liveActivityEventsInTimeOrder(events, options).slice(Math.max(0, -limit));
  }
  if (!liveActivityEventsAreInTimeOrder(events, options)) {
    return liveActivityEventsTailInTimeOrder(events, limit, options);
  }
  return liveActivityEventsTail(events, limit, options);
}

export function latestActivityByAgent(events: ActivityEvent[], options: ActivityFogOptions = {}) {
  const byAgent = new Map<string, ActivitySummary>();
  let liveIndex = 0;
  for (const event of events) {
    if (!isLiveActivityEvent(event, options)) {
      continue;
    }
    const timestamp = activitySortTimestamp(event);
    if (!Number.isFinite(timestamp)) {
      return latestActivityByAgentViaSort(events, options);
    }

    const key = activityActorKey(event);
    const summary = byAgent.get(key);
    if (!summary) {
      byAgent.set(key, {
        key,
        event,
        firstIndex: liveIndex,
        firstTimestamp: timestamp,
        latestIndex: liveIndex,
        latestTimestamp: timestamp,
      });
    } else if (
      timestamp > summary.latestTimestamp ||
      (timestamp === summary.latestTimestamp && liveIndex > summary.latestIndex)
    ) {
      summary.event = event;
      summary.latestIndex = liveIndex;
      summary.latestTimestamp = timestamp;
    }
    liveIndex += 1;
  }

  const summaries = [...byAgent.values()];
  sortIfNeeded(summaries, compareActivitySummariesByFirstSeen);
  const latest = new Map<string, ActivityEvent>();
  for (const summary of summaries) {
    latest.set(summary.key, summary.event);
  }
  return latest;
}

export function activityFeedEvents(events: ActivityEvent[], options: ActivityFogOptions = {}) {
  return (
    activityFeedFromLatest(latestActivityByAgent(events, options).values(), true) ??
    activityFeedEventsViaSort(events, options)
  );
}

export function hitTestActivityEvents(
  events: ActivityEvent[],
  point: Point,
  { radiusX = 0, radiusY = 0, now, maxAgeMinutes }: ActivityHitOptions = {},
): (ActivityEvent & { targetType: "activity" }) | null {
  const options: ActivityFogOptions = {
    ...(now === undefined ? {} : { now }),
    ...(maxAgeMinutes === undefined ? {} : { maxAgeMinutes }),
  };
  let best: ActivityEvent | null = null;
  for (const event of events) {
    if (!isLiveActivityEvent(event, options)) {
      continue;
    }
    if (!activityEventHitsPoint(event, point, radiusX, radiusY)) {
      continue;
    }
    if (!best || compareActivityEventsByTime(best, event) <= 0) {
      best = event;
    }
  }
  return best ? { ...best, targetType: "activity" } : null;
}

function activityEventHitsPoint(
  event: ActivityEvent,
  point: Point,
  radiusX: number,
  radiusY: number,
): boolean {
  const fragments = event.address?.fragments;
  if (fragments) {
    let foundFragmentBounds = false;
    for (const { bounds } of fragments) {
      if (!bounds) {
        continue;
      }
      foundFragmentBounds = true;
      if (boundsCenterHitsPoint(bounds, point, radiusX, radiusY)) {
        return true;
      }
    }
    if (foundFragmentBounds) {
      return false;
    }
  }
  return event.address?.bounds
    ? boundsCenterHitsPoint(event.address.bounds, point, radiusX, radiusY)
    : false;
}

function boundsCenterHitsPoint(
  bounds: Bounds,
  point: Point,
  radiusX: number,
  radiusY: number,
): boolean {
  const center = boundsCenter(bounds);
  return Math.abs(point.x - center.x) <= radiusX && Math.abs(point.y - center.y) <= radiusY;
}

function compareActivitySummariesByFirstSeen(
  left: ActivitySummary,
  right: ActivitySummary,
): number {
  return left.firstTimestamp - right.firstTimestamp || left.firstIndex - right.firstIndex;
}

function insertActivityFeedEvent(
  feed: ActivityFeedItem[],
  event: ActivityEvent,
  timestamp: number,
  limit: number,
): void {
  let index = 0;
  while (index < feed.length) {
    const item = feed[index]!;
    const order = timestamp - item.timestamp;
    if ((Number.isNaN(order) ? 0 : order) > 0) {
      break;
    }
    index += 1;
  }
  if (index >= limit) {
    return;
  }
  feed.splice(index, 0, { event, timestamp });
  if (feed.length > limit) {
    feed.pop();
  }
}

function activityFeedEventsViaSort(
  events: ActivityEvent[],
  options: ActivityFogOptions,
): ActivityEvent[] {
  return activityFeedFromLatest(latestActivityByAgent(events, options).values(), false) ?? [];
}

function activityFeedFromLatest(
  events: Iterable<ActivityEvent>,
  requireFiniteTimestamp: boolean,
): ActivityEvent[] | null {
  const feed: ActivityFeedItem[] = [];
  for (const event of events) {
    const timestamp = activitySortTimestamp(event);
    if (requireFiniteTimestamp && !Number.isFinite(timestamp)) {
      return null;
    }
    insertActivityFeedEvent(feed, event, timestamp, 5);
  }
  return feed.map((item) => item.event);
}

function latestActivityByAgentViaSort(
  events: ActivityEvent[],
  options: ActivityFogOptions,
): Map<string, ActivityEvent> {
  const latest = new Map<string, ActivityEvent>();
  for (const event of sortedActivityEvents(events, Number.POSITIVE_INFINITY, options)) {
    latest.set(activityActorKey(event), event);
  }
  return latest;
}

function liveActivityEventsInTimeOrder(
  events: ActivityEvent[],
  options: ActivityFogOptions,
): ActivityEvent[] {
  const liveEvents: ActivityEvent[] = [];
  for (const event of events) {
    if (!isLiveActivityEvent(event, options)) {
      continue;
    }
    liveEvents.push(event);
  }
  return sortIfNeeded(liveEvents, compareActivityEventsByTime);
}

function liveActivityEventsTailInTimeOrder(
  events: ActivityEvent[],
  limit: number,
  options: ActivityFogOptions,
): ActivityEvent[] {
  if (!Number.isFinite(limit)) {
    return liveActivityEventsInTimeOrder(events, options);
  }
  const liveEvents: ActivityEvent[] = [];
  for (const event of events) {
    if (!isLiveActivityEvent(event, options)) {
      continue;
    }
    insertActivityEventInTimeOrder(liveEvents, event, limit);
  }
  return liveEvents;
}

function insertActivityEventInTimeOrder(
  events: ActivityEvent[],
  event: ActivityEvent,
  limit: number,
): void {
  let index = 0;
  while (index < events.length) {
    const current = events[index];
    if (!current || compareActivityEventsByTime(current, event) > 0) {
      break;
    }
    index += 1;
  }
  events.splice(index, 0, event);
  if (events.length > limit) {
    events.shift();
  }
}

function liveActivityEventsAreInTimeOrder(
  events: ActivityEvent[],
  options: ActivityFogOptions,
): boolean {
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    if (!isLiveActivityEvent(event, options)) {
      continue;
    }
    const timestamp = activitySortTimestamp(event);
    if (!Number.isFinite(timestamp) || timestamp < previousTimestamp) {
      return false;
    }
    previousTimestamp = timestamp;
  }
  return true;
}

function liveActivityEventsTail(
  events: ActivityEvent[],
  limit: number,
  options: ActivityFogOptions,
): ActivityEvent[] {
  const liveEvents: ActivityEvent[] = [];
  for (const event of events) {
    if (!isLiveActivityEvent(event, options)) {
      continue;
    }
    liveEvents.push(event);
    if (liveEvents.length > limit) {
      liveEvents.shift();
    }
  }
  return liveEvents;
}

function activitySortTimestamp(event: ActivityEvent): number {
  return Date.parse(event.timestamp ?? "");
}

function compareActivityEventsByTime(left: ActivityEvent, right: ActivityEvent): number {
  const result = activitySortTimestamp(left) - activitySortTimestamp(right);
  return Number.isNaN(result) ? 0 : result;
}

function activityAgeMinutes(event: ActivityEvent, now: number): number {
  const timestamp = Date.parse(event.timestamp ?? "");
  if (!Number.isFinite(timestamp)) {
    return 0;
  }
  return Math.max(0, (now - timestamp) / 60000);
}

function shouldStartActivityTrailGroup(
  previous: ActivityEvent | undefined,
  event: ActivityEvent,
  maxGapMinutes: number,
): boolean {
  if (!previous) {
    return false;
  }
  const previousTime = Date.parse(previous.timestamp ?? "");
  const eventTime = Date.parse(event.timestamp ?? "");
  if (!Number.isFinite(previousTime) || !Number.isFinite(eventTime)) {
    return false;
  }
  return eventTime - previousTime > maxGapMinutes * 60000;
}

function compareActivityGroupsByTime(left: ActivityEvent[], right: ActivityEvent[]): number {
  const leftTime = Date.parse(left[0]?.timestamp ?? "");
  const rightTime = Date.parse(right[0]?.timestamp ?? "");
  return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
}

function boundedTrailControlPoint({
  point,
  start,
  end,
  segmentDistance,
}: {
  point: Point;
  start: Point;
  end: Point;
  segmentDistance: number;
}): Point {
  const padding = Math.min(18, Math.max(4, segmentDistance * 0.18));
  return {
    x: clamp(point.x, Math.min(start.x, end.x) - padding, Math.max(start.x, end.x) + padding),
    y: clamp(point.y, Math.min(start.y, end.y) - padding, Math.max(start.y, end.y) + padding),
  };
}

// --- Activity marker colour/age helpers (pure over their explicit args) ---

export function activityFillColor(style: ActivityStyle, encoding: ActivityEncoding): string {
  return encoding.active || encoding.selected ? style.fill : "#64748b";
}

export function activityHaloColor(style: ActivityStyle, encoding: ActivityEncoding): string {
  return encoding.active || encoding.selected ? style.stroke : "#cbd5e1";
}

export function formatActivityAge(ageMinutes: number): string {
  if (ageMinutes < 60) {
    return `${Math.max(1, Math.round(ageMinutes))}m ago`;
  }
  return `${Math.round(ageMinutes / 60)}h ago`;
}

export function hexToRgba(hex: string, alpha: number): string {
  const rgb = hexRgb(hex);
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

export function hexRgb(hex: string): readonly [number, number, number] {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ] as const;
}

// --- Activity-drawing orchestration (closes over the canvas + projection deps) ---

type ActivityStrokeStyle = { color: string; lineWidth: number };
type ActivityRenderItem = {
  event: ActivityEvent;
  key: string;
  latest: boolean;
  selected: boolean;
  encoding: ActivityEncoding;
  style: ActivityStyle;
  fillColor: string;
  primaryBounds: Bounds | null;
};

export type ActivityDrawerDeps = {
  ctx: CanvasRenderingContext2D;
  getActivity: () => ActivityEvent[];
  /** Opaque — only targetType and id fields are read. */
  getSelectedTarget: () => { targetType: string; id?: string } | null;
  getViewScale: () => number;
  /** Feed dedup key — combined with the wall-clock minute. */
  getActivitySignature: () => string;
  activityFeedEl: HTMLElement | null;
  worldToScreen: (point: Point) => Point;
  screenBounds: (bounds: Bounds) => Bounds;
  hashUnit: (value: string) => number;
  /** Wraps controls.showActivity?.checked. */
  isDiscoveryEnabled: () => boolean;
  /** Shared canvas primitive — also used by drawOverlaps and the label-flush loop. */
  drawLabel: (
    text: string,
    x: number,
    y: number,
    color: string,
    size?: number,
    weight?: string,
  ) => void;
  /** Routes a feed click to the app-owned selectActivityEvent. */
  onActivityFeedItemClick: (event: ActivityEvent) => void;
};

export type ActivityDrawer = ReturnType<typeof createActivityDrawer>;

export function createActivityDrawer(deps: ActivityDrawerDeps) {
  const ctx = deps.ctx;
  const hexRgbCache = new Map<string, readonly [number, number, number]>();
  let activityFeedRenderKey = "";

  function cachedHexRgb(hex: string): readonly [number, number, number] {
    const cached = hexRgbCache.get(hex);
    if (cached) {
      return cached;
    }
    const rgb = hexRgb(hex);
    hexRgbCache.set(hex, rgb);
    return rgb;
  }

  function cachedHexToRgba(hex: string, alpha: number): string {
    const rgb = cachedHexRgb(hex);
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
  }

  function drawActivity(): void {
    const events = sortedActivityEvents(deps.getActivity());
    const latestByAgent = latestActivityByAgent(events);
    const discoveryMode = deps.isDiscoveryEnabled();
    const items = activityRenderItems(events, latestByAgent);
    drawActivityMembranes(items, { discoveryMode });
    drawActivityTrails(events, latestByAgent, { discoveryMode });

    for (const item of items) {
      const { event, latest, selected, encoding, style, fillColor, primaryBounds } = item;
      if (!primaryBounds) {
        continue;
      }
      const center = boundsCenter(primaryBounds);
      const p = deps.worldToScreen(center);
      const haloColor = activityHaloColor(style, encoding);
      ctx.save();
      ctx.globalAlpha = encoding.alpha;
      ctx.fillStyle = haloColor;
      ctx.beginPath();
      ctx.arc(p.x, p.y, encoding.haloRadius * 0.46, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = fillColor;
      ctx.strokeStyle = selected ? "#111827" : haloColor;
      ctx.lineWidth = selected ? 3 : latest ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, encoding.coreRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (latest && (encoding.active || selected)) {
        ctx.globalAlpha = encoding.membraneAlpha * 1.25;
        ctx.beginPath();
        drawActivityCell(p, encoding.haloRadius, event.id ?? event.agentId);
        ctx.strokeStyle = fillColor;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.globalAlpha = 1;
        const label = encoding.active
          ? `${activityActorLabel(event)}: ${encoding.activityState}`
          : `${activityActorLabel(event)}: last seen ${formatActivityAge(encoding.ageMinutes)}`;
        if (!discoveryMode || latest || selected) {
          deps.drawLabel(
            label,
            p.x + 10,
            p.y - 8,
            encoding.active ? style.label : "#475569",
            12,
            "700",
          );
        }
      }
      ctx.restore();
    }
  }

  function activityRenderItems(
    events: ActivityEvent[],
    latestByAgent: Map<string, ActivityEvent>,
  ): ActivityRenderItem[] {
    const now = Date.now();
    const selectedTarget = deps.getSelectedTarget();
    const items: ActivityRenderItem[] = [];
    for (const event of events) {
      const key = activityActorKey(event);
      const latest = latestByAgent.get(key) === event;
      const selected = selectedTarget?.targetType === "activity" && selectedTarget.id === event.id;
      const encoding = activityVisualEncoding(event, { latest, selected, now });
      const style = activityStateStyle(encoding.activityState);
      items.push({
        event,
        key,
        latest,
        selected,
        encoding,
        style,
        fillColor: activityFillColor(style, encoding),
        primaryBounds: activityPrimaryBounds(event),
      });
    }
    return items;
  }

  function drawActivityMembranes(
    items: ActivityRenderItem[],
    { discoveryMode = false } = {},
  ): void {
    for (const { event, latest, selected, encoding, fillColor } of items) {
      if (discoveryMode && deps.getViewScale() > 6 && !selected) {
        continue;
      }
      if (discoveryMode && !latest && !selected) {
        continue;
      }
      if (encoding.membraneAlpha <= 0.08 && !selected) {
        continue;
      }

      for (const bounds of activityFragmentBounds(event)) {
        const tissueBox = activityTissueBox(deps.screenBounds(bounds), encoding);
        const p = {
          x: tissueBox.x + tissueBox.width / 2,
          y: tissueBox.y + tissueBox.height / 2,
        };
        const radius = Math.max(tissueBox.width, tissueBox.height) * 0.82;
        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
        const membraneAlpha =
          discoveryMode && !selected ? encoding.membraneAlpha * 0.45 : encoding.membraneAlpha;
        gradient.addColorStop(0, cachedHexToRgba(fillColor, membraneAlpha));
        gradient.addColorStop(0.58, cachedHexToRgba(fillColor, membraneAlpha * 0.45));
        gradient.addColorStop(1, cachedHexToRgba(fillColor, 0));

        ctx.save();
        ctx.fillStyle = gradient;
        ctx.beginPath();
        drawActivityTissue(tissueBox, `${event.id ?? event.agentId}:${bounds.x}:${bounds.y}`);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  function drawActivityTrails(
    events: ActivityEvent[],
    latestByAgent: Map<string, ActivityEvent>,
    { discoveryMode = false } = {},
  ): void {
    for (const agentEvents of activityTrailGroups(events, { presorted: true })) {
      const trailLatest = agentEvents.at(-1);
      if (!trailLatest) {
        continue;
      }
      const latest = latestByAgent.get(activityActorKey(trailLatest)) === trailLatest;
      const selected = activityTrailSelected(agentEvents);
      const encoding = activityVisualEncoding(trailLatest, { latest, selected });
      const style = activityStateStyle(encoding.activityState);
      const fillColor = activityFillColor(style, encoding);
      const pointGroups = activityTrailPointGroups(activityTrailPoints(agentEvents));
      if (pointGroups.length === 0) {
        continue;
      }

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([]);
      ctx.shadowColor = cachedHexToRgba(fillColor, encoding.trailAlpha * 0.3);
      ctx.shadowBlur = encoding.dormant ? 0 : selected ? 12 : 7;

      for (const points of pointGroups) {
        strokeOrganicTrail(points, {
          color: cachedHexToRgba(fillColor, encoding.trailAlpha * (discoveryMode ? 0.045 : 0.16)),
          lineWidth: encoding.lineWidth * (discoveryMode ? 3.2 : 5.4),
        });
      }
      ctx.shadowBlur = 0;
      for (const points of pointGroups) {
        strokeOrganicTrail(points, {
          color: cachedHexToRgba(fillColor, encoding.trailAlpha * (discoveryMode ? 0.12 : 0.38)),
          lineWidth: encoding.lineWidth * (discoveryMode ? 1.4 : 2.25),
        });
        if (!discoveryMode || selected || latest) {
          strokeOrganicTrail(points, {
            color: cachedHexToRgba(
              fillColor,
              Math.min(
                discoveryMode ? 0.42 : 0.9,
                encoding.trailAlpha * (discoveryMode ? 0.46 : 0.95),
              ),
            ),
            lineWidth: encoding.lineWidth * (discoveryMode ? 0.82 : 1),
          });
        }
      }
      ctx.restore();
    }
  }

  function activityTrailSelected(events: ActivityEvent[]): boolean {
    const selectedTarget = deps.getSelectedTarget();
    if (selectedTarget?.targetType !== "activity") {
      return false;
    }
    const selectedId = selectedTarget.id;
    return events.some((event) => event.id === selectedId);
  }

  function activityTrailPoints(events: ActivityEvent[]): Point[] {
    const points: Point[] = [];
    for (const event of events) {
      const bounds = activityPrimaryBounds(event);
      if (bounds) {
        points.push(deps.worldToScreen(boundsCenter(bounds)));
      }
    }
    return points;
  }

  function strokeOrganicTrail(points: Point[], { color, lineWidth }: ActivityStrokeStyle): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    if (drawMyceliumPathForContext(ctx, points, deps.getViewScale())) {
      ctx.stroke();
    }
  }

  function drawActivityCell(center: Point, radius: number, key: string | undefined): void {
    const points = 10;
    ctx.moveTo(center.x + radius, center.y);
    for (let index = 1; index <= points; index += 1) {
      const angle = (index / points) * Math.PI * 2;
      const wobble = 0.82 + deps.hashUnit(`${key}:cell:${index}`) * 0.26;
      const r = radius * wobble;
      ctx.lineTo(center.x + Math.cos(angle) * r, center.y + Math.sin(angle) * r);
    }
    ctx.closePath();
  }

  function drawActivityTissue(box: Bounds, key: string): void {
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
      const wobble = 0.86 + deps.hashUnit(`${key}:tissue:${index}`) * 0.22;
      ctx.lineTo(
        center.x + Math.cos(angle) * radiusX * wobble,
        center.y + Math.sin(angle) * radiusY * wobble,
      );
    }
    ctx.closePath();
  }

  function renderActivityFeed(): void {
    const activityFeedEl = deps.activityFeedEl;
    if (!activityFeedEl) {
      return;
    }
    const feedKey = `${deps.getActivitySignature()}:${Math.floor(Date.now() / 60000)}`;
    if (feedKey === activityFeedRenderKey) {
      return;
    }
    activityFeedRenderKey = feedKey;
    const latest = activityFeedEvents(deps.getActivity());

    activityFeedEl.replaceChildren();
    if (latest.length === 0) {
      activityFeedEl.textContent = "No activity yet.";
      return;
    }

    for (const event of latest) {
      const item = document.createElement("button");
      item.className = "activity-item";
      item.type = "button";
      item.addEventListener("click", () => deps.onActivityFeedItemClick(event));
      const encoding = activityVisualEncoding(event, { latest: true });

      const title = document.createElement("strong");
      title.textContent = encoding.active
        ? `${activityActorLabel(event)}: ${normalizeActivityState(event.activityState)}`
        : `${activityActorLabel(event)}: last seen ${formatActivityAge(encoding.ageMinutes)}`;
      const detail = document.createElement("span");
      detail.textContent = activityPathLabel(event);
      item.append(title, detail);
      activityFeedEl.append(item);
    }
  }

  return { drawActivity, renderActivityFeed };
}
