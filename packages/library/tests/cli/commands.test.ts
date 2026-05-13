import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "bun";

const BIN_PATH = join(import.meta.dir, "..", "..", "src", "bin.ts");

describe("CLI commands", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `trackgentic-cli-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  async function runCLI(
    ...args: string[]
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return runCLIWithEnv({}, ...args);
  }

  async function runCLIWithEnv(
    env: Record<string, string>,
    ...args: string[]
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = spawn({
      cmd: ["bun", "run", BIN_PATH, ...args],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...env },
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    return { stdout, stderr, exitCode };
  }

  describe("init", () => {
    test("trackgentic init prints correct JSON to stdout", async () => {
      const { stdout, stderr, exitCode } = await runCLI("init");

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const result = JSON.parse(stdout.trim());
      expect(result.result).toBe("OK");
      expect(result.path).toContain(".trackgentic");
    });

    test("trackgentic init when already initialized prints ALREADY_INITIALIZED", async () => {
      await runCLI("init");
      const { stdout, exitCode } = await runCLI("init");

      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout.trim());
      expect(result.result).toBe("ALREADY_INITIALIZED");
      expect(result.path).toContain(".trackgentic");
    });
  });

  describe("create", () => {
    test("creates an issue and prints id to stdout", async () => {
      await runCLI("init");

      const { stdout, stderr, exitCode } = await runCLI("create", "My Issue");

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const result = JSON.parse(stdout.trim());
      expect(result.id).toBeDefined();
      expect(result.id).toHaveLength(10);
    });

    test("creates with all flags", async () => {
      await runCLI("init");

      const { stdout, exitCode } = await runCLI(
        "create",
        "Full Issue",
        "--description",
        "A description",
        "--assignee",
        "alice",
        "--tags",
        "bug,urgent",
        "--status",
        "todo",
        "--priority",
        "1",
      );

      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout.trim());
      expect(result.id).toHaveLength(10);
    });

    test("prints error when not initialized", async () => {
      const { stdout, stderr, exitCode } = await runCLI("create", "Test");

      expect(exitCode).toBe(1);
      expect(stdout).toBe("");

      const result = JSON.parse(stderr.trim());
      expect(result.result).toBe("NOT_INITIALIZED");
    });

    test("creates with --parentId flag", async () => {
      await runCLI("init");

      // Create parent first
      const parentResult = JSON.parse((await runCLI("create", "Parent")).stdout.trim());
      const parentId = parentResult.id;

      const { stdout, stderr, exitCode } = await runCLI(
        "create",
        "Child Issue",
        "--parentId",
        parentId,
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const result = JSON.parse(stdout.trim());
      expect(result.id).toHaveLength(10);

      // Verify child has parentId via view
      const viewResult = JSON.parse((await runCLI("view", result.id)).stdout.trim());
      expect(viewResult.parentId).toBe(parentId);
    });

    test("create with --parentId to closed parent prints HIERARCHY_CONSTRAINT", async () => {
      await runCLI("init");

      // Create closed parent
      const parentResult = JSON.parse(
        (await runCLI("create", "Parent", "--status", "closed")).stdout.trim(),
      );
      const parentId = parentResult.id;

      const { stderr, exitCode } = await runCLI("create", "Child", "--parentId", parentId);

      expect(exitCode).toBe(12);

      const result = JSON.parse(stderr.trim());
      expect(result.result).toBe("HIERARCHY_CONSTRAINT");
    });
  });

  describe("list", () => {
    test("lists issues as JSON array", async () => {
      await runCLI("init");
      await runCLI("create", "Issue 1");
      await runCLI("create", "Issue 2");

      const { stdout, stderr, exitCode } = await runCLI("list");

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const result = JSON.parse(stdout.trim());
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
    });

    test("filters by status", async () => {
      await runCLI("init");
      await runCLI("create", "Open Issue");
      await runCLI("create", "Closed Issue", "--status", "closed");

      const { stdout, exitCode } = await runCLI("list", "--status", "open");

      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout.trim());
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Open Issue");
    });

    test("prints NOT_INITIALIZED error when no .trackgentic/ exists", async () => {
      const { stderr, exitCode } = await runCLI("list");

      expect(exitCode).toBe(1);

      const result = JSON.parse(stderr.trim());
      expect(result.result).toBe("NOT_INITIALIZED");
    });
  });

  describe("view", () => {
    test("views an issue with full computed state", async () => {
      await runCLI("init");

      const createResult = JSON.parse((await runCLI("create", "View Test")).stdout.trim());
      const issueId = createResult.id;

      const { stdout, stderr, exitCode } = await runCLI("view", issueId);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const result = JSON.parse(stdout.trim());
      expect(result.id).toBe(issueId);
      expect(result.title).toBe("View Test");
      expect(result.status).toBe("idea");
      expect(result.createdAt).toBeTruthy();
      expect(result.updatedAt).toBeTruthy();
    });

    test("prints NOT_FOUND error for non-existent id", async () => {
      await runCLI("init");

      const { stderr, exitCode } = await runCLI("view", "missing12345");

      expect(exitCode).toBe(5);

      const result = JSON.parse(stderr.trim());
      expect(result.result).toBe("NOT_FOUND");
    });

    test("prints ISSUE_MISSING error when file is deleted", async () => {
      await runCLI("init");

      const createResult = JSON.parse((await runCLI("create", "Will Be Deleted")).stdout.trim());
      const issueId = createResult.id;

      // Delete the issue file to trigger ISSUE_MISSING
      const issuePath = join(testDir, ".trackgentic", "issues", `${issueId}.json`);
      unlinkSync(issuePath);

      const { stderr, exitCode } = await runCLI("view", issueId);

      expect(exitCode).toBe(6);

      const result = JSON.parse(stderr.trim());
      expect(result.result).toBe("ISSUE_MISSING");
      expect(result.message).toBeTruthy();
    });
  });

  describe("update", () => {
    test("updates an issue and prints OK", async () => {
      await runCLI("init");

      const createResult = JSON.parse((await runCLI("create", "Original")).stdout.trim());
      const issueId = createResult.id;

      const { stdout, stderr, exitCode } = await runCLI(
        "update",
        issueId,
        "--title",
        "Updated",
        "--status",
        "done",
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const result = JSON.parse(stdout.trim());
      expect(result.result).toBe("OK");

      // Verify via view
      const viewResult = JSON.parse((await runCLI("view", issueId)).stdout.trim());
      expect(viewResult.title).toBe("Updated");
      expect(viewResult.status).toBe("done");
    });

    test("prints INVALID_PARAMS when no flags provided", async () => {
      await runCLI("init");

      const createResult = JSON.parse((await runCLI("create", "Test")).stdout.trim());
      const issueId = createResult.id;

      const { stderr, exitCode } = await runCLI("update", issueId);

      expect(exitCode).toBe(10);

      const result = JSON.parse(stderr.trim());
      expect(result.result).toBe("INVALID_PARAMS");
    });

    test("prints NOT_FOUND error for non-existent id", async () => {
      await runCLI("init");

      const { stderr, exitCode } = await runCLI("update", "missing12345", "--title", "New");

      expect(exitCode).toBe(5);

      const result = JSON.parse(stderr.trim());
      expect(result.result).toBe("NOT_FOUND");
    });

    test("clears parentId with 'null' string", async () => {
      await runCLI("init");

      // Create parent first (hierarchy validation requires parent to exist)
      const parentResult = JSON.parse((await runCLI("create", "Parent")).stdout.trim());
      const parentId = parentResult.id;

      const createResult = JSON.parse(
        (await runCLI("create", "Child", "--parentId", parentId)).stdout.trim(),
      );
      const issueId = createResult.id;

      const { exitCode } = await runCLI("update", issueId, "--parentId", "null");

      expect(exitCode).toBe(0);

      const viewResult = JSON.parse((await runCLI("view", issueId)).stdout.trim());
      expect(viewResult.parentId).toBeNull();
    });
  });

  describe("history", () => {
    test("returns raw event array", async () => {
      await runCLI("init");

      const createResult = JSON.parse((await runCLI("create", "History Test")).stdout.trim());
      const issueId = createResult.id;

      const { stdout, stderr, exitCode } = await runCLI("history", issueId);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const result = JSON.parse(stdout.trim());
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe("creation");
      expect(result[1].type).toBe("update");
    });

    test("shows events after update", async () => {
      await runCLI("init");

      const createResult = JSON.parse((await runCLI("create", "Test")).stdout.trim());
      const issueId = createResult.id;

      await runCLI("update", issueId, "--title", "Updated");

      const { stdout, exitCode } = await runCLI("history", issueId);

      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout.trim());
      expect(result).toHaveLength(3);
      expect(result[2].type).toBe("update");
    });

    test("prints NOT_FOUND error for non-existent id", async () => {
      await runCLI("init");

      const { stderr, exitCode } = await runCLI("history", "missing12345");

      expect(exitCode).toBe(5);

      const result = JSON.parse(stderr.trim());
      expect(result.result).toBe("NOT_FOUND");
    });

    test("prints ISSUE_MISSING error when file is deleted", async () => {
      await runCLI("init");

      const createResult = JSON.parse((await runCLI("create", "History Gone")).stdout.trim());
      const issueId = createResult.id;

      const issuePath = join(testDir, ".trackgentic", "issues", `${issueId}.json`);
      unlinkSync(issuePath);

      const { stderr, exitCode } = await runCLI("history", issueId);

      expect(exitCode).toBe(6);

      const result = JSON.parse(stderr.trim());
      expect(result.result).toBe("ISSUE_MISSING");
    });
  });

  // ─── Users CLI Tests ────────────────────────────────────────────

  describe("users register", () => {
    test("creates a user and returns token", async () => {
      await runCLI("init");

      const { stdout, stderr, exitCode } = await runCLI("users", "register", "Alice");

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const result = JSON.parse(stdout.trim());
      expect(result.result).toBe("OK");
      expect(result.name).toBe("alice");
      expect(result.token).toMatch(/^tk_[a-z0-9]{8}$/);
    });

    test("rejects duplicate name", async () => {
      await runCLI("init");
      await runCLI("users", "register", "alice");

      const { stdout } = await runCLI("users", "register", "alice");

      const result = JSON.parse(stdout.trim());
      expect(result.result).toBe("USER_ALREADY_EXISTS");
    });

    test('rejects "anonymous" as reserved name', async () => {
      await runCLI("init");

      const { stdout } = await runCLI("users", "register", "anonymous");

      const result = JSON.parse(stdout.trim());
      expect(result.result).toBe("USER_ALREADY_EXISTS");
    });
  });

  describe("users list", () => {
    test("shows registered users without tokens", async () => {
      await runCLI("init");
      await runCLI("users", "register", "alice");
      await runCLI("users", "register", "bob");

      const { stdout, stderr, exitCode } = await runCLI("users", "list");

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const result = JSON.parse(stdout.trim());
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("alice");
      expect(result[1].name).toBe("bob");
      // Tokens must not be present
      for (const user of result) {
        expect("token" in user).toBe(false);
        expect(user.registeredAt).toBeTruthy();
      }
    });
  });

  describe("users revoke", () => {
    test("removes a user", async () => {
      await runCLI("init");
      await runCLI("users", "register", "alice");

      const { stdout, stderr, exitCode } = await runCLI("users", "revoke", "alice");

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const result = JSON.parse(stdout.trim());
      expect(result.result).toBe("OK");

      // Verify user is gone
      const listOutput = JSON.parse((await runCLI("users", "list")).stdout.trim());
      expect(listOutput).toHaveLength(0);
    });

    test("rejects non-existent user", async () => {
      await runCLI("init");

      const { stderr, exitCode } = await runCLI("users", "revoke", "nonexistent");

      expect(exitCode).toBe(1);

      const result = JSON.parse(stderr.trim());
      expect(result.result).toBe("USER_NOT_FOUND");
    });
  });

  describe("users regenerate", () => {
    test("issues new token with own token via env var", async () => {
      await runCLI("init");

      const regOutput = JSON.parse((await runCLI("users", "register", "alice")).stdout.trim());
      const oldToken = regOutput.token;

      const { stdout, stderr, exitCode } = await runCLIWithEnv(
        { TRACKGENTIC_USER_TOKEN: oldToken },
        "users",
        "regenerate",
        "alice",
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const result = JSON.parse(stdout.trim());
      expect(result.result).toBe("OK");
      expect(result.name).toBe("alice");
      expect(result.token).toMatch(/^tk_[a-z0-9]{8}$/);
      expect(result.token).not.toBe(oldToken);
    });

    test("rejects when different user tries to regenerate", async () => {
      await runCLI("init");
      await runCLI("users", "register", "alice");
      const bobOutput = JSON.parse((await runCLI("users", "register", "bob")).stdout.trim());

      const { stderr, exitCode } = await runCLIWithEnv(
        { TRACKGENTIC_USER_TOKEN: bobOutput.token },
        "users",
        "regenerate",
        "alice",
      );

      expect(exitCode).toBe(3);

      const result = JSON.parse(stderr.trim());
      expect(result.result).toBe("INVALID_TOKEN");
    });
  });

  // ─── Comments CLI Tests ─────────────────────────────────────────

  describe("comments add", () => {
    test("adds a comment and returns OK with commentId", async () => {
      await runCLI("init");
      const createResult = JSON.parse((await runCLI("create", "Test Issue")).stdout.trim());
      const issueId = createResult.id;

      const { stdout, stderr, exitCode } = await runCLI(
        "comments",
        "add",
        issueId,
        "--content",
        "Hello world",
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const result = JSON.parse(stdout.trim());
      expect(result.result).toBe("OK");
      expect(result.commentId).toHaveLength(10);
    });
  });

  describe("comments update", () => {
    test("updates a comment and returns OK", async () => {
      await runCLI("init");
      const createResult = JSON.parse((await runCLI("create", "Test Issue")).stdout.trim());
      const issueId = createResult.id;

      const addResult = JSON.parse(
        (await runCLI("comments", "add", issueId, "--content", "Original")).stdout.trim(),
      );
      const commentId = addResult.commentId;

      const { stdout, stderr, exitCode } = await runCLI(
        "comments",
        "update",
        issueId,
        commentId,
        "--content",
        "Updated",
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const result = JSON.parse(stdout.trim());
      expect(result.result).toBe("OK");
    });
  });

  describe("comments delete", () => {
    test("deletes a comment and returns OK", async () => {
      await runCLI("init");
      const createResult = JSON.parse((await runCLI("create", "Test Issue")).stdout.trim());
      const issueId = createResult.id;

      const addResult = JSON.parse(
        (await runCLI("comments", "add", issueId, "--content", "To delete")).stdout.trim(),
      );
      const commentId = addResult.commentId;

      const { stdout, stderr, exitCode } = await runCLI("comments", "delete", issueId, commentId);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const result = JSON.parse(stdout.trim());
      expect(result.result).toBe("OK");
    });
  });

  describe("comments list", () => {
    test("returns comment array", async () => {
      await runCLI("init");
      const createResult = JSON.parse((await runCLI("create", "Test Issue")).stdout.trim());
      const issueId = createResult.id;

      await runCLI("comments", "add", issueId, "--content", "First");
      await runCLI("comments", "add", issueId, "--content", "Second");

      const { stdout, stderr, exitCode } = await runCLI("comments", "list", issueId);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const result = JSON.parse(stdout.trim());
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
      expect(result[0].content).toBe("First");
      expect(result[1].content).toBe("Second");
      // Verify computed comment fields
      expect(result[0].id).toHaveLength(10);
      expect(result[0].author).toBe("anonymous");
      expect(result[0].timestamp).toBeTruthy();
      expect(result[0].editedAt).toBeNull();
    });
  });

  describe("comments error paths", () => {
    test("comments add on non-existent issue prints NOT_FOUND", async () => {
      await runCLI("init");

      const { stderr, exitCode } = await runCLI(
        "comments",
        "add",
        "missing12345",
        "--content",
        "Hello",
      );

      expect(exitCode).toBe(5);

      const result = JSON.parse(stderr.trim());
      expect(result.result).toBe("NOT_FOUND");
    });

    test("comments update on non-existent comment prints COMMENT_NOT_FOUND", async () => {
      await runCLI("init");
      const createResult = JSON.parse((await runCLI("create", "Test Issue")).stdout.trim());
      const issueId = createResult.id;

      const { stderr, exitCode } = await runCLI(
        "comments",
        "update",
        issueId,
        "fake000000",
        "--content",
        "Updated",
      );

      expect(exitCode).toBe(7);

      const result = JSON.parse(stderr.trim());
      expect(result.result).toBe("COMMENT_NOT_FOUND");
    });

    test("comments delete on non-existent comment prints COMMENT_NOT_FOUND", async () => {
      await runCLI("init");
      const createResult = JSON.parse((await runCLI("create", "Test Issue")).stdout.trim());
      const issueId = createResult.id;

      const { stderr, exitCode } = await runCLI("comments", "delete", issueId, "fake000000");

      expect(exitCode).toBe(7);

      const result = JSON.parse(stderr.trim());
      expect(result.result).toBe("COMMENT_NOT_FOUND");
    });

    test("comments list on non-existent issue prints NOT_FOUND", async () => {
      await runCLI("init");

      const { stderr, exitCode } = await runCLI("comments", "list", "missing12345");

      expect(exitCode).toBe(5);

      const result = JSON.parse(stderr.trim());
      expect(result.result).toBe("NOT_FOUND");
    });

    test("comments add when not initialized prints NOT_INITIALIZED", async () => {
      const { stdout, stderr, exitCode } = await runCLI(
        "comments",
        "add",
        "missing12345",
        "--content",
        "Hello",
      );

      expect(exitCode).toBe(1);
      expect(stdout).toBe("");

      const result = JSON.parse(stderr.trim());
      expect(result.result).toBe("NOT_INITIALIZED");
    });
  });

  // ─── Blockages CLI Tests ──────────────────────────────────────────

  describe("blockages add", () => {
    test("adds a blockage and returns OK", async () => {
      await runCLI("init");
      const blocked = JSON.parse((await runCLI("create", "Blocked")).stdout.trim());
      const blocker = JSON.parse((await runCLI("create", "Blocker")).stdout.trim());

      const { stdout, stderr, exitCode } = await runCLI(
        "blockages",
        "add",
        blocked.id,
        "--by",
        blocker.id,
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const result = JSON.parse(stdout.trim());
      expect(result.result).toBe("OK");
    });

    test("adds multiple blockers at once", async () => {
      await runCLI("init");
      const blocked = JSON.parse((await runCLI("create", "Blocked")).stdout.trim());
      const blocker1 = JSON.parse((await runCLI("create", "Blocker 1")).stdout.trim());
      const blocker2 = JSON.parse((await runCLI("create", "Blocker 2")).stdout.trim());

      const { stdout, stderr, exitCode } = await runCLI(
        "blockages",
        "add",
        blocked.id,
        "--by",
        blocker1.id,
        blocker2.id,
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const result = JSON.parse(stdout.trim());
      expect(result.result).toBe("OK");
    });

    test("with cycle → BLOCKAGE_CYCLE error JSON on stderr", async () => {
      await runCLI("init");
      const a = JSON.parse((await runCLI("create", "A")).stdout.trim());
      const b = JSON.parse((await runCLI("create", "B")).stdout.trim());

      // A blocked by B
      await runCLI("blockages", "add", a.id, "--by", b.id);

      // Try B blocked by A → cycle
      const { stderr, exitCode } = await runCLI("blockages", "add", b.id, "--by", a.id);

      expect(exitCode).toBe(11);

      const result = JSON.parse(stderr.trim());
      expect(result.result).toBe("BLOCKAGE_CYCLE");
    });

    test("on non-existent issue → NOT_FOUND error", async () => {
      await runCLI("init");
      await runCLI("create", "Blocker");

      const blocker = JSON.parse((await runCLI("create", "Blocker")).stdout.trim());

      const { stderr, exitCode } = await runCLI(
        "blockages",
        "add",
        "missing12345",
        "--by",
        blocker.id,
      );

      expect(exitCode).toBe(5);

      const result = JSON.parse(stderr.trim());
      expect(result.result).toBe("NOT_FOUND");
    });
  });

  describe("blockages resolve", () => {
    test("resolves a blockage and returns OK", async () => {
      await runCLI("init");
      const blocked = JSON.parse((await runCLI("create", "Blocked")).stdout.trim());
      const blocker = JSON.parse((await runCLI("create", "Blocker")).stdout.trim());

      await runCLI("blockages", "add", blocked.id, "--by", blocker.id);

      const { stdout, stderr, exitCode } = await runCLI(
        "blockages",
        "resolve",
        blocked.id,
        "--by",
        blocker.id,
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const result = JSON.parse(stdout.trim());
      expect(result.result).toBe("OK");
    });
  });

  describe("blockages delete", () => {
    test("deletes a blockage and returns OK", async () => {
      await runCLI("init");
      const blocked = JSON.parse((await runCLI("create", "Blocked")).stdout.trim());
      const blocker = JSON.parse((await runCLI("create", "Blocker")).stdout.trim());

      await runCLI("blockages", "add", blocked.id, "--by", blocker.id);

      const { stdout, stderr, exitCode } = await runCLI(
        "blockages",
        "delete",
        blocked.id,
        "--by",
        blocker.id,
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const result = JSON.parse(stdout.trim());
      expect(result.result).toBe("OK");
    });
  });

  describe("blockages list", () => {
    test("returns correct blockage info JSON", async () => {
      await runCLI("init");
      const blocked = JSON.parse((await runCLI("create", "Blocked")).stdout.trim());
      const blocker = JSON.parse((await runCLI("create", "Blocker")).stdout.trim());

      await runCLI("blockages", "add", blocked.id, "--by", blocker.id);

      const { stdout, stderr, exitCode } = await runCLI("blockages", "list", blocked.id);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const result = JSON.parse(stdout.trim());
      expect(result.issueId).toBe(blocked.id);
      expect(result.blockedBy).toHaveLength(1);
      expect(result.blockedBy[0].blockerId).toBe(blocker.id);
      expect(result.blockedBy[0].blockedId).toBe(blocked.id);
      expect(result.blockedBy[0].status).toBe("active");
      expect(result.blocks).toHaveLength(0);
    });

    test("returns empty arrays for issue with no blockages", async () => {
      await runCLI("init");
      const issue = JSON.parse((await runCLI("create", "Standalone")).stdout.trim());

      const { stdout, exitCode } = await runCLI("blockages", "list", issue.id);

      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout.trim());
      expect(result.blockedBy).toEqual([]);
      expect(result.blocks).toEqual([]);
    });

    test("on non-existent issue → NOT_FOUND error", async () => {
      await runCLI("init");

      const { stderr, exitCode } = await runCLI("blockages", "list", "missing12345");

      expect(exitCode).toBe(5);

      const result = JSON.parse(stderr.trim());
      expect(result.result).toBe("NOT_FOUND");
    });
  });

  // ─── Next CLI Tests ────────────────────────────────────────────────

  describe("next", () => {
    test("returns the best issue for a user", async () => {
      await runCLI("init");
      await runCLI("create", "Low Priority", "--assignee", "alice", "--priority", "5");
      await runCLI("create", "High Priority", "--assignee", "alice", "--priority", "1");
      await runCLI("create", "Medium Priority", "--assignee", "alice", "--priority", "3");

      const { stdout, stderr, exitCode } = await runCLI("next", "alice");

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const result = JSON.parse(stdout.trim());
      expect(result.title).toBe("High Priority");
      expect(result.assignee).toBe("alice");
      expect(result.priority).toBe(1);
    });

    test("excludes blocked issues", async () => {
      await runCLI("init");

      const blocked = JSON.parse(
        (await runCLI("create", "Blocked", "--assignee", "alice", "--priority", "1")).stdout.trim(),
      );
      await runCLI("create", "Unblocked", "--assignee", "alice", "--priority", "3");
      const blocker = JSON.parse((await runCLI("create", "Blocker")).stdout.trim());

      await runCLI("blockages", "add", blocked.id, "--by", blocker.id);

      const { stdout, exitCode } = await runCLI("next", "alice");

      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout.trim());
      expect(result.title).toBe("Unblocked");
    });

    test("returns NO_ISSUES_AVAILABLE when no matching issues", async () => {
      await runCLI("init");
      await runCLI("create", "Bob's Issue", "--assignee", "bob", "--priority", "1");

      const { stdout, exitCode } = await runCLI("next", "alice");

      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout.trim());
      expect(result.result).toBe("NO_ISSUES_AVAILABLE");
      expect(result.message).toContain("alice");
    });

    test("prints NOT_INITIALIZED error when no .trackgentic/ exists", async () => {
      const { stderr, exitCode } = await runCLI("next", "alice");

      expect(exitCode).toBe(1);

      const result = JSON.parse(stderr.trim());
      expect(result.result).toBe("NOT_INITIALIZED");
    });

    test("excludes done and closed issues", async () => {
      await runCLI("init");
      await runCLI("create", "Done Issue", "--assignee", "alice", "--status", "done");
      await runCLI("create", "Closed Issue", "--assignee", "alice", "--status", "closed");
      await runCLI("create", "Todo Issue", "--assignee", "alice", "--status", "todo", "--priority", "3");

      const { stdout, exitCode } = await runCLI("next", "alice");

      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout.trim());
      expect(result.title).toBe("Todo Issue");
    });

    test("resolved blockage treated as unblocked", async () => {
      await runCLI("init");

      const issue = JSON.parse(
        (await runCLI("create", "Previously Blocked", "--assignee", "alice", "--priority", "1"))
          .stdout.trim(),
      );
      const blocker = JSON.parse((await runCLI("create", "Blocker")).stdout.trim());

      await runCLI("blockages", "add", issue.id, "--by", blocker.id);
      await runCLI("blockages", "resolve", issue.id, "--by", blocker.id);

      const { stdout, exitCode } = await runCLI("next", "alice");

      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout.trim());
      expect(result.title).toBe("Previously Blocked");
    });
  });
});
