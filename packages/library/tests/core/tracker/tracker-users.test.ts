import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  // ─── User Management Tests ───────────────────────────────────────

  describe("user management", () => {
    let tracker: Tracker;
    let savedToken: string | undefined;

    beforeEach(async () => {
      savedToken = process.env.TRACKGENTIC_USER_TOKEN;
      delete process.env.TRACKGENTIC_USER_TOKEN;
      tracker = new Tracker(testDir);
      await tracker.init();
    });

    afterEach(() => {
      if (savedToken !== undefined) {
        process.env.TRACKGENTIC_USER_TOKEN = savedToken;
      } else {
        delete process.env.TRACKGENTIC_USER_TOKEN;
      }
    });

    describe("usersRegister", () => {
      test("creates user and returns token with lowercased name", async () => {
        const result = await tracker.usersRegister("Alice");

        expect(result.result).toBe("OK");
        if (result.result === "OK") {
          expect(result.name).toBe("alice");
          expect(result.token).toMatch(/^tk_[a-z0-9]{8}$/);
        }
      });

      test("rejects duplicate name with USER_ALREADY_EXISTS", async () => {
        await tracker.usersRegister("alice");
        const result = await tracker.usersRegister("alice");

        expect(result.result).toBe("USER_ALREADY_EXISTS");
        if (result.result === "USER_ALREADY_EXISTS") {
          expect(result.message).toContain("alice");
        }
      });

      test('rejects "anonymous" as reserved name', async () => {
        const result = await tracker.usersRegister("anonymous");

        expect(result.result).toBe("USER_ALREADY_EXISTS");
        if (result.result === "USER_ALREADY_EXISTS") {
          expect(result.message).toContain("anonymous");
        }
      });

      test("persists user to users.json", async () => {
        await tracker.usersRegister("alice");

        const usersData = JSON.parse(
          readFileSync(join(testDir, ".trackgentic", "users.json"), "utf-8"),
        );
        expect(usersData.users).toHaveLength(1);
        expect(usersData.users[0].name).toBe("alice");
        expect(usersData.users[0].token).toMatch(/^tk_[a-z0-9]{8}$/);
        expect(usersData.users[0].registeredAt).toBeTruthy();
      });

      test("rejects duplicate regardless of casing", async () => {
        await tracker.usersRegister("Alice");
        const result = await tracker.usersRegister("ALICE");

        expect(result.result).toBe("USER_ALREADY_EXISTS");
      });
    });

    describe("usersList", () => {
      test("returns users without tokens", async () => {
        await tracker.usersRegister("alice");
        await tracker.usersRegister("bob");

        const result = await tracker.usersList();
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
          name: "alice",
          registeredAt: expect.any(String),
        });
        expect(result[1]).toEqual({
          name: "bob",
          registeredAt: expect.any(String),
        });
        // Tokens must NOT be included
        for (const user of result) {
          expect("token" in user).toBe(false);
        }
      });

      test("returns empty array when no users registered", async () => {
        const result = await tracker.usersList();
        expect(result).toEqual([]);
      });
    });

    describe("usersRevoke", () => {
      test("removes a user", async () => {
        await tracker.usersRegister("alice");
        const result = await tracker.usersRevoke("alice");

        expect(result).toEqual({ result: "OK" });

        // Verify user is actually removed
        const listResult = await tracker.usersList();
        expect(listResult).toHaveLength(0);
      });

      test("rejects with USER_NOT_FOUND for non-existent user", async () => {
        const result = await tracker.usersRevoke("nonexistent");

        expect(result.result).toBe("USER_NOT_FOUND");
        if (result.result === "USER_NOT_FOUND") {
          expect(result.message).toContain("nonexistent");
        }
      });

      test("name matching is case-insensitive", async () => {
        await tracker.usersRegister("Alice");
        const result = await tracker.usersRevoke("alice");

        expect(result).toEqual({ result: "OK" });
      });
    });

    describe("usersRegenerate", () => {
      test("generates new token for self", async () => {
        const regResult = await tracker.usersRegister("alice");
        if (regResult.result !== "OK") throw new Error("Register failed");
        const oldToken = regResult.token;

        // Set env var so resolveAuthor identifies caller as alice
        process.env.TRACKGENTIC_USER_TOKEN = oldToken;

        const result = await tracker.usersRegenerate("alice");
        if (result.result === "OK") {
          expect(result.token).not.toBe(oldToken);
          expect(result.token).toMatch(/^tk_[a-z0-9]{8}$/);
          expect(result.name).toBe("alice");
        } else {
          expect.unreachable("Expected OK result");
        }
      });

      test("rejects when caller is not the target user (self-service only)", async () => {
        const aliceResult = await tracker.usersRegister("alice");
        await tracker.usersRegister("bob");
        if (aliceResult.result !== "OK") throw new Error("Register failed");

        // Alice tries to regenerate bob's token
        process.env.TRACKGENTIC_USER_TOKEN = aliceResult.token;
        const result = await tracker.usersRegenerate("bob");

        expect(result.result).toBe("INVALID_TOKEN");
        if (result.result === "INVALID_TOKEN") {
          expect(result.message).toBeTruthy();
        }
      });

      test("rejects with USER_NOT_FOUND for non-existent user", async () => {
        // In open mode without token, resolveAuthor returns "anonymous".
        // Calling regenerate("anonymous") passes the self-service check
        // (anonymous === anonymous) but "anonymous" is never in users list.
        const result = await tracker.usersRegenerate("anonymous");
        expect(result.result).toBe("USER_NOT_FOUND");
      });

      test("persists new token to users.json", async () => {
        const regResult = await tracker.usersRegister("alice");
        if (regResult.result !== "OK") throw new Error("Register failed");
        process.env.TRACKGENTIC_USER_TOKEN = regResult.token;

        const genResult = await tracker.usersRegenerate("alice");
        if (genResult.result !== "OK") throw new Error("Regenerate failed");

        const usersData = JSON.parse(
          readFileSync(join(testDir, ".trackgentic", "users.json"), "utf-8"),
        );
        expect(usersData.users[0].token).toBe(genResult.token);
        expect(usersData.users[0].token).not.toBe(regResult.token);
      });
    });
  });
});
