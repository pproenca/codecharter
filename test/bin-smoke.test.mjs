import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = new URL("..", import.meta.url);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function parsePackOutput(stdout) {
  const jsonStart = stdout.indexOf("{");
  assert.notEqual(jsonStart, -1, "pnpm pack should print JSON output");
  return JSON.parse(stdout.slice(jsonStart));
}

test("published codecharter bin is packed and runnable", { timeout: 120_000 }, async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "codecharter-bin-"));

  try {
    const pnpmEnv = { ...process.env, npm_config_cache: join(tempDir, "npm-cache") };
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    assert.equal(manifest.bin?.codecharter, "dist/bin/codecharter.mjs");

    const { stdout: packStdout } = await execFileAsync(
      pnpm,
      ["pack", "--json", "--pack-destination", tempDir],
      {
        cwd: root,
        env: pnpmEnv,
        maxBuffer: 1024 * 1024 * 10,
      },
    );
    const pack = parsePackOutput(packStdout);
    assert.ok(pack, "pnpm pack should report a packed package");
    assert.ok(
      pack.files.some((file) => file.path === "dist/bin/codecharter.mjs"),
      "dist CLI bin should be packed",
    );

    const tarball = isAbsolute(pack.filename) ? pack.filename : join(tempDir, pack.filename);
    const consumerDir = join(tempDir, "consumer");
    await mkdir(consumerDir, { recursive: true });
    await execFileAsync(pnpm, ["add", "--dir", consumerDir, "--ignore-scripts", tarball], {
      env: pnpmEnv,
      maxBuffer: 1024 * 1024 * 10,
    });

    for (const command of ["codecharter"]) {
      const bin = join(
        consumerDir,
        "node_modules",
        ".bin",
        process.platform === "win32" ? `${command}.cmd` : command,
      );
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
