import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { LOCAL_CODECHARTER_EXCLUDES } from "../src/local-git-exclude.js";

const execFileAsync = promisify(execFile);

test("codecharter dev is a one-command dogfood workflow", { timeout: 8000 }, async () => {
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
    await waitFor(() => output.includes(`CodeCharter running at http://127.0.0.1:${port}`), () => output);

    const html = await fetchText(`http://127.0.0.1:${port}/`);
    assert.match(html, /<canvas id="mapCanvas"/);

    const codemap = await getJson(`http://127.0.0.1:${port}/api/map`);
    assert.equal(codemap.files["src/app.js"].path, "src/app.js");

    const sidecar = JSON.parse(await readFile(join(root, ".codecharter", "codecharter.json"), "utf8"));
    assert.equal(sidecar.files["src/app.js"].geo.geohash, codemap.files["src/app.js"].geo.geohash);

    const exclude = await readFile(join(root, ".git", "info", "exclude"), "utf8");
    for (const pattern of LOCAL_CODECHARTER_EXCLUDES) assert.match(exclude, new RegExp(escapeRegExp(pattern)));

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

test("codecharter setup --dev initializes a fresh repo and prints the viewer URL", { timeout: 8000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-setup-dev-"));
  const port = await freePort();
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.js"), "export const app = true;\n");
  await execFileAsync("git", ["init"], { cwd: root });

  const cli = spawn(process.execPath, [
    join(process.cwd(), "bin", "codemap.mjs"),
    "setup",
    "--dev",
    "--root",
    root,
    "--port",
    String(port),
    "--agent",
    "first-run",
  ], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  cli.stdout.on("data", (chunk) => { output += chunk.toString(); });
  cli.stderr.on("data", (chunk) => { output += chunk.toString(); });

  try {
    await waitFor(() => output.includes(`Open CodeCharter: http://127.0.0.1:${port}`), () => output);
    assert.match(output, /CodeCharter setup complete/);
    assert.match(output, /Codex hook installed\. In Codex, run `\/hooks`/);

    const html = await fetchText(`http://127.0.0.1:${port}/`);
    assert.match(html, /<canvas id="mapCanvas"/);

    const hooksJson = JSON.parse(await readFile(join(root, ".codex", "hooks.json"), "utf8"));
    assert.ok(hooksJson.hooks.PostToolUse);

    const skill = await readFile(join(root, ".agents", "skills", "codecharter", "SKILL.md"), "utf8");
    assert.match(skill, /CodeCharter annotation/);
    assert.match(skill, /Corner geohashes/);

    const config = JSON.parse(await readFile(join(root, ".codecharter", "config.json"), "utf8"));
    assert.equal(config.mapPath, ".codecharter/codecharter.json");

    const gitignore = await readFile(join(root, ".gitignore"), "utf8");
    assert.match(gitignore, /^\.codecharter\/$/m);
    assert.match(gitignore, /^codecharter\.json$/m);
    assert.match(gitignore, /^codemap\.json$/m);

    const { stdout: artifactStatus } = await execFileAsync("git", ["status", "--short", "--", ".codecharter/codecharter.json"], { cwd: root });
    assert.equal(artifactStatus, "");

    const activity = await waitForActivity(port, "src/app.js");
    assert.equal(activity.agentId, "first-run");
  } finally {
    cli.kill("SIGTERM");
    await waitForExit(cli);
  }
});

test("packed package supports the npx one-command setup-dev path", { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-packed-"));
  const packDir = await mkdtemp(join(tmpdir(), "codecharter-pack-"));
  const port = await freePort();
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.js"), "export const app = true;\n");
  await execFileAsync("git", ["init"], { cwd: root });

  const { stdout } = await execFileAsync("npm", ["pack", "--silent", "--pack-destination", packDir], { cwd: process.cwd() });
  const tarball = join(packDir, stdout.trim().split(/\r?\n/).at(-1));
  const cli = spawn("npm", [
    "exec",
    "--yes",
    "--package",
    tarball,
    "--",
    "codecharter",
    "setup",
    "--dev",
    "--root",
    root,
    "--port",
    String(port),
    "--agent",
    "packed",
  ], {
    cwd: root,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  cli.stdout.on("data", (chunk) => { output += chunk.toString(); });
  cli.stderr.on("data", (chunk) => { output += chunk.toString(); });

  try {
    await waitFor(() => output.includes(`Open CodeCharter: http://127.0.0.1:${port}`), () => output);
    const codemap = await getJson(`http://127.0.0.1:${port}/api/map`);
    assert.equal(codemap.files["src/app.js"].path, "src/app.js");
    assert.match(output, /Codex hook installed\. In Codex, run `\/hooks`/);
    const skill = await readFile(join(root, ".agents", "skills", "codecharter", "SKILL.md"), "utf8");
    assert.match(skill, /resolvedTargets/);

    const { stdout: doctorStdout } = await execFileAsync("npm", [
      "exec",
      "--yes",
      "--package",
      tarball,
      "--",
      "codecharter",
      "--json",
      "doctor",
      "--root",
      root,
      "--server",
      `http://127.0.0.1:${port}`,
    ], { cwd: root });
    const doctor = JSON.parse(doctorStdout);
    assert.equal(doctor.ok, true);
    assert.equal(doctor.checks.server.ok, true);
  } finally {
    killProcessGroup(cli);
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

async function waitForActivity(port, path = "src/app.js") {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const activity = await getJson(`http://127.0.0.1:${port}/api/activity`);
    const event = activity.events.find((item) => item.address?.deepLink?.includes(`path=${encodeURIComponent(path)}`));
    if (event) return event;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`Timed out waiting for activity on ${path}`);
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

function killProcessGroup(child) {
  if (process.platform === "win32") {
    child.kill("SIGTERM");
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
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
