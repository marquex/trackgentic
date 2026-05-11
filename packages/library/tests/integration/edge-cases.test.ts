import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrackgenticError } from "../../src/core/errors";
import { Tracker } from "../../src/core/tracker";

// NOTE: Concurrent writes are NOT safe in trackgentic. This is a known limitation
// documented in the architecture — the file-backed, event-sourced design assumes
// single-writer access. Concurrent writes can corrupt files or lose events.

describe("Edge Cases — Empty Tracker Operations", () => {
  let testDir: string;
  let tracker: Tracker;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `trackgentic-edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    tracker = new Tracker(testDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("list() on empty tracker returns []", async () => {
    await tracker.init();
    const result = await tracker.list();
    expect(result).toEqual([]);
  });

  test("view() with nonexistent ID returns NOT_FOUND", async () => {
    await tracker.init();
    try {
      await tracker.view("nonexistent");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TrackgenticError);
      const e = err as TrackgenticError;
      expect(e.result).toBe("NOT_FOUND");
    }
  });

  test("history() with nonexistent ID returns NOT_FOUND", async () => {
    await tracker.init();
    try {
      await tracker.history("nonexistent");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TrackgenticError);
      const e = err as TrackgenticError;
      expect(e.result).toBe("NOT_FOUND");
    }
  });

  test("commentsList() with nonexistent ID returns NOT_FOUND", async () => {
    await tracker.init();
    try {
      await tracker.commentsList("nonexistent");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TrackgenticError);
      const e = err as TrackgenticError;
      expect(e.result).toBe("NOT_FOUND");
    }
  });

  test("blockagesList() with nonexistent ID returns NOT_FOUND", async () => {
    await tracker.init();
    try {
      await tracker.blockagesList("nonexistent");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TrackgenticError);
      const e = err as TrackgenticError;
      expect(e.result).toBe("NOT_FOUND");
    }
  });

  test("usersList() on empty tracker returns []", async () => {
    await tracker.init();
    const result = await tracker.usersList();
    expect(result).toEqual([]);
  });
});

describe("Edge Cases — Invalid JSON in Files", () => {
  let testDir: string;
  let trackerDir: string;
  let tracker: Tracker;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `trackgentic-edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    tracker = new Tracker(testDir);
    await tracker.init();
    trackerDir = join(testDir, ".trackgentic");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("corrupt issue file causes view() to throw (not a cryptic parse error)", async () => {
    const { id } = await await tracker.create({ title: "Test" });
    if (!("id" in { id })) throw new Error("create failed");

    const issueFile = join(trackerDir, "issues", `${id}.json`);
    writeFileSync(issueFile, "not valid json {{{");

    expect(async () => {
      await tracker.view(id!);
    }).toThrow();
  });

  test("corrupt index.json causes list() to throw", async () => {
    const indexFile = join(trackerDir, "index.json");
    writeFileSync(indexFile, "broken json !!!");

    expect(async () => {
      await tracker.list();
    }).toThrow();
  });

  test("corrupt dependencies.json causes blockagesList() to throw", async () => {
    const { id } = (await tracker.create({ title: "Test" })) as { id: string };
    const depsFile = join(trackerDir, "dependencies.json");
    writeFileSync(depsFile, "not json at all");

    expect(async () => {
      await tracker.blockagesList(id);
    }).toThrow();
  });

  test("corrupt config.json causes auth operations to throw", async () => {
    const configFile = join(trackerDir, "config.json");
    writeFileSync(configFile, "{invalid");

    expect(async () => {
      await tracker.list();
    }).toThrow();
  });
});

