/**
 * A single registered user.
 */
export interface UserEntry {
  name: string; // stored lowercase
  token: string; // format: tk_ + 8 random alphanumeric chars
  registeredAt: string; // ISO 8601
}

/**
 * Users file — list of registered users.
 */
export interface UsersFile {
  users: UserEntry[];
}

/**
 * Public user info (list output) — tokens are never included.
 */
export interface UserInfo {
  name: string;
  registeredAt: string;
}
