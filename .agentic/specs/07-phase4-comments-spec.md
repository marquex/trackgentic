# Phase 4: Comments — Detailed Implementation Specification

This spec provides precise, file-by-file implementation instructions for the comments lifecycle. All types, event shapes, and API contracts are already defined in the existing spec files. This document tells you exactly what to implement and where.

## Context

Phase 3 is complete: 167 tests, 99.22% coverage, all quality gates passing. The event engine, CRUD, auth system, and user management are fully working. You are adding comment support on top of this foundation.

## What Already Exists

- `generateCommentId()` in `src/core/id.ts` — already implemented, same format as issue IDs
- Event types `CommentEvent`, `CommentUpdateEvent`, `CommentDeleteEvent` in `src/types/event.ts`
- API types `CommentAddParams`, `CommentAddResult`, `CommentUpdateParams`, `CommentUpdateResult`, `CommentDeleteResult`, `CommentsListResult` in `src/types/api.ts`
- `ComputedComment` type in `src/types/issue.ts`
- `appendEvent()` and `replayEvents()` in `src/core/events.ts`
- `COMMENT_NOT_FOUND` error code (exit code 7) in `src/core/errors.ts`
- Auth integration pattern: all mutating methods call `resolveAuthor()` first
- CLI pattern: commands in `src/cli/commands/`, registered in `src/cli/runner.ts`
- Test patterns: `tests/core/tracker.test.ts` for Tracker tests, `tests/cli/commands.test.ts` for CLI tests

## Implementation Tasks

### Task 1: Implement `computeComments()` in `src/core/events.ts`

Add a new exported function alongside the existing `computeState()`:

```typescript
export function computeComments(events: Event[]): ComputedComment[]
```

**Logic:**
1. Filter events to only comment-related types: `comment`, `comment-update`, `comment-delete`
2. Build a `Map<CommentId, ComputedComment>` by replaying in order:
   - `comment` event → create new entry: `{ id, author: event.author, content, timestamp: event.timestamp, editedAt: null }`
   - `comment-update` event → find entry by id, update `content` and set `editedAt` to event timestamp. If entry doesn't exist or was deleted, skip.
   - `comment-delete` event → remove entry from the map
3. Return the map values as an array, sorted by `timestamp` ascending (creation order)

**Important:** This function operates on the full event array (same as `computeState`), not a filtered subset. The filtering happens inside the function.

### Task 2: Implement four Tracker methods in `src/core/tracker.ts`

All four methods follow the same patterns as existing methods:
- Resolve tracker directory
- Read index + config + users for auth
- Call `resolveAuthor()` for mutations (add/update/delete)
- Validate issue exists via index lookup
- Validate issue file exists via file-io
- Return results or throw `TrackgenticError`

#### `commentsAdd(id: IssueId, params: CommentAddParams): Promise<CommentAddResult>`

1. Resolve author via `resolveAuthor()` (write operation)
2. Look up issue in index — if not found, throw `NOT_FOUND`
3. Read index entry path, verify file exists — if missing, throw `ISSUE_MISSING`
4. Generate comment ID via `generateCommentId()`
5. Build a `CommentEvent`:
   ```typescript
   {
     timestamp: new Date().toISOString(),
     type: "comment",
     author: resolvedAuthor,
     content: { id: commentId, content: params.content }
   }
   ```
6. Append event to issue file via `appendEvent()`
7. Return `{ result: "OK", commentId }`

#### `commentsUpdate(id: IssueId, commentId: CommentId, params: CommentUpdateParams): Promise<CommentUpdateResult>`

1. Resolve author via `resolveAuthor()` (write operation)
2. Look up issue in index — if not found, throw `NOT_FOUND`
3. Verify file exists — if missing, throw `ISSUE_MISSING`
4. Replay events and compute comments via `computeComments()`
5. Check if `commentId` exists in computed comments — if not, throw `COMMENT_NOT_FOUND`
6. Build a `CommentUpdateEvent`:
   ```typescript
   {
     timestamp: new Date().toISOString(),
     type: "comment-update",
     author: resolvedAuthor,
     content: { id: commentId, content: params.content }
   }
   ```
7. Append event to issue file
8. Return `{ result: "OK" }`

#### `commentsDelete(id: IssueId, commentId: CommentId, params?: CommentDeleteParams): Promise<CommentDeleteResult>`

1. Resolve author via `resolveAuthor()` (write operation)
2. Look up issue in index — if not found, throw `NOT_FOUND`
3. Verify file exists — if missing, throw `ISSUE_MISSING`
4. Replay events and compute comments via `computeComments()`
5. Check if `commentId` exists in computed comments — if not, throw `COMMENT_NOT_FOUND`
6. Build a `CommentDeleteEvent`:
   ```typescript
   {
     timestamp: new Date().toISOString(),
     type: "comment-delete",
     author: resolvedAuthor,
     content: { id: commentId }
   }
   ```
