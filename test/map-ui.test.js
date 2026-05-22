import test from "node:test";
import assert from "node:assert/strict";
import { createAnnotation, drawSelection, startMapUiHarness } from "../test-support/map-ui-harness.js";

test("drawing a map selection opens the annotation textbox and enables save", async (t) => {
  const { page, boot } = await startMapUiHarness(t);
  await boot();

  await drawReadySelection(page);

  const comment = page.getByRole("textbox", { name: "Annotation comment" });
  await comment.waitFor({ state: "visible" });

  assert.equal(await comment.evaluate((element) => document.activeElement === element), true);
  assert.equal(await page.getByRole("button", { name: "Save and copy Codex prompt" }).isEnabled(), true);
  assert.match(page.url(), /#\/selection\?level=file&bounds=/);
});

test("selection hash route boots into a ready annotation draft and Escape cleans the hash", async (t) => {
  const { page, boot } = await startMapUiHarness(t);
  const route = "/#/selection?level=file&bounds=0.2,0.2,0.3,0.3";
  const resolveResponse = waitForSelectionResolve(page);

  await boot(route);
  await resolveResponse;

  await page.getByRole("textbox", { name: "Annotation comment" }).waitFor({ state: "visible" });
  assert.equal(await page.getByRole("button", { name: "Save and copy Codex prompt" }).isEnabled(), true);
  assert.equal(await page.locator("#drawTool").getAttribute("aria-pressed"), "true");

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.location.hash === "");

  assert.equal(await page.locator("#selectionPopover").isHidden(), true);
  assert.equal(await page.locator("#drawTool").getAttribute("aria-pressed"), "false");
});

test("keyboard save persists an annotation, copies the Codex prompt, and switches to annotation actions", async (t) => {
  const { page, boot, baseUrl } = await startMapUiHarness(t);
  await boot();
  await drawReadySelection(page);

  await page.getByRole("textbox", { name: "Annotation comment" }).fill("Review the app boot path");
  const saveResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && response.url().endsWith("/api/annotations")
    && response.status() === 201,
  );

  await page.keyboard.press("Control+Enter");
  const saved = (await (await saveResponse).json()).annotation;

  await page.waitForFunction((id) => window.location.hash === `#/annotation/${id}`, saved.id);
  await page.getByRole("button", { name: "Copy Codex prompt" }).waitFor({ state: "visible" });
  assert.equal(new URL(page.url()).hash, `#/annotation/${saved.id}`);

  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(clipboardText, new RegExp(`CodeCharter annotation: codecharter://annotation/${saved.id}`));
  assert.match(clipboardText, /Note: Review the app boot path/);

  const annotations = await getJson(`${baseUrl}/api/annotations`);
  assert.equal(annotations.annotations.length, 1);
  assert.equal(annotations.annotations[0].id, saved.id);
});

test("annotation hash route boots selected annotation and keyboard copy/delete use public UI state", async (t) => {
  const { page, boot, baseUrl } = await startMapUiHarness(t);
  const annotation = await createAnnotation(baseUrl, { comment: "Route boot annotation" });

  await boot(`/#/annotation/${annotation.id}`);

  await page.getByRole("button", { name: "Copy Codex prompt" }).waitFor({ state: "visible" });
  assert.equal(new URL(page.url()).hash, `#/annotation/${annotation.id}`);
  assert.equal(await page.locator("#selectionPopover").isHidden(), true);

  await page.locator("#mapCanvas").focus();
  await page.keyboard.press("Control+C");
  await page.waitForFunction(() => navigator.clipboard.readText().then((text) => text.includes("Route boot annotation")));

  page.on("dialog", (dialog) => {
    dialog.accept();
  });
  const deleteResponse = page.waitForResponse((response) =>
    response.request().method() === "DELETE"
    && response.url().endsWith(`/api/annotations/${annotation.id}`)
    && response.status() === 200,
  );
  await page.keyboard.press("Delete");
  await deleteResponse;
  await page.waitForFunction(() => window.location.hash === "");

  assert.equal(await page.locator("#annotationActions").isHidden(), true);
  const annotations = await getJson(`${baseUrl}/api/annotations`);
  assert.equal(annotations.annotations.length, 0);
});

