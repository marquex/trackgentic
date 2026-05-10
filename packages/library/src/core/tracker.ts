import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  ConfigFile,
  CreateParams,
  CreateResult,
  DependenciesFile,
  HistoryResult,
  IndexEntry,
  IndexFile,
  InitResult,
  IssueId,
  IssueProperties,
  IssueStatus,
  ListParams,
  ListResult,
  UpdateParams,
  UpdateResult,
  UsersFile,
  ViewResult,
} from "../types";
import { ErrorCodes, TrackgenticError } from "./errors";
import { appendEvent, computeState, replayEvents } from "./events";
import { atomicWriteJSON } from "./file-io";
import { generateId } from "./id";
import { findEntry, insertEntry, readIndex, updateEntry, writeIndex } from "./index-manager";
import { resolveTrackerDir } from "./resolution";

const TRACKGENTIC_DIR = ".trackgentic";

/**
 * Default config.json contents.
 */
const DEFAULT_CONFIG: ConfigFile = {
  auth: {
    mode: "read-only",
    defaultUser: "anonymous",
  },
};

/**
 * Default index.json contents.
 */
const DEFAULT_INDEX: IndexFile = {
  open: [],
  closed: [],
  childrenOf: {},
};

/**
 * Default dependencies.json contents.
 */
const DEFAULT_DEPENDENCIES: DependenciesFile = {
  blockedBy: {},
  blocks: {},
};

/**
 * Default users.json contents.
 */
const DEFAULT_USERS: UsersFile = {
  users: [],
};

/**
 * Tracker — the main programmatic API for trackgentic.
 *
 * The constructor accepts a `cwd` parameter (defaults to `process.cwd()`).
 * It does NOT validate that `.trackgentic/` exists — resolution happens on each method call.
 */
