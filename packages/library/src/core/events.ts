import { readFile, writeFile } from "node:fs/promises";
import type {
  CommentId,
  ComputedComment,
  ComputedIssue,
  Event,
  IssueId,
  IssueStatus,
  UpdateEvent,
} from "../types";

/**
 * Append a single event to an issue's JSON file (array of events).
 * Creates the file with a JSON array if it doesn't exist yet.
 */
export async function appendEvent(issuePath: string, event: Event): Promise<void> {
  let events: Event[];

  try {
    const contents = await readFile(issuePath, "utf-8");
    events = JSON.parse(contents) as Event[];
  } catch {
    events = [];
  }

  events.push(event);
  await writeFile(issuePath, `${JSON.stringify(events, null, 2)}\n`, "utf-8");
}

/**
 * Read an issue file and return the raw event array.
 */
export async function replayEvents(issuePath: string): Promise<Event[]> {
  const contents = await readFile(issuePath, "utf-8");
  return JSON.parse(contents) as Event[];
}

/** Default values for a new issue (no events applied yet). */
const DEFAULTS = {
  status: "idea" as IssueStatus,
  priority: 3 as 1 | 2 | 3 | 4 | 5,
  assignee: null as string | null,
  parentId: null as string | null,
  tags: [] as string[],
  description: "",
};

/** Mutable state being built during event replay. */
interface IssueState {
  title: string;
  description: string;
  status: IssueStatus;
  priority: 1 | 2 | 3 | 4 | 5;
  assignee: string | null;
  parentId: string | null;
  tags: string[];
}

/**
 * Apply an update event's content to the mutable state.
 */
function applyUpdate(state: IssueState, content: UpdateEvent["content"]): void {
  if (content.title !== undefined) state.title = content.title;
  if (content.description !== undefined) state.description = content.description;
  if (content.status !== undefined) state.status = content.status;
  if (content.priority !== undefined) state.priority = content.priority;
  if (content.assignee !== undefined) state.assignee = content.assignee;
  if (content.parentId !== undefined) state.parentId = content.parentId;
  if (content.tags !== undefined) state.tags = content.tags;
}

/**
 * Replay events to produce a ComputedIssue.
 *
 * - Creation event: sets createdAt, createdBy.
 * - Update events: merge content fields into properties.
 * - Comment / blockage events: ignored (handled separately).
 * - updatedAt = timestamp of last event.
 *
 * The `id` comes from the filename, not from the events.
 */
export function computeState(events: Event[], issueId: IssueId): ComputedIssue {
  const state: IssueState = {
    title: "",
    description: DEFAULTS.description,
    status: DEFAULTS.status,
    priority: DEFAULTS.priority,
    assignee: DEFAULTS.assignee,
    parentId: DEFAULTS.parentId,
    tags: [...DEFAULTS.tags],
  };

  let createdAt = "";
  let createdBy = "";
  let updatedAt = "";

  for (const event of events) {
    updatedAt = event.timestamp;

    if (event.type === "creation") {
      createdAt = event.timestamp;
      createdBy = event.author;
    } else if (event.type === "update") {
      applyUpdate(state, event.content);
    }
    // Comment and blockage events are metadata-only — skip
  }

  return {
    id: issueId,
    ...state,
    createdAt,
    createdBy,
    updatedAt,
  };
}

/**
 * Replay events to compute the current list of comments.
 *
 * - `comment` event → create new entry
 * - `comment-update` event → update content and editedAt (skip if missing/deleted)
 * - `comment-delete` event → remove entry from the map
 * - All other event types are ignored.
 *
 * Returns comments sorted by creation timestamp ascending.
 */
export function computeComments(events: Event[]): ComputedComment[] {
  const map = new Map<CommentId, ComputedComment>();

  for (const event of events) {
    if (event.type === "comment") {
      map.set(event.content.id, {
        id: event.content.id,
        author: event.author,
        content: event.content.content,
        timestamp: event.timestamp,
        editedAt: null,
      });
    } else if (event.type === "comment-update") {
      const existing = map.get(event.content.id);
      if (existing) {
        existing.content = event.content.content;
        existing.editedAt = event.timestamp;
      }
    } else if (event.type === "comment-delete") {
      map.delete(event.content.id);
    }
    // All other event types are ignored
  }

  return Array.from(map.values()).sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
  );
}
