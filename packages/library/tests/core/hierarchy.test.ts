import { describe, expect, test } from "bun:test";
import type { IndexEntry, IndexFile } from "../../src/types";
import {
  computeUpwardPromotions,
  getClosableChildren,
  isStatusAfter,
  validateNewChild,
  validateParentStatusChange,
} from "../../src/core/hierarchy";
import { findEntry } from "../../src/core/index-manager";

const EMPTY_INDEX: IndexFile = {
  open: [],
  closed: [],
  childrenOf: {},
};

function makeEntry(overrides: Partial<IndexEntry> = {}): IndexEntry {
  return {
    id: "abc123test",
    title: "Test Issue",
    path: "issues/abc123test.json",
    status: "idea",
    assignee: null,
    parentId: null,
    tags: [],
    priority: 3,
    ...overrides,
  };
}

function makeIndex(entries: IndexEntry[]): IndexFile {
  const index: IndexFile = { open: [], closed: [], childrenOf: {} };
  for (const entry of entries) {
    if (entry.status === "closed") {
      index.closed.push(entry);
    } else {
      index.open.push(entry);
    }
    if (entry.parentId) {
      if (!index.childrenOf[entry.parentId]) {
        index.childrenOf[entry.parentId] = [];
      }
      index.childrenOf[entry.parentId].push(entry.id);
    }
  }
  return index;
}

