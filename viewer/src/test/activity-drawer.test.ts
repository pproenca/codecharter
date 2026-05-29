import assert from "node:assert/strict";
import test from "node:test";
import {
  type ActivityDrawerDeps,
  activityFillColor,
  activityHaloColor,
  activityStateStyle,
  activityVisualEncoding,
  createActivityDrawer,
  formatActivityAge,
  hexRgb,
  hexToRgba,
} from "../main/render/activity.ts";
import type { ActivityEvent, Bounds, Point } from "../main/render/types.ts";

const NOW = Date.parse("2026-05-29T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

// --- Pure colour helpers ---------------------------------------------------

test("hexRgb parses a 6-digit hex into a base-10 RGB tuple", () => {
  assert.deepEqual(hexRgb("#2563eb"), [0x25, 0x63, 0xeb]);
  // The leading '#' is optional; both forms parse identically.
  assert.deepEqual(hexRgb("2563eb"), [0x25, 0x63, 0xeb]);
  assert.deepEqual(hexRgb("#000000"), [0, 0, 0]);
  assert.deepEqual(hexRgb("#ffffff"), [255, 255, 255]);
});

test("hexToRgba renders the parsed channels with the requested alpha", () => {
  assert.equal(hexToRgba("#2563eb", 0.5), "rgba(37, 99, 235, 0.5)");
  assert.equal(hexToRgba("#000000", 0), "rgba(0, 0, 0, 0)");
  assert.equal(hexToRgba("#ffffff", 1), "rgba(255, 255, 255, 1)");
});

test("formatActivityAge uses minutes under an hour and rounds up to hours after", () => {
  // A sub-minute age still reports at least "1m ago".
  assert.equal(formatActivityAge(0), "1m ago");
  assert.equal(formatActivityAge(0.4), "1m ago");
  assert.equal(formatActivityAge(5), "5m ago");
  assert.equal(formatActivityAge(59), "59m ago");
  // 60+ minutes switches to whole hours (rounded).
  assert.equal(formatActivityAge(60), "1h ago");
  assert.equal(formatActivityAge(90), "2h ago");
  assert.equal(formatActivityAge(150), "3h ago");
});

test("activityFillColor/HaloColor use the state style when active or selected, else muted greys", () => {
  const event: ActivityEvent = {
    activityState: "reading",
    timestamp: minutesAgo(1),
  } as ActivityEvent;
  const style = activityStateStyle("reading");

  const activeEncoding = activityVisualEncoding(event, { latest: true, now: NOW });
  assert.equal(activeEncoding.active, true);
  assert.equal(activityFillColor(style, activeEncoding), style.fill);
  assert.equal(activityHaloColor(style, activeEncoding), style.stroke);

  // A dormant (old, unselected) event falls back to the muted slate palette.
  const dormant: ActivityEvent = {
    activityState: "reading",
    timestamp: minutesAgo(600),
  } as ActivityEvent;
  const dormantEncoding = activityVisualEncoding(dormant, { now: NOW });
  assert.equal(dormantEncoding.active, false);
  assert.equal(dormantEncoding.selected, false);
  assert.equal(activityFillColor(style, dormantEncoding), "#64748b");
  assert.equal(activityHaloColor(style, dormantEncoding), "#cbd5e1");

  // Selection overrides the dormancy fallback even for an old event.
  const dormantSelected = activityVisualEncoding(dormant, { selected: true, now: NOW });
  assert.equal(activityFillColor(style, dormantSelected), style.fill);
  assert.equal(activityHaloColor(style, dormantSelected), style.stroke);
});

// --- Construction smoke test ----------------------------------------------

// A recording stand-in for the 2D context: the drawer only issues drawing
// commands, so we capture method names to prove it touched the canvas without
// a real DOM. createRadialGradient must hand back an addColorStop sink.
function recordingContext(calls: string[]): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  return new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === "createRadialGradient") {
          return () => gradient;
        }
        return (...args: unknown[]) => {
          calls.push(prop);
          void args;
        };
      },
      set() {
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
}

function smokeDeps(ctx: CanvasRenderingContext2D): ActivityDrawerDeps {
  return {
    ctx,
    getActivity: () => [],
    getSelectedTarget: () => null,
    getViewScale: () => 1,
    getActivitySignature: () => "",
    activityFeedEl: null,
    worldToScreen: (point: Point) => point,
    screenBounds: (bounds: Bounds) => bounds,
    hashUnit: () => 0.5,
    isDiscoveryEnabled: () => false,
    drawLabel: () => {},
    onActivityFeedItemClick: () => {},
    activityPathLabel: () => "",
  };
}

test("createActivityDrawer exposes the wiring surface app.ts consumes", () => {
  const drawer = createActivityDrawer(smokeDeps(recordingContext([])));
  assert.equal(typeof drawer.drawActivity, "function");
  assert.equal(typeof drawer.renderActivityFeed, "function");
});

test("drawActivity over empty activity does not touch the context", () => {
  const calls: string[] = [];
  const drawer = createActivityDrawer(smokeDeps(recordingContext(calls)));
  drawer.drawActivity();
  assert.deepEqual(calls, []);
});

test("renderActivityFeed is a no-op without a feed element", () => {
  const calls: string[] = [];
  const drawer = createActivityDrawer(smokeDeps(recordingContext(calls)));
  assert.doesNotThrow(() => drawer.renderActivityFeed());
});
