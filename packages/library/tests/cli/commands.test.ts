import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "bun";

describe("CLI commands", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `trackgentic-cli-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("init", () => {
    test("trackgentic init prints correct JSON to stdout", async () => {
      const proc = spawn({
        cmd: ["bun", "run", join(import.meta.dir, "..", "..", "src", "bin.ts"), "init"],
        cwd: testDir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const result = JSON.parse(stdout.trim());
      expect(result.result).toBe("OK");
      expect(result.path).toContain(".trackgentic");
    });

    test("trackgentic init when already initialized prints ALREADY_INITIALIZED", async () => {
      // First init
      const proc1 = spawn({
        cmd: ["bun", "run", join(import.meta.dir, "..", "..", "src", "bin.ts"), "init"],
        cwd: testDir,
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc1.exited;

      // Second init
      const proc2 = spawn({
        cmd: ["bun", "run", join(import.meta.dir, "..", "..", "src", "bin.ts"), "init"],
        cwd: testDir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc2.stdout).text();
      const exitCode = await proc2.exited;

      // ALREADY_INITIALIZED is returned with exitCode 0
      // The spec says init returns InitResult which can be ALREADY_INITIALIZED
      // The CLI init command treats this as success (exitCode 0, output to stdout)
      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout.trim());
      expect(result.result).toBe("ALREADY_INITIALIZED");
      expect(result.path).toContain(".trackgentic");
    });
  });
});
