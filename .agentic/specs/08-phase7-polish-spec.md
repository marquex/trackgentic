# Phase 7: Polish & Hardening — Implementation Specification

**Goal:** Production-ready package with comprehensive edge case coverage, JSDoc documentation, polished error messages, and verified package configuration.

---

## Task 1: JSDoc Comments on All Public API Surface

### Scope

Every exported function, method, class, interface, and type alias must have a JSDoc comment. This is the public API surface as defined in `src/index.ts`.

### Files to modify

1. **`src/core/tracker.ts`** — The `Tracker` class and its 16 public methods:
   - `constructor(cwd?: string)` — Explain cwd defaults to `process.cwd()`
   - `init()` — Creates `.trackgentic/` directory with all initial files
   - `create(params)` — Creates a new issue; describes all params with defaults
   - `list(params?)` — Lists issues from index with optional filters; describes sort order
   - `view(id)` — Returns full computed state by replaying events
   - `update(id, params)` — Updates issue fields; hierarchy/blockage side effects
   - `history(id)` — Returns raw event array for an issue
   - `commentsAdd(id, params)` — Adds a comment event
   - `commentsUpdate(id, commentId, params)` — Updates a comment
   - `commentsDelete(id, commentId, params?)` — Soft-deletes a comment
   - `commentsList(id)` — Returns computed comment list
   - `blockagesAdd(blockedId, params)` — Adds blockage(s); batch atomic, cycle detection
   - `blockagesResolve(blockedId, params)` — Resolves blockage(s)
   - `blockagesDelete(blockedId, params)` — Deletes blockage(s)
   - `blockagesList(id)` — Returns blockage info for an issue
   - `usersRegister(name)` — Registers user, returns token (no auth required)
   - `usersList()` — Lists users without tokens
   - `usersRevoke(name)` — Removes a user
   - `usersRegenerate(name)` — Regenerates own token only

2. **`src/types/issue.ts`** — All exported types:
   - `IssueId` — "10-char string: 6 timestamp base36 + 4 random base36, sortable by creation time"
   - `CommentId` — "10-char string, same generation as IssueId"
   - `IssueStatus` — "Status progression: idea → todo → in-progress → done → closed"
   - `IssueProperties` — "Mutable properties of an issue"
   - `ComputedIssue` — "Full computed state including timestamps"
   - `ComputedComment` — "Computed state of a comment"

3. **`src/types/event.ts`** — All exported event types:
   - `BaseEvent` — "Base shape shared by all events"
   - `CreationEvent` — "Marks issue birth"
   - `UpdateEvent` — "Records property changes; includes optional reason field for system events"
   - `CommentEvent` — "Adds a new comment"
   - `CommentUpdateEvent` — "Edits an existing comment"
   - `CommentDeleteEvent` — "Soft-deletes a comment"
   - `BlockageAddedEvent` — "Records new dependency"
   - `BlockageResolvedEvent` — "Records dependency resolution"
   - `BlockageDeletedEvent` — "Records dependency removal"
   - `Event` — "Union of all event types"

4. **`src/types/index-file.ts`** — All exported types:
   - `IndexEntry` — "Summary of an issue for fast index lookup"
   - `IndexFile` — "Index structure: two sorted arrays + children map"

5. **`src/types/dependency.ts`** — All exported types:
   - `BlockageEntry` — "Single blockage relationship between two issues"
   - `DependenciesFile` — "Bidirectional blockage maps (always in sync)"
   - `BlockageInfo` — "Blockage info for a specific issue (view output)"

6. **`src/types/user.ts`** — All exported types:
   - `UserEntry` — "Registered user with token"
   - `UsersFile` — "Users file structure"
   - `UserInfo` — "Public user info without token"

7. **`src/types/config.ts`** — `ConfigFile` interface

8. **`src/types/api.ts`** — All request/response types (params interfaces and result types)

