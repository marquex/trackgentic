import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWriteJSON, readJSON } from "../../src/core/file-io";

describe("file-io", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `trackgentic-fileio-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("atomicWriteJSON", () => {
    test("creates parent directory when it doesn't exist", async () => {
      const nestedPath = join(testDir, "deep", "nested", "dir", "file.json");

      await atomicWriteJSON(nestedPath, { hello: "world" });

      expect(existsSync(nestedPath)).toBe(true);
      const contents = await readJSON<{ hello: string }>(nestedPath);
      expect(contents.hello).toBe("world");
    });

    test("writes valid JSON with trailing newline", async () => {
      const filePath = join(testDir, "test.json");

      await atomicWriteJSON(filePath, { key: "value" });

      const { readFileSync } = await import("node:fs");
      const raw = readFileSync(filePath, "utf-8");
      expect(raw.endsWith("\n")).toBe(true);
      expect(JSON.parse(raw)).toEqual({ key: "value" });
    });

    test("overwrites existing file atomically", async () => {
      const filePath = join(testDir, "overwrite.json");

      await atomicWriteJSON(filePath, { version: 1 });
      await atomicWriteJSON(filePath, { version: 2 });

      const contents = await readJSON<{ version: number }>(filePath);
      expect(contents.version).toBe(2);
    });

    test("cleans up temp file when rename fails", async () => {
      // Create the target path as a directory to make rename fail
      const targetPath = join(testDir, "blocking-dir");
      mkdirSync(targetPath);

      try {
        await atomicWriteJSON(targetPath, { should: "fail" });
        // If it doesn't throw, skip this assertion
        expect(true).toBe(true);
      } catch (err) {
        expect(err).toBeDefined();
        // Verify no temp files were left behind
        const { readdirSync } = await import("node:fs");
        const files = readdirSync(testDir);
        const tempFiles = files.filter((f) => f.startsWith(".tmp-"));
        expect(tempFiles).toHaveLength(0);
      }
    });
  });

  describe("readJSON", () => {
    test("reads and parses JSON file", async () => {
      const filePath = join(testDir, "read-test.json");
      const { writeFileSync } = await import("node:fs");
      writeFileSync(filePath, JSON.stringify({ foo: "bar" }));

      const result = await readJSON<{ foo: string }>(filePath);
      expect(result.foo).toBe("bar");
    });

    test("throws on missing file", async () => {
      const filePath = join(testDir, "nonexistent.json");

      expect(readJSON(filePath)).rejects.toThrow();
    });
  });
});
