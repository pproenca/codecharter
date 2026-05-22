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

async function drawReadySelection(page) {
  const resolveResponse = waitForSelectionResolve(page);
  await drawSelection(page);
  await resolveResponse;
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
