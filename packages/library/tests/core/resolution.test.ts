import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { resolveTrackerDir } from "../../src/core/resolution";

describe("resolveTrackerDir", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `trackgentic-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("finds .trackgentic/ in the current directory", () => {
    const trackerDir = join(testDir, ".trackgentic");
    mkdirSync(trackerDir);

    const result = resolveTrackerDir(testDir);
    expect(result).toBe(resolve(trackerDir));
  });

  test("finds .trackgentic/ in a parent directory", () => {
    const trackerDir = join(testDir, ".trackgentic");
    mkdirSync(trackerDir);

    const nestedDir = join(testDir, "sub", "deep");
    mkdirSync(nestedDir, { recursive: true });

    const result = resolveTrackerDir(nestedDir);
    expect(result).toBe(resolve(trackerDir));
  });

  test("returns null when no .trackgentic/ exists", () => {
    const result = resolveTrackerDir(testDir);
    expect(result).toBeNull();
  });

  test("returns correct absolute path", () => {
    const trackerDir = join(testDir, ".trackgentic");
    mkdirSync(trackerDir);

    const result = resolveTrackerDir(testDir);
    expect(result).not.toBeNull();
    expect(resolve(result!)).toBe(resolve(trackerDir));
  });
});
