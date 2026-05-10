import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent, computeComments, computeState, replayEvents } from "../../src/core/events";
import type { Event } from "../../src/types";

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

  describe("computeState", () => {
    test("with creation event only → defaults + id, createdAt, createdBy", () => {
      const events: Event[] = [
        { type: "creation", timestamp: "2026-01-01T00:00:00.000Z", author: "alice" },
      ];

      const result = computeState(events, "abc123def4");

      expect(result.id).toBe("abc123def4");
      expect(result.createdAt).toBe("2026-01-01T00:00:00.000Z");
      expect(result.createdBy).toBe("alice");
      expect(result.updatedAt).toBe("2026-01-01T00:00:00.000Z");
      expect(result.title).toBe("");
      expect(result.description).toBe("");
      expect(result.status).toBe("idea");
      expect(result.priority).toBe(3);
      expect(result.assignee).toBeNull();
      expect(result.parentId).toBeNull();
      expect(result.tags).toEqual([]);
    });

    test("with creation + update → properties applied", () => {
      const events: Event[] = [
        { type: "creation", timestamp: "2026-01-01T00:00:00.000Z", author: "alice" },
        {
          type: "update",
          timestamp: "2026-01-01T01:00:00.000Z",
          author: "bob",
          content: {
            title: "My Issue",
            description: "Some details",
            status: "todo",
            priority: 1,
            assignee: "bob",
            tags: ["bug", "urgent"],
          },
        },
      ];

      const result = computeState(events, "abc123def4");

      expect(result.title).toBe("My Issue");
      expect(result.description).toBe("Some details");
      expect(result.status).toBe("todo");
      expect(result.priority).toBe(1);
      expect(result.assignee).toBe("bob");
      expect(result.tags).toEqual(["bug", "urgent"]);
      expect(result.updatedAt).toBe("2026-01-01T01:00:00.000Z");
      expect(result.createdAt).toBe("2026-01-01T00:00:00.000Z");
      expect(result.createdBy).toBe("alice");
    });

    test("with multiple updates → last value wins for each field", () => {
      const events: Event[] = [
        { type: "creation", timestamp: "2026-01-01T00:00:00.000Z", author: "alice" },
        {
          type: "update",
          timestamp: "2026-01-01T01:00:00.000Z",
          author: "bob",
          content: { title: "First Title", status: "todo" },
        },
        {
          type: "update",
          timestamp: "2026-01-01T02:00:00.000Z",
          author: "charlie",
          content: { title: "Second Title", priority: 5 },
        },
      ];

      const result = computeState(events, "abc123def4");

      expect(result.title).toBe("Second Title");
      expect(result.status).toBe("todo"); // Not updated in second event, persists
      expect(result.priority).toBe(5);
      expect(result.updatedAt).toBe("2026-01-01T02:00:00.000Z");
    });

    test("ignores comment events", () => {
      const events: Event[] = [
        { type: "creation", timestamp: "2026-01-01T00:00:00.000Z", author: "alice" },
        {
          type: "update",
          timestamp: "2026-01-01T01:00:00.000Z",
          author: "alice",
          content: { title: "Test" },
        },
        {
          type: "comment",
          timestamp: "2026-01-01T02:00:00.000Z",
          author: "bob",
          content: { id: "cmt1234567", content: "A comment" },
        },
      ];

      const result = computeState(events, "abc123def4");

      expect(result.title).toBe("Test");
      expect(result.updatedAt).toBe("2026-01-01T02:00:00.000Z"); // updatedAt reflects last event
    });

    test("ignores blockage events", () => {
      const events: Event[] = [
        { type: "creation", timestamp: "2026-01-01T00:00:00.000Z", author: "alice" },
        {
          type: "update",
          timestamp: "2026-01-01T01:00:00.000Z",
          author: "alice",
          content: { title: "Test" },
        },
        {
          type: "blockage-added",
          timestamp: "2026-01-01T02:00:00.000Z",
          author: "alice",
          content: { blockerId: "xyz987abcd" },
        },
      ];

      const result = computeState(events, "abc123def4");

      expect(result.title).toBe("Test");
      expect(result.updatedAt).toBe("2026-01-01T02:00:00.000Z");
    });

    test("handles parentId in update event", () => {
      const events: Event[] = [
        { type: "creation", timestamp: "2026-01-01T00:00:00.000Z", author: "alice" },
        {
          type: "update",
          timestamp: "2026-01-01T01:00:00.000Z",
          author: "alice",
          content: { title: "Child", parentId: "parent123i" },
        },
      ];

      const result = computeState(events, "child12345");

      expect(result.parentId).toBe("parent123i");
    });

    test("empty event array → returns defaults with empty timestamps", () => {
      const result = computeState([], "empty00000");

      expect(result.id).toBe("empty00000");
      expect(result.title).toBe("");
      expect(result.description).toBe("");
      expect(result.status).toBe("idea");
      expect(result.priority).toBe(3);
      expect(result.assignee).toBeNull();
      expect(result.parentId).toBeNull();
      expect(result.tags).toEqual([]);
      expect(result.createdAt).toBe("");
      expect(result.createdBy).toBe("");
      expect(result.updatedAt).toBe("");
    });

    test("update event without prior creation → fields still applied", () => {
      const events: Event[] = [
        {
          type: "update",
          timestamp: "2026-03-15T12:00:00.000Z",
          author: "bob",
          content: { title: "Orphan Update" },
        },
      ];

      const result = computeState(events, "nocre00000");

      expect(result.title).toBe("Orphan Update");
      expect(result.createdAt).toBe("");
      expect(result.createdBy).toBe("");
      expect(result.updatedAt).toBe("2026-03-15T12:00:00.000Z");
    });

    test("update event with partial content (only title) → other fields keep defaults", () => {
      const events: Event[] = [
        { type: "creation", timestamp: "2026-01-01T00:00:00.000Z", author: "alice" },
        {
          type: "update",
          timestamp: "2026-01-01T01:00:00.000Z",
          author: "alice",
          content: { title: "Partial" },
        },
      ];

      const result = computeState(events, "partial0000");

      expect(result.title).toBe("Partial");
      expect(result.status).toBe("idea");
      expect(result.priority).toBe(3);
      expect(result.description).toBe("");
      expect(result.tags).toEqual([]);
    });

    test("handles assignee set to null", () => {
      const events: Event[] = [
        { type: "creation", timestamp: "2026-01-01T00:00:00.000Z", author: "alice" },
        {
          type: "update",
          timestamp: "2026-01-01T01:00:00.000Z",
          author: "alice",
          content: { title: "Test", assignee: "bob" },
        },
        {
          type: "update",
          timestamp: "2026-01-01T02:00:00.000Z",
          author: "alice",
          content: { assignee: null },
        },
      ];

      const result = computeState(events, "abc123def4");

      expect(result.assignee).toBeNull();
    });
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

  describe("computeComments", () => {
    test("single comment", () => {
      const events: Event[] = [
        { type: "creation", timestamp: "2026-01-01T00:00:00.000Z", author: "alice" },
        {
          type: "comment",
          timestamp: "2026-01-01T01:00:00.000Z",
          author: "bob",
          content: { id: "cmt1000001", content: "Hello world" },
        },
      ];

      const result = computeComments(events);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "cmt1000001",
        author: "bob",
        content: "Hello world",
        timestamp: "2026-01-01T01:00:00.000Z",
        editedAt: null,
      });
    });

    test("multiple comments in creation order", () => {
      const events: Event[] = [
        { type: "creation", timestamp: "2026-01-01T00:00:00.000Z", author: "alice" },
        {
          type: "comment",
          timestamp: "2026-01-01T01:00:00.000Z",
          author: "bob",
          content: { id: "cmt1000001", content: "First" },
        },
        {
          type: "comment",
          timestamp: "2026-01-01T02:00:00.000Z",
          author: "charlie",
          content: { id: "cmt1000002", content: "Second" },
        },
      ];

      const result = computeComments(events);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("cmt1000001");
      expect(result[1].id).toBe("cmt1000002");
    });

    test("update changes content and sets editedAt", () => {
      const events: Event[] = [
        { type: "creation", timestamp: "2026-01-01T00:00:00.000Z", author: "alice" },
        {
          type: "comment",
          timestamp: "2026-01-01T01:00:00.000Z",
          author: "bob",
          content: { id: "cmt1000001", content: "Original" },
        },
        {
          type: "comment-update",
          timestamp: "2026-01-01T02:00:00.000Z",
          author: "bob",
          content: { id: "cmt1000001", content: "Updated" },
        },
      ];

      const result = computeComments(events);

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("Updated");
      expect(result[0].editedAt).toBe("2026-01-01T02:00:00.000Z");
    });

    test("delete excludes comment from results", () => {
      const events: Event[] = [
        { type: "creation", timestamp: "2026-01-01T00:00:00.000Z", author: "alice" },
        {
          type: "comment",
          timestamp: "2026-01-01T01:00:00.000Z",
          author: "bob",
          content: { id: "cmt1000001", content: "To be deleted" },
        },
        {
          type: "comment-delete",
          timestamp: "2026-01-01T02:00:00.000Z",
          author: "bob",
          content: { id: "cmt1000001" },
        },
      ];

      const result = computeComments(events);

      expect(result).toHaveLength(0);
    });

    test("mixed add/update/delete sequence", () => {
      const events: Event[] = [
        { type: "creation", timestamp: "2026-01-01T00:00:00.000Z", author: "alice" },
        {
          type: "comment",
          timestamp: "2026-01-01T01:00:00.000Z",
          author: "bob",
          content: { id: "cmt1000001", content: "Keep me" },
        },
        {
          type: "comment",
          timestamp: "2026-01-01T02:00:00.000Z",
          author: "charlie",
          content: { id: "cmt1000002", content: "Delete me" },
        },
        {
          type: "comment",
          timestamp: "2026-01-01T03:00:00.000Z",
          author: "dave",
          content: { id: "cmt1000003", content: "Update me" },
        },
        {
          type: "comment-update",
          timestamp: "2026-01-01T04:00:00.000Z",
          author: "dave",
          content: { id: "cmt1000003", content: "Updated!" },
        },
        {
          type: "comment-delete",
          timestamp: "2026-01-01T05:00:00.000Z",
          author: "charlie",
          content: { id: "cmt1000002" },
        },
      ];

      const result = computeComments(events);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("cmt1000001");
      expect(result[0].content).toBe("Keep me");
      expect(result[0].editedAt).toBeNull();
      expect(result[1].id).toBe("cmt1000003");
      expect(result[1].content).toBe("Updated!");
      expect(result[1].editedAt).toBe("2026-01-01T04:00:00.000Z");
    });

    test("ignores non-comment events", () => {
      const events: Event[] = [
        { type: "creation", timestamp: "2026-01-01T00:00:00.000Z", author: "alice" },
        {
          type: "update",
          timestamp: "2026-01-01T01:00:00.000Z",
          author: "alice",
          content: { title: "Test" },
        },
        {
          type: "blockage-added",
          timestamp: "2026-01-01T02:00:00.000Z",
          author: "alice",
          content: { blockerId: "xyz987abcd" },
        },
      ];

      const result = computeComments(events);

      expect(result).toHaveLength(0);
    });

    test("update on non-existent comment is skipped", () => {
      const events: Event[] = [
        { type: "creation", timestamp: "2026-01-01T00:00:00.000Z", author: "alice" },
        {
          type: "comment-update",
          timestamp: "2026-01-01T01:00:00.000Z",
          author: "bob",
          content: { id: "nonexistent01", content: "Nope" },
        },
      ];

      const result = computeComments(events);

      expect(result).toHaveLength(0);
    });

    test("update on deleted comment is skipped", () => {
      const events: Event[] = [
        { type: "creation", timestamp: "2026-01-01T00:00:00.000Z", author: "alice" },
        {
          type: "comment",
          timestamp: "2026-01-01T01:00:00.000Z",
          author: "bob",
          content: { id: "cmt1000001", content: "Will be deleted" },
        },
        {
          type: "comment-delete",
          timestamp: "2026-01-01T02:00:00.000Z",
          author: "bob",
          content: { id: "cmt1000001" },
        },
        {
          type: "comment-update",
          timestamp: "2026-01-01T03:00:00.000Z",
          author: "bob",
          content: { id: "cmt1000001", content: "Try to update deleted" },
        },
      ];

      const result = computeComments(events);

      expect(result).toHaveLength(0);
    });
  });
});
