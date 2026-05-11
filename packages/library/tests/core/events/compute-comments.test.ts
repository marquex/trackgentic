import { describe, expect, test } from "bun:test";
import { computeComments } from "../../../src/core/events";
import type { Event } from "../../../src/types";

describe("Event Engine", () => {
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
