/**
 * Error guards.
 */

/** True when `error` is a Node `ErrnoException` (has a `code` property). */
export function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/** Extract a human message from an unknown thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
