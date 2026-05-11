import type { IssueId } from "./issue";

/**
 * A single blockage relationship between two issues.
 * A blockage means the blocked issue cannot proceed until the blocker is resolved.
 */
export interface BlockageEntry {
  blockerId: IssueId;
  blockedId: IssueId;
  status: "active" | "resolved";
}

/**
 * Dependencies file — bidirectional blockage maps.
 * Both maps are always kept in sync. Every mutation writes both sides atomically.
 */
export interface DependenciesFile {
  /** Maps issue ID → list of issues blocking it. */
  blockedBy: Record<IssueId, BlockageEntry[]>;
  /** Maps issue ID → list of issues it blocks. */
  blocks: Record<IssueId, BlockageEntry[]>;
}

/**
 * Blockage info for a specific issue, returned by the view/blockagesList endpoint.
 */
export interface BlockageInfo {
  issueId: IssueId;
  /** Issues that are blocking this issue. */
  blockedBy: BlockageEntry[];
  /** Issues that this issue is blocking. */
  blocks: BlockageEntry[];
}
