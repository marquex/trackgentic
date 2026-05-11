import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent } from "../../../src/core/events";
import type { Event } from "../../../src/types";

describe("Event Engine", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `trackgentic-events-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("appendEvent", () => {
    test("creates valid JSON array when file doesn't exist", async () => {
      const filePath = join(testDir, "test-issue.json");
      const event: Event = {
        type: "creation",
        timestamp: "2026-01-01T00:00:00.000Z",
        author: "alice",
      };

      await appendEvent(filePath, event);

      expect(existsSync(filePath)).toBe(true);
      const contents = JSON.parse(readFileSync(filePath, "utf-8"));
      expect(Array.isArray(contents)).toBe(true);
      expect(contents).toHaveLength(1);
      expect(contents[0]).toEqual(event);
    });

    test("appends to existing file", async () => {
      const filePath = join(testDir, "test-issue.json");

      const event1: Event = {
        type: "creation",
        timestamp: "2026-01-01T00:00:00.000Z",
        author: "alice",
      };
      const event2: Event = {
        type: "update",
        timestamp: "2026-01-01T01:00:00.000Z",
        author: "bob",
        content: { title: "Test" },
      };

      await appendEvent(filePath, event1);
      await appendEvent(filePath, event2);

      const contents = JSON.parse(readFileSync(filePath, "utf-8"));
      expect(contents).toHaveLength(2);
      expect(contents[0]).toEqual(event1);
      expect(contents[1]).toEqual(event2);
    });

    test("appends to existing array in file", async () => {
      const filePath = join(testDir, "test-issue.json");
      const existingEvent: Event = {
        type: "creation",
        timestamp: "2026-01-01T00:00:00.000Z",
        author: "alice",
      };

      writeFileSync(filePath, JSON.stringify([existingEvent], null, 2));

      const newEvent: Event = {
        type: "update",
        timestamp: "2026-01-01T01:00:00.000Z",
        author: "bob",
        content: { title: "Updated" },
      };

      await appendEvent(filePath, newEvent);

      const contents = JSON.parse(readFileSync(filePath, "utf-8"));
      expect(contents).toHaveLength(2);
    });
  });
});