9. **`src/core/errors.ts`** — `TrackgenticError` class and `ErrorCodes` constant

### JSDoc style guide

- Use `@param` for function/method parameters
- Use `@returns` for return values (describe the shape, not just "object")
- Use `@throws` for errors thrown (with error code)
- Use `@example` only for Tracker methods (skip for simple types)
- First sentence is a concise summary (no period needed for short ones)
- Follow with blank line and additional detail if needed

### Example

```typescript
/**
 * Create a new issue.
 *
 * Generates a unique ID, creates the issue file with creation + update events,
 * and inserts an entry into the sorted index.
 *
 * @param params - Creation parameters. `title` is required; all others have defaults.
 * @param params.title - The issue title
 * @param params.description - Optional description, defaults to ""
 * @param params.status - Initial status, defaults to "idea"
 * @param params.priority - Priority 1-5, defaults to 3
 * @param params.assignee - Optional assignee, defaults to null
 * @param params.tags - Optional tags, defaults to []
 * @param params.parentId - Optional parent issue ID for hierarchy
 * @param params.author - Override author (resolved by auth layer if not provided)
 * @returns `{ id }` on success, or a TrackgenticError on auth failure
 * @throws {TrackgenticError} NOT_INITIALIZED if no .trackgentic/ directory
 * @throws {TrackgenticError} NOT_FOUND if parentId doesn't exist in index
 * @throws {TrackgenticError} HIERARCHY_CONSTRAINT if parent is closed
 */
```

### Exit criteria

- `bun run docs:check` passes (TypeDoc parses all source without errors)
- Every export in `src/index.ts` has JSDoc on its declaration
- No `// TODO` or placeholder comments

---

## Task 2: Error Message Polish

### Current state

Error messages are functional but inconsistent. Some use periods, some don't. Some include the ID, others don't.

### Requirements

1. **Consistent format**: All error messages should follow the pattern:
   - `"Descriptive message ending with period."`
   - Use backticks around IDs: `` `abc123` ``
   - Include the operation context when possible

2. **Review and fix all `throw new TrackgenticError(...)` calls in `tracker.ts`**:
   - NOT_INITIALIZED: `"No .trackgentic/ directory found. Run \`trackgentic init\` first."` (already good — verify consistency)
   - NOT_FOUND: `"Issue \`${id}\` not found in index."` (add backticks)
   - ISSUE_MISSING: `"Issue file for \`${id}\` is missing."` (add backticks)
   - COMMENT_NOT_FOUND: `"Comment \`${commentId}\` not found."` (add backticks)
   - HIERARCHY_CONSTRAINT: Keep existing messages from hierarchy.ts
   - BLOCKAGE_CYCLE: Add backticks around IDs
   - INVALID_PARAMS: Keep as is
   - Any others — review for consistency

3. **Review `auth.ts` error messages**:
   - TOKEN_REQUIRED messages are good — verify consistency
   - INVALID_TOKEN: Keep as is
   - DEFAULT_USER_MISSING: Keep as is

4. **Review `hierarchy.ts` error messages**:
   - `"Cannot add child to closed parent"` → consistent format
   - `"Cannot set parent to ${targetStatus}: child ${child.id} has status '${child.status}'"` → use backticks

5. **No functional changes** — only message string updates. All tests should still pass without modification.

### Exit criteria

- All error messages end with a period
- All IDs in error messages are wrapped in backticks
- Consistent tone and format across all error paths
- All 528 existing tests still pass

---

## Task 3: Edge Case & Resilience Testing

### New test file: `tests/integration/edge-cases.test.ts`

Create integration-level tests that verify system resilience. These tests should use the Tracker class directly (not CLI) and test scenarios beyond the happy paths already covered.

#### Test cases

1. **Empty tracker operations**
   - `list()` on empty tracker returns `[]`
   - `view("nonexistent")` returns NOT_FOUND error
   - `history("nonexistent")` returns NOT_FOUND error
   - `commentsList("nonexistent")` returns NOT_FOUND error
   - `blockagesList("nonexistent")` returns NOT_FOUND error
   - `usersList()` on empty tracker returns `[]`

