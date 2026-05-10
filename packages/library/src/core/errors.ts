/**
 * Typed error class for all trackgentic operations.
 * Each error has a result code, human-readable message, and CLI exit code.
 */
export class TrackgenticError extends Error {
  constructor(
    public readonly result: string,
    public override readonly message: string,
    public readonly exitCode: number,
  ) {
    super(message);
    this.name = "TrackgenticError";
  }
}

// Error codes with their associated exit codes
export const ErrorCodes = {
  NOT_INITIALIZED: { result: "NOT_INITIALIZED", exitCode: 1 },
  ALREADY_INITIALIZED: { result: "ALREADY_INITIALIZED", exitCode: 0 },
  TOKEN_REQUIRED: { result: "TOKEN_REQUIRED", exitCode: 2 },
  INVALID_TOKEN: { result: "INVALID_TOKEN", exitCode: 3 },
  DEFAULT_USER_MISSING: { result: "DEFAULT_USER_MISSING", exitCode: 4 },
  NOT_FOUND: { result: "NOT_FOUND", exitCode: 5 },
  ISSUE_MISSING: { result: "ISSUE_MISSING", exitCode: 6 },
  COMMENT_NOT_FOUND: { result: "COMMENT_NOT_FOUND", exitCode: 7 },
  USER_ALREADY_EXISTS: { result: "USER_ALREADY_EXISTS", exitCode: 8 },
  USER_NOT_FOUND: { result: "USER_NOT_FOUND", exitCode: 9 },
  INVALID_PARAMS: { result: "INVALID_PARAMS", exitCode: 10 },
  BLOCKAGE_CYCLE: { result: "BLOCKAGE_CYCLE", exitCode: 11 },
  HIERARCHY_CONSTRAINT: { result: "HIERARCHY_CONSTRAINT", exitCode: 12 },
} as const;
