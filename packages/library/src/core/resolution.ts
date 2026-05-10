import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const TRACKGENTIC_DIR = ".trackgentic";

/**
 * Walk up from `cwd` looking for a `.trackgentic/` directory.
 * Returns the absolute path to `.trackgentic/` if found, or `null` if not found.
 * Stops at filesystem root.
 */
export function resolveTrackerDir(cwd: string): string | null {
  let current = resolve(cwd);

  while (true) {
    const candidate = join(current, TRACKGENTIC_DIR);
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(current);
    if (parent === current) {
      // Reached filesystem root
      return null;
    }
    current = parent;
  }
}
