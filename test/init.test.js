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
  assert.match(JSON.stringify(hooksJson.hooks.PostToolUse), /exec_command/);
  await access(join(root, ".codex", "hooks", "codecharter-codex-hook.mjs"), constants.X_OK);
  const hookShim = await readFile(join(root, ".codex", "hooks", "codecharter-codex-hook.mjs"), "utf8");
  assert.match(hookShim, /npx", args: \["--yes", "codecharter@\d+\.\d+\.\d+", "codex-hook"\]/);

  const skill = await readFile(join(root, ".agents", "skills", "codecharter", "SKILL.md"), "utf8");
  assert.match(skill, /CodeCharter prompts/);
  assert.match(skill, /codecharter:\/\/ deep link/);
  assert.match(skill, /codecharter --json resolve "codecharter:\/\/annotation\/<id>"/);
  assert.match(skill, /npx --yes codecharter@\d+\.\d+\.\d+ --json resolve "codecharter:\/\/annotation\/<id>"/);
  assert.match(skill, /resolvedTargets/);
  assert.match(skill, /normal Codex file-reading tools/);
  assert.match(skill, /Do not bulk-read every file/);
  assert.match(skill, /Do not use browser automation/);
  const skillUi = await readFile(join(root, ".agents", "skills", "codecharter", "agents", "openai.yaml"), "utf8");
  assert.match(skillUi, /display_name: "CodeCharter"/);
  assert.match(skillUi, /default_prompt: "Use \$codecharter/);

  const postMergeHook = await readFile(join(root, ".git", "hooks", "post-merge"), "utf8");
  assert.match(postMergeHook, /codecharter generate/);
  assert.match(postMergeHook, /npx --yes codecharter@\d+\.\d+\.\d+ generate/);

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
  assert.equal(doctor.checks.cli.packageDependency.ok, true);
  assert.match(doctor.checks.cli.recommendedCommand, /^npx --yes codecharter@\d+\.\d+\.\d+$/);
  assert.equal(doctor.checks.codexSkill.exists, true);
  assert.equal(doctor.checks.codexSkillUi.exists, true);
});

