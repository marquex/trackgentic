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

      const createResult = JSON.parse(
        (await runCLI("create", "Child", "--parentId", "parent12345")).stdout.trim(),
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

      const regOutput = JSON.parse(
        (await runCLI("users", "register", "alice")).stdout.trim(),
      );
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
      const bobOutput = JSON.parse(
        (await runCLI("users", "register", "bob")).stdout.trim(),
      );

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
});
