import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
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
          mode: "read-only",
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
      expect(config.auth.mode).toBe("read-only");
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
      const result = await tracker.create({
        title: "Full Issue",
        description: "A description",
        status: "todo",
        priority: 1,
        assignee: "bob",
        tags: ["bug", "urgent"],
        parentId: "parent12345",
      });

      if ("id" in result) {
        const index = JSON.parse(
          readFileSync(join(testDir, ".trackgentic", "index.json"), "utf-8"),
        );
        const entry = index.open[0];
        expect(entry.title).toBe("Full Issue");
        expect(entry.status).toBe("todo");
        expect(entry.priority).toBe(1);
        expect(entry.assignee).toBe("bob");
        expect(entry.tags).toEqual(["bug", "urgent"]);
        expect(entry.parentId).toBe("parent12345");
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
      const created = await tracker.create({ title: "Child", parentId: "parent12345" });

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
  });

  describe("full CRUD cycle", () => {
    test("create → list → view → update → view → history", async () => {
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
});
