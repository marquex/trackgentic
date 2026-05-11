import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "bun";

export const BIN_PATH = join(import.meta.dir, "..", "..", "..", "src", "bin.ts");

export function createTestDir(prefix = "trackgentic-cli-test"): string {
  return mkdirSync(
    join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    { recursive: true },
  );
}

export function cleanupTestDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export async function runCLI(
  testDir: string,
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return runCLIWithEnv(testDir, {}, ...args);
}

export async function runCLIWithEnv(
  testDir: string,
  env: Record<string, string>,
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = spawn({
    cmd: ["bun", "run", BIN_PATH, ...args],
    cwd: testDir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}
