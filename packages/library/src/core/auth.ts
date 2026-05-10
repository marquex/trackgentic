import type { ConfigFile, UsersFile } from "../types";
import { ErrorCodes, TrackgenticError } from "./errors";

/**
 * Resolve the author for an operation based on auth configuration.
 *
 * Synchronous — only does in-memory lookups.
 * Reads TRACKGENTIC_USER_TOKEN from env if no explicit token is provided.
 */
export function resolveAuthor(options: {
  token?: string;
  config: ConfigFile;
  users: UsersFile;
  requiresWrite: boolean;
}): { author: string } | TrackgenticError {
  const { config, users, requiresWrite } = options;
  // noPropertyAccessFromIndexSignature requires bracket notation for dynamic keys
  const token = options.token ?? process.env["TRACKGENTIC_USER_TOKEN"];

  // If token is provided, validate it regardless of mode
  if (token) {
    const user = users.users.find((u) => u.token === token);
    if (!user) {
      return new TrackgenticError(
        ErrorCodes.INVALID_TOKEN.result,
        "Invalid authentication token.",
        ErrorCodes.INVALID_TOKEN.exitCode,
      );
    }
    return { author: user.name };
  }

  // No token provided — check mode
  switch (config.auth.mode) {
    case "strict":
      return new TrackgenticError(
        ErrorCodes.TOKEN_REQUIRED.result,
        "Authentication required. Set TRACKGENTIC_USER_TOKEN environment variable.",
        ErrorCodes.TOKEN_REQUIRED.exitCode,
      );

    case "read-only":
      if (requiresWrite) {
        return new TrackgenticError(
          ErrorCodes.TOKEN_REQUIRED.result,
          "Authentication required for write operations. Set TRACKGENTIC_USER_TOKEN environment variable.",
          ErrorCodes.TOKEN_REQUIRED.exitCode,
        );
      }
      // Read operation — fall through to use default user
      break;

    case "open":
      // No token needed — fall through to use default user
      break;
  }

  // Use default user for unauthenticated access
  const defaultUser = config.auth.defaultUser;
  if (!defaultUser) {
    return new TrackgenticError(
      ErrorCodes.DEFAULT_USER_MISSING.result,
      "No default user configured.",
      ErrorCodes.DEFAULT_USER_MISSING.exitCode,
    );
  }

  return { author: defaultUser };
}