test("annotation hash route focuses annotations created after boot", async (t) => {
  const { page, boot, baseUrl } = await startMapUiHarness(t);
  await boot();
  const annotation = await createAnnotation(baseUrl, { comment: "Late route annotation" });

  await page.evaluate((id) => {
    window.location.hash = `#/annotation/${id}`;
  }, annotation.id);

  await page.getByRole("button", { name: "Copy Codex prompt" }).waitFor({ state: "visible" });
  await page.locator("#mapCanvas").focus();
  await page.keyboard.press("Control+C");
  await page.waitForFunction(() => navigator.clipboard.readText().then((text) => text.includes("Late route annotation")));

  await page.evaluate(() => {
    window.location.hash = "#";
  });
  await page.waitForFunction(() => window.location.hash === "");

  await page.evaluate((id) => {
    window.location.hash = `#/annotation/${id}`;
  }, annotation.id);

  await page.getByRole("button", { name: "Copy Codex prompt" }).waitFor({ state: "visible" });
  assert.equal(new URL(page.url()).hash, `#/annotation/${annotation.id}`);
});

test("single click inspects a file without drilling the camera into it", async (t) => {
  const { page, boot } = await startMapUiHarness(t);
  await boot();

  const initialScale = await viewportScale(page);
  await clickMapWorld(page, { x: 0.1, y: 0.1 });
  await page.waitForFunction(() => window.location.hash.includes("path=src%2Flong.ts"));
  await page.waitForTimeout(500);

  assert.equal(await viewportScale(page), initialScale);
});

test("double click drills the camera into a file", async (t) => {
  const { page, boot } = await startMapUiHarness(t);
  await boot();

  const initialScale = await viewportScale(page);
  await doubleClickMapWorld(page, { x: 0.1, y: 0.1 });
  await page.waitForFunction((scale) => {
    const match = document.querySelector("#viewportReadout")?.textContent?.match(/scale ([0-9.]+)/);
    return match && Number(match[1]) > scale;
  }, initialScale);

  assert.ok(await viewportScale(page) > initialScale);
});

test("activity discovery hides unexplored files and reveals visited files", async (t) => {
  const { page, boot, baseUrl } = await startMapUiHarness(t);
  await boot();

  const appCenter = { x: 0.48, y: 0.47 };
  const revealFeather = { x: 0.86, y: 0.47 };
  const farFog = { x: 0.94, y: 0.47 };
  const normalPixel = await canvasPixelAtWorld(page, appCenter);

  await page.getByLabel("Activity & Discovery").click();
  await page.waitForTimeout(100);
  const unexploredPixel = await canvasPixelAtWorld(page, appCenter);

  assert.equal(await page.locator("#showActivity").isChecked(), true);
  assert.ok(pixelBrightness(unexploredPixel) < pixelBrightness(normalPixel) * 0.45);

  const response = await fetch(`${baseUrl}/api/activity`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agentId: "codex",
      activityState: "reading",
      path: "src/app.ts",
      lineStart: 1,
      lineEnd: 2,
    }),
  });
  assert.equal(response.status, 202);

  await page.waitForFunction((point) => {
    const canvas = document.querySelector("#mapCanvas");
    const context = canvas.getContext("2d");
    const pixel = context.getImageData(
      Math.floor(canvas.width * point.x),
      Math.floor(canvas.height * point.y),
      1,
      1,
    ).data;
    return pixel[0] + pixel[1] + pixel[2] > 160;
  }, appCenter);

  const visitedPixel = await canvasPixelAtWorld(page, appCenter);
  const featherPixel = await canvasPixelAtWorld(page, revealFeather);
  const farFogPixel = await canvasPixelAtWorld(page, farFog);
  assert.ok(pixelBrightness(visitedPixel) > pixelBrightness(unexploredPixel) * 2);
  assert.ok(pixelBrightness(visitedPixel) < pixelBrightness(normalPixel) * 0.8);
  assert.ok(pixelBrightness(featherPixel) > pixelBrightness(farFogPixel) * 1.4);
  assert.ok(pixelBrightness(featherPixel) < pixelBrightness(visitedPixel) * 0.85);
});

