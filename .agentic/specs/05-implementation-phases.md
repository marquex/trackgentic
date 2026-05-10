# Trackgentic Library — Implementation Phases

This document defines the implementation order, dependencies between phases, and what must be complete before moving to the next phase.

## Phase 1: Foundation & Project Setup

**Goal:** Bootable package with working `init` command.

### Tasks

1. **Initialize monorepo structure**
   - Root `package.json` with workspaces.
   - `packages/library/` with `package.json`, `tsconfig.json`, `bunfig.toml`.
   - Install `commander` dependency.

2. **Define all types** (`src/types/`)
   - All types from `02-data-model.md`.
   - All API response types from `03-api-specification.md`.
   - All error types.

3. **Implement ID generation** (`src/core/id.ts`)
   - `generateId(): IssueId`
   - `generateCommentId(): CommentId`
   - Both use `Date.now().toString(36).slice(0, 6) + Math.random().toString(36).slice(-4)`.

4. **Implement directory resolution** (`src/core/resolution.ts`)
   - `resolveTrackerDir(cwd: string): string | null`
   - Walk up from `cwd` looking for `.trackgentic/` directory.
   - Return absolute path or `null`.

5. **Implement file I/O utilities** (internal)
   - `atomicWriteJSON(filePath: string, data: unknown): Promise<void>`
   - Write to temp file, then rename (atomic on most filesystems).
   - `readJSON<T>(filePath: string): Promise<T>`

6. **Implement init command**
   - `Tracker.init()` method.
   - CLI `trackgentic init` command.
   - Creates `.trackgentic/` with all initial files.

7. **Implement CLI runner** (`src/cli/runner.ts`)
   - Commander-based argument parsing.
   - Subcommand routing.
   - JSON output formatting.
   - Error handling pattern.

8. **Wire CLI entry point** (`src/bin.ts`)
   - Shebang line.
   - Import and run CLI.

### Tests

- ID generation: uniqueness, length, format.
- Directory resolution: finds `.trackgentic/`, handles missing, handles nested.
- `init`: creates all files, rejects if already initialized.
- CLI: `trackgentic init` prints correct JSON.

### Exit Criteria

- `bun run src/bin.ts init` creates `.trackgentic/` with correct files.
- `bun run src/bin.ts init` returns `ALREADY_INITIALIZED` when run again.
- All tests pass.

---

## Phase 2: Event Engine & Basic Issue CRUD

**Goal:** Create, list, view, update, and history commands working.

### Tasks

1. **Implement event engine** (`src/core/events.ts`)
   - `appendEvent(issuePath: string, event: Event): Promise<void>`
   - `replayEvents(issuePath: string): Promise<Event[]>`
   - `computeState(events: Event[]): ComputedIssue`

2. **Implement index manager** (`src/core/index-manager.ts`)
   - `readIndex(trackerDir: string): Promise<IndexFile>`
   - `writeIndex(trackerDir: string, index: IndexFile): Promise<void>`
   - `insertEntry(index: IndexFile, entry: IndexEntry): IndexFile`
   - `updateEntry(index: IndexFile, id: IssueId, updates: Partial<IndexEntry>): IndexFile`
   - `findEntry(index: IndexFile, id: IssueId): IndexEntry | null` (binary search)
   - `removeEntry(index: IndexFile, id: IssueId): IndexFile`

3. **Implement Tracker.create()**
   - Generate ID.
   - Create issue file with creation + update events.
   - Insert into sorted index.
   - Return `{ id }`.

4. **Implement Tracker.list()**
   - Read index.
   - Filter by status, assignee, tags, parentId.
   - Sort: priority ASC → impact score DESC → id ASC.
   - Return filtered entries.

5. **Implement Tracker.view()**
   - Lookup in index → read issue file → replay events → return computed state.

6. **Implement Tracker.update()**
   - Lookup in index.
   - Append update event.
   - Recompute state, update index entry.
   - If status changed, move between open/closed arrays.

7. **Implement Tracker.history()**
   - Lookup in index → read issue file → return raw events.

8. **Wire CLI commands** for create, update, list, view, history.

### Tests

