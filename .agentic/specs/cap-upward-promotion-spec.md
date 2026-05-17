# Cap Upward Auto-Promotion at `in-progress`

**Status: REVIEWED — ready for implementation**

## Summary

Currently, when all children of a parent issue reach status `done`, the parent is automatically promoted to `done` via `computeUpwardPromotions`. This prevents the agent managing the parent from creating additional child issues after the current batch completes. We need to cap upward auto-promotion at `in-progress` so parents are never auto-promoted to `done` or `closed` — those transitions must be explicit.

## Requirements

1. **Auto-promotion stops at `in-progress`**: When a child advances to `in-progress` and its parent is at `idea` or `todo`, the parent is auto-promoted to `in-progress` (existing behavior, unchanged).
2. **No auto-promotion to `done`**: When a child advances to `done`, the parent must NOT be auto-promoted to `done`. The parent stays at whatever status it currently has.
3. **No auto-promotion to `closed`**: When a child advances to `closed`, the parent must NOT be auto-promoted to `closed`. (Closed parents already exist, but auto-promotion to closed is also removed.)
4. **Manual parent transitions still work**: Explicit `tracker.update(parentId, { status: "done" })` must still work, subject to existing hierarchy constraints (children must all be `done`/`closed`).
5. **Downward cascading unchanged**: When a parent is explicitly closed, children that are `done` should still be auto-closed (existing behavior).

## API / Interface Changes

### `computeUpwardPromotions` (hierarchy.ts)

The function currently promotes the parent to match the child's status. Change it to cap the promoted status at `in-progress`:

```
Promoted status = min(childStatus, in-progress)
```

If the computed promoted status is not after the parent's current status, no promotion occurs.

### `STATUS_ORDER` remains unchanged

The status order `["idea", "todo", "in-progress", "done", "closed"]` does not change.

## Implementation Notes

- **File**: `packages/library/src/core/hierarchy.ts` — function `computeUpwardPromotions`
- The function uses `isStatusAfter(childStatus, parentStatus)` to decide whether to promote. After computing the effective promotion status (capped at `in-progress`), use that capped status for both the `isStatusAfter` check and the event content.
- **Tests**: Multiple existing tests assert that parents ARE auto-promoted to `done`. These must be updated to expect the parent to stay at `in-progress` instead.
- **Multi-level tests**: The test "multi-level: grandchild → done → child promoted → parent promoted" (tracker.test.ts ~line 2081) currently expects a cascade to `done` at every level. After this change, no level should reach `done` via auto-promotion.
- Key test cases to update in `hierarchy.test.ts`:
  - Tests at lines ~240, ~248 asserting `"auto-promoted: child advanced to 'done'"` → should expect no promotion event
  - Tests around lines ~277-299 for multi-level promotion to `done`/`closed`
- Key test cases to update in `tracker.test.ts`:
  - "child → done when parent is in-progress — parent auto-promoted" (~line 2067)
  - "multi-level: grandchild → done → child promoted → parent promoted" (~line 2081)

## Clarifications (post-review)

### 1. Reason string format

The event `reason` field should reflect both the target status and the trigger. Use this format:

```
auto-promoted to '<target-status>': child advanced to '<child-status>'
```

Examples:
- Child → `done`, parent at `todo` → `auto-promoted to 'in-progress': child advanced to 'done'`
- Child → `in-progress`, parent at `idea` → `auto-promoted to 'in-progress': child advanced to 'in-progress'`
- Child → `closed`, parent at `idea` → `auto-promoted to 'in-progress': child advanced to 'closed'`

This replaces the current format `auto-promoted: child advanced to '<status>'` with a more explicit version.

### 2. No promotion when capped status equals parent status

If the computed capped status equals the parent's current status, `isStatusAfter(cappedStatus, parentStatus)` returns `false` and **no promotion event is generated**. This is the key behavioral change:

- Child → `done`, parent at `in-progress` → capped = `in-progress` = parent → **no promotion, no event**.
- Child → `done`, parent at `done` → capped = `in-progress` < parent → **no promotion, no event**.
- Child → `done`, parent at `idea` → capped = `in-progress` > parent → **promote to `in-progress`**.

### 3. Multi-level propagation: each level applies cap independently

At each level of the tree walk, the function takes the **original child status** as input, applies the cap (`min(childStatus, in-progress)`), then checks against the parent. The original child status propagates upward (not the capped status).

Since `min(min(x, ip), ip) = min(x, ip)`, the mathematical result is identical either way. But for clarity: the function receives the **triggering child's actual status** at every level, and each level applies the cap independently.

Example: grandparent (idea) → parent (todo) → child (done):
- Level 1: cap(`done`) = `in-progress`. isStatusAfter(`in-progress`, `todo`) = true → promote parent to `in-progress`.
- Level 2: cap(`done`) = `in-progress`. isStatusAfter(`in-progress`, `idea`) = true → promote grandparent to `in-progress`.

### 4. Additional test cases (required)

Beyond updating existing tests, the following new test cases must be added:

| Test | Parent status | Child becomes | Expected |
|------|--------------|---------------|----------|
| Cap prevents done promotion | `todo` | `done` | Parent → `in-progress` (not `done`) |
| Cap with parent at in-progress | `in-progress` | `done` | No promotion event |
| Cap with parent at idea | `idea` | `done` | Parent → `in-progress` |
| Closed child also capped | `idea` | `closed` | Parent → `in-progress` (not `closed`) |
| Closed child, parent at in-progress | `in-progress` | `closed` | No promotion |
| Reparent done child to idea parent | `idea` | (already `done`) | Parent → `in-progress` (not `done`) |
| Explicit parent → done still works | any | any | `tracker.update(parentId, { status: "done" })` succeeds if children all `done`/`closed` |

## Out of Scope

- Changes to downward cascading (parent → children auto-close)
- Changes to the `done` guard (preventing parent from going to `done` when children aren't all `done`/`closed`)
- Changes to the `isStatusAfter` or `STATUS_ORDER` definitions
- CLI changes or new commands
