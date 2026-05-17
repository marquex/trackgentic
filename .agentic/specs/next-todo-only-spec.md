# Spec: `next` Command — Restrict to `todo` Status Only

## Summary

Change the `next <user-name>` subcommand to only consider issues with `todo` status, removing `idea` and `in-progress` from the eligible statuses. The `next` command is meant to recommend the best piece of work to pick up next — `idea` issues haven't been vetted yet, and `in-progress` issues are already being worked on. Only `todo` represents work that's been triaged, approved, and ready to start.

## Requirements

1. The `Tracker.next(assignee)` method must filter the open index to issues where `status === "todo"` (previously: `status in ["idea", "todo", "in-progress"]`)
2. All other behavior remains unchanged: assignee filter, blockage exclusion, priority/impact/id sorting, `ComputedIssue` return shape, `NO_ISSUES_AVAILABLE` when empty
3. Existing tests that rely on the old status filter must be updated to reflect the new behavior
4. New tests should explicitly verify that `idea` and `in-progress` issues are excluded

## API/interface changes

No API changes — same method signature, same return type (`NextResult`). Only the internal status filter changes.

### Changed files

1. **`src/core/tracker.ts`** — In the `next()` method, change the status filter from `["idea", "todo", "in-progress"]` to `["todo"]`
2. **Tests** — Update existing `next` tests and add explicit exclusion tests for `idea` and `in-progress`

## Implementation notes

- This is a single-line change in the filter logic within `Tracker.next()`
- The constant or inline array that defines eligible statuses should be updated
- Search for the existing filter (likely something like `["idea", "todo", "in-progress"].includes(status)`) and narrow to `status === "todo"`
- Update the `NO_ISSUES_AVAILABLE` message to say "No todo issues found" instead of "No unblocked issues found" for clarity

## Out of scope

- No changes to the `list` command (it has its own `--status` filter)
- No changes to any other command
- No new CLI flags or options

## Status: DRAFT