7. Append event to issue file
8. Return `{ result: "OK" }`

#### `commentsList(id: IssueId): Promise<CommentsListResult>`

1. Resolve author via `resolveAuthor()` (read operation)
2. Look up issue in index — if not found, throw `NOT_FOUND`
3. Verify file exists — if missing, throw `ISSUE_MISSING`
4. Replay events via `replayEvents()`
5. Compute comments via `computeComments(events)`
6. Return the computed comments array

### Task 3: Implement CLI commands in `src/cli/commands/comments.ts`

Create a new file following the pattern of existing command files (e.g., `users.ts`). Register a `comments` subcommand with four sub-subcommands:

#### `trackgentic comments add <issueId> --content <content>`
- Positional: `issueId`
- Required flag: `--content`
- Calls: `tracker.commentsAdd(issueId, { content, author })`
- Output: `{ "result": "OK", "commentId": "..." }`

#### `trackgentic comments update <issueId> <commentId> --content <content>`
- Positional: `issueId`, `commentId`
- Required flag: `--content`
- Calls: `tracker.commentsUpdate(issueId, commentId, { content, author })`
- Output: `{ "result": "OK" }`

#### `trackgentic comments delete <issueId> <commentId>`
- Positional: `issueId`, `commentId`
- No flags
- Calls: `tracker.commentsDelete(issueId, commentId, { author })`
- Output: `{ "result": "OK" }`

#### `trackgentic comments list <issueId>`
- Positional: `issueId`
- No flags
- Calls: `tracker.commentsList(issueId)`
- Output: array of computed comments

### Task 4: Register comments commands in `src/cli/runner.ts`

Add the comments command to the CLI runner, following the same pattern as the `users` command registration. Import from `./commands/comments` and register on the program.

### Task 5: Export `computeComments` from `src/index.ts` if not already exported

Check that `ComputedComment` is exported from the types index. The `computeComments` function should NOT be exported (it's internal).

### Task 6: Tests

Add tests to `tests/core/tracker.test.ts` for Tracker comment methods, and `tests/cli/commands.test.ts` for CLI comment commands.

#### Tracker tests to add (in a new describe block "comments"):

1. **add comment**: creates a comment event, returns commentId
2. **add comment to non-existent issue**: throws NOT_FOUND
3. **update comment**: appends comment-update event, verify via commentsList
4. **update comment sets editedAt**: after update, editedAt is non-null
5. **update non-existent comment**: throws COMMENT_NOT_FOUND
6. **update deleted comment**: throws COMMENT_NOT_FOUND
7. **delete comment**: excluded from commentsList
8. **delete non-existent comment**: throws COMMENT_NOT_FOUND
9. **double delete**: throws COMMENT_NOT_FOUND on second delete
10. **comments list**: returns comments in creation order
11. **comments list after add+update+delete**: returns correct state
12. **comments on non-existent issue**: throws NOT_FOUND
13. **comments on missing file**: throws ISSUE_MISSING

#### Event-level tests (in `tests/core/events.test.ts` or tracker test):

14. **computeComments**: single comment
15. **computeComments**: multiple comments in order
16. **computeComments**: update changes content
17. **computeComments**: delete excludes comment
18. **computeComments**: mixed add/update/delete sequence
19. **computeComments**: ignores non-comment events

#### CLI tests to add:

20. `trackgentic comments add <id> --content "text"` — returns OK with commentId
21. `trackgentic comments update <id> <cid> --content "new"` — returns OK
22. `trackgentic comments delete <id> <cid>` — returns OK
23. `trackgentic comments list <id>` — returns comment array

## Quality Gates

After implementation, all of these must pass:

```bash
cd packages/library
bun run typecheck   # zero errors
bun run lint        # zero errors, zero warnings
bun run format:check # zero issues
bun run test:coverage # all tests pass, coverage >= 99%
bun run docs:check  # TypeDoc parses cleanly
```

## File Change Summary

| File | Action |
|------|--------|
| `src/core/events.ts` | Add `computeComments()` function |
| `src/core/tracker.ts` | Add 4 methods: commentsAdd, commentsUpdate, commentsDelete, commentsList |
| `src/cli/commands/comments.ts` | **New file** — comments CLI commands |
| `src/cli/runner.ts` | Register comments subcommand |
| `src/types/index.ts` | Verify ComputedComment is exported (should already be) |
| `src/index.ts` | Verify exports are correct |
| `tests/core/tracker.test.ts` | Add comment tests (~13 tests) |
| `tests/core/events.test.ts` | Add computeComments tests (~6 tests) |
| `tests/cli/commands.test.ts` | Add CLI comment tests (~4 tests) |

## Expected Outcome

- ~23 new tests added
- Coverage should remain at or above 99%
- Full comment lifecycle works through both API and CLI
- Phase 4 exit criteria met: "Full comment CRUD with computed state from event replay"