test("codecharter init repairs old package dependency installs and missing skill files", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-init-repair-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, ".codex", "hooks"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), "export const app = true;\n");
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "sample-app",
    version: "1.0.0",
    devDependencies: { codecharter: "^0.1.1" },
  }));
  await writeFile(join(root, ".codex", "hooks.json"), JSON.stringify({
    hooks: {
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

  const { stdout: beforeDoctorStdout } = await execFileAsync("node", [
    join(process.cwd(), "bin", "codemap.mjs"),
    "--json",
    "doctor",
    "--root",
    root,
  ], { cwd: root });
  const beforeDoctor = JSON.parse(beforeDoctorStdout);
  assert.equal(beforeDoctor.ok, false);
  assert.equal(beforeDoctor.checks.cli.packageDependency.ok, false);
  assert.match(beforeDoctor.setup.missing.join(","), /codexSkill/);
  assert.match(beforeDoctor.setup.missing.join(","), /packageDependency/);

  await execFileAsync("node", [
    join(process.cwd(), "bin", "codemap.mjs"),
    "init",
    "--root",
    root,
    "--yes",
  ], { cwd: root });

  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.notEqual(packageJson.devDependencies.codecharter, "^0.1.1");
  assert.match(packageJson.devDependencies.codecharter, /^\^0\.1\.\d+$/);

  const skill = await readFile(join(root, ".agents", "skills", "codecharter", "SKILL.md"), "utf8");
  assert.match(skill, /If `command -v codecharter` fails/);
  assert.match(skill, /npx --yes codecharter@\d+\.\d+\.\d+/);

  const { stdout: doctorStdout } = await execFileAsync("node", [
    join(process.cwd(), "bin", "codemap.mjs"),
    "--json",
    "doctor",
    "--root",
    root,
  ], { cwd: root });
  const doctor = JSON.parse(doctorStdout);
  assert.equal(doctor.ok, true);
  assert.equal(doctor.setup.ready, true);
  assert.equal(doctor.checks.cli.packageDependency.ok, true);
  assert.equal(doctor.checks.cli.packageDependency.section, "devDependencies");
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
  assert.equal(hooksJson.hooks.PostToolUse.some((group) => (group.hooks ?? []).length === 0), false);
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
  assert.equal(event.threadId, "session-1");
  assert.equal(event.threadUri, "codex://threads/session-1");
  assert.equal(event.address.targetType, "lineRange");
  assert.match(event.address.deepLink, /^codecharter:\/\//);
});

test("codecharter codex-hook records explicit Codex thread URIs", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-codex-thread-"));
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
    thread_uri: "codex://threads/019e4c43-dd59-7f30-aea5-c00e63abc63f",
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
  assert.equal(event.threadId, "019e4c43-dd59-7f30-aea5-c00e63abc63f");
  assert.equal(event.threadUri, "codex://threads/019e4c43-dd59-7f30-aea5-c00e63abc63f");
});

test("codecharter codex-hook scopes write activity to tool input paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-codex-hook-scoped-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), "export const app = true;\n");
  await writeFile(join(root, "src", "other.ts"), "export const other = true;\n");
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["add", "src/app.ts", "src/other.ts"], { cwd: root });
  await execFileAsync("git", ["-c", "user.name=CodeCharter", "-c", "user.email=codecharter@example.invalid", "commit", "-m", "init"], { cwd: root });
  await execFileAsync("node", [
    join(process.cwd(), "bin", "codemap.mjs"),
    "generate",
    "--root",
    root,
    "--out",
    join(root, "codecharter.json"),
    "--quiet",
  ], { cwd: root });

  await writeFile(join(root, "src", "app.ts"), "export const app = false;\n");
  await writeFile(join(root, "src", "other.ts"), "export const other = false;\n");

  const payload = {
    session_id: "session-scoped",
    turn_id: "turn-scoped",
    cwd: root,
    hook_event_name: "PostToolUse",
    tool_name: "apply_patch",
    tool_input: { command: "*** Begin Patch\n*** Update File: src/app.ts\n@@\n-export const app = true;\n+export const app = false;\n*** End Patch\n" },
    model: "gpt-test",
  };

  await execFileWithInput("node", [
    join(process.cwd(), "bin", "codemap.mjs"),
    "codex-hook",
  ], { cwd: root, input: JSON.stringify(payload) });

  const lines = (await readFile(join(root, ".codecharter", "activity.jsonl"), "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  const event = JSON.parse(lines[0]);
  assert.equal(event.address.path, "src/app.ts");
  assert.equal(event.sessionId, "session-scoped");
});

test("codecharter codex-hook refreshes the map before resolving new file activity", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-codex-hook-new-file-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), "export const app = true;\n");
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["add", "src/app.ts"], { cwd: root });
  await execFileAsync("git", ["-c", "user.name=CodeCharter", "-c", "user.email=codecharter@example.invalid", "commit", "-m", "init"], { cwd: root });
  await execFileAsync("node", [
    join(process.cwd(), "bin", "codemap.mjs"),
    "generate",
    "--root",
    root,
    "--out",
    join(root, "codecharter.json"),
    "--quiet",
  ], { cwd: root });

  await writeFile(join(root, "src", "new.ts"), "export const created = true;\n");

  const payload = {
    session_id: "session-new-file",
    turn_id: "turn-new-file",
    cwd: root,
    hook_event_name: "PostToolUse",
    tool_name: "apply_patch",
    tool_input: { command: "*** Begin Patch\n*** Add File: src/new.ts\n+export const created = true;\n*** End Patch\n" },
    model: "gpt-test",
  };

  await execFileWithInput("node", [
    join(process.cwd(), "bin", "codemap.mjs"),
    "codex-hook",
  ], { cwd: root, input: JSON.stringify(payload) });

  const lines = (await readFile(join(root, ".codecharter", "activity.jsonl"), "utf8")).trim().split("\n");
  const event = JSON.parse(lines[0]);
  assert.equal(event.address.path, "src/new.ts");
  assert.equal(event.address.targetType, "lineRange");

  const sidecar = JSON.parse(await readFile(join(root, "codecharter.json"), "utf8"));
  assert.ok(sidecar.files["src/new.ts"]);
});