- Event append creates correct JSON.
- Event replay computes correct state for: single event, multiple updates, field overrides.
- Index: sorted insert, binary search, update, removal.
- create: generates ID, creates file, updates index.
- list: filtering by each flag, combination of flags, empty results.
- view: correct computed state, NOT_FOUND error, ISSUE_MISSING error.
- update: appends event, updates index, moves between open/closed.
- history: returns raw events.

### Exit Criteria

- Full CRUD cycle: create → list → view → update → view → history.
- All JSON output matches specification.
- All error cases return correct error codes.

---

## Phase 3: Auth System & Users

**Goal:** User management and token-based auth enforcement.

### Tasks

1. **Implement auth module** (`src/core/auth.ts`)
   - `resolveAuthor(options): Promise<{ author: string } | TrackgenticError>`
   - Token lookup from env var.
   - Mode enforcement (open/read-only/strict).
   - Default user fallback.

2. **Implement user management**
   - `Tracker.usersRegister(name): Promise<UsersRegisterResult>`
   - `Tracker.usersList(): Promise<UsersListResult>`
   - `Tracker.usersRevoke(name, token): Promise<UsersRevokeResult>`
   - `Tracker.usersRegenerate(name, token): Promise<UsersRegenerateResult>`
   - Token generation: `tk_` + 8 random alphanumeric.
   - Name validation: lowercase, uniqueness, `anonymous` reserved.

3. **Integrate auth into existing commands**
   - All mutating Tracker methods call `resolveAuthor` first.
   - Author is included in all events.
   - CLI reads `TRACKGENTIC_USER_TOKEN` from env.

4. **Wire CLI commands** for users register, list, revoke, regenerate.

### Tests

- Register: creates user, returns token, rejects duplicate name, rejects "anonymous".
- Auth open mode: no token → defaultUser author.
- Auth read-only mode: no token on read → OK, no token on write → TOKEN_REQUIRED.
- Auth strict mode: no token → TOKEN_REQUIRED.
- Author appears in all events.
- Revoke removes user. Regenerate changes token, validates self-only.

### Exit Criteria

- `users register` + `users list` + token-based auth works.
- All commands respect auth mode.
- Events include correct author.

---

## Phase 4: Comments

**Goal:** Full comment lifecycle: add, update, delete, list.

### Tasks

1. **Implement comment ID generation** (reuse `generateCommentId` from `id.ts`).

2. **Implement comment state computation**
   - Extend `computeState` or create `computeComments(events): ComputedComment[]`.
   - `comment` → create entry.
   - `comment-update` → override content, set `editedAt`.
   - `comment-delete` → exclude from results.

3. **Implement Tracker.commentsAdd()**
   - Validate issue exists.
   - Generate comment ID.
   - Append `comment` event.
   - Return `{ result: "OK", commentId }`.

4. **Implement Tracker.commentsUpdate()**
   - Replay to verify comment exists and is not deleted.
   - Append `comment-update` event.
   - Return `{ result: "OK" }`.

5. **Implement Tracker.commentsDelete()**
   - Replay to verify comment exists and is not already deleted.
   - Append `comment-delete` event.
   - Return `{ result: "OK" }`.

6. **Implement Tracker.commentsList()**
   - Replay events, compute comment state.
   - Return computed comments.

7. **Wire CLI commands** for comments add, update, delete, list.

### Tests

- Add comment: creates event, returns comment ID.
- Update comment: overrides content, `editedAt` is set.
- Delete comment: excluded from list. Double-delete → `COMMENT_NOT_FOUND`.
- Update/delete non-existent comment → `COMMENT_NOT_FOUND`.
- List after add + update + delete returns correct state.

### Exit Criteria

- Full comment lifecycle works through both API and CLI.

---

## Phase 5: Issue Hierarchy

**Goal:** Parent-child relationships with status constraint enforcement.

### Tasks

1. **Implement childrenOf map management** (in index-manager)
   - `addChild(index, parentId, childId): IndexFile`
   - `removeChild(index, parentId, childId): IndexFile`
   - `getChildren(index, parentId): IssueId[]`
   - Called on create (when parentId set), update (when parentId changed), and delete.

2. **Implement upward constraints**
   - When child status advances past parent → auto-promote parent.
   - Emit `update` event on parent with `author: "system"` and `reason` field.
   - Walk up recursively (child → parent → grandparent → ...).

