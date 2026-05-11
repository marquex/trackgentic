/**
 * A single registered user with their authentication token.
 */
export interface UserEntry {
  /** Stored lowercase for case-insensitive lookup. */
  name: string;
  /** Format: tk_ + 8 random alphanumeric characters. */
  token: string;
  /** ISO 8601 — when the user was registered. */
  registeredAt: string;
}

/**
 * Users file — list of registered users.
 * Stored at `.trackgentic/users.json`.
 */
export interface UsersFile {
  users: UserEntry[];
}

/**
 * Public user info without the token.
 * Returned by usersList to prevent token leakage.
 */
export interface UserInfo {
  name: string;
  /** ISO 8601 — when the user was registered. */
  registeredAt: string;
}
