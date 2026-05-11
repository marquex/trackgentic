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
});
