/**
 * Promise wrapper around `child_process.execFile` that returns text streams and,
 * on failure, attaches `stdout`/`stderr` to the rejected error.
 *
 * Always uses an argument array (never a shell string) — no command-injection
 * surface (verified in the security audit).
 */

import { execFile } from "node:child_process";
import type { ExecFileOptions } from "node:child_process";

export type ExecFileTextOptions = Omit<ExecFileOptions, "encoding"> & {
  encoding?: BufferEncoding;
};

export function execFileText(
  file: string,
  args: readonly string[],
  options: ExecFileTextOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { ...options, encoding: options.encoding ?? "utf8" }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
