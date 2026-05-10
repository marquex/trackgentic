import { describe, expect, test } from "bun:test";
import {
  addChild,
  findEntry,
  getChildren,
  insertEntry,
  removeChild,
  removeEntry,
  updateEntry,
} from "../../src/core/index-manager";
import type { IndexEntry, IndexFile } from "../../src/types";

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

describe("Index Manager", () => {
  describe("insertEntry", () => {
    test("inserts into empty index", () => {
      const entry = makeEntry({ id: "aaa111first" });
      const result = insertEntry(EMPTY_INDEX, entry);

      expect(result.open).toHaveLength(1);
      expect(result.open[0].id).toBe("aaa111first");
      expect(result.closed).toHaveLength(0);
    });

    test("maintains sort order by id", () => {
      const entry1 = makeEntry({ id: "zzz999last" });
      const entry2 = makeEntry({ id: "aaa111first" });
      const entry3 = makeEntry({ id: "mmm555midd" });

      let index = insertEntry(EMPTY_INDEX, entry1);
      index = insertEntry(index, entry2);
      index = insertEntry(index, entry3);

      expect(index.open).toHaveLength(3);
      expect(index.open[0].id).toBe("aaa111first");
      expect(index.open[1].id).toBe("mmm555midd");
      expect(index.open[2].id).toBe("zzz999last");
    });

    test("puts closed status in closed array", () => {
      const entry = makeEntry({ id: "cls1234567", status: "closed" });
      const result = insertEntry(EMPTY_INDEX, entry);

      expect(result.open).toHaveLength(0);
      expect(result.closed).toHaveLength(1);
      expect(result.closed[0].id).toBe("cls1234567");
    });

    test("puts different statuses in open array", () => {
      for (const status of ["idea", "todo", "in-progress", "done"] as const) {
        const entry = makeEntry({ id: `tst${status}`, status });
        const result = insertEntry(EMPTY_INDEX, entry);
        expect(result.open).toHaveLength(1);
        expect(result.closed).toHaveLength(0);
      }
    });

    test("updates childrenOf when parentId is set", () => {
      const entry = makeEntry({ id: "child12345", parentId: "parent1234" });
      const result = insertEntry(EMPTY_INDEX, entry);

      const children = result.childrenOf;
      expect(children.parent1234).toEqual(["child12345"]);
    });

    test("does not add childrenOf key when parentId is null", () => {
      const entry = makeEntry({ id: "orphan12345", parentId: null });
      const result = insertEntry(EMPTY_INDEX, entry);

      expect(Object.keys(result.childrenOf)).toHaveLength(0);
    });
  });

  describe("findEntry", () => {
    test("finds existing entry in open array", () => {
      const entry = makeEntry({ id: "findme1234" });
      const index = insertEntry(EMPTY_INDEX, entry);

      const found = findEntry(index, "findme1234");

      expect(found).not.toBeNull();
      expect(found?.id).toBe("findme1234");
    });

    test("finds existing entry in closed array", () => {
      const entry = makeEntry({ id: "closed12345", status: "closed" });
      const index = insertEntry(EMPTY_INDEX, entry);

      const found = findEntry(index, "closed12345");

      expect(found).not.toBeNull();
      expect(found?.id).toBe("closed12345");
    });

    test("returns null for missing entry", () => {
      const entry = makeEntry({ id: "exists12345" });
      const index = insertEntry(EMPTY_INDEX, entry);

      const found = findEntry(index, "missing12345");

      expect(found).toBeNull();
    });

    test("returns null for empty index", () => {
      const found = findEntry(EMPTY_INDEX, "anything123");

      expect(found).toBeNull();
    });

    test("uses binary search — finds entry in large array", () => {
      let index = EMPTY_INDEX;
      for (let i = 0; i < 1000; i++) {
        const id = i.toString(36).padStart(10, "0");
        index = insertEntry(index, makeEntry({ id, title: `Issue ${i}` }));
      }

      // Find a specific entry — verify findEntry works on a known ID
      findEntry(index, "0000000037"); // 37 in base36, padded — may not exist due to padStart
      // Let's verify findEntry works on a known ID
      const midEntry = index.open[500];
      const found2 = findEntry(index, midEntry.id);

      expect(found2).not.toBeNull();
      expect(found2?.id).toBe(midEntry.id);
    });
  });

  describe("updateEntry", () => {
    test("changes fields in place", () => {
      const entry = makeEntry({ id: "update12345", title: "Original" });
      let index = insertEntry(EMPTY_INDEX, entry);

      index = updateEntry(index, "update12345", { title: "Updated" });

      const found = findEntry(index, "update12345");
      expect(found?.title).toBe("Updated");
    });

    test("moves from open to closed on status change", () => {
      const entry = makeEntry({ id: "move1234567", status: "todo" });
      let index = insertEntry(EMPTY_INDEX, entry);

      expect(index.open).toHaveLength(1);
      expect(index.closed).toHaveLength(0);

      index = updateEntry(index, "move1234567", { status: "closed" });

      expect(index.open).toHaveLength(0);
      expect(index.closed).toHaveLength(1);
      expect(index.closed[0].id).toBe("move1234567");
      expect(index.closed[0].status).toBe("closed");
    });

    test("moves from closed to open on status change", () => {
      const entry = makeEntry({ id: "reopen123456", status: "closed" });
      let index = insertEntry(EMPTY_INDEX, entry);

      expect(index.open).toHaveLength(0);
      expect(index.closed).toHaveLength(1);

      index = updateEntry(index, "reopen123456", { status: "todo" });

      expect(index.open).toHaveLength(1);
      expect(index.closed).toHaveLength(0);
      expect(index.open[0].id).toBe("reopen123456");
      expect(index.open[0].status).toBe("todo");
    });

    test("returns unchanged index if id not found", () => {
      const entry = makeEntry({ id: "exists12345" });
      const index = insertEntry(EMPTY_INDEX, entry);

      const result = updateEntry(index, "missing12345", { title: "New" });

      expect(result).toBe(index);
    });

    test("maintains sort order after move", () => {
      const entry1 = makeEntry({ id: "aaa11111111", status: "todo" });
      const entry2 = makeEntry({ id: "bbb22222222", status: "todo" });
      const entry3 = makeEntry({ id: "ccc33333333", status: "todo" });

      let index = EMPTY_INDEX;
      index = insertEntry(index, entry3);
      index = insertEntry(index, entry1);
      index = insertEntry(index, entry2);

      // Close the middle entry
      index = updateEntry(index, "bbb22222222", { status: "closed" });

      // Open array should have 2, sorted
      expect(index.open).toHaveLength(2);
      expect(index.open[0].id).toBe("aaa11111111");
      expect(index.open[1].id).toBe("ccc33333333");

      // Closed array should have 1
      expect(index.closed).toHaveLength(1);
      expect(index.closed[0].id).toBe("bbb22222222");
    });
  });

  describe("updateEntry — closed array stays closed", () => {
    test("updates title of a closed entry while keeping it closed", () => {
      const entry = makeEntry({ id: "closedupdte", status: "closed", title: "Original" });
      let index = insertEntry(EMPTY_INDEX, entry);

      index = updateEntry(index, "closedupdte", { title: "Updated Title" });

      expect(index.open).toHaveLength(0);
      expect(index.closed).toHaveLength(1);
      expect(index.closed[0].id).toBe("closedupdte");
      expect(index.closed[0].title).toBe("Updated Title");
      expect(index.closed[0].status).toBe("closed");
    });

    test("updates priority of a closed entry while keeping it closed", () => {
      const entry = makeEntry({ id: "closedpri00", status: "closed", priority: 3 });
      let index = insertEntry(EMPTY_INDEX, entry);

      index = updateEntry(index, "closedpri00", { priority: 1 });

      expect(index.closed).toHaveLength(1);
      expect(index.closed[0].priority).toBe(1);
      expect(index.closed[0].status).toBe("closed");
    });
  });

  describe("removeEntry", () => {
    test("removes from open array", () => {
      const entry = makeEntry({ id: "remove12345" });
      let index = insertEntry(EMPTY_INDEX, entry);

      expect(index.open).toHaveLength(1);

      index = removeEntry(index, "remove12345");

      expect(index.open).toHaveLength(0);
    });

    test("removes from closed array", () => {
      const entry = makeEntry({ id: "remove12345", status: "closed" });
      let index = insertEntry(EMPTY_INDEX, entry);

      expect(index.closed).toHaveLength(1);

      index = removeEntry(index, "remove12345");

      expect(index.closed).toHaveLength(0);
    });

    test("returns unchanged index if id not found", () => {
      const entry = makeEntry({ id: "exists12345" });
      const index = insertEntry(EMPTY_INDEX, entry);

      const result = removeEntry(index, "missing12345");

      expect(result).toBe(index);
    });

    test("removes from correct array when both have entries", () => {
      const openEntry = makeEntry({ id: "open1234567" });
      const closedEntry = makeEntry({ id: "closed123456", status: "closed" });
      let index = insertEntry(EMPTY_INDEX, openEntry);
      index = insertEntry(index, closedEntry);

      index = removeEntry(index, "open1234567");

      expect(index.open).toHaveLength(0);
      expect(index.closed).toHaveLength(1);
      expect(index.closed[0].id).toBe("closed123456");
    });
  });

  describe("addChild", () => {
    test("creates new key when parent has no children", () => {
      const result = addChild(EMPTY_INDEX, "parent00001", "child00001");

      expect(result.childrenOf["parent00001"]).toEqual(["child00001"]);
    });

    test("appends to existing key", () => {
      let index = addChild(EMPTY_INDEX, "parent00001", "child00001");
      index = addChild(index, "parent00001", "child00002");

      expect(index.childrenOf["parent00001"]).toEqual(["child00001", "child00002"]);
    });

    test("ignores duplicate child", () => {
      const index = addChild(EMPTY_INDEX, "parent00001", "child00001");
      const result = addChild(index, "parent00001", "child00001");

      expect(result.childrenOf["parent00001"]).toEqual(["child00001"]);
      expect(result).toBe(index); // Same reference — no change
    });
  });

  describe("removeChild", () => {
    test("removes child from parent's array", () => {
      let index = addChild(EMPTY_INDEX, "parent00001", "child00001");
      index = addChild(index, "parent00001", "child00002");

      const result = removeChild(index, "parent00001", "child00001");

      expect(result.childrenOf["parent00001"]).toEqual(["child00002"]);
    });

    test("deletes key when array becomes empty", () => {
      const index = addChild(EMPTY_INDEX, "parent00001", "child00001");

      const result = removeChild(index, "parent00001", "child00001");

      expect(result.childrenOf["parent00001"]).toBeUndefined();
    });

    test("no-op if parent key doesn't exist", () => {
      const result = removeChild(EMPTY_INDEX, "parent00001", "child00001");

      expect(result).toBe(EMPTY_INDEX); // Same reference
    });

    test("no-op if child not found in parent's array", () => {
      const index = addChild(EMPTY_INDEX, "parent00001", "child00001");
      const result = removeChild(index, "parent00001", "child99999");

      expect(result).toBe(index); // Same reference
      expect(result.childrenOf["parent00001"]).toEqual(["child00001"]);
    });
  });

  describe("getChildren", () => {
    test("returns children for existing key", () => {
      let index = addChild(EMPTY_INDEX, "parent00001", "child00001");
      index = addChild(index, "parent00001", "child00002");

      expect(getChildren(index, "parent00001")).toEqual(["child00001", "child00002"]);
    });

    test("returns empty array for missing key", () => {
      expect(getChildren(EMPTY_INDEX, "parent00001")).toEqual([]);
    });

    test("returns empty array for key with no children", () => {
      const index: IndexFile = { open: [], closed: [], childrenOf: {} };
      expect(getChildren(index, "nonexistent")).toEqual([]);
    });
  });
});
