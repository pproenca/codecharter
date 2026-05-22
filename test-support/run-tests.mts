#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const requested = process.argv.slice(2);
const testFiles = requested.length ? requested : await discoverTestFiles();

if (testFiles.length === 0) {
  console.error("No test files discovered under test/*.test.{js,ts}");
  process.exit(1);
}

const child = spawn(process.execPath, ["--import", "tsx", "--test", ...testFiles], {
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

async function discoverTestFiles() {
  let entries;
  try {
    entries = await readdir("test");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.endsWith(".test.js") || entry.endsWith(".test.ts"))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => join("test", entry));
}