test("activity discovery toggle keeps pointer activation visually settled", async (t) => {
  const { page, boot } = await startMapUiHarness(t);
  await boot();

  await page.getByLabel("Activity & Discovery").click();

  const toggleState = await page.locator(".toggle-tool").evaluate((element) => {
    const icon = element.querySelector("svg");
    const style = getComputedStyle(element);
    const iconStyle = getComputedStyle(icon);
    return {
      checked: element.querySelector("input").checked,
      iconTransform: iconStyle.transform,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });

  assert.equal(toggleState.checked, true);
  assert.equal(toggleState.iconTransform, "none");
  assert.ok(toggleState.outlineStyle === "none" || toggleState.outlineWidth === "0px");
});

test("map tools stay edge anchored instead of covering the map center", async (t) => {
  const { page, boot } = await startMapUiHarness(t);
  await boot();

  const geometry = await page.locator(".map-tool-palette").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const canvas = document.querySelector("#mapCanvas").getBoundingClientRect();
    return {
      left: rect.left - canvas.left,
      centerX: rect.left + rect.width / 2 - canvas.left,
      width: rect.width,
      canvasWidth: canvas.width,
    };
  });

  assert.ok(geometry.left <= 24);
  assert.ok(geometry.centerX < geometry.canvasWidth * 0.35);
  assert.ok(geometry.width <= 340);
});

test("map tools expose primary controls and tuck rare actions into a menu", async (t) => {
  const { page, boot } = await startMapUiHarness(t);
  await boot();

  const closedState = await page.locator(".map-tool-palette").evaluate((element) => {
    const visibleControlNames = Array.from(element.children)
      .flatMap((child) => {
        if (child.matches(".map-action-menu")) return [child.querySelector("summary")].filter(Boolean);
        return Array.from(child.querySelectorAll(".icon-tool"));
      })
      .filter((control) => {
        const rect = control.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((control) => control.getAttribute("aria-label") || control.id);

    return {
      hasActionMenu: Boolean(element.querySelector(".map-action-menu")),
      visibleControlNames,
      zoomInVisible: element.querySelector("#zoomInTool")?.getBoundingClientRect().width > 0,
      clearVisible: element.querySelector("#clearActivityTool")?.getBoundingClientRect().width > 0,
    };
  });

  assert.equal(closedState.hasActionMenu, true);
  assert.deepEqual(closedState.visibleControlNames, [
    "Select",
    "Pan",
    "Draw Selection",
    "Activity & Discovery",
    "More map actions",
  ]);
  assert.equal(closedState.zoomInVisible, false);
  assert.equal(closedState.clearVisible, false);

  await page.getByLabel("More map actions").click();
  await page.getByRole("button", { name: "Zoom in" }).waitFor({ state: "visible" });
  assert.equal(await page.getByRole("button", { name: "Clear activity history" }).isVisible(), true);
});

test("clear activity requires a deliberate hold", async (t) => {
  const { page, boot, baseUrl } = await startMapUiHarness(t);
  await boot();

  const response = await fetch(`${baseUrl}/api/activity`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agentId: "codex",
      activityState: "reading",
      path: "src/app.ts",
      lineStart: 1,
      lineEnd: 2,
    }),
  });
  assert.equal(response.status, 202);
  await page.waitForFunction(() => fetch("/api/activity").then((res) => res.json()).then((body) => body.events.length === 1));

  await page.getByLabel("More map actions").click();
  const clearButton = page.getByRole("button", { name: "Clear activity history" });
  await clearButton.click();
  assert.equal((await getJson(`${baseUrl}/api/activity`)).events.length, 1);

  const box = await clearButton.boundingBox();
  assert.ok(box, "Clear activity button is not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1700);
  await page.mouse.up();

  await page.waitForFunction(() => fetch("/api/activity").then((res) => res.json()).then((body) => body.events.length === 0));
  assert.equal((await getJson(`${baseUrl}/api/activity`)).events.length, 0);
});

