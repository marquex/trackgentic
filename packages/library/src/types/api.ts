import type { TrackgenticError } from "../core/errors";
import type {
  BlockageInfo,
  CommentId,
  ComputedComment,
  ComputedIssue,
  IndexEntry,
  IssueId,
  IssueStatus,
  UserInfo,
} from "./index";

// ─── Init ───────────────────────────────────────────────────────────

/** Result of initializing a new tracker directory. */
export type InitResult =
  | { result: "OK"; path: string }
  | { result: "ALREADY_INITIALIZED"; path: string };

// ─── Create ─────────────────────────────────────────────────────────

/** Parameters for creating a new issue. */
export interface CreateParams {
  /** The issue title (required). */
  title: string;
  /** Optional description, defaults to "". */
  description?: string;
  /** Optional assignee, defaults to null. */
  assignee?: string;
  /** Optional tags, defaults to []. */
  tags?: string[];
  /** Initial status, defaults to "idea". */
  status?: IssueStatus;
  /** Priority 1-5, defaults to 3. */
  priority?: 1 | 2 | 3 | 4 | 5;
  /** Optional parent issue ID for hierarchy. */
  parentId?: IssueId | null;
  /** Custom file path for the issue (relative to tracker dir). */
  path?: string;
  /** Override author (resolved by auth layer if not provided). */
  author?: string;
}

/** Result of creating a new issue. */
export type CreateResult = { id: IssueId } | TrackgenticError;

// ─── Update ─────────────────────────────────────────────────────────

/** Parameters for updating an existing issue. At least one field must be provided. */
export interface UpdateParams {
  /** New title. */
  title?: string;
  /** New description. */
  description?: string;
  /** New status. */
  status?: IssueStatus;
  /** New assignee, or null to clear. */
  assignee?: string | null;
  /** New tags (replaces existing). */
  tags?: string[];
  /** New priority (1-5). */
  priority?: 1 | 2 | 3 | 4 | 5;
  /** New parent ID, null to detach from parent. */
  parentId?: IssueId | null;
  /** Override author (resolved by auth layer if not provided). */
  author?: string;
}

/** Result of updating an issue. */
export type UpdateResult = { result: "OK" } | TrackgenticError;

// ─── List ───────────────────────────────────────────────────────────

/** Parameters for listing issues with optional filters. */
export interface ListParams {
  /** Filter by status. "open" = all except closed. */
  status?: IssueStatus | "open";
  /** Filter by assignee name. */
  assignee?: string;
  /** AND filter — issue must have ALL specified tags. */
  tags?: string[];
  /** Filter by parent ID. null = top-level issues only. */
  parentId?: IssueId | null;
}

/** Result of listing issues — sorted by priority ASC, impact DESC, id ASC. */
export type ListResult = IndexEntry[];

// ─── View ───────────────────────────────────────────────────────────

/** Result of viewing an issue's full computed state. */
export type ViewResult = ComputedIssue | TrackgenticError;

// ─── History ────────────────────────────────────────────────────────

import type { Event } from "./event";

export type { Event };

/** Result of retrieving an issue's raw event history. */
export type HistoryResult = Event[] | TrackgenticError;

// ─── Comments ───────────────────────────────────────────────────────

/** Parameters for adding a comment to an issue. */
export interface CommentAddParams {
  /** The comment content. */
  content: string;
  /** Override author (resolved by auth layer if not provided). */
  author?: string;
}

/** Result of adding a comment. */
export type CommentAddResult = { result: "OK"; commentId: CommentId } | TrackgenticError;

/** Parameters for updating an existing comment. */
export interface CommentUpdateParams {
  /** The new comment content. */
  content: string;
  /** Override author (resolved by auth layer if not provided). */
  author?: string;
}

/** Result of updating a comment. */
export type CommentUpdateResult = { result: "OK" } | TrackgenticError;

/** Parameters for deleting a comment. */
export interface CommentDeleteParams {
  /** Override author (resolved by auth layer if not provided). */
  author?: string;
}

/** Result of deleting a comment. */
export type CommentDeleteResult = { result: "OK" } | TrackgenticError;

/** Result of listing comments for an issue. */
export type CommentsListResult = ComputedComment[] | TrackgenticError;

// ─── Blockages ──────────────────────────────────────────────────────

/** Parameters for adding blockage dependencies. */
export interface BlockagesAddParams {
  /** IDs of the blocker issues. */
  blockerIds: IssueId[];
  /** Override author (resolved by auth layer if not provided). */
  author?: string;
}

/** Result of adding blockages. */
export type BlockagesAddResult = { result: "OK" } | TrackgenticError;

/** Parameters for resolving blockage dependencies. */
export interface BlockagesResolveParams {
  /** IDs of the blocker issues to resolve. */
  blockerIds: IssueId[];
  /** Override author (resolved by auth layer if not provided). */
  author?: string;
}

/** Result of resolving blockages. */
export type BlockagesResolveResult = { result: "OK" } | TrackgenticError;

/** Parameters for deleting blockage dependencies. */
export interface BlockagesDeleteParams {
  /** IDs of the blocker issues to delete. */
  blockerIds: IssueId[];
  /** Override author (resolved by auth layer if not provided). */
  author?: string;
}

/** Result of deleting blockages. */
export type BlockagesDeleteResult = { result: "OK" } | TrackgenticError;

/** Result of listing blockage info for an issue. */
export type BlockagesListResult = BlockageInfo | TrackgenticError;

// ─── Users ──────────────────────────────────────────────────────────

/** Result of registering a new user. */
export type UsersRegisterResult =
  | { result: "OK"; name: string; token: string }
  | { result: "USER_ALREADY_EXISTS"; message: string };

/** Result of listing users — tokens are never included. */
export type UsersListResult = UserInfo[];

/** Result of revoking a user. */
export type UsersRevokeResult = { result: "OK" } | { result: "USER_NOT_FOUND"; message: string };

/** Result of regenerating a user token (self-service only). */
export type UsersRegenerateResult =
  | { result: "OK"; name: string; token: string }
  | { result: "USER_NOT_FOUND"; message: string }
  | { result: "INVALID_TOKEN"; message: string };
