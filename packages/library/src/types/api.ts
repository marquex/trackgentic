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

export type InitResult =
  | { result: "OK"; path: string }
  | { result: "ALREADY_INITIALIZED"; path: string };

// ─── Create ─────────────────────────────────────────────────────────

export interface CreateParams {
  title: string;
  description?: string;
  assignee?: string;
  tags?: string[]; // defaults to []
  status?: IssueStatus; // defaults to "idea"
  priority?: 1 | 2 | 3 | 4 | 5; // defaults to 3
  parentId?: IssueId | null;
  path?: string; // defaults to issues/[id].json
  author?: string; // resolved by auth layer if not provided
}

export type CreateResult = { id: IssueId } | TrackgenticError;

// ─── Update ─────────────────────────────────────────────────────────

export interface UpdateParams {
  title?: string;
  description?: string;
  status?: IssueStatus;
  assignee?: string | null; // null to clear
  tags?: string[];
  priority?: 1 | 2 | 3 | 4 | 5;
  parentId?: IssueId | null; // null to detach
  author?: string;
}

export type UpdateResult = { result: "OK" } | TrackgenticError;

// ─── List ───────────────────────────────────────────────────────────

export interface ListParams {
  status?: IssueStatus | "open"; // "open" = all except closed
  assignee?: string;
  tags?: string[]; // AND filter — issue must have ALL tags
  parentId?: IssueId | null; // null = top-level issues only
}

export type ListResult = IndexEntry[];

// ─── View ───────────────────────────────────────────────────────────

export type ViewResult = ComputedIssue | TrackgenticError;

// ─── History ────────────────────────────────────────────────────────

import type { Event } from "./event";

export type { Event };
export type HistoryResult = Event[] | TrackgenticError;

// ─── Comments ───────────────────────────────────────────────────────

export interface CommentAddParams {
  content: string;
  author?: string;
}

export type CommentAddResult = { result: "OK"; commentId: CommentId } | TrackgenticError;

export interface CommentUpdateParams {
  content: string;
  author?: string;
}

export type CommentUpdateResult = { result: "OK" } | TrackgenticError;

export interface CommentDeleteParams {
  author?: string;
}

export type CommentDeleteResult = { result: "OK" } | TrackgenticError;

export type CommentsListResult = ComputedComment[] | TrackgenticError;

// ─── Blockages ──────────────────────────────────────────────────────

export interface BlockagesAddParams {
  blockerIds: IssueId[];
  author?: string;
}

export type BlockagesAddResult = { result: "OK" } | TrackgenticError;

export interface BlockagesResolveParams {
  blockerIds: IssueId[];
  author?: string;
}

export type BlockagesResolveResult = { result: "OK" } | TrackgenticError;

export interface BlockagesDeleteParams {
  blockerIds: IssueId[];
  author?: string;
}

export type BlockagesDeleteResult = { result: "OK" } | TrackgenticError;

export type BlockagesListResult = BlockageInfo | TrackgenticError;

// ─── Users ──────────────────────────────────────────────────────────

export type UsersRegisterResult =
  | { result: "OK"; name: string; token: string }
  | { result: "USER_ALREADY_EXISTS"; message: string };

export type UsersListResult = UserInfo[];

export type UsersRevokeResult = { result: "OK" } | { result: "USER_NOT_FOUND"; message: string };

export type UsersRegenerateResult =
  | { result: "OK"; name: string; token: string }
  | { result: "USER_NOT_FOUND"; message: string }
  | { result: "INVALID_TOKEN"; message: string };
