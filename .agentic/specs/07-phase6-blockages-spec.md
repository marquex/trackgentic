# Phase 6: Blockages & Dependencies — Implementation Specification

## Context

Phase 5 (hierarchy) is complete: 284 tests, 1101 assertions, 99.31% coverage. All quality gates passing. Phase 6 adds the blockage/dependency system: bidirectional dependency maps, cycle detection, batch atomicity, auto-resolution, impact score, and the corresponding CLI commands.

## Files to Create/Modify

### New Files
- `src/core/dependency-manager.ts` — Full implementation (currently a stub)
- `tests/core/dependency-manager.test.ts` — Unit tests for dependency manager

### Modified Files
- `src/core/tracker.ts` — Add 4 blockage methods + auto-resolution integration in `update()`
- `src/core/events.ts` — May need `computeBlockages` helper (optional, can be internal to tracker)
- `src/cli/commands/blockages.ts` — CLI commands (currently stub)
- `src/cli/runner.ts` — Register blockages subcommand (likely already registered from earlier phases)
- `tests/core/tracker.test.ts` — Add blockage tests
- `tests/cli/commands.test.ts` — Add blockage CLI tests

## 1. dependency-manager.ts — Full Implementation

This module manages the `dependencies.json` file. It provides pure functions for reading, writing, and querying the bidirectional dependency graph.

### Functions to Implement

```typescript
import type { DependenciesFile, BlockageEntry, IssueId } from "../types";

/** Read dependencies.json from the tracker directory */
export async function readDependencies(trackerDir: string): Promise<DependenciesFile>;

/** Write dependencies.json atomically */
export async function writeDependencies(trackerDir: string, deps: DependenciesFile): Promise<void>;

/** Add a blockage entry to BOTH maps (blockedBy and blocks) */
export function addBlockage(
  deps: DependenciesFile,
  blockedId: IssueId,
  blockerId: IssueId
): DependenciesFile;

/** Mark a blockage as resolved in both maps */
export function resolveBlockage(
  deps: DependenciesFile,
  blockedId: IssueId,
  blockerId: IssueId
): DependenciesFile;

/** Remove a blockage entry entirely from both maps */
export function deleteBlockage(
  deps: DependenciesFile,
  blockedId: IssueId,
  blockerId: IssueId
): DependenciesFile;

/** Count active entries in blocks[issueId] — used for impact score */
export function getImpactScore(deps: DependenciesFile, issueId: IssueId): number;

/** Detect if adding blockedId→blockerId would create a cycle.
 *  Walk blockedBy graph transitively from blockerId.
 *  If blockedId is reached at any point → cycle detected.
 *  Only consider entries with status === "active". */
export function detectCycle(
  deps: DependenciesFile,
  blockedId: IssueId,
  blockerId: IssueId
): boolean;
```

### BlockageEntry Shape (reminder)

```typescript
interface BlockageEntry {
  blockerId: IssueId;
  blockedId: IssueId;
  status: "active" | "resolved";
}
```

### Key Invariants

