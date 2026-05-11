import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
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

  // ─── Auth Integration Tests ──────────────────────────────────────

  describe("auth integration", () => {
    let tracker: Tracker;
    let savedToken: string | undefined;

    beforeEach(async () => {
      savedToken = process.env.TRACKGENTIC_USER_TOKEN;
      delete process.env.TRACKGENTIC_USER_TOKEN;
      tracker = new Tracker(testDir);
      await tracker.init();
    });

    afterEach(() => {
      if (savedToken !== undefined) {
        process.env.TRACKGENTIC_USER_TOKEN = savedToken;
      } else {
        delete process.env.TRACKGENTIC_USER_TOKEN;
      }
    });

    function setAuthMode(mode: "open" | "read-only" | "strict", defaultUser = "anonymous") {
      const configPath = join(testDir, ".trackgentic", "config.json");
      writeFileSync(configPath, JSON.stringify({ auth: { mode, defaultUser } }));
    }

    test("open mode: create without token uses defaultUser as author", async () => {
      const result = await tracker.create({ title: "Open Mode Test" });
      if ("id" in result) {
        const issuePath = join(testDir, ".trackgentic", "issues", `${result.id}.json`);
        const events = JSON.parse(readFileSync(issuePath, "utf-8"));
        expect(events[0].author).toBe("anonymous");
      }
    });

    test("read-only mode: create without token returns TOKEN_REQUIRED", async () => {
      setAuthMode("read-only");
      const result = await tracker.create({ title: "Should Fail" });

      expect(result).toBeInstanceOf(TrackgenticError);
      if (result instanceof TrackgenticError) {
        expect(result.result).toBe("TOKEN_REQUIRED");
        expect(result.exitCode).toBe(2);
      }
    });

    test("read-only mode: list without token succeeds", async () => {
      setAuthMode("read-only");
      const result = await tracker.list();
      expect(Array.isArray(result)).toBe(true);
    });

    test("read-only mode: update without token returns TOKEN_REQUIRED", async () => {
      // Create in open mode first
      const created = await tracker.create({ title: "To Update" });
      if (!("id" in created)) throw new Error("Create failed");

      // Switch to read-only and try to update
      setAuthMode("read-only");
      const result = await tracker.update(created.id, { title: "Should Fail" });

      expect(result).toBeInstanceOf(TrackgenticError);
      if (result instanceof TrackgenticError) {
        expect(result.result).toBe("TOKEN_REQUIRED");
      }
    });

    test("strict mode: list without token throws TOKEN_REQUIRED", async () => {
      setAuthMode("strict");
      try {
        await tracker.list();
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("TOKEN_REQUIRED");
        expect(e.exitCode).toBe(2);
      }
    });

    test("strict mode: view without token throws TOKEN_REQUIRED", async () => {
      setAuthMode("strict");
      try {
        await tracker.view("any1234567");
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("TOKEN_REQUIRED");
      }
    });

    test("with valid token: create uses author from token", async () => {
      const regResult = await tracker.usersRegister("alice");
      if (regResult.result !== "OK") throw new Error("Register failed");
      process.env.TRACKGENTIC_USER_TOKEN = regResult.token;

      const result = await tracker.create({ title: "Auth Test" });
      if ("id" in result) {
        const issuePath = join(testDir, ".trackgentic", "issues", `${result.id}.json`);
        const events = JSON.parse(readFileSync(issuePath, "utf-8"));
        expect(events[0].author).toBe("alice");
        expect(events[1].author).toBe("alice");
      }
    });

    test("with invalid token: create returns INVALID_TOKEN", async () => {
      process.env.TRACKGENTIC_USER_TOKEN = "tk_fake0000";
      const result = await tracker.create({ title: "Bad Token" });

      expect(result).toBeInstanceOf(TrackgenticError);
      if (result instanceof TrackgenticError) {
        expect(result.result).toBe("INVALID_TOKEN");
        expect(result.exitCode).toBe(3);
      }
    });

    test("events contain resolved author when token is used", async () => {
      const regResult = await tracker.usersRegister("bob");
      if (regResult.result !== "OK") throw new Error("Register failed");
      process.env.TRACKGENTIC_USER_TOKEN = regResult.token;

      const created = await tracker.create({ title: "Authored Issue" });
      if ("id" in created) {
        const events = await tracker.history(created.id);
        if (Array.isArray(events)) {
          for (const event of events) {
            if ("author" in event) {
              expect(event.author).toBe("bob");
            }
          }
        }
      }
    });

    test("author param overrides resolved author when provided", async () => {
      const regResult = await tracker.usersRegister("alice");
      if (regResult.result !== "OK") throw new Error("Register failed");
      process.env.TRACKGENTIC_USER_TOKEN = regResult.token;

      // Pass explicit author param — should take precedence over auth
      const result = await tracker.create({ title: "Override", author: "custom" });
      if ("id" in result) {
        const issuePath = join(testDir, ".trackgentic", "issues", `${result.id}.json`);
        const events = JSON.parse(readFileSync(issuePath, "utf-8"));
        expect(events[0].author).toBe("custom");
      }
    });
  });

  // ─── Comments Auth Integration Tests ─────────────────────────────

  describe("comments auth integration", () => {
    let tracker: Tracker;
    let savedToken: string | undefined;

    beforeEach(async () => {
      savedToken = process.env.TRACKGENTIC_USER_TOKEN;
      delete process.env.TRACKGENTIC_USER_TOKEN;
      tracker = new Tracker(testDir);
      await tracker.init();
    });

    afterEach(() => {
      if (savedToken !== undefined) {
        process.env.TRACKGENTIC_USER_TOKEN = savedToken;
      } else {
        delete process.env.TRACKGENTIC_USER_TOKEN;
      }
    });

    function setAuthMode(mode: "open" | "read-only" | "strict", defaultUser = "anonymous") {
      const configPath = join(testDir, ".trackgentic", "config.json");
      writeFileSync(configPath, JSON.stringify({ auth: { mode, defaultUser } }));
    }

    test("read-only mode: commentsAdd without token returns TOKEN_REQUIRED", async () => {
      const created = await tracker.create({ title: "Test" });
      if (!("id" in created)) throw new Error("Create failed");

      setAuthMode("read-only");
      const result = await tracker.commentsAdd(created.id, { content: "Hello" });

      expect(result).toBeInstanceOf(TrackgenticError);
      if (result instanceof TrackgenticError) {
        expect(result.result).toBe("TOKEN_REQUIRED");
        expect(result.exitCode).toBe(2);
      }
    });

    test("read-only mode: commentsUpdate without token returns TOKEN_REQUIRED", async () => {
      const created = await tracker.create({ title: "Test" });
      if (!("id" in created)) throw new Error("Create failed");

      const addResult = await tracker.commentsAdd(created.id, { content: "Original" });
      if (addResult.result !== "OK") throw new Error("Add failed");

      setAuthMode("read-only");
      const result = await tracker.commentsUpdate(created.id, addResult.commentId, {
        content: "Updated",
      });

      expect(result).toBeInstanceOf(TrackgenticError);
      if (result instanceof TrackgenticError) {
        expect(result.result).toBe("TOKEN_REQUIRED");
      }
    });

    test("read-only mode: commentsDelete without token returns TOKEN_REQUIRED", async () => {
      const created = await tracker.create({ title: "Test" });
      if (!("id" in created)) throw new Error("Create failed");

      const addResult = await tracker.commentsAdd(created.id, { content: "To delete" });
      if (addResult.result !== "OK") throw new Error("Add failed");

      setAuthMode("read-only");
      const result = await tracker.commentsDelete(created.id, addResult.commentId);

      expect(result).toBeInstanceOf(TrackgenticError);
      if (result instanceof TrackgenticError) {
        expect(result.result).toBe("TOKEN_REQUIRED");
      }
    });

    test("read-only mode: commentsList without token succeeds", async () => {
      const created = await tracker.create({ title: "Test" });
      if (!("id" in created)) throw new Error("Create failed");

      await tracker.commentsAdd(created.id, { content: "Hello" });

      setAuthMode("read-only");
      const result = await tracker.commentsList(created.id);

      if (Array.isArray(result)) {
        expect(result).toHaveLength(1);
      }
    });

    test("strict mode: commentsList without token throws TOKEN_REQUIRED", async () => {
      const created = await tracker.create({ title: "Test" });
      if (!("id" in created)) throw new Error("Create failed");

      setAuthMode("strict");
      try {
        await tracker.commentsList(created.id);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("TOKEN_REQUIRED");
      }
    });

    test("with valid token: commentsAdd uses author from token", async () => {
      const regResult = await tracker.usersRegister("alice");
      if (regResult.result !== "OK") throw new Error("Register failed");
      process.env.TRACKGENTIC_USER_TOKEN = regResult.token;

      const created = await tracker.create({ title: "Auth Test" });
      if (!("id" in created)) throw new Error("Create failed");

      await tracker.commentsAdd(created.id, { content: "Hello" });

      const comments = await tracker.commentsList(created.id);
      if (Array.isArray(comments)) {
        expect(comments[0].author).toBe("alice");
      }
    });
  });

  // ─── Auth + Hierarchy Integration Tests ─────────────────────────────

  describe("auth + hierarchy integration", () => {
    let tracker: Tracker;
    let savedToken: string | undefined;

    beforeEach(async () => {
      savedToken = process.env.TRACKGENTIC_USER_TOKEN;
      delete process.env.TRACKGENTIC_USER_TOKEN;
      tracker = new Tracker(testDir);
      await tracker.init();
    });

    afterEach(() => {
      if (savedToken !== undefined) {
        process.env.TRACKGENTIC_USER_TOKEN = savedToken;
      } else {
        delete process.env.TRACKGENTIC_USER_TOKEN;
      }
    });

    function setAuthMode(mode: "open" | "read-only" | "strict", defaultUser = "anonymous") {
      const configPath = join(testDir, ".trackgentic", "config.json");
      writeFileSync(configPath, JSON.stringify({ auth: { mode, defaultUser } }));
    }

    test("read-only mode: create with parentId returns TOKEN_REQUIRED before hierarchy validation", async () => {
      const parent = await tracker.create({ title: "Parent" });
      if (!("id" in parent)) throw new Error("Parent create failed");

      setAuthMode("read-only");
      const result = await tracker.create({ title: "Child", parentId: parent.id });

      expect(result).toBeInstanceOf(TrackgenticError);
      if (result instanceof TrackgenticError) {
        expect(result.result).toBe("TOKEN_REQUIRED");
        expect(result.exitCode).toBe(2);
      }
    });

    test("read-only mode: update with status change (hierarchy) returns TOKEN_REQUIRED", async () => {
      const parent = await tracker.create({ title: "Parent", status: "done" });
      if (!("id" in parent)) throw new Error("Parent create failed");
      const child = await tracker.create({ title: "Child", parentId: parent.id, status: "done" });
      if (!("id" in child)) throw new Error("Child create failed");

      setAuthMode("read-only");
      const result = await tracker.update(parent.id, { status: "closed" });

      expect(result).toBeInstanceOf(TrackgenticError);
      if (result instanceof TrackgenticError) {
        expect(result.result).toBe("TOKEN_REQUIRED");
        expect(result.exitCode).toBe(2);
      }
    });

    test("read-only mode: update parentId returns TOKEN_REQUIRED", async () => {
      const parent = await tracker.create({ title: "Parent" });
      if (!("id" in parent)) throw new Error("Parent create failed");
      const child = await tracker.create({ title: "Child" });
      if (!("id" in child)) throw new Error("Child create failed");

      setAuthMode("read-only");
      const result = await tracker.update(child.id, { parentId: parent.id });

      expect(result).toBeInstanceOf(TrackgenticError);
      if (result instanceof TrackgenticError) {
        expect(result.result).toBe("TOKEN_REQUIRED");
        expect(result.exitCode).toBe(2);
      }
    });
  });
});
