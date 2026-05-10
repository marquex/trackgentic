import type { CommentId, IssueId, IssueProperties } from "./issue";

/**
 * Base shape for all events.
 */
export interface BaseEvent {
  timestamp: string; // ISO 8601
  author: string; // resolved user name or "system"
}

/**
 * Creation event — marks the birth of an issue. No content.
 */
export interface CreationEvent extends BaseEvent {
  type: "creation";
}

/**
 * Update event — records changes to issue properties.
 */
export interface UpdateEvent extends BaseEvent {
  type: "update";
  content: Partial<
    Pick<
      IssueProperties,
      "title" | "description" | "status" | "assignee" | "tags" | "priority" | "parentId"
    >
  > & {
    reason?: string; // for system auto-promotion events
  };
}

/**
 * Comment event — adds a new comment.
 */
export interface CommentEvent extends BaseEvent {
  type: "comment";
  content: {
    id: CommentId;
    content: string;
  };
}

/**
 * Comment update event — edits an existing comment.
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
 */
export interface CommentDeleteEvent extends BaseEvent {
  type: "comment-delete";
  content: {
    id: CommentId;
  };
}

/**
 * Blockage added event — records a new dependency.
 */
export interface BlockageAddedEvent extends BaseEvent {
  type: "blockage-added";
  content: {
    blockerId: IssueId;
  };
}

/**
 * Blockage resolved event — records dependency resolution.
 */
export interface BlockageResolvedEvent extends BaseEvent {
  type: "blockage-resolved";
  content: {
    blockerId: IssueId;
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
