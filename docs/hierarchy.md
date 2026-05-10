# Issue Hierarchy

Issues can form a tree structure through the `parentId` property. A parent issue can have multiple children, and children can themselves have children, allowing infinite nesting.

## Sorted index

The `open` and `closed` arrays in the index file are kept sorted by issue `id`. Since ids are generated from a timestamp + random string (`Date.now().toString(36).slice(0,6) + Math.random().toString(36).slice(-4)`), they are naturally sortable by creation time. Maintaining sorted order enables binary search for O(log n) lookups by id, and new issues are inserted in their correct position to preserve the sort.

## Children index

To efficiently navigate from parent to children, the index file includes a `childrenOf` map keyed by issue id. Each entry contains an array of child issue ids. This allows O(1) lookup of direct children without scanning the full index.

The `childrenOf` map is maintained automatically: it is updated whenever an issue is created with a `parentId`, when an issue's `parentId` is changed, or when an issue is deleted.

### Structure

```json
{
  "open": [...],
  "closed": [...],
  "childrenOf": {
    "issue-A": ["issue-B", "issue-C"],
    "issue-B": ["issue-D"]
  }
}
```

In this example, `issue-A` has two direct children (`issue-B` and `issue-C`), and `issue-B` has one child (`issue-D`).

## Status constraints

The statuses form a progression: `idea` → `todo` → `in-progress` → `done` → `closed`. The hierarchy enforces constraints in two directions to keep the subtree lifecycle coherent.

### Upward constraints (children restrict parent)

* **A parent cannot be set to `done` or `closed` if it has children that are not `done` or `closed`.** This is a hard block. Marking a parent complete while subtasks remain open is always an error.
* **When a child advances past its parent's status, the parent is automatically promoted.** For example, if a child moves to `in-progress` but the parent is still `todo`, the parent is silently moved to `in-progress` as well. This is implemented by emitting an additional status-change event on the parent within the same operation.

### Downward constraints (parent restricts children)

* **Children cannot be created under or reparented to a `closed` parent.** A closed issue represents abandoned or fully concluded work. To attach children, the parent must be reopened first. This is a hard block.
* **Closing a parent automatically closes all `done` children.** When a parent is moved to `closed`, any children in `done` status are automatically moved to `closed` as well. This cascades through the entire subtree — if a `done` child has `done` grandchildren, they are all closed. Children that are not in `done` or `closed` status block the operation entirely; the parent cannot be closed until those children are completed or closed individually first.

### Allowed transitions

The following transitions are allowed without restriction:

* Creating children under a parent in `idea` status. While the parent represents uncommitted work, sub-ideas or exploratory subtasks are legitimate.
* Creating children under a parent in `done` status. Follow-up subtasks discovered after completion are common, and the upward constraint will prevent the parent from staying `done` once the new child exists in an open state.

## Events

Hierarchy changes are tracked as events in the child issue's event file.

### Setting a parent

When an issue is created with a `parentId` or reparented via `update`, the event content includes the `parentId` field:

```json
{ "timestamp": "2024-06-01T12:00:00Z", "type": "creation", "author": "alice", "content": { "title": "Sub-task", "parentId": "issue-A", "status": "todo" } }
```

```json
{ "timestamp": "2024-06-01T13:00:00Z", "type": "update", "author": "alice", "content": { "parentId": "issue-B" } }
```

### Removing a parent

To detach an issue from its parent, update `parentId` to `null`:

```json
{ "timestamp": "2024-06-01T14:00:00Z", "type": "update", "author": "alice", "content": { "parentId": null } }
```

### Auto-promotion

When a child's status change triggers automatic promotion of the parent, a regular `update` event is appended to the parent's event file with the system as author:

```json
{ "timestamp": "2024-06-01T12:00:00Z", "type": "update", "author": "system", "content": { "status": "in-progress", "reason": "auto-promoted: child issue-D moved to in-progress" } }
```
