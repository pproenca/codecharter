import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileText } from "../src/exec-file.ts";
import { LOCAL_CODECHARTER_EXCLUDES } from "../src/local-git-exclude.ts";

test("codemap activity exits non-zero when it rejects input", async () => {
  const cli = spawn(process.execPath, [
    join(process.cwd(), "bin", "codemap.mts"),
    "activity",
  ], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  cli.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  cli.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  const [code] = await once(cli, "exit");

  assert.equal(code, 1);
  assert.match(stdout, /^accepted: false$/m);
  assert.match(stdout, /^error: /m);
  assert.equal(stderr, "");
});

test("codecharter init validates TCP port boundaries", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-port-validation-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.js"), "export const app = true;\n");
  await execFileText("git", ["init"], { cwd: root });

  await assert.rejects(
    execFileText(process.execPath, [
      join(process.cwd(), "bin", "codemap.mts"),
      "init",
      "--root",
      root,
      "--port",
      "0",
      "--yes",
    ]),
    /Port must be an integer from 1 to 65535/
  );

  await assert.rejects(
    execFileText(process.execPath, [
      join(process.cwd(), "bin", "codemap.mts"),
      "init",
      "--root",
      root,
      "--port",
      "65536",
      "--yes",
    ]),
    /Port must be an integer from 1 to 65535/
  );

  await execFileText(process.execPath, [
    join(process.cwd(), "bin", "codemap.mts"),
    "init",
    "--root",
    root,
    "--port",
    "65535",
    "--yes",
  ]);
});

