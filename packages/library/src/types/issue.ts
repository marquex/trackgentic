/**
 * Issue ID — 10 chars: 6 from timestamp base36 + 4 random base36
 * Sortable by creation time.
 */
export type IssueId = string;

/**
 * Comment ID — same format as IssueId: 10-char base36
 */
export type CommentId = string;

/**
 * Issue status progression: idea → todo → in-progress → done → closed
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
 * Full computed state of an issue, including computed fields.
 */
export interface ComputedIssue extends IssueProperties {
  createdAt: string; // ISO 8601 — timestamp of creation event
  createdBy: string; // author of creation event
  updatedAt: string; // ISO 8601 — timestamp of last event
}

/**
 * Computed state of a comment.
 */
export interface ComputedComment {
  id: CommentId;
  author: string;
  content: string;
  timestamp: string; // ISO 8601 — when the comment was created
  editedAt: string | null; // ISO 8601 — when last comment-update was applied, or null
}
