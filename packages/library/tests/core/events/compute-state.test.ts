import { describe, expect, test } from "bun:test";
import { computeState } from "../../../src/core/events";
import type { Event } from "../../../src/types";

describe("Event Engine", () => {
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
});
