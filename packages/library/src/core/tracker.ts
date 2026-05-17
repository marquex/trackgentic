import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  BlockagesAddParams,
  BlockagesAddResult,
  BlockagesDeleteParams,
  BlockagesDeleteResult,
  BlockagesListResult,
  BlockagesResolveParams,
  BlockagesResolveResult,
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
  NextResult,
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
  addBlockage,
  deleteBlockage,
  detectCycle,
  getImpactScore,
  readDependencies,
  resolveBlockage,
  writeDependencies,
} from "./dependency-manager";
import {
  computeUpwardPromotions,
  isStatusAfter,
  validateNewChild,
  validateParentStatusChange,
} from "./hierarchy";

const TRACKGENTIC_DIR = ".trackgentic";

/**
 * Read dependencies.json synchronously (used inside sort comparator).
 */
function readDependenciesSync(trackerDir: string): DependenciesFile {
  const contents = readFileSync(join(trackerDir, "dependencies.json"), "utf-8");
  return JSON.parse(contents) as DependenciesFile;
}

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
 * Provides methods for issue CRUD, comments, blockages, user management,
 * and event history. The constructor accepts a `cwd` parameter that defaults
 * to `process.cwd()`. It does NOT validate that `.trackgentic/` exists at
 * construction time — resolution happens on each method call.
 *
 * @example
 * ```typescript
 * import { Tracker } from "trackgentic";
 *
 * const tracker = new Tracker("/path/to/project");
 * await tracker.init();
 * const { id } = await tracker.create({ title: "My first issue" });
 * ```
 */
export class Tracker {
  private cwd: string;

  /**
   * Create a new Tracker instance.
   *
   * @param cwd - Working directory to resolve `.trackgentic/` from. Defaults to `process.cwd()`.
   */
  constructor(cwd?: string) {
    this.cwd = cwd ?? process.cwd();
  }

