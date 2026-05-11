import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replayEvents } from "../../../src/core/events";
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

  describe("replayEvents", () => {
    test("returns events in order", async () => {
      const filePath = join(testDir, "test-issue.json");
      const events: Event[] = [
        { type: "creation", timestamp: "2026-01-01T00:00:00.000Z", author: "alice" },
        {
          type: "update",
          timestamp: "2026-01-01T01:00:00.000Z",
          author: "bob",
          content: { title: "Test" },
        },
      ];

      writeFileSync(filePath, JSON.stringify(events, null, 2));

      const result = await replayEvents(filePath);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe("creation");
      expect(result[1].type).toBe("update");
    });

    test("returns empty array for file with empty array", async () => {
      const filePath = join(testDir, "test-issue.json");
      writeFileSync(filePath, "[]");

      const result = await replayEvents(filePath);

      expect(result).toEqual([]);
    });
  });
});
