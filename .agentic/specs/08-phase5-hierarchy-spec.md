# Phase 5: Issue Hierarchy — Implementation Specification

## Context

Phases 1-4 are complete: event engine, CRUD, auth/users, and comments are all implemented and passing tests (216 tests, 972 assertions, 99.22% coverage). Phase 5 adds parent-child relationships with status constraint enforcement.

## Goal

Implement tree hierarchy for issues via `parentId`, with:
- **childrenOf map** in `index.json` for O(1) child lookups
- **Upward auto-promotion** — child advancing past parent promotes parent recursively
- **Downward cascade** — closing parent auto-closes done children; non-done children block closure
- **Reparenting** — updating `parentId` moves childrenOf entries correctly

## Status Progression Reference

```
idea -> todo -> in-progress -> done -> closed
```

"Advancing past" means the child's status is strictly after the parent's in this progression.

## Tasks

### Task 1: childrenOf Map Management (index-manager.ts)

Add three functions to `src/core/index-manager.ts`:

```typescript
/** Add childId to parentId's children array in childrenOf map */
export function addChild(
  index: IndexFile,
  parentId: IssueId,
  childId: IssueId
): IndexFile

/** Remove childId from parentId's children array in childrenOf map */
export function removeChild(
  index: IndexFile,
  parentId: IssueId,
  childId: IssueId
): IndexFile

/** Get all child IDs for a given parent. Returns empty array if no children. */
export function getChildren(index: IndexFile, parentId: IssueId): IssueId[]
```

**Behavior:**
- `addChild`: if `childrenOf[parentId]` doesn't exist, create it as `[childId]`. Otherwise push `childId` if not already present.
- `removeChild`: filter `childId` out of `childrenOf[parentId]`. If the resulting array is empty, delete the key from the map.
- `getChildren`: return `index.childrenOf[parentId] ?? []`.
- All three return a new `IndexFile` (immutable pattern matching existing code style).

### Task 2: Hierarchy Constraint Validation (new file: src/core/hierarchy.ts)

Create a new module `src/core/hierarchy.ts` with hierarchy enforcement logic:

```typescript
import type { IndexFile, IssueId, IssueStatus, Event } from "../types";
import type { IndexEntry } from "../types";

/**
 * Check if childStatus is strictly after parentStatus in the progression.
 * Progression: idea -> todo -> in-progress -> done -> closed
 */
function isStatusAfter(childStatus: IssueStatus, parentStatus: IssueStatus): boolean

/**
 * Validate that a parent can accept a new child.
 * Returns an error message if the parent is closed, null otherwise.
 */
export function validateNewChild(
  parentEntry: IndexEntry | null
): string | null

/**
 * Validate that a parent can transition to the target status.
 * Returns an error message if downward constraints are violated, null otherwise.
 * Rule: parent cannot move to done/closed if any child has status before done/closed.
 */
export function validateParentStatusChange(
  index: IndexFile,
  childEntries: IndexEntry[],
  targetStatus: IssueStatus
): string | null

/**
 * Determine which children need to be auto-closed when parent closes.
 * Returns entries that are done (they can be auto-closed).
 * Does NOT return non-done children (those BLOCK the closure — caller handles that).
 */
export function getClosableChildren(
  childEntries: IndexEntry[]
): IndexEntry[]

/**
 * Auto-promote parent if child's new status is past parent's status.
 * Returns update events to apply to parents (walks up recursively).
 * Each event has author: "system" and a reason field explaining the promotion.
 *
 * @param index - current index
 * @param parentEntry - the direct parent's index entry
 * @param childStatus - the child's new status
 * @param allEntries - lookup function to find entries by id across both arrays
 * @returns array of { issueId, event: UpdateEvent } for system-authored promotions
 */
export function computeUpwardPromotions(
  index: IndexFile,
  parentEntry: IndexEntry,
  childStatus: IssueStatus,
  findEntry: (id: IssueId) => IndexEntry | null
): Array<{ issueId: IssueId; event: Event }>
```

**Status progression order for `isStatusAfter`:**
```typescript
const STATUS_ORDER: IssueStatus[] = ["idea", "todo", "in-progress", "done", "closed"];
// isStatusAfter("done", "in-progress") === true
// isStatusAfter("done", "done") === false
// isStatusAfter("todo", "in-progress") === false
```

