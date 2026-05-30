import assert from "node:assert/strict";
import test from "node:test";
import {
  type ActivitySubmitControllerDeps,
  createActivitySubmitController,
} from "../main/controllers/activity-submit.ts";

// addActivity guards on `instanceof HTMLFormElement`; that DOM global is absent
// under the Node test runtime, so provide a minimal stand-in for the guard to run.
const globals = globalThis as { HTMLFormElement?: unknown };
if (globals.HTMLFormElement === undefined) {
  globals.HTMLFormElement = function HTMLFormElement() {};
}

function stubDeps(
  overrides: Partial<ActivitySubmitControllerDeps> = {},
): ActivitySubmitControllerDeps {
  return {
    activityForm: null,
    clearActivityTool: null,
    setActivity: () => {},
    setActivitySignature: () => {},
    setActivityVersion: () => {},
    setActivityDetail: () => {},
    getSelectedTarget: () => null,
    setSelectedTarget: () => {},
    rebuildActivityFog: () => {},
    setHoverText: () => {},
    render: () => {},
    postJson: async () => ({}),
    deleteJson: async () => ({}),
    refreshActivity: async () => {},
    ...overrides,
  };
}

test("createActivitySubmitController exposes the wiring surface app.ts consumes", () => {
  const controller = createActivitySubmitController(stubDeps());
  assert.equal(typeof controller.addActivity, "function");
  assert.equal(typeof controller.clearActivityHistory, "function");
});

test("addActivity is a no-op (no POST) when no form element is wired", async () => {
  let posts = 0;
  const controller = createActivitySubmitController(
    stubDeps({
      activityForm: null,
      postJson: async () => {
        posts += 1;
        return {};
      },
    }),
  );
  const event = { preventDefault: () => {} } as unknown as SubmitEvent;
  await controller.addActivity(event);
  assert.equal(posts, 0);
});

test("clearActivityHistory resets activity state in the contract order", async () => {
  const calls: string[] = [];
  const controller = createActivitySubmitController(
    stubDeps({
      deleteJson: async () => {
        calls.push("delete");
        return {};
      },
      setActivity: (events) => calls.push(`setActivity:${events.length}`),
      setActivitySignature: (sig) => calls.push(`setSignature:${sig}`),
      setActivityVersion: (version) => calls.push(`setVersion:${version}`),
      setActivityDetail: (detail) => calls.push(`setDetail:${detail}`),
      rebuildActivityFog: () => calls.push("rebuildFog"),
      setHoverText: (text) => calls.push(`hover:${text}`),
      render: () => calls.push("render"),
    }),
  );
  await controller.clearActivityHistory();
  assert.deepEqual(calls, [
    "delete",
    "setActivity:0",
    "setSignature:0::",
    "setVersion:",
    "setDetail:summary",
    "rebuildFog",
    "hover:Activity cleared",
    "render",
  ]);
});

test("clearActivityHistory nulls the selected target only when it is an activity", async () => {
  let cleared = 0;
  const activityController = createActivitySubmitController(
    stubDeps({
      getSelectedTarget: () => ({ targetType: "activity" }),
      setSelectedTarget: () => {
        cleared += 1;
      },
    }),
  );
  await activityController.clearActivityHistory();
  assert.equal(cleared, 1);

  cleared = 0;
  const fileController = createActivitySubmitController(
    stubDeps({
      getSelectedTarget: () => ({ targetType: "file" }),
      setSelectedTarget: () => {
        cleared += 1;
      },
    }),
  );
  await fileController.clearActivityHistory();
  assert.equal(cleared, 0);
});

test("clearActivityHistory re-enables the clear tool even when the DELETE rejects", async () => {
  const tool = { disabled: false, classList: { remove: () => {} } } as unknown as HTMLElement & {
    disabled?: boolean;
  };
  const controller = createActivitySubmitController(
    stubDeps({
      clearActivityTool: tool,
      deleteJson: async () => {
        throw new Error("boom");
      },
    }),
  );
  await assert.rejects(() => controller.clearActivityHistory(), /boom/);
  assert.equal(tool.disabled, false);
});
