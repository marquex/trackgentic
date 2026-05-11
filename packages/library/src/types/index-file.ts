import type { IssueId, IssueStatus } from "./issue";

/**
 * Summary of an issue for fast index lookup.
 * Stored in the sorted index file alongside other entries.
 */
export interface IndexEntry {
  id: IssueId;
  title: string;
  /** Relative path to the issue file from the tracker directory. */
  path: string;
  status: IssueStatus;
  assignee: string | null;
  parentId: IssueId | null;
  tags: string[];
  priority: 1 | 2 | 3 | 4 | 5;
}

/**
 * Index file structure — two sorted arrays and a children map.
 *
 * Invariants:
 * - Both arrays are sorted by issue id (time-sortable).
 * - `open` contains entries where status !== "closed".
 * - `closed` contains entries where status === "closed".
 * - `childrenOf` keys only exist for issues that have children.
 */
export interface IndexFile {
  /** Issues that are not closed. */
  open: IndexEntry[];
  /** Issues that are closed. */
  closed: IndexEntry[];
  /** Maps parent ID to array of child IDs. */
  childrenOf: Record<IssueId, IssueId[]>;
}
