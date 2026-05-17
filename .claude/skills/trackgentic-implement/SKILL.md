---
name: trackgentic-implement
description: "Worker skill — pick up an assigned issue, implement it, and hand it back via trackgentic status transitions. Receives issue ID from prompt argument or TRACKGENTIC_ISSUE_ID env var."
argument-hint: "<issue-id>"
---

# Trackgentic Implement — Worker Skill

This skill defines how a worker agent picks up, executes, and hands back an issue using trackgentic.

## Issue ID Resolution

The issue ID is resolved in this order:

1. Prompt argument: `/trackgentic-implement <issue-id>`
2. Environment variable: `$TRACKGENTIC_ISSUE_ID`

If neither is available, stop and report the error.

## Workflow

### 1. Retrieve Context

```bash
trackgentic view <issue-id>
trackgentic comments list <issue-id>
trackgentic blockages list <issue-id>
```

### 2. Validate Before Starting

Check each condition — stop if any applies:

| Condition | Action |
|-----------|--------|
| Not assigned to you | Comment "Issue not assigned to me — skipping." and exit |
| Status is `done` or `closed` | Exit silently — already resolved |
| Has active blockages | Comment "Blocked by <ids>. Reassigning to manager." → reassign to manager → exit |
| Status is `idea` | Do NOT implement. Comment with analysis/proposal. Reassign to manager. Exit |

### 3. Start Work

Move to `in-progress`:

```bash
trackgentic update <issue-id> --status "in-progress"
```

Read the issue description and comments carefully. Understand acceptance criteria before writing code.

### 4. While Working

Add comments for non-trivial decisions or progress:

```bash
trackgentic comments add <issue-id> --content "<update>"
```

### 5. Finish — Success

When the work is complete and verified:

```bash
trackgentic comments add <issue-id> \
  --content "Done. <summary of what was delivered, how it was tested, caveats>"
trackgentic update <issue-id> --status "done" --assignee "<manager>"
```

**`done` means the work SUCCEEDED.** The manager will review and close.

### 6. Finish — Blocked

When you cannot continue because something external is needed:

```bash
trackgentic comments add <issue-id> \
  --content "Blocked: <what you need, from whom, and why>"
trackgentic update <issue-id> --assignee "<manager>"
```

Status stays `in-progress`. The manager will resolve the blocker and reassign back to you.

If the blocker is a concrete task that doesn't exist yet, create it:

```bash
trackgentic create "<blocker title>" \
  --description "<what needs to happen>" \
  --assignee "<manager>" \
  --status "todo" \
  --priority <same-or-higher>
```

Then add the blockage:

```bash
trackgentic blockages add <issue-id> --by <new-blocker-id>
```

Finally comment on the original issue explaining you created the blocker and what needs to happen to unblock you.

### 7. Finish — Failed

When the task cannot be completed (wrong approach, out of scope, fundamentally broken):

```bash
trackgentic comments add <issue-id> \
  --content "Cannot complete: <what was tried, why it failed, what remains>"
trackgentic update <issue-id> --status "todo" --assignee "<manager>"
```

Status reverts to `todo` — the manager will re-plan.

## Status Transition Summary

```
         ┌─────────────────────────────────────────┐
         │              Worker receives             │
         │          issue in status: todo           │
         └────────────────┬────────────────────────┘
                          │
                          ▼
                   ┌─────────────┐
                   │ in-progress │
                   └──────┬──────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
        ┌──────────┐ ┌────────┐ ┌─────────┐
        │   done   │ │ blocked│ │  failed │
        │          │ │        │ │         │
        │assign:mgr│ │assign: │ │status:  │
        │          │ │  mgr   │ │  todo   │
        │          │ │status: │ │assign:  │
        │          │ │in-prog │ │  mgr    │
        └──────────┘ └────────┘ └─────────┘
```

## Rules

- **Never** set `done` on incomplete or failed work — it auto-resolves downstream blockages.
- **Never** close issues yourself — only the manager closes.
- **Never** pick up issues not assigned to you.
- **Always** comment before changing status so history is clear.
- **Always** reassign to your manager when you stop working — assignment = notification.
- Work on only the issue you were given. If you discover adjacent work, create a new issue for it and assign to the manager.
