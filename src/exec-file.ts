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
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