3. **Implement downward constraints**
   - Parent cannot be set to `done`/`closed` if any child is not `done`/`closed`. → `HIERARCHY_CONSTRAINT` error.
   - When parent is set to `closed`, auto-close all `done` children. Cascade through subtree.
   - Non-`done` children block parent closure.

4. **Implement reparenting logic**
   - On `update --parentId`: remove from old parent's childrenOf, add to new parent's.
   - Validate new parent is not `closed`.
   - Apply upward constraints with new parent.

5. **Integrate hierarchy into create and update flows.**

### Tests

- Create with parentId: entry in childrenOf, parent not closed.
- Create under closed parent → `HIERARCHY_CONSTRAINT`.
- Update child status past parent → parent auto-promoted (system event).
- Update parent to done with open children → `HIERARCHY_CONSTRAINT`.
- Update parent to closed → done children auto-closed, non-done children block.
- Reparent: childrenOf updated, constraint check with new parent.
- Detach (parentId = null): removed from childrenOf.

### Exit Criteria

- Full hierarchy lifecycle works with correct constraint enforcement.
- System-authored events appear in history.

---

## Phase 6: Blockages & Dependencies

**Goal:** Dependency tracking with cycle detection and auto-resolution.

### Tasks

1. **Implement dependency manager** (`src/core/dependency-manager.ts`)
   - `readDependencies(trackerDir): Promise<DependenciesFile>`
   - `writeDependencies(trackerDir, deps): Promise<void>`
   - `addBlockage(deps, blockedId, blockerId): DependenciesFile` (both maps)
   - `resolveBlockage(deps, blockedId, blockerId): DependenciesFile`
   - `deleteBlockage(deps, blockedId, blockerId): DependenciesFile`
   - `getImpactScore(deps, issueId): number` (count active entries in `blocks`)

2. **Implement cycle detection**
   - `detectCycle(deps, blockedId, blockerId): boolean`
   - Walk `blockedBy` graph transitively from `blockerId`.
   - If `blockedId` is reached → cycle.
   - Only consider `active` entries.

3. **Implement batch blockage add with projected state**
   - Copy dependency graph to memory.
   - For each blocker: add to projected graph, check cycle.
   - If any cycle → reject entire batch.
   - If all pass → write to file.

4. **Implement Tracker.blockagesAdd/Resolve/Delete/List**

5. **Implement auto-resolution on status change**
   - When issue transitions to `done`/`closed`:
     - Look up `blocks[issueId]` for active entries.
     - Resolve each in both maps.
     - Append `blockage-resolved` event to each blocked issue.

6. **Integrate impact score into list sort order**
   - Priority ASC → impact score DESC → id ASC.

7. **Wire CLI commands** for blockages add, resolve, delete, list.

### Tests

- Add blockage: both maps updated, event appended.
- Add blockage with cycle → `BLOCKAGE_CYCLE`, no side effects.
- Batch add: all succeed or all fail (atomicity).
- Resolve blockage: status changes in both maps, event appended.
- Delete blockage: removed from both maps, event appended.
- List blockages: returns both `blockedBy` and `blocks`.
- Auto-resolution: issue set to done → active blocks resolved, events on blocked issues.
- Impact score: correct count, reflected in list sort order.

### Exit Criteria

- Full blockage lifecycle with cycle detection and auto-resolution.
- List sorted by priority → impact → age.

---

## Phase 7: Polish & Hardening

**Goal:** Production-ready package.

### Tasks

1. **Edge case testing**
   - Empty tracker (no issues).
   - Large number of events.
   - Concurrent write scenarios (at least documented behavior).
   - Invalid JSON in files.
   - Missing files detected during operations.

2. **Package configuration**
   - Verify `package.json` exports, bin, files fields.
   - Test installation via `npm link` or workspace reference.
   - Test `trackgentic` command works after install.

3. **Error messages**
   - All error messages are clear and actionable.
   - Consistent error format across all commands.

4. **JSDoc comments**
   - All public Tracker methods have JSDoc.
   - All exported types have descriptions.

### Exit Criteria

- Package installs and CLI works from any directory.
- All tests pass with `bun test`.
- No unhandled error paths.
