/**
 * Issue ID — 10-char string: 6 from timestamp base36 + 4 random base36.
 * Sortable by creation time.
 */
export type IssueId = string;

/**
 * Comment ID — same format as IssueId: 10-char base36 string.
 */
export type CommentId = string;

/**
 * Issue status progression: idea → todo → in-progress → done → closed.
 */
export type IssueStatus = "idea" | "todo" | "in-progress" | "done" | "closed";

/**
 * Mutable properties of an issue, reconstructed by replaying events.
 */
export interface IssueProperties {
  id: IssueId;
  title: string;
  description: string;
  status: IssueStatus;
  assignee: string | null;
  parentId: IssueId | null;
  tags: string[];
  priority: 1 | 2 | 3 | 4 | 5;
}

/**
 * Full computed state of an issue, including timestamps.
 * Produced by replaying all events for an issue.
 */
export interface ComputedIssue extends IssueProperties {
  /** ISO 8601 — timestamp of the creation event. */
  createdAt: string;
  /** Author of the creation event. */
  createdBy: string;
  /** ISO 8601 — timestamp of the last event. */
  updatedAt: string;
}

/**
 * Computed state of a single comment.
 * Produced by replaying comment, comment-update, and comment-delete events.
 */
export interface ComputedComment {
  id: CommentId;
  author: string;
  content: string;
  /** ISO 8601 — when the comment was created. */
  timestamp: string;
  /** ISO 8601 — when the last comment-update was applied, or null if never edited. */
  editedAt: string | null;
}
