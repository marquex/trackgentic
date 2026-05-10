import type { CreateParams, UpdateParams } from "../../src/types/api";

/**
 * Factory function for creating test CreateParams.
 * Provides sensible defaults that can be overridden.
 */
export function createIssueParams(overrides?: Partial<CreateParams>): CreateParams {
  return {
    title: "Test issue",
    priority: 2,
    ...overrides,
  };
}

/**
 * Factory function for creating test UpdateParams.
 * Provides sensible defaults that can be overridden.
 */
export function updateIssueParams(overrides?: Partial<UpdateParams>): UpdateParams {
  return {
    status: "in-progress",
    ...overrides,
  };
}
