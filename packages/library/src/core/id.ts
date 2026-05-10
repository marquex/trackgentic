import type { IssueId, CommentId } from "../types";

/**
 * Generate a unique issue ID.
 * Format: 6 chars from timestamp (base36) + 4 random chars (base36) = 10 chars total.
 * IDs are sortable by creation time.
 */
export function generateId(): IssueId {
  return Date.now().toString(36).slice(0, 6) + Math.random().toString(36).slice(-4);
}

/**
 * Generate a unique comment ID.
 * Uses the same algorithm as issue IDs.
 */
export function generateCommentId(): CommentId {
  return Date.now().toString(36).slice(0, 6) + Math.random().toString(36).slice(-4);
}
