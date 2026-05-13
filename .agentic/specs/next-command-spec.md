# Spec: `next <user-name>` Command

## Summary

Add a new `trackgentic next <user-name>` CLI subcommand that returns the single best issue to work on next for a given user. This is a read-only operation (no mutation).

## Requirements

### Selection Algorithm

Given a `user-name` string argument:

1. **Filter** the open index (`index.open` array) to issues where:
   - `assignee === userName` (exact string match, case-sensitive as stored)
   - `status` is one of: `"idea"`, `"todo"`, `"in-progress"` (exclude `"done"` and `"closed"`)
2. **Filter out** any issues with active blockages — i.e., issues where `dependencies.blockedBy[issueId]` contains at least one entry with `status === "active"`
3. **Sort** remaining issues by:
   - `priority` ASC (1 is highest priority, 5 is lowest)
   - Impact score DESC (count of active entries in `dependencies.blocks[issueId]` — more blocking = higher priority)
   - `id` ASC (oldest first, since IDs are time-sortable)
4. **Return** the full `ComputedIssue` (same shape as `view` command) for the top-ranked issue
5. If no issues match, return `{ result: "NO_ISSUES_AVAILABLE", message: "..." }`

### API Design

#### Tracker method

```typescript
async next(assignee: string): Promise<NextResult>
```

#### Result type (add to `types/api.ts`)

```typescript
/** Result of the next command — the recommended issue to work on, or no issues available. */
export type NextResult = ComputedIssue | { result: "NO_ISSUES_AVAILABLE"; message: string };
```

#### CLI command

```
trackgentic next <user-name>
```

- `<user-name>` is a required positional argument (the assignee name to filter by)
- Output: JSON to stdout on success, JSON error to stderr on failure
- Auth: read operation (same as `list`, `view`)

### Error handling

- `NOT_INITIALIZED` — no `.trackgentic/` directory found
- `TOKEN_REQUIRED` — in strict auth mode with no token
- `NO_ISSUES_AVAILABLE` — no matching issues (not an error per se, but a result indicating emptiness)

### Sorting reuse

The sort order is identical to the existing `list` command: **priority ASC → impact DESC → id ASC**. The `list` method in `tracker.ts` already implements this pattern with `readDependenciesSync` and `getImpactScore`. Follow the same approach.

## Files to modify/create

1. **`src/types/api.ts`** — Add `NextResult` type export
2. **`src/types/index.ts`** — Re-export `NextResult` from `./api`
3. **`src/index.ts`** — Export `NextResult` in the response types section
4. **`src/core/tracker.ts`** — Add `next(assignee: string): Promise<NextResult>` method
5. **`src/cli/commands/next.ts`** — New file: CLI action handler for `next`
6. **`src/cli/runner.ts`** — Register the `next <user-name>` command

## Implementation details

### Tracker.next() method

```typescript
async next(assignee: string): Promise<NextResult> {
  // 1. Resolve tracker dir (throw NOT_INITIALIZED if not found)
  // 2. Auth check (read operation, same as list/view)
  // 3. Read index
  // 4. Filter index.open to: assignee matches AND status in (idea, todo, in-progress)
  // 5. Read dependencies
  // 6. Filter out issues with any active blockages in blockedBy map
  // 7. Sort: priority ASC → impact DESC → id ASC (reuse readDependenciesSync + getImpactScore pattern)
  // 8. If empty → return { result: "NO_ISSUES_AVAILABLE", message: "No unblocked issues found for user '<user>'." }
  // 9. Take top issue, replay events, return ComputedIssue (same as view method)
}
```

### CLI command handler (`src/cli/commands/next.ts`)

Follow the exact pattern of `view.ts`:
- Create Tracker instance
- Call `tracker.next(userName)`
- Write result to stdout via `writeStdout`
- Catch TrackgenticError → writeStderr, process.exit(err.exitCode)

### Runner registration (`src/cli/runner.ts`)

Add after the `list` command block:

```typescript
// ─── next ──────────────────────────────────────────────────────────
program
  .command("next <userName>")
  .description("Get the recommended next issue to work on for a user")
  .action(nextAction);
```

Import `nextAction` from `./commands/next`.

## Testing requirements

Add tests in `tests/cli/commands.test.ts` in a new `describe("next", ...)` block covering:

1. **Basic case** — Create several issues with different priorities/assignees, verify the right one is returned
2. **Blocked issue excluded** — An issue with an active blockage should not be returned even if it has highest priority
3. **Impact score tiebreak** — Two issues with same priority, the one blocking more issues wins
4. **No matching issues** — Returns `NO_ISSUES_AVAILABLE` when no open issues assigned to user
5. **Not initialized** — Returns `NOT_INITIALIZED` error
6. **Done/closed excluded** — Issues with done/closed status are not considered
7. **Resolved blockage treated as unblocked** — An issue with only resolved blockages should still be eligible

Also add unit tests in `tests/core/tracker/` for the `Tracker.next()` method directly.

## Constraints

- Follow existing patterns exactly (Tracker method + CLI action + runner registration)
- Reuse `getImpactScore` from `dependency-manager.ts`
- Reuse `readDependenciesSync` helper already in `tracker.ts`
- Reuse `replayEvents` + `computeState` for full computed issue output (same as `view`)
- This is a read-only operation — no events are appended, no files are written
- Case-sensitive assignee matching (consistent with how `list --assignee` works)
