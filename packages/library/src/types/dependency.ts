import type { IssueId } from "./issue";

/**
 * A single blockage relationship between two issues.
 */
export interface BlockageEntry {
  blockerId: IssueId;
  blockedId: IssueId;
  status: "active" | "resolved";
}

/**
 * Dependencies file — bidirectional blockage maps.
 * Both maps are always in sync. Every mutation writes both sides atomically.
 */
export interface DependenciesFile {
  blockedBy: Record<IssueId, BlockageEntry[]>; // what blocks me
  blocks: Record<IssueId, BlockageEntry[]>;    // what I block
}

/**
 * Blockage info for a specific issue (view output).
 */
export interface BlockageInfo {
  issueId: IssueId;
  blockedBy: BlockageEntry[];
  blocks: BlockageEntry[];
}
