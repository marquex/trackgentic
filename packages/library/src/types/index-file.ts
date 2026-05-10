import type { IssueId, IssueStatus } from "./issue";

/**
 * A single entry in the index file — summary of an issue for fast lookup.
 */
export interface IndexEntry {
  id: IssueId;
  title: string;
  path: string;             // relative path to issue file
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
  open: IndexEntry[];
  closed: IndexEntry[];
  childrenOf: Record<IssueId, IssueId[]>;
}