1. **Both maps always in sync.** Every `addBlockage`, `resolveBlockage`, `deleteBlockage` mutates both `blockedBy` and `blocks` maps.
2. **addBlockage** creates entries with `status: "active"`.
3. **resolveBlockage** sets `status: "resolved"` on both sides.
4. **deleteBlockage** removes the entry from both arrays entirely (not just marking resolved).
5. **detectCycle** walks `blockedBy` transitively from `blockerId`. At each step, follow all `active` entries. If `blockedId` is reached → cycle. Uses a visited set to avoid infinite loops from existing cycles (which shouldn't exist, but defensive).

### getImpactScore Logic

```typescript
export function getImpactScore(deps: DependenciesFile, issueId: IssueId): number {
  const blocks = deps.blocks[issueId];
  if (!blocks) return 0;
  return blocks.filter(entry => entry.status === "active").length;
}
```

### detectCycle Algorithm

```
function detectCycle(deps, blockedId, blockerId):
  visited = Set()
  queue = [blockerId]
  while queue is not empty:
    current = queue.shift()
    if current === blockedId: return true (cycle!)
    if visited.has(current): continue
    visited.add(current)
    // What blocks current? Follow blockedBy for active entries
    blockedByCurrent = deps.blockedBy[current] || []
    for each entry in blockedByCurrent where entry.status === "active":
      queue.push(entry.blockerId)
  return false (no cycle)
```

## 2. Tracker Methods

### `blockagesAdd(blockedId: IssueId, params: BlockagesAddParams): Promise<BlockagesAddResult>`

```typescript
interface BlockagesAddParams {
  blockerIds: IssueId[];
  author?: string;
}
```

**Behavior:**
1. Resolve `.trackgentic/` directory. If not found → `NOT_INITIALIZED`.
2. Resolve author via auth.
3. Validate `blockedId` exists in index. If not → `NOT_FOUND`.
4. Validate all `blockerIds` exist in index. If any not found → `NOT_FOUND`.
5. Read current dependencies.
6. **Copy to projected state** (deep clone the deps object).
7. For each `blockerId` in order:
   a. Add blockage to projected state.
   b. Run `detectCycle` on projected state.
   c. If cycle detected → throw `BLOCKAGE_CYCLE` error with message `"Blockage would create a cycle: ${blockedId} → ... → ${blockerId}"`.
8. If all pass → write projected state to `dependencies.json`.
9. For each `blockerId`:
   a. Append `blockage-added` event to `blockedId`'s issue file with `{ blockerId }`.
10. Return `{ result: "OK" }`.

**Important:** Steps 7a-c validate against projected state, so if blockerIds = [A, B] and B→blockedId already exists but A→blockedId is new and creates A→B→blockedId→A, the cycle is caught during the A check against projected state that already includes B.

### `blockagesResolve(blockedId: IssueId, params: BlockagesResolveParams): Promise<BlockagesResolveResult>`

```typescript
interface BlockagesResolveParams {
  blockerIds: IssueId[];
  author?: string;
}
```

**Behavior:**
1. Resolve directory + author.
2. Validate `blockedId` exists in index.
3. Read dependencies.
4. For each `blockerId`:
   a. Find the entry in `blockedBy[blockedId]` where `blockerId` matches.
   b. If not found or already resolved → skip (idempotent).
   c. Set status to `"resolved"` in both maps.
5. Write updated dependencies.
6. For each resolved `blockerId`, append `blockage-resolved` event to `blockedId`'s issue file.
7. Return `{ result: "OK" }`.

### `blockagesDelete(blockedId: IssueId, params: BlockagesDeleteParams): Promise<BlockagesDeleteResult>`

```typescript
interface BlockagesDeleteParams {
  blockerIds: IssueId[];
  author?: string;
}
```

**Behavior:**
1. Resolve directory + author.
2. Validate `blockedId` exists in index.
3. Read dependencies.
4. For each `blockerId`:
   a. Remove entry from `blockedBy[blockedId]` and `blocks[blockerId]`.
   b. If entry doesn't exist → skip (idempotent).
5. Write updated dependencies.
6. For each deleted `blockerId`, append `blockage-deleted` event to `blockedId`'s issue file.
7. Return `{ result: "OK" }`.

### `blockagesList(id: IssueId): Promise<BlockagesListResult>`

```typescript
type BlockagesListResult =
  | BlockageInfo
  | TrackgenticError;

interface BlockageInfo {
  issueId: IssueId;
  blockedBy: BlockageEntry[];
  blocks: BlockageEntry[];
}
```

**Behavior:**
1. Resolve directory.
2. Validate `id` exists in index.
3. Read dependencies.
4. Return `{ issueId: id, blockedBy: deps.blockedBy[id] || [], blocks: deps.blocks[id] || [] }`.

## 3. Auto-Resolution on Status Change

**Integration point:** In `Tracker.update()`, after the status changes to `done` or `closed`:

1. Read `dependencies.json`.
2. Look up `blocks[issueId]` — these are issues that THIS issue blocks.
3. Filter to entries with `status === "active"`.
4. For each active entry:
   a. Set status to `"resolved"` in both maps.
   b. Append `blockage-resolved` event to the blocked issue's file, with `author: "system"` and `reason: "Blocker issue ${issueId} transitioned to ${newStatus}"`.
5. Write updated dependencies.

**Important:** This happens AFTER the main update logic (event appended, index updated), so the issue is already in its new status when auto-resolution fires. Auto-resolution uses `author: "system"` for the event, similar to hierarchy auto-promotion.

## 4. Impact Score Integration into List Sort

**In `Tracker.list()`:** After filtering entries from the index:

1. Read `dependencies.json` once.
2. For each filtered entry, compute `getImpactScore(deps, entry.id)`.
3. Sort by: `priority ASC` → `impact score DESC` → `id ASC` (creation time).

The sort comparator:
```typescript
entries.sort((a, b) => {
  if (a.priority !== b.priority) return a.priority - b.priority; // lower priority number first
  const impactA = getImpactScore(deps, a.id);
  const impactB = getImpactScore(deps, b.id);
  if (impactA !== impactB) return impactB - impactA; // higher impact first
  return a.id.localeCompare(b.id); // older first (id encodes time)
});
```

## 5. CLI Commands (src/cli/commands/blockages.ts)

Four subcommands under `blockages`:

### `trackgentic blockages add <blockedId> --by <blockerId...>`

- `blockedId` is a required positional arg.
- `--by` accepts one or more blocker IDs (comma-separated or repeated flag).
- Calls `tracker.blockagesAdd(blockedId, { blockerIds, author })`.
- Outputs `{ "result": "OK" }` on success.

### `trackgentic blockages resolve <blockedId> --by <blockerId...>`

- Same arg pattern as add.
- Calls `tracker.blockagesResolve(blockedId, { blockerIds, author })`.

### `trackgentic blockages delete <blockedId> --by <blockerId...>`

- Same arg pattern.
- Calls `tracker.blockagesDelete(blockedId, { blockerIds, author })`.

### `trackgentic blockages list <issueId>`

- `issueId` is a required positional arg.
- Calls `tracker.blockagesList(issueId)`.
- Outputs the `BlockageInfo` object.

## 6. Error Handling

Add the `BLOCKAGE_CYCLE` error code (exit code 11). This should already be defined in `errors.ts` from the type stubs — verify and ensure it works:

```typescript
// In errors.ts, ensure this error code exists:
// BLOCKAGE_CYCLE: exitCode 11
```

## 7. Test Requirements

### Unit Tests (tests/core/dependency-manager.test.ts)

- `addBlockage`: both maps updated, entry is active
- `addBlockage` idempotency: adding same blockage twice doesn't duplicate
- `resolveBlockage`: both maps updated to resolved status
- `resolveBlockage` on non-existent entry: no error, no-op
- `deleteBlockage`: entry removed from both maps
- `deleteBlockage` on non-existent entry: no error, no-op
- `getImpactScore`: returns count of active blocks entries
- `getImpactScore` for issue with no blocks: returns 0
- `getImpactScore` ignores resolved entries: returns count of only active
- `detectCycle` direct cycle: A blocks B, B blocks A → detected
- `detectCycle` transitive cycle: A blocks B, B blocks C, C blocks A → detected
- `detectCycle` no cycle: A blocks B, C blocks D → not detected
- `detectCycle` ignores resolved entries: resolved blockage doesn't create cycle
- `detectCycle` self-block: A blocks A → detected

### Tracker Tests (tests/core/tracker.test.ts)

Add a `describe("blockages", ...)` block:

- `blockagesAdd`: creates entries in both maps, appends events
- `blockagesAdd` batch: multiple blockers added atomically
- `blockagesAdd` cycle detection: rejects with `BLOCKAGE_CYCLE`, no side effects
- `blockagesAdd` batch atomicity: if last blocker causes cycle, none written
- `blockagesAdd` NOT_FOUND for blockedId
- `blockagesAdd` NOT_FOUND for blockerId
- `blockagesResolve`: marks as resolved in both maps, appends events
- `blockagesResolve` already resolved: idempotent
- `blockagesResolve` NOT_FOUND for blockedId
- `blockagesDelete`: removes from both maps, appends events
- `blockagesDelete` NOT_FOUND for blockedId
- `blockagesList`: returns both blockedBy and blocks
- `blockagesList` empty: returns empty arrays
- `blockagesList` NOT_FOUND for missing issue
- Auto-resolution: issue set to `done` → active blocks auto-resolved with system events
- Auto-resolution: issue set to `closed` → active blocks auto-resolved
- Auto-resolution: no active blocks → no events appended
- Impact score in list sort: issues sorted by priority → impact → age

### CLI Tests (tests/cli/commands.test.ts)

Add tests for:
- `blockages add <id> --by <id>` → OK
- `blockages add` with cycle → error JSON on stderr
- `blockages resolve <id> --by <id>` → OK
- `blockages delete <id> --by <id>` → OK
- `blockages list <id>` → correct JSON

## 8. Implementation Order

1. Implement `dependency-manager.ts` (all pure functions)
2. Write `dependency-manager.test.ts` unit tests, verify they pass
3. Add `BLOCKAGE_CYCLE` to errors if not already there
4. Implement `blockagesAdd`, `blockagesResolve`, `blockagesDelete`, `blockagesList` in Tracker
5. Add auto-resolution to `Tracker.update()`
6. Integrate impact score into `Tracker.list()` sort
7. Wire CLI commands in `blockages.ts` and `runner.ts`
8. Write Tracker blockage tests + CLI blockage tests
9. Run full quality gate: `typecheck + lint + test:coverage`

## 9. Exit Criteria

- [ ] `dependency-manager.ts` fully implemented with all 7 exported functions
- [ ] Cycle detection works: direct, transitive, and self-referential cycles rejected
- [ ] Batch add is atomic: all cycle checks pass before any write
- [ ] All 4 Tracker blockage methods work through both API and CLI
- [ ] Auto-resolution fires when issue transitions to `done`/`closed`
- [ ] Impact score reflected in list sort order
- [ ] `BLOCKAGE_CYCLE` error code (exit 11) working
- [ ] All existing tests still pass (no regressions)
- [ ] New tests cover: happy paths, error paths, edge cases, batch atomicity, auto-resolution
- [ ] Quality gate: `typecheck` clean, `lint` clean, `test:coverage` >= 99%
