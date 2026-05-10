import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Create a temporary directory for test isolation.
 * Each test gets its own unique directory under the system temp dir.
 */
export function createTestDir(prefix = "trackgentic-test"): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

/**
 * Clean up a temporary test directory.
 * Safe to call even if the directory doesn't exist.
 */
export function cleanupTestDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
