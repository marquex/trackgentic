import type { CommentId, IssueId, IssueProperties } from "./issue";

/**
 * Base shape shared by all events.
 */
export interface BaseEvent {
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Resolved user name or "system". */
  author: string;
}

/**
 * Creation event — marks the birth of an issue.
 * Always the first event in an issue file.
 */
export interface CreationEvent extends BaseEvent {
  type: "creation";
}

/**
 * Update event — records changes to issue properties.
 * Includes an optional reason field for system-authored auto-promotion events.
 */
export interface UpdateEvent extends BaseEvent {
  type: "update";
  content: Partial<
    Pick<
      IssueProperties,
      "title" | "description" | "status" | "assignee" | "tags" | "priority" | "parentId"
    >
  > & {
    /** Optional reason explaining why the update was applied (e.g. auto-promotion). */
    reason?: string;
  };
}

/**
 * Comment event — adds a new comment to an issue.
 */
export interface CommentEvent extends BaseEvent {
  type: "comment";
  content: {
    id: CommentId;
    content: string;
  };
}

/**
 * Comment update event — edits an existing comment's content.
 */
export interface CommentUpdateEvent extends BaseEvent {
  type: "comment-update";
  content: {
    id: CommentId;
    content: string;
  };
}

/**
 * Comment delete event — soft-deletes a comment.
 * Deleted comments are excluded from computed output but remain in the event log.
 */
export interface CommentDeleteEvent extends BaseEvent {
  type: "comment-delete";
  content: {
    id: CommentId;
  };
}

/**
 * Blockage added event — records a new dependency between two issues.
 */
export interface BlockageAddedEvent extends BaseEvent {
  type: "blockage-added";
  content: {
    blockerId: IssueId;
  };
}

/**
 * Blockage resolved event — records dependency resolution.
 * Includes an optional reason for why the blockage was resolved.
 */
export interface BlockageResolvedEvent extends BaseEvent {
  type: "blockage-resolved";
  content: {
    blockerId: IssueId;
    reason?: string;
  };
}

/**
 * Blockage deleted event — records dependency removal.
 */
export interface BlockageDeletedEvent extends BaseEvent {
  type: "blockage-deleted";
  content: {
    blockerId: IssueId;
  };
}

/**
 * Union of all event types.
 * Each event in an issue file is one of these variants.
 */
export type Event =
  | CreationEvent
  | UpdateEvent
  | CommentEvent
  | CommentUpdateEvent
  | CommentDeleteEvent
  | BlockageAddedEvent
  | BlockageResolvedEvent
  | BlockageDeletedEvent;
