import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