test("codecharter dev is a one-command dogfood workflow", { timeout: 8000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-dev-cli-"));
  const port = await freePort();
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.js"), "export const app = true;\n");
  await execFileText("git", ["init"], { cwd: root });

  const cli = spawn(process.execPath, [
    join(process.cwd(), "bin", "codemap.mts"),
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
    await waitFor(() => output.includes(`viewer: http://127.0.0.1:${port}`), () => output);

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

test("codecharter init can initialize a fresh repo and start the viewer", { timeout: 8000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-setup-dev-"));
  const port = await freePort();
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.js"), "export const app = true;\n");
  await execFileText("git", ["init"], { cwd: root });

  const cli = spawn(process.execPath, [
    join(process.cwd(), "bin", "codemap.mts"),
    "init",
    "--root",
    root,
    "--port",
    String(port),
    "--dev",
    "--yes",
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
    await waitFor(() => output.includes(`viewer: http://127.0.0.1:${port}`), () => output);
    assert.match(output, /^init: ok$/m);
    assert.match(output, /^map: \.codecharter\/codecharter\.json$/m);
    assert.match(output, /^files: 1$/m);
    assert.match(output, /^hooks: codex,git$/m);
    assert.match(output, /^next: \/hooks$/m);

    const html = await fetchText(`http://127.0.0.1:${port}/`);
    assert.match(html, /<canvas id="mapCanvas"/);

    const hooksJson = JSON.parse(await readFile(join(root, ".codex", "hooks.json"), "utf8"));
    assert.ok(hooksJson.hooks.PostToolUse);

    const skill = await readFile(join(root, ".agents", "skills", "codecharter", "SKILL.md"), "utf8");
    assert.match(skill, /CodeCharter prompts/);
    assert.match(skill, /codecharter --json resolve "codecharter:\/\/annotation\/<id>"/);
    assert.match(skill, /npx --yes codecharter@\d+\.\d+\.\d+/);
    const skillUi = await readFile(join(root, ".agents", "skills", "codecharter", "agents", "openai.yaml"), "utf8");
    assert.match(skillUi, /short_description: "Resolve CodeCharter map targets via CLI"/);

    const config = JSON.parse(await readFile(join(root, ".codecharter", "config.json"), "utf8"));
    assert.equal(config.mapPath, ".codecharter/codecharter.json");

    const gitignore = await readFile(join(root, ".gitignore"), "utf8");
    assert.match(gitignore, /^\.codecharter\/$/m);
    assert.match(gitignore, /^codecharter\.json$/m);
    assert.match(gitignore, /^codemap\.json$/m);

    const { stdout: artifactStatus } = await execFileText("git", ["status", "--short", "--", ".codecharter/codecharter.json"], { cwd: root });
    assert.equal(artifactStatus, "");

    const activity = await waitForActivity(port, "src/app.js");
    assert.equal(activity.agentId, "first-run");
  } finally {
    cli.kill("SIGTERM");
    await waitForExit(cli);
  }
});

test("codecharter dev --setup initializes a fresh repo and starts the viewer", { timeout: 8000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-dev-setup-"));
  const port = await freePort();
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.js"), "export const app = true;\n");
  await execFileText("git", ["init"], { cwd: root });

  const cli = spawn(process.execPath, [
    join(process.cwd(), "bin", "codemap.mts"),
    "dev",
    "--setup",
    "--root",
    root,
    "--port",
    String(port),
    "--agent",
    "setup-dev",
  ], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  cli.stdout.on("data", (chunk) => { output += chunk.toString(); });
  cli.stderr.on("data", (chunk) => { output += chunk.toString(); });

  try {
    await waitFor(() => output.includes(`viewer: http://127.0.0.1:${port}`), () => output);
    assert.match(output, /^init: ok$/m);
    assert.match(output, /^map: \.codecharter\/codecharter\.json$/m);
    assert.match(output, /^files: 1$/m);
    assert.match(output, /^hooks: codex,git$/m);
    assert.match(output, /^next: \/hooks$/m);

    const codemap = await getJson(`http://127.0.0.1:${port}/api/map`);
    assert.equal(codemap.files["src/app.js"].path, "src/app.js");

    const activity = await waitForActivity(port, "src/app.js");
    assert.equal(activity.agentId, "setup-dev");
  } finally {
    cli.kill("SIGTERM");
    await waitForExit(cli);
  }
});

test("packed package supports the npx init and resolve path", { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-packed-"));
  const packDir = await mkdtemp(join(tmpdir(), "codecharter-pack-"));
  const port = await freePort();
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.js"), "export const app = true;\n");
  await execFileText("git", ["init"], { cwd: root });

  const { stdout } = await execFileText("npm", ["pack", "--silent", "--pack-destination", packDir], { cwd: process.cwd() });
  const tarball = join(packDir, required(stdout.trim().split(/\r?\n/).at(-1)));
  const cli = spawn("npm", [
    "exec",
    "--yes",
    "--package",
    tarball,
    "--",
    "codecharter",
    "init",
    "--root",
    root,
    "--port",
    String(port),
    "--dev",
    "--yes",
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
    await waitFor(() => output.includes(`viewer: http://127.0.0.1:${port}`), () => output);
    const codemap = await getJson(`http://127.0.0.1:${port}/api/map`);
    assert.equal(codemap.files["src/app.js"].path, "src/app.js");
    assert.match(output, /^init: ok$/m);
    assert.match(output, /^next: \/hooks$/m);
    const skill = await readFile(join(root, ".agents", "skills", "codecharter", "SKILL.md"), "utf8");
    assert.match(skill, /resolve "codecharter:\/\/annotation\/<id>"/);
    assert.match(skill, /If `command -v codecharter` fails/);
    const skillUi = await readFile(join(root, ".agents", "skills", "codecharter", "agents", "openai.yaml"), "utf8");
    assert.match(skillUi, /allow_implicit_invocation: true/);

    const { stdout: resolveStdout } = await execFileText("npm", [
      "exec",
      "--yes",
      "--package",
      tarball,
      "--",
      "codecharter",
      "--json",
      "resolve",
      "src/app.js",
    ], { cwd: root });
    const resolved = JSON.parse(resolveStdout);
    assert.equal(resolved.targetType, "file");
    assert.equal(resolved.path, "src/app.js");
  } finally {
    killProcessGroup(cli);
    await waitForExit(cli);
  }
});

async function fetchText(url: string) {
  const response = await fetch(url);
  if (!response.ok) assert.fail(await response.text());
  return response.text();
}

async function getJson(url: string) {
  const response = await fetch(url);
  if (!response.ok) assert.fail(await response.text());
  return response.json();
}

async function waitForActivity(port: number, path = "src/app.js") {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const activity = await getJson(`http://127.0.0.1:${port}/api/activity`);
    const event = activity.events.find((item: { address?: { deepLink?: string } }) => item.address?.deepLink?.includes(`path=${encodeURIComponent(path)}`));
    if (event) return event;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`Timed out waiting for activity on ${path}`);
}

async function waitFor(predicate: () => boolean, output: () => string) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`Timed out waiting for dev CLI readiness\n${output()}`);
}

async function waitForExit(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 1000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

function killProcessGroup(child: ReturnType<typeof spawn>) {
  if (process.platform === "win32") {
    child.kill("SIGTERM");
    return;
  }
  try {
    process.kill(-required(child.pid), "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = serverPort(server);
  server.close();
  await once(server, "close");
  return port;
}

function required<T>(value: T | null | undefined): T {
  assert.ok(value);
  return value;
}

function serverPort(server: ReturnType<typeof createServer>) {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP test server");
  return address.port;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
