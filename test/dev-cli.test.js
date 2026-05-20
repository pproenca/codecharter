import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { LOCAL_SCRATCH_EXCLUDES } from "../src/local-git-exclude.js";

const execFileAsync = promisify(execFile);

test("codemap dev is a one-command dogfood workflow", { timeout: 8000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "codemaps-dev-cli-"));
  const port = await freePort();
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.js"), "export const app = true;\n");
  await execFileAsync("git", ["init"], { cwd: root });

  const cli = spawn(process.execPath, [
    join(process.cwd(), "bin", "codemap.mjs"),
    "dev",
    "--root",
    root,
    "--port",
    String(port),
    "--agent",
    "dogfood",
  ], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  cli.stdout.on("data", (chunk) => { output += chunk.toString(); });
  cli.stderr.on("data", (chunk) => { output += chunk.toString(); });

  try {
    await waitFor(() => output.includes(`Codemap running at http://127.0.0.1:${port}`), () => output);

    const html = await fetchText(`http://127.0.0.1:${port}/`);
    assert.match(html, /<canvas id="mapCanvas"/);

    const codemap = await getJson(`http://127.0.0.1:${port}/api/map`);
    assert.equal(codemap.files["src/app.js"].path, "src/app.js");

    const sidecar = JSON.parse(await readFile(join(root, "codemap.json"), "utf8"));
    assert.equal(sidecar.files["src/app.js"].geo.geohash, codemap.files["src/app.js"].geo.geohash);

    const exclude = await readFile(join(root, ".git", "info", "exclude"), "utf8");
    for (const pattern of LOCAL_SCRATCH_EXCLUDES) assert.match(exclude, new RegExp(escapeRegExp(pattern)));

    const activity = await waitForActivity(port);
    assert.equal(activity.agentId, "dogfood");
    assert.equal(activity.address.targetType, "lineRange");
    assert.deepEqual(activity.address.lineRange, { start: 1, end: 1 });
    assert.match(activity.address.deepLink, /path=src%2Fapp\.js/);
  } finally {
    cli.kill("SIGTERM");
    await waitForExit(cli);
  }
});

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) assert.fail(await response.text());
  return response.text();
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) assert.fail(await response.text());
  return response.json();
}

async function waitForActivity(port) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const activity = await getJson(`http://127.0.0.1:${port}/api/activity`);
    const event = activity.events.find((item) => item.address?.deepLink?.includes("path=src%2Fapp.js"));
    if (event) return event;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail("Timed out waiting for dogfood activity");
}

async function waitFor(predicate, output) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`Timed out waiting for dev CLI readiness\n${output()}`);
}

async function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 1000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