test("codecharter codex-hook maps Bash read commands as reading activity", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-codex-hook-read-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), [
    "export const app = true;",
    "export const other = false;",
    "",
  ].join("\n"));
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["add", "src/app.ts"], { cwd: root });
  await execFileAsync("git", ["-c", "user.name=CodeCharter", "-c", "user.email=codecharter@example.invalid", "commit", "-m", "init"], { cwd: root });
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
    session_id: "session-read",
    turn_id: "turn-read",
    cwd: root,
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command: "sed -n '1,2p' src/app.ts" },
    model: "gpt-test",
  };

  await execFileWithInput("node", [
    join(process.cwd(), "bin", "codemap.mjs"),
    "codex-hook",
  ], { cwd: root, input: JSON.stringify(payload) });

  const lines = (await readFile(join(root, ".codecharter", "activity.jsonl"), "utf8")).trim().split("\n");
  const event = JSON.parse(lines[0]);
  assert.equal(event.agentId, "codex");
  assert.equal(event.activityState, "reading");
  assert.equal(event.note, "Codex read src/app.ts");
  assert.equal(event.hookEventName, "PostToolUse");
  assert.equal(event.sessionId, "session-read");
  assert.equal(event.address.targetType, "lineRange");
  assert.deepEqual(event.address.lineRange, { start: 1, end: 2 });
  assert.match(event.address.deepLink, /path=src%2Fapp\.ts/);
});

test("codecharter codex-hook maps sed reads under plural path segments", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-codex-hook-packages-read-"));
  await mkdir(join(root, "packages", "feature"), { recursive: true });
  await writeFile(join(root, "packages", "feature", "AGENTS.md"), [
    "# Feature",
    "Read me",
    "",
  ].join("\n"));
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["add", "packages/feature/AGENTS.md"], { cwd: root });
  await execFileAsync("git", ["-c", "user.name=CodeCharter", "-c", "user.email=codecharter@example.invalid", "commit", "-m", "init"], { cwd: root });
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
    session_id: "session-packages-read",
    turn_id: "turn-packages-read",
    cwd: root,
    hook_event_name: "PostToolUse",
    tool_name: "exec_command",
    tool_input: { cmd: "sed -n '1,2p' packages/feature/AGENTS.md" },
    model: "gpt-test",
  };

  await execFileWithInput("node", [
    join(process.cwd(), "bin", "codemap.mjs"),
    "codex-hook",
  ], { cwd: root, input: JSON.stringify(payload) });

  const lines = (await readFile(join(root, ".codecharter", "activity.jsonl"), "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  const event = JSON.parse(lines[0]);
  assert.equal(event.activityState, "reading");
  assert.equal(event.note, "Codex read packages/feature/AGENTS.md");
  assert.deepEqual(event.address.lineRange, { start: 1, end: 2 });
  assert.match(event.address.deepLink, /path=packages%2Ffeature%2FAGENTS\.md/);
});