2. **Invalid JSON in files**
   - Corrupt an issue file (write invalid JSON) → `view()` should throw a clear error (not a cryptic parse error)
   - Corrupt `index.json` → `list()` should throw a clear error
   - Corrupt `dependencies.json` → `blockagesList()` should throw a clear error
   - Corrupt `config.json` → any auth operation should throw a clear error

3. **Missing files during operations**
   - Delete an issue file after it's in the index → `view()` returns ISSUE_MISSING
   - Delete an issue file after it's in the index → `update()` returns ISSUE_MISSING
   - Delete an issue file after it's in the index → `commentsAdd()` returns ISSUE_MISSING
   - (These are already partially tested — ensure comprehensive coverage)

4. **Large number of events**
   - Create an issue, then apply 100+ update events → verify `view()` returns correct computed state
   - Create an issue with 50+ comments → verify `commentsList()` returns all correctly
   - Verify performance is reasonable (< 1 second for 100 events)

5. **Self-referencing edge cases**
   - Create issue with itself as parentId → NOT_FOUND (ID doesn't exist yet) — this is already correct behavior
   - Add blockage where blockedId === blockerId → should be caught by cycle detection
   - Update an issue's status to its current status → no-op, no error (verify it works)

6. **Concurrent write documentation**
   - Add a comment in the test file (not a test) documenting that concurrent writes are NOT safe and this is a known limitation documented in the architecture

### Exit criteria

- All edge case tests pass
- No changes to production code (only new test file)
- Total test count increases by at least 15 new tests

---

## Task 4: Package Configuration Verification

### Requirements

1. **Verify `package.json` fields**:
   - `name`: `"trackgentic"` ✓
   - `version`: `"0.1.0"` ✓
   - `type`: `"module"` ✓
   - `main`: Should be `"src/index.ts"` for Bun compatibility ✓
   - `types`: Should be `"src/index.ts"` ✓
   - `exports`: `{ ".": "./src/index.ts" }` ✓
   - `bin`: `{ "trackgentic": "./src/bin.ts" }` ✓
   - `files`: `["src/"]` ✓
   - Verify `description` field exists and is accurate

2. **Verify CLI entry point works**:
   - Test that `bun run src/bin.ts --help` prints help text
   - Test that `bun run src/bin.ts init` creates `.trackgentic/` in cwd
   - Test that `bun run src/bin.ts create --title "Test"` creates an issue

3. **Add a `prepublishOnly` script** to prevent broken publishes:
   ```json
   "prepublishOnly": "bun run quality"
   ```

4. **Verify bin.ts has correct shebang** and is executable

### New test file: `tests/integration/package.test.ts`

- Test that the package.json has all required fields
- Test that the CLI entry point can be invoked with `bun run`
- Test that `--help` flag works
- Test that `--version` flag works (if implemented) or `--help` as fallback

### Exit criteria

- `package.json` has all required fields
- `prepublishOnly` script added
- CLI works from command line
- 3+ new package configuration tests pass

---

## Implementation Order

1. **Task 2 first** (Error Message Polish) — Small, safe, no new files
2. **Task 1 second** (JSDoc Comments) — Large but mechanical, no functional changes
3. **Task 3 third** (Edge Case Testing) — New test file, no production changes
4. **Task 4 last** (Package Configuration) — Small changes to package.json, new test file

After all tasks, run `bun run quality` and verify all gates pass.

---

## Final Exit Criteria (Phase 7 Complete)

- All 528+ tests pass
- `bun run typecheck` — clean
- `bun run lint` — clean
- `bun run format:check` — clean
- `bun run docs:check` — clean
- JSDoc on all public exports
- Error messages consistent and polished
- Edge cases covered by tests
- Package configuration verified
