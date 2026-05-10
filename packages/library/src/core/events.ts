import { readFile, writeFile } from "node:fs/promises";
import type { ComputedIssue, Event, IssueId, IssueStatus, UpdateEvent } from "../types";

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