export class Tracker {
  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd ?? process.cwd();
  }

  /**
   * Initialize a new `.trackgentic/` directory in `cwd`.
   */
  async init(): Promise<InitResult> {
    const trackerDir = join(this.cwd, TRACKGENTIC_DIR);

    if (existsSync(trackerDir)) {
      return { result: "ALREADY_INITIALIZED", path: resolve(trackerDir) };
    }

    mkdirSync(trackerDir, { recursive: true });
    mkdirSync(join(trackerDir, "issues"), { recursive: true });

    await atomicWriteJSON(join(trackerDir, "config.json"), DEFAULT_CONFIG);
    await atomicWriteJSON(join(trackerDir, "index.json"), DEFAULT_INDEX);
    await atomicWriteJSON(join(trackerDir, "dependencies.json"), DEFAULT_DEPENDENCIES);
    await atomicWriteJSON(join(trackerDir, "users.json"), DEFAULT_USERS);

    return { result: "OK", path: resolve(trackerDir) };
  }

  /**
   * Create a new issue.
   */
  async create(params: CreateParams): Promise<CreateResult> {
    const trackerDir = resolveTrackerDir(this.cwd);
    if (!trackerDir) {
      throw new TrackgenticError(
        ErrorCodes.NOT_INITIALIZED.result,
        "No .trackgentic/ directory found. Run `trackgentic init` first.",
        ErrorCodes.NOT_INITIALIZED.exitCode,
      );
    }

    const id = generateId();
    const issuePath = params.path ?? `issues/${id}.json`;
    const author = params.author ?? "anonymous";
    const now = new Date().toISOString();

    const title = params.title;
    const description = params.description ?? "";
    const status: IssueStatus = params.status ?? "idea";
    const priority = params.priority ?? 3;
    const assignee = params.assignee ?? null;
    const parentId = params.parentId ?? null;
    const tags = params.tags ?? [];

    // Build update content with only non-default values
    const updateContent: Partial<
      Pick<
        IssueProperties,
        "title" | "description" | "status" | "assignee" | "tags" | "priority" | "parentId"
      >
    > & { title: string } = { title };
    if (description) updateContent.description = description;
    if (status !== "idea") updateContent.status = status;
    if (priority !== 3) updateContent.priority = priority;
    if (assignee !== null) updateContent.assignee = assignee;
    if (parentId !== null) updateContent.parentId = parentId;
    if (tags.length > 0) updateContent.tags = tags;

    // Create issue file with two events: creation + update
    const creationEvent = { type: "creation" as const, timestamp: now, author };
    const updateEvent = {
      type: "update" as const,
      timestamp: now,
      author,
      content: updateContent,
    };

    const issueFilePath = join(trackerDir, issuePath);
    await atomicWriteJSON(issueFilePath, [creationEvent, updateEvent]);

    // Build index entry and insert into index
    const entry: IndexEntry = {
      id,
      title,
      path: issuePath,
      status,
      assignee,
      parentId,
      tags,
      priority,
    };

    const index = await readIndex(trackerDir);
    const updatedIndex = insertEntry(index, entry);
    await writeIndex(trackerDir, updatedIndex);

    return { id };
  }

  /**
   * List issues from the index, with optional filters.
   */
  async list(params?: ListParams): Promise<ListResult> {
    const trackerDir = resolveTrackerDir(this.cwd);
    if (!trackerDir) {
      throw new TrackgenticError(
        ErrorCodes.NOT_INITIALIZED.result,
        "No .trackgentic/ directory found. Run `trackgentic init` first.",
        ErrorCodes.NOT_INITIALIZED.exitCode,
      );
    }

    const index = await readIndex(trackerDir);

    // Determine source arrays based on params.status
    let entries: IndexEntry[];
    if (params?.status === "closed") {
      entries = index.closed;
    } else if (params?.status === "open") {
      entries = index.open;
    } else if (params?.status) {
      entries = index.open;
    } else {
      entries = [...index.open, ...index.closed];
    }

    // Filter in memory
    let filtered = entries;

    if (params?.status && params.status !== "open" && params.status !== "closed") {
      filtered = filtered.filter((e) => e.status === params.status);
    }

    if (params?.assignee) {
      filtered = filtered.filter((e) => e.assignee === params.assignee);
    }

    if (params?.tags && params.tags.length > 0) {
      filtered = filtered.filter((e) => params.tags?.every((tag) => e.tags.includes(tag)));
    }

    if (params?.parentId !== undefined) {
      if (params.parentId === null) {
        filtered = filtered.filter((e) => e.parentId === null);
      } else {
        filtered = filtered.filter((e) => e.parentId === params.parentId);
      }
    }

    // Sort: priority ASC → id ASC
    filtered.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.id.localeCompare(b.id);
    });

    return filtered;
  }

  /**
   * View a single issue's full computed state.
   */
  async view(id: IssueId): Promise<ViewResult> {
    const trackerDir = resolveTrackerDir(this.cwd);
    if (!trackerDir) {
      throw new TrackgenticError(
        ErrorCodes.NOT_INITIALIZED.result,
        "No .trackgentic/ directory found. Run `trackgentic init` first.",
        ErrorCodes.NOT_INITIALIZED.exitCode,
      );
    }

    const index = await readIndex(trackerDir);
    const entry = findEntry(index, id);
    if (!entry) {
      throw new TrackgenticError(
        ErrorCodes.NOT_FOUND.result,
        `Issue ${id} not found in index.`,
        ErrorCodes.NOT_FOUND.exitCode,
      );
    }

    const issueFilePath = join(trackerDir, entry.path);
    if (!existsSync(issueFilePath)) {
      throw new TrackgenticError(
        ErrorCodes.ISSUE_MISSING.result,
        `Issue file for ${id} is missing.`,
        ErrorCodes.ISSUE_MISSING.exitCode,
      );
    }

    const events = await replayEvents(issueFilePath);
    return computeState(events, id);
  }

  /**
   * Update an existing issue.
   */
  async update(id: IssueId, params: UpdateParams): Promise<UpdateResult> {
    const trackerDir = resolveTrackerDir(this.cwd);
    if (!trackerDir) {
      throw new TrackgenticError(
        ErrorCodes.NOT_INITIALIZED.result,
        "No .trackgentic/ directory found. Run `trackgentic init` first.",
        ErrorCodes.NOT_INITIALIZED.exitCode,
      );
    }

    // Validate at least one field provided (besides author)
    const hasField =
      params.title !== undefined ||
      params.description !== undefined ||
      params.status !== undefined ||
      params.assignee !== undefined ||
      params.tags !== undefined ||
      params.priority !== undefined ||
      params.parentId !== undefined;

    if (!hasField) {
      throw new TrackgenticError(
        ErrorCodes.INVALID_PARAMS.result,
        "At least one field must be provided for update.",
        ErrorCodes.INVALID_PARAMS.exitCode,
      );
    }

    const index = await readIndex(trackerDir);
    const entry = findEntry(index, id);
    if (!entry) {
      throw new TrackgenticError(
        ErrorCodes.NOT_FOUND.result,
        `Issue ${id} not found in index.`,
        ErrorCodes.NOT_FOUND.exitCode,
      );
    }

    const issueFilePath = join(trackerDir, entry.path);
    if (!existsSync(issueFilePath)) {
      throw new TrackgenticError(
        ErrorCodes.ISSUE_MISSING.result,
        `Issue file for ${id} is missing.`,
        ErrorCodes.ISSUE_MISSING.exitCode,
      );
    }

    // Build update event content with only the provided fields
    const content: Partial<
      Pick<
        IssueProperties,
        "title" | "description" | "status" | "assignee" | "tags" | "priority" | "parentId"
      >
    > = {};
    if (params.title !== undefined) content.title = params.title;
    if (params.description !== undefined) content.description = params.description;
    if (params.status !== undefined) content.status = params.status;
    if (params.assignee !== undefined) content.assignee = params.assignee;
    if (params.tags !== undefined) content.tags = params.tags;
    if (params.priority !== undefined) content.priority = params.priority;
    if (params.parentId !== undefined) content.parentId = params.parentId;

    const author = params.author ?? "anonymous";
    const now = new Date().toISOString();

    const updateEvent = {
      type: "update" as const,
      timestamp: now,
      author,
      content,
    };

    // Append event to issue file
    await appendEvent(issueFilePath, updateEvent);

    // Recompute state from all events
    const events = await replayEvents(issueFilePath);
    const computed = computeState(events, id);

    // Update index entry with new computed values
    const updatedIndex = updateEntry(index, id, {
      title: computed.title,
      status: computed.status,
      assignee: computed.assignee,
      parentId: computed.parentId,
      tags: computed.tags,
      priority: computed.priority,
    });

    await writeIndex(trackerDir, updatedIndex);

    return { result: "OK" };
  }

  /**
   * Get the raw event history for an issue.
   */
  async history(id: IssueId): Promise<HistoryResult> {
    const trackerDir = resolveTrackerDir(this.cwd);
    if (!trackerDir) {
      throw new TrackgenticError(
        ErrorCodes.NOT_INITIALIZED.result,
        "No .trackgentic/ directory found. Run `trackgentic init` first.",
        ErrorCodes.NOT_INITIALIZED.exitCode,
      );
    }

    const index = await readIndex(trackerDir);
    const entry = findEntry(index, id);
    if (!entry) {
      throw new TrackgenticError(
        ErrorCodes.NOT_FOUND.result,
        `Issue ${id} not found in index.`,
        ErrorCodes.NOT_FOUND.exitCode,
      );
    }

    const issueFilePath = join(trackerDir, entry.path);
    if (!existsSync(issueFilePath)) {
      throw new TrackgenticError(
        ErrorCodes.ISSUE_MISSING.result,
        `Issue file for ${id} is missing.`,
        ErrorCodes.ISSUE_MISSING.exitCode,
      );
    }

    return replayEvents(issueFilePath);
  }
}
