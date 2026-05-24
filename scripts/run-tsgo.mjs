import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const projects = [
  {
    name: "core",
    args: [
      "-p",
      "core/tsconfig.json",
      "--incremental",
      "--tsBuildInfoFile",
      ".artifacts/tsgo-cache/core.tsbuildinfo",
    ],
  },
  {
    name: "viewer",
    args: [
      "-p",
      "viewer/tsconfig.json",
      "--incremental",
      "--tsBuildInfoFile",
      ".artifacts/tsgo-cache/viewer.tsbuildinfo",
    ],
  },
];

for (const project of projects) {
  const buildInfoIndex = project.args.indexOf("--tsBuildInfoFile");
  const buildInfoPath = buildInfoIndex === -1 ? undefined : project.args[buildInfoIndex + 1];
  if (buildInfoPath) {
    mkdirSync(dirname(buildInfoPath), { recursive: true });
  }

  const result = spawnSync("tsgo", project.args, { stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    console.error(`[tsgo] ${project.name} failed`);
    process.exitCode = result.status ?? 1;
    break;
  }
}
