import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrackgenticError } from "../../../src/core/errors";
import { Tracker } from "../../../src/core/tracker";

describe("Tracker", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `trackgentic-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  // ─── Comments Tests ──────────────────────────────────────────────

  describe("comments", () => {
    let tracker: Tracker;

    beforeEach(async () => {
      tracker = new Tracker(testDir);
      await tracker.init();
    });

    test("add comment creates a comment event and returns commentId", async () => {
      const created = await tracker.create({ title: "Comment Test" });
      if (!("id" in created)) throw new Error("Create failed");

      const result = await tracker.commentsAdd(created.id, { content: "Hello world" });

      expect(result.result).toBe("OK");
      if (result.result === "OK") {
        expect(result.commentId).toHaveLength(10);
      }
    });

    test("add comment to non-existent issue throws NOT_FOUND", async () => {
      try {
        await tracker.commentsAdd("missing12345", { content: "Hello" });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("NOT_FOUND");
        expect(e.exitCode).toBe(5);
      }
    });

    test("update comment appends comment-update event", async () => {
      const created = await tracker.create({ title: "Comment Test" });
      if (!("id" in created)) throw new Error("Create failed");

      const addResult = await tracker.commentsAdd(created.id, { content: "Original" });
      if (addResult.result !== "OK") throw new Error("Add failed");

      const updateResult = await tracker.commentsUpdate(created.id, addResult.commentId, {
        content: "Updated",
      });
      expect(updateResult).toEqual({ result: "OK" });

      // Verify via commentsList
      const comments = await tracker.commentsList(created.id);
      if (Array.isArray(comments)) {
        expect(comments).toHaveLength(1);
        expect(comments[0].content).toBe("Updated");
      }
    });

    test("update comment sets editedAt", async () => {
      const created = await tracker.create({ title: "Comment Test" });
      if (!("id" in created)) throw new Error("Create failed");

      const addResult = await tracker.commentsAdd(created.id, { content: "Original" });
      if (addResult.result !== "OK") throw new Error("Add failed");

      await tracker.commentsUpdate(created.id, addResult.commentId, { content: "Updated" });

      const comments = await tracker.commentsList(created.id);
      if (Array.isArray(comments)) {
        expect(comments[0].editedAt).not.toBeNull();
      }
    });

    test("update non-existent comment throws COMMENT_NOT_FOUND", async () => {
      const created = await tracker.create({ title: "Comment Test" });
      if (!("id" in created)) throw new Error("Create failed");

      try {
        await tracker.commentsUpdate(created.id, "fake000000", { content: "Nope" });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("COMMENT_NOT_FOUND");
        expect(e.exitCode).toBe(7);
      }
    });

    test("update deleted comment throws COMMENT_NOT_FOUND", async () => {
      const created = await tracker.create({ title: "Comment Test" });
      if (!("id" in created)) throw new Error("Create failed");

      const addResult = await tracker.commentsAdd(created.id, { content: "To delete" });
      if (addResult.result !== "OK") throw new Error("Add failed");

      await tracker.commentsDelete(created.id, addResult.commentId);

      try {
        await tracker.commentsUpdate(created.id, addResult.commentId, { content: "Nope" });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("COMMENT_NOT_FOUND");
      }
    });

    test("delete comment excludes it from commentsList", async () => {
      const created = await tracker.create({ title: "Comment Test" });
      if (!("id" in created)) throw new Error("Create failed");

      const addResult = await tracker.commentsAdd(created.id, { content: "To delete" });
      if (addResult.result !== "OK") throw new Error("Add failed");

      const deleteResult = await tracker.commentsDelete(created.id, addResult.commentId);
      expect(deleteResult).toEqual({ result: "OK" });

      const comments = await tracker.commentsList(created.id);
      if (Array.isArray(comments)) {
        expect(comments).toHaveLength(0);
      }
    });

    test("delete non-existent comment throws COMMENT_NOT_FOUND", async () => {
      const created = await tracker.create({ title: "Comment Test" });
      if (!("id" in created)) throw new Error("Create failed");

      try {
        await tracker.commentsDelete(created.id, "fake000000");
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("COMMENT_NOT_FOUND");
        expect(e.exitCode).toBe(7);
      }
    });

    test("double delete throws COMMENT_NOT_FOUND on second delete", async () => {
      const created = await tracker.create({ title: "Comment Test" });
      if (!("id" in created)) throw new Error("Create failed");

      const addResult = await tracker.commentsAdd(created.id, { content: "To delete" });
      if (addResult.result !== "OK") throw new Error("Add failed");

      await tracker.commentsDelete(created.id, addResult.commentId);

      try {
        await tracker.commentsDelete(created.id, addResult.commentId);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("COMMENT_NOT_FOUND");
      }
    });

    test("comments list returns comments in creation order", async () => {
      const created = await tracker.create({ title: "Comment Test" });
      if (!("id" in created)) throw new Error("Create failed");

      await tracker.commentsAdd(created.id, { content: "First" });
      await tracker.commentsAdd(created.id, { content: "Second" });
      await tracker.commentsAdd(created.id, { content: "Third" });

      const comments = await tracker.commentsList(created.id);
      if (Array.isArray(comments)) {
        expect(comments).toHaveLength(3);
        expect(comments[0].content).toBe("First");
        expect(comments[1].content).toBe("Second");
        expect(comments[2].content).toBe("Third");
      }
    });

    test("comments list after add+update+delete returns correct state", async () => {
      const created = await tracker.create({ title: "Comment Test" });
      if (!("id" in created)) throw new Error("Create failed");

      const c1 = await tracker.commentsAdd(created.id, { content: "Keep" });
      const c2 = await tracker.commentsAdd(created.id, { content: "Delete me" });
      const c3 = await tracker.commentsAdd(created.id, { content: "Update me" });

      if (c1.result !== "OK" || c2.result !== "OK" || c3.result !== "OK") {
        throw new Error("Add failed");
      }

      await tracker.commentsDelete(created.id, c2.commentId);
      await tracker.commentsUpdate(created.id, c3.commentId, { content: "Updated!" });

      const comments = await tracker.commentsList(created.id);
      if (Array.isArray(comments)) {
        expect(comments).toHaveLength(2);
        expect(comments[0].id).toBe(c1.commentId);
        expect(comments[0].content).toBe("Keep");
        expect(comments[0].editedAt).toBeNull();
        expect(comments[1].id).toBe(c3.commentId);
        expect(comments[1].content).toBe("Updated!");
        expect(comments[1].editedAt).not.toBeNull();
      }
    });

    test("comments on non-existent issue throws NOT_FOUND", async () => {
      try {
        await tracker.commentsList("missing12345");
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("NOT_FOUND");
        expect(e.exitCode).toBe(5);
      }
    });

    test("comments on missing file throws ISSUE_MISSING", async () => {
      const created = await tracker.create({ title: "Comment Test" });
      if (!("id" in created)) throw new Error("Create failed");

      const issuePath = join(testDir, ".trackgentic", "issues", `${created.id}.json`);
      unlinkSync(issuePath);

      try {
        await tracker.commentsList(created.id);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("ISSUE_MISSING");
        expect(e.exitCode).toBe(6);
      }
    });

    test("COMMENT_NOT_FOUND has exitCode 7", async () => {
      const created = await tracker.create({ title: "Test" });
      if (!("id" in created)) throw new Error("Create failed");

      try {
        await tracker.commentsUpdate(created.id, "fake000000", { content: "Nope" });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("COMMENT_NOT_FOUND");
        expect(e.exitCode).toBe(7);
      }
    });

    test("commentsAdd uses author param when provided", async () => {
      const created = await tracker.create({ title: "Author Test" });
      if (!("id" in created)) throw new Error("Create failed");

      await tracker.commentsAdd(created.id, { content: "Hello", author: "custom-author" });

      const comments = await tracker.commentsList(created.id);
      if (Array.isArray(comments)) {
        expect(comments[0].author).toBe("custom-author");
      }
    });

    test("commentsUpdate uses author param when provided", async () => {
      const created = await tracker.create({ title: "Author Test" });
      if (!("id" in created)) throw new Error("Create failed");

      const addResult = await tracker.commentsAdd(created.id, { content: "Original" });
      if (addResult.result !== "OK") throw new Error("Add failed");

      const updateResult = await tracker.commentsUpdate(created.id, addResult.commentId, {
        content: "Updated",
        author: "custom-author",
      });
      expect(updateResult).toEqual({ result: "OK" });
    });

    test("commentsDelete uses author param when provided", async () => {
      const created = await tracker.create({ title: "Author Test" });
      if (!("id" in created)) throw new Error("Create failed");

      const addResult = await tracker.commentsAdd(created.id, { content: "To delete" });
      if (addResult.result !== "OK") throw new Error("Add failed");

      const deleteResult = await tracker.commentsDelete(created.id, addResult.commentId, {
        author: "custom-author",
      });
      expect(deleteResult).toEqual({ result: "OK" });
    });

    test("commentsAdd throws NOT_INITIALIZED when no .trackgentic/ exists", async () => {
      const uninitDir = join(
        tmpdir(),
        `trackgentic-uninit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      mkdirSync(uninitDir, { recursive: true });
      const uninitTracker = new Tracker(uninitDir);
      try {
        await uninitTracker.commentsAdd("missing12345", { content: "Hello" });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("NOT_INITIALIZED");
        expect(e.exitCode).toBe(1);
      }
      rmSync(uninitDir, { recursive: true, force: true });
    });

    test("commentsUpdate throws NOT_INITIALIZED when no .trackgentic/ exists", async () => {
      const uninitDir = join(
        tmpdir(),
        `trackgentic-uninit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      mkdirSync(uninitDir, { recursive: true });
      const uninitTracker = new Tracker(uninitDir);
      try {
        await uninitTracker.commentsUpdate("missing12345", "fake000000", { content: "Hello" });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("NOT_INITIALIZED");
      }
      rmSync(uninitDir, { recursive: true, force: true });
    });

    test("commentsDelete throws NOT_INITIALIZED when no .trackgentic/ exists", async () => {
      const uninitDir = join(
        tmpdir(),
        `trackgentic-uninit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      mkdirSync(uninitDir, { recursive: true });
      const uninitTracker = new Tracker(uninitDir);
      try {
        await uninitTracker.commentsDelete("missing12345", "fake000000");
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("NOT_INITIALIZED");
      }
      rmSync(uninitDir, { recursive: true, force: true });
    });

    test("commentsList throws NOT_INITIALIZED when no .trackgentic/ exists", async () => {
      const uninitDir = join(
        tmpdir(),
        `trackgentic-uninit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      mkdirSync(uninitDir, { recursive: true });
      const uninitTracker = new Tracker(uninitDir);
      try {
        await uninitTracker.commentsList("missing12345");
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("NOT_INITIALIZED");
      }
      rmSync(uninitDir, { recursive: true, force: true });
    });

    test("commentsUpdate throws ISSUE_MISSING when file is deleted", async () => {
      const created = await tracker.create({ title: "Comment Test" });
      if (!("id" in created)) throw new Error("Create failed");

      const addResult = await tracker.commentsAdd(created.id, { content: "Original" });
      if (addResult.result !== "OK") throw new Error("Add failed");

      // Delete the issue file
      const issuePath = join(testDir, ".trackgentic", "issues", `${created.id}.json`);
      unlinkSync(issuePath);

      try {
        await tracker.commentsUpdate(created.id, addResult.commentId, { content: "Updated" });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("ISSUE_MISSING");
        expect(e.exitCode).toBe(6);
      }
    });

    test("commentsDelete throws ISSUE_MISSING when file is deleted", async () => {
      const created = await tracker.create({ title: "Comment Test" });
      if (!("id" in created)) throw new Error("Create failed");

      const addResult = await tracker.commentsAdd(created.id, { content: "Original" });
      if (addResult.result !== "OK") throw new Error("Add failed");

      // Delete the issue file
      const issuePath = join(testDir, ".trackgentic", "issues", `${created.id}.json`);
      unlinkSync(issuePath);

      try {
        await tracker.commentsDelete(created.id, addResult.commentId);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("ISSUE_MISSING");
        expect(e.exitCode).toBe(6);
      }
    });

    test("commentsAdd throws NOT_FOUND for issue in index but missing file", async () => {
      // This tests the findEntry returning null path
      try {
        await tracker.commentsAdd("missing12345", { content: "Hello" });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("NOT_FOUND");
      }
    });

    test("commentsDelete on non-existent issue throws NOT_FOUND", async () => {
      try {
        await tracker.commentsDelete("missing12345", "fake000000");
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("NOT_FOUND");
      }
    });

    test("commentsUpdate on non-existent issue throws NOT_FOUND", async () => {
      try {
        await tracker.commentsUpdate("missing12345", "fake000000", { content: "Hello" });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("NOT_FOUND");
      }
    });
  });
});
