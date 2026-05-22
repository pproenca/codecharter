import { once } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server.js";

export async function startMapUiHarness(t, { viewport = { width: 960, height: 720 } } = {}) {
  const root = await mkdtemp(join(tmpdir(), "codecharter-map-ui-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), "const app = true;\nexport default app;\n");
  await writeFile(join(root, "codecharter.json"), JSON.stringify(sampleCodemap()));

  const server = await startServer({
    root,
    mapPath: join(root, "codecharter.json"),
    port: 0,
    activityFlushIntervalMs: 20,
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl });
  const page = await context.newPage();

  t.after(async () => {
    await context.close();
    await browser.close();
    const closed = once(server, "close");
    server.close();
    await closed;
  });

  return {
    baseUrl,
    page,
    root,
    async boot(path = "/") {
      await page.goto(`${baseUrl}${path}`);
      await page.locator("#viewportReadout").getByText("scale").waitFor();
      await page.locator("#mapCanvas").waitFor({ state: "visible" });
    },
  };
}

export async function drawSelection(page, { from = { x: 220, y: 180 }, to = { x: 520, y: 430 } } = {}) {
  const canvas = page.locator("#mapCanvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Map canvas is not visible");

  await page.getByRole("button", { name: "Draw Selection" }).click();
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 6 });
  await page.mouse.up();
}

export async function createAnnotation(baseUrl, {
  comment = "Review this mapped area",
  bounds = { x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
} = {}) {
  const response = await fetch(`${baseUrl}/api/annotations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      comment,
      level: "file",
      geometry: { type: "rect", bounds },
    }),
  });
  if (!response.ok) throw new Error(`Failed to create annotation: ${response.status}`);
  const body = await response.json();
  return body.annotation;
}

function sampleCodemap() {
  return {
    version: 1,
    mapLevels: { world: 1, region: 2, folder: 4, file: 7, code: 10, lineRange: 12, tokenRange: 12 },
    folders: {
      "": {
        path: "",
        name: "",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        geo: { lat: 0, lon: 0, geohash: "s00000000000" },
        lineCount: 2,
        maxLineLength: 19,
        weight: 2,
      },
      src: {
        path: "src",
        name: "src",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        geo: { lat: 0, lon: 0, geohash: "s00000000000" },
        lineCount: 2,
        maxLineLength: 19,
        weight: 2,
      },
    },
    files: {
      "src/app.ts": {
        path: "src/app.ts",
        name: "app.ts",
        extension: ".ts",
        contentType: "code",
        bounds: { x: 0.12, y: 0.16, width: 0.72, height: 0.62 },
        geo: { lat: 0, lon: 0, geohash: "s00000000000" },
        lineCount: 2,
        maxLineLength: 19,
        weight: 2,
      },
    },
  };
}