test("codecharter codex-hook maps Codex app shell reads as reading activity", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-codex-hook-app-read-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), [
    "export const app = true;",
    "export const other = false;",
    "",
  ].join("\n"));
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["add", "src/app.ts"], { cwd: root });
  await execFileAsync("git", ["-c", "user.name=CodeCharter", "-c", "user.email=codecharter@example.invalid", "commit", "-m", "init"], { cwd: root });
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
    session_id: "session-app-read",
    turn_id: "turn-app-read",
    cwd: root,
    hook_event_name: "PostToolUse",
    tool_name: "functions.exec_command",
    tool_input: { cmd: "sed -n '1,2p' src/app.ts" },
    model: "gpt-test",
  };

  await execFileWithInput("node", [
    join(process.cwd(), "bin", "codemap.mjs"),
    "codex-hook",
  ], { cwd: root, input: JSON.stringify(payload) });

  const lines = (await readFile(join(root, ".codecharter", "activity.jsonl"), "utf8")).trim().split("\n");
  const event = JSON.parse(lines[0]);
  assert.equal(event.activityState, "reading");
  assert.equal(event.note, "Codex read src/app.ts");
  assert.equal(event.sessionId, "session-app-read");
  assert.deepEqual(event.address.lineRange, { start: 1, end: 2 });
});

test("codecharter codex-hook does not use dirty-file fallback for Codex Desktop reads", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-codex-hook-desktop-read-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), [
    "export const app = true;",
    "export const other = false;",
    "",
  ].join("\n"));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "sample-app", version: "1.0.0" }));
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["add", "src/app.ts", "package.json"], { cwd: root });
  await execFileAsync("git", ["-c", "user.name=CodeCharter", "-c", "user.email=codecharter@example.invalid", "commit", "-m", "init"], { cwd: root });
  await execFileAsync("node", [
    join(process.cwd(), "bin", "codemap.mjs"),
    "generate",
    "--root",
    root,
    "--out",
    join(root, "codecharter.json"),
    "--quiet",
  ], { cwd: root });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "sample-app", version: "1.0.1" }));

  const payload = {
    session_id: "session-desktop-read",
    turn_id: "turn-desktop-read",
    cwd: root,
    hook_event_name: "PostToolUse",
    tool_name: "exec_command",
    tool_input: { cmd: "sed -n '1,2p' src/app.ts" },
    model: "gpt-test",
  };

  await execFileWithInput("node", [
    join(process.cwd(), "bin", "codemap.mjs"),
    "codex-hook",
  ], { cwd: root, input: JSON.stringify(payload) });

  const lines = (await readFile(join(root, ".codecharter", "activity.jsonl"), "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  const event = JSON.parse(lines[0]);
  assert.equal(event.activityState, "reading");
  assert.equal(event.note, "Codex read src/app.ts");
  assert.equal(event.sessionId, "session-desktop-read");
  assert.deepEqual(event.address.lineRange, { start: 1, end: 2 });
  assert.match(event.address.deepLink, /path=src%2Fapp\.ts/);
});

test("codecharter codex-hook maps nested ripgrep directory reads as folder activity", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecharter-codex-hook-rg-dir-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), "export const app = true;\n");
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "sample-app", version: "1.0.0" }));
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["add", "src/app.ts", "package.json"], { cwd: root });
  await execFileAsync("git", ["-c", "user.name=CodeCharter", "-c", "user.email=codecharter@example.invalid", "commit", "-m", "init"], { cwd: root });
  await execFileAsync("node", [
    join(process.cwd(), "bin", "codemap.mjs"),
    "generate",
    "--root",
    root,
    "--out",
    join(root, "codecharter.json"),
    "--quiet",
  ], { cwd: root });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "sample-app", version: "1.0.1" }));

  const payload = {
    session_id: "session-rg-dir",
    turn_id: "turn-rg-dir",
    cwd: root,
    hook_event_name: "PostToolUse",
    tool_name: "exec_command",
    tool_input: { input: { arguments: { cmd: "rg 'app' -n src --glob '*.ts'" } } },
    model: "gpt-test",
  };

  await execFileWithInput("node", [
    join(process.cwd(), "bin", "codemap.mjs"),
    "codex-hook",
  ], { cwd: root, input: JSON.stringify(payload) });

  const lines = (await readFile(join(root, ".codecharter", "activity.jsonl"), "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  const event = JSON.parse(lines[0]);
  assert.equal(event.activityState, "reading");
  assert.equal(event.note, "Codex read src");
  assert.equal(event.address.targetType, "folder");
  assert.equal(event.address.path, "src");
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
