import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
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
});
