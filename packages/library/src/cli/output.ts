/**
 * Write a JSON result to stdout.
 */
export function writeStdout(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

/**
 * Write a JSON error to stderr.
 */
export function writeStderr(data: unknown): void {
  process.stderr.write(JSON.stringify(data, null, 2) + "\n");
}
