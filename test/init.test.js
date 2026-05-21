import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("codecharter init writes project config, map, Codex hooks, and local git hooks", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-init-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), "export const app = true;\n");
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "sample-app", version: "1.0.0" }));
  await execFileAsync("git", ["init"], { cwd: root });

  await execFileAsync("node", [
    join(process.cwd(), "bin", "codemap.mjs"),
    "init",
    "--root",
    root,
    "--yes",
  ], { cwd: root });

  const config = JSON.parse(await readFile(join(root, ".codecharter", "config.json"), "utf8"));
  assert.equal(config.mapPath, ".codecharter/codecharter.json");
  assert.equal(config.agents.codex.enabled, true);

  const sidecar = JSON.parse(await readFile(join(root, ".codecharter", "codecharter.json"), "utf8"));
  assert.ok(sidecar.files["src/app.ts"]);

  const hooksJson = JSON.parse(await readFile(join(root, ".codex", "hooks.json"), "utf8"));
  assert.ok(hooksJson.hooks.PostToolUse);
  await access(join(root, ".codex", "hooks", "codecharter-codex-hook.mjs"), constants.X_OK);

  const skill = await readFile(join(root, ".agents", "skills", "codecharter", "SKILL.md"), "utf8");
  assert.match(skill, /CodeCharter annotation/);
  assert.match(skill, /Corner geohashes/);
  assert.match(skill, /resolvedTargets/);
  assert.match(skill, /codecharter annotation <id-or-url>/);
  assert.match(skill, /codecharter source <path>/);
  assert.match(skill, /Do not bulk-read every file/);
  assert.match(skill, /Do not prefer browser automation over CLI reads/);
  const skillUi = await readFile(join(root, ".agents", "skills", "codecharter", "agents", "openai.yaml"), "utf8");
  assert.match(skillUi, /display_name: "CodeCharter"/);
  assert.match(skillUi, /default_prompt: "Use \$codecharter/);

  const postMergeHook = await readFile(join(root, ".git", "hooks", "post-merge"), "utf8");
  assert.match(postMergeHook, /codecharter generate/);

  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.match(packageJson.devDependencies.codecharter, /^\^/);

  const gitignore = await readFile(join(root, ".gitignore"), "utf8");
  assert.match(gitignore, /^\.codecharter\/$/m);
  assert.match(gitignore, /^codecharter\.json$/m);
  assert.match(gitignore, /^codemap\.json$/m);

  const { stdout: artifactStatus } = await execFileAsync("git", ["status", "--short", "--", ".codecharter/codecharter.json"], { cwd: root });
  assert.equal(artifactStatus, "");

  const { stdout: doctorStdout } = await execFileAsync("node", [
    join(process.cwd(), "bin", "codemap.mjs"),
    "--json",
    "doctor",
    "--root",
    root,
  ], { cwd: root });
  const doctor = JSON.parse(doctorStdout);
  assert.equal(doctor.ok, true);
  assert.equal(doctor.auth.required, false);
  assert.equal(doctor.setup.ready, true);
  assert.equal(doctor.checks.codexSkill.exists, true);
  assert.equal(doctor.checks.codexSkillUi.exists, true);
});

test("codecharter init merges Codex hooks without clobbering existing repo hooks", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-hooks-merge-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), "export const app = true;\n");
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "sample-app", version: "1.0.0" }));
  await writeFile(join(root, ".codex", "hooks.json"), JSON.stringify({
    custom: { preserved: true },
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: "node .codex/hooks/existing-pre.mjs",
              statusMessage: "Existing pre hook",
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: "node .codex/hooks/existing-post.mjs",
              statusMessage: "Existing post hook",
            },
          ],
        },
      ],
    },
  }));
  await execFileAsync("git", ["init"], { cwd: root });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await execFileAsync("node", [
      join(process.cwd(), "bin", "codemap.mjs"),
      "init",
      "--root",
      root,
      "--yes",
    ], { cwd: root });
  }

  const hooksJson = JSON.parse(await readFile(join(root, ".codex", "hooks.json"), "utf8"));
  assert.equal(hooksJson.custom.preserved, true);
  assert.equal(hooksJson.hooks.PreToolUse[0].hooks[0].command, "node .codex/hooks/existing-pre.mjs");
  assert.equal(hooksJson.hooks.PostToolUse[0].hooks[0].command, "node .codex/hooks/existing-post.mjs");
  assert.equal(countCodecharterHooks(hooksJson), 3);
});

test("codecharter codex-hook appends mapped Codex activity without a daemon", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-codex-hook-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), "export const app = true;\n");
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("node", [
    join(process.cwd(), "bin", "codemap.mjs"),
    "generate",
    "--root",
    root,
    "--out",
    join(root, "codecharter.json"),
    "--quiet",
  ], { cwd: root });

  const payload = {
    session_id: "session-1",
    turn_id: "turn-1",
    cwd: root,
    hook_event_name: "PostToolUse",
    tool_name: "apply_patch",
    tool_input: { command: "*** Begin Patch\n*** End Patch" },
    model: "gpt-test",
  };

  await execFileWithInput("node", [
    join(process.cwd(), "bin", "codemap.mjs"),
    "codex-hook",
  ], { cwd: root, input: JSON.stringify(payload) });

  const lines = (await readFile(join(root, ".codecharter", "activity.jsonl"), "utf8")).trim().split("\n");
  const event = JSON.parse(lines[0]);
  assert.equal(event.agentId, "codex");
  assert.equal(event.activityState, "editing");
  assert.equal(event.hookEventName, "PostToolUse");
  assert.equal(event.sessionId, "session-1");
  assert.equal(event.address.targetType, "lineRange");
  assert.match(event.address.deepLink, /^codecharter:\/\//);
});

async function execFileWithInput(command, args, { cwd, input }) {
  const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.stdin.end(input);
  const [code] = await once(child, "exit");
  if (code !== 0) assert.fail(stderr);
}

function countCodecharterHooks(hooksJson) {
  const command = 'node "$(git rev-parse --show-toplevel)/.codex/hooks/codecharter-codex-hook.mjs"';
  return Object.values(hooksJson.hooks)
    .flat()
    .flatMap((group) => group.hooks)
    .filter((hook) => hook.command === command).length;
}
