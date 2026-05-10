import { expect } from "bun:test";
import type { TrackgenticError } from "../../src/core/errors";

/**
 * Assert that a result is a TrackgenticError with the expected result code.
 */
export function expectError(result: unknown, expectedCode: string): void {
  expect(result).toBeDefined();
  const err = result as TrackgenticError;
  expect(err.result).toBe(expectedCode);
}

/**
 * Assert that a result is a success (has result: "OK").
 */
export function expectOk(result: { result: string }): void {
  expect(result.result).toBe("OK");
}
