# Issue Blockages

Issues can be blocked by other issues. A blockage means that an issue cannot be worked on until the blocking issue is completed. Blockages are tracked with a status so that resolved blockages remain in the history, giving visibility into what was required to unblock an issue.

## Blockage properties

Each blockage has the following properties:

* `blockedId`: the id of the issue that is blocked.
* `blockerId`: the id of the issue that is blocking.
* `status`: `active` or `resolved`.

A blockage is `active` when the blocking issue has not been completed yet. Once the blocking issue is completed or the blockage is manually resolved, the status changes to `resolved`.

## Dependency index file

Blockages are stored in a separate index file: `.trackgentic/dependencies.json`. This keeps dependency data out of the main index and avoids git conflicts when agents modify blockages and issue metadata concurrently.

The file contains two bidirectional maps for fast lookups in both directions:

* `blockedBy`: keyed by issue id, contains an array of blockage entries for issues that block it.
* `blocks`: keyed by issue id, contains an array of blockage entries for issues that it blocks.

Both maps are always kept in sync — every mutation writes to both sides atomically.

### Structure

```json
{
  "blockedBy": {
    "issue-A": [
      { "blockerId": "issue-B", "status": "active" },
      { "blockerId": "issue-C", "status": "resolved" }
    ]
  },
  "blocks": {
    "issue-B": [
      { "blockedId": "issue-A", "status": "active" }
    ],
    "issue-C": [
      { "blockedId": "issue-A", "status": "resolved" }
    ]
  }
}
```

In this example:
- `issue-A` is currently blocked by `issue-B` (active) and was previously blocked by `issue-C` (resolved).
- Looking up `blocks["issue-B"]` tells us that completing `issue-B` would unblock `issue-A`.

## Events

Blockages are tracked as events in the blocked issue's event file.

### Adding a blockage

When a blockage is created, a `blockage-added` event is appended to the blocked issue's file:

```json
{ "timestamp": "2024-06-01T12:00:00Z", "type": "blockage-added", "author": "alice", "content": { "blockerId": "issue-B" } }
```

### Resolving a blockage

When a blockage is resolved, a `blockage-resolved` event is appended to the blocked issue's file:

```json
{ "timestamp": "2024-06-01T12:00:00Z", "type": "blockage-resolved", "author": "alice", "content": { "blockerId": "issue-B" } }
```

### Deleting a blockage

When a blockage is deleted (e.g. it was added by mistake), a `blockage-deleted` event is appended to the blocked issue's file and the entry is **removed** from both `blockedBy` and `blocks` maps in the dependency index:

```json
{ "timestamp": "2024-06-01T12:00:00Z", "type": "blockage-deleted", "author": "alice", "content": { "blockerId": "issue-B" } }
```

Unlike resolving, deleting removes the entry entirely from the index rather than keeping it as `resolved`. The event log still records that the blockage existed and was deleted, preserving auditability.

A blockage can be deleted regardless of its current status (`active` or `resolved`).

This way the full history of blockages (added, resolved, and deleted) is preserved in the issue's event log, and the current state can be reconstructed by replaying events.

## Determining if an issue is blocked

An issue is considered **blocked** if it has at least one `active` entry in `blockedBy` in the dependency index. This can be checked without reading individual issue files.

An issue is considered **unblocked** if it has no `active` entries in `blockedBy`, or no entry at all.

## Impact score for priority tiebreaking

When two unblocked issues have the same priority, the one that unblocks more downstream work should be picked first. The **impact score** of an issue is the count of `active` entries in `blocks[issueId]` — i.e., how many issues are currently waiting on it.

The sort order for listing and picking the next issue is:
1. Priority ascending (1 first)
2. Impact score descending (most unblocking first)
3. `createdAt` ascending (oldest first)

## Cycle detection

When adding a blockage, the system must verify that no circular dependency is introduced. This is done by walking the `blockedBy` graph transitively from the proposed blocker: if the walk reaches the blocked issue, a cycle exists and the operation is rejected.

When adding multiple blockages at once, cycle detection must run against the **projected** state that includes all earlier blockages in the same batch. Each proposed pair is added to an in-memory copy of the graph before validating the next one. If any pair introduces a cycle, the entire batch is rejected and no mutations are written.

Only `active` entries are considered when checking for cycles. Resolved blockages do not participate in cycle detection.

## Automatic resolution

When an issue transitions to `done` or `closed` status, any `active` blockage entries where that issue is the blocker should be automatically resolved. This means:

1. Look up `blocks[issueId]` for all `active` entries.
2. For each entry, change the status to `resolved` in both `blockedBy` and `blocks` maps.
3. Append a `blockage-resolved` event to each previously-blocked issue's event file.

This ensures that completing an issue automatically unblocks its dependents without requiring manual intervention.

## Folder structure

```
.trackgentic/
  config.json
  index.json
  dependencies.json
  users.json
  issues/
    [issue_id].json
```

## CLI commands

See [commands.md](commands.md) for the full CLI reference. Blockages are managed through subcommands under `trackgentic blockages`:

### `trackgentic blockages add [blocked_id] --by [blocker_id...]`

Add one or more blockages indicating that `blocked_id` is blocked by the given blocker ids. Multiple blocker ids can be passed to `--by` to create several blockages in a single atomic operation.

Examples:
```
trackgentic blockages add issue-A --by issue-B
trackgentic blockages add issue-A --by issue-B issue-C issue-D
```

The operation is atomic: all cycle checks are validated against the projected state first, and if any would introduce a cycle the entire command is rejected with no side effects.

### `trackgentic blockages resolve [blocked_id] --by [blocker_id...]`

Resolve one or more blockages, marking them as `resolved`. The entries remain in the index for historical visibility.

Examples:
```
trackgentic blockages resolve issue-A --by issue-B
trackgentic blockages resolve issue-A --by issue-B issue-C
```

### `trackgentic blockages delete [blocked_id] --by [blocker_id...]`

Delete one or more blockages entirely from the dependency index. Use this when a blockage was added by mistake. A `blockage-deleted` event is appended to the blocked issue's event file for auditability.

Examples:
```
trackgentic blockages delete issue-A --by issue-B
trackgentic blockages delete issue-A --by issue-B issue-C
```

### `trackgentic blockages list [issue_id]`

List the blockages for a given issue — both what blocks it and what it blocks, including resolved entries.

**Returns:**
```json
{
  "issueId": "issue-A",
  "blockedBy": [
    { "blockerId": "issue-B", "status": "active" },
    { "blockerId": "issue-C", "status": "resolved" }
  ],
  "blocks": [
    { "blockedId": "issue-D", "status": "active" },
    { "blockedId": "issue-E", "status": "resolved" }
  ]
}
```
