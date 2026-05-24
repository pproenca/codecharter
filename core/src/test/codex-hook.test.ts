import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCodexHook } from "../main/codex-hook.ts";
import { ensureCodexAdapter } from "../main/init.ts";
import type { StoredActivityEvent } from "../main/activity-store.ts";

test("Codex hook records nested parallel shell read activity", async () => {
  const root = await fixtureRoot();
  try {
    await runCodexHook({
      cwd: root,
      input: JSON.stringify({
        hook_event_name: "PostToolUse",
        tool_name: "multi_tool_use.parallel",
        tool_input: {
          tool_uses: [
            {
              recipient_name: "functions.exec_command",
              parameters: { cmd: "sed -n '1,2p' README.md" },
            },
          ],
        },
        session_id: "session-1",
        turn_id: "turn-1",
        model: "test-model",
      }),
    });

    const events = await readActivityArchive(root);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.activityState, "reading");
    assert.equal(events[0]?.note, "Codex read README.md");
    assert.equal(events[0]?.hookEventName, "PostToolUse");
    assert.equal(events[0]?.address?.path, "README.md");
    assert.deepEqual(events[0]?.address?.lineRange, { start: 1, end: 2 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex hook records shell edit heartbeat when no dirty paths remain", async () => {
  const root = await fixtureRoot();
  try {
    initCleanGitFixture(root);

    await runCodexHook({
      cwd: root,
      input: JSON.stringify({
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: {
          command: "node -e \"require('fs').writeFileSync('README.md', 'one\\ntwo\\nthree\\n')\"",
        },
        session_id: "session-1",
        turn_id: "turn-1",
        model: "test-model",
      }),
    });

    const events = await readActivityArchive(root);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.activityState, "editing");
    assert.equal(events[0]?.note, "Codex shell edit activity");
    assert.equal(events[0]?.address, undefined);

    const refreshedMap = JSON.parse(
      await readFile(join(root, ".codecharter", "codecharter.json"), "utf8"),
    ) as { version?: unknown };
    assert.equal(refreshedMap.version, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex hook treats sed in-place shell commands as edit activity", async () => {
  const root = await fixtureRoot();
  try {
    initCleanGitFixture(root);

    await runCodexHook({
      cwd: root,
      input: JSON.stringify({
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: {
          command: "sed -i 's/one/one/' README.md",
        },
        session_id: "session-1",
        turn_id: "turn-1",
        model: "test-model",
      }),
    });

    const events = await readActivityArchive(root);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.activityState, "editing");
    assert.equal(events[0]?.note, "Codex shell edit activity");
    assert.equal(events[0]?.address, undefined);

    const refreshedMap = JSON.parse(
      await readFile(join(root, ".codecharter", "codecharter.json"), "utf8"),
    ) as { version?: unknown };
    assert.equal(refreshedMap.version, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex adapter records through a source checkout hook without a package bin", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-codex-adapter-"));
  try {
    initGitRepository(root);
    await installFakeSourceCheckout(root);
    const { hookPath, hooksJsonPath } = await ensureCodexAdapter(root);
    const payload = JSON.stringify({ hook_event_name: "Stop", session_id: "session-1" });

    execFileSync(process.execPath, [hookPath], { cwd: root, input: payload });

    const captured = JSON.parse(await readFile(join(root, "captured-hook.json"), "utf8")) as {
      argv: string[];
      cwd: string;
      input: string;
    };
    assert.equal(captured.argv[0]?.endsWith("/core/bin/codemap.mts"), true);
    assert.equal(captured.argv[1], "codex-hook");
    assert.equal(captured.cwd.endsWith(root), true);
    assert.equal(captured.input, payload);

    const hooksJson = JSON.parse(await readFile(hooksJsonPath, "utf8")) as {
      hooks: { PostToolUse?: { matcher?: string }[] };
    };
    assert.equal(
      hooksJson.hooks.PostToolUse?.[0]?.matcher?.includes("multi_tool_use.parallel"),
      true,
    );

    const installedHook = await readFile(hookPath, "utf8");
    assert.match(
      installedHook,
      new RegExp(`codecharter@${escapeRegExp(await rootPackageVersion())}`),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function rootPackageVersion(): Promise<string> {
  const manifest = JSON.parse(
    await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
  ) as { version?: unknown };
  const { version } = manifest;
  if (typeof version !== "string") {
    throw new TypeError("package.json version must be a string");
  }
  return version;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codecharter-codex-hook-"));
  initGitRepository(root);
  await mkdir(join(root, ".codecharter"), { recursive: true });
  await writeFile(join(root, "README.md"), "one\ntwo\nthree\n");
  await writeFile(
    join(root, ".codecharter", "config.json"),
    JSON.stringify({
      mapPath: ".codecharter/codecharter.json",
      activityPath: ".scratch/codecharter/activity.jsonl",
      agents: { codex: { activityPath: ".scratch/codecharter/activity.jsonl" } },
    }),
  );
  await writeFile(
    join(root, ".codecharter", "codecharter.json"),
    JSON.stringify({
      folders: {},
      files: {
        "README.md": {
          path: "README.md",
          bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
          geo: { lat: 0, lon: 0, geohash: "s00000000000" },
          lineCount: 3,
          maxLineLength: 5,
        },
      },
    }),
  );
  return root;
}

function initGitRepository(root: string): void {
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
}

function initCleanGitFixture(root: string): void {
  execFileSync("git", ["config", "user.email", "codecharter@example.test"], {
    cwd: root,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "CodeCharter Test"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: root, stdio: "ignore" });
  execFileSync(
    "git",
    ["add", "README.md", ".codecharter/config.json", ".codecharter/codecharter.json"],
    { cwd: root, stdio: "ignore" },
  );
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: root, stdio: "ignore" });
}

async function readActivityArchive(root: string): Promise<StoredActivityEvent[]> {
  const content = await readFile(join(root, ".scratch", "codecharter", "activity.jsonl"), "utf8");
  return content
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as StoredActivityEvent);
}

async function installFakeSourceCheckout(root: string): Promise<void> {
  await mkdir(join(root, "node_modules", ".bin"), { recursive: true });
  await mkdir(join(root, "core", "bin"), { recursive: true });
  await writeFile(join(root, "core", "bin", "codemap.mts"), "");
  const fakeTsxPath = join(root, "node_modules", ".bin", "tsx");
  await writeFile(
    fakeTsxPath,
    `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
writeFileSync("captured-hook.json", JSON.stringify({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  input: readFileSync(0, "utf8"),
}));
`,
  );
  await chmod(fakeTsxPath, 0o755);
}
