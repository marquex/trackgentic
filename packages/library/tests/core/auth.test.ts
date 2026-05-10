import { describe, expect, test } from "bun:test";
import { resolveAuthor } from "../../src/core/auth";
import { TrackgenticError } from "../../src/core/errors";
import type { ConfigFile, UsersFile } from "../../src/types";

const openConfig: ConfigFile = {
  auth: { mode: "open", defaultUser: "anonymous" },
};

const openConfigNoDefault: ConfigFile = {
  auth: { mode: "open", defaultUser: "" },
};

const readOnlyConfig: ConfigFile = {
  auth: { mode: "read-only", defaultUser: "anonymous" },
};

const strictConfig: ConfigFile = {
  auth: { mode: "strict", defaultUser: "anonymous" },
};

const usersWithAlice: UsersFile = {
  users: [
    { name: "alice", token: "tk_abc12345", registeredAt: "2024-01-01T00:00:00.000Z" },
  ],
};

const emptyUsers: UsersFile = {
  users: [],
};

describe("resolveAuthor", () => {
  describe("open mode", () => {
    test("no token returns defaultUser", () => {
      const result = resolveAuthor({
        config: openConfig,
        users: emptyUsers,
        requiresWrite: true,
      });
      expect(result).toEqual({ author: "anonymous" });
    });

    test("no token, no defaultUser returns DEFAULT_USER_MISSING error", () => {
      const result = resolveAuthor({
        config: openConfigNoDefault,
        users: emptyUsers,
        requiresWrite: false,
      });
      expect(result).toBeInstanceOf(TrackgenticError);
      if (result instanceof TrackgenticError) {
        expect(result.result).toBe("DEFAULT_USER_MISSING");
        expect(result.exitCode).toBe(4);
      }
    });

    test("with valid token returns author from token lookup", () => {
      const result = resolveAuthor({
        token: "tk_abc12345",
        config: openConfig,
        users: usersWithAlice,
        requiresWrite: true,
      });
      expect(result).toEqual({ author: "alice" });
    });

    test("with invalid token returns INVALID_TOKEN error", () => {
      const result = resolveAuthor({
        token: "tk_invalid1",
        config: openConfig,
        users: usersWithAlice,
        requiresWrite: false,
      });
      expect(result).toBeInstanceOf(TrackgenticError);
      if (result instanceof TrackgenticError) {
        expect(result.result).toBe("INVALID_TOKEN");
        expect(result.exitCode).toBe(3);
      }
    });
  });

  describe("read-only mode", () => {
    test("no token, read op returns default user", () => {
      const result = resolveAuthor({
        config: readOnlyConfig,
        users: emptyUsers,
        requiresWrite: false,
      });
      expect(result).toEqual({ author: "anonymous" });
    });

    test("no token, write op returns TOKEN_REQUIRED error", () => {
      const result = resolveAuthor({
        config: readOnlyConfig,
        users: emptyUsers,
        requiresWrite: true,
      });
      expect(result).toBeInstanceOf(TrackgenticError);
      if (result instanceof TrackgenticError) {
        expect(result.result).toBe("TOKEN_REQUIRED");
        expect(result.exitCode).toBe(2);
      }
    });

    test("with token, write op returns author", () => {
      const result = resolveAuthor({
        token: "tk_abc12345",
        config: readOnlyConfig,
        users: usersWithAlice,
        requiresWrite: true,
      });
      expect(result).toEqual({ author: "alice" });
    });
  });

  describe("strict mode", () => {
    test("no token, read op returns TOKEN_REQUIRED error", () => {
      const result = resolveAuthor({
        config: strictConfig,
        users: emptyUsers,
        requiresWrite: false,
      });
      expect(result).toBeInstanceOf(TrackgenticError);
      if (result instanceof TrackgenticError) {
        expect(result.result).toBe("TOKEN_REQUIRED");
        expect(result.exitCode).toBe(2);
      }
    });

    test("no token, write op returns TOKEN_REQUIRED error", () => {
      const result = resolveAuthor({
        config: strictConfig,
        users: emptyUsers,
        requiresWrite: true,
      });
      expect(result).toBeInstanceOf(TrackgenticError);
      if (result instanceof TrackgenticError) {
        expect(result.result).toBe("TOKEN_REQUIRED");
        expect(result.exitCode).toBe(2);
      }
    });

    test("with token, read op returns author", () => {
      const result = resolveAuthor({
        token: "tk_abc12345",
        config: strictConfig,
        users: usersWithAlice,
        requiresWrite: false,
      });
      expect(result).toEqual({ author: "alice" });
    });

    test("with token, write op returns author", () => {
      const result = resolveAuthor({
        token: "tk_abc12345",
        config: strictConfig,
        users: usersWithAlice,
        requiresWrite: true,
      });
      expect(result).toEqual({ author: "alice" });
    });
  });

  describe("env var fallback", () => {
    test("reads token from TRACKGENTIC_USER_TOKEN env when not passed explicitly", () => {
      const original = process.env.TRACKGENTIC_USER_TOKEN;
      process.env.TRACKGENTIC_USER_TOKEN = "tk_abc12345";
      try {
        const result = resolveAuthor({
          config: strictConfig,
          users: usersWithAlice,
          requiresWrite: true,
        });
        expect(result).toEqual({ author: "alice" });
      } finally {
        if (original !== undefined) {
          process.env.TRACKGENTIC_USER_TOKEN = original;
        } else {
          delete process.env.TRACKGENTIC_USER_TOKEN;
        }
      }
    });

    test("explicit token takes precedence over env var", () => {
      const original = process.env.TRACKGENTIC_USER_TOKEN;
      process.env.TRACKGENTIC_USER_TOKEN = "tk_envbad00";
      try {
        // Env var is invalid but explicit token is valid — should use explicit
        const result = resolveAuthor({
          token: "tk_abc12345",
          config: strictConfig,
          users: usersWithAlice,
          requiresWrite: true,
        });
        expect(result).toEqual({ author: "alice" });
      } finally {
        if (original !== undefined) {
          process.env.TRACKGENTIC_USER_TOKEN = original;
        } else {
          delete process.env.TRACKGENTIC_USER_TOKEN;
        }
      }
    });
  });
});
