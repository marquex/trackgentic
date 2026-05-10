import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  CommentAddParams,
  CommentAddResult,
  CommentDeleteParams,
  CommentDeleteResult,
  CommentsListResult,
  CommentUpdateParams,
  CommentUpdateResult,
  ConfigFile,
  CreateParams,
  CreateResult,
  DependenciesFile,
  Event,
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
  UserEntry,
  UsersFile,
  UsersListResult,
  UsersRegenerateResult,
  UsersRegisterResult,
  UsersRevokeResult,
  ViewResult,
} from "../types";
import { resolveAuthor } from "./auth";
import { ErrorCodes, TrackgenticError } from "./errors";
import { appendEvent, computeComments, computeState, replayEvents } from "./events";
import { atomicWriteJSON, readJSON } from "./file-io";
import { generateCommentId, generateId } from "./id";
import {
  addChild,
  findEntry,
  getChildren,
  insertEntry,
  readIndex,
  removeChild,
  updateEntry,
  writeIndex,
} from "./index-manager";
import { resolveTrackerDir } from "./resolution";
import {
  computeUpwardPromotions,
  isStatusAfter,
  validateNewChild,
  validateParentStatusChange,
} from "./hierarchy";

const TRACKGENTIC_DIR = ".trackgentic";

/**
 * Default config.json contents.
 */
