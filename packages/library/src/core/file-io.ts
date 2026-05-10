import { readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

/**
 * Read and parse a JSON file.
 */
export async function readJSON<T>(filePath: string): Promise<T> {
  const contents = await readFile(filePath, "utf-8");
  return JSON.parse(contents) as T;
}

/**
 * Write JSON to a file atomically using write-to-temp-then-rename.
 * Creates parent directories if they don't exist.
 */
export async function atomicWriteJSON(filePath: string, data: unknown): Promise<void> {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tmpPath = join(dir, `.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    await writeFile(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
    await rename(tmpPath, filePath);
  } catch (err) {
    // Clean up temp file if rename fails
    try {
      const { unlinkSync } = await import("node:fs");
      unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}
