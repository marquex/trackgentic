---
name: worktask
description: "Work on a trackgentic issue. Retrieves issue details, manages status transitions, and reports progress. Use when assigned an issue to work on."
argument-hint: "<issue-id>"
---

# Work Task

This skill is invoked when you are assigned an issue to work on by the agent runner. The issue ID is provided as a parameter.

## Workflow

When you receive `/worktask <issue-id>`, follow these steps:

### 1. Retrieve Issue Details

Fetch the issue details and context:

```bash
TRACKGENTIC_TOKEN="$TOKEN" trackgentic view <issue-id>
TRACKGENTIC_TOKEN="$TOKEN" trackgentic comments list <issue-id>
TRACKGENTIC_TOKEN="$TOKEN" trackgentic blockages list <issue-id>
```

### 2. Validate Before Starting

Before doing any work, check:

- **Not assigned to you?** Stop. Add a comment explaining the mismatch and exit.
- **Blocked by other issues?** Stop. Add a comment saying what's blocking you and exit.
- **Status is `done` or `closed`?** Stop. It's already resolved — exit.

### 3. Begin Work

Transition based on the current issue status:

- **`idea` status** — Do NOT make code changes. Analyze the issue, add a comment with your proposed approach, trade-offs, and questions. Then exit.
- **`todo` status** — Move to `in-progress` and start working:
  ```bash
  TRACKGENTIC_TOKEN="$TOKEN" trackgentic update <issue-id> --status "in-progress"
  ```
- **`in-progress` status** — Continue working. Read comments for any recent context.

### 4. While Working

- Add comments for non-trivial decisions, discoveries, or progress updates.
- If you discover a blocker that isn't tracked yet:
  1. Create a new issue describing the blocker, assign it to the appropriate agent.
  2. Add the blockage: `TRACKGENTIC_TOKEN="$TOKEN" trackgentic blockages add <issue-id> --by <blocker-id>`
  3. Comment explaining the blocker.
  4. Move your issue back to `todo`: `TRACKGENTIC_TOKEN="$TOKEN" trackgentic update <issue-id> --status "todo"`
  5. Exit — the runner will reassign you when the blocker is resolved.

### 5. Finish Work

When the task is complete:

1. Add a completion comment summarizing what was done, how it was tested, and any caveats:
   ```bash
   TRACKGENTIC_TOKEN="$TOKEN" trackgentic comments add <issue-id> \
     --content "Done. <summary of changes, testing notes, caveats>"
   ```
2. Move the issue to `done`:
   ```bash
   TRACKGENTIC_TOKEN="$TOKEN" trackgentic update <issue-id> --status "done"
   ```

### 6. Handle Partial or Failed Work

If you can't finish (blocked, too complex, errored out):

1. Add a comment describing progress, where you got stuck, and what remains.
2. Move the issue back to `todo`:
   ```bash
   TRACKGENTIC_TOKEN="$TOKEN" trackgentic update <issue-id> --status "todo"
   ```

## Important Notes

- When you finish an issue that is not blocked, assign it to some other agent or mark it as `done` so the manager can review and close it. Do not leave issues in `in-progress` or `to-do` without assigning to others or it will come back to you in the next cycle.
- Work on only the issue you were assigned — do not pick up other issues.
- Always comment before changing status so the history is clear.
- Never close issues yourself — mark as `done` and let the manager close them.
- If you need another agent to do work, create a child issue and assign it to them. The runner will pick it up automatically.
- Your trackgentic token is provided in your agent configuration. Use it for all trackgentic commands.
