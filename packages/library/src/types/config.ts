/**
 * Configuration file stored at `.trackgentic/config.json`.
 * Controls authentication behavior for all operations.
 */
export interface ConfigFile {
  auth: {
    /** Authentication mode:
     * - "open" — no auth required, uses default user
     * - "read-only" — auth required for writes, reads use default user
     * - "strict" — auth required for all operations
     */
    mode: "open" | "read-only" | "strict";
    /** Default user name used when no token is provided. */
    defaultUser: string;
  };
}