const DEFAULT_CONFIG: ConfigFile = {
  auth: {
    mode: "open",
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
 * Generate a token: tk_ + 8 random alphanumeric characters.
 */
function generateToken(): string {
  return `tk_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Recursively auto-close done children when a parent is closed.
 * Appends system-authored events to each child's issue file and updates the index.
 * Returns the updated index.
 */
async function cascadeClose(
  index: IndexFile,
  issueId: IssueId,
  trackerDir: string,
): Promise<IndexFile> {
  const childIds = getChildren(index, issueId);
  let currentIndex = index;

  for (const childId of childIds) {
    const childEntry = findEntry(currentIndex, childId);
    if (!childEntry || childEntry.status !== "done") continue;

    const now = new Date().toISOString();
    const event: Event = {
      type: "update",
      timestamp: now,
      author: "system",
      content: {
        status: "closed",
        reason: "auto-closed: parent closed",
      },
    };

    const childPath = join(trackerDir, childEntry.path);
    await appendEvent(childPath, event);

    currentIndex = updateEntry(currentIndex, childId, { status: "closed" });

    // Recursively cascade to the child's own children
    currentIndex = await cascadeClose(currentIndex, childId, trackerDir);
  }

  return currentIndex;
}

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

    const config = await readJSON<ConfigFile>(join(trackerDir, "config.json"));
    const users = await readJSON<UsersFile>(join(trackerDir, "users.json"));
    const authResult = resolveAuthor({ config, users, requiresWrite: true });
    if (authResult instanceof TrackgenticError) return authResult;
    const author = params.author ?? authResult.author;

    const id = generateId();
    const issuePath = params.path ?? `issues/${id}.json`;
    const now = new Date().toISOString();

    const title = params.title;
    const description = params.description ?? "";
    const status: IssueStatus = params.status ?? "idea";
    const priority = params.priority ?? 3;
    const assignee = params.assignee ?? null;
    const parentId = params.parentId ?? null;
    const tags = params.tags ?? [];

    // Read index early for parent validation
    const index = await readIndex(trackerDir);

    // Validate parent exists and is not closed
    if (parentId) {
      const parentEntry = findEntry(index, parentId);
      if (!parentEntry) {
        throw new TrackgenticError(
          ErrorCodes.NOT_FOUND.result,
          "Parent issue not found",
          ErrorCodes.NOT_FOUND.exitCode,
        );
      }
      const validationError = validateNewChild(parentEntry);
      if (validationError) {
        throw new TrackgenticError(
          ErrorCodes.HIERARCHY_CONSTRAINT.result,
          validationError,
          ErrorCodes.HIERARCHY_CONSTRAINT.exitCode,
        );
      }
    }

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

    const config = await readJSON<ConfigFile>(join(trackerDir, "config.json"));
    const users = await readJSON<UsersFile>(join(trackerDir, "users.json"));
    const authResult = resolveAuthor({ config, users, requiresWrite: false });
    if (authResult instanceof TrackgenticError) {
      throw authResult;
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

    const config = await readJSON<ConfigFile>(join(trackerDir, "config.json"));
    const users = await readJSON<UsersFile>(join(trackerDir, "users.json"));
    const authResult = resolveAuthor({ config, users, requiresWrite: false });
    if (authResult instanceof TrackgenticError) {
      throw authResult;
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

    const config = await readJSON<ConfigFile>(join(trackerDir, "config.json"));
    const users = await readJSON<UsersFile>(join(trackerDir, "users.json"));
    const authResult = resolveAuthor({ config, users, requiresWrite: true });
    if (authResult instanceof TrackgenticError) return authResult;
    const author = params.author ?? authResult.author;

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

    // Save old values for hierarchy handling
    const oldStatus = entry.status;
    const oldParentId = entry.parentId;

    // ── Hierarchy validation (before any state changes) ────────────

    // Validate downward constraints for status change
    if (params.status !== undefined && params.status !== oldStatus) {
      if (params.status === "done" || params.status === "closed") {
        const childIds = getChildren(index, id);
        const childEntries = childIds
          .map((cid) => findEntry(index, cid))
          .filter((e): e is IndexEntry => e !== null);
        const validationError = validateParentStatusChange(index, childEntries, params.status);
        if (validationError) {
          throw new TrackgenticError(
            ErrorCodes.HIERARCHY_CONSTRAINT.result,
            validationError,
            ErrorCodes.HIERARCHY_CONSTRAINT.exitCode,
          );
        }
      }
    }

    // Validate reparenting constraints
    if (params.parentId !== undefined && params.parentId !== oldParentId) {
      if (params.parentId !== null) {
        const newParentEntry = findEntry(index, params.parentId);
        if (!newParentEntry) {
          throw new TrackgenticError(
            ErrorCodes.NOT_FOUND.result,
            "Parent issue not found",
            ErrorCodes.NOT_FOUND.exitCode,
          );
        }
        const validationError = validateNewChild(newParentEntry);
        if (validationError) {
          throw new TrackgenticError(
            ErrorCodes.HIERARCHY_CONSTRAINT.result,
            validationError,
            ErrorCodes.HIERARCHY_CONSTRAINT.exitCode,
          );
        }
      }
    }

    // ── Build and append update event ──────────────────────────────

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
    let updatedIndex = updateEntry(index, id, {
      title: computed.title,
      status: computed.status,
      assignee: computed.assignee,
      parentId: computed.parentId,
      tags: computed.tags,
      priority: computed.priority,
    });

    // ── Hierarchy handling (after event append, before index write) ─

    // 1. Handle reparenting (childrenOf updates)
    if (params.parentId !== undefined && params.parentId !== oldParentId) {
      // Detach from old parent
      if (oldParentId !== null) {
        updatedIndex = removeChild(updatedIndex, oldParentId, id);
      }
      // Attach to new parent
      if (params.parentId !== null) {
        updatedIndex = addChild(updatedIndex, params.parentId, id);

        // Upward promotion for reparenting: if child's status is past new parent's status
        const newParentEntry = findEntry(updatedIndex, params.parentId);
        if (newParentEntry && isStatusAfter(computed.status, newParentEntry.status)) {
          const promotions = computeUpwardPromotions(
            updatedIndex,
            newParentEntry,
            computed.status,
            (iid) => findEntry(updatedIndex, iid),
          );
          for (const promo of promotions) {
            const promoEntry = findEntry(updatedIndex, promo.issueId);
            if (promoEntry && promo.event.type === "update" && promo.event.content.status) {
              await appendEvent(join(trackerDir, promoEntry.path), promo.event);
              updatedIndex = updateEntry(updatedIndex, promo.issueId, {
                status: promo.event.content.status,
              });
            }
          }
        }
      }
    }

    // 2. Handle status change
    if (params.status !== undefined && params.status !== oldStatus) {
      // Downward cascade: auto-close done children when parent closes
      if (params.status === "closed") {
        updatedIndex = await cascadeClose(updatedIndex, id, trackerDir);
      }

      // Upward promotion: promote parent if child advanced past it
      const currentParentId = computed.parentId;
      if (currentParentId) {
        const parentEntry = findEntry(updatedIndex, currentParentId);
        if (parentEntry && isStatusAfter(params.status, parentEntry.status)) {
          const promotions = computeUpwardPromotions(
            updatedIndex,
            parentEntry,
            params.status,
            (iid) => findEntry(updatedIndex, iid),
          );
          for (const promo of promotions) {
            const promoEntry = findEntry(updatedIndex, promo.issueId);
            if (promoEntry && promo.event.type === "update" && promo.event.content.status) {
              await appendEvent(join(trackerDir, promoEntry.path), promo.event);
              updatedIndex = updateEntry(updatedIndex, promo.issueId, {
                status: promo.event.content.status,
              });
            }
          }
        }
      }
    }

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

    const config = await readJSON<ConfigFile>(join(trackerDir, "config.json"));
    const users = await readJSON<UsersFile>(join(trackerDir, "users.json"));
    const authResult = resolveAuthor({ config, users, requiresWrite: false });
    if (authResult instanceof TrackgenticError) {
      throw authResult;
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

  // ─── Comments ─────────────────────────────────────────────────────

  /**
   * Add a comment to an issue.
   */
  async commentsAdd(id: IssueId, params: CommentAddParams): Promise<CommentAddResult> {
    const trackerDir = resolveTrackerDir(this.cwd);
    if (!trackerDir) {
      throw new TrackgenticError(
        ErrorCodes.NOT_INITIALIZED.result,
        "No .trackgentic/ directory found. Run `trackgentic init` first.",
        ErrorCodes.NOT_INITIALIZED.exitCode,
      );
    }

    const config = await readJSON<ConfigFile>(join(trackerDir, "config.json"));
    const users = await readJSON<UsersFile>(join(trackerDir, "users.json"));
    const authResult = resolveAuthor({ config, users, requiresWrite: true });
    if (authResult instanceof TrackgenticError) return authResult;
    const author = params.author ?? authResult.author;

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

    const commentId = generateCommentId();
    const now = new Date().toISOString();

    const commentEvent = {
      type: "comment" as const,
      timestamp: now,
      author,
      content: { id: commentId, content: params.content },
    };

    await appendEvent(issueFilePath, commentEvent);

    return { result: "OK", commentId };
  }

  /**
   * Update an existing comment.
   */
  async commentsUpdate(
    id: IssueId,
    commentId: string,
    params: CommentUpdateParams,
  ): Promise<CommentUpdateResult> {
    const trackerDir = resolveTrackerDir(this.cwd);
    if (!trackerDir) {
      throw new TrackgenticError(
        ErrorCodes.NOT_INITIALIZED.result,
        "No .trackgentic/ directory found. Run `trackgentic init` first.",
        ErrorCodes.NOT_INITIALIZED.exitCode,
      );
    }

    const config = await readJSON<ConfigFile>(join(trackerDir, "config.json"));
    const users = await readJSON<UsersFile>(join(trackerDir, "users.json"));
    const authResult = resolveAuthor({ config, users, requiresWrite: true });
    if (authResult instanceof TrackgenticError) return authResult;
    const author = params.author ?? authResult.author;

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
    const comments = computeComments(events);
    if (!comments.find((c) => c.id === commentId)) {
      throw new TrackgenticError(
        ErrorCodes.COMMENT_NOT_FOUND.result,
        `Comment ${commentId} not found.`,
        ErrorCodes.COMMENT_NOT_FOUND.exitCode,
      );
    }

    const now = new Date().toISOString();

    const updateEvent = {
      type: "comment-update" as const,
      timestamp: now,
      author,
      content: { id: commentId, content: params.content },
    };

    await appendEvent(issueFilePath, updateEvent);

    return { result: "OK" };
  }

  /**
   * Delete a comment from an issue.
   */
  async commentsDelete(
    id: IssueId,
    commentId: string,
    params?: CommentDeleteParams,
  ): Promise<CommentDeleteResult> {
    const trackerDir = resolveTrackerDir(this.cwd);
    if (!trackerDir) {
      throw new TrackgenticError(
        ErrorCodes.NOT_INITIALIZED.result,
        "No .trackgentic/ directory found. Run `trackgentic init` first.",
        ErrorCodes.NOT_INITIALIZED.exitCode,
      );
    }

    const config = await readJSON<ConfigFile>(join(trackerDir, "config.json"));
    const users = await readJSON<UsersFile>(join(trackerDir, "users.json"));
    const authResult = resolveAuthor({ config, users, requiresWrite: true });
    if (authResult instanceof TrackgenticError) return authResult;
    const author = params?.author ?? authResult.author;

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
    const comments = computeComments(events);
    if (!comments.find((c) => c.id === commentId)) {
      throw new TrackgenticError(
        ErrorCodes.COMMENT_NOT_FOUND.result,
        `Comment ${commentId} not found.`,
        ErrorCodes.COMMENT_NOT_FOUND.exitCode,
      );
    }

    const now = new Date().toISOString();

    const deleteEvent = {
      type: "comment-delete" as const,
      timestamp: now,
      author,
      content: { id: commentId },
    };

    await appendEvent(issueFilePath, deleteEvent);

    return { result: "OK" };
  }

  /**
   * List all comments for an issue.
   */
  async commentsList(id: IssueId): Promise<CommentsListResult> {
    const trackerDir = resolveTrackerDir(this.cwd);
    if (!trackerDir) {
      throw new TrackgenticError(
        ErrorCodes.NOT_INITIALIZED.result,
        "No .trackgentic/ directory found. Run `trackgentic init` first.",
        ErrorCodes.NOT_INITIALIZED.exitCode,
      );
    }

    const config = await readJSON<ConfigFile>(join(trackerDir, "config.json"));
    const users = await readJSON<UsersFile>(join(trackerDir, "users.json"));
    const authResult = resolveAuthor({ config, users, requiresWrite: false });
    if (authResult instanceof TrackgenticError) {
      throw authResult;
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
    return computeComments(events);
  }

  // ─── User Management ──────────────────────────────────────────────

  /**
   * Register a new user. Does NOT require auth (bootstrap mechanism).
   */
  async usersRegister(name: string): Promise<UsersRegisterResult> {
    const trackerDir = resolveTrackerDir(this.cwd);
    if (!trackerDir) {
      throw new TrackgenticError(
        ErrorCodes.NOT_INITIALIZED.result,
        "No .trackgentic/ directory found. Run `trackgentic init` first.",
        ErrorCodes.NOT_INITIALIZED.exitCode,
      );
    }

    const lowerName = name.toLowerCase();

    // Reject reserved name
    if (lowerName === "anonymous") {
      return {
        result: "USER_ALREADY_EXISTS",
        message: `"anonymous" is a reserved name and cannot be registered.`,
      };
    }

    const users = await readJSON<UsersFile>(join(trackerDir, "users.json"));

    // Check uniqueness
    if (users.users.find((u) => u.name === lowerName)) {
      return {
        result: "USER_ALREADY_EXISTS",
        message: `User "${lowerName}" already exists.`,
      };
    }

    const token = generateToken();
    const newUser: UserEntry = {
      name: lowerName,
      token,
      registeredAt: new Date().toISOString(),
    };

    users.users.push(newUser);
    await atomicWriteJSON(join(trackerDir, "users.json"), users);

    return { result: "OK", name: lowerName, token };
  }

  /**
   * List all registered users (tokens stripped).
   * Auth: depends on mode (read operation).
   */
  async usersList(): Promise<UsersListResult> {
    const trackerDir = resolveTrackerDir(this.cwd);
    if (!trackerDir) {
      throw new TrackgenticError(
        ErrorCodes.NOT_INITIALIZED.result,
        "No .trackgentic/ directory found. Run `trackgentic init` first.",
        ErrorCodes.NOT_INITIALIZED.exitCode,
      );
    }

    const config = await readJSON<ConfigFile>(join(trackerDir, "config.json"));
    const users = await readJSON<UsersFile>(join(trackerDir, "users.json"));
    const authResult = resolveAuthor({ config, users, requiresWrite: false });
    if (authResult instanceof TrackgenticError) {
      throw authResult;
    }

    return users.users.map((u) => ({
      name: u.name,
      registeredAt: u.registeredAt,
    }));
  }

  /**
   * Revoke (remove) a user. Requires auth (write operation).
   */
  async usersRevoke(name: string): Promise<UsersRevokeResult> {
    const trackerDir = resolveTrackerDir(this.cwd);
    if (!trackerDir) {
      throw new TrackgenticError(
        ErrorCodes.NOT_INITIALIZED.result,
        "No .trackgentic/ directory found. Run `trackgentic init` first.",
        ErrorCodes.NOT_INITIALIZED.exitCode,
      );
    }

    const config = await readJSON<ConfigFile>(join(trackerDir, "config.json"));
    const users = await readJSON<UsersFile>(join(trackerDir, "users.json"));
    const authResult = resolveAuthor({ config, users, requiresWrite: true });
    if (authResult instanceof TrackgenticError) {
      throw authResult;
    }

    const lowerName = name.toLowerCase();
    const userIndex = users.users.findIndex((u) => u.name === lowerName);
    if (userIndex === -1) {
      return {
        result: "USER_NOT_FOUND",
        message: `User "${lowerName}" not found.`,
      };
    }

    users.users.splice(userIndex, 1);
    await atomicWriteJSON(join(trackerDir, "users.json"), users);

    return { result: "OK" };
  }

  /**
   * Regenerate a user's token. Self-service only — caller must be the target user.
   * Requires auth (write operation).
   */
  async usersRegenerate(name: string): Promise<UsersRegenerateResult> {
    const trackerDir = resolveTrackerDir(this.cwd);
    if (!trackerDir) {
      throw new TrackgenticError(
        ErrorCodes.NOT_INITIALIZED.result,
        "No .trackgentic/ directory found. Run `trackgentic init` first.",
        ErrorCodes.NOT_INITIALIZED.exitCode,
      );
    }

    const config = await readJSON<ConfigFile>(join(trackerDir, "config.json"));
    const users = await readJSON<UsersFile>(join(trackerDir, "users.json"));
    const authResult = resolveAuthor({ config, users, requiresWrite: true });
    if (authResult instanceof TrackgenticError) {
      throw authResult;
    }

    const callerName = authResult.author;
    const lowerName = name.toLowerCase();

    // Self-service check: caller must be the target user
    if (callerName !== lowerName) {
      return {
        result: "INVALID_TOKEN",
        message: `You can only regenerate your own token.`,
      };
    }

    const user = users.users.find((u) => u.name === lowerName);
    if (!user) {
      return {
        result: "USER_NOT_FOUND",
        message: `User "${lowerName}" not found.`,
      };
    }

    const newToken = generateToken();
    user.token = newToken;
    await atomicWriteJSON(join(trackerDir, "users.json"), users);

    return { result: "OK", name: lowerName, token: newToken };
  }
}
