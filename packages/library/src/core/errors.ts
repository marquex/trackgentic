/**
 * Typed error class for all trackgentic operations.
 * Each error has a result code, human-readable message, and CLI exit code.
 */
export class TrackgenticError extends Error {
  /**
   * @param result - Machine-readable error code (e.g. "NOT_FOUND")
   * @param message - Human-readable error description
   * @param exitCode - CLI exit code associated with this error
   */
  constructor(
    public readonly result: string,
    public override readonly message: string,
    public readonly exitCode: number,
  ) {
    super(message);
    this.name = "TrackgenticError";
  }
}

/**
 * Error codes with their associated CLI exit codes.
 * Each code maps to a unique exit code for programmatic error handling.
 */
export const ErrorCodes = {
  /** No `.trackgentic/` directory found in cwd. */
  NOT_INITIALIZED: { result: "NOT_INITIALIZED", exitCode: 1 },
  /** `.trackgentic/` directory already exists. */
  ALREADY_INITIALIZED: { result: "ALREADY_INITIALIZED", exitCode: 0 },
  /** Authentication token is required but not provided. */
  TOKEN_REQUIRED: { result: "TOKEN_REQUIRED", exitCode: 2 },
  /** The provided authentication token is invalid. */
  INVALID_TOKEN: { result: "INVALID_TOKEN", exitCode: 3 },
  /** No default user configured for unauthenticated access. */
  DEFAULT_USER_MISSING: { result: "DEFAULT_USER_MISSING", exitCode: 4 },
  /** Requested issue or resource not found. */
  NOT_FOUND: { result: "NOT_FOUND", exitCode: 5 },
  /** Issue exists in index but file is missing on disk. */
  ISSUE_MISSING: { result: "ISSUE_MISSING", exitCode: 6 },
  /** Requested comment not found on the issue. */
  COMMENT_NOT_FOUND: { result: "COMMENT_NOT_FOUND", exitCode: 7 },
  /** User with the same name already exists. */
  USER_ALREADY_EXISTS: { result: "USER_ALREADY_EXISTS", exitCode: 8 },
  /** Requested user not found. */
  USER_NOT_FOUND: { result: "USER_NOT_FOUND", exitCode: 9 },
  /** Invalid parameters provided to an operation. */
  INVALID_PARAMS: { result: "INVALID_PARAMS", exitCode: 10 },
  /** Adding blockage would create a dependency cycle. */
  BLOCKAGE_CYCLE: { result: "BLOCKAGE_CYCLE", exitCode: 11 },
  /** Hierarchy constraint violated (e.g. adding child to closed parent). */
  HIERARCHY_CONSTRAINT: { result: "HIERARCHY_CONSTRAINT", exitCode: 12 },
} as const;