describe("Hierarchy", () => {
  describe("isStatusAfter", () => {
    test("same status returns false", () => {
      expect(isStatusAfter("idea", "idea")).toBe(false);
      expect(isStatusAfter("todo", "todo")).toBe(false);
      expect(isStatusAfter("in-progress", "in-progress")).toBe(false);
      expect(isStatusAfter("done", "done")).toBe(false);
      expect(isStatusAfter("closed", "closed")).toBe(false);
    });

    test("child after parent returns true", () => {
      expect(isStatusAfter("todo", "idea")).toBe(true);
      expect(isStatusAfter("in-progress", "idea")).toBe(true);
      expect(isStatusAfter("in-progress", "todo")).toBe(true);
      expect(isStatusAfter("done", "idea")).toBe(true);
      expect(isStatusAfter("done", "todo")).toBe(true);
      expect(isStatusAfter("done", "in-progress")).toBe(true);
      expect(isStatusAfter("closed", "idea")).toBe(true);
      expect(isStatusAfter("closed", "todo")).toBe(true);
      expect(isStatusAfter("closed", "in-progress")).toBe(true);
      expect(isStatusAfter("closed", "done")).toBe(true);
    });

    test("child before parent returns false", () => {
      expect(isStatusAfter("idea", "todo")).toBe(false);
      expect(isStatusAfter("idea", "in-progress")).toBe(false);
      expect(isStatusAfter("idea", "done")).toBe(false);
      expect(isStatusAfter("idea", "closed")).toBe(false);
      expect(isStatusAfter("todo", "in-progress")).toBe(false);
      expect(isStatusAfter("todo", "done")).toBe(false);
      expect(isStatusAfter("todo", "closed")).toBe(false);
      expect(isStatusAfter("in-progress", "done")).toBe(false);
      expect(isStatusAfter("in-progress", "closed")).toBe(false);
      expect(isStatusAfter("done", "closed")).toBe(false);
    });
  });

  describe("validateNewChild", () => {
    test("null parent returns null (no constraint)", () => {
      expect(validateNewChild(null)).toBeNull();
    });

    test("closed parent returns error", () => {
      const entry = makeEntry({ status: "closed" });
      expect(validateNewChild(entry)).toBe("Cannot add child to closed parent.");
    });

    test("idea parent returns null", () => {
      const entry = makeEntry({ status: "idea" });
      expect(validateNewChild(entry)).toBeNull();
    });

    test("todo parent returns null", () => {
      const entry = makeEntry({ status: "todo" });
      expect(validateNewChild(entry)).toBeNull();
    });

    test("in-progress parent returns null", () => {
      const entry = makeEntry({ status: "in-progress" });
      expect(validateNewChild(entry)).toBeNull();
    });

    test("done parent returns null", () => {
      const entry = makeEntry({ status: "done" });
      expect(validateNewChild(entry)).toBeNull();
    });
  });

  describe("validateParentStatusChange", () => {
    test("target not done/closed returns null", () => {
      const child = makeEntry({ id: "child000001", status: "idea" });
      const index = makeIndex([child]);
      expect(validateParentStatusChange(index, [child], "idea")).toBeNull();
      expect(validateParentStatusChange(index, [child], "todo")).toBeNull();
      expect(validateParentStatusChange(index, [child], "in-progress")).toBeNull();
    });

    test("no children returns null for done", () => {
      expect(validateParentStatusChange(EMPTY_INDEX, [], "done")).toBeNull();
    });

    test("no children returns null for closed", () => {
      expect(validateParentStatusChange(EMPTY_INDEX, [], "closed")).toBeNull();
    });

    test("all children done/closed returns null for done", () => {
      const child1 = makeEntry({ id: "child000001", status: "done" });
      const child2 = makeEntry({ id: "child000002", status: "closed" });
      const index = makeIndex([child1, child2]);
      expect(validateParentStatusChange(index, [child1, child2], "done")).toBeNull();
    });

    test("all children done/closed returns null for closed", () => {
      const child1 = makeEntry({ id: "child000001", status: "done" });
      const child2 = makeEntry({ id: "child000002", status: "closed" });
      const index = makeIndex([child1, child2]);
      expect(validateParentStatusChange(index, [child1, child2], "closed")).toBeNull();
    });

    test("one child in-progress blocks done", () => {
      const child = makeEntry({ id: "child000001", status: "in-progress" });
      const index = makeIndex([child]);
      const result = validateParentStatusChange(index, [child], "done");
      expect(result).toBe(
        "Cannot set parent to `done`: child `child000001` has status 'in-progress'.",
      );
    });

    test("one child in-progress blocks closed", () => {
      const child = makeEntry({ id: "child000001", status: "in-progress" });
      const index = makeIndex([child]);
      const result = validateParentStatusChange(index, [child], "closed");
      expect(result).toBe(
        "Cannot set parent to `closed`: child `child000001` has status 'in-progress'.",
      );
    });

    test("one child idea blocks done among multiple children", () => {
      const child1 = makeEntry({ id: "child000001", status: "done" });
      const child2 = makeEntry({ id: "child000002", status: "idea" });
      const index = makeIndex([child1, child2]);
      const result = validateParentStatusChange(index, [child1, child2], "done");
      expect(result).toBe("Cannot set parent to `done`: child `child000002` has status 'idea'.");
    });

    test("one child todo blocks closed", () => {
      const child = makeEntry({ id: "child000001", status: "todo" });
      const index = makeIndex([child]);
      const result = validateParentStatusChange(index, [child], "closed");
      expect(result).toBe("Cannot set parent to `closed`: child `child000001` has status 'todo'.");
    });
  });

  describe("getClosableChildren", () => {
    test("empty array returns empty", () => {
      expect(getClosableChildren([])).toEqual([]);
    });

    test("mix of statuses returns only done entries", () => {
      const idea = makeEntry({ id: "idea0000001", status: "idea" });
      const todo = makeEntry({ id: "todo0000001", status: "todo" });
      const progress = makeEntry({ id: "prog00000001", status: "in-progress" });
      const done = makeEntry({ id: "done0000001", status: "done" });
      const closed = makeEntry({ id: "closed00001", status: "closed" });

      const result = getClosableChildren([idea, todo, progress, done, closed]);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("done0000001");
    });

    test("all done returns all", () => {
      const done1 = makeEntry({ id: "done0000001", status: "done" });
      const done2 = makeEntry({ id: "done0000002", status: "done" });
      const done3 = makeEntry({ id: "done0000003", status: "done" });

      const result = getClosableChildren([done1, done2, done3]);
      expect(result).toHaveLength(3);
    });

    test("no done returns empty", () => {
      const idea = makeEntry({ id: "idea0000001", status: "idea" });
      const todo = makeEntry({ id: "todo0000001", status: "todo" });
      const closed = makeEntry({ id: "closed00001", status: "closed" });

      const result = getClosableChildren([idea, todo, closed]);
      expect(result).toHaveLength(0);
    });
  });

  describe("computeUpwardPromotions", () => {
    test("child behind parent returns empty", () => {
      const parent = makeEntry({ id: "parent00001", status: "done" });
      const index = makeIndex([parent]);

      const result = computeUpwardPromotions(index, parent, "todo", (id) => findEntry(index, id));
      expect(result).toEqual([]);
    });

    test("child equal to parent returns empty", () => {
      const parent = makeEntry({ id: "parent00001", status: "done" });
      const index = makeIndex([parent]);

      const result = computeUpwardPromotions(index, parent, "done", (id) => findEntry(index, id));
      expect(result).toEqual([]);
    });

    test("child ahead of parent returns one promotion", () => {
      const parent = makeEntry({ id: "parent00001", status: "in-progress" });
      const index = makeIndex([parent]);

      const result = computeUpwardPromotions(index, parent, "done", (id) => findEntry(index, id));

      expect(result).toHaveLength(1);
      expect(result[0].issueId).toBe("parent00001");
      expect(result[0].event.type).toBe("update");
      if (result[0].event.type === "update") {
        expect(result[0].event.content.status).toBe("done");
        expect(result[0].event.author).toBe("system");
        expect(result[0].event.content.reason).toBe("auto-promoted: child advanced to 'done'");
      }
    });

    test("multi-level: grandchild promotes child promotes parent", () => {
      const grandparent = makeEntry({ id: "grandpa00001", status: "idea" });
      const parent = makeEntry({ id: "parent00001", status: "idea", parentId: "grandpa00001" });
      const index = makeIndex([grandparent, parent]);

      const result = computeUpwardPromotions(index, parent, "done", (id) => findEntry(index, id));

      expect(result).toHaveLength(2);
      // Direct parent first
      expect(result[0].issueId).toBe("parent00001");
      if (result[0].event.type === "update") {
        expect(result[0].event.content.status).toBe("done");
      }
      // Then grandparent
      expect(result[1].issueId).toBe("grandpa00001");
      if (result[1].event.type === "update") {
        expect(result[1].event.content.status).toBe("done");
      }
    });

    test("stops when parent status is already at or past child", () => {
      const grandparent = makeEntry({ id: "grandpa00001", status: "closed" });
      const parent = makeEntry({ id: "parent00001", status: "idea", parentId: "grandpa00001" });
      const index = makeIndex([grandparent, parent]);

      // Parent is idea, grandparent is closed. Promote parent to done.
      // Grandparent is already closed (past done), so no further promotion.
      const result = computeUpwardPromotions(index, parent, "done", (id) => findEntry(index, id));

      expect(result).toHaveLength(1);
      expect(result[0].issueId).toBe("parent00001");
    });

    test("stops when parent has no parent", () => {
      const parent = makeEntry({ id: "parent00001", status: "todo", parentId: null });
      const index = makeIndex([parent]);

      const result = computeUpwardPromotions(index, parent, "done", (id) => findEntry(index, id));

      expect(result).toHaveLength(1);
      expect(result[0].issueId).toBe("parent00001");
    });

    test("findEntry returns null for missing grandparent — stops gracefully", () => {
      const parent = makeEntry({ id: "parent00001", status: "idea", parentId: "missing00001" });
      const index = makeIndex([parent]);

      const result = computeUpwardPromotions(index, parent, "done", (id) => findEntry(index, id));

      // Parent is promoted, but grandparent doesn't exist so walk stops
      expect(result).toHaveLength(1);
      expect(result[0].issueId).toBe("parent00001");
    });
  });
});
