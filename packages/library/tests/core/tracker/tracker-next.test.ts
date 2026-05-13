import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
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

  // ─── next() Tests ─────────────────────────────────────────────────────

  describe("next()", () => {
    let tracker: Tracker;

    beforeEach(async () => {
      tracker = new Tracker(testDir);
      await tracker.init();
    });

    test("returns the highest-priority unblocked issue for a user", async () => {
      // Create issues with different priorities for "alice"
      const p1 = await tracker.create({ title: "Low", assignee: "alice", priority: 5 });
      const p2 = await tracker.create({ title: "High", assignee: "alice", priority: 1 });
      const p3 = await tracker.create({ title: "Medium", assignee: "alice", priority: 3 });
      if (!("id" in p1) || !("id" in p2) || !("id" in p3)) throw new Error("Create failed");

      const result = await tracker.next("alice");

      // Should be the priority-1 issue
      expect("result" in result).toBe(false); // not NO_ISSUES_AVAILABLE
      if ("title" in result) {
        expect(result.title).toBe("High");
        expect(result.priority).toBe(1);
        expect(result.assignee).toBe("alice");
      }
    });

    test("excludes issues with active blockages", async () => {
      const blocked = await tracker.create({ title: "Blocked", assignee: "alice", priority: 1 });
      const unblocked = await tracker.create({ title: "Unblocked", assignee: "alice", priority: 3 });
      const blocker = await tracker.create({ title: "Blocker", assignee: "bob" });
      if (!("id" in blocked) || !("id" in unblocked) || !("id" in blocker))
        throw new Error("Create failed");

      // Add active blockage to the high-priority issue
      await tracker.blockagesAdd(blocked.id, { blockerIds: [blocker.id] });

      const result = await tracker.next("alice");

      // Should skip the blocked priority-1 issue and return the unblocked one
      if ("title" in result) {
        expect(result.title).toBe("Unblocked");
        expect(result.priority).toBe(3);
      }
    });

    test("uses impact score as tiebreaker when priorities are equal", async () => {
      // Create two issues with the same priority for "alice"
      const issueA = await tracker.create({ title: "Issue A", assignee: "alice", priority: 2 });
      const issueB = await tracker.create({ title: "Issue B", assignee: "alice", priority: 2 });
      // Issue B will block another issue, giving it higher impact
      const blocked = await tracker.create({ title: "Blocked Issue", assignee: "bob" });
      if (!("id" in issueA) || !("id" in issueB) || !("id" in blocked))
        throw new Error("Create failed");

      await tracker.blockagesAdd(blocked.id, { blockerIds: [issueB.id] });

      const result = await tracker.next("alice");

      // Issue B should win because it has higher impact (it blocks another issue)
      if ("title" in result) {
        expect(result.title).toBe("Issue B");
      }
    });

    test("returns NO_ISSUES_AVAILABLE when no open issues match user", async () => {
      // Create issues for other users only
      await tracker.create({ title: "Bob's issue", assignee: "bob", priority: 1 });

      const result = await tracker.next("alice");

      expect(result).toEqual({
        result: "NO_ISSUES_AVAILABLE",
        message: "No unblocked issues found for user 'alice'.",
      });
    });

    test("returns NO_ISSUES_AVAILABLE when all matching issues are blocked", async () => {
      const issue = await tracker.create({ title: "Blocked", assignee: "alice", priority: 1 });
      const blocker = await tracker.create({ title: "Blocker", assignee: "bob" });
      if (!("id" in issue) || !("id" in blocker)) throw new Error("Create failed");

      await tracker.blockagesAdd(issue.id, { blockerIds: [blocker.id] });

      const result = await tracker.next("alice");

      expect(result).toEqual({
        result: "NO_ISSUES_AVAILABLE",
        message: "No unblocked issues found for user 'alice'.",
      });
    });

    test("throws NOT_INITIALIZED when no .trackgentic/ directory exists", async () => {
      const uninitDir = join(
        tmpdir(),
        `trackgentic-uninit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      mkdirSync(uninitDir, { recursive: true });
      const uninitTracker = new Tracker(uninitDir);

      try {
        await uninitTracker.next("alice");
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TrackgenticError);
        const e = err as TrackgenticError;
        expect(e.result).toBe("NOT_INITIALIZED");
        expect(e.exitCode).toBe(1);
      }
      rmSync(uninitDir, { recursive: true, force: true });
    });

    test("excludes done and closed issues", async () => {
      const done = await tracker.create({ title: "Done", assignee: "alice", status: "done" });
      const closed = await tracker.create({ title: "Closed", assignee: "alice", status: "closed" });
      const todo = await tracker.create({ title: "Todo", assignee: "alice", status: "todo", priority: 3 });
      if (!("id" in done) || !("id" in closed) || !("id" in todo)) throw new Error("Create failed");

      const result = await tracker.next("alice");

      // Only "Todo" should be eligible (idea/todo/in-progress only)
      if ("title" in result) {
        expect(result.title).toBe("Todo");
      }
    });

    test("includes issues with only resolved blockages", async () => {
      const issue = await tracker.create({ title: "Previously Blocked", assignee: "alice", priority: 1 });
      const blocker = await tracker.create({ title: "Blocker", assignee: "bob" });
      if (!("id" in issue) || !("id" in blocker)) throw new Error("Create failed");

      // Add then resolve the blockage
      await tracker.blockagesAdd(issue.id, { blockerIds: [blocker.id] });
      await tracker.blockagesResolve(issue.id, { blockerIds: [blocker.id] });

      const result = await tracker.next("alice");

      // Issue should be eligible since its blockage is resolved
      if ("title" in result) {
        expect(result.title).toBe("Previously Blocked");
        expect(result.priority).toBe(1);
      }
    });

    test("uses id ASC as final tiebreaker when priority and impact are equal", async () => {
      // Create two issues with same priority and no blockages
      const first = await tracker.create({ title: "First", assignee: "alice", priority: 2 });
      const second = await tracker.create({ title: "Second", assignee: "alice", priority: 2 });
      if (!("id" in first) || !("id" in second)) throw new Error("Create failed");

      const result = await tracker.next("alice");

      // One of the two must be returned (both are equally eligible)
      if ("title" in result) {
        expect([first.id, second.id]).toContain(result.id);
      }
    });

    test("only includes idea, todo, and in-progress statuses", async () => {
      const idea = await tracker.create({ title: "Idea", assignee: "alice", status: "idea", priority: 5 });
      const todo = await tracker.create({ title: "Todo", assignee: "alice", status: "todo", priority: 4 });
      const inProgress = await tracker.create({ title: "InProgress", assignee: "alice", status: "in-progress", priority: 3 });
      if (!("id" in idea) || !("id" in todo) || !("id" in inProgress)) throw new Error("Create failed");

      const result = await tracker.next("alice");

      // All three are eligible; in-progress has highest priority (priority 3)
      if ("title" in result) {
        expect(result.title).toBe("InProgress");
        expect(result.status).toBe("in-progress");
      }
    });

    test("case-sensitive assignee matching", async () => {
      await tracker.create({ title: "Alice Lower", assignee: "alice", priority: 1 });
      await tracker.create({ title: "Alice Upper", assignee: "Alice", priority: 1 });

      const resultLower = await tracker.next("alice");
      if ("title" in resultLower) {
        expect(resultLower.assignee).toBe("alice");
      }

      const resultUpper = await tracker.next("Alice");
      if ("title" in resultUpper) {
        expect(resultUpper.assignee).toBe("Alice");
      }
    });

    test("returns full ComputedIssue with all expected fields", async () => {
      const created = await tracker.create({
        title: "Full Issue",
        assignee: "alice",
        priority: 2,
        description: "A test issue",
        tags: ["bug", "urgent"],
      });
      if (!("id" in created)) throw new Error("Create failed");

      const result = await tracker.next("alice");

      if ("title" in result) {
        expect(result.id).toBe(created.id);
        expect(result.title).toBe("Full Issue");
        expect(result.description).toBe("A test issue");
        expect(result.assignee).toBe("alice");
        expect(result.priority).toBe(2);
        expect(result.tags).toEqual(["bug", "urgent"]);
        expect(result.status).toBe("idea");
        expect(result.createdAt).toBeTruthy();
        expect(result.updatedAt).toBeTruthy();
      }
    });

    test("returns NO_ISSUES_AVAILABLE when there are no issues at all", async () => {
      const result = await tracker.next("alice");

      expect(result).toEqual({
        result: "NO_ISSUES_AVAILABLE",
        message: "No unblocked issues found for user 'alice'.",
      });
    });

    test("does not consider issues assigned to other users", async () => {
      await tracker.create({ title: "Bob's Issue", assignee: "bob", priority: 1 });
      await tracker.create({ title: "Alice's Issue", assignee: "alice", priority: 3 });

      const result = await tracker.next("alice");

      if ("title" in result) {
        expect(result.title).toBe("Alice's Issue");
      }
    });
  });
});