  /**
   * Initialize a new `.trackgentic/` directory in `cwd`.
   *
   * Creates the directory structure with all initial files:
   * `config.json`, `index.json`, `dependencies.json`, `users.json`,
   * and an empty `issues/` subdirectory.
   *
   * @returns `{ result: "OK", path }` on success, or `{ result: "ALREADY_INITIALIZED", path }` if already exists
   *
   * @example
   * ```typescript
   * const result = await tracker.init();
   * if (result.result === "OK") console.log("Created at", result.path);
   * ```
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
   *
   * Generates a unique ID, creates the issue file with creation + update events,
   * and inserts an entry into the sorted index. Validates parent constraints if
   * `parentId` is provided.
   *
   * @param params - Creation parameters
   * @param params.title - The issue title (required)
   * @param params.description - Optional description, defaults to ""
   * @param params.status - Initial status, defaults to "idea"
   * @param params.priority - Priority 1-5, defaults to 3
   * @param params.assignee - Optional assignee, defaults to null
   * @param params.tags - Optional tags, defaults to []
   * @param params.parentId - Optional parent issue ID for hierarchy
   * @param params.author - Override author (resolved by auth layer if not provided)
   * @returns `{ id }` on success, or a TrackgenticError on auth failure
   * @throws {TrackgenticError} NOT_INITIALIZED if no `.trackgentic/` directory
   * @throws {TrackgenticError} NOT_FOUND if parentId doesn't exist in index
   * @throws {TrackgenticError} HIERARCHY_CONSTRAINT if parent is closed
   *
   * @example
   * ```typescript
   * const { id } = await tracker.create({
   *   title: "Bug fix",
   *   priority: 1,
   *   tags: ["bug", "urgent"],
   * });
   * ```
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
          `Parent issue \`${parentId}\` not found in index.`,
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
   * List issues from the index with optional filters.
   *
   * Returns entries sorted by: priority ASC → impact score DESC → id ASC.
   * Impact score is the count of active issues this issue blocks.
   *
   * @param params - Optional filter parameters
   * @param params.status - Filter by status; "open" = all non-closed, "closed" = closed only
   * @param params.assignee - Filter by assignee name
   * @param params.tags - AND filter — issue must have ALL specified tags
   * @param params.parentId - Filter by parent ID; null = top-level issues only
   * @returns Array of index entries matching the filters
   * @throws {TrackgenticError} NOT_INITIALIZED if no `.trackgentic/` directory
   * @throws {TrackgenticError} TOKEN_REQUIRED if auth mode is strict and no token provided
   *
   * @example
   * ```typescript
   * const openUrgent = await tracker.list({
   *   status: "open",
   *   tags: ["urgent"],
   *   parentId: null,
   * });
   * ```
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

    // Read dependencies once for impact score
    let deps: DependenciesFile | null = null;

    // Sort: priority ASC → impact DESC → id ASC
    filtered.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      // Lazy-load deps only once for sorting
      if (!deps) {
        deps = readDependenciesSync(trackerDir);
      }
      const impactA = getImpactScore(deps, a.id);
      const impactB = getImpactScore(deps, b.id);
      if (impactA !== impactB) return impactB - impactA;
      return a.id.localeCompare(b.id);
    });

    return filtered;
  }

  /**
   * View a single issue's full computed state.
   *
   * Replays all events from the issue file to produce the current computed state,
   * including all property values and timestamps.
   *
   * @param id - The issue ID to look up
   * @returns The full computed issue state, or a TrackgenticError
   * @throws {TrackgenticError} NOT_INITIALIZED if no `.trackgentic/` directory
   * @throws {TrackgenticError} NOT_FOUND if issue ID is not in the index
   * @throws {TrackgenticError} ISSUE_MISSING if index entry exists but file is missing
   *
   * @example
   * ```typescript
   * const issue = await tracker.view("abc123def4");
   * if ("title" in issue) console.log(issue.title, issue.status);
   * ```
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
        `Issue \`${id}\` not found in index.`,
        ErrorCodes.NOT_FOUND.exitCode,
      );
    }

    const issueFilePath = join(trackerDir, entry.path);
    if (!existsSync(issueFilePath)) {
      throw new TrackgenticError(
        ErrorCodes.ISSUE_MISSING.result,
        `Issue file for \`${id}\` is missing.`,
        ErrorCodes.ISSUE_MISSING.exitCode,
      );
    }

    const events = await replayEvents(issueFilePath);
    return computeState(events, id);
  }

  /**
   * Get the recommended next issue to work on for a given user.
   *
   * Filters open issues by assignee and active status, excludes blocked issues,
   * then sorts by priority ASC → impact DESC → id ASC and returns the top issue.
   *
   * @param assignee - The assignee name to filter by (case-sensitive)
   * @returns The recommended ComputedIssue, or `{ result: "NO_ISSUES_AVAILABLE" }`
   * @throws {TrackgenticError} NOT_INITIALIZED if no `.trackgentic/` directory
   * @throws {TrackgenticError} TOKEN_REQUIRED if auth mode is strict and no token provided
   *
   * @example
   * ```typescript
   * const result = await tracker.next("alice");
   * if ("title" in result) console.log("Work on:", result.title);
   * else console.log("No issues available:", result.message);
   * ```
   */
  async next(assignee: string): Promise<NextResult> {
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

    // Filter to open issues assigned to this user that are todo (ready to start)
    let candidates = index.open.filter(
      (e) => e.assignee === assignee && e.status === "todo",
    );

    // Read dependencies for blockage filtering and impact scoring
    const deps = readDependenciesSync(trackerDir);

    // Filter out issues with any active blockages
    candidates = candidates.filter((e) => {
      const blockedBy = deps.blockedBy[e.id] ?? [];
      return !blockedBy.some((b) => b.status === "active");
    });

    // If no candidates remain, return no issues available
    if (candidates.length === 0) {
      return {
        result: "NO_ISSUES_AVAILABLE",
        message: `No todo issues found for user '${assignee}'.`,
      };
    }

    // Sort: priority ASC → impact DESC → id ASC
    candidates.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      const impactA = getImpactScore(deps, a.id);
      const impactB = getImpactScore(deps, b.id);
      if (impactA !== impactB) return impactB - impactA;
      return a.id.localeCompare(b.id);
    });

    // Take top issue, replay events, return computed state
    const topEntry = candidates[0]!;
    const issueFilePath = join(trackerDir, topEntry.path);
    if (!existsSync(issueFilePath)) {
      throw new TrackgenticError(
        ErrorCodes.ISSUE_MISSING.result,
        `Issue file for \`${topEntry.id}\` is missing.`,
        ErrorCodes.ISSUE_MISSING.exitCode,
      );
    }

    const events = await replayEvents(issueFilePath);
    return computeState(events, topEntry.id);
  }

  /**
   * Update an existing issue.
   *
   * Appends an update event to the issue file, recomputes state, and updates the index.
   * Handles hierarchy side effects: downward cascade (auto-close done children when parent
   * closes), upward promotion (promote parent when child advances past it), and reparenting
   * validation. Also auto-resolves active blockages when the issue transitions to done/closed.
   *
   * @param id - The issue ID to update
   * @param params - Update parameters (at least one field required besides author)
   * @param params.title - New title
   * @param params.description - New description
   * @param params.status - New status
   * @param params.assignee - New assignee, or null to clear
   * @param params.tags - New tags (replaces existing)
   * @param params.priority - New priority (1-5)
   * @param params.parentId - New parent ID, or null to detach
   * @param params.author - Override author (resolved by auth layer if not provided)
   * @returns `{ result: "OK" }` on success, or a TrackgenticError on auth failure
   * @throws {TrackgenticError} NOT_INITIALIZED if no `.trackgentic/` directory
   * @throws {TrackgenticError} INVALID_PARAMS if no fields provided besides author
   * @throws {TrackgenticError} NOT_FOUND if issue ID is not in the index
   * @throws {TrackgenticError} ISSUE_MISSING if index entry exists but file is missing
   * @throws {TrackgenticError} HIERARCHY_CONSTRAINT if status change violates parent/child rules
   *
   * @example
   * ```typescript
   * await tracker.update("abc123def4", { status: "in-progress", priority: 2 });
   * ```
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
        `Issue \`${id}\` not found in index.`,
        ErrorCodes.NOT_FOUND.exitCode,
      );
    }

    const issueFilePath = join(trackerDir, entry.path);
    if (!existsSync(issueFilePath)) {
      throw new TrackgenticError(
        ErrorCodes.ISSUE_MISSING.result,
        `Issue file for \`${id}\` is missing.`,
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
            `Parent issue \`${params.parentId}\` not found in index.`,
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

    // ── Auto-resolution: resolve active blockages when issue → done/closed ──
    if (params.status !== undefined && params.status !== oldStatus) {
      if (params.status === "done" || params.status === "closed") {
        const deps = await readDependencies(trackerDir);
        const activeBlocks = (deps.blocks[id] ?? []).filter((e) => e.status === "active");

        if (activeBlocks.length > 0) {
          let updatedDeps = deps;
          for (const entry of activeBlocks) {
            updatedDeps = resolveBlockage(updatedDeps, entry.blockedId, entry.blockerId);

            const blockedEntry = findEntry(updatedIndex, entry.blockedId);
            if (blockedEntry) {
              const now = new Date().toISOString();
              const resolveEvent: Event = {
                type: "blockage-resolved",
                timestamp: now,
                author: "system",
                content: {
                  blockerId: id,
                  reason: `Blocker issue ${id} transitioned to ${params.status}`,
                },
              };
              await appendEvent(join(trackerDir, blockedEntry.path), resolveEvent);
            }
          }
          await writeDependencies(trackerDir, updatedDeps);
        }
      }
    }

    return { result: "OK" };
  }

  /**
   * Get the raw event history for an issue.
   *
   * Returns the complete array of events stored in the issue file,
   * in chronological order from creation to latest.
   *
   * @param id - The issue ID to look up
   * @returns Array of events, or a TrackgenticError
   * @throws {TrackgenticError} NOT_INITIALIZED if no `.trackgentic/` directory
   * @throws {TrackgenticError} NOT_FOUND if issue ID is not in the index
   * @throws {TrackgenticError} ISSUE_MISSING if index entry exists but file is missing
   *
   * @example
   * ```typescript
   * const events = await tracker.history("abc123def4");
   * if (Array.isArray(events)) {
   *   for (const event of events) console.log(event.type, event.timestamp);
   * }
   * ```
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
        `Issue \`${id}\` not found in index.`,
        ErrorCodes.NOT_FOUND.exitCode,
      );
    }

    const issueFilePath = join(trackerDir, entry.path);
    if (!existsSync(issueFilePath)) {
      throw new TrackgenticError(
        ErrorCodes.ISSUE_MISSING.result,
        `Issue file for \`${id}\` is missing.`,
        ErrorCodes.ISSUE_MISSING.exitCode,
      );
    }

    return replayEvents(issueFilePath);
  }

  // ─── Comments ─────────────────────────────────────────────────────

  /**
   * Add a comment to an issue.
   *
   * Appends a comment event to the issue file with a newly generated comment ID.
   *
   * @param id - The issue ID to comment on
   * @param params - Comment parameters
   * @param params.content - The comment content
   * @param params.author - Override author (resolved by auth layer if not provided)
   * @returns `{ result: "OK", commentId }` on success, or a TrackgenticError
   * @throws {TrackgenticError} NOT_INITIALIZED if no `.trackgentic/` directory
   * @throws {TrackgenticError} NOT_FOUND if issue ID is not in the index
   * @throws {TrackgenticError} ISSUE_MISSING if index entry exists but file is missing
   *
   * @example
   * ```typescript
   * const { commentId } = await tracker.commentsAdd("abc123def4", {
   *   content: "This looks like a duplicate.",
   * });
   * ```
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
        `Issue \`${id}\` not found in index.`,
        ErrorCodes.NOT_FOUND.exitCode,
      );
    }

    const issueFilePath = join(trackerDir, entry.path);
    if (!existsSync(issueFilePath)) {
      throw new TrackgenticError(
        ErrorCodes.ISSUE_MISSING.result,
        `Issue file for \`${id}\` is missing.`,
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
   *
   * Validates that the comment exists (not soft-deleted), then appends
   * a comment-update event to the issue file.
   *
   * @param id - The issue ID containing the comment
   * @param commentId - The comment ID to update
   * @param params - Update parameters
   * @param params.content - The new comment content
   * @param params.author - Override author (resolved by auth layer if not provided)
   * @returns `{ result: "OK" }` on success, or a TrackgenticError
   * @throws {TrackgenticError} NOT_INITIALIZED if no `.trackgentic/` directory
   * @throws {TrackgenticError} NOT_FOUND if issue ID is not in the index
   * @throws {TrackgenticError} ISSUE_MISSING if index entry exists but file is missing
   * @throws {TrackgenticError} COMMENT_NOT_FOUND if comment ID is not found
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
        `Issue \`${id}\` not found in index.`,
        ErrorCodes.NOT_FOUND.exitCode,
      );
    }

    const issueFilePath = join(trackerDir, entry.path);
    if (!existsSync(issueFilePath)) {
      throw new TrackgenticError(
        ErrorCodes.ISSUE_MISSING.result,
        `Issue file for \`${id}\` is missing.`,
        ErrorCodes.ISSUE_MISSING.exitCode,
      );
    }

    const events = await replayEvents(issueFilePath);
    const comments = computeComments(events);
    if (!comments.find((c) => c.id === commentId)) {
      throw new TrackgenticError(
        ErrorCodes.COMMENT_NOT_FOUND.result,
        `Comment \`${commentId}\` not found.`,
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
   * Delete a comment from an issue (soft-delete).
   *
   * Validates that the comment exists and is not already deleted, then appends
   * a comment-delete event. Deleted comments are excluded from computed output
   * but remain in the event log for audit purposes.
   *
   * @param id - The issue ID containing the comment
   * @param commentId - The comment ID to delete
   * @param params - Optional parameters
   * @param params.author - Override author (resolved by auth layer if not provided)
   * @returns `{ result: "OK" }` on success, or a TrackgenticError
   * @throws {TrackgenticError} NOT_INITIALIZED if no `.trackgentic/` directory
   * @throws {TrackgenticError} NOT_FOUND if issue ID is not in the index
   * @throws {TrackgenticError} ISSUE_MISSING if index entry exists but file is missing
   * @throws {TrackgenticError} COMMENT_NOT_FOUND if comment ID is not found or already deleted
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
        `Issue \`${id}\` not found in index.`,
        ErrorCodes.NOT_FOUND.exitCode,
      );
    }

    const issueFilePath = join(trackerDir, entry.path);
    if (!existsSync(issueFilePath)) {
      throw new TrackgenticError(
        ErrorCodes.ISSUE_MISSING.result,
        `Issue file for \`${id}\` is missing.`,
        ErrorCodes.ISSUE_MISSING.exitCode,
      );
    }

    const events = await replayEvents(issueFilePath);
    const comments = computeComments(events);
    if (!comments.find((c) => c.id === commentId)) {
      throw new TrackgenticError(
        ErrorCodes.COMMENT_NOT_FOUND.result,
        `Comment \`${commentId}\` not found.`,
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
   * List all non-deleted comments for an issue.
   *
   * Replays all comment-related events to produce the current computed
   * comment list, excluding soft-deleted comments.
   *
   * @param id - The issue ID to list comments for
   * @returns Array of computed comments, or a TrackgenticError
   * @throws {TrackgenticError} NOT_INITIALIZED if no `.trackgentic/` directory
   * @throws {TrackgenticError} NOT_FOUND if issue ID is not in the index
   * @throws {TrackgenticError} ISSUE_MISSING if index entry exists but file is missing
   *
   * @example
   * ```typescript
   * const comments = await tracker.commentsList("abc123def4");
   * if (Array.isArray(comments)) {
   *   for (const c of comments) console.log(c.author, c.content);
   * }
   * ```
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
        `Issue \`${id}\` not found in index.`,
        ErrorCodes.NOT_FOUND.exitCode,
      );
    }

    const issueFilePath = join(trackerDir, entry.path);
    if (!existsSync(issueFilePath)) {
      throw new TrackgenticError(
        ErrorCodes.ISSUE_MISSING.result,
        `Issue file for \`${id}\` is missing.`,
        ErrorCodes.ISSUE_MISSING.exitCode,
      );
    }

    const events = await replayEvents(issueFilePath);
    return computeComments(events);
  }

  // ─── Blockages ────────────────────────────────────────────────────

  /**
   * Add blockage dependencies to an issue.
   *
   * Batch atomic: if adding any blocker would create a cycle, the entire batch
   * is rejected and no changes are written. Validates that both the blocked issue
   * and all blocker issues exist in the index.
   *
   * @param blockedId - The issue that is blocked
   * @param params - Blockage parameters
   * @param params.blockerIds - Array of blocker issue IDs
   * @param params.author - Override author (resolved by auth layer if not provided)
   * @returns `{ result: "OK" }` on success, or a TrackgenticError
   * @throws {TrackgenticError} NOT_INITIALIZED if no `.trackgentic/` directory
   * @throws {TrackgenticError} NOT_FOUND if blockedId or any blockerId is not in the index
   * @throws {TrackgenticError} BLOCKAGE_CYCLE if adding the blockage would create a cycle
   *
   * @example
   * ```typescript
   * await tracker.blockagesAdd("blocked001", {
   *   blockerIds: ["blocker001", "blocker002"],
   * });
   * ```
   */
  async blockagesAdd(blockedId: IssueId, params: BlockagesAddParams): Promise<BlockagesAddResult> {
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

    // Validate blockedId exists
    if (!findEntry(index, blockedId)) {
      throw new TrackgenticError(
        ErrorCodes.NOT_FOUND.result,
        `Issue \`${blockedId}\` not found in index.`,
        ErrorCodes.NOT_FOUND.exitCode,
      );
    }

    // Validate all blockerIds exist
    for (const blockerId of params.blockerIds) {
      if (!findEntry(index, blockerId)) {
        throw new TrackgenticError(
          ErrorCodes.NOT_FOUND.result,
          `Issue \`${blockerId}\` not found in index.`,
          ErrorCodes.NOT_FOUND.exitCode,
        );
      }
    }

    const deps = await readDependencies(trackerDir);

    // Projected state: deep clone and validate cycle for each blocker
    let projected = {
      blockedBy: { ...deps.blockedBy },
      blocks: { ...deps.blocks },
    };

    for (const blockerId of params.blockerIds) {
      projected = addBlockage(projected, blockedId, blockerId);
      if (detectCycle(projected, blockedId, blockerId)) {
        throw new TrackgenticError(
          ErrorCodes.BLOCKAGE_CYCLE.result,
          `Blockage would create a cycle: \`${blockedId}\` → ... → \`${blockerId}\`.`,
          ErrorCodes.BLOCKAGE_CYCLE.exitCode,
        );
      }
    }

    // All passed — write projected state
    await writeDependencies(trackerDir, projected);

    // Append events to blockedId's issue file
    const blockedEntry = findEntry(index, blockedId)!;
    const issueFilePath = join(trackerDir, blockedEntry.path);

    for (const blockerId of params.blockerIds) {
      const now = new Date().toISOString();
      const event: Event = {
        type: "blockage-added",
        timestamp: now,
        author,
        content: { blockerId },
      };
      await appendEvent(issueFilePath, event);
    }

    return { result: "OK" };
  }

  /**
   * Resolve blockage dependencies for an issue.
   *
   * Marks the specified blockages as "resolved" in the dependencies file
   * and appends blockage-resolved events to the blocked issue's file.
   *
   * @param blockedId - The issue that was blocked
   * @param params - Resolve parameters
   * @param params.blockerIds - Array of blocker issue IDs to resolve
   * @param params.author - Override author (resolved by auth layer if not provided)
   * @returns `{ result: "OK" }` on success, or a TrackgenticError
   * @throws {TrackgenticError} NOT_INITIALIZED if no `.trackgentic/` directory
   * @throws {TrackgenticError} NOT_FOUND if blockedId is not in the index
   *
   * @example
   * ```typescript
   * await tracker.blockagesResolve("blocked001", { blockerIds: ["blocker001"] });
   * ```
   */
  async blockagesResolve(
    blockedId: IssueId,
    params: BlockagesResolveParams,
  ): Promise<BlockagesResolveResult> {
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

    if (!findEntry(index, blockedId)) {
      throw new TrackgenticError(
        ErrorCodes.NOT_FOUND.result,
        `Issue \`${blockedId}\` not found in index.`,
        ErrorCodes.NOT_FOUND.exitCode,
      );
    }

    let deps = await readDependencies(trackerDir);

    for (const blockerId of params.blockerIds) {
      deps = resolveBlockage(deps, blockedId, blockerId);
    }

    await writeDependencies(trackerDir, deps);

    // Append events
    const blockedEntry = findEntry(index, blockedId)!;
    const issueFilePath = join(trackerDir, blockedEntry.path);

    for (const blockerId of params.blockerIds) {
      const now = new Date().toISOString();
      const event: Event = {
        type: "blockage-resolved",
        timestamp: now,
        author,
        content: { blockerId },
      };
      await appendEvent(issueFilePath, event);
    }

    return { result: "OK" };
  }

  /**
   * Delete blockage dependencies for an issue.
   *
   * Removes the specified blockage entries entirely from the dependencies file
   * (not a soft-delete — entries are removed) and appends blockage-deleted events
   * to the blocked issue's file.
   *
   * @param blockedId - The issue that was blocked
   * @param params - Delete parameters
   * @param params.blockerIds - Array of blocker issue IDs to delete
   * @param params.author - Override author (resolved by auth layer if not provided)
   * @returns `{ result: "OK" }` on success, or a TrackgenticError
   * @throws {TrackgenticError} NOT_INITIALIZED if no `.trackgentic/` directory
   * @throws {TrackgenticError} NOT_FOUND if blockedId is not in the index
   *
   * @example
   * ```typescript
   * await tracker.blockagesDelete("blocked001", { blockerIds: ["blocker001"] });
   * ```
   */
  async blockagesDelete(
    blockedId: IssueId,
    params: BlockagesDeleteParams,
  ): Promise<BlockagesDeleteResult> {
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

    if (!findEntry(index, blockedId)) {
      throw new TrackgenticError(
        ErrorCodes.NOT_FOUND.result,
        `Issue \`${blockedId}\` not found in index.`,
        ErrorCodes.NOT_FOUND.exitCode,
      );
    }

    let deps = await readDependencies(trackerDir);

    for (const blockerId of params.blockerIds) {
      deps = deleteBlockage(deps, blockedId, blockerId);
    }

    await writeDependencies(trackerDir, deps);

    // Append events
    const blockedEntry = findEntry(index, blockedId)!;
    const issueFilePath = join(trackerDir, blockedEntry.path);

    for (const blockerId of params.blockerIds) {
      const now = new Date().toISOString();
      const event: Event = {
        type: "blockage-deleted",
        timestamp: now,
        author,
        content: { blockerId },
      };
      await appendEvent(issueFilePath, event);
    }

    return { result: "OK" };
  }

  /**
   * List all blockage info for an issue.
   *
   * Returns both directions: what blocks this issue (`blockedBy`) and
   * what this issue blocks (`blocks`).
   *
   * @param id - The issue ID to look up blockages for
   * @returns Blockage info with `blockedBy` and `blocks` arrays, or a TrackgenticError
   * @throws {TrackgenticError} NOT_INITIALIZED if no `.trackgentic/` directory
   * @throws {TrackgenticError} NOT_FOUND if issue ID is not in the index
   *
   * @example
   * ```typescript
   * const info = await tracker.blockagesList("abc123def4");
   * if ("issueId" in info)) {
   *   console.log("Blocked by:", info.blockedBy.length);
   *   console.log("Blocks:", info.blocks.length);
   * }
   * ```
   */
  async blockagesList(id: IssueId): Promise<BlockagesListResult> {
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

    if (!findEntry(index, id)) {
      throw new TrackgenticError(
        ErrorCodes.NOT_FOUND.result,
        `Issue \`${id}\` not found in index.`,
        ErrorCodes.NOT_FOUND.exitCode,
      );
    }

    const deps = await readDependencies(trackerDir);

    return {
      issueId: id,
      blockedBy: deps.blockedBy[id] ?? [],
      blocks: deps.blocks[id] ?? [],
    };
  }

  // ─── User Management ──────────────────────────────────────────────

  /**
   * Register a new user.
   *
   * Bootstrap mechanism — does NOT require authentication.
   * Generates a unique token (`tk_` + 8 random alphanumeric chars) for the user.
   * Names are stored lowercase. The name "anonymous" is reserved.
   *
   * @param name - The user name to register (stored lowercase)
   * @returns `{ result: "OK", name, token }` on success, or `{ result: "USER_ALREADY_EXISTS", message }`
   * @throws {TrackgenticError} NOT_INITIALIZED if no `.trackgentic/` directory
   *
   * @example
   * ```typescript
   * const result = await tracker.usersRegister("Alice");
   * if ("token" in result) console.log("Token:", result.token);
   * ```
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
   * List all registered users with tokens stripped.
   *
   * Returns public user info (name and registration date) without exposing tokens.
   * Auth requirements depend on the configured mode (read operation).
   *
   * @returns Array of user info objects (no tokens)
   * @throws {TrackgenticError} NOT_INITIALIZED if no `.trackgentic/` directory
   * @throws {TrackgenticError} TOKEN_REQUIRED if auth mode is strict and no token provided
   *
   * @example
   * ```typescript
   * const users = await tracker.usersList();
   * for (const u of users) console.log(u.name, u.registeredAt);
   * ```
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
   * Revoke (remove) a user from the system.
   *
   * Removes the user and their token from the users file.
   * Requires authentication (write operation).
   *
   * @param name - The user name to revoke (case-insensitive)
   * @returns `{ result: "OK" }` on success, or `{ result: "USER_NOT_FOUND", message }`
   * @throws {TrackgenticError} NOT_INITIALIZED if no `.trackgentic/` directory
   * @throws {TrackgenticError} TOKEN_REQUIRED if no token provided in auth-required mode
   *
   * @example
   * ```typescript
   * const result = await tracker.usersRevoke("alice");
   * if (result.result === "OK") console.log("User revoked.");
   * ```
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
   * Regenerate a user's authentication token.
   *
   * Self-service only — the authenticated caller must be the target user.
   * Generates a new token and replaces the old one in the users file.
   *
   * @param name - The user name whose token to regenerate (case-insensitive)
   * @returns `{ result: "OK", name, token }` with the new token, or an error result
   * @throws {TrackgenticError} NOT_INITIALIZED if no `.trackgentic/` directory
   * @throws {TrackgenticError} TOKEN_REQUIRED if no token provided
   *
   * @example
   * ```typescript
   * const result = await tracker.usersRegenerate("alice");
   * if ("token" in result) console.log("New token:", result.token);
   * ```
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
        message: "You can only regenerate your own token.",
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