**`validateNewChild`:**
- If `parentEntry` is null, return null (no constraint — issue being created without parent).
- If `parentEntry.status === "closed"`, return `"Cannot add child to closed parent"`.
- Otherwise return null.

**`validateParentStatusChange`:**
- If `targetStatus` is not `"done"` or `"closed"`, return null (no downward constraints for other transitions).
- For each child in `childEntries`:
  - If child status is before `"done"` in progression AND targetStatus is `"done"` or `"closed"`:
    - Return `"Cannot set parent to ${targetStatus}: child ${child.id} has status '${child.status}'"`
- Return null if all children are done or closed.

**`getClosableChildren`:**
- Return all entries where `status === "done"`. These will be auto-closed.
- Non-done children are NOT returned — the caller must first validate that no non-done/non-closed children exist before proceeding with closure.

**`computeUpwardPromotions`:**
- If `childStatus` is not after `parentEntry.status`, return `[]` — no promotion needed.
- Otherwise:
  - Create an update event for the parent with `{ status: childStatus }`, `author: "system"`, and `reason: "auto-promoted: child advanced to '${childStatus}'"`.
  - If the parent itself has a parent, recurse.
  - Return all promotion events in order (direct parent first, then grandparent, etc.).

### Task 3: Integrate Hierarchy into Tracker.create()

In `src/core/tracker.ts`, modify the `create` method:

**After generating the ID but before returning**, add:

1. If `params.parentId` is set:
   a. Look up `params.parentId` in the index using `findEntry`.
   b. If not found → throw `NOT_FOUND` error with message `"Parent issue not found"`.
   c. Call `validateNewChild(parentEntry)`. If it returns a string → throw `HIERARCHY_CONSTRAINT` error.
   d. After inserting into the index, call `addChild(index, parentId, issueId)`.

**Error code:** `HIERARCHY_CONSTRAINT` with exit code `12`.

### Task 4: Integrate Hierarchy into Tracker.update()

In `src/core/tracker.ts`, modify the `update` method. This is the most complex integration.

**After appending the update event and recomputing state, but before writing the updated index:**

#### 4a. Status change handling

If `params.status` was provided and differs from the old status:

1. **Downward constraints** (parent closing):
   - Get children of this issue from the index: `getChildren(index, issueId)`.
   - Look up each child's entry in the index.
   - If target status is `"done"` or `"closed"`:
     - Call `validateParentStatusChange(index, childEntries, params.status)`.
     - If it returns a string → throw `HIERARCHY_CONSTRAINT` error.
   - If target status is `"closed"`:
     - Call `getClosableChildren(childEntries)`.
     - For each closable child (status === "done"):
       - Append a system update event to that child's issue file with `{ status: "closed" }`, `author: "system"`, `reason: "auto-closed: parent closed"`.
       - Update that child's index entry status to `"closed"`.
       - Move the child between open/closed arrays if needed.
       - Recursively apply downward cascade to the child's own children.

2. **Upward constraints** (child advancing):
   - If target status is `"done"` or `"closed"` and the issue has a `parentId`:
     - Look up the parent entry.
     - Call `computeUpwardPromotions(index, parentEntry, params.status, findEntry)`.
     - For each promotion in the result array:
       - Append the system update event to that parent's issue file.
       - Update that parent's index entry with the new status.
       - Move between open/closed arrays if needed.

#### 4b. parentId change handling

If `params.parentId` was provided and differs from the old `parentId`:

1. **Detach from old parent** (if old parentId was not null):
   - Call `removeChild(index, oldParentId, issueId)`.

2. **Attach to new parent** (if new parentId is not null):
   a. Look up new parent in index. If not found → throw `NOT_FOUND`.
   b. Call `validateNewChild(newParentEntry)`. If constraint violated → throw `HIERARCHY_CONSTRAINT`.
   c. Call `addChild(index, newParentId, issueId)`.
   d. If the issue's current status is after the new parent's status:
      - Call `computeUpwardPromotions(index, newParentEntry, currentStatus, findEntry)`.
      - Apply each promotion event as described above.

3. **Special case: detaching** (new parentId is null):
   - Just remove from old parent's childrenOf. No constraint checks needed.

### Task 5: Error Code Registration