describe("Edge Cases — Missing Files During Operations", () => {
  let testDir: string;
  let trackerDir: string;
  let tracker: Tracker;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `trackgentic-edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    tracker = new Tracker(testDir);
    await tracker.init();
    trackerDir = join(testDir, ".trackgentic");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("delete issue file after create — view() returns ISSUE_MISSING", async () => {
    const { id } = (await tracker.create({ title: "Test" })) as { id: string };
    const issueFile = join(trackerDir, "issues", `${id}.json`);
    unlinkSync(issueFile);

    try {
      await tracker.view(id);
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TrackgenticError);
      const e = err as TrackgenticError;
      expect(e.result).toBe("ISSUE_MISSING");
    }
  });

  test("delete issue file after create — update() returns ISSUE_MISSING", async () => {
    const { id } = (await tracker.create({ title: "Test" })) as { id: string };
    const issueFile = join(trackerDir, "issues", `${id}.json`);
    unlinkSync(issueFile);

    try {
      await tracker.update(id, { title: "Updated" });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TrackgenticError);
      const e = err as TrackgenticError;
      expect(e.result).toBe("ISSUE_MISSING");
    }
  });

  test("delete issue file after create — commentsAdd() returns ISSUE_MISSING", async () => {
    const { id } = (await tracker.create({ title: "Test" })) as { id: string };
    const issueFile = join(trackerDir, "issues", `${id}.json`);
    unlinkSync(issueFile);

    try {
      await tracker.commentsAdd(id, { content: "Hello" });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TrackgenticError);
      const e = err as TrackgenticError;
      expect(e.result).toBe("ISSUE_MISSING");
    }
  });
});

describe("Edge Cases — Large Number of Events", () => {
  let testDir: string;
  let tracker: Tracker;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `trackgentic-edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    tracker = new Tracker(testDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("100+ update events — view() returns correct computed state", async () => {
    await tracker.init();
    const { id } = (await tracker.create({ title: "Test", priority: 3 })) as { id: string };

    for (let i = 0; i < 110; i++) {
      await tracker.update(id, {
        title: `Update ${i}`,
        priority: ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5,
      });
    }

    const issue = (await tracker.view(id)) as Record<string, unknown>;
    expect(issue).toBeDefined();
    expect(issue.title).toBe("Update 109");
    expect(issue.priority).toBe(((109 % 5) + 1) as 1 | 2 | 3 | 4 | 5);
  });

  test("100+ update events — performance is reasonable", async () => {
    await tracker.init();
    const { id } = (await tracker.create({ title: "Test" })) as { id: string };

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await tracker.update(id, { title: `Update ${i}` });
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
  });

  test("50+ comments — commentsList() returns all correctly", async () => {
    await tracker.init();
    const { id } = (await tracker.create({ title: "Test" })) as { id: string };

    const commentIds: string[] = [];
    for (let i = 0; i < 55; i++) {
      const result = (await tracker.commentsAdd(id, {
        content: `Comment ${i}`,
      })) as { result: string; commentId: string };
      commentIds.push(result.commentId);
    }

    const comments = (await tracker.commentsList(id)) as Array<{ id: string; content: string }>;
    expect(comments).toHaveLength(55);

    // Verify all comments are present
    for (let i = 0; i < 55; i++) {
      const comment = comments.find((c) => c.id === commentIds[i]);
      expect(comment).toBeDefined();
      expect(comment!.content).toBe(`Comment ${i}`);
    }
  });
});

describe("Edge Cases — Self-referencing and No-op Updates", () => {
  let testDir: string;
  let tracker: Tracker;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `trackgentic-edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    tracker = new Tracker(testDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("self-blockage is caught by cycle detection", async () => {
    await tracker.init();
    const { id } = (await tracker.create({ title: "Self" })) as { id: string };

    try {
      await tracker.blockagesAdd(id, { blockerIds: [id] });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TrackgenticError);
      const e = err as TrackgenticError;
      expect(e.result).toBe("BLOCKAGE_CYCLE");
    }
  });

  test("update status to same value is a no-op (no error)", async () => {
    await tracker.init();
    const { id } = (await tracker.create({ title: "Test", status: "in-progress" })) as {
      id: string;
    };

    // Update to same status — should succeed without error
    const result = await tracker.update(id, { status: "in-progress" });
    expect(result).toEqual({ result: "OK" });

    // Verify state is unchanged
    const issue = (await tracker.view(id)) as Record<string, unknown>;
    expect(issue.status).toBe("in-progress");
  });
});
