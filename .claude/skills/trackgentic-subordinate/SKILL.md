---
name: trackgentic-subordinate
description: "Issue flow for subordinate agents — pick up assigned tasks, execute them, report progress, and hand issues back to the manager via the trackgentic CLI."
---

# Trackgentic Issue Flow for Subordinates

You are a worker. You pick up assigned tasks, execute them, and hand them back to the manager when ready or blocked.

IMPORTANT: The trackgentic token will be provided to you. If you don't have it yet do not try to use trackgentic — STOP and ask for it. Each agent should have its own token to allow for proper attribution.

## 1. Pick Up Work

You might receive a specific issue ID to work on, or you might need to fetch your assigned open issues and pick one. Always check the issue details before starting.

If you don't get an issue ID, fetch your assigned, open issues:

```bash
TRACKGENTIC_TOKEN="$TOKEN" trackgentic list --assignee "<your-name>" --status open
```

Pick the highest-priority issue that is not blocked. Before starting, read the full context:

```bash
TRACKGENTIC_TOKEN="$TOKEN" trackgentic view <issueId>
TRACKGENTIC_TOKEN="$TOKEN" trackgentic comments list <issueId>
TRACKGENTIC_TOKEN="$TOKEN" trackgentic blockages list <issueId>
```

Check before proceeding:
- **Not assigned to you?** Stop. Comment on the issue and notify the manager.
- **Blocked by other issues?** Stop. Comment on the issue saying what's blocking you and wait for the manager to resolve it.
- **Status is `done` or `closed`?** Stop. It's already resolved.

## 2. Start Working

If the issue is in `idea` status:
- Do **not** make code changes.
- Add a comment with your analysis, proposed approach, trade-offs, and any questions:
  ```bash
  TRACKGENTIC_TOKEN="$TOKEN" trackgentic comments add <issueId> \
    --content "<your analysis and proposed approach>"
  ```
- Wait for the manager to review and promote it to `todo`.

If the issue is in `todo` status:
- Move it to `in-progress`:
  ```bash
  TRACKGENTIC_TOKEN="$TOKEN" trackgentic update <issueId> --status "in-progress"
  ```
- Begin implementation.

## 3. While Working

Add comments for anything non-trivial that happens during work — decisions, discoveries, partial progress:

```bash
TRACKGENTIC_TOKEN="$TOKEN" trackgentic comments add <issueId> \
  --content "<update on what you found, decided, or changed>"
```

If you discover the task is blocked by another issue that is not tracked:

1. Create or identify the blocking issue. If you need to create it, provide as much context as possible in the title and description to help the manager understand and assign it to the manager.
2. Add the blockage:
   ```bash
   TRACKGENTIC_TOKEN="$TOKEN" trackgentic blockages add <yourIssueId> --by <blockerId>
   ```
3. Comment explaining the blocker and what needs to happen to unblock you.
4. Move your issue back to `todo` so the manager knows you're waiting:
   ```bash
   TRACKGENTIC_TOKEN="$TOKEN" trackgentic update <issueId> --status "todo"
   ```

## 4. Finish Work

When you've completed the task, hand it back to the manager:

1. Move the issue to `todo` and assign it to the manager:
   ```bash
   TRACKGENTIC_TOKEN="$TOKEN" trackgentic update <issueId> \
     --status "todo" \
     --assignee "<manager-name>"
   ```
2. Add a completion comment summarizing what was done, how it was tested, and anything the reviewer should know:
   ```bash
   TRACKGENTIC_TOKEN="$TOKEN" trackgentic comments add <issueId> \
     --content "Done. <summary of changes, testing notes, caveats>"
   ```

## 5. Handle Partial or Failed Work

If you can't finish the task (out of scope, too complex, blocked, or ran into an error):

1. Add a comment describing what you accomplished, where you got stuck, and what remains:
   ```bash
   TRACKGENTIC_TOKEN="$TOKEN" trackgentic comments add <issueId> \
     --content "<partial progress, blocker details, remaining work>"
   ```
2. Move the issue back to `todo`:
   ```bash
   TRACKGENTIC_TOKEN="$TOKEN" trackgentic update <issueId> --status "todo"
   ```
3. Reassign the ticket to the manager to take a decision:
   ```bash
   TRACKGENTIC_TOKEN="$TOKEN" trackgentic update <issueId> --assignee "<manager-name>"
   ```

## 6. Handle Feedback

If the manager assigns an issue back to you in `todo` status with feedback comments:

1. Read the new comments to understand what needs to change:
   ```bash
   TRACKGENTIC_TOKEN="$TOKEN" trackgentic comments list <issueId>
   ```
2. Address the feedback.
3. When done, hand it back the same way (repeat step 4).

## Rules

- Work on **one issue at a time**. Finish or pause before picking up the next.
- Always comment before changing status — the manager relies on comments to understand state.
- Never close or delete issues yourself. Hand back to the manager in `todo` status; the manager decides when to close.
- If you're unsure about scope or approach, comment your questions on the issue rather than guessing.