In `src/core/errors.ts`, add the `HIERARCHY_CONSTRAINT` error code:

- Code: `"HIERARCHY_CONSTRAINT"`
- Exit code: `12`
- This error code is already documented in the API spec but may not yet be registered in the errors module.

### Task 6: Update IndexEntry Type (if needed)

Ensure the `IndexEntry` type includes `parentId: IssueId | null`. This should already exist from Phase 2, but verify it's present in `src/types/index-file.ts`.

### Task 7: No CLI Changes Required

The CLI already supports `--parentId` on `create` and `update` commands from Phase 2. The `list --parentId` flag also already exists. No CLI modifications are needed for Phase 5.

## Implementation Order

1. Add `HIERARCHY_CONSTRAINT` to errors.ts (if not already present)
2. Add `addChild`, `removeChild`, `getChildren` to index-manager.ts
3. Create hierarchy.ts with all constraint functions
4. Modify tracker.ts create() — add parent validation
5. Modify tracker.ts update() — add status change constraints + parentId change logic
6. Write tests

## Tests Required

### Unit tests for hierarchy.ts

- `isStatusAfter`: all combinations — same status (false), child after (true), child before (false), all statuses
- `validateNewChild`: null parent → null, closed parent → error string, open parent → null, idea parent → null
- `validateParentStatusChange`: no children → null, all children done/closed → null, one child in-progress → error, target not done/closed → null
- `getClosableChildren`: mix of statuses → only done entries returned, no done → empty, all done → all returned
- `computeUpwardPromotions`: child behind parent → empty, child equal → empty, child ahead → one promotion, multi-level → recursive promotions

### Unit tests for index-manager childrenOf functions

- `addChild`: new key created, existing key appended, duplicate ignored
- `removeChild`: removed correctly, key deleted when empty, no-op if not found
- `getChildren`: returns children, returns empty for missing key

### Integration tests for tracker.ts

- **Create with parentId:**
  - Creates issue under valid parent → childrenOf updated
  - Creates issue under non-existent parent → `NOT_FOUND`
  - Creates issue under closed parent → `HIERARCHY_CONSTRAINT`

- **Update status with children:**
  - Parent → done with in-progress child → `HIERARCHY_CONSTRAINT`
  - Parent → done with all children done/closed → OK
  - Parent → closed with done children → children auto-closed, system events in history
  - Parent → closed with in-progress child → `HIERARCHY_CONSTRAINT`

- **Update status upward promotion:**
  - Child → in-progress when parent is idea → parent auto-promoted to in-progress
  - Child → done when parent is in-progress → parent auto-promoted to done
  - Multi-level: grandchild → done → child promoted → parent promoted
  - Child → done when parent already done → no promotion

- **Reparenting:**
  - Update parentId to new parent → childrenOf updated (removed from old, added to new)
  - Update parentId to closed parent → `HIERARCHY_CONSTRAINT`
  - Update parentId to non-existent parent → `NOT_FOUND`
  - Detach (parentId = null) → removed from childrenOf, no errors
  - Reparent with upward constraint → parent auto-promoted

## Key Design Notes

1. **System events** use `author: "system"` and include a `reason` field in the update event content. They appear in `history()` output like any other event.

2. **Downward cascade is recursive**: closing a parent auto-closes done children, which may trigger their own downward cascade (auto-closing their done children).

3. **Upward promotion is recursive**: promoting a parent may trigger promotion of the grandparent, and so on up the tree.

4. **Order matters**: Downward cascade happens AFTER validating that no non-done children exist. Upward promotion happens AFTER the child's own update is committed.

5. **childrenOf map**: Only stores direct children. To find all descendants, walk recursively. Keys only exist for issues that have children.

6. **The HIERARCHY_CONSTRAINT error prevents the operation entirely** — no partial state changes. If a constraint is violated, the update is rejected.

## Exit Criteria

- `create` with `parentId` validates parent exists and is not closed
- `update` status change enforces downward constraints (blocks invalid, cascades on close)
- `update` status change triggers upward auto-promotion
- `update` parentId change handles reparenting with constraint checks
- System-authored events appear in `history()` with `author: "system"` and `reason` field
- All existing tests continue to pass
- New tests cover all constraint scenarios listed above
- Quality gates pass: typecheck, lint, format, test coverage >= 99%