test("activity discovery zooms visited code into a readable revealed view", async (t) => {
  const { page, boot, baseUrl } = await startMapUiHarness(t);
  await boot();

  await page.getByLabel("Activity & Discovery").click();
  const response = await fetch(`${baseUrl}/api/activity`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agentId: "codex",
      activityState: "reading",
      path: "src/long.ts",
      lineStart: 52,
      lineEnd: 54,
    }),
  });
  assert.equal(response.status, 202);
  await page.waitForFunction(() => fetch("/api/activity").then((res) => res.json()).then((body) => body.events.length === 1));
  await page.waitForResponse(async (pollResponse) => {
    if (!pollResponse.url().endsWith("/api/activity") || pollResponse.request().method() !== "GET") return false;
    const body = await pollResponse.json();
    return body.events?.some((event) => event.address?.path === "src/long.ts" && event.address?.lineRange?.start === 52);
  });

  const initialScale = await viewportScale(page);
  await doubleClickMapWorld(page, { x: 0.1, y: 0.1 });
  await page.waitForFunction((scale) => {
    const match = document.querySelector("#viewportReadout")?.textContent?.match(/scale ([0-9.]+)/);
    return match && Number(match[1]) > Math.max(20, scale * 3);
  }, initialScale);

  assert.ok(await viewportScale(page) > 20);
  await page.waitForFunction(() => {
    const hash = window.location.hash;
    return hash.startsWith("#/map/lineRange/")
      && hash.includes("path=src%2Flong.ts")
      && hash.includes("lines=52-54");
  });
  assert.match(new URL(page.url()).hash, /#\/map\/lineRange\//);
  assert.match(new URL(page.url()).hash, /path=src%2Flong\.ts/);
  assert.match(new URL(page.url()).hash, /lines=52-54/);
});

test("line-range hash routes open discovered code at a readable source scale", async (t) => {
  const { page, boot } = await startMapUiHarness(t);

  await boot("/#/map/lineRange/s00000000001?path=src%2Flong.ts&lines=52-54");

  await page.waitForFunction(() => {
    const match = document.querySelector("#viewportReadout")?.textContent?.match(/scale ([0-9.]+)/);
    return match && Number(match[1]) > 20;
  });
  assert.ok(await viewportScale(page) > 20);
  assert.match(new URL(page.url()).hash, /path=src%2Flong\.ts/);
  assert.match(new URL(page.url()).hash, /lines=52-54/);
});

async function drawReadySelection(page) {
  const resolveResponse = waitForSelectionResolve(page);
  await drawSelection(page);
  await resolveResponse;
}

async function clickMapWorld(page, point) {
  const canvas = page.locator("#mapCanvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Map canvas is not visible");

  await page.mouse.click(box.x + box.width * point.x, box.y + box.height * point.y);
}

async function doubleClickMapWorld(page, point) {
  const canvas = page.locator("#mapCanvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Map canvas is not visible");

  await page.mouse.dblclick(box.x + box.width * point.x, box.y + box.height * point.y);
}

async function canvasPixelAtWorld(page, point) {
  return page.evaluate(({ x, y }) => {
    const canvas = document.querySelector("#mapCanvas");
    const context = canvas.getContext("2d");
    return Array.from(context.getImageData(
      Math.floor(canvas.width * x),
      Math.floor(canvas.height * y),
      1,
      1,
    ).data);
  }, point);
}

function pixelBrightness(pixel) {
  const alpha = pixel[3] / 255;
  const backdrop = 219;
  return pixel[0] * alpha
    + pixel[1] * alpha
    + pixel[2] * alpha
    + backdrop * (1 - alpha) * 3;
}

async function viewportScale(page) {
  const text = await page.locator("#viewportReadout").innerText();
  const match = text.match(/scale ([0-9.]+)/);
  assert.ok(match, `No scale in viewport readout: ${text}`);
  return Number(match[1]);
}

function waitForSelectionResolve(page) {
  return page.waitForResponse((response) =>
    response.request().method() === "POST"
    && response.url().endsWith("/api/selections/resolve")
    && response.status() === 200,
  );
}

async function getJson(url) {
  const response = await fetch(url);
  assert.equal(response.ok, true);
  return response.json();
}
