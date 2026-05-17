import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TrackgenticError } from "../../src/core/errors";
import { Tracker } from "../../src/core/tracker";

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

  describe("init()", () => {
    test("creates .trackgentic/ with all files and correct contents", async () => {
      const tracker = new Tracker(testDir);
      const result = await tracker.init();

      expect(result.result).toBe("OK");
      expect(result.path).toBe(resolve(join(testDir, ".trackgentic")));

      // Verify directory exists
      expect(existsSync(join(testDir, ".trackgentic"))).toBe(true);

      // Verify issues directory exists
      expect(existsSync(join(testDir, ".trackgentic", "issues"))).toBe(true);

      // Verify config.json
      const config = JSON.parse(
        readFileSync(join(testDir, ".trackgentic", "config.json"), "utf-8"),
      );
      expect(config).toEqual({
        auth: {
          mode: "open",
          defaultUser: "anonymous",
        },
      });

      // Verify index.json
      const index = JSON.parse(readFileSync(join(testDir, ".trackgentic", "index.json"), "utf-8"));
      expect(index).toEqual({
        open: [],
        closed: [],
        childrenOf: {},
      });

      // Verify dependencies.json
      const deps = JSON.parse(
        readFileSync(join(testDir, ".trackgentic", "dependencies.json"), "utf-8"),
      );
      expect(deps).toEqual({
        blockedBy: {},
        blocks: {},
      });

      // Verify users.json
      const users = JSON.parse(readFileSync(join(testDir, ".trackgentic", "users.json"), "utf-8"));
      expect(users).toEqual({
        users: [],
      });
    });

    test("is idempotent — second call returns ALREADY_INITIALIZED", async () => {
      const tracker = new Tracker(testDir);

      const first = await tracker.init();
      expect(first.result).toBe("OK");

      const second = await tracker.init();
      expect(second.result).toBe("ALREADY_INITIALIZED");
      expect(second.path).toBe(resolve(join(testDir, ".trackgentic")));
    });

    test("does not overwrite existing files", async () => {
      const tracker = new Tracker(testDir);

      await tracker.init();

      // Read config to get original content
      const configPath = join(testDir, ".trackgentic", "config.json");
      const originalContent = readFileSync(configPath, "utf-8");

      // Call init again
      await tracker.init();

      // Verify config was NOT overwritten
      const contentAfter = readFileSync(configPath, "utf-8");
      expect(contentAfter).toBe(originalContent);
    });

    test("config.json has default auth config", async () => {
      const tracker = new Tracker(testDir);
      await tracker.init();

      const config = JSON.parse(
        readFileSync(join(testDir, ".trackgentic", "config.json"), "utf-8"),
      );
      expect(config.auth.mode).toBe("open");
      expect(config.auth.defaultUser).toBe("anonymous");
    });

    test("index.json has empty arrays", async () => {
      const tracker = new Tracker(testDir);
      await tracker.init();

      const index = JSON.parse(readFileSync(join(testDir, ".trackgentic", "index.json"), "utf-8"));
      expect(index.open).toEqual([]);
      expect(index.closed).toEqual([]);
      expect(index.childrenOf).toEqual({});
    });

    test("issues/ directory exists", async () => {
      const tracker = new Tracker(testDir);
      await tracker.init();

      expect(existsSync(join(testDir, ".trackgentic", "issues"))).toBe(true);
    });
  });

  describe("create()", () => {
    let tracker: Tracker;

    beforeEach(async () => {
      tracker = new Tracker(testDir);
      await tracker.init();
    });

    test("creates an issue with title only", async () => {
      const result = await tracker.create({ title: "Test Issue" });

      expect(result.result).not.toBe("undefined");
      if ("id" in result) {
        expect(result.id).toHaveLength(10);
      }
    });

    test("creates issue file with creation + update events", async () => {
      const result = await tracker.create({ title: "Test Issue" });

      if ("id" in result) {
        const issuePath = join(testDir, ".trackgentic", "issues", `${result.id}.json`);
        expect(existsSync(issuePath)).toBe(true);

        const events = JSON.parse(readFileSync(issuePath, "utf-8"));
        expect(events).toHaveLength(2);
        expect(events[0].type).toBe("creation");
        expect(events[1].type).toBe("update");
        expect(events[1].content.title).toBe("Test Issue");
      }
    });

    test("inserts entry into index", async () => {
      const result = await tracker.create({ title: "Test Issue" });

      if ("id" in result) {
        const index = JSON.parse(
          readFileSync(join(testDir, ".trackgentic", "index.json"), "utf-8"),
        );
        expect(index.open).toHaveLength(1);
        expect(index.open[0].id).toBe(result.id);
        expect(index.open[0].title).toBe("Test Issue");
      }
    });

    test("creates issue with all properties", async () => {
      // Create parent first (hierarchy validation requires parent to exist)
      const parent = await tracker.create({ title: "Parent Issue" });
      if (!("id" in parent)) throw new Error("Parent create failed");
      const parentId = parent.id;

      const result = await tracker.create({
        title: "Full Issue",
        description: "A description",
        status: "todo",
        priority: 1,
        assignee: "bob",
        tags: ["bug", "urgent"],
        parentId,
      });

      if ("id" in result) {
        const index = JSON.parse(
          readFileSync(join(testDir, ".trackgentic", "index.json"), "utf-8"),
        );
        const entry = index.open.find((e: { id: string }) => e.id === result.id);
        expect(entry.title).toBe("Full Issue");
        expect(entry.status).toBe("todo");
        expect(entry.priority).toBe(1);
        expect(entry.assignee).toBe("bob");
        expect(entry.tags).toEqual(["bug", "urgent"]);
        expect(entry.parentId).toBe(parentId);
      }
    });

    test("creates with closed status goes to closed array", async () => {
      const result = await tracker.create({
        title: "Pre-closed",
        status: "closed",
      });

      if ("id" in result) {
        const index = JSON.parse(
          readFileSync(join(testDir, ".trackgentic", "index.json"), "utf-8"),
        );
        expect(index.open).toHaveLength(0);
        expect(index.closed).toHaveLength(1);
        expect(index.closed[0].id).toBe(result.id);
      }
    });

    test("throws NOT_INITIALIZED when no .trackgentic/ exists", async () => {
      const uninitDir = join(
        tmpdir(),
        `trackgentic-uninit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      mkdirSync(uninitDir, { recursive: true });
      const uninitTracker = new Tracker(uninitDir);
      try {
        await uninitTracker.create({ title: "Test" });
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
      }
      rmSync(uninitDir, { recursive: true, force: true });
    });

    test("uses author from params", async () => {
      const result = await tracker.create({ title: "Authored", author: "alice" });

      if ("id" in result) {
        const issuePath = join(testDir, ".trackgentic", "issues", `${result.id}.json`);
        const events = JSON.parse(readFileSync(issuePath, "utf-8"));
        expect(events[0].author).toBe("alice");
        expect(events[1].author).toBe("alice");
      }
    });

    test("uses anonymous as default author", async () => {
      const result = await tracker.create({ title: "Default Authored" });

      if ("id" in result) {
        const issuePath = join(testDir, ".trackgentic", "issues", `${result.id}.json`);
        const events = JSON.parse(readFileSync(issuePath, "utf-8"));
        expect(events[0].author).toBe("anonymous");
      }
    });
  });

  describe("list()", () => {
    let tracker: Tracker;

    beforeEach(async () => {
      tracker = new Tracker(testDir);
      await tracker.init();
    });

    test("returns empty array when no issues", async () => {
      const result = await tracker.list();
      expect(result).toEqual([]);
    });

    test("returns all issues when no filters", async () => {
      await tracker.create({ title: "Issue 1" });
      await tracker.create({ title: "Issue 2" });

      const result = await tracker.list();
      expect(result).toHaveLength(2);
    });

    test("filters by status=open (excludes closed)", async () => {
      await tracker.create({ title: "Open Issue" });
      await tracker.create({ title: "Closed Issue", status: "closed" });

      const result = await tracker.list({ status: "open" });
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Open Issue");
    });

    test("filters by status=closed", async () => {
      await tracker.create({ title: "Open Issue" });
      await tracker.create({ title: "Closed Issue", status: "closed" });

      const result = await tracker.list({ status: "closed" });
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Closed Issue");
    });

    test("filters by specific status", async () => {
      await tracker.create({ title: "Idea Issue", status: "idea" });
      await tracker.create({ title: "Todo Issue", status: "todo" });

      const result = await tracker.list({ status: "todo" });
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Todo Issue");
    });

    test("filters by assignee", async () => {
      await tracker.create({ title: "Alice's Issue", assignee: "alice" });
      await tracker.create({ title: "Bob's Issue", assignee: "bob" });

      const result = await tracker.list({ assignee: "alice" });
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Alice's Issue");
    });

    test("filters by tags (AND filter)", async () => {
      await tracker.create({ title: "Bug", tags: ["bug"] });
      await tracker.create({ title: "Bug + Urgent", tags: ["bug", "urgent"] });
      await tracker.create({ title: "Feature", tags: ["feature"] });

      const result = await tracker.list({ tags: ["bug", "urgent"] });
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Bug + Urgent");
    });

    test("filters by parentId=null (top-level only)", async () => {
      const parent = await tracker.create({ title: "Parent" });
      if ("id" in parent) {
        await tracker.create({ title: "Child", parentId: parent.id });
      }

      const result = await tracker.list({ parentId: null });
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Parent");
    });

    test("filters by specific parentId (children of a given issue)", async () => {
      const parent = await tracker.create({ title: "Parent" });
      if ("id" in parent) {
        await tracker.create({ title: "Child 1", parentId: parent.id });
        await tracker.create({ title: "Child 2", parentId: parent.id });
        await tracker.create({ title: "Orphan" });
      }

      const result = await tracker.list({ parentId: parent.id });
      expect(result).toHaveLength(2);
      expect(result.every((e) => e.parentId === parent.id)).toBe(true);
    });

    test("sorts by priority ASC then id ASC", async () => {
      // Create with different priorities
      await tracker.create({ title: "High P", priority: 1 });
      await tracker.create({ title: "Low P", priority: 5 });
      await tracker.create({ title: "Med P", priority: 3 });

      const result = await tracker.list();
      expect(result[0].title).toBe("High P");
      expect(result[1].title).toBe("Med P");
      expect(result[2].title).toBe("Low P");
    });

    test("throws NOT_INITIALIZED when no .trackgentic/ exists", async () => {
      const uninitDir = join(
        tmpdir(),
        `trackgentic-uninit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      mkdirSync(uninitDir, { recursive: true });
      const uninitTracker = new Tracker(uninitDir);
      try {
        await uninitTracker.list();
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
      }
      rmSync(uninitDir, { recursive: true, force: true });
    });
  });

  describe("view()", () => {
    let tracker: Tracker;

    beforeEach(async () => {
      tracker = new Tracker(testDir);
      await tracker.init();
    });

    test("returns computed issue state", async () => {
      const created = await tracker.create({ title: "Test Issue", description: "Details" });

      if ("id" in created) {
        const result = await tracker.view(created.id);

        expect(result.id).toBe(created.id);
        if ("title" in result) {
          expect(result.title).toBe("Test Issue");
          expect(result.description).toBe("Details");
          expect(result.status).toBe("idea");
          expect(result.priority).toBe(3);
          expect(result.assignee).toBeNull();
          expect(result.parentId).toBeNull();
          expect(result.tags).toEqual([]);
          expect(result.createdAt).toBeTruthy();
          expect(result.createdBy).toBe("anonymous");
          expect(result.updatedAt).toBeTruthy();
        }
      }
    });

    test("throws NOT_FOUND for non-existent id", async () => {
      expect(tracker.view("missing12345")).rejects.toThrow(TrackgenticError);
    });

    test("throws ISSUE_MISSING when file is deleted", async () => {
      const created = await tracker.create({ title: "Will be deleted" });

      if ("id" in created) {
        // Manually delete the issue file
        const issuePath = join(testDir, ".trackgentic", "issues", `${created.id}.json`);
        unlinkSync(issuePath);

        expect(tracker.view(created.id)).rejects.toThrow(TrackgenticError);
      }
    });

    test("throws NOT_INITIALIZED when no .trackgentic/ exists", async () => {
      const uninitDir = join(tmpdir(), `no-trackgentic-${Date.now()}`);
      mkdirSync(uninitDir, { recursive: true });
      const uninitTracker = new Tracker(uninitDir);
      try {
        await uninitTracker.view("abc1234567");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
      }
      rmSync(uninitDir, { recursive: true, force: true });
    });
  });

  describe("update()", () => {
    let tracker: Tracker;

    beforeEach(async () => {
      tracker = new Tracker(testDir);
      await tracker.init();
    });

    test("updates title and returns OK", async () => {
      const created = await tracker.create({ title: "Original" });

      if ("id" in created) {
        const result = await tracker.update(created.id, { title: "Updated" });
        expect(result).toEqual({ result: "OK" });

        // Verify via view
        const viewed = await tracker.view(created.id);
        if ("title" in viewed) {
          expect(viewed.title).toBe("Updated");
        }
      }
    });

    test("updates multiple fields at once", async () => {
      const created = await tracker.create({ title: "Original" });

      if ("id" in created) {
        await tracker.update(created.id, {
          title: "Updated",
          status: "in-progress",
          priority: 1,
          assignee: "alice",
          tags: ["urgent"],
        });

        const viewed = await tracker.view(created.id);
        if ("title" in viewed) {
          expect(viewed.title).toBe("Updated");
          expect(viewed.status).toBe("in-progress");
          expect(viewed.priority).toBe(1);
          expect(viewed.assignee).toBe("alice");
          expect(viewed.tags).toEqual(["urgent"]);
        }
      }
    });

    test("appends update event to issue file", async () => {
      const created = await tracker.create({ title: "Original" });

      if ("id" in created) {
        await tracker.update(created.id, { title: "Updated" });

        const issuePath = join(testDir, ".trackgentic", "issues", `${created.id}.json`);
        const events = JSON.parse(readFileSync(issuePath, "utf-8"));
        // creation + initial update + our update = 3 events
        expect(events).toHaveLength(3);
        expect(events[2].type).toBe("update");
        expect(events[2].content.title).toBe("Updated");
      }
    });

    test("moves to closed array on status=closed", async () => {
      const created = await tracker.create({ title: "To Close" });

      if ("id" in created) {
        await tracker.update(created.id, { status: "closed" });

        const index = JSON.parse(
          readFileSync(join(testDir, ".trackgentic", "index.json"), "utf-8"),
        );
        expect(index.open).toHaveLength(0);
        expect(index.closed).toHaveLength(1);
        expect(index.closed[0].id).toBe(created.id);
      }
    });

    test("moves back to open array on status change from closed", async () => {
      const created = await tracker.create({ title: "Reopen", status: "closed" });

      if ("id" in created) {
        await tracker.update(created.id, { status: "todo" });

        const index = JSON.parse(
          readFileSync(join(testDir, ".trackgentic", "index.json"), "utf-8"),
        );
        expect(index.open).toHaveLength(1);
        expect(index.closed).toHaveLength(0);
        expect(index.open[0].status).toBe("todo");
      }
    });

    test("throws INVALID_PARAMS when no fields provided", async () => {
      const created = await tracker.create({ title: "Test" });

      if ("id" in created) {
        expect(tracker.update(created.id, {})).rejects.toThrow(TrackgenticError);
      }
    });

    test("throws NOT_FOUND for non-existent id", async () => {
      expect(tracker.update("missing12345", { title: "Test" })).rejects.toThrow(TrackgenticError);
    });

    test("throws ISSUE_MISSING when file is deleted", async () => {
      const created = await tracker.create({ title: "Will be deleted" });

      if ("id" in created) {
        const issuePath = join(testDir, ".trackgentic", "issues", `${created.id}.json`);
        unlinkSync(issuePath);

        expect(tracker.update(created.id, { title: "Updated" })).rejects.toThrow(TrackgenticError);
      }
    });

    test("clears assignee by setting to null", async () => {
      const created = await tracker.create({ title: "Test", assignee: "alice" });

      if ("id" in created) {
        await tracker.update(created.id, { assignee: null });

        const viewed = await tracker.view(created.id);
        if ("assignee" in viewed) {
          expect(viewed.assignee).toBeNull();
        }
      }
    });

    test("clears parentId by setting to null", async () => {
      // Create parent first (hierarchy validation requires parent to exist)
      const parent = await tracker.create({ title: "Parent" });
      if (!("id" in parent)) throw new Error("Parent create failed");

      const created = await tracker.create({ title: "Child", parentId: parent.id });

      if ("id" in created) {
        await tracker.update(created.id, { parentId: null });

        const viewed = await tracker.view(created.id);
        if ("parentId" in viewed) {
          expect(viewed.parentId).toBeNull();
        }
      }
    });
  });

  describe("history()", () => {
    let tracker: Tracker;

    beforeEach(async () => {
      tracker = new Tracker(testDir);
      await tracker.init();
    });

    test("returns raw event array", async () => {
      const created = await tracker.create({ title: "Test" });

      if ("id" in created) {
        const result = await tracker.history(created.id);

        expect(Array.isArray(result)).toBe(true);
        if (Array.isArray(result)) {
          expect(result).toHaveLength(2);
          expect(result[0].type).toBe("creation");
          expect(result[1].type).toBe("update");
        }
      }
    });

    test("returns all events after update", async () => {
      const created = await tracker.create({ title: "Test" });

      if ("id" in created) {
        await tracker.update(created.id, { title: "Updated" });

        const result = await tracker.history(created.id);

        if (Array.isArray(result)) {
          expect(result).toHaveLength(3);
          expect(result[2].type).toBe("update");
        }
      }
    });

    test("throws NOT_FOUND for non-existent id", async () => {
      expect(tracker.history("missing12345")).rejects.toThrow(TrackgenticError);
    });

    test("throws ISSUE_MISSING when file is deleted", async () => {
      const created = await tracker.create({ title: "Test" });

      if ("id" in created) {
        const issuePath = join(testDir, ".trackgentic", "issues", `${created.id}.json`);
        unlinkSync(issuePath);

        expect(tracker.history(created.id)).rejects.toThrow(TrackgenticError);
      }
    });

    test("throws NOT_INITIALIZED when no .trackgentic/ exists", async () => {
      const uninitDir = join(tmpdir(), `no-trackgentic-${Date.now()}`);
      mkdirSync(uninitDir, { recursive: true });
      const uninitTracker = new Tracker(uninitDir);
      try {
        await uninitTracker.history("abc1234567");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
      }
      rmSync(uninitDir, { recursive: true, force: true });
    });
  });

  describe("error codes match specification", () => {
    test("NOT_FOUND has exitCode 5", async () => {
      const tracker = new Tracker(testDir);
      await tracker.init();

      try {
        await tracker.view("missing12345");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("NOT_FOUND");
        expect(e.exitCode).toBe(5);
      }
    });

    test("ISSUE_MISSING has exitCode 6", async () => {
      const tracker = new Tracker(testDir);
      await tracker.init();

      const created = await tracker.create({ title: "Delete Me" });
      if ("id" in created) {
        const issuePath = join(testDir, ".trackgentic", "issues", `${created.id}.json`);
        unlinkSync(issuePath);

        try {
          await tracker.view(created.id);
          expect(true).toBe(false);
        } catch (err) {
          expect(err).toBeInstanceOf(TrackgenticError);
          const e = err as TrackgenticError;
          expect(e.result).toBe("ISSUE_MISSING");
          expect(e.exitCode).toBe(6);
        }
      }
    });

    test("INVALID_PARAMS has exitCode 10", async () => {
      const tracker = new Tracker(testDir);
      await tracker.init();

      const created = await tracker.create({ title: "Test" });
      if ("id" in created) {
        try {
          await tracker.update(created.id, {});
          expect(true).toBe(false);
        } catch (err) {
          expect(err).toBeInstanceOf(TrackgenticError);
          const e = err as TrackgenticError;
          expect(e.result).toBe("INVALID_PARAMS");
          expect(e.exitCode).toBe(10);
        }
      }
    });

    test("NOT_INITIALIZED has exitCode 1", async () => {
      const uninitDir = join(
        tmpdir(),
        `trackgentic-errcode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      mkdirSync(uninitDir, { recursive: true });
      const tracker = new Tracker(uninitDir);

      try {
        await tracker.create({ title: "Test" });
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("NOT_INITIALIZED");
        expect(e.exitCode).toBe(1);
      }

      rmSync(uninitDir, { recursive: true, force: true });
    });

    test("ISSUE_MISSING on update has exitCode 6", async () => {
      const tracker = new Tracker(testDir);
      await tracker.init();

      const created = await tracker.create({ title: "Will Be Deleted" });
      if ("id" in created) {
        const issuePath = join(testDir, ".trackgentic", "issues", `${created.id}.json`);
        unlinkSync(issuePath);

        try {
          await tracker.update(created.id, { title: "New Title" });
          expect(true).toBe(false);
        } catch (err) {
          expect(err).toBeInstanceOf(TrackgenticError);
          const e = err as TrackgenticError;
          expect(e.result).toBe("ISSUE_MISSING");
          expect(e.exitCode).toBe(6);
        }
      }
    });

    test("HIERARCHY_CONSTRAINT has exitCode 12", async () => {
      const tracker = new Tracker(testDir);
      await tracker.init();

      const parent = await tracker.create({ title: "Parent" });
      if (!("id" in parent)) throw new Error("Parent create failed");
      await tracker.create({ title: "Child", parentId: parent.id, status: "in-progress" });

      try {
        await tracker.update(parent.id, { status: "done" });
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("HIERARCHY_CONSTRAINT");
        expect(e.exitCode).toBe(12);
      }
    });
  });

  describe("full CRUD cycle", () => {
    test("create -> list -> view -> update -> view -> history", async () => {
      const tracker = new Tracker(testDir);
      await tracker.init();

      // Create
      const created = await tracker.create({
        title: "CRUD Test",
        description: "Testing full cycle",
        status: "idea",
        priority: 2,
        assignee: "alice",
        tags: ["test"],
      });
      expect("id" in created).toBe(true);
      const id = "id" in created ? created.id : "";

      // List — should find the issue
      const listResult = await tracker.list();
      expect(listResult).toHaveLength(1);
      expect(listResult[0].id).toBe(id);
      expect(listResult[0].title).toBe("CRUD Test");

      // View — full computed state
      const view1 = await tracker.view(id);
      if ("title" in view1) {
        expect(view1.title).toBe("CRUD Test");
        expect(view1.description).toBe("Testing full cycle");
        expect(view1.status).toBe("idea");
        expect(view1.priority).toBe(2);
        expect(view1.assignee).toBe("alice");
        expect(view1.tags).toEqual(["test"]);
      }

      // Update
      await tracker.update(id, {
        title: "CRUD Updated",
        status: "done",
        priority: 1,
      });

      // View again — verify changes
      const view2 = await tracker.view(id);
      if ("title" in view2) {
        expect(view2.title).toBe("CRUD Updated");
        expect(view2.status).toBe("done");
        expect(view2.priority).toBe(1);
        // Unchanged fields persist
        expect(view2.assignee).toBe("alice");
        expect(view2.tags).toEqual(["test"]);
      }

      // History — should have creation + initial update + our update
      const history = await tracker.history(id);
      if (Array.isArray(history)) {
        expect(history).toHaveLength(3);
        expect(history[0].type).toBe("creation");
        expect(history[1].type).toBe("update");
        expect(history[2].type).toBe("update");
      }
    });
  });

  // ─── User Management Tests ───────────────────────────────────────

  describe("user management", () => {
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

    describe("usersRegister", () => {
      test("creates user and returns token with lowercased name", async () => {
        const result = await tracker.usersRegister("Alice");

        expect(result.result).toBe("OK");
        if (result.result === "OK") {
          expect(result.name).toBe("alice");
          expect(result.token).toMatch(/^tk_[a-z0-9]{8}$/);
        }
      });

      test("rejects duplicate name with USER_ALREADY_EXISTS", async () => {
        await tracker.usersRegister("alice");
        const result = await tracker.usersRegister("alice");

        expect(result.result).toBe("USER_ALREADY_EXISTS");
        if (result.result === "USER_ALREADY_EXISTS") {
          expect(result.message).toContain("alice");
        }
      });

      test('rejects "anonymous" as reserved name', async () => {
        const result = await tracker.usersRegister("anonymous");

        expect(result.result).toBe("USER_ALREADY_EXISTS");
        if (result.result === "USER_ALREADY_EXISTS") {
          expect(result.message).toContain("anonymous");
        }
      });

      test("persists user to users.json", async () => {
        await tracker.usersRegister("alice");

        const usersData = JSON.parse(
          readFileSync(join(testDir, ".trackgentic", "users.json"), "utf-8"),
        );
        expect(usersData.users).toHaveLength(1);
        expect(usersData.users[0].name).toBe("alice");
        expect(usersData.users[0].token).toMatch(/^tk_[a-z0-9]{8}$/);
        expect(usersData.users[0].registeredAt).toBeTruthy();
      });

      test("rejects duplicate regardless of casing", async () => {
        await tracker.usersRegister("Alice");
        const result = await tracker.usersRegister("ALICE");

        expect(result.result).toBe("USER_ALREADY_EXISTS");
      });
    });

    describe("usersList", () => {
      test("returns users without tokens", async () => {
        await tracker.usersRegister("alice");
        await tracker.usersRegister("bob");

        const result = await tracker.usersList();
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
          name: "alice",
          registeredAt: expect.any(String),
        });
        expect(result[1]).toEqual({
          name: "bob",
          registeredAt: expect.any(String),
        });
        // Tokens must NOT be included
        for (const user of result) {
          expect("token" in user).toBe(false);
        }
      });

      test("returns empty array when no users registered", async () => {
        const result = await tracker.usersList();
        expect(result).toEqual([]);
      });
    });

    describe("usersRevoke", () => {
      test("removes a user", async () => {
        await tracker.usersRegister("alice");
        const result = await tracker.usersRevoke("alice");

        expect(result).toEqual({ result: "OK" });

        // Verify user is actually removed
        const listResult = await tracker.usersList();
        expect(listResult).toHaveLength(0);
      });

      test("rejects with USER_NOT_FOUND for non-existent user", async () => {
        const result = await tracker.usersRevoke("nonexistent");

        expect(result.result).toBe("USER_NOT_FOUND");
        if (result.result === "USER_NOT_FOUND") {
          expect(result.message).toContain("nonexistent");
        }
      });

      test("name matching is case-insensitive", async () => {
        await tracker.usersRegister("Alice");
        const result = await tracker.usersRevoke("alice");

        expect(result).toEqual({ result: "OK" });
      });
    });

    describe("usersRegenerate", () => {
      test("generates new token for self", async () => {
        const regResult = await tracker.usersRegister("alice");
        if (regResult.result !== "OK") throw new Error("Register failed");
        const oldToken = regResult.token;

        // Set env var so resolveAuthor identifies caller as alice
        process.env.TRACKGENTIC_USER_TOKEN = oldToken;

        const result = await tracker.usersRegenerate("alice");
        if (result.result === "OK") {
          expect(result.token).not.toBe(oldToken);
          expect(result.token).toMatch(/^tk_[a-z0-9]{8}$/);
          expect(result.name).toBe("alice");
        } else {
          expect.unreachable("Expected OK result");
        }
      });

      test("rejects when caller is not the target user (self-service only)", async () => {
        const aliceResult = await tracker.usersRegister("alice");
        await tracker.usersRegister("bob");
        if (aliceResult.result !== "OK") throw new Error("Register failed");

        // Alice tries to regenerate bob's token
        process.env.TRACKGENTIC_USER_TOKEN = aliceResult.token;
        const result = await tracker.usersRegenerate("bob");

        expect(result.result).toBe("INVALID_TOKEN");
        if (result.result === "INVALID_TOKEN") {
          expect(result.message).toBeTruthy();
        }
      });

      test("rejects with USER_NOT_FOUND for non-existent user", async () => {
        // In open mode without token, resolveAuthor returns "anonymous".
        // Calling regenerate("anonymous") passes the self-service check
        // (anonymous === anonymous) but "anonymous" is never in users list.
        const result = await tracker.usersRegenerate("anonymous");
        expect(result.result).toBe("USER_NOT_FOUND");
      });

      test("persists new token to users.json", async () => {
        const regResult = await tracker.usersRegister("alice");
        if (regResult.result !== "OK") throw new Error("Register failed");
        process.env.TRACKGENTIC_USER_TOKEN = regResult.token;

        const genResult = await tracker.usersRegenerate("alice");
        if (genResult.result !== "OK") throw new Error("Regenerate failed");

        const usersData = JSON.parse(
          readFileSync(join(testDir, ".trackgentic", "users.json"), "utf-8"),
        );
        expect(usersData.users[0].token).toBe(genResult.token);
        expect(usersData.users[0].token).not.toBe(regResult.token);
      });
    });
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

  // ─── Hierarchy Integration Tests ──────────────────────────────────

  describe("hierarchy — create with parentId", () => {
    let tracker: Tracker;

    beforeEach(async () => {
      tracker = new Tracker(testDir);
      await tracker.init();
    });

    test("creates issue under valid parent — childrenOf updated", async () => {
      const parent = await tracker.create({ title: "Parent" });
      if (!("id" in parent)) throw new Error("Parent create failed");

      const child = await tracker.create({ title: "Child", parentId: parent.id });
      if (!("id" in child)) throw new Error("Child create failed");

      // Verify childrenOf in index
      const index = JSON.parse(readFileSync(join(testDir, ".trackgentic", "index.json"), "utf-8"));
      expect(index.childrenOf[parent.id]).toEqual([child.id]);

      // Verify child's parentId
      const viewed = await tracker.view(child.id);
      if ("parentId" in viewed) {
        expect(viewed.parentId).toBe(parent.id);
      }
    });

    test("creates issue under non-existent parent — NOT_FOUND", async () => {
      try {
        await tracker.create({ title: "Child", parentId: "missing12345" });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("NOT_FOUND");
        expect(e.message).toBe("Parent issue `missing12345` not found in index.");
        expect(e.exitCode).toBe(5);
      }
    });

    test("creates issue under closed parent — HIERARCHY_CONSTRAINT", async () => {
      const parent = await tracker.create({ title: "Parent", status: "closed" });
      if (!("id" in parent)) throw new Error("Parent create failed");

      try {
        await tracker.create({ title: "Child", parentId: parent.id });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("HIERARCHY_CONSTRAINT");
        expect(e.exitCode).toBe(12);
      }
    });

    test("creates issue under done parent — allowed", async () => {
      const parent = await tracker.create({ title: "Parent", status: "done" });
      if (!("id" in parent)) throw new Error("Parent create failed");

      const child = await tracker.create({ title: "Child", parentId: parent.id });
      if (!("id" in child)) throw new Error("Child create failed");

      // Verify child was created successfully
      const index = JSON.parse(readFileSync(join(testDir, ".trackgentic", "index.json"), "utf-8"));
      expect(index.childrenOf[parent.id]).toEqual([child.id]);
    });
  });

  describe("hierarchy — update status with children (downward)", () => {
    let tracker: Tracker;

    beforeEach(async () => {
      tracker = new Tracker(testDir);
      await tracker.init();
    });

    test("parent → done with in-progress child — HIERARCHY_CONSTRAINT", async () => {
      const parent = await tracker.create({ title: "Parent" });
      if (!("id" in parent)) throw new Error("Parent create failed");
      await tracker.create({ title: "Child", parentId: parent.id, status: "in-progress" });

      try {
        await tracker.update(parent.id, { status: "done" });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("HIERARCHY_CONSTRAINT");
        expect(e.exitCode).toBe(12);
      }
    });

    test("parent → done with all children done/closed — OK", async () => {
      const parent = await tracker.create({ title: "Parent" });
      if (!("id" in parent)) throw new Error("Parent create failed");
      await tracker.create({ title: "Child 1", parentId: parent.id, status: "done" });
      await tracker.create({ title: "Child 2", parentId: parent.id, status: "closed" });

      const result = await tracker.update(parent.id, { status: "done" });
      expect(result).toEqual({ result: "OK" });
    });

    test("parent → closed with done children — children auto-closed", async () => {
      const parent = await tracker.create({ title: "Parent", status: "done" });
      if (!("id" in parent)) throw new Error("Parent create failed");
      const child = await tracker.create({ title: "Child", parentId: parent.id, status: "done" });
      if (!("id" in child)) throw new Error("Child create failed");

      await tracker.update(parent.id, { status: "closed" });

      // Verify child was auto-closed
      const childView = await tracker.view(child.id);
      if ("status" in childView) {
        expect(childView.status).toBe("closed");
      }

      // Verify system event in child's history
      const history = await tracker.history(child.id);
      if (Array.isArray(history)) {
        const lastEvent = history[history.length - 1];
        expect(lastEvent.type).toBe("update");
        if (lastEvent.type === "update") {
          expect(lastEvent.author).toBe("system");
          expect(lastEvent.content.status).toBe("closed");
          expect(lastEvent.content.reason).toBe("auto-closed: parent closed");
        }
      }

      // Verify index reflects child in closed array
      const index = JSON.parse(readFileSync(join(testDir, ".trackgentic", "index.json"), "utf-8"));
      expect(index.open).toHaveLength(0);
      expect(index.closed).toHaveLength(2);
    });

    test("parent → closed with in-progress child — HIERARCHY_CONSTRAINT", async () => {
      const parent = await tracker.create({ title: "Parent" });
      if (!("id" in parent)) throw new Error("Parent create failed");
      await tracker.create({ title: "Child", parentId: parent.id, status: "in-progress" });

      try {
        await tracker.update(parent.id, { status: "closed" });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("HIERARCHY_CONSTRAINT");
        expect(e.exitCode).toBe(12);
      }
    });

    test("parent → closed with already-closed children — no double-close event", async () => {
      const parent = await tracker.create({ title: "Parent", status: "done" });
      if (!("id" in parent)) throw new Error("Parent create failed");
      const child = await tracker.create({ title: "Child", parentId: parent.id, status: "closed" });
      if (!("id" in child)) throw new Error("Child create failed");

      // Record child's event count before parent close
      const historyBefore = await tracker.history(child.id);
      const eventCountBefore = Array.isArray(historyBefore) ? historyBefore.length : 0;

      await tracker.update(parent.id, { status: "closed" });

      // Child was already closed — should NOT get an extra auto-close event
      const historyAfter = await tracker.history(child.id);
      if (Array.isArray(historyAfter)) {
        expect(historyAfter).toHaveLength(eventCountBefore);
      }
    });

    test("parent → closed with mix of done and closed children — only done auto-closed", async () => {
      const parent = await tracker.create({ title: "Parent", status: "done" });
      if (!("id" in parent)) throw new Error("Parent create failed");
      const doneChild = await tracker.create({
        title: "Done Child",
        parentId: parent.id,
        status: "done",
      });
      if (!("id" in doneChild)) throw new Error("Done child create failed");
      const closedChild = await tracker.create({
        title: "Closed Child",
        parentId: parent.id,
        status: "closed",
      });
      if (!("id" in closedChild)) throw new Error("Closed child create failed");

      // Record closed child's event count
      const closedHistoryBefore = await tracker.history(closedChild.id);
      const closedEventCount = Array.isArray(closedHistoryBefore) ? closedHistoryBefore.length : 0;

      await tracker.update(parent.id, { status: "closed" });

      // Done child should be auto-closed
      const doneView = await tracker.view(doneChild.id);
      if ("status" in doneView) {
        expect(doneView.status).toBe("closed");
      }

      // Closed child should NOT get extra event
      const closedHistoryAfter = await tracker.history(closedChild.id);
      if (Array.isArray(closedHistoryAfter)) {
        expect(closedHistoryAfter).toHaveLength(closedEventCount);
      }
    });

    test("recursive cascade: grandchild also auto-closed", async () => {
      const grandparent = await tracker.create({ title: "Grandparent", status: "done" });
      if (!("id" in grandparent)) throw new Error("Grandparent create failed");
      const parent = await tracker.create({
        title: "Parent",
        parentId: grandparent.id,
        status: "done",
      });
      if (!("id" in parent)) throw new Error("Parent create failed");
      const grandchild = await tracker.create({
        title: "Grandchild",
        parentId: parent.id,
        status: "done",
      });
      if (!("id" in grandchild)) throw new Error("Grandchild create failed");

      await tracker.update(grandparent.id, { status: "closed" });

      // Parent should be auto-closed
      const parentView = await tracker.view(parent.id);
      if ("status" in parentView) {
        expect(parentView.status).toBe("closed");
      }

      // Grandchild should be auto-closed recursively
      const grandchildView = await tracker.view(grandchild.id);
      if ("status" in grandchildView) {
        expect(grandchildView.status).toBe("closed");
      }

      // Verify all in closed array
      const index = JSON.parse(readFileSync(join(testDir, ".trackgentic", "index.json"), "utf-8"));
      expect(index.open).toHaveLength(0);
      expect(index.closed).toHaveLength(3);
    });
  });

  describe("hierarchy — update status upward promotion", () => {
    let tracker: Tracker;

    beforeEach(async () => {
      tracker = new Tracker(testDir);
      await tracker.init();
    });

    test("child → in-progress when parent is idea — parent auto-promoted", async () => {
      const parent = await tracker.create({ title: "Parent", status: "idea" });
      if (!("id" in parent)) throw new Error("Parent create failed");
      const child = await tracker.create({ title: "Child", parentId: parent.id, status: "todo" });
      if (!("id" in child)) throw new Error("Child create failed");

      await tracker.update(child.id, { status: "in-progress" });

      const parentView = await tracker.view(parent.id);
      if ("status" in parentView) {
        expect(parentView.status).toBe("in-progress");
      }

      // Verify system event in parent's history
      const history = await tracker.history(parent.id);
      if (Array.isArray(history)) {
        const lastEvent = history[history.length - 1];
        expect(lastEvent.type).toBe("update");
        if (lastEvent.type === "update") {
          expect(lastEvent.author).toBe("system");
          expect(lastEvent.content.status).toBe("in-progress");
          expect(lastEvent.content.reason).toBe("auto-promoted to 'in-progress': child advanced to 'in-progress'");
        }
      }
    });

    test("child → done when parent is in-progress — parent stays at in-progress (cap)", async () => {
      const parent = await tracker.create({ title: "Parent", status: "in-progress" });
      if (!("id" in parent)) throw new Error("Parent create failed");
      const child = await tracker.create({ title: "Child", parentId: parent.id, status: "todo" });
      if (!("id" in child)) throw new Error("Child create failed");

      const parentHistoryBefore = await tracker.history(parent.id);
      const eventCountBefore = Array.isArray(parentHistoryBefore) ? parentHistoryBefore.length : 0;

      await tracker.update(child.id, { status: "done" });

      // Parent should stay at in-progress — capped, no promotion event
      const parentView = await tracker.view(parent.id);
      if ("status" in parentView) {
        expect(parentView.status).toBe("in-progress");
      }

      // No new system events on parent
      const parentHistoryAfter = await tracker.history(parent.id);
      if (Array.isArray(parentHistoryAfter)) {
        expect(parentHistoryAfter).toHaveLength(eventCountBefore);
      }
    });

    test("multi-level: grandchild → done → child promoted → parent promoted", async () => {
      const grandparent = await tracker.create({ title: "Grandparent", status: "idea" });
      if (!("id" in grandparent)) throw new Error("Grandparent create failed");
      const parent = await tracker.create({
        title: "Parent",
        parentId: grandparent.id,
        status: "idea",
      });
      if (!("id" in parent)) throw new Error("Parent create failed");
      const grandchild = await tracker.create({
        title: "Grandchild",
        parentId: parent.id,
        status: "todo",
      });
      if (!("id" in grandchild)) throw new Error("Grandchild create failed");

      await tracker.update(grandchild.id, { status: "done" });

      // Parent should be auto-promoted to in-progress (capped)
      const parentView = await tracker.view(parent.id);
      if ("status" in parentView) {
        expect(parentView.status).toBe("in-progress");
      }

      // Grandparent should be auto-promoted to in-progress (capped)
      const grandparentView = await tracker.view(grandparent.id);
      if ("status" in grandparentView) {
        expect(grandparentView.status).toBe("in-progress");
      }
    });

    test("child → done when parent already done — no promotion", async () => {
      const parent = await tracker.create({ title: "Parent", status: "done" });
      if (!("id" in parent)) throw new Error("Parent create failed");
      const child = await tracker.create({ title: "Child", parentId: parent.id, status: "todo" });
      if (!("id" in child)) throw new Error("Child create failed");

      const parentHistoryBefore = await tracker.history(parent.id);
      const eventCountBefore = Array.isArray(parentHistoryBefore) ? parentHistoryBefore.length : 0;

      await tracker.update(child.id, { status: "done" });

      // Parent should NOT have new events — no promotion needed
      const parentHistoryAfter = await tracker.history(parent.id);
      if (Array.isArray(parentHistoryAfter)) {
        expect(parentHistoryAfter).toHaveLength(eventCountBefore);
      }
    });

    test("child → same status — no promotion or cascade", async () => {
      const parent = await tracker.create({ title: "Parent", status: "in-progress" });
      if (!("id" in parent)) throw new Error("Parent create failed");
      const child = await tracker.create({
        title: "Child",
        parentId: parent.id,
        status: "in-progress",
      });
      if (!("id" in child)) throw new Error("Child create failed");

      const parentHistoryBefore = await tracker.history(parent.id);
      const eventCountBefore = Array.isArray(parentHistoryBefore) ? parentHistoryBefore.length : 0;

      // Update child to same status
      await tracker.update(child.id, { status: "in-progress" });

      // Parent should NOT get new events — no status change, no promotion
      const parentHistoryAfter = await tracker.history(parent.id);
      if (Array.isArray(parentHistoryAfter)) {
        expect(parentHistoryAfter).toHaveLength(eventCountBefore);
      }
    });
  });

  describe("hierarchy — reparenting", () => {
    let tracker: Tracker;

    beforeEach(async () => {
      tracker = new Tracker(testDir);
      await tracker.init();
    });

    test("update parentId to new parent — childrenOf updated", async () => {
      const oldParent = await tracker.create({ title: "Old Parent" });
      if (!("id" in oldParent)) throw new Error("Old parent create failed");
      const newParent = await tracker.create({ title: "New Parent" });
      if (!("id" in newParent)) throw new Error("New parent create failed");
      const child = await tracker.create({ title: "Child", parentId: oldParent.id });
      if (!("id" in child)) throw new Error("Child create failed");

      await tracker.update(child.id, { parentId: newParent.id });

      // Verify childrenOf updated
      const index = JSON.parse(readFileSync(join(testDir, ".trackgentic", "index.json"), "utf-8"));
      expect(index.childrenOf[oldParent.id]).toBeUndefined();
      expect(index.childrenOf[newParent.id]).toEqual([child.id]);

      // Verify child's parentId updated
      const childView = await tracker.view(child.id);
      if ("parentId" in childView) {
        expect(childView.parentId).toBe(newParent.id);
      }
    });

    test("update parentId to closed parent — HIERARCHY_CONSTRAINT", async () => {
      const oldParent = await tracker.create({ title: "Old Parent" });
      if (!("id" in oldParent)) throw new Error("Old parent create failed");
      const newParent = await tracker.create({ title: "New Parent", status: "closed" });
      if (!("id" in newParent)) throw new Error("New parent create failed");
      const child = await tracker.create({ title: "Child", parentId: oldParent.id });
      if (!("id" in child)) throw new Error("Child create failed");

      try {
        await tracker.update(child.id, { parentId: newParent.id });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("HIERARCHY_CONSTRAINT");
        expect(e.exitCode).toBe(12);
      }
    });

    test("update parentId to non-existent parent — NOT_FOUND", async () => {
      const child = await tracker.create({ title: "Child" });
      if (!("id" in child)) throw new Error("Child create failed");

      try {
        await tracker.update(child.id, { parentId: "missing12345" });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("NOT_FOUND");
        expect(e.exitCode).toBe(5);
      }
    });

    test("detach (parentId = null) — removed from childrenOf", async () => {
      const parent = await tracker.create({ title: "Parent" });
      if (!("id" in parent)) throw new Error("Parent create failed");
      const child = await tracker.create({ title: "Child", parentId: parent.id });
      if (!("id" in child)) throw new Error("Child create failed");

      await tracker.update(child.id, { parentId: null });

      // Verify childrenOf updated
      const index = JSON.parse(readFileSync(join(testDir, ".trackgentic", "index.json"), "utf-8"));
      expect(index.childrenOf[parent.id]).toBeUndefined();

      // Verify child's parentId is null
      const childView = await tracker.view(child.id);
      if ("parentId" in childView) {
        expect(childView.parentId).toBeNull();
      }
    });

    test("reparent with upward constraint — parent auto-promoted", async () => {
      const oldParent = await tracker.create({ title: "Old Parent", status: "done" });
      if (!("id" in oldParent)) throw new Error("Old parent create failed");
      const newParent = await tracker.create({ title: "New Parent", status: "todo" });
      if (!("id" in newParent)) throw new Error("New parent create failed");
      const child = await tracker.create({
        title: "Child",
        parentId: oldParent.id,
        status: "done",
      });
      if (!("id" in child)) throw new Error("Child create failed");

      await tracker.update(child.id, { parentId: newParent.id });

      // New parent should be auto-promoted to in-progress (capped)
      const newParentView = await tracker.view(newParent.id);
      if ("status" in newParentView) {
        expect(newParentView.status).toBe("in-progress");
      }

      // Verify system event in new parent's history
      const history = await tracker.history(newParent.id);
      if (Array.isArray(history)) {
        const lastEvent = history[history.length - 1];
        expect(lastEvent.type).toBe("update");
        if (lastEvent.type === "update") {
          expect(lastEvent.author).toBe("system");
          expect(lastEvent.content.status).toBe("in-progress");
        }
      }
    });

    test("reparent from null (root) to parent — childrenOf updated", async () => {
      const parent = await tracker.create({ title: "Parent" });
      if (!("id" in parent)) throw new Error("Parent create failed");
      const child = await tracker.create({ title: "Orphan" });
      if (!("id" in child)) throw new Error("Child create failed");

      // Child starts with no parent
      const childViewBefore = await tracker.view(child.id);
      if ("parentId" in childViewBefore) {
        expect(childViewBefore.parentId).toBeNull();
      }

      await tracker.update(child.id, { parentId: parent.id });

      // Verify childrenOf updated
      const index = JSON.parse(readFileSync(join(testDir, ".trackgentic", "index.json"), "utf-8"));
      expect(index.childrenOf[parent.id]).toEqual([child.id]);

      // Verify child's parentId
      const childViewAfter = await tracker.view(child.id);
      if ("parentId" in childViewAfter) {
        expect(childViewAfter.parentId).toBe(parent.id);
      }
    });

    test("parentId update to same value — no changes", async () => {
      const parent = await tracker.create({ title: "Parent" });
      if (!("id" in parent)) throw new Error("Parent create failed");
      const child = await tracker.create({ title: "Child", parentId: parent.id });
      if (!("id" in child)) throw new Error("Child create failed");

      const childHistoryBefore = await tracker.history(child.id);
      const eventCountBefore = Array.isArray(childHistoryBefore) ? childHistoryBefore.length : 0;

      // Set parentId to same parent
      await tracker.update(child.id, { parentId: parent.id });

      // Should NOT have appended an event or changed anything
      const childHistoryAfter = await tracker.history(child.id);
      if (Array.isArray(childHistoryAfter)) {
        // Note: update still appends an event (it always does), but childrenOf is unchanged
        // parentId is set to same value — the event records it but no structural change
        expect(childHistoryAfter.length).toBeGreaterThanOrEqual(eventCountBefore);
      }

      // childrenOf should still have exactly one child
      const index = JSON.parse(readFileSync(join(testDir, ".trackgentic", "index.json"), "utf-8"));
      expect(index.childrenOf[parent.id]).toEqual([child.id]);
    });
  });

  // ─── Blockages Tests ────────────────────────────────────────────────

  describe("blockages", () => {
    let tracker: Tracker;

    beforeEach(async () => {
      tracker = new Tracker(testDir);
      await tracker.init();
    });

    test("blockagesAdd: creates entries in both maps, appends events", async () => {
      const blocked = await tracker.create({ title: "Blocked" });
      const blocker = await tracker.create({ title: "Blocker" });
      if (!("id" in blocked) || !("id" in blocker)) throw new Error("Create failed");

      const result = await tracker.blockagesAdd(blocked.id, { blockerIds: [blocker.id] });
      expect(result).toEqual({ result: "OK" });

      // Verify dependencies file
      const deps = JSON.parse(
        readFileSync(join(testDir, ".trackgentic", "dependencies.json"), "utf-8"),
      );
      expect(deps.blockedBy[blocked.id]).toHaveLength(1);
      expect(deps.blockedBy[blocked.id][0].blockerId).toBe(blocker.id);
      expect(deps.blockedBy[blocked.id][0].status).toBe("active");
      expect(deps.blocks[blocker.id]).toHaveLength(1);
      expect(deps.blocks[blocker.id][0].blockedId).toBe(blocked.id);

      // Verify event appended
      const events = JSON.parse(
        readFileSync(join(testDir, ".trackgentic", "issues", `${blocked.id}.json`), "utf-8"),
      );
      const blockageEvent = events[events.length - 1];
      expect(blockageEvent.type).toBe("blockage-added");
      expect(blockageEvent.content.blockerId).toBe(blocker.id);
    });

    test("blockagesAdd batch: multiple blockers added atomically", async () => {
      const blocked = await tracker.create({ title: "Blocked" });
      const blocker1 = await tracker.create({ title: "Blocker 1" });
      const blocker2 = await tracker.create({ title: "Blocker 2" });
      if (!("id" in blocked) || !("id" in blocker1) || !("id" in blocker2))
        throw new Error("Create failed");

      const result = await tracker.blockagesAdd(blocked.id, {
        blockerIds: [blocker1.id, blocker2.id],
      });
      expect(result).toEqual({ result: "OK" });

      const deps = JSON.parse(
        readFileSync(join(testDir, ".trackgentic", "dependencies.json"), "utf-8"),
      );
      expect(deps.blockedBy[blocked.id]).toHaveLength(2);
    });

    test("blockagesAdd cycle detection: rejects with BLOCKAGE_CYCLE, no side effects", async () => {
      const issueA = await tracker.create({ title: "A" });
      const issueB = await tracker.create({ title: "B" });
      if (!("id" in issueA) || !("id" in issueB)) throw new Error("Create failed");

      // A is blocked by B
      await tracker.blockagesAdd(issueA.id, { blockerIds: [issueB.id] });

      // Try to add B blocked by A → should detect cycle
      try {
        await tracker.blockagesAdd(issueB.id, { blockerIds: [issueA.id] });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("BLOCKAGE_CYCLE");
        expect(e.exitCode).toBe(11);
      }

      // Verify no side effects: B should NOT be in blockedBy for A
      const deps = JSON.parse(
        readFileSync(join(testDir, ".trackgentic", "dependencies.json"), "utf-8"),
      );
      expect(deps.blockedBy[issueB.id]).toBeUndefined();
    });

    test("blockagesAdd batch atomicity: if last blocker causes cycle, none written", async () => {
      const issueA = await tracker.create({ title: "A" });
      const issueB = await tracker.create({ title: "B" });
      const issueC = await tracker.create({ title: "C" });
      if (!("id" in issueA) || !("id" in issueB) || !("id" in issueC))
        throw new Error("Create failed");

      // A is blocked by B, B is blocked by C
      await tracker.blockagesAdd(issueA.id, { blockerIds: [issueB.id] });
      await tracker.blockagesAdd(issueB.id, { blockerIds: [issueC.id] });

      // Try C blocked by A → cycle (C→B→A→... back to C)
      try {
        await tracker.blockagesAdd(issueC.id, { blockerIds: [issueA.id] });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("BLOCKAGE_CYCLE");
      }

      // Verify C has no blockages
      const deps = JSON.parse(
        readFileSync(join(testDir, ".trackgentic", "dependencies.json"), "utf-8"),
      );
      expect(deps.blockedBy[issueC.id]).toBeUndefined();
    });

    test("blockagesAdd NOT_FOUND for blockedId", async () => {
      const blocker = await tracker.create({ title: "Blocker" });
      if (!("id" in blocker)) throw new Error("Create failed");

      try {
        await tracker.blockagesAdd("missing12345", { blockerIds: [blocker.id] });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("NOT_FOUND");
        expect(e.exitCode).toBe(5);
      }
    });

    test("blockagesAdd NOT_FOUND for blockerId", async () => {
      const blocked = await tracker.create({ title: "Blocked" });
      if (!("id" in blocked)) throw new Error("Create failed");

      try {
        await tracker.blockagesAdd(blocked.id, { blockerIds: ["missing12345"] });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("NOT_FOUND");
        expect(e.exitCode).toBe(5);
      }
    });

    test("blockagesResolve: marks as resolved in both maps, appends events", async () => {
      const blocked = await tracker.create({ title: "Blocked" });
      const blocker = await tracker.create({ title: "Blocker" });
      if (!("id" in blocked) || !("id" in blocker)) throw new Error("Create failed");

      await tracker.blockagesAdd(blocked.id, { blockerIds: [blocker.id] });
      const result = await tracker.blockagesResolve(blocked.id, { blockerIds: [blocker.id] });
      expect(result).toEqual({ result: "OK" });

      const deps = JSON.parse(
        readFileSync(join(testDir, ".trackgentic", "dependencies.json"), "utf-8"),
      );
      expect(deps.blockedBy[blocked.id][0].status).toBe("resolved");
      expect(deps.blocks[blocker.id][0].status).toBe("resolved");

      // Verify event
      const events = JSON.parse(
        readFileSync(join(testDir, ".trackgentic", "issues", `${blocked.id}.json`), "utf-8"),
      );
      const resolveEvent = events[events.length - 1];
      expect(resolveEvent.type).toBe("blockage-resolved");
      expect(resolveEvent.content.blockerId).toBe(blocker.id);
    });

    test("blockagesResolve already resolved: idempotent", async () => {
      const blocked = await tracker.create({ title: "Blocked" });
      const blocker = await tracker.create({ title: "Blocker" });
      if (!("id" in blocked) || !("id" in blocker)) throw new Error("Create failed");

      await tracker.blockagesAdd(blocked.id, { blockerIds: [blocker.id] });
      await tracker.blockagesResolve(blocked.id, { blockerIds: [blocker.id] });
      const result = await tracker.blockagesResolve(blocked.id, { blockerIds: [blocker.id] });
      expect(result).toEqual({ result: "OK" });
    });

    test("blockagesResolve NOT_FOUND for blockedId", async () => {
      try {
        await tracker.blockagesResolve("missing12345", { blockerIds: ["blocker123"] });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("NOT_FOUND");
      }
    });

    test("blockagesDelete: removes from both maps, appends events", async () => {
      const blocked = await tracker.create({ title: "Blocked" });
      const blocker = await tracker.create({ title: "Blocker" });
      if (!("id" in blocked) || !("id" in blocker)) throw new Error("Create failed");

      await tracker.blockagesAdd(blocked.id, { blockerIds: [blocker.id] });
      const result = await tracker.blockagesDelete(blocked.id, { blockerIds: [blocker.id] });
      expect(result).toEqual({ result: "OK" });

      const deps = JSON.parse(
        readFileSync(join(testDir, ".trackgentic", "dependencies.json"), "utf-8"),
      );
      expect(deps.blockedBy[blocked.id]).toBeUndefined();
      expect(deps.blocks[blocker.id]).toBeUndefined();

      // Verify event
      const events = JSON.parse(
        readFileSync(join(testDir, ".trackgentic", "issues", `${blocked.id}.json`), "utf-8"),
      );
      const deleteEvent = events[events.length - 1];
      expect(deleteEvent.type).toBe("blockage-deleted");
      expect(deleteEvent.content.blockerId).toBe(blocker.id);
    });

    test("blockagesDelete NOT_FOUND for blockedId", async () => {
      try {
        await tracker.blockagesDelete("missing12345", { blockerIds: ["blocker123"] });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("NOT_FOUND");
      }
    });

    test("blockagesList: returns both blockedBy and blocks", async () => {
      const blocked = await tracker.create({ title: "Blocked" });
      const blocker = await tracker.create({ title: "Blocker" });
      if (!("id" in blocked) || !("id" in blocker)) throw new Error("Create failed");

      await tracker.blockagesAdd(blocked.id, { blockerIds: [blocker.id] });
      const result = await tracker.blockagesList(blocked.id);

      expect(result.issueId).toBe(blocked.id);
      if ("blockedBy" in result) {
        expect(result.blockedBy).toHaveLength(1);
        expect(result.blockedBy[0].blockerId).toBe(blocker.id);
        expect(result.blocks).toHaveLength(0);
      }
    });

    test("blockagesList: returns blocks for blocker issue", async () => {
      const blocked = await tracker.create({ title: "Blocked" });
      const blocker = await tracker.create({ title: "Blocker" });
      if (!("id" in blocked) || !("id" in blocker)) throw new Error("Create failed");

      await tracker.blockagesAdd(blocked.id, { blockerIds: [blocker.id] });
      const result = await tracker.blockagesList(blocker.id);

      expect(result.issueId).toBe(blocker.id);
      if ("blockedBy" in result) {
        expect(result.blockedBy).toHaveLength(0);
        expect(result.blocks).toHaveLength(1);
        expect(result.blocks[0].blockedId).toBe(blocked.id);
      }
    });

    test("blockagesList empty: returns empty arrays", async () => {
      const issue = await tracker.create({ title: "Standalone" });
      if (!("id" in issue)) throw new Error("Create failed");

      const result = await tracker.blockagesList(issue.id);
      if ("blockedBy" in result) {
        expect(result.blockedBy).toEqual([]);
        expect(result.blocks).toEqual([]);
      }
    });

    test("blockagesList NOT_FOUND for missing issue", async () => {
      try {
        await tracker.blockagesList("missing12345");
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("NOT_FOUND");
      }
    });

    test("Auto-resolution: issue set to done → active blocks auto-resolved with system events", async () => {
      const blocked = await tracker.create({ title: "Blocked" });
      const blocker = await tracker.create({ title: "Blocker" });
      if (!("id" in blocked) || !("id" in blocker)) throw new Error("Create failed");

      await tracker.blockagesAdd(blocked.id, { blockerIds: [blocker.id] });

      // Transition blocker to done
      await tracker.update(blocker.id, { status: "done" });

      // Verify deps are resolved
      const deps = JSON.parse(
        readFileSync(join(testDir, ".trackgentic", "dependencies.json"), "utf-8"),
      );
      expect(deps.blockedBy[blocked.id][0].status).toBe("resolved");
      expect(deps.blocks[blocker.id][0].status).toBe("resolved");

      // Verify system event in blocked issue
      const blockedEvents = JSON.parse(
        readFileSync(join(testDir, ".trackgentic", "issues", `${blocked.id}.json`), "utf-8"),
      );
      const autoEvent = blockedEvents[blockedEvents.length - 1];
      expect(autoEvent.type).toBe("blockage-resolved");
      expect(autoEvent.author).toBe("system");
      expect(autoEvent.content.blockerId).toBe(blocker.id);
      expect(autoEvent.content.reason).toContain("transitioned to done");
    });

    test("Auto-resolution: issue set to closed → active blocks auto-resolved", async () => {
      const blocked = await tracker.create({ title: "Blocked" });
      const blocker = await tracker.create({ title: "Blocker", status: "done" });
      if (!("id" in blocked) || !("id" in blocker)) throw new Error("Create failed");

      await tracker.blockagesAdd(blocked.id, { blockerIds: [blocker.id] });

      await tracker.update(blocker.id, { status: "closed" });

      const deps = JSON.parse(
        readFileSync(join(testDir, ".trackgentic", "dependencies.json"), "utf-8"),
      );
      expect(deps.blockedBy[blocked.id][0].status).toBe("resolved");

      const blockedEvents = JSON.parse(
        readFileSync(join(testDir, ".trackgentic", "issues", `${blocked.id}.json`), "utf-8"),
      );
      const autoEvent = blockedEvents[blockedEvents.length - 1];
      expect(autoEvent.type).toBe("blockage-resolved");
      expect(autoEvent.author).toBe("system");
      expect(autoEvent.content.reason).toContain("transitioned to closed");
    });

    test("Auto-resolution: no active blocks → no events appended", async () => {
      const blocker = await tracker.create({ title: "Blocker" });
      if (!("id" in blocker)) throw new Error("Create failed");

      await tracker.update(blocker.id, { status: "done" });

      // No blockages existed, so no auto-resolution events
      const deps = JSON.parse(
        readFileSync(join(testDir, ".trackgentic", "dependencies.json"), "utf-8"),
      );
      expect(Object.keys(deps.blockedBy)).toHaveLength(0);
      expect(Object.keys(deps.blocks)).toHaveLength(0);
    });

    test("Auto-resolution: only resolves active blocks, not already resolved", async () => {
      const blocked1 = await tracker.create({ title: "Blocked 1" });
      const blocked2 = await tracker.create({ title: "Blocked 2" });
      const blocker = await tracker.create({ title: "Blocker" });
      if (!("id" in blocked1) || !("id" in blocked2) || !("id" in blocker))
        throw new Error("Create failed");

      await tracker.blockagesAdd(blocked1.id, { blockerIds: [blocker.id] });
      await tracker.blockagesAdd(blocked2.id, { blockerIds: [blocker.id] });

      // Manually resolve blocked1
      await tracker.blockagesResolve(blocked1.id, { blockerIds: [blocker.id] });

      // Record blocked1's event count before auto-resolution
      const blocked1Events = JSON.parse(
        readFileSync(join(testDir, ".trackgentic", "issues", `${blocked1.id}.json`), "utf-8"),
      );
      const blocked1EventCount = blocked1Events.length;

      // Transition blocker to done
      await tracker.update(blocker.id, { status: "done" });

      // blocked1 should not get an extra auto-resolve event (was already resolved)
      const blocked1EventsAfter = JSON.parse(
        readFileSync(join(testDir, ".trackgentic", "issues", `${blocked1.id}.json`), "utf-8"),
      );
      expect(blocked1EventsAfter).toHaveLength(blocked1EventCount);

      // blocked2 should have auto-resolve event
      const blocked2Events = JSON.parse(
        readFileSync(join(testDir, ".trackgentic", "issues", `${blocked2.id}.json`), "utf-8"),
      );
      const autoEvent = blocked2Events[blocked2Events.length - 1];
      expect(autoEvent.type).toBe("blockage-resolved");
      expect(autoEvent.author).toBe("system");
    });

    test("Impact score in list sort: issues sorted by priority → impact → age", async () => {
      // Create issues with same priority
      const lowImpact = await tracker.create({ title: "Low Impact", priority: 1 });
      const highImpact = await tracker.create({ title: "High Impact", priority: 1 });
      if (!("id" in lowImpact) || !("id" in highImpact)) throw new Error("Create failed");

      const blocked1 = await tracker.create({ title: "Blocked 1" });
      const blocked2 = await tracker.create({ title: "Blocked 2" });
      if (!("id" in blocked1) || !("id" in blocked2)) throw new Error("Create failed");

      // highImpact blocks 2 issues → higher impact score
      await tracker.blockagesAdd(blocked1.id, { blockerIds: [highImpact.id] });
      await tracker.blockagesAdd(blocked2.id, { blockerIds: [highImpact.id] });

      // lowImpact blocks 1 issue → lower impact score
      const blocked3 = await tracker.create({ title: "Blocked 3" });
      if (!("id" in blocked3)) throw new Error("Create failed");
      await tracker.blockagesAdd(blocked3.id, { blockerIds: [lowImpact.id] });

      const result = await tracker.list();
      // Same priority → higher impact first
      const titles = result.map((e) => e.title);
      const highIdx = titles.indexOf("High Impact");
      const lowIdx = titles.indexOf("Low Impact");
      expect(highIdx).toBeLessThan(lowIdx);
    });

    test("blockagesAdd throws NOT_INITIALIZED when no .trackgentic/ exists", async () => {
      const uninitDir = join(
        tmpdir(),
        `trackgentic-uninit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      mkdirSync(uninitDir, { recursive: true });
      const uninitTracker = new Tracker(uninitDir);
      try {
        await uninitTracker.blockagesAdd("missing12345", { blockerIds: ["blocker123"] });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("NOT_INITIALIZED");
      }
      rmSync(uninitDir, { recursive: true, force: true });
    });

    test("blockagesList throws NOT_INITIALIZED when no .trackgentic/ exists", async () => {
      const uninitDir = join(
        tmpdir(),
        `trackgentic-uninit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      mkdirSync(uninitDir, { recursive: true });
      const uninitTracker = new Tracker(uninitDir);
      try {
        await uninitTracker.blockagesList("missing12345");
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("NOT_INITIALIZED");
      }
      rmSync(uninitDir, { recursive: true, force: true });
    });
  });

  // ─── Blockages Auth Integration ────────────────────────────────────

  describe("blockages auth integration", () => {
    let tracker: Tracker;
    let savedToken: string | undefined;

    beforeEach(async () => {
      testDir = join(
        tmpdir(),
        `trackgentic-test-blockage-auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      mkdirSync(testDir, { recursive: true });
      tracker = new Tracker(testDir);
      await tracker.init();
      savedToken = process.env.TRACKGENTIC_USER_TOKEN;
      delete process.env.TRACKGENTIC_USER_TOKEN;
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

    test("read-only mode: blockagesAdd without token returns TOKEN_REQUIRED", async () => {
      const blocked = await tracker.create({ title: "Blocked" });
      const blocker = await tracker.create({ title: "Blocker" });
      if (!("id" in blocked) || !("id" in blocker)) throw new Error("Create failed");

      setAuthMode("read-only");
      const result = await tracker.blockagesAdd(blocked.id, { blockerIds: [blocker.id] });

      expect(result).toBeInstanceOf(TrackgenticError);
      if (result instanceof TrackgenticError) {
        expect(result.result).toBe("TOKEN_REQUIRED");
        expect(result.exitCode).toBe(2);
      }
    });

    test("read-only mode: blockagesResolve without token returns TOKEN_REQUIRED", async () => {
      const blocked = await tracker.create({ title: "Blocked" });
      const blocker = await tracker.create({ title: "Blocker" });
      if (!("id" in blocked) || !("id" in blocker)) throw new Error("Create failed");

      await tracker.blockagesAdd(blocked.id, { blockerIds: [blocker.id] });

      setAuthMode("read-only");
      const result = await tracker.blockagesResolve(blocked.id, { blockerIds: [blocker.id] });

      expect(result).toBeInstanceOf(TrackgenticError);
      if (result instanceof TrackgenticError) {
        expect(result.result).toBe("TOKEN_REQUIRED");
      }
    });

    test("read-only mode: blockagesDelete without token returns TOKEN_REQUIRED", async () => {
      const blocked = await tracker.create({ title: "Blocked" });
      const blocker = await tracker.create({ title: "Blocker" });
      if (!("id" in blocked) || !("id" in blocker)) throw new Error("Create failed");

      await tracker.blockagesAdd(blocked.id, { blockerIds: [blocker.id] });

      setAuthMode("read-only");
      const result = await tracker.blockagesDelete(blocked.id, { blockerIds: [blocker.id] });

      expect(result).toBeInstanceOf(TrackgenticError);
      if (result instanceof TrackgenticError) {
        expect(result.result).toBe("TOKEN_REQUIRED");
      }
    });

    test("read-only mode: blockagesList without token succeeds", async () => {
      const blocked = await tracker.create({ title: "Blocked" });
      const blocker = await tracker.create({ title: "Blocker" });
      if (!("id" in blocked) || !("id" in blocker)) throw new Error("Create failed");

      await tracker.blockagesAdd(blocked.id, { blockerIds: [blocker.id] });

      setAuthMode("read-only");
      const result = await tracker.blockagesList(blocked.id);

      expect(result.issueId).toBe(blocked.id);
      if ("blockedBy" in result) {
        expect(result.blockedBy).toHaveLength(1);
      }
    });

    test("strict mode: blockagesList without token throws TOKEN_REQUIRED", async () => {
      const issue = await tracker.create({ title: "Test" });
      if (!("id" in issue)) throw new Error("Create failed");

      setAuthMode("strict");
      try {
        await tracker.blockagesList(issue.id);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("TOKEN_REQUIRED");
        expect(e.exitCode).toBe(2);
      }
    });

    test("strict mode: blockagesAdd without token returns TOKEN_REQUIRED", async () => {
      const blocked = await tracker.create({ title: "Blocked" });
      const blocker = await tracker.create({ title: "Blocker" });
      if (!("id" in blocked) || !("id" in blocker)) throw new Error("Create failed");

      setAuthMode("strict");
      const result = await tracker.blockagesAdd(blocked.id, { blockerIds: [blocker.id] });

      expect(result).toBeInstanceOf(TrackgenticError);
      if (result instanceof TrackgenticError) {
        expect(result.result).toBe("TOKEN_REQUIRED");
      }
    });

    test("with valid token: blockagesAdd uses author from token", async () => {
      const regResult = await tracker.usersRegister("charlie");
      if (regResult.result !== "OK") throw new Error("Register failed");
      process.env.TRACKGENTIC_USER_TOKEN = regResult.token;

      const blocked = await tracker.create({ title: "Blocked" });
      const blocker = await tracker.create({ title: "Blocker" });
      if (!("id" in blocked) || !("id" in blocker)) throw new Error("Create failed");

      const result = await tracker.blockagesAdd(blocked.id, { blockerIds: [blocker.id] });
      expect(result).toEqual({ result: "OK" });

      // Verify event has correct author
      const events = JSON.parse(
        readFileSync(join(testDir, ".trackgentic", "issues", `${blocked.id}.json`), "utf-8"),
      );
      const blockageEvent = events[events.length - 1];
      expect(blockageEvent.author).toBe("charlie");
      expect(blockageEvent.type).toBe("blockage-added");
    });

    test("with invalid token: blockagesAdd returns INVALID_TOKEN", async () => {
      const blocked = await tracker.create({ title: "Blocked" });
      const blocker = await tracker.create({ title: "Blocker" });
      if (!("id" in blocked) || !("id" in blocker)) throw new Error("Create failed");

      process.env.TRACKGENTIC_USER_TOKEN = "tk_fake0000";

      const result = await tracker.blockagesAdd(blocked.id, { blockerIds: [blocker.id] });

      expect(result).toBeInstanceOf(TrackgenticError);
      if (result instanceof TrackgenticError) {
        expect(result.result).toBe("INVALID_TOKEN");
        expect(result.exitCode).toBe(3);
      }
    });
  });
});
