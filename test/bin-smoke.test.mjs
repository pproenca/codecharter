import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const root = new URL("..", import.meta.url);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function parsePackOutput(stdout) {
  const jsonStart = stdout.indexOf("[");
  assert.notEqual(jsonStart, -1, "npm pack should print JSON output");
  return JSON.parse(stdout.slice(jsonStart));
}

test("published codemap bin is packed and runnable", { timeout: 120_000 }, async () => {
  const scratchDir = new URL("../.scratch/", import.meta.url);
  await mkdir(scratchDir, { recursive: true });
  const tempDir = await mkdtemp(join(fileURLToPath(scratchDir), "codecharter-bin-"));

  try {
    const npmEnv = { ...process.env, npm_config_cache: join(tempDir, "npm-cache") };
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(manifest.bin?.codemap, "dist/bin/codemap.mjs");
    assert.equal(manifest.bin?.codecharter, "dist/bin/codemap.mjs");

    const { stdout: packStdout } = await execFileAsync(npm, ["pack", "--json", "--pack-destination", tempDir], {
      cwd: root,
      env: npmEnv,
      maxBuffer: 1024 * 1024 * 10,
    });
    const [pack] = parsePackOutput(packStdout);
    assert.ok(pack, "npm pack should report a packed package");
    assert.ok(pack.files.some((file) => file.path === "dist/bin/codemap.mjs"), "dist CLI bin should be packed");

    const tarball = join(tempDir, pack.filename);
    const consumerDir = join(tempDir, "consumer");
    await execFileAsync(npm, ["install", "--prefix", consumerDir, "--ignore-scripts", "--no-audit", "--no-fund", tarball], {
      env: npmEnv,
      maxBuffer: 1024 * 1024 * 10,
    });

    for (const command of ["codemap", "codecharter"]) {
      const bin = join(consumerDir, "node_modules", ".bin", process.platform === "win32" ? `${command}.cmd` : command);
      const { stdout: helpStdout } = await execFileAsync(bin, ["--help"], {
        maxBuffer: 1024 * 1024,
      });
      assert.match(helpStdout, /Usage:/);
      assert.match(helpStdout, /resolve <codecharter:\/\/\.\.\.>/);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
